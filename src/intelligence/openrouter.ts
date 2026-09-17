import { OPENROUTER_BASE_URL } from "../models/openrouter";
import { isGuaranteedFree, type ModelPolicy, routeCatalogModel } from "../models/routing";
import type { CatalogEntry } from "../models/types";
import { createOpenRouterProvider } from "../providers/openrouter";
import type { ProviderAdapter, ProviderStructuredResult, ProviderUsage } from "../providers/types";
import type {
  IntelligenceAvailability,
  IntelligenceProvider,
  IntelligenceRequest,
  IntelligenceResult,
  IntelligenceRole,
  IntelligenceUsage,
} from "./types";

const DEFAULT_MAX_RETRIES = 0;
const INPUT_TOKEN_CHARS = 4;
const MAX_MODEL_ATTEMPTS = 3;

const ROLE_OUTPUT_LIMITS: Record<IntelligenceRole, number> = {
  interpret: 6_000,
  acceptance: 6_000,
  plan: 6_000,
  implement: 6_000,
  diagnose: 6_000,
  judge: 2_000,
  summarize: 2_000,
};

const ROLE_TIMEOUT_MS: Record<IntelligenceRole, number> = {
  interpret: 60_000,
  acceptance: 60_000,
  plan: 60_000,
  implement: 120_000,
  diagnose: 120_000,
  judge: 60_000,
  summarize: 60_000,
};

export interface OpenRouterIntelligenceOptions {
  apiKey: string;
  baseURL?: string;
  entries: readonly CatalogEntry[];
  policy?: ModelPolicy;
  /** Preferred runtime model. The router may replace it when it lacks required capabilities. */
  modelId?: string;
  /** Keep every autonomy role on this exact model; required for controlled benchmark runs. */
  strictModel?: boolean;
  /** Cumulative USD ceiling for this objective. Zero is strict zero-cost. */
  maxCostUsd?: number;
  maxRetries?: number;
}

function emptyUsage(model: string, durationMs: number): IntelligenceUsage {
  return {
    costAvailable: false,
    durationMs,
    model,
  };
}

function providerUsage(value: ProviderUsage | undefined): ProviderUsage {
  return value ?? {};
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / INPUT_TOKEN_CHARS));
}

function outputLimit(request: IntelligenceRequest): number {
  const roleLimit = ROLE_OUTPUT_LIMITS[request.role] ?? ROLE_OUTPUT_LIMITS.summarize;
  return Math.max(256, Math.min(roleLimit, request.schema ? roleLimit : 4_000));
}

function estimateCostUsd(
  entry: CatalogEntry | undefined,
  modelId: string,
  prompt: string,
  outputTokens: number,
): number {
  // The free router is explicitly a zero-cost strategy. Its concrete model is
  // selected by OpenRouter after request analysis, so there is no local price
  // to estimate and no paid fallback is inferred here.
  if (modelId === "openrouter/free") return 0;
  if (!entry || entry.cost.pricingKnown === false) return Number.POSITIVE_INFINITY;
  return estimateTokens(prompt) * entry.cost.prompt + outputTokens * entry.cost.completion + (entry.cost.request ?? 0);
}

function costFromUsage(usage: ProviderUsage | undefined): number | undefined {
  const ticks = usage?.costUsdTicks;
  return typeof ticks === "number" && Number.isFinite(ticks) ? Math.max(0, ticks / 1_000_000) : undefined;
}

function mapUsage(
  usage: ProviderUsage | undefined,
  entry: CatalogEntry | undefined,
  modelId: string,
  durationMs: number,
  routingReasons?: string[],
): IntelligenceUsage {
  const normalized = providerUsage(usage);
  const actualCost = costFromUsage(normalized);
  const free = modelId === "openrouter/free" || (entry ? isGuaranteedFree(entry) : false);
  const knownCost = actualCost ?? (free ? 0 : undefined);
  return {
    ...(normalized.inputTokens === undefined ? {} : { inputTokens: normalized.inputTokens }),
    ...(normalized.outputTokens === undefined ? {} : { outputTokens: normalized.outputTokens }),
    ...(knownCost === undefined ? {} : { costUsd: knownCost }),
    costAvailable: actualCost !== undefined || free,
    durationMs,
    turns: 1,
    model: modelId,
    ...(routingReasons && routingReasons.length > 0 ? { routingReasons: [...routingReasons] } : {}),
  };
}

