import type { FreeRouteRequest } from "./free-router";

/**
 * What a request needs from the model that serves it, read from the request itself, so Free routing never picks a model
 * that cannot do the work merely because it costs nothing. Opaque message shapes are read defensively: anything not
 * recognised asks for nothing.
 */

function hasContentPart(messages: readonly unknown[], match: (part: Record<string, unknown>) => boolean): boolean {
  for (const message of messages) {
    const content = (message as { content?: unknown } | null)?.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (part && typeof part === "object" && match(part as Record<string, unknown>)) return true;
    }
  }
  return false;
}

/** True when any message carries an image the model must see. */
export function messagesNeedVision(messages: readonly unknown[]): boolean {
  return hasContentPart(messages, (part) => {
    if (part.type === "image") return true;
    const mediaType =
      typeof part.mediaType === "string" ? part.mediaType : typeof part.mimeType === "string" ? part.mimeType : "";
    return part.type === "file" && mediaType.startsWith("image/");
  });
}

const CHARS_PER_TOKEN = 3.5;

/** A cheap upper-ish estimate of the tokens a request occupies, including room for the answer. */
export function estimateRequestTokens(system: string, messages: readonly unknown[], maxOutputTokens?: number): number {
  let chars = system.length;
  for (const message of messages) {
    const content = (message as { content?: unknown } | null)?.content;
    if (typeof content === "string") chars += content.length;
    else if (Array.isArray(content)) {
      for (const part of content) {
        const text = (part as { text?: unknown; input?: unknown; output?: unknown } | null) ?? {};
        if (typeof text.text === "string") chars += text.text.length;
        else chars += JSON.stringify(text.input ?? text.output ?? part ?? "").length;
      }
    }
  }
  return Math.ceil(chars / CHARS_PER_TOKEN) + (maxOutputTokens ?? 4_096);
}

export interface StreamRequirementsInput {
  system: string;
  messages: readonly unknown[];
  tools?: unknown;
  maxOutputTokens?: number;
}

/** What a streamed (tool-using) request asks of its model. */
export function requirementsForStream(input: StreamRequirementsInput): FreeRouteRequest {
  const hasTools =
    input.tools !== undefined && input.tools !== null && Object.keys(input.tools as Record<string, unknown>).length > 0;
  return {
    ...(hasTools ? { requiresTools: true } : {}),
    ...(messagesNeedVision(input.messages) ? { requiresVision: true } : {}),
    minimumContext: Math.ceil(estimateRequestTokens(input.system, input.messages, input.maxOutputTokens) * 1.1),
  };
}
