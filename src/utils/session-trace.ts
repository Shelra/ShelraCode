import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { getProductUserDir } from "../product/identity";
import type { StreamChunk } from "../types/index";

/**
 * A local record of every turn, in the terminal UI or headless: the request, the model that answered (a fallback, a
 * router's pick), the notices, each tool call and its result, the text and the verdict. `shelra trace` reads it, so
 * a session can be diagnosed without anyone pasting it (owner, 2026-09-24). One JSONL file per session under
 * `~/.shelra/logs/sessions/`, kept for 14 days; `SHELRA_TRACE=off` turns it off and `SHELRA_TRACE=<dir>` writes to
 * another folder. Under a test runner (`NODE_ENV=test`) it is off unless `SHELRA_TRACE` names a folder. API keys
 * and tokens are redacted, long fields are cut, and nothing leaves the machine. Recording never throws: a trace that
 * cannot be written is skipped.
 */

const KEEP_MS = 14 * 24 * 60 * 60 * 1_000;
const MAX_FIELD_CHARS = 4_000;
const MAX_TEXT_CHARS = 20_000;
const MAX_NOTICE_CHARS = 2_000;

export function traceDir(): string | null {
  const configured = process.env.SHELRA_TRACE?.trim();
  if (configured === "off") return null;
  if (configured) return configured;
  return process.env.NODE_ENV === "test" ? null : join(getProductUserDir(), "logs", "sessions");
}

const SECRET_RE =
  /\b(?:sk-(?:or-(?:v1-)?)?[A-Za-z0-9_-]{16,}|gsk_[A-Za-z0-9]{16,}|AIza[0-9A-Za-z_-]{20,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abp]-[A-Za-z0-9-]{10,})|(\bBearer\s+)[A-Za-z0-9._~+/-]{16,}=*/gu;

/** Known key and token shapes replaced by `***`. */
export function redact(text: string): string {
  return text.replace(SECRET_RE, (_match, bearer: string | undefined) => (bearer ? `${bearer}***` : "***"));
}

function clip(text: string, max: number): string {
  const clean = redact(text);
  return clean.length > max ? `${clean.slice(0, max)}… (${clean.length - max} more characters)` : clean;
}

let pruned = false;
function prune(dir: string): void {
  if (pruned) return;
  pruned = true;
  const cutoff = Date.now() - KEEP_MS;
  for (const name of readdirSync(dir)) {
    try {
      if (name.endsWith(".jsonl") && statSync(join(dir, name)).mtimeMs < cutoff) rmSync(join(dir, name));
    } catch {
      // In use or already gone.
    }
  }
}

export interface TraceEvent {
  time: string;
  session: string;
  kind: "turn" | "model" | "notice" | "text" | "tool" | "result" | "error" | "end";
  [field: string]: unknown;
}

export interface TurnTrace {
  chunk(chunk: StreamChunk): void;
  error(error: unknown): void;
  end(): void;
}

const NOOP: TurnTrace = { chunk: () => undefined, error: () => undefined, end: () => undefined };

/** A bracketed host note: a fallback, a pause, a verdict ("[Not verified — …]", "[Checked by Shelra …]"). */
function noticesIn(text: string): string[] {
  return [...text.matchAll(/^\[[^\n]*\]$/gmu)].map((match) => match[0]).filter((line) => line.length > 2);
}

