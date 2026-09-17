import type { SQLiteDatabase } from "./db";

const LATEST_DB_VERSION = 8;

export function applyMigrations(db: SQLiteDatabase): void {
  const version = Number(db.pragma("user_version", { simple: true })) || 0;

  const migrate = db.transaction(() => {
    if (version < 1) {
      createInitialSchema(db);
      db.pragma("user_version = 1");
    }
    if (version < 2) {
      createCompactionSchema(db);
      db.pragma("user_version = 2");
    }
    if (version < 3) {
      createSessionRecapSchema(db);
      db.pragma("user_version = 3");
    }
    if (version < LATEST_DB_VERSION) {
      createAutonomyLedgerSchema(db);
      db.pragma(`user_version = ${LATEST_DB_VERSION}`);
    }

    ensureLatestSchema(db);
  });

  migrate();
}

function createInitialSchema(db: SQLiteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      scope_key TEXT NOT NULL UNIQUE,
      canonical_path TEXT NOT NULL,
      git_root TEXT,
      display_name TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      title TEXT,
      recap_text TEXT,
      recap_model TEXT,
      recap_updated_at TEXT,
      model TEXT NOT NULL,
      mode TEXT NOT NULL,
      cwd_at_start TEXT NOT NULL,
      cwd_last TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS messages (
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      seq INTEGER NOT NULL,
      role TEXT NOT NULL,
      message_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (session_id, seq)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS tool_calls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      message_seq INTEGER NOT NULL,
      tool_call_id TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      args_json TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      UNIQUE(session_id, tool_call_id)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS tool_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tool_call_row_id INTEGER NOT NULL REFERENCES tool_calls(id) ON DELETE CASCADE,
      output_kind TEXT NOT NULL,
      output_json TEXT NOT NULL,
      success INTEGER NOT NULL,
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS usage_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      message_seq INTEGER,
      source TEXT NOT NULL,
      model TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      cost_micros INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE INDEX IF NOT EXISTS idx_sessions_workspace_updated
      ON sessions(workspace_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_messages_session_seq
      ON messages(session_id, seq);
    CREATE INDEX IF NOT EXISTS idx_tool_calls_session_seq
      ON tool_calls(session_id, message_seq);
    CREATE INDEX IF NOT EXISTS idx_usage_events_session_created
      ON usage_events(session_id, created_at DESC);
  `);
  // compactions is created by createCompactionSchema, which always runs in the same
  // migrate() transaction as a fresh install (version starts at 0, so both the
  // version<1 and version<2 branches fire) as well as for real v1->v2 upgrades.
  // Defining it here too would just be a redundant duplicate CREATE.
}

function createCompactionSchema(db: SQLiteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS compactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      first_kept_seq INTEGER NOT NULL,
      summary TEXT NOT NULL,
      tokens_before INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE INDEX IF NOT EXISTS idx_compactions_session_created
      ON compactions(session_id, created_at DESC);
  `);
}

function createSessionRecapSchema(db: SQLiteDatabase): void {
  addColumnIfMissing(db, "sessions", "recap_text", "TEXT");
  addColumnIfMissing(db, "sessions", "recap_model", "TEXT");
  addColumnIfMissing(db, "sessions", "recap_updated_at", "TEXT");
}

/**
 * Cross-references a chat session with any autonomy objective(s) it ran, and adds file
 * checkpoints. The autonomy runtime's own file-based journal (`src/autonomy/journal.ts`)
 * remains the source of truth for the full action/observation/verification/repair history
 * of one run — that is already well-designed and per-run reconstructable from disk. This
 * schema only indexes the parts that must be queryable *across* runs/sessions without
 * loading every run's journal off disk: which session (if any) an objective belongs to,
 * current phase/stop reason, and per-task status.
 */
function createAutonomyLedgerSchema(db: SQLiteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS objectives (
      id TEXT PRIMARY KEY,
      session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      request TEXT NOT NULL,
      phase TEXT NOT NULL,
      stop_reason TEXT,
      blocker TEXT,
      run_dir TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE INDEX IF NOT EXISTS idx_objectives_session
      ON objectives(session_id);
    CREATE INDEX IF NOT EXISTS idx_objectives_workspace_updated
      ON objectives(workspace_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS objective_tasks (
      objective_id TEXT NOT NULL REFERENCES objectives(id) ON DELETE CASCADE,
      task_id TEXT NOT NULL,
      description TEXT NOT NULL,
      satisfies_json TEXT NOT NULL,
      status TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (objective_id, task_id)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS checkpoints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
      objective_id TEXT REFERENCES objectives(id) ON DELETE SET NULL,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      file_path TEXT NOT NULL,
      previous_existed INTEGER NOT NULL,
      previous_content TEXT,
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE INDEX IF NOT EXISTS idx_checkpoints_workspace_path_created
      ON checkpoints(workspace_id, file_path, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_checkpoints_session_created
      ON checkpoints(session_id, created_at DESC);
  `);
}

function ensureLatestSchema(db: SQLiteDatabase): void {
  createSessionRecapSchema(db);
  createBenchmarkSchema(db);
}

/**
 * Cross-run benchmark index. The autonomy journal remains the detailed per-task source of
 * truth; these rows are the durable query surface for history, comparison, and the TUI.
 * Scores are duplicated into typed columns for indexed leaderboard queries and retained as
 * JSON so new dimensions can be added without another migration.
 */
function createBenchmarkSchema(db: SQLiteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS benchmark_runs (
      run_number INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL UNIQUE,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT,
      heartbeat_at TEXT,
      finalized_at TEXT,
      benchmark_version TEXT NOT NULL,
      benchmark_suite TEXT NOT NULL,
      agent_name TEXT NOT NULL,
      leaderboard_eligible INTEGER NOT NULL DEFAULT 0,
      agent_version TEXT,
      agent_config_json TEXT NOT NULL DEFAULT '{}',
      configuration_fingerprint TEXT NOT NULL,
      model TEXT,
      model_provider TEXT,
      model_version TEXT,
      repository_commit TEXT,
      repository_dirty INTEGER NOT NULL DEFAULT 0,
      repository_diff_hash TEXT,
      shelra_version TEXT,
      environment_json TEXT NOT NULL DEFAULT '{}',
      benchmark_config_json TEXT NOT NULL DEFAULT '{}',
      seed_text TEXT,
      task_count INTEGER NOT NULL DEFAULT 0,
      completed_task_count INTEGER NOT NULL DEFAULT 0,
      resolved_task_count INTEGER NOT NULL DEFAULT 0,
      resolved_rate REAL,
      overall_score REAL,
      coding_score REAL,
      agentic_score REAL,
      intent_score REAL,
      verification_score REAL,
      research_score REAL,
      memory_score REAL,
      repair_score REAL,
      efficiency_score REAL,
      scores_json TEXT NOT NULL DEFAULT '{}',
      confidence_json TEXT,
      input_tokens INTEGER,
      output_tokens INTEGER,
      cached_tokens INTEGER,
      reasoning_tokens INTEGER,
      total_tokens INTEGER,
      cost_micros INTEGER,
      cost_kind TEXT,
      cost_source TEXT,
      duration_ms INTEGER,
      failure_reason TEXT,
      failure_type TEXT,
      process_id INTEGER
    ) STRICT;

    CREATE TABLE IF NOT EXISTS benchmark_task_results (
      run_id TEXT NOT NULL REFERENCES benchmark_runs(id) ON DELETE CASCADE,
      task_id TEXT NOT NULL,
      category TEXT NOT NULL,
      difficulty TEXT NOT NULL,
      task_definition_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT,
      duration_ms INTEGER,
      llm_duration_ms INTEGER,
      tool_duration_ms INTEGER,
      verification_duration_ms INTEGER,
      repair_duration_ms INTEGER,
      scores_json TEXT NOT NULL DEFAULT '{}',
      input_tokens INTEGER,
      output_tokens INTEGER,
      cached_tokens INTEGER,
      reasoning_tokens INTEGER,
      total_tokens INTEGER,
      cost_micros INTEGER,
      cost_kind TEXT,
      cost_source TEXT,
      behavior_json TEXT NOT NULL DEFAULT '{}',
      acceptance_json TEXT NOT NULL DEFAULT '[]',
      final_result_json TEXT,
      failure_reason TEXT,
      failure_type TEXT,
      evidence_json TEXT NOT NULL DEFAULT '[]',
      objective_run_dir TEXT,
      PRIMARY KEY (run_id, task_id)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS benchmark_acceptance_results (
      run_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      criterion_id TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL,
      required INTEGER,
      detail TEXT,
      evidence_json TEXT NOT NULL DEFAULT '[]',
      PRIMARY KEY (run_id, task_id, criterion_id),
      FOREIGN KEY (run_id, task_id) REFERENCES benchmark_task_results(run_id, task_id) ON DELETE CASCADE
    ) STRICT;

    CREATE TABLE IF NOT EXISTS benchmark_events (
      run_id TEXT NOT NULL REFERENCES benchmark_runs(id) ON DELETE CASCADE,
      sequence INTEGER NOT NULL,
      type TEXT NOT NULL,
      at TEXT NOT NULL,
      task_id TEXT,
      message TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      PRIMARY KEY (run_id, sequence)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS benchmark_artifacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL REFERENCES benchmark_runs(id) ON DELETE CASCADE,
      task_id TEXT,
      kind TEXT NOT NULL,
      path TEXT NOT NULL,
      label TEXT,
      sha256 TEXT,
      bytes INTEGER,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS benchmark_baselines (
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      benchmark_suite TEXT NOT NULL,
      benchmark_version TEXT NOT NULL,
      agent_name TEXT NOT NULL,
      run_id TEXT NOT NULL REFERENCES benchmark_runs(id) ON DELETE CASCADE,
      set_at TEXT NOT NULL,
      PRIMARY KEY (workspace_id, benchmark_suite, benchmark_version, agent_name)
    ) STRICT;

    CREATE INDEX IF NOT EXISTS idx_benchmark_runs_workspace_created
      ON benchmark_runs(workspace_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_benchmark_runs_workspace_status
      ON benchmark_runs(workspace_id, status, run_number DESC);
    CREATE INDEX IF NOT EXISTS idx_benchmark_runs_agent_version
      ON benchmark_runs(workspace_id, agent_name, agent_version, benchmark_version, benchmark_suite);
    CREATE INDEX IF NOT EXISTS idx_benchmark_runs_configuration
      ON benchmark_runs(
        workspace_id, benchmark_suite, benchmark_version, agent_name, agent_version,
        model, model_provider, model_version, configuration_fingerprint, run_number DESC
      );
    CREATE INDEX IF NOT EXISTS idx_benchmark_runs_commit
      ON benchmark_runs(repository_commit);
    CREATE INDEX IF NOT EXISTS idx_benchmark_tasks_run_status_category
      ON benchmark_task_results(run_id, status, category);
    CREATE INDEX IF NOT EXISTS idx_benchmark_events_run_at
      ON benchmark_events(run_id, at, sequence);
    CREATE INDEX IF NOT EXISTS idx_benchmark_artifacts_run_task
      ON benchmark_artifacts(run_id, task_id, created_at);

    CREATE TRIGGER IF NOT EXISTS benchmark_runs_immutable_after_finalize
      BEFORE UPDATE ON benchmark_runs
      WHEN OLD.finalized_at IS NOT NULL
      BEGIN
        SELECT RAISE(ABORT, 'finalized benchmark runs are immutable');
      END;

    CREATE TRIGGER IF NOT EXISTS benchmark_tasks_immutable_after_finish
      BEFORE UPDATE ON benchmark_task_results
      WHEN OLD.finished_at IS NOT NULL
      BEGIN
        SELECT RAISE(ABORT, 'finished benchmark task results are immutable');
    END;
  `);
  addColumnIfMissing(db, "benchmark_task_results", "task_definition_json", "TEXT NOT NULL DEFAULT '{}'");
  addColumnIfMissing(db, "benchmark_runs", "resolved_task_count", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(db, "benchmark_runs", "resolved_rate", "REAL");
  addColumnIfMissing(db, "benchmark_runs", "failure_type", "TEXT");
  addColumnIfMissing(db, "benchmark_task_results", "failure_type", "TEXT");
  addColumnIfMissing(db, "benchmark_runs", "leaderboard_eligible", "INTEGER NOT NULL DEFAULT 0");
}

function addColumnIfMissing(db: SQLiteDatabase, table: string, column: string, definition: string): void {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: string }>;
  if (rows.some((row) => row.name === column)) {
    return;
  }
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
}
