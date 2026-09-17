import type { ModelMessage } from "ai";
import type { ProviderAdapter, ProviderTimeout } from "../providers/types";
import { containsEncryptedReasoning } from "./reasoning";

export interface CompactionSettings {
  reserveTokens: number;
  keepRecentTokens: number;
}

export interface CutPointResult {
  firstKeptIndex: number;
  turnStartIndex: number;
  isSplitTurn: boolean;
}

export interface PreparedCompaction {
  previousSummary?: string;
  messagesToSummarize: ModelMessage[];
  turnPrefixMessages: ModelMessage[];
  keptMessages: ModelMessage[];
  firstKeptIndex: number;
  isSplitTurn: boolean;
  tokensBefore: number;
  settings: CompactionSettings;
}

const TOOL_RESULT_MAX_CHARS = 2000;
export const MIN_KEPT_TOKENS_ON_RETRY = 4000;

/** Budget used only when no model context window is known (legacy 128K sizing). */
export const DEFAULT_RESERVE_TOKENS = 16_384;
export const DEFAULT_KEEP_RECENT_TOKENS = 20_000;
export const COMPACTION_SUMMARY_HEADER = "[Context checkpoint summary]";

/**
 * Reserve headroom is a share of the *model's* window, not a fixed constant. It
 * only has to cover the model's own output (a local turn emits at most 2048
 * tokens) plus prompt slack. The absolute floor keeps small local windows from
 * reserving less than a normal coding response, and the
 * ceiling stops the reserve from eating the window it is protecting.
 */
export const MIN_RESERVE_TOKENS = 2_048;
const RESERVE_WINDOW_RATIO = 0.15;
const MAX_RESERVE_WINDOW_RATIO = 0.5;

/**
 * The kept-recent budget must stay strictly below the compaction trigger
 * (`contextWindow - reserveTokens`), otherwise compaction can never bring the
 * conversation back under its own threshold and it re-runs on every turn.
 */
export const MIN_KEEP_RECENT_TOKENS = 2_048;
const KEEP_RECENT_WINDOW_RATIO = 0.35;
const KEEP_RECENT_MARGIN_RATIO = 0.1;
const MIN_KEEP_RECENT_MARGIN = 512;

/**
 * `chars / 4` systematically under-counts code, JSON tool payloads and non-ASCII
 * text. Budget decisions apply this margin so the trigger fires before the
 * server rejects the prompt; displayed statistics stay on the raw estimate.
 */
export const CONTEXT_ESTIMATE_MARGIN = 1.15;
export const CONTEXT_TRUNCATION_MARKER = "\n\n[... user prompt truncated by host to fit model context ...]";

const SUMMARIZATION_SYSTEM_PROMPT = `You are a context summarization assistant.

Do not continue the conversation. Do not answer any questions from the conversation.
Only output a structured checkpoint summary that another coding agent can use to continue the work.`;

const SUMMARIZATION_PROMPT = `The messages above are a conversation to summarize. Create a structured context checkpoint summary that another LLM will use to continue the work.

Use this exact format:

## Goal
[What the user is trying to accomplish]

## Constraints & Preferences
- [Requirements, preferences, or constraints]
- [(none) if none were mentioned]

## Progress
### Done
- [x] [Completed work]

### In Progress
- [ ] [Current work]

### Blocked
- [Any active blockers]

## Key Decisions
- **[Decision]**: [Rationale]

## Next Steps
1. [The next action to take]

## Critical Context
- [Important details needed to continue]
- [(none) if not applicable]

Keep it concise, but preserve exact file paths, function names, and error messages.`;

const UPDATE_SUMMARIZATION_PROMPT = `The messages above are new conversation messages to incorporate into the existing summary provided below.

Update the existing structured summary with new information. Rules:
- Preserve still-relevant information from the previous summary
- Add new progress, decisions, and critical context
- Move completed items from "In Progress" to "Done" when appropriate
- Update "Next Steps" based on the current state
- Preserve exact file paths, function names, and error messages

Use the exact same section structure as the existing summary format.`;

