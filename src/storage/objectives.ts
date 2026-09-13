import type { Task, TaskStatus } from "../autonomy/types";
import { getDatabase } from "./db";

/**
 * Cross-reference index for autonomy objectives.
 *
 * This is deliberately NOT a replacement for `src/autonomy/journal.ts`, which remains the
 * source of truth for one run's full action/observation/verification/repair history. This
 * index exists so a chat session and any objective(s) it ran can be correlated after the
 * fact, and so "what is running right now" can be answered with one query instead of
 * scanning every run directory on disk.
 */

export interface ObjectiveIndexRecord {
  id: string;
  sessionId: string | null;
  workspaceId: string;
  request: string;
  phase: string;
  stopReason: string | null;
  blocker: string | null;
  /** Absent for lightweight chat-turn objectives, which have no file journal. */
  runDir: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface ObjectiveRow {
  id: string;
  session_id: string | null;
  workspace_id: string;
  request: string;
  phase: string;
  stop_reason: string | null;
  blocker: string | null;
  run_dir: string | null;
  created_at: string;
  updated_at: string;
}

function toObjectiveRecord(row: ObjectiveRow): ObjectiveIndexRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    workspaceId: row.workspace_id,
    request: row.request,
    phase: row.phase,
    stopReason: row.stop_reason,
    blocker: row.blocker,
    runDir: row.run_dir,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

/** Insert the objective on first sight, then keep phase/stopReason/blocker current on every change. */
export function upsertObjectiveIndex(record: {
  id: string;
  sessionId: string | null;
  workspaceId: string;
  request: string;
  phase: string;
  stopReason?: string | null;
  blocker?: string | null;
  runDir?: string | null;
}): void {
  const now = new Date().toISOString();
  getDatabase()
    .prepare(`
    INSERT INTO objectives (
      id, session_id, workspace_id, request, phase, stop_reason, blocker, run_dir, created_at, updated_at
    ) VALUES (
      @id, @session_id, @workspace_id, @request, @phase, @stop_reason, @blocker, @run_dir, @created_at, @updated_at
    )
    ON CONFLICT(id) DO UPDATE SET
      phase = excluded.phase,
      stop_reason = excluded.stop_reason,
      blocker = excluded.blocker,
      updated_at = excluded.updated_at
  `)
    .run({
      id: record.id,
      session_id: record.sessionId,
      workspace_id: record.workspaceId,
      request: record.request,
      phase: record.phase,
      stop_reason: record.stopReason ?? null,
      blocker: record.blocker ?? null,
      run_dir: record.runDir ?? null,
      created_at: now,
      updated_at: now,
    });
}

export function getObjectiveById(id: string): ObjectiveIndexRecord | null {
  const row = getDatabase()
    .prepare(`
    SELECT id, session_id, workspace_id, request, phase, stop_reason, blocker, run_dir, created_at, updated_at
    FROM objectives
    WHERE id = ?
  `)
    .get(id) as ObjectiveRow | undefined;
  return row ? toObjectiveRecord(row) : null;
}

/** Answers "what is this chat session doing right now (or last)" without touching the model. */
export function getLatestObjectiveForSession(sessionId: string): ObjectiveIndexRecord | null {
  const row = getDatabase()
    .prepare(`
    SELECT id, session_id, workspace_id, request, phase, stop_reason, blocker, run_dir, created_at, updated_at
    FROM objectives
    WHERE session_id = ?
    ORDER BY updated_at DESC
    LIMIT 1
  `)
    .get(sessionId) as ObjectiveRow | undefined;
  return row ? toObjectiveRecord(row) : null;
}

export function listObjectivesForWorkspace(workspaceId: string, limit = 20): ObjectiveIndexRecord[] {
  const rows = getDatabase()
    .prepare(`
    SELECT id, session_id, workspace_id, request, phase, stop_reason, blocker, run_dir, created_at, updated_at
    FROM objectives
    WHERE workspace_id = ?
    ORDER BY updated_at DESC
    LIMIT ?
  `)
    .all(workspaceId, limit) as ObjectiveRow[];
  return rows.map(toObjectiveRecord);
}

export function upsertObjectiveTask(objectiveId: string, task: Task): void {
  getDatabase()
    .prepare(`
    INSERT INTO objective_tasks (
      objective_id, task_id, description, satisfies_json, status, attempts, last_error, updated_at
    ) VALUES (
      @objective_id, @task_id, @description, @satisfies_json, @status, @attempts, @last_error, @updated_at
    )
    ON CONFLICT(objective_id, task_id) DO UPDATE SET
      description = excluded.description,
      satisfies_json = excluded.satisfies_json,
      status = excluded.status,
      attempts = excluded.attempts,
      last_error = excluded.last_error,
      updated_at = excluded.updated_at
  `)
    .run({
      objective_id: objectiveId,
      task_id: task.id,
      description: task.description,
      satisfies_json: JSON.stringify(task.satisfies),
      status: task.status,
      attempts: task.attempts,
      last_error: task.lastError ?? null,
      updated_at: new Date().toISOString(),
    });
}

export interface ObjectiveTaskRecord {
  objectiveId: string;
  taskId: string;
  description: string;
  satisfies: string[];
  status: TaskStatus;
  attempts: number;
  lastError: string | null;
  updatedAt: Date;
}

export function listObjectiveTasks(objectiveId: string): ObjectiveTaskRecord[] {
  const rows = getDatabase()
    .prepare(`
    SELECT objective_id, task_id, description, satisfies_json, status, attempts, last_error, updated_at
    FROM objective_tasks
    WHERE objective_id = ?
    ORDER BY task_id ASC
  `)
    .all(objectiveId) as Array<{
    objective_id: string;
    task_id: string;
    description: string;
    satisfies_json: string;
    status: TaskStatus;
    attempts: number;
    last_error: string | null;
    updated_at: string;
  }>;

  return rows.map((row) => ({
    objectiveId: row.objective_id,
    taskId: row.task_id,
    description: row.description,
    satisfies: JSON.parse(row.satisfies_json) as string[],
    status: row.status,
    attempts: row.attempts,
    lastError: row.last_error,
    updatedAt: new Date(row.updated_at),
  }));
}

export interface CheckpointRecord {
  id: number;
  sessionId: string | null;
  objectiveId: string | null;
  workspaceId: string;
  filePath: string;
  previousExisted: boolean;
  previousContent: string | null;
  reason: string;
  createdAt: Date;
}

/** Snapshot a file's content immediately before a mutation, so it can be reverted. */
export function recordCheckpoint(input: {
  sessionId: string | null;
  objectiveId: string | null;
  workspaceId: string;
  filePath: string;
  previousContent: string | null;
  previousExisted: boolean;
  reason: string;
}): void {
  getDatabase()
    .prepare(`
    INSERT INTO checkpoints (
      session_id, objective_id, workspace_id, file_path, previous_existed, previous_content, reason, created_at
    ) VALUES (
      @session_id, @objective_id, @workspace_id, @file_path, @previous_existed, @previous_content, @reason, @created_at
    )
  `)
    .run({
      session_id: input.sessionId,
      objective_id: input.objectiveId,
      workspace_id: input.workspaceId,
      file_path: input.filePath,
      previous_existed: input.previousExisted ? 1 : 0,
      previous_content: input.previousContent,
      reason: input.reason,
      created_at: new Date().toISOString(),
    });
}

interface CheckpointRow {
  id: number;
  session_id: string | null;
  objective_id: string | null;
  workspace_id: string;
  file_path: string;
  previous_existed: number;
  previous_content: string | null;
  reason: string;
  created_at: string;
}

function toCheckpointRecord(row: CheckpointRow): CheckpointRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    objectiveId: row.objective_id,
    workspaceId: row.workspace_id,
    filePath: row.file_path,
    previousExisted: row.previous_existed === 1,
    previousContent: row.previous_content,
    reason: row.reason,
    createdAt: new Date(row.created_at),
  };
}

/** Most recent checkpoint for one file — what a `/rewind`-style revert would restore. */
export function getLatestCheckpoint(workspaceId: string, filePath: string): CheckpointRecord | null {
  const row = getDatabase()
    .prepare(`
    SELECT id, session_id, objective_id, workspace_id, file_path, previous_existed, previous_content, reason, created_at
    FROM checkpoints
    WHERE workspace_id = ? AND file_path = ?
    ORDER BY id DESC
    LIMIT 1
  `)
    .get(workspaceId, filePath) as CheckpointRow | undefined;
  return row ? toCheckpointRecord(row) : null;
}

export function listCheckpointsForSession(sessionId: string): CheckpointRecord[] {
  const rows = getDatabase()
    .prepare(`
    SELECT id, session_id, objective_id, workspace_id, file_path, previous_existed, previous_content, reason, created_at
    FROM checkpoints
    WHERE session_id = ?
    ORDER BY id DESC
  `)
    .all(sessionId) as CheckpointRow[];
  return rows.map(toCheckpointRecord);
}
