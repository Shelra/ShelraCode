import type { ToolCall } from "../types/index";
import type { ProviderEvent } from "./types";

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}
function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function toToolCall(part: Record<string, unknown>): ToolCall {
  const input = part.input ?? {};
  let argumentsText = "{}";
  try {
    argumentsText = typeof input === "string" ? input : JSON.stringify(input);
  } catch {
    // Keep malformed provider arguments visible as a valid empty call envelope.
  }
  return {
    id: stringValue(part.toolCallId, ""),
    type: "function",
    function: {
      name: stringValue(part.toolName, "unknown_tool"),
      arguments: argumentsText,
    },
  };
}

const DEBUG_STREAM = Boolean(process.env.SHELRA_DEBUG_STREAM);

/**
 * Raw provider-part tracing for diagnosing model/provider behavior (`SHELRA_DEBUG_STREAM=1`).
 * Deltas are collapsed to their type; structural parts (`finish-step`, `tool-error`, unknown
 * types) are printed with a bounded payload so a silently-ending step is explainable.
 */
function traceRawPart(part: Record<string, unknown>): void {
  const type = String(part.type);
  if (type.endsWith("-delta")) return;
  let detail = "";
  if (type === "finish-step" || type === "finish") {
    detail = ` finishReason=${String(part.finishReason)} usage=${JSON.stringify(part.usage ?? part.totalUsage ?? {})}`;
  } else if (type === "tool-error" || type === "error") {
    detail = ` ${String(part.toolName ?? "")} ${JSON.stringify(part.error ?? "", (_key, value) => (value instanceof Error ? value.message : value)).slice(0, 600)}`;
  } else if (type === "tool-call") {
    detail = ` ${String(part.toolName)}${part.invalid ? " INVALID" : ""} ${JSON.stringify(part.input ?? {}).slice(0, 200)}`;
  } else if (
    type !== "tool-result" &&
    type !== "start" &&
    type !== "start-step" &&
    !type.endsWith("-start") &&
    !type.endsWith("-end")
  ) {
    detail = ` ${JSON.stringify(part).slice(0, 400)}`;
  }
  process.stderr.write(`[stream] ${type}${detail}
`);
}

/** A tool call being written is reported at its start and then every this many characters, not per fragment. */
const TOOL_INPUT_REPORT_CHARS = 2_048;

/** Converts provider stream envelopes into the stable application event set. */
export async function* normalizeProviderEvents(stream: AsyncIterable<unknown>): AsyncGenerator<ProviderEvent> {
  // A model writing a large file sends its arguments in fragments for tens of seconds; they used to be dropped, and the
  // terminal showed "Waiting for the model" while the file was arriving (seen live 2026-09-25).
  const inputs = new Map<string, { toolName: string; head: string; chars: number; reported: number }>();
  for await (const raw of stream) {
    const part = record(raw);
    if (!part) continue;
    if (DEBUG_STREAM) traceRawPart(part);
    switch (part.type) {
      case "tool-input-start": {
        const id = stringValue(part.id, "");
        const toolName = stringValue(part.toolName, "tool");
        inputs.set(id, { toolName, head: "", chars: 0, reported: 0 });
        yield { type: "tool-input", id, toolName, chars: 0 };
        break;
      }
      case "tool-input-delta": {
        const id = stringValue(part.id, "");
        const input = inputs.get(id);
        if (!input) break;
        const delta = stringValue(part.delta, "");
        input.chars += delta.length;
        if (input.head.length < 400) input.head += delta.slice(0, 400 - input.head.length);
        if (input.chars - input.reported >= TOOL_INPUT_REPORT_CHARS) {
          input.reported = input.chars;
          const path = /"(?:path|file_path|filePath)"\s*:\s*"([^"]+)"/u.exec(input.head)?.[1];
          yield { type: "tool-input", id, toolName: input.toolName, ...(path ? { path } : {}), chars: input.chars };
        }
        break;
      }
      case "text-delta":
        yield { type: "text-delta", text: stringValue(part.text, "") };
        break;
      case "reasoning-delta":
        yield { type: "reasoning-delta", text: stringValue(part.text, "") };
        break;
      case "tool-call":
        yield { type: "tool-call", toolCall: toToolCall(part) };
        break;
      case "tool-result":
        yield { type: "tool-result", toolCall: toToolCall(part), output: part.output };
        break;
      case "tool-error": {
        // A tool that threw (or an MCP server that failed) reaches the model as an error result
        // and the generation goes on; the app sees the same thing as a failed result instead of
        // a call that never finishes.
        const error = part.error instanceof Error ? part.error.message : String(part.error ?? "unknown error");
        const message = `${stringValue(part.toolName, "tool")} failed: ${error}`;
        yield {
          type: "tool-result",
          toolCall: toToolCall(part),
          output: { success: false, output: message, error: message },
        };
        break;
      }
      case "tool-approval-request": {
        const call = record(part.toolCall) ?? part;
        yield {
          type: "tool-approval-request",
          approvalId: stringValue(part.approvalId, ""),
          toolCall: toToolCall({
            toolCallId: call.toolCallId,
            toolName: call.toolName,
            input: call.input,
          }),
        };
        break;
      }
      case "error":
        yield { type: "error", error: part.error };
        break;
      case "abort":
        yield { type: "abort" };
        break;
    }
  }
}

