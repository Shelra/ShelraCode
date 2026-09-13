/**
 * The intelligence boundary.
 *
 * Shelra's autonomy runtime owns objectives, state, tools, execution, observation,
 * verification and repair. Intelligence is asked discrete questions and answers with
 * structured data. It never drives the loop and never touches the filesystem.
 *
 * Keeping this interface narrow is what makes the runtime provider-agnostic: a future
 * local or third-party provider only has to answer questions, not reimplement autonomy.
 */

/** Which cognitive step is being performed. Used for routing, budgeting and telemetry. */
export type IntelligenceRole =
  | "interpret" // objective -> requirements
  | "acceptance" // requirements -> acceptance criteria
  | "plan" // requirements -> ordered tasks
  | "implement" // task + context -> file edits
  | "diagnose" // failure evidence -> root cause + repair strategy
  | "judge" // artifact + criterion -> pass/fail (only where deterministic checks cannot decide)
  | "summarize";

/**
 * Capability tier requested for a call. The provider maps tiers onto concrete models,
 * so the runtime never hardcodes a vendor model id.
 */
export type IntelligenceTier = "fast" | "balanced" | "deep";

/** Provider-neutral usage accounting. Fields are omitted when the provider cannot report them. */
export interface IntelligenceUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  /** Absent when the provider does not report cost. Never fabricate a value. */
  costUsd?: number;
  costAvailable: boolean;
  durationMs: number;
  turns?: number;
  model?: string;
  /** Why the runtime considered this model eligible, kept for operational observability. */
  routingReasons?: string[];
}

export interface IntelligenceRequest {
  role: IntelligenceRole;
  /** Lean, role-scoped system prompt. Deliberately not a full agent preamble. */
  system: string;
  prompt: string;
  /**
   * JSON Schema describing the required answer shape. When present the provider must
   * return parsed data conforming to it, or fail. Structured answers are what let the
   * deterministic runtime act on intelligence output without parsing prose.
   */
  schema?: Record<string, unknown>;
  tier?: IntelligenceTier;
  maxBudgetUsd?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Working directory context. The provider must not grant filesystem tools from it. */
  cwd?: string;
}

export interface IntelligenceResult<T = unknown> {
  ok: boolean;
  /** Parsed structured output when a schema was supplied. */
  data?: T;
  text: string;
  usage: IntelligenceUsage;
  error?: string;
}

export interface IntelligenceAvailability {
  available: boolean;
  detail: string;
}

export interface IntelligenceProvider {
  readonly id: string;
  /** Cheap, cached check that the provider can actually serve requests on this machine. */
  checkAvailability(): Promise<IntelligenceAvailability>;
  complete<T = unknown>(request: IntelligenceRequest): Promise<IntelligenceResult<T>>;
}

/** Running total of what an objective cost in intelligence. */
export interface IntelligenceLedger {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  costAvailable: boolean;
  byRole: Record<string, { calls: number; costUsd: number }>;
  models: string[];
}

export function emptyLedger(): IntelligenceLedger {
  return { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, costAvailable: true, byRole: {}, models: [] };
}

export function recordUsage(ledger: IntelligenceLedger, role: IntelligenceRole, usage: IntelligenceUsage): void {
  ledger.calls += 1;
  ledger.inputTokens += usage.inputTokens ?? 0;
  ledger.outputTokens += usage.outputTokens ?? 0;
  ledger.models ??= [];
  if (usage.model && !ledger.models.includes(usage.model)) ledger.models.push(usage.model);
  if (usage.costAvailable && typeof usage.costUsd === "number") {
    ledger.costUsd += usage.costUsd;
  } else {
    ledger.costAvailable = false;
  }
  const bucket = ledger.byRole[role] ?? { calls: 0, costUsd: 0 };
  bucket.calls += 1;
  bucket.costUsd += usage.costAvailable ? (usage.costUsd ?? 0) : 0;
  ledger.byRole[role] = bucket;
}
