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

/** Converts provider stream envelopes into the stable application event set. */
export async function* normalizeProviderEvents(stream: AsyncIterable<unknown>): AsyncGenerator<ProviderEvent> {
  for await (const raw of stream) {
    const part = record(raw);
    if (!part) continue;
    if (DEBUG_STREAM) traceRawPart(part);
    switch (part.type) {
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