/** Raised into the stream when the provider sends nothing for longer than the idle budget. */
export class ProviderStreamIdleError extends Error {
  readonly idleMs: number;
  constructor(idleMs: number) {
    super(`The model stream sent nothing for ${Math.round(idleMs / 1000)}s; the request was aborted.`);
    this.name = "ProviderStreamIdleError";
    this.idleMs = idleMs;
  }
}

export function isProviderStreamIdleError(error: unknown): error is ProviderStreamIdleError {
  return (
    error instanceof ProviderStreamIdleError || (error as { name?: string } | null)?.name === "ProviderStreamIdleError"
  );
}

const DEFAULT_STREAM_IDLE_MS = 180_000;

/** Idle budget between stream parts: SHELRA_STREAM_IDLE_MS, 0 to disable, default 3 minutes. */
export function streamIdleTimeoutMs(): number {
  const raw = process.env.SHELRA_STREAM_IDLE_MS;
  if (raw === undefined || raw.trim() === "") return DEFAULT_STREAM_IDLE_MS;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_STREAM_IDLE_MS;
}

/**
 * Cuts a provider stream that stops producing parts. Seen live 2026-09-17: an upstream
 * provider accepted a request, executed nothing, and kept the connection open; without a
 * watchdog the turn sat idle until the benchmark's 20-minute task timeout. On idle, the
 * controller is aborted (which releases the HTTP request) and one error part is emitted so the
 * caller can retry the step instead of waiting on a response that will never come.
 */
export async function* withIdleWatchdog(
  source: AsyncIterable<unknown>,
  idleMs: number,
  controller: AbortController,
): AsyncIterable<unknown> {
  if (idleMs <= 0) {
    yield* source;
    return;
  }
  const iterator = source[Symbol.asyncIterator]();
  try {
    while (true) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const idle = new Promise<{ idle: true }>((resolveIdle) => {
        timer = setTimeout(() => resolveIdle({ idle: true }), idleMs);
      });
      const next = iterator.next().then((result) => ({ idle: false as const, result }));
      // If the timer wins, this pending read settles later (or never); it must not surface as
      // an unhandled rejection when the abort tears the stream down.
      next.catch(() => undefined);
      const outcome = await Promise.race([next, idle]);
      if (timer) clearTimeout(timer);
      if (outcome.idle) {
        const error = new ProviderStreamIdleError(idleMs);
        controller.abort(error);
        yield { type: "error", error };
        return;
      }
      if (outcome.result.done) return;
      yield outcome.result.value;
    }
  } finally {
    // Do not await: a source suspended inside a hung read would never settle its return().
    const closing = iterator.return?.();
    if (closing) closing.catch(() => undefined);
  }
}

/** Minimal view of an AI SDK step for loop detection; only the fields this check reads. */
export interface LoopStepView {
  toolCalls?: ReadonlyArray<{ toolName: string; input: unknown }>;
  toolResults?: ReadonlyArray<{ output?: unknown; result?: unknown }>;
}

const LOOP_WINDOW = 6;

