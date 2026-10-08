import type { OperationRecord, OperationState, OperationStore } from "../agent/tool-operations";
import { getDatabase } from "./db";

interface Row {
  id: string;
  scope: string;
  fingerprint: string;
  tool_name: string;
  call_id: string;
  state: OperationState;
  summary: string;
}

function requireUpdated(result: unknown): void {
  if (!result || typeof result !== "object" || !("changes" in result) || result.changes !== 1) {
    throw new Error("The operation receipt was not written to its session.");
  }
}

/** Receipts contain no raw arguments or tool output, which may include secrets or large media. */
export function sessionOperationStore(sessionId: string): OperationStore {
  return {
    pending: (scope) => {
      const rows = getDatabase()
        .prepare(
          "SELECT id, scope, fingerprint, tool_name, call_id, state, summary FROM tool_operations WHERE session_id = ? AND scope = ? AND acknowledged = 0 ORDER BY created_at LIMIT 129",
        )
        .all(sessionId, scope) as Row[];
      return rows.map((row) => ({
        id: row.id,
        scope: row.scope,
        fingerprint: row.fingerprint,
        toolName: row.tool_name,
        callId: row.call_id,
        state: row.state,
        summary: row.summary,
      }));
    },
    start: (record: OperationRecord) => {
      const now = new Date().toISOString();
      const result = getDatabase()
        .prepare(
          "INSERT INTO tool_operations (id, session_id, scope, fingerprint, tool_name, call_id, state, summary, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          record.id,
          sessionId,
          record.scope,
          record.fingerprint,
          record.toolName,
          record.callId,
          record.state,
          record.summary,
          now,
          now,
        );
      requireUpdated(result);
    },
    finish: (record: OperationRecord) => {
      const result = getDatabase()
        .prepare(
          "UPDATE tool_operations SET state = ?, summary = ?, updated_at = ? WHERE id = ? AND session_id = ? AND acknowledged = 0",
        )
        .run(record.state, record.summary, new Date().toISOString(), record.id, sessionId);
      requireUpdated(result);
    },
    acknowledge: (id) => {
      const result = getDatabase()
        .prepare("UPDATE tool_operations SET acknowledged = 1, updated_at = ? WHERE id = ? AND session_id = ?")
        .run(new Date().toISOString(), id, sessionId);
      requireUpdated(result);
    },
  };
}
