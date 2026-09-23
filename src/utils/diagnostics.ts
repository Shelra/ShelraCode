import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { getProductUserDir } from "../product/identity";

/**
 * What the resilience rule swallows (audit doc 15, Q2). A failing memory write, checkpoint, index update
 * or recap must never end a turn, but it must not vanish either: each one is appended to
 * `~/.shelra/logs/swallowed-errors.jsonl`, which is rotated at 1 MB with one previous file kept.
 * `SHELRA_DIAGNOSTICS_LOG` names another file, or `off`. Recording never throws, and one area records
 * at most 20 entries per process, so a failure that repeats on every event cannot grow the log.
 */

const MAX_LOG_BYTES = 1_000_000;
const MAX_ENTRIES_PER_AREA = 20;
const MAX_MESSAGE_CHARS = 500;
const recordedByArea = new Map<string, number>();

export function swallowedErrorLogPath(): string | null {
  const configured = process.env.SHELRA_DIAGNOSTICS_LOG?.trim();
  if (configured === "off") return null;
  return configured || join(getProductUserDir(), "logs", "swallowed-errors.jsonl");
}

export function recordSwallowedError(area: string, error: unknown): void {
  try {
    const path = swallowedErrorLogPath();
    if (!path) return;
    const count = (recordedByArea.get(area) ?? 0) + 1;
    recordedByArea.set(area, count);
    if (count > MAX_ENTRIES_PER_AREA) return;
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    const entry = {
      time: new Date().toISOString(),
      area,
      error: message.length > MAX_MESSAGE_CHARS ? `${message.slice(0, MAX_MESSAGE_CHARS)}…` : message,
      ...(error instanceof Error && error.stack
        ? {
            at: error.stack
              .split("\n")
              .slice(1, 4)
              .map((line) => line.trim()),
          }
        : {}),
      ...(count === MAX_ENTRIES_PER_AREA ? { note: "later errors in this area are not recorded by this process" } : {}),
    };
    mkdirSync(dirname(path), { recursive: true });
    try {
      if (statSync(path).size > MAX_LOG_BYTES) renameSync(path, `${path}.1`);
    } catch {
      // No log yet.
    }
    appendFileSync(path, `${JSON.stringify(entry)}\n`, "utf8");
  } catch {
    // Recording a failure must never become a failure of its own.
  }
}
