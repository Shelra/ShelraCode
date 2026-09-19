import type { ProviderAdapter, ProviderUsage } from "./types";

const TITLE_INSTRUCTIONS = [
  "You are a title generator. Output ONLY a short title. Nothing else.",
  "Rules:",
  "- Single line, <=50 characters",
  "- Use the same language as the user message",
  "- Focus on the main topic or intent",
  "- Keep technical terms, filenames, numbers exact",
  "- Remove filler words and never explain anything",
].join("\n");

const RECAP_INSTRUCTIONS = [
  "You write terse coding-session recaps.",
  "Output ONLY the recap text. No bullets, headings, labels, or preamble.",
  "Rules:",
  "- Maximum 3 sentences total",
  "- Focus on what changed, what remains, and the most useful next step",
  "- Preserve exact file paths, function names, errors, and technical terms",
  "- Never mention being an AI, assistant, or summarizer",
].join("\n");

interface AuxiliaryResult {
  modelId: string;
  usage?: ProviderUsage;
}

export interface GeneratedTitle extends AuxiliaryResult {
  title: string;
}

export interface GeneratedRecap extends AuxiliaryResult {
  recap: string;
}

/** Removes <think> blocks some reasoning models put in their visible text. */
function stripThinking(value: string): string {
  return value
    .replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, "")
    .replace(/<think(?:ing)?>[\s\S]*$/i, "")
    .trim();
}

const REASONING_START =
  /^(?:okay|ok|alright|hmm|let me|let's|i need to|i should|i'll|i will|we need|we must|the user (?:wants|asked|is asking|needs|has asked)|user (?:wants|asked))\b/i;
const REASONING_ANYWHERE =
  /\b(?:let me (?:analy[sz]e|think|see|check|write|create)|the user (?:wants|asked|is asking) me to|i need to (?:write|create|output|produce))\b/i;

/**
 * Reasoning models sometimes think out loud in the visible text ("The user wants me to..."). A title
 * or recap built from that is worse than none, so it is recognised and rejected.
 */
export function looksLikeReasoning(text: string): boolean {
  const trimmed = text.trim();
  return REASONING_START.test(trimmed) || REASONING_ANYWHERE.test(trimmed);
}

/** A usable title, or null: one short line that is not reasoning. */
export function validTitle(value: string | undefined): string | null {
  const line =
    stripThinking(value ?? "")
      .split("\n")
      .map((part) => part.trim())
      .find(Boolean) ?? "";
  // Models sometimes label the answer ("Title: Fix tests"); the label is not part of the title.
  const title = line
    .replace(/^(?:session\s+)?title\s*[:：-]\s*/i, "")
    .replace(/^['"“”`]+|['"“”`.]+$/g, "")
    .trim();
  if (!title || title.length > 60 || title.split(/\s+/).length > 10 || looksLikeReasoning(title)) return null;
  // Tool-call markup or JSON from a model that answered the wrong protocol is never a title.
  if (/^[{[<]/.test(title) || /"\s*:\s*/.test(title)) return null;
  return title;
}

/** When no model title is usable, the first words of what the user asked are a better name than "New session". */
export function fallbackTitle(userMessage: string): string {
  const words = userMessage
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[`*_#>]/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 7);
  const title = words.join(" ");
  if (!title) return "New session";
  return title.length > 50 ? `${title.slice(0, 49).trimEnd()}…` : title;
}

export async function generateTitle(
  provider: ProviderAdapter,
  userMessage: string,
  signal?: AbortSignal,
): Promise<GeneratedTitle> {
  const modelId = provider.defaultModelId ?? provider.resolveModelRuntime("default").modelId;
  try {
    const result = await provider.generateText({
      modelId,
      system: TITLE_INSTRUCTIONS,
      prompt: userMessage,
      timeout: { totalMs: 30_000, stepMs: 30_000, chunkMs: 15_000 },
      signal,
      temperature: 0.5,
      maxOutputTokens: 60,
    });
    return {
      title: validTitle(result.text) ?? fallbackTitle(userMessage),
      modelId: result.modelId,
      usage: result.usage,
    };
  } catch {
    return { title: fallbackTitle(userMessage), modelId };
  }
}

export async function generateRecap(
  provider: ProviderAdapter,
  transcript: string,
  signal?: AbortSignal,
): Promise<GeneratedRecap> {
  const modelId = provider.defaultModelId ?? provider.resolveModelRuntime("default").modelId;
  try {
    const result = await provider.generateText({
      modelId,
      system: RECAP_INSTRUCTIONS,
      prompt: transcript,
      timeout: { totalMs: 10_000, stepMs: 10_000, chunkMs: 5_000 },
      signal,
      temperature: 0.3,
      maxOutputTokens: 120,
    });
    return { recap: normalizeRecap(result.text), modelId: result.modelId, usage: result.usage };
  } catch {
    return { recap: "", modelId };
  }
}

export function normalizeRecap(value: string | undefined): string {
  const normalized = stripThinking(value ?? "")
    .trim()
    .replace(/^['"]|['"]$/g, "")
    .replace(/\s+/g, " ");
  if (!normalized || looksLikeReasoning(normalized)) return "";
  if (
    /\b(we need to output|you need to output|output only|no bullets|no headings|no preamble|existing recap:|session transcript:)\b/i.test(
      normalized,
    )
  ) {
    return "";
  }
  return normalized.length <= 420 ? normalized : `${normalized.slice(0, 417).trimEnd()}...`;
}
