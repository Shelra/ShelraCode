import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  rmSync,
  statSync,
} from "node:fs";
import { basename, join } from "node:path";
import type { ProcessMessageObserver } from "../agent/agent";
import { getProductUserDir } from "../product/identity";
import type { StreamChunk } from "../types/index";

/**
 * A local record of every turn, in the terminal UI or headless: the request, the model that answered (a fallback, a
 * router's pick), the notices, each tool call with its result and duration, what the memory engine kept, the text and
 * the verdict. `shelra trace` reads it, and `shelra trace --watch` follows every session live, so a session can be
 * diagnosed without anyone pasting it (owner, 2026-09-24). One JSONL file per session under
 * `~/.shelra/logs/sessions/`, kept for 14 days.
 *
 * `SHELRA_TRACE=off` turns it off. `SHELRA_TRACE=verbose` also records the text and the reasoning as they stream,
 * each model step with its tokens, the turn's stages (hooks, context, waiting for the model, checks) and what the
 * user does in the terminal UI (a mode or model switch, Esc, an approval). `SHELRA_TRACE_DIR` (or a folder given as
 * `SHELRA_TRACE`) writes elsewhere. Under a test runner (`NODE_ENV=test`) it is off unless a folder is named. API keys
 * and tokens are redacted, long fields are cut, and nothing leaves the machine. Recording never throws: a trace that
 * cannot be written is skipped.
 */

const KEEP_MS = 14 * 24 * 60 * 60 * 1_000;
const MAX_FIELD_CHARS = 4_000;
const MAX_TEXT_CHARS = 20_000;
const MAX_NOTICE_CHARS = 2_000;
/** In verbose traces, streamed text and reasoning are written once this much has arrived, or this long has passed. */
const STREAM_FLUSH_CHARS = 400;
const STREAM_FLUSH_MS = 1_500;

export interface TraceSettings {
  dir: string;
  verbose: boolean;
}

export function traceSettings(): TraceSettings | null {
  const value = process.env.SHELRA_TRACE?.trim() ?? "";
  if (value.toLowerCase() === "off") return null;
  const verbose = /^(?:verbose|live|full|watch)$/iu.test(value);
  const namedDir = process.env.SHELRA_TRACE_DIR?.trim() || (value && !verbose ? value : "");
  if (namedDir) return { dir: namedDir, verbose };
  if (process.env.NODE_ENV === "test") return null;
  return { dir: join(getProductUserDir(), "logs", "sessions"), verbose };
}