function safeError(error: unknown, apiKey: string): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replaceAll(apiKey, "[redacted]").slice(0, 2_000);
}

/**
 * OpenRouter's provider fallback handles availability, but it cannot repair a
 * model that returns malformed structured output. The intelligence boundary
 * therefore retries a small, capability-filtered candidate set itself. Hard
 * policy failures are never retried as another model.
 */
function canTryAnotherModel(error: unknown, request: IntelligenceRequest): boolean {
  if (request.signal?.aborted) return false;
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return !/(?:budget|api key|unauthori[sz]ed|forbidden|credential|outside the workspace)/u.test(message);
}

async function withTimeout<T>(
  signal: AbortSignal | undefined,
  timeoutMs: number,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const onAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) controller.abort(signal.reason);
  else signal?.addEventListener("abort", onAbort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abortListener: (() => void) | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort(new Error(`Model request timed out after ${timeoutMs}ms.`));
      reject(new Error(`Model request timed out after ${timeoutMs}ms.`));
    }, timeoutMs);
  });
  const cancellation = signal
    ? new Promise<never>((_, reject) => {
        abortListener = () => {
          controller.abort(signal.reason);
          reject(signal.reason instanceof Error ? signal.reason : new Error("Model request cancelled."));
        };
        if (signal.aborted) abortListener();
        else signal.addEventListener("abort", abortListener, { once: true });
      })
    : undefined;
  try {
    const operationResult = operation(controller.signal);
    return await Promise.race([operationResult, timeout, ...(cancellation ? [cancellation] : [])]);
  } finally {
    if (timer) clearTimeout(timer);
    controller.abort();
    signal?.removeEventListener("abort", onAbort);
    if (abortListener) signal?.removeEventListener("abort", abortListener);
  }
}

/**
 * OpenRouter-backed intelligence for the autonomy kernel.
 *
 * The kernel only sees IntelligenceProvider. OpenRouter model ids, canonical
 * id translation, response formats, provider fallbacks and routing controls
 * stay inside this adapter and the provider adapter below it.
 */
export class OpenRouterIntelligenceProvider implements IntelligenceProvider {
  readonly id = "openrouter-intelligence";
  private readonly apiKey: string;
  private readonly baseURL: string;
  private readonly entries: readonly CatalogEntry[];
  private readonly policy: ModelPolicy;
  private readonly preferredModelId?: string;
  private readonly strictModel: boolean;
  private readonly maxCostUsd?: number;
  private readonly maxRetries: number;
  private reservedCostUsd = 0;

  constructor(options: OpenRouterIntelligenceOptions) {
    this.apiKey = options.apiKey.trim();
    this.baseURL = options.baseURL ?? OPENROUTER_BASE_URL;
    this.entries = options.entries;
    this.policy = options.policy ?? "free";
    this.preferredModelId = options.modelId?.trim() || undefined;
    this.strictModel = options.strictModel === true;
    this.maxCostUsd = options.maxCostUsd;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  }

  async checkAvailability(): Promise<IntelligenceAvailability> {
    if (!this.apiKey) return { available: false, detail: "OPENROUTER_API_KEY is not configured." };
    if (this.entries.length === 0 && this.preferredModelId !== "openrouter/free") {
      return { available: false, detail: "The OpenRouter model catalog is empty; refresh it before autonomous work." };
    }
    return {
      available: true,
      detail: `OpenRouter is ready under the ${this.policy} model policy.`,
    };
  }