const TURN_PREFIX_SUMMARIZATION_PROMPT = `This is the early prefix of a single turn that was too large to keep in full. The recent suffix is still available.

Summarize only what is needed so another coding agent can understand the retained suffix.

Use this exact format:

## Original Request
[What the user asked for in this turn]

## Early Progress
- [Key work done before the kept suffix]

## Context For Suffix
- [Information needed to understand the kept recent messages]`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getTextParts(content: unknown): string[] {
  if (typeof content === "string") return [content];
  if (!Array.isArray(content)) return [];

  const parts: string[] = [];
  for (const part of content) {
    if (!isRecord(part)) continue;
    if (part.type === "text" && typeof part.text === "string") {
      parts.push(part.text);
      continue;
    }
    if (part.type === "reasoning" && typeof part.text === "string") {
      if (!containsEncryptedReasoning(part.text)) {
        parts.push(part.text);
      }
      continue;
    }
    if (part.type === "reasoning" && typeof part.reasoning === "string") {
      if (!containsEncryptedReasoning(part.reasoning)) {
        parts.push(part.reasoning);
      }
    }
  }
  return parts;
}

function stringifyForSummary(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function truncateForSummary(text: string, maxChars = TOOL_RESULT_MAX_CHARS): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[... ${text.length - maxChars} more characters truncated]`;
}

function extractUserContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  const parts: string[] = [];
  for (const part of content) {
    if (!isRecord(part)) continue;
    if (part.type === "text" && typeof part.text === "string") {
      parts.push(part.text);
      continue;
    }
    if (part.type === "image") {
      parts.push("[Image]");
      continue;
    }
    if (part.type === "file") {
      const filename = typeof part.filename === "string" ? part.filename : null;
      parts.push(filename ? `[File: ${filename}]` : "[File]");
    }
  }
  return parts.join("\n");
}

function extractAssistantText(content: unknown): string {
  return getTextParts(content).join("\n");
}

function extractToolCallText(content: unknown): string[] {
  if (!Array.isArray(content)) return [];

  const toolCalls: string[] = [];
  for (const part of content) {
    if (!isRecord(part) || part.type !== "tool-call") continue;
    const toolName = typeof part.toolName === "string" ? part.toolName : "tool";
    const input = isRecord(part.input) ? part.input : {};
    const args = Object.entries(input)
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join(", ");
    toolCalls.push(`${toolName}(${args})`);
  }
  return toolCalls;
}

function extractToolResultText(content: unknown): string[] {
  if (!Array.isArray(content)) return [];

  const toolResults: string[] = [];
  for (const part of content) {
    if (!isRecord(part) || part.type !== "tool-result") continue;
    toolResults.push(truncateForSummary(stringifyForSummary(part.output)));
  }
  return toolResults;
}

export function createCompactionSummaryMessage(summary: string): ModelMessage {
  return {
    role: "system",
    content: `${COMPACTION_SUMMARY_HEADER}\n${summary.trim()}`,
  };
}

/**
 * Appends the CURRENT acceptance criteria verbatim after the LLM-generated prose summary. The
 * summarization model paraphrases everything else (§14 Phase 2 item 3, docs/migration/
 * 14-AGENT-HARNESS-RECONSTRUCTION.md) — fine for prose, but the exact criterion ids, wording, and
 * verification methods must survive a compaction boundary unchanged, since a resumed turn and the
 * completion gate (§9) both need to state/check the SAME criteria the model published, not a
 * compacted-away approximation of them. Deliberately bounded to acceptance criteria only (not
 * full per-step status) — see the Phase 2 item 3 status note for why. A no-op when there's
 * nothing to preserve.
 */
export function appendActiveCriteriaBlock(
  summary: string,
  criteria: ReadonlyArray<{ id: string; description: string; verification: string }> | null,
): string {
  if (!criteria || criteria.length === 0) return summary;
  const block = [
    "",
    "## Active Acceptance Criteria (verbatim — do not paraphrase or drop these)",
    ...criteria.map((c) => `- ${c.id}: ${c.description} (verify: ${c.verification})`),
  ].join("\n");
  return `${summary.trim()}\n${block}`;
}

export function isCompactionSummaryMessage(message: ModelMessage | undefined): boolean {
  return message?.role === "system" && typeof message.content === "string"
    ? message.content.startsWith(COMPACTION_SUMMARY_HEADER)
    : false;
}

export function getCompactionSummaryText(message: ModelMessage | undefined): string | null {
  if (!isCompactionSummaryMessage(message) || typeof message?.content !== "string") {
    return null;
  }
  return message.content.slice(COMPACTION_SUMMARY_HEADER.length).trim();
}

export function estimateMessageTokens(message: ModelMessage): number {
  let chars = 0;

  switch (message.role) {
    case "user":
      chars += extractUserContent(message.content).length;
      break;
    case "assistant":
      chars += extractAssistantText(message.content).length;
      chars += extractToolCallText(message.content).join("; ").length;
      break;
    case "tool":
      chars += extractToolResultText(message.content).join("\n").length;
      break;
    case "system":
      chars +=
        typeof message.content === "string" ? message.content.length : getTextParts(message.content).join("\n").length;
      break;
    default:
      chars += stringifyForSummary((message as { content?: unknown }).content).length;
      break;
  }

  return Math.ceil(chars / 4);
}

export function estimateConversationTokens(systemPrompt: string, messages: ModelMessage[], inFlightText = ""): number {
  const systemTokens = Math.ceil((systemPrompt.length + inFlightText.length) / 4);
  return systemTokens + messages.reduce((sum, message) => sum + estimateMessageTokens(message), 0);
}

/**
 * Keeps an oversized user prompt usable when it is larger than the model's
 * entire context window. The beginning usually contains the request and the
 * ending often contains pasted errors or acceptance criteria, so both are
 * retained around an explicit marker.
 */
export function truncateTextToTokens(text: string, maxTokens: number): string {
  const maxChars = Math.max(1, Math.floor(maxTokens * 4));
  if (text.length <= maxChars) return text;
  if (maxChars <= CONTEXT_TRUNCATION_MARKER.length) {
    return CONTEXT_TRUNCATION_MARKER.slice(0, maxChars);
  }

  const availableChars = maxChars - CONTEXT_TRUNCATION_MARKER.length;
  const headChars = Math.ceil(availableChars / 2);
  const tailChars = Math.floor(availableChars / 2);
  return `${text.slice(0, headChars)}${CONTEXT_TRUNCATION_MARKER}${tailChars > 0 ? text.slice(-tailChars) : ""}`;
}

/** Returns a request-only copy; the full user message remains persisted. */
export function truncateUserMessageToTokens(message: ModelMessage, maxTokens: number): ModelMessage {
  if (message.role !== "user") return message;

  if (typeof message.content === "string") {
    const content = truncateTextToTokens(message.content, maxTokens);
    return content === message.content ? message : { ...message, content };
  }

  if (!Array.isArray(message.content)) return message;
  const parts = message.content as unknown as Array<Record<string, unknown>>;
  const textIndex = parts.findIndex((part) => part.type === "text" && typeof part.text === "string");
  if (textIndex < 0) return message;

  // Image/file markers also consume input budget, so leave a small allowance
  // for them before sizing the text portion.
  const content = parts.map((part, index) =>
    index === textIndex
      ? { ...part, text: truncateTextToTokens(String(part.text), Math.max(1, maxTokens - 16)) }
      : part,
  );
  if (content[textIndex]?.text === parts[textIndex]?.text) return message;
  return { ...message, content } as unknown as ModelMessage;
}

/** Raw estimate inflated by the safety margin, for budget decisions only. */
export function budgetedContextTokens(estimatedTokens: number): number {
  return Math.ceil(estimatedTokens * CONTEXT_ESTIMATE_MARGIN);
}

/**
 * Derives a compaction budget from the model's real context window. Returns the
 * legacy constants when the window is unknown so remote defaults are unchanged.
 *
 * Guarantees `keepRecentTokens < contextWindow - reserveTokens` for any window
 * of at least a couple of tokens, which is the invariant that makes compaction
 * able to satisfy its own trigger.
 */
export function compactionSettingsForWindow(contextWindow?: number): CompactionSettings {
  if (contextWindow === undefined || !Number.isFinite(contextWindow) || contextWindow <= 0) {
    return { reserveTokens: DEFAULT_RESERVE_TOKENS, keepRecentTokens: DEFAULT_KEEP_RECENT_TOKENS };
  }

  const reserveCeiling = Math.floor(contextWindow * MAX_RESERVE_WINDOW_RATIO);
  const reserveTokens = Math.min(
    Math.max(MIN_RESERVE_TOKENS, Math.round(contextWindow * RESERVE_WINDOW_RATIO)),
    Math.max(1, reserveCeiling),
  );

  const trigger = contextWindow - reserveTokens;
  const margin = Math.max(MIN_KEEP_RECENT_MARGIN, Math.round(trigger * KEEP_RECENT_MARGIN_RATIO));
  const keepCeiling = Math.max(1, Math.min(trigger - 1, trigger - margin));
  const keepRecentTokens = Math.min(
    Math.max(MIN_KEEP_RECENT_TOKENS, Math.round(contextWindow * KEEP_RECENT_WINDOW_RATIO)),
    keepCeiling,
  );

  return { reserveTokens, keepRecentTokens };
}

export function shouldCompactContext(
  contextTokens: number,
  contextWindow: number,
  settings: CompactionSettings,
): boolean {
  return budgetedContextTokens(contextTokens) > contextWindow - settings.reserveTokens;
}

function isValidCutPoint(message: ModelMessage): boolean {
  return message.role !== "tool";
}

function findTurnStartIndex(messages: ModelMessage[], entryIndex: number, startIndex: number): number {
  for (let i = entryIndex; i >= startIndex; i--) {
    if (messages[i]?.role === "user") {
      return i;
    }
  }
  return -1;
}

export function findCutPoint(messages: ModelMessage[], startIndex: number, keepRecentTokens: number): CutPointResult {
  const cutPoints: number[] = [];
  for (let i = startIndex; i < messages.length; i++) {
    if (isValidCutPoint(messages[i])) {
      cutPoints.push(i);
    }
  }

  if (cutPoints.length === 0) {
    return { firstKeptIndex: startIndex, turnStartIndex: -1, isSplitTurn: false };
  }

  let accumulatedTokens = 0;
  let cutIndex = cutPoints[0];

  for (let i = messages.length - 1; i >= startIndex; i--) {
    accumulatedTokens += estimateMessageTokens(messages[i]);
    if (accumulatedTokens >= keepRecentTokens) {
      cutIndex = cutPoints.find((index) => index >= i) ?? cutPoints[cutPoints.length - 1];
      break;
    }
  }

  const cutMessage = messages[cutIndex];
  const isUserMessage = cutMessage?.role === "user";
  const turnStartIndex = isUserMessage ? -1 : findTurnStartIndex(messages, cutIndex, startIndex);

  return {
    firstKeptIndex: cutIndex,
    turnStartIndex,
    isSplitTurn: !isUserMessage && turnStartIndex !== -1,
  };
}

export function prepareCompaction(
  messages: ModelMessage[],
  systemPrompt: string,
  settings: CompactionSettings,
): PreparedCompaction | null {
  const previousSummary = getCompactionSummaryText(messages[0]) ?? undefined;
  const boundaryStart = previousSummary ? 1 : 0;
  if (boundaryStart >= messages.length) {
    return null;
  }

  const cutPoint = findCutPoint(messages, boundaryStart, settings.keepRecentTokens);
  const historyEnd = cutPoint.isSplitTurn ? cutPoint.turnStartIndex : cutPoint.firstKeptIndex;
  const messagesToSummarize = messages.slice(boundaryStart, Math.max(boundaryStart, historyEnd));
  const turnPrefixMessages = cutPoint.isSplitTurn
    ? messages.slice(cutPoint.turnStartIndex, cutPoint.firstKeptIndex)
    : [];
  const keptMessages = messages.slice(cutPoint.firstKeptIndex);
  const tokensBefore = estimateConversationTokens(systemPrompt, messages);

  if (keptMessages.length === 0) {
    return null;
  }

  if (messagesToSummarize.length === 0 && turnPrefixMessages.length === 0) {
    return null;
  }

  return {
    previousSummary,
    messagesToSummarize,
    turnPrefixMessages,
    keptMessages,
    firstKeptIndex: cutPoint.firstKeptIndex,
    isSplitTurn: cutPoint.isSplitTurn,
    tokensBefore,
    settings,
  };
}

/**
 * Halves the kept-recent budget for a retry. The 4000-token floor is itself
 * capped at a quarter of the current budget: on a small local window the budget
 * can already start below 4000, and an absolute floor would then refuse to
 * shrink at all and leave the retry ladder spinning on an unchanged cut.
 */
export function relaxCompactionSettings(settings: CompactionSettings): CompactionSettings {
  const floor = Math.min(MIN_KEPT_TOKENS_ON_RETRY, Math.floor(settings.keepRecentTokens / 4));
  return {
    ...settings,
    keepRecentTokens: Math.max(1, Math.max(floor, Math.floor(settings.keepRecentTokens / 2))),
  };
}

export function serializeConversation(messages: ModelMessage[]): string {
  const parts: string[] = [];

  for (const message of messages) {
    if (isCompactionSummaryMessage(message)) {
      const summary = getCompactionSummaryText(message);
      if (summary) {
        parts.push(`[Previous summary]: ${summary}`);
      }
      continue;
    }

    if (message.role === "user") {
      const content = extractUserContent(message.content).trim();
      if (content) parts.push(`[User]: ${content}`);
      continue;
    }

    if (message.role === "assistant") {
      const text = extractAssistantText(message.content).trim();
      const toolCalls = extractToolCallText(message.content);
      if (text) parts.push(`[Assistant]: ${text}`);
      if (toolCalls.length > 0) parts.push(`[Assistant tool calls]: ${toolCalls.join("; ")}`);
      continue;
    }

    if (message.role === "tool") {
      const results = extractToolResultText(message.content);
      for (const result of results) {
        if (result.trim()) parts.push(`[Tool result]: ${result}`);
      }
      continue;
    }

    if (message.role === "system") {
      const content =
        typeof message.content === "string" ? message.content.trim() : getTextParts(message.content).join("\n").trim();
      if (content) parts.push(`[System]: ${content}`);
    }
  }

  return parts.join("\n\n");
}

async function summarizeConversation(
  provider: ProviderAdapter,
  modelId: string,
  messages: ModelMessage[],
  reserveTokens: number,
  customInstructions?: string,
  previousSummary?: string,
  promptOverride?: string,
  signal?: AbortSignal,
  timeout?: ProviderTimeout,
): Promise<string> {
  const serialized = serializeConversation(messages);
  const promptParts = [serialized];

  if (previousSummary) {
    promptParts.push(`Existing summary:\n${previousSummary}`);
  }

  const basePrompt = promptOverride ?? (previousSummary ? UPDATE_SUMMARIZATION_PROMPT : SUMMARIZATION_PROMPT);
  promptParts.push(basePrompt);

  if (customInstructions?.trim()) {
    promptParts.push(`Additional focus: ${customInstructions.trim()}`);
  }

  const { text } = await provider.generateText({
    modelId,
    system: SUMMARIZATION_SYSTEM_PROMPT,
    prompt: promptParts.filter(Boolean).join("\n\n"),
    signal,
    timeout,
    temperature: 0.2,
    maxOutputTokens: Math.max(512, Math.floor(reserveTokens * 0.8)),
  });

  return text.trim();
}

export async function generateCompactionSummary(
  provider: ProviderAdapter,
  modelId: string,
  preparation: PreparedCompaction,
  customInstructions?: string,
  signal?: AbortSignal,
  timeout?: ProviderTimeout,
): Promise<string> {
  const { messagesToSummarize, turnPrefixMessages, isSplitTurn, previousSummary, settings } = preparation;

  if (isSplitTurn && turnPrefixMessages.length > 0) {
    const [historySummary, prefixSummary] = await Promise.all([
      messagesToSummarize.length > 0
        ? summarizeConversation(
            provider,
            modelId,
            messagesToSummarize,
            settings.reserveTokens,
            customInstructions,
            previousSummary,
            undefined,
            signal,
            timeout,
          )
        : Promise.resolve(previousSummary?.trim() || ""),
      summarizeConversation(
        provider,
        modelId,
        turnPrefixMessages,
        settings.reserveTokens,
        undefined,
        undefined,
        TURN_PREFIX_SUMMARIZATION_PROMPT,
        signal,
        timeout,
      ),
    ]);

    if (historySummary && prefixSummary) {
      return `${historySummary}\n\n---\n\n${prefixSummary}`;
    }
    return (historySummary || prefixSummary).trim();
  }

  return summarizeConversation(
    provider,
    modelId,
    messagesToSummarize,
    settings.reserveTokens,
    customInstructions,
    previousSummary,
    undefined,
    signal,
    timeout,
  );
}
