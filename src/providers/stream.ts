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

/** Converts provider stream envelopes into the stable application event set. */
export async function* normalizeProviderEvents(stream: AsyncIterable<unknown>): AsyncGenerator<ProviderEvent> {
  for await (const raw of stream) {
    const part = record(raw);
    if (!part) continue;
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
