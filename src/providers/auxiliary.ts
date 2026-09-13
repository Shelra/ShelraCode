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

export async function generateTitle(provider: ProviderAdapter, userMessage: string): Promise<GeneratedTitle> {
  const modelId = provider.defaultModelId ?? provider.resolveModelRuntime("default").modelId;
  try {
    const result = await provider.generateText({
      modelId,
      system: TITLE_INSTRUCTIONS,
      prompt: userMessage,
      temperature: 0.5,
      maxOutputTokens: 60,
    });
    return { title: normalizeTitle(result.text), modelId: result.modelId, usage: result.usage };
  } catch {
    return { title: "New session", modelId };
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
      signal,
      temperature: 0.3,
      maxOutputTokens: 120,
    });
    return { recap: normalizeRecap(result.text), modelId: result.modelId, usage: result.usage };
  } catch {
    return { recap: "", modelId };
  }
}

function normalizeTitle(value: string | undefined): string {
  return (value ?? "").trim().replace(/^['"]|['"]$/g, "") || "New session";
}

export function normalizeRecap(value: string | undefined): string {
  const normalized = (value ?? "")
    .trim()
    .replace(/^['"]|['"]$/g, "")
    .replace(/\s+/g, " ");
  if (!normalized) return "";
  if (
    /\b(we need to output|you need to output|output only|no bullets|no headings|no preamble|existing recap:|session transcript:)\b/i.test(
      normalized,
    )
  ) {
    return "";
  }
  return normalized.length <= 420 ? normalized : `${normalized.slice(0, 417).trimEnd()}...`;
}
