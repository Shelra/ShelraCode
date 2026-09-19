import type { ModelInfo, ReasoningEffort, ToolCall } from "../types/index";

/**
 * Provider-neutral usage data. Adapters may omit fields that their protocol
 * does not report.
 */
export interface ProviderUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  costUsdTicks?: number;
}

export interface ProviderModelRuntime {
  modelId: string;
  modelInfo?: ModelInfo;
  reasoningEffort?: "low" | "medium" | "high" | "xhigh";
  prefersResponses?: boolean;
}

/** Provider-neutral timeout policy passed to AI SDK compatible runtimes. */
export interface ProviderTimeout {
  /** Maximum time for the complete generation, including tool steps. */
  totalMs?: number;
  /** Maximum time allowed for one model step. */
  stepMs?: number;
  /** Maximum silence between streamed chunks. */
  chunkMs?: number;
}

export interface ProviderStreamRequest {
  modelId: string;
  system: string;
  /** Messages and tools are opaque at this boundary and owned by the adapter. */
  messages: readonly unknown[];
  tools?: unknown;
  maxSteps: number;
  maxOutputTokens?: number;
  temperature?: number;
  /**
   * When set, forwarded to the underlying model as an explicit reasoning-effort request.
   * Adapters that don't support it (or whose current model doesn't) silently ignore it —
   * callers are expected to have already checked capability before setting this.
   */
  reasoningEffort?: ReasoningEffort;
  timeout?: ProviderTimeout;
  signal?: AbortSignal;
  onStepStart?: (stepNumber: number) => void;
  onStepFinish?: (event: { stepNumber: number; finishReason: string; usage: ProviderUsage }) => void;
  onFinish?: (usage: ProviderUsage) => void;
}

export type ProviderEvent =
  | { type: "text-delta"; text: string }
  | { type: "reasoning-delta"; text: string }
  | { type: "tool-call"; toolCall: ToolCall }
  | { type: "tool-result"; toolCall: ToolCall; output: unknown }
  | { type: "tool-approval-request"; approvalId: string; toolCall: ToolCall }
  | { type: "error"; error: unknown }
  | { type: "abort" };

export interface ProviderStream {
  events: AsyncIterable<ProviderEvent>;
  response: Promise<{ messages: readonly unknown[]; usage?: ProviderUsage }>;
}

export interface ProviderTextRequest {
  modelId: string;
  system: string;
  prompt: string;
  maxOutputTokens?: number;
  temperature?: number;
  timeout?: ProviderTimeout;
  signal?: AbortSignal;
}

export interface ProviderTextResult {
  text: string;
  modelId: string;
  usage?: ProviderUsage;
}

/**
 * Provider-neutral structured generation. The runtime owns the schema; adapters
 * translate it to the provider's native response-format mechanism and validate
 * the returned value before handing it back.
 */
export interface ProviderStructuredRequest {
  modelId: string;
  system: string;
  prompt: string;
  schema: Record<string, unknown>;
  schemaName?: string;
  schemaDescription?: string;
  maxOutputTokens?: number;
  temperature?: number;
  timeout?: ProviderTimeout;
  signal?: AbortSignal;
}

export interface ProviderStructuredResult {
  data: unknown;
  text: string;
  modelId: string;
  usage?: ProviderUsage;
}

export interface ProviderToolContext {
  responseSearch?: (
    query: string,
    toolName: "web_search" | "x_search",
    signal?: AbortSignal,
  ) => Promise<{ success: boolean; output: string }>;
}

/** Provider contract consumed by the application Agent façade. */
export interface ProviderAdapter {
  readonly id: string;
  /** Preferred model for auxiliary title/recap calls. */
  readonly defaultModelId?: string;
  /** Batch execution is an optional provider capability; local adapters do not assume it. */
  readonly supportsBatch?: boolean;
  resolveModelRuntime(modelId: string, options?: { preferResponses?: boolean }): ProviderModelRuntime;
  stream(request: ProviderStreamRequest): ProviderStream;
  generateText(request: ProviderTextRequest): Promise<ProviderTextResult>;
  /** Optional capability; structured-output consumers must check for it. */
  generateStructured?(request: ProviderStructuredRequest): Promise<ProviderStructuredResult>;
  getToolContext(): ProviderToolContext;
  /** Optional human-readable routing decisions made at runtime (e.g. quarantined upstream providers). */
  routingNotes?(): string[];
}
