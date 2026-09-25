import { randomUUID } from "crypto";
import type { AgentMode, SessionInfo, SessionRecap, SessionStatus, WorkspaceInfo } from "../types/index";
import { getDatabase } from "./db";
import { ensureWorkspace } from "./workspaces";

interface SessionRow {
  id: string;
  workspace_id: string;
  title: string | null;
  recap_text: string | null;
  recap_model: string | null;
  recap_updated_at: string | null;
  model: string;
  mode: AgentMode;
  cwd_at_start: string;
  cwd_last: string;
  status: SessionStatus;
  created_at: string;
  updated_at: string;
}

export class SessionStore {
  private readonly workspace: WorkspaceInfo;

  constructor(cwd: string) {
    this.workspace = ensureWorkspace(cwd);
  }

  getWorkspace(): WorkspaceInfo {
    return this.workspace;
  }

  openSession(selector: string | undefined, model: string, mode: AgentMode, cwd: string): SessionInfo {
    if (!selector) {
      return this.createSession(model, mode, cwd);
    }

    if (selector === "latest") {
      const latest = this.getLatestSession();
      return latest ?? this.createSession(model, mode, cwd);
    }

    const session = this.getSessionById(selector);
    if (!session) {
      throw new Error(`Session "${selector}" was not found.`);
    }

    this.touchSession(session.id, cwd);
    return this.getRequiredSession(session.id);
  }

  createSession(model: string, mode: AgentMode, cwd: string): SessionInfo {
    const now = new Date().toISOString();
    const id = createSessionId();
    const db = getDatabase();

    db.prepare(`
      INSERT INTO sessions (
        id, workspace_id, title, recap_text, recap_model, recap_updated_at, model, mode, cwd_at_start, cwd_last, status, created_at, updated_at
      ) VALUES (
        @id, @workspace_id, NULL, NULL, NULL, NULL, @model, @mode, @cwd_at_start, @cwd_last, 'active', @created_at, @updated_at
      )
    `).run({
      id,
      workspace_id: this.workspace.id,
      model,
      mode,
      cwd_at_start: cwd,
      cwd_last: cwd,
      created_at: now,
      updated_at: now,
    });

    return this.getRequiredSession(id);
  }

  getLatestSession(): SessionInfo | null {
    const row = getDatabase()
      .prepare(`
      SELECT id, workspace_id, title, recap_text, recap_model, recap_updated_at, model, mode, cwd_at_start, cwd_last, status, created_at, updated_at
      FROM sessions
      WHERE workspace_id = ?
      ORDER BY updated_at DESC
      LIMIT 1
    `)
      .get(this.workspace.id) as SessionRow | undefined;

    return row ? toSessionInfo(row) : null;
  }