  async complete<T = unknown>(request: IntelligenceRequest): Promise<IntelligenceResult<T>> {
    const startedAt = Date.now();
    const requestedOutputTokens = outputLimit(request);
    let route: ReturnType<typeof routeCatalogModel>;
    try {
      route = this.resolveRoute(request, requestedOutputTokens);
    } catch (error) {
      return {
        ok: false,
        text: "",
        usage: emptyUsage(this.preferredModelId ?? "unresolved", Date.now() - startedAt),
        error: safeError(error, this.apiKey),
      };
    }

    const candidates = route.candidates.length > 0 ? route.candidates.slice(0, MAX_MODEL_ATTEMPTS) : [route.entry];
    let lastError = "No model produced a usable response.";

    for (let index = 0; index < candidates.length; index += 1) {
      const entry = candidates[index];
      const attemptRoute = entry ? { ...route, modelId: entry.id, entry, candidates: [entry] } : route;
      const maxOutputTokens = Math.min(requestedOutputTokens, entry?.maxOutputTokens ?? requestedOutputTokens);
      const estimatedCost = estimateCostUsd(
        entry,
        attemptRoute.modelId,
        `${request.system}\n${request.prompt}`,
        maxOutputTokens,
      );
      const budgetError = this.checkBudget(estimatedCost, request.maxBudgetUsd);
      if (budgetError) {
        lastError = budgetError;
        if (index === 0 || !canTryAnotherModel(new Error(budgetError), request)) {
          return {
            ok: false,
            text: "",
            usage: mapUsage(undefined, entry, attemptRoute.modelId, Date.now() - startedAt, attemptRoute.reasons),
            error: budgetError,
          };
        }
        continue;
      }

      // Reserve the conservative estimate before dispatch. If a provider omits
      // actual cost, the reservation still prevents later calls from silently
      // crossing the configured objective budget.
      if (Number.isFinite(estimatedCost)) this.reservedCostUsd += estimatedCost;
      const provider = this.createProvider(attemptRoute);
      const timeoutMs = request.timeoutMs && request.timeoutMs > 0 ? request.timeoutMs : ROLE_TIMEOUT_MS[request.role];
      const reservedBefore = this.reservedCostUsd;
      try {
        const result = await withTimeout(request.signal, timeoutMs, async (signal) => {
          if (request.schema) {
            if (!provider.generateStructured) {
              throw new Error(`Selected model ${attemptRoute.modelId} does not expose structured output.`);
            }
            return provider.generateStructured({
              modelId: attemptRoute.modelId,
              system: request.system,
              prompt: request.prompt,
              schema: request.schema,
              schemaName: `shelra_${request.role}`,
              schemaDescription: "Machine-actionable output for Shelra's host-controlled runtime.",
              maxOutputTokens,
              temperature: request.role === "judge" ? 0 : 0.2,
              signal,
            });
          }
          const text = await provider.generateText({
            modelId: attemptRoute.modelId,
            system: request.system,
            prompt: request.prompt,
            maxOutputTokens,
            temperature: 0.2,
            signal,
          });
          return { ...text, data: undefined } satisfies ProviderStructuredResult;
        });
        if (request.schema && result.data === undefined) {
          throw new Error(`Model ${attemptRoute.modelId} returned no structured output.`);
        }
        const usage = mapUsage(
          result.usage,
          entry,
          result.modelId || attemptRoute.modelId,
          Date.now() - startedAt,
          attemptRoute.reasons,
        );
        const actualCost = usage.costUsd;
        if (actualCost !== undefined && Number.isFinite(actualCost)) {
          // The estimate is already reserved. Add only an observed overage so
          // cumulative budget accounting remains conservative across retries.
          this.reservedCostUsd += Math.max(0, actualCost - (this.reservedCostUsd - reservedBefore));
        }
        return {
          ok: true,
          data: result.data as T | undefined,
          text: result.text,
          usage,
        };
      } catch (error) {
        const detail = safeError(error, this.apiKey);
        lastError = `Model ${attemptRoute.modelId}: ${detail}`;
        if (index + 1 >= candidates.length || !canTryAnotherModel(error, request)) {
          return {
            ok: false,
            text: "",
            usage: mapUsage(undefined, entry, attemptRoute.modelId, Date.now() - startedAt, attemptRoute.reasons),
            error: lastError,
          };
        }
      }
    }

    return {
      ok: false,
      text: "",
      usage: mapUsage(undefined, route.entry, route.modelId, Date.now() - startedAt, route.reasons),
      error: lastError,
    };
  }

