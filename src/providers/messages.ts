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
      const repaired = repairXmlItemArguments(parsed);
      return repaired ? JSON.stringify(repaired) : null;
    }
  } catch {
    // Treat non-JSON scalar output as a shorthand for the tool's primary
    // string parameter (for example, a raw shell command for `bash`).
  }

  return JSON.stringify(normalizeToolInput(toolName, input));
}

interface XmlElement {
  tag: string;
  body: string;
}

/**
 * Splits `<a>..</a><b>..</b>` into elements, honouring nesting of the same tag name. Returns null
 * when the text is not purely a sequence of elements.
 */
function parseXmlElements(text: string): XmlElement[] | null {
  const elements: XmlElement[] = [];
  let index = 0;
  while (index < text.length) {
    while (index < text.length && /\s/u.test(text[index] as string)) index += 1;
    if (index >= text.length) break;
    const open = /^<([A-Za-z_][\w.-]*)>/u.exec(text.slice(index));
    if (!open) return null;
    const tag = open[1] as string;
    let cursor = index + open[0].length;
    let depth = 1;
    const openTag = `<${tag}>`;
    const closeTag = `</${tag}>`;
    while (depth > 0) {
      const nextOpen = text.indexOf(openTag, cursor);
      const nextClose = text.indexOf(closeTag, cursor);
      if (nextClose === -1) return null;
      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth += 1;
        cursor = nextOpen + openTag.length;
      } else {
        depth -= 1;
        if (depth === 0) {
          elements.push({ tag, body: text.slice(index + open[0].length, nextClose) });
          index = nextClose + closeTag.length;
        } else {
          cursor = nextClose + closeTag.length;
        }
      }
    }
  }
  return elements.length > 0 ? elements : null;
}

function parseXmlValue(text: string): unknown {
  const elements = parseXmlElements(text);
  if (!elements) return text.trim();
  if (elements.every((element) => element.tag === "item")) {
    return elements.map((element) => parseXmlValue(element.body));
  }
  const tags = new Set(elements.map((element) => element.tag));
  if (tags.size !== elements.length) return text.trim();
  return Object.fromEntries(elements.map((element) => [element.tag, parseXmlValue(element.body)]));
}

function repairXmlValue(value: unknown): { value: unknown; changed: boolean } {
  if (typeof value === "string") {
    if (!/^\s*<[A-Za-z_][\w.-]*>[\s\S]*<\/[A-Za-z_][\w.-]*>\s*$/u.test(value)) return { value, changed: false };
    const parsed = parseXmlValue(value);
    return typeof parsed === "string" ? { value, changed: false } : { value: parsed, changed: true };
  }
  if (Array.isArray(value)) {
    let changed = false;
    const items = value.map((item) => {
      const repaired = repairXmlValue(item);
      changed ||= repaired.changed;
      return repaired.value;
    });
    return { value: changed ? items : value, changed };
  }
  if (isObjectRecord(value)) {
    let changed = false;
    const entries = Object.entries(value).map(([key, item]) => {
      const repaired = repairXmlValue(item);
      changed ||= repaired.changed;
      return [key, repaired.value] as const;
    });
    return { value: changed ? Object.fromEntries(entries) : value, changed };
  }
  return { value, changed: false };
}

/**
 * Some OpenAI-compatible upstreams serve models whose native tool-call format is XML-shaped
 * (Qwen3-Coder: `<parameter=steps><item>...</item></parameter>`) and pass the parameter text
 * through as JSON strings, so every array or object argument arrives as `"<item>..</item>"`
 * and fails schema validation (observed live 2026-09-17: three consecutive `generate_plan`
 * rejections, then the model gave up planning). Rebuild the intended JSON when a string is
 * purely such element markup; anything else is left for the schema validator to judge.
 */
export function repairXmlItemArguments(input: Record<string, unknown>): Record<string, unknown> | null {
  const repaired = repairXmlValue(input);
  return repaired.changed ? (repaired.value as Record<string, unknown>) : null;
}

/**
 * Some models hand a JSON *value* where the tool asks for a JSON *string* — `write_file` gets
 * `content: { "User": ... }` instead of the file text, `edit_file` gets an object for
 * `old_string`. Observed six times in one turn (2026-09-17, qwen3-coder writing schema/model.json),
 * after which the model fell back to shell redirection and corrupted the file's encoding. When the
 * tool's own schema says a property is a string, serialize the value instead of rejecting the call.
 */
export function coerceObjectsForStringParameters(
  input: Record<string, unknown>,
  schema: unknown,
): Record<string, unknown> | null {
  const properties = (schema as { properties?: Record<string, unknown> } | undefined)?.properties;
  if (!properties || typeof properties !== "object") return null;
  let changed = false;
  const output: Record<string, unknown> = { ...input };
  for (const [key, value] of Object.entries(input)) {
    if (value === null || typeof value !== "object") continue;
    const property = properties[key] as { type?: unknown; anyOf?: unknown[] } | undefined;
    if (!property) continue;
    const types = new Set<unknown>();
    if (typeof property.type === "string") types.add(property.type);
    if (Array.isArray(property.type)) for (const type of property.type) types.add(type);
    if (Array.isArray(property.anyOf)) {
      for (const option of property.anyOf)
        if (option && typeof option === "object") types.add((option as { type?: unknown }).type);
    }
    if (!types.has("string") || types.has("object") || types.has("array")) continue;
    output[key] = JSON.stringify(value, null, 2);
    changed = true;
  }
  return changed ? output : null;
}
