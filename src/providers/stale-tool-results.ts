import type { ModelMessage, ToolResultPart } from "ai";

/**
 * Clears stale tool results from the requests of a long generation, as Anthropic's context editing
 * (`clear_tool_uses`) does for Claude. Every step re-sends the whole history, and a free model
 * without a prompt cache reads all of it again: in field case 002 one round sent 7.4M input
 * tokens, most of them file contents read dozens of steps before. Once the history passes
 * `CLEAR_TRIGGER_CHARS`, results older than the model's last `KEEP_RECENT_STEPS` steps are sent as
 * a short note naming the tool and the size. Only the request changes: the session keeps them whole.
 */
export const CLEAR_TRIGGER_CHARS = 160_000;
/** Anthropic's default keeps the last three tool uses; steps also keep a step's parallel calls together. */
export const KEEP_RECENT_STEPS = 3;
/** A clearing moves the prompt prefix a provider can cache, so it must free at least this much. */
export const CLEAR_AT_LEAST_CHARS = 40_000;
/** Results this small cost little to keep. */
const MIN_CLEARED_CHARS = 1_000;
/** Results that cannot be cheaply redone (a sub-agent, a payment) or that carry the task (the plan). */
const NEVER_CLEARED = new Set(["generate_plan", "task", "delegation_read", "paid_request"]);

/** One generation's clearing: tool results in messages before `boundary` are sent as notes. It only moves forward. */
export interface ToolResultClearing {
  boundary: number;
}

function outputChars(part: ToolResultPart): number {
  return JSON.stringify(part.output ?? "").length;
}

function clearable(part: unknown): part is ToolResultPart {
  const candidate = part as ToolResultPart;
  return (
    candidate?.type === "tool-result" &&
    !NEVER_CLEARED.has(candidate.toolName) &&
    outputChars(candidate) > MIN_CLEARED_CHARS
  );
}

function note(part: ToolResultPart): string {
  const size = Math.max(1, Math.round(outputChars(part) / 1_000));
  return `[Cleared from this request to keep it small: ${part.toolName} returned about ${size}K characters here. Repeat the call if you need them again, unless repeating it would change something.]`;
}

/** Characters that clearing the messages in [from, to) takes out of the request. */
function freedChars(messages: readonly ModelMessage[], from: number, to: number): number {
  let freed = 0;
  for (let index = from; index < to; index += 1) {
    const message = messages[index];
    if (message?.role !== "tool") continue;
    for (const part of message.content) if (clearable(part)) freed += outputChars(part) - note(part).length;
  }
  return freed;
}

/**
 * The messages to send for the next step, with stale results cleared. `state` belongs to one
 * generation; its boundary moves forward only when the request is past the trigger and the move
 * frees at least `CLEAR_AT_LEAST_CHARS`, so the cleared prefix stays the same between clearings.
 * Messages it cannot measure go out unchanged: clearing saves tokens, it must never fail a request.
 */
export function clearStaleToolResults(messages: readonly ModelMessage[], state: ToolResultClearing): ModelMessage[] {
  try {
    return clearFrom(messages, state);
  } catch {
    return messages as ModelMessage[];
  }
}

function clearFrom(messages: readonly ModelMessage[], state: ToolResultClearing): ModelMessage[] {
  // Results from the model's last steps stay, including the ones it has not seen yet.
  let recentFrom = 0;
  for (let index = messages.length - 1, steps = 0; index >= 0; index -= 1) {
    if (messages[index]?.role === "assistant" && ++steps === KEEP_RECENT_STEPS) {
      recentFrom = index;
      break;
    }
  }
  let boundary = Math.min(state.boundary, recentFrom);
  const total = messages.reduce((sum, message) => sum + JSON.stringify(message).length, 0);
  if (
    total - freedChars(messages, 0, boundary) > CLEAR_TRIGGER_CHARS &&
    freedChars(messages, boundary, recentFrom) >= CLEAR_AT_LEAST_CHARS
  ) {
    boundary = recentFrom;
  }
  state.boundary = boundary;
  if (boundary === 0) return messages as ModelMessage[];
  return messages.map((message, index) => {
    if (index >= boundary || message.role !== "tool") return message;
    return {
      ...message,
      content: message.content.map((part) =>
        clearable(part) ? { ...part, output: { type: "text" as const, value: note(part) } } : part,
      ),
    };
  });
}
