import type { ModelMessage } from "ai";
import { getDatabase, withTransaction } from "./db";
import { createSessionId } from "./sessions";
import { ensureWorkspace } from "./workspaces";

export interface ImportedSessionInput {
  /** The agent the chat comes from ("claude-code", "codex") and its id there. */
  source: string;
  sourceId: string;
  sourcePath: string;
  sourceUpdatedAt: Date;
  /** The folder the session belongs to; it must exist. */
  cwd: string;
  title: string | null;
  model: string;
  createdAt: Date;
  updatedAt: Date;
  messages: Array<{ message: ModelMessage; at: Date }>;
  /** What the model reads before the messages from `firstKeptIndex` on, stored as the session's compaction. */
  checkpoint: { summary: string; firstKeptIndex: number; tokensBefore: number };
}

/** The session a foreign chat was imported as and its folder, or null when it was not imported (or was deleted). */
export function findImportedSession(source: string, sourceId: string): { sessionId: string; cwd: string } | null {
  const row = getDatabase()
    .prepare(`
      SELECT i.session_id, s.cwd_last
      FROM session_imports i JOIN sessions s ON s.id = i.session_id
      WHERE i.source = ? AND i.source_id = ?
    `)
    .get(source, sourceId) as { session_id: string; cwd_last: string } | undefined;
  return row ? { sessionId: row.session_id, cwd: row.cwd_last } : null;
}

/** Every imported chat, as `<source>:<id>` mapped to the session it became. */
export function listImportedChats(): Map<string, string> {
  const rows = getDatabase().prepare("SELECT source, source_id, session_id FROM session_imports").all() as Array<{
    source: string;
    source_id: string;
    session_id: string;
  }>;
  return new Map(rows.map((row) => [`${row.source}:${row.source_id}`, row.session_id]));
}

/**
 * Stores a chat imported from another agent as a saved session, in one transaction: the session with the chat's own
 * dates (so /resume orders it where it happened), its messages, the checkpoint as the session's compaction (the
 * shape Shelra's own compaction leaves, which the next compaction updates), and the record that it was imported.
 * Returns the session's id.
 */
export function saveImportedSession(input: ImportedSessionInput): string {
  const id = createSessionId();
  withTransaction((db) => {
    const workspace = ensureWorkspace(input.cwd);
    db.prepare(`
      INSERT INTO sessions (
        id, workspace_id, title, recap_text, recap_model, recap_updated_at, model, mode, cwd_at_start, cwd_last, status, created_at, updated_at
      ) VALUES (?, ?, ?, NULL, NULL, NULL, ?, 'agent', ?, ?, 'active', ?, ?)
    `).run(
      id,
      workspace.id,
      input.title,
      input.model,
      input.cwd,
      input.cwd,
      input.createdAt.toISOString(),
      input.updatedAt.toISOString(),
    );
    const insertMessage = db.prepare(
      "INSERT INTO messages (session_id, seq, role, message_json, created_at) VALUES (?, ?, ?, ?, ?)",
    );
    input.messages.forEach((entry, index) => {
      insertMessage.run(id, index + 1, entry.message.role, JSON.stringify(entry.message), entry.at.toISOString());
    });
    db.prepare(`
      INSERT INTO compactions (session_id, first_kept_seq, summary, tokens_before, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      id,
      input.checkpoint.firstKeptIndex + 1,
      input.checkpoint.summary,
      input.checkpoint.tokensBefore,
      input.updatedAt.toISOString(),
    );
    db.prepare(`
      INSERT INTO session_imports (source, source_id, session_id, source_path, source_updated_at, imported_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(source, source_id) DO UPDATE SET
        session_id = excluded.session_id,
        source_path = excluded.source_path,
        source_updated_at = excluded.source_updated_at,
        imported_at = excluded.imported_at
    `).run(
      input.source,
      input.sourceId,
      id,
      input.sourcePath,
      input.sourceUpdatedAt.toISOString(),
      new Date().toISOString(),
    );
  });
  return id;
}
