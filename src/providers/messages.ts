import type { ModelMessage } from "ai";

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * OpenAI-compatible APIs require tool-call arguments to be a JSON object.
 * Smaller models occasionally emit a raw command/path instead of the object
 * described by the tool schema. Keep that malformed output inside the
 * provider boundary and give the runtime a useful, deterministic shape.
 */
export function normalizeToolInput(toolName: string, input: unknown): Record<string, unknown> {
  if (isObjectRecord(input)) {
    return input;
  }

  if (typeof input !== "string") {
    return {};
  }

  const raw = input.trim();
  if (!raw) {
    return {};
  }

  let scalarInput = input;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (isObjectRecord(parsed)) {
      return parsed;
    }
    if (typeof parsed === "string") {
      scalarInput = parsed;
    }
  } catch {
    // Some models emit the value directly instead of JSON. The tool-specific
    // coercions below keep that request valid and let the tool schema/runtime
    // decide whether the value itself is acceptable.
  }

  switch (toolName) {
    case "bash":
      return { command: scalarInput };
    case "read_file":
      return { path: scalarInput };
    case "grep":
      return { pattern: scalarInput };
    case "search_web":
    case "search_x":
      return { query: scalarInput };
    case "open_web":
      return { url: scalarInput };
    default:
      return { value: scalarInput };
  }
}

/**
 * Normalizes assistant tool-call parts in a ModelMessage history. This is
 * used both for the next AI SDK step and before persistence, so an invalid
 * provider response cannot poison the following request or session resume.
 */
export function normalizeModelMessages(messages: readonly ModelMessage[]): ModelMessage[] {
  let changed = false;
  const normalized = messages.map((message) => {
    if (message.role !== "assistant" || !Array.isArray(message.content)) {
      return message;
    }

    const content = message.content.map((part) => {
      if (part.type !== "tool-call" || isObjectRecord(part.input)) {
        return part;
      }

      changed = true;
      return {
        ...part,
        input: normalizeToolInput(part.toolName, part.input),
      };
    }) as typeof message.content;

    return { ...message, content };
  });

  return changed ? normalized : (messages as ModelMessage[]);
}

/**
 * Returns a repaired JSON object for a raw scalar tool argument. A valid JSON
 * object is left to the tool schema validator, because changing it would hide
 * a genuine schema error instead of repairing the protocol envelope.
 */
export function repairToolInput(toolName: string, input: unknown): string | null {
  if (typeof input !== "string" || input.trim() === "") {
    return null;
  }

  try {
    const parsed = JSON.parse(input) as unknown;
    if (isObjectRecord(parsed)) {
      return null;
    }
  } catch {
    // Treat non-JSON scalar output as a shorthand for the tool's primary
    // string parameter (for example, a raw shell command for `bash`).
  }

  return JSON.stringify(normalizeToolInput(toolName, input));
}