  /**
   * The saved conversations that hold a message, newest first: this folder's by default, every folder's with `all`. Each comes with how
   * many messages it holds and the first thing the user asked, for a conversation that has no title yet.
   */
  listSessions(options: { all?: boolean; limit?: number } = {}): SessionListing[] {
    const rows = getDatabase()
      .prepare(`
      SELECT s.id, s.title, s.model, s.mode, s.cwd_last, s.updated_at, w.canonical_path AS workspace_path,
        (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id) AS message_count,
        (SELECT m.message_json FROM messages m WHERE m.session_id = s.id AND m.role = 'user' ORDER BY m.seq LIMIT 1) AS first_user
      FROM sessions s JOIN workspaces w ON w.id = s.workspace_id
      WHERE EXISTS (SELECT 1 FROM messages m WHERE m.session_id = s.id)${options.all ? "" : " AND s.workspace_id = @workspace_id"}
      ORDER BY s.updated_at DESC
      LIMIT @limit
    `)
      .all({ workspace_id: this.workspace.id, limit: options.limit ?? 20 }) as Array<{
      id: string;
      title: string | null;
      model: string;
      mode: AgentMode;
      cwd_last: string;
      updated_at: string;
      workspace_path: string;
      message_count: number;
      first_user: string | null;
    }>;
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      firstRequest: firstRequestText(row.first_user),
      messages: row.message_count,
      model: row.model,
      mode: row.mode,
      workspace: row.workspace_path,
      updatedAt: new Date(row.updated_at),
    }));
  }

  getSessionById(id: string): SessionInfo | null {
    const row = getDatabase()
      .prepare(`
      SELECT id, workspace_id, title, recap_text, recap_model, recap_updated_at, model, mode, cwd_at_start, cwd_last, status, created_at, updated_at
      FROM sessions
      WHERE id = ?
    `)
      .get(id) as SessionRow | undefined;

    return row ? toSessionInfo(row) : null;
  }

  getRequiredSession(id: string): SessionInfo {
    const session = this.getSessionById(id);
    if (!session) {
      throw new Error(`Session "${id}" was not found.`);
    }
    return session;
  }

  setTitle(id: string, title: string | null): void {
    const now = new Date().toISOString();
    getDatabase()
      .prepare(`
      UPDATE sessions
      SET title = ?, updated_at = ?
      WHERE id = ?
    `)
      .run(title, now, id);
  }

  setRecap(id: string, recap: SessionRecap | null): void {
    const now = new Date().toISOString();
    getDatabase()
      .prepare(`
      UPDATE sessions
      SET recap_text = ?, recap_model = ?, recap_updated_at = ?, updated_at = ?
      WHERE id = ?
    `)
      .run(recap?.text ?? null, recap?.model ?? null, recap?.updatedAt?.toISOString() ?? null, now, id);
  }

  setModel(id: string, model: string): void {
    const now = new Date().toISOString();
    getDatabase()
      .prepare(`
      UPDATE sessions
      SET model = ?, updated_at = ?
      WHERE id = ?
    `)
      .run(model, now, id);
  }

  setMode(id: string, mode: AgentMode): void {
    const now = new Date().toISOString();
    getDatabase()
      .prepare(`
      UPDATE sessions
      SET mode = ?, updated_at = ?
      WHERE id = ?
    `)
      .run(mode, now, id);
  }

  touchSession(id: string, cwd: string): void {
    getDatabase()
      .prepare(`
      UPDATE sessions
      SET cwd_last = ?, updated_at = ?
      WHERE id = ?
    `)
      .run(cwd, new Date().toISOString(), id);
  }
}

export interface SessionListing {
  id: string;
  title: string | null;
  /** The first thing the user asked, on one line; null when the conversation has no user message. */
  firstRequest: string | null;
  messages: number;
  model: string;
  mode: AgentMode;
  workspace: string;
  updatedAt: Date;
}

/** The text of a stored user message, on one line, whatever shape the message was saved in. */
function firstRequestText(messageJson: string | null): string | null {
  if (!messageJson) return null;
  try {
    const message = JSON.parse(messageJson) as { content?: unknown };
    const content = message.content;
    const text =
      typeof content === "string"
        ? content
        : Array.isArray(content)
          ? content
              .map((part) =>
                part && typeof part === "object" && "text" in part ? String((part as { text: unknown }).text) : "",
              )
              .join(" ")
          : "";
    const flat = text.replace(/\s+/gu, " ").trim();
    return flat || null;
  } catch {
    return null;
  }
}

function createSessionId(): string {
  return randomUUID().replace(/-/g, "").slice(0, 12);
}

function toSessionInfo(row: SessionRow): SessionInfo {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    title: row.title,
    recap: toSessionRecap(row),
    model: row.model,
    mode: row.mode,
    cwdAtStart: row.cwd_at_start,
    cwdLast: row.cwd_last,
    status: row.status,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function toSessionRecap(row: SessionRow): SessionRecap | null {
  if (!row.recap_text) {
    return null;
  }

  return {
    text: row.recap_text,
    model: row.recap_model,
    updatedAt: row.recap_updated_at ? new Date(row.recap_updated_at) : null,
  };
}