export function traceDir(): string | null {
  return traceSettings()?.dir ?? null;
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

export type TraceKind =
  | "turn"
  | "model"
  | "notice"
  | "text"
  | "thinking"
  | "step"
  | "status"
  | "tool"
  | "result"
  | "memory"
  | "recall"
  | "ui"
  | "error"
  | "end";

export interface TraceEvent {
  time: string;
  session: string;
  kind: TraceKind;
  [field: string]: unknown;
}

function sessionName(sessionId: string | null): string {
  return (sessionId ?? `process-${process.pid}`).replace(/[^A-Za-z0-9_-]/gu, "") || "session";
}

function append(dir: string, session: string, kind: TraceKind, fields: Record<string, unknown>): void {
  try {
    mkdirSync(dir, { recursive: true });
    prune(dir);
    const event: TraceEvent = { time: new Date().toISOString(), session, kind, ...fields };
    appendFileSync(join(dir, `${session}.jsonl`), `${JSON.stringify(event)}\n`, "utf8");
  } catch {
    // A trace that cannot be written is skipped.
  }
}

/**
 * Something the user did in the terminal UI outside a turn's stream ("mode", "model", "cancel", "approval"): recorded
 * in verbose traces only. Never throws.
 */
export function recordUiEvent(sessionId: string | null, action: string, fields: Record<string, unknown> = {}): void {
  try {
    const settings = traceSettings();
    if (!settings?.verbose) return;
    const clean = Object.fromEntries(
      Object.entries(fields).map(([key, value]) => [
        key,
        typeof value === "string" ? clip(value, MAX_FIELD_CHARS) : value,
      ]),
    );
    append(settings.dir, sessionName(sessionId), "ui", { action, ...clean });
  } catch {
    // Tracing must never affect the UI.
  }
}

export interface TurnTrace {
  chunk(chunk: StreamChunk): void;
  /** Wraps the turn's observer so its events are recorded too; the wrapped one still gets every call. */
  observe(observer: ProcessMessageObserver | undefined): ProcessMessageObserver;
  error(error: unknown): void;
  end(): void;
}

const NOOP: TurnTrace = {
  chunk: () => undefined,
  observe: (observer) => observer ?? {},
  error: () => undefined,
  end: () => undefined,
};

/** Host notes that can run over several lines, such as a verdict that lists its acceptance criteria. */
const MULTILINE_NOTE_RE =
  /^\[(?:Not verified|Not marked complete|Checked by Shelra|Verified|Limited|Paused|Stopped)\b/u;

/**
 * A bracketed host note: a fallback, a pause, a verdict ("[Not verified — …]", "[Checked by Shelra …]"). A verdict
 * that lists its criteria spans lines; it used to go unrecorded, and a turn's trace ended with an earlier notice as its
 * last word (seen live 2026-09-25).
 */
function noticesIn(text: string): string[] {
  const notices: string[] = [];
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = (lines[index] ?? "").replace(/\r$/u, "");
    if (!line.startsWith("[")) continue;
    if (line.endsWith("]") && line.length > 2) {
      notices.push(line);
      continue;
    }
    if (!MULTILINE_NOTE_RE.test(line)) continue;
    const end = lines.findIndex((next, at) => at > index && next.replace(/\r$/u, "").endsWith("]"));
    if (end < 0) continue;
    notices.push(
      lines
        .slice(index, end + 1)
        .map((part) => part.replace(/\r$/u, ""))
        .join("\n"),
    );
    index = end;
  }
  return notices;
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
  const settings = traceSettings();
  if (!settings) return NOOP;
  const { dir, verbose } = settings;
  const session = sessionName(input.sessionId);
  const started = Date.now();
  let text = "";
  let textSince = Date.now();
  let thinking = "";
  let thinkingSince = Date.now();
  let lastNotice = "";
  let verdict = "";
  let tools = 0;
  let failedTools = 0;
  let reasoningChars = 0;
  const toolStarts = new Map<string, number>();
  const write = (kind: TraceKind, fields: Record<string, unknown>) => append(dir, session, kind, fields);
  const flushText = () => {
    // Host notes are recorded as notices already.
    const body = text.replace(/^\[[^\n]*\]$/gmu, "").trim();
    text = "";
    textSince = Date.now();
    if (body) write("text", { text: clip(body, MAX_TEXT_CHARS) });
  };
  const flushThinking = () => {
    const body = thinking.trim();
    thinking = "";
    thinkingSince = Date.now();
    if (body) write("thinking", { text: clip(body, MAX_TEXT_CHARS) });
  };
  const due = (buffer: string, since: number) =>
    buffer.length >= STREAM_FLUSH_CHARS || (buffer.length > 0 && Date.now() - since >= STREAM_FLUSH_MS);
  const guard = (record: () => void) => {
    try {
      record();
    } catch {
      // Tracing must never affect the turn.
    }
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
      guard(() => {
        switch (chunk.type) {
          case "content": {
            const content = chunk.content ?? "";
            if (thinking) flushThinking();
            text += content;
            for (const notice of noticesIn(content)) {
              lastNotice = notice;
              // A note that ends the turn replaces a verdict given before it: a turn cancelled after its checks passed
              // ended cancelled.
              if (
                /^\[(?:Not verified|Not marked complete|Checked by Shelra|Verified|Cancelled|Paused|Limited|Stopped|No response|Error)\b/u.test(
                  notice,
                )
              ) {
                verdict = notice;
              }
              write("notice", { text: clip(notice, MAX_NOTICE_CHARS) });
            }
            if (verbose && due(text, textSince)) flushText();
            break;
          }
          case "reasoning":
            reasoningChars += chunk.content?.length ?? 0;
            if (verbose) {
              thinking += chunk.content ?? "";
              if (due(thinking, thinkingSince)) flushThinking();
            }
            break;
          case "model":
            write("model", {
              model: chunk.modelId,
              ...(chunk.servedModelId ? { served: chunk.servedModelId } : {}),
            });
            break;
          case "tool_calls":
            flushThinking();
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
            const id = chunk.toolCall?.id;
            const startedAt = id ? toolStarts.get(id) : undefined;
            write("result", {
              id,
              name: chunk.toolCall?.function.name,
              success: chunk.toolResult?.success ?? false,
              ...(startedAt ? { durationMs: Date.now() - startedAt } : {}),
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
      });
    },
    observe(observer) {
      const traced: ProcessMessageObserver = {
        onToolStart: (info) => {
          guard(() => toolStarts.set(info.toolCall.id, Date.now()));
          observer?.onToolStart?.(info);
        },
        onToolFinish: (info) => observer?.onToolFinish?.(info),
        onMemory: (info) => {
          guard(() =>
            write("memory", {
              qualified: info.qualified,
              reason: clip(info.reason, MAX_NOTICE_CHARS),
              written: info.written,
              decisions: info.decisions.length,
              ...(info.error ? { error: clip(info.error, MAX_NOTICE_CHARS) } : {}),
            }),
          );
          observer?.onMemory?.(info);
        },
        onMemoryRecall: (info) => {
          guard(() =>
            write("recall", {
              rules: info.rules,
              entries: info.entries.map((entry) => ({
                slug: entry.slug,
                tier: entry.tier,
                score: entry.score,
                reasons: entry.reasons,
              })),
              chars: info.chars,
            }),
          );
          observer?.onMemoryRecall?.(info);
        },
        onStepStart: (info) => {
          if (verbose) guard(() => write("step", { step: info.stepNumber, phase: "start" }));
          observer?.onStepStart?.(info);
        },
        onStepFinish: (info) => {
          if (verbose) {
            guard(() => {
              flushThinking();
              flushText();
              write("step", {
                step: info.stepNumber,
                phase: "finish",
                finishReason: info.finishReason,
                inputTokens: info.usage.inputTokens,
                outputTokens: info.usage.outputTokens,
              });
            });
          }
          observer?.onStepFinish?.(info);
        },
        onStatus: (info) => {
          if (verbose) guard(() => write("status", { stage: info.stage, detail: clip(info.detail, MAX_NOTICE_CHARS) }));
          observer?.onStatus?.(info);
        },
        onError: (info) => {
          guard(() => write("error", { message: clip(info.message, MAX_FIELD_CHARS) }));
          observer?.onError?.(info);
        },
      };
      // Every other hook the caller's observer has is passed through untouched.
      return { ...observer, ...traced };
    },
    error(error) {
      guard(() =>
        write("error", { message: clip(error instanceof Error ? error.message : String(error), MAX_FIELD_CHARS) }),
      );
    },
    end() {
      guard(() => {
        flushThinking();
        flushText();
        write("end", {
          durationMs: Date.now() - started,
          tools,
          failedTools,
          reasoningChars,
          ...(verdict ? { verdict } : lastNotice ? { lastNotice } : {}),
        });
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

/**
 * The events every session in the trace folder recorded since the last call, oldest first: what `shelra trace
 * --watch` prints. `seen` holds how many bytes of each file were already read, so only what a session appended is
 * read again; files that appear later are followed from their first event, and a line still being written waits for
 * the next call.
 */
export function newTraceEvents(seen: Map<string, number>, dir = traceDir()): TraceEvent[] {
  const fresh: TraceEvent[] = [];
  for (const trace of listTraces(dir)) {
    try {
      const size = statSync(trace.path).size;
      const offset = size < (seen.get(trace.path) ?? 0) ? 0 : (seen.get(trace.path) ?? 0);
      if (size === offset) continue;
      const buffer = Buffer.alloc(size - offset);
      const handle = openSync(trace.path, "r");
      try {
        readSync(handle, buffer, 0, buffer.length, offset);
      } finally {
        closeSync(handle);
      }
      const end = buffer.lastIndexOf(10);
      if (end < 0) continue;
      seen.set(trace.path, offset + end + 1);
      for (const line of buffer
        .subarray(0, end + 1)
        .toString("utf8")
        .split("\n")) {
        if (!line.trim()) continue;
        try {
          fresh.push(JSON.parse(line) as TraceEvent);
        } catch {
          // A damaged line is skipped.
        }
      }
    } catch {
      // A file that disappears or cannot be read is skipped this time.
    }
  }
  return fresh.sort((a, b) => a.time.localeCompare(b.time));
}

function oneLine(value: unknown, max: number): string {
  const text = String(value ?? "")
    .replace(/\s+/gu, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function duration(ms: number): string {
  if (ms < 1_000) return `${ms}ms`;
  const seconds = Math.round(ms / 1_000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, "0")}s`;
}

/**
 * One readable line per event; `full` keeps whole fields instead of a line's worth, and `withSession` starts the line
 * with the session it came from (for `--watch`, which follows several).
 */
export function formatTraceEvent(event: TraceEvent, full = false, withSession = false): string {
  const clock = `${withSession ? `[${String(event.session).slice(0, 8)}] ` : ""}${event.time.slice(11, 19)}`;
  const width = full ? Number.POSITIVE_INFINITY : 160;
  const field = (value: unknown) => (full ? String(value ?? "") : oneLine(value, width));
  switch (event.kind) {
    case "turn":
      return [
        `${clock}  ── turn ${event.time.slice(0, 10)} in ${String(event.cwd)} · ${String(event.model)} · ${String(event.mode)}${event.outsideProject ? " · not a project" : ""}`,
        `${clock}  user    ${field(event.request)}`,
      ].join("\n");
    case "model":
      return `${clock}  model   ${String(event.model)}${event.served ? ` → ${String(event.served)}` : ""}`;
    case "notice":
      return `${clock}  notice  ${field(event.text)}`;
    case "text":
      return `${clock}  text    ${field(event.text)}`;
    case "thinking":
      return `${clock}  think   ${field(event.text)}`;
    case "step":
      return event.phase === "finish"
        ? `${clock}  step ${String(event.step)} done  ${String(event.finishReason)} · ${String(event.inputTokens ?? "?")} in / ${String(event.outputTokens ?? "?")} out`
        : `${clock}  step ${String(event.step)}`;
    case "status":
      return `${clock}  status  ${String(event.stage)}: ${field(event.detail)}`;
    case "tool":
      return `${clock}  tool    ${String(event.name)} ${field(event.args)}`;
    case "result":
      return `${clock}  ${event.success ? "  ok" : "  FAIL"}    ${String(event.name)}${event.durationMs !== undefined ? ` (${duration(Number(event.durationMs))})` : ""} ${field(event.error ?? event.output)}`;
    case "recall": {
      const entries = (event.entries as Array<{ slug: string; tier: string; reasons?: string[] }> | undefined) ?? [];
      const shown = entries.filter((entry) => entry.tier === "knowledge");
      const lessons = entries.filter((entry) => entry.tier === "episode").length;
      const listed = entries.filter((entry) => entry.tier === "pointer").length;
      return `${clock}  recall  ${(event.rules as unknown[] | undefined)?.length ?? 0} rules · ${shown.length} entries${listed > 0 ? ` · ${listed} listed` : ""}${lessons > 0 ? ` · ${lessons} past attempts` : ""} · ${String(event.chars ?? 0)} chars${shown.length > 0 ? ` · ${field(shown.map((entry) => `${entry.slug} (${entry.reasons?.[0] ?? "rank"})`).join("; "))}` : ""}`;
    }
    case "memory":
      return `${clock}  memory  ${event.qualified ? `kept ${(event.written as unknown[] | undefined)?.length ?? 0}` : "nothing kept"} · ${field(event.reason)}`;
    case "ui":
      return `${clock}  ui      ${String(event.action)} ${field(JSON.stringify(Object.fromEntries(Object.entries(event).filter(([key]) => !["time", "session", "kind", "action"].includes(key)))))}`;
    case "error":
      return `${clock}  ERROR   ${field(event.message)}`;
    case "end":
      return `${clock}  ── end  ${duration(Number(event.durationMs ?? 0))} · ${String(event.tools)} tools (${String(event.failedTools)} failed)${event.verdict ? ` · ${String(event.verdict)}` : ""}`;
    default:
      return `${clock}  ${String(event.kind)}  ${field(JSON.stringify(event))}`;
  }
}