/** Starts the record of one turn; every call on the result is safe to make and never throws. */
export function startTurnTrace(input: {
  sessionId: string | null;
  cwd: string;
  model: string;
  mode: string;
  request: string;
  outsideProject?: boolean;
}): TurnTrace {
  const dir = traceDir();
  if (!dir) return NOOP;
  const session = input.sessionId ?? `process-${process.pid}`;
  const path = join(dir, `${session.replace(/[^A-Za-z0-9_-]/gu, "") || "session"}.jsonl`);
  const started = Date.now();
  let text = "";
  let lastNotice = "";
  let verdict = "";
  let tools = 0;
  let failedTools = 0;
  let reasoningChars = 0;
  const write = (kind: TraceEvent["kind"], fields: Record<string, unknown>) => {
    try {
      mkdirSync(dir, { recursive: true });
      prune(dir);
      const event: TraceEvent = { time: new Date().toISOString(), session, kind, ...fields };
      appendFileSync(path, `${JSON.stringify(event)}\n`, "utf8");
    } catch {
      // A trace that cannot be written is skipped.
    }
  };
  const flushText = () => {
    // Host notes are recorded as notices already.
    const body = text.replace(/^\[[^\n]*\]$/gmu, "").trim();
    text = "";
    if (body) write("text", { text: clip(body, MAX_TEXT_CHARS) });
  };
  write("turn", {
    cwd: input.cwd,
    model: input.model,
    mode: input.mode,
    ...(input.outsideProject === undefined ? {} : { outsideProject: input.outsideProject }),
    request: clip(input.request, MAX_TEXT_CHARS),
  });
  return {
    chunk(chunk) {
      try {
        switch (chunk.type) {
          case "content": {
            const content = chunk.content ?? "";
            text += content;
            for (const notice of noticesIn(content)) {
              lastNotice = notice;
              if (/^\[(?:Not verified|Checked by Shelra|Verified)/u.test(notice)) verdict = notice;
              write("notice", { text: clip(notice, MAX_NOTICE_CHARS) });
            }
            break;
          }
          case "reasoning":
            reasoningChars += chunk.content?.length ?? 0;
            break;
          case "model":
            write("model", {
              model: chunk.modelId,
              ...(chunk.servedModelId ? { served: chunk.servedModelId } : {}),
            });
            break;
          case "tool_calls":
            flushText();
            for (const call of chunk.toolCalls ?? []) {
              write("tool", {
                id: call.id,
                name: call.function.name,
                args: clip(call.function.arguments, MAX_FIELD_CHARS),
              });
            }
            break;
          case "tool_result": {
            tools += 1;
            if (!chunk.toolResult?.success) failedTools += 1;
            write("result", {
              id: chunk.toolCall?.id,
              name: chunk.toolCall?.function.name,
              success: chunk.toolResult?.success ?? false,
              output: clip(chunk.toolResult?.output ?? "", MAX_FIELD_CHARS),
              ...(chunk.toolResult?.error ? { error: clip(chunk.toolResult.error, MAX_FIELD_CHARS) } : {}),
            });
            break;
          }
          case "error":
            write("error", { message: clip(chunk.content ?? "", MAX_FIELD_CHARS) });
            break;
          default:
            break;
        }
      } catch {
        // Tracing must never affect the turn.
      }
    },
    error(error) {
      write("error", { message: clip(error instanceof Error ? error.message : String(error), MAX_FIELD_CHARS) });
    },
    end() {
      flushText();
      write("end", {
        durationMs: Date.now() - started,
        tools,
        failedTools,
        reasoningChars,
        ...(verdict ? { verdict } : lastNotice ? { lastNotice } : {}),
      });
    },
  };
}

/* ── Reading traces (`shelra trace`) ─────────────────────────────────────── */

export interface TraceFile {
  session: string;
  path: string;
  updatedAt: Date;
}

/** The recorded sessions, newest first. */
export function listTraces(dir = traceDir()): TraceFile[] {
  if (!dir || !existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".jsonl"))
    .map((name) => {
      const path = join(dir, name);
      return { session: basename(name, ".jsonl"), path, updatedAt: statSync(path).mtime };
    })
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
}

export function readTrace(path: string): TraceEvent[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as TraceEvent];
      } catch {
        return [];
      }
    });
}

function oneLine(value: unknown, max: number): string {
  const text = String(value ?? "")
    .replace(/\s+/gu, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function duration(ms: number): string {
  const seconds = Math.round(ms / 1_000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, "0")}s`;
}

/** One readable line per event; `full` keeps whole fields instead of a line's worth. */
export function formatTraceEvent(event: TraceEvent, full = false): string {
  const clock = event.time.slice(11, 19);
  const width = full ? Number.POSITIVE_INFINITY : 160;
  const field = (value: unknown) => (full ? String(value ?? "") : oneLine(value, width));
  switch (event.kind) {
    case "turn":
      return [
        `${event.time.slice(0, 10)} ${clock}  ── turn in ${String(event.cwd)} · ${String(event.model)} · ${String(event.mode)}${event.outsideProject ? " · not a project" : ""}`,
        `${clock}  user    ${field(event.request)}`,
      ].join("\n");
    case "model":
      return `${clock}  model   ${String(event.model)}${event.served ? ` → ${String(event.served)}` : ""}`;
    case "notice":
      return `${clock}  notice  ${field(event.text)}`;
    case "text":
      return `${clock}  text    ${field(event.text)}`;
    case "tool":
      return `${clock}  tool    ${String(event.name)} ${field(event.args)}`;
    case "result":
      return `${clock}  ${event.success ? "  ok" : "  FAIL"}    ${String(event.name)} ${field(event.error ?? event.output)}`;
    case "error":
      return `${clock}  ERROR   ${field(event.message)}`;
    case "end":
      return `${clock}  ── end  ${duration(Number(event.durationMs ?? 0))} · ${String(event.tools)} tools (${String(event.failedTools)} failed)${event.verdict ? ` · ${String(event.verdict)}` : ""}`;
    default:
      return `${clock}  ${String(event.kind)}  ${field(JSON.stringify(event))}`;
  }
}