/**
 * True when the last steps only repeat tool calls the turn already made, with identical results.
 * Seen live 2026-09-17 (qwen3-coder-30b, task 01 of the core suite): after finishing, the model
 * emitted "Task complete" summaries each ending in one more `bun test`, `ls` or `read_file`,
 * 96 steps and 250K tokens until the step cap. A step that calls something new, or gets a new
 * result, is progress and never trips this; six consecutive steps of pure repetition do.
 */
export function isRepeatingToolLoop(steps: ReadonlyArray<LoopStepView>): boolean {
  if (steps.length < LOOP_WINDOW + 1) return false;
  const signature = (step: LoopStepView): string[] =>
    (step.toolCalls ?? []).map((call, index) => {
      const result = step.toolResults?.[index];
      const output = result === undefined ? undefined : (result.output ?? result.result);
      return JSON.stringify([call.toolName, call.input, output]);
    });
  const window = steps.slice(-LOOP_WINDOW);
  const earlier = new Set(steps.slice(0, -LOOP_WINDOW).flatMap(signature));
  return window.every((step) => {
    const calls = signature(step);
    return calls.length > 0 && calls.every((call) => earlier.has(call));
  });
}

/**
 * Tools that only look at something. A step that calls any other tool (a file change, a plan, a sub-agent, a memory
 * write, an MCP tool) is work, whatever it returns.
 */
const OBSERVING_TOOLS: ReadonlySet<string> = new Set([
  "bash",
  "read_file",
  "grep",
  "process_logs",
  "process_list",
  "search_web",
  "open_web",
  "lsp",
  "memory_list",
  "memory_read",
  "delegation_read",
  "delegation_list",
]);
/** Consecutive steps that only looked and found nothing new, after which a generation is stalled. */
export const STALL_WINDOW = 12;
/** A word is three or more letters, digits or underscores, starting with a letter: a changed count or time is not news. */
const WORD_RE = /[A-Za-z_][A-Za-z0-9_]{2,}/gu;

/** The strings in a tool's output, without JSON quoting (an escaped "\n" before a number would read as a word). */
function stringsIn(value: unknown, depth = 0): string[] {
  if (typeof value === "string") return [value];
  if (depth > 4 || value === null || typeof value !== "object") return [];
  const values = Array.isArray(value) ? value : Object.values(value as Record<string, unknown>);
  return values.flatMap((item) => stringsIn(item, depth + 1));
}

/**
 * Watches one generation and reports a stall: `STALL_WINDOW` consecutive steps that only looked (read, searched, ran
 * a command) and whose results held no word the generation had not seen. A piece of a word already seen (a slice cut
 * mid-word) is not new either. Seen live 2026-09-25 (glm-5.3-flash, a requirement audit): a script failed on
 * `undefined.toFixed`, and the model read the failing line in slices, then character by character, for 170 steps,
 * each a different command with a different result, so `isRepeatingToolLoop` never matched; the 15-minute generation
 * timeout ended it, and one host note sent the model back to work.
 */
export function createStallDetector(): (steps: ReadonlyArray<LoopStepView>) => boolean {
  const known = new Set<string>();
  let scanned = 0;
  let idle = 0;
  const learn = (text: string): boolean => {
    let learned = false;
    for (const word of text.match(WORD_RE) ?? []) {
      if (known.has(word)) continue;
      learned = true;
      for (let length = 3; length <= word.length; length += 1) {
        known.add(word.slice(0, length));
        known.add(word.slice(-length));
      }
    }
    return learned;
  };
  return (steps) => {
    for (; scanned < steps.length; scanned += 1) {
      const step = steps[scanned];
      const calls = step?.toolCalls ?? [];
      // What the call itself says (a label it prints, the path it reads) is not news when the result echoes it.
      for (const call of calls) for (const text of stringsIn(call.input)) learn(text);
      let learned = false;
      for (const result of step?.toolResults ?? []) {
        for (const text of stringsIn(result.output ?? result.result)) if (learn(text)) learned = true;
      }
      const onlyLooked = calls.length > 0 && calls.every((call) => OBSERVING_TOOLS.has(call.toolName));
      idle = onlyLooked && !learned ? idle + 1 : 0;
    }
    return idle >= STALL_WINDOW;
  };
}