  private resolveRoute(request: IntelligenceRequest, maxOutputTokens: number) {
    const minimumContext = estimateTokens(`${request.system}\n${request.prompt}`) + maxOutputTokens;
    let preferredRoute: ReturnType<typeof routeCatalogModel> | undefined;
    if (this.preferredModelId) {
      try {
        preferredRoute = routeCatalogModel(this.entries, {
          requestedModel: this.preferredModelId,
          policy: this.policy,
          // Even though this boundary uses structured calls rather than native
          // tool calls, tool support is the strongest catalog signal that a
          // model is suitable for coding-agent work.
          requiresTools: true,
          allowPaid: this.policy !== "free",
          requiresStructuredOutput: Boolean(request.schema),
          minimumContext,
        });
      } catch {
        // A stale or incapable preference should not prevent the general
        // capability router from finding another eligible model.
      }
    }

    if (preferredRoute && (preferredRoute.entry || this.preferredModelId === "openrouter/free")) {
      if (this.strictModel) {
        return {
          ...preferredRoute,
          candidates: preferredRoute.entry ? [preferredRoute.entry] : [],
          reasons: [...preferredRoute.reasons, "strict model control enabled"],
        };
      }
      let alternatives: ReturnType<typeof routeCatalogModel> | undefined;
      try {
        alternatives = routeCatalogModel(this.entries, {
          policy: this.policy,
          requiresTools: true,
          requiresStructuredOutput: Boolean(request.schema),
          minimumContext,
        });
      } catch {
        // An explicitly usable model remains valid when no other model meets the requirements.
      }
      const alternativeCandidates = alternatives?.candidates ?? [];
      const freeRouter = alternativeCandidates.find((candidate) => candidate.id === "openrouter/free");
      const orderedAlternatives = freeRouter
        ? [freeRouter, ...alternativeCandidates.filter((candidate) => candidate.id !== freeRouter.id)]
        : alternativeCandidates;
      const candidates = [
        ...(preferredRoute.entry ? [preferredRoute.entry] : []),
        ...orderedAlternatives.filter((candidate) => candidate.id !== preferredRoute?.modelId),
      ];
      return {
        ...preferredRoute,
        candidates,
        reasons: [...preferredRoute.reasons, ...(candidates.length > 1 ? ["eligible alternatives retained"] : [])],
      };
    }

    return routeCatalogModel(this.entries, {
      policy: this.policy,
      requiresTools: true,
      requiresStructuredOutput: Boolean(request.schema),
      minimumContext,
    });
  }

  private createProvider(route: ReturnType<typeof routeCatalogModel>): ProviderAdapter {
    return createOpenRouterProvider(this.apiKey, {
      modelId: route.modelId,
      entries: this.entries,
      baseURL: this.baseURL,
      maxRetries: this.maxRetries,
      fallbackModels: route.candidates.map((candidate) => candidate.id).slice(0, 3),
      requireParameters: true,
    });
  }

  private checkBudget(estimatedCost: number, requestBudget: number | undefined): string | undefined {
    const limits = [this.maxCostUsd, requestBudget].filter(
      (value): value is number => typeof value === "number" && Number.isFinite(value),
    );
    if (limits.length === 0) return undefined;
    const limit = Math.min(...limits);
    if (!Number.isFinite(estimatedCost)) {
      return "Model request blocked: pricing metadata is unavailable for the selected paid model.";
    }
    if (this.reservedCostUsd + estimatedCost > limit) {
      return `Model request blocked by budget: estimated $${(this.reservedCostUsd + estimatedCost).toFixed(6)} exceeds $${limit.toFixed(6)} allowed.`;
    }
    return undefined;
  }
}

export function createOpenRouterIntelligenceProvider(
  options: OpenRouterIntelligenceOptions,
): OpenRouterIntelligenceProvider {
  return new OpenRouterIntelligenceProvider(options);
}
