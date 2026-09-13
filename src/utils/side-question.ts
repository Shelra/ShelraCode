import type { ProviderAdapter } from "../providers/types.js";

export interface SideQuestionResult {
  response: string;
  usage?: { totalTokens?: number; inputTokens?: number; outputTokens?: number };
}

const SIDE_QUESTION_SYSTEM = `You are a helpful coding assistant answering a quick side question. The user is in the middle of a coding session and needs a fast, concise answer. Keep your response short and focused — this is a side question, not the main task.

If conversation context is provided below, use it to give a more relevant answer.`;

export async function runSideQuestion(
  question: string,
  provider: ProviderAdapter,
  modelId: string,
  conversationContext: string,
  signal?: AbortSignal,
): Promise<SideQuestionResult> {
  const system = conversationContext
    ? `${SIDE_QUESTION_SYSTEM}\n\n<conversation_context>\n${conversationContext}\n</conversation_context>`
    : SIDE_QUESTION_SYSTEM;

  const { text, usage } = await provider.generateText({
    modelId,
    signal,
    maxOutputTokens: 2048,
    system,
    prompt: question,
  });

  return {
    response: text || "No response generated.",
    usage,
  };
}
