import type { FetchFunction } from "@ai-sdk/provider-utils";
import { type ModelPolicy, paidModelBlockedMessage } from "../models/routing";
import { type CatalogEntry, catalogEntryToModelInfo } from "../models/types";
import type { CatalogService } from "../routing/catalog-service";
import { classifyFreeEligibility, type FreeAttestations, type FreeEligibility } from "../routing/eligibility";
import { type FreeRouteRequest, planFreeRoutes, upstreamRouteKey } from "../routing/free-router";
import { classifyFailure, type FailureKind, type HealthTracker } from "../routing/health";
import { AUTO_FREE_MODEL_ID, isAutoFreeModel, parseModelRef } from "../routing/model-ref";
import { requirementsForStream } from "../routing/requirements";
import type { ModelInfo } from "../types/index";
import type { ProviderDefinition, ProviderRegistry, ResolveDeps, ServedRoute } from "./registry";
import type {
  ProviderAdapter,
  ProviderEvent,
  ProviderModelRuntime,
  ProviderStream,
  ProviderStreamRequest,
  ProviderStructuredRequest,
  ProviderStructuredResult,
  ProviderTextRequest,
  ProviderTextResult,
  ProviderToolContext,
} from "./types";

/**
 * The adapter every cloud session runs on. It owns three jobs and nothing else:
 *
 * 1. Dispatch: a canonical id (`groq/openai/gpt-oss-120b`) goes to the provider it names, so Mixed mode reaches the
 *    provider the user picked and no other.
 * 2. Free mode: the virtual model `shelra/free` is planned per request over every provider's eligible routes
 *    (`planFreeRoutes`), and each call, whatever model asked for it, is checked against the same classifier first.
 *    A route that is not proven free is refused here, before any provider is contacted; this is the deterministic
 *    guarantee, and it covers titles, recaps, reflection, verification and sub-agents, because they all pass through
 *    this adapter.
 * 3. Health: a failure puts the route (and, for a refused key or a spent quota, its provider) on a cooldown, and a
 *    Free request that fails before producing anything moves to the next route in the same call.
 */

/** Attempts a Free request makes across routes before it hands the failure to the turn's own retry ladder. */
export const MAX_ROUTE_ATTEMPTS = 4;
/** Longest wait for an empty catalog to fill before the first plan. */
const CATALOG_WAIT_MS = 6_000;
/** Cooldowns shorter than this are waited out by the turn's retry; longer ones read as a spent allowance. */
const SHORT_COOLDOWN_MS = 5 * 60_000;
/**
 * Whether the person cancelled (Esc), as opposed to a time budget running out: a route too slow for its budget is a
 * failing route (cooled down, replaced), a cancelled call is nobody's fault.
 */
function cancelledByPerson(signal: AbortSignal | undefined): boolean {
  if (!signal?.aborted) return false;
  const name = (signal.reason as { name?: string } | undefined)?.name;
  return name !== "TimeoutError" && name !== "RoundBudgetExceeded";
}

/** Routes tried early, at most, when every free route is cooling down. */
const PROBE_LIMIT = 4;
const MAX_NOTES = 20;
/** Adapters kept per provider: its two modes, and a spare for a second key. */
const MAX_ADAPTERS_PER_PROVIDER = 4;

export type RoutingEvent =
  | { type: "route"; requested: string; chosen: string; reasons: string[] }
  | { type: "failover"; from: string; to?: string; kind: FailureKind; detail: string }
  | { type: "violation"; route: string; detail: string }
  | { type: "no-route"; detail: string }
  /** No free route was available, so the free routes that failed only in passing are tried again early. */
  | { type: "probe"; detail: string };

export interface RoutingProviderOptions {
  registry: ProviderRegistry;
  catalog: CatalogService;
  health: HealthTracker;
  resolveDeps: () => ResolveDeps;
  /** The session's model mode, read at every call. */
  policy: () => ModelPolicy;
  /** What the user declared about Free eligibility, read at every call. */
  attestations: () => FreeAttestations;
  fetch?: FetchFunction;
  now?: () => number;
  onEvent?: (event: RoutingEvent) => void;
  catalogWaitMs?: number;
}

/** Raised when Free mode has nothing it may run. The turn pauses or waits; it never moves to a paid model. */
export class NoFreeRouteError extends Error {
  constructor(
    message: string,
    readonly retryAfterMs: number | undefined,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "NoFreeRouteError";
  }
}

/** Raised when a model that is not proven free is asked for in Free mode. Phrased so the turn does not retry it. */
export class FreeModeRefusalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FreeModeRefusalError";
  }
}

interface Target {
  /** Canonical id of the route that will run. */
  routeId: string;
  providerId: string;
  adapter: ProviderAdapter;
  /** True when Shelra picked it (`shelra/free`), so a failure may move on to another route. */
  auto: boolean;
  free: boolean;
}

function fallbackInfo(modelId: string, name: string): ModelInfo {
  return {
    id: modelId,
    name,
    contextWindow: 32_768,
    inputPrice: 0,
    outputPrice: 0,
    // Unknown is never zero: a spend limit must not mistake an unlisted model for a free one.
    pricingKnown: false,
    reasoning: false,
    description: "Not in the catalog yet.",
    supportsClientTools: true,
    supportsMaxOutputTokens: true,
    capabilityConfidence: "unknown",
    category: "cloud",
  };
}

export class RoutingProvider implements ProviderAdapter {
  readonly supportsBatch = false;
  /** Marks an adapter that enforces Free mode itself; `Agent.setProvider` wraps one that does not. */
  readonly enforcesFreePolicy = true;
  private readonly adapters = new Map<string, ProviderAdapter>();
  private readonly credentialIndex = new Map<string, number>();
  private readonly freeQuarantine = new Map<string, string>();
  private readonly notes: string[] = [];
  private readonly now: () => number;
  private readonly configCache = new Map<
    string,
    { at: number; configs: ReturnType<ProviderDefinition["resolveConfigs"]> }
  >();
  private lastProvider: string | null = null;
  private lastQuota: { providerId: string; error: unknown } | null = null;
  private lastRouteId: string | null = null;
  private autoRuntime: { stamp: string; runtime: ProviderModelRuntime } | null = null;
  private indexVersion = -1;
  private index = new Map<string, CatalogEntry>();

  constructor(private readonly options: RoutingProviderOptions) {
    this.now = options.now ?? Date.now;
  }

  /** The provider that served or failed most recently; "routing" before any call. */
  get id(): string {
    return this.lastProvider ?? "routing";
  }

  /** Titles and recaps run on whatever free route is best, in either mode: they never cost money. */
  get defaultModelId(): string {
    return AUTO_FREE_MODEL_ID;
  }

  /** The route that answered last, for the status line. */
  lastRoute(): string | null {
    return this.lastRouteId;
  }

  // ── catalog access ────────────────────────────────────────────────────────────────────────────────────────────

  private entries(): readonly CatalogEntry[] {
    return this.options.catalog.snapshot().entries;
  }

  private entryOf(canonical: string): CatalogEntry | undefined {
    const snapshot = this.options.catalog.snapshot();
    if (snapshot.version !== this.indexVersion) {
      this.index = new Map(snapshot.entries.map((entry) => [entry.id.toLowerCase(), entry]));
      this.indexVersion = snapshot.version;
    }
    return this.index.get(canonical.toLowerCase());
  }

  private providerIds(): ReadonlySet<string> {
    return this.options.registry.ids();
  }

  // ── planning ──────────────────────────────────────────────────────────────────────────────────────────────────

  private plan(request: FreeRouteRequest, exclude: ReadonlySet<string>, probeCooling = false) {
    const excludeProviders = new Set(this.freeQuarantine.keys());
    return planFreeRoutes(
      this.entries(),
      { ...request, excludeProviders, excludeRoutes: exclude, now: this.now() },
      { attestations: this.options.attestations(), health: this.options.health, probeCooling },
    );
  }

  private async planWithCatalog(request: FreeRouteRequest, exclude: ReadonlySet<string>) {
    if (this.entries().length === 0)
      await this.options.catalog.whenReady(this.options.catalogWaitMs ?? CATALOG_WAIT_MS);
    let plan = this.plan(request, exclude);
    // A context estimate that no free model satisfies must not leave the turn with nothing: the model may still cope.
    if (plan.routes.length === 0 && request.minimumContext !== undefined) {
      const { minimumContext: _drop, ...relaxed } = request;
      plan = this.plan(relaxed, exclude);
    }
    // Free mode must end a turn with a free model answering whenever one can. If every route is on cooldown, the ones
    // that failed only in passing (a server error, an overloaded model) are tried again now, soonest back first, instead
    // of the turn waiting out the cooldown. Eligibility is untouched, so this can never reach a model that is not free.
    if (plan.routes.length === 0 && plan.rejected.some((item) => item.reason.includes("cooling down"))) {
      let probe = this.plan(request, exclude, true);
      if (probe.routes.length === 0 && request.minimumContext !== undefined) {
        const { minimumContext: _drop, ...relaxed } = request;
        probe = this.plan(relaxed, exclude, true);
      }
      if (probe.routes.length > 0) {
        const routes = probe.routes.slice(0, PROBE_LIMIT);
        this.options.onEvent?.({
          type: "probe",
          detail: `${routes.length} free route(s) tried early: ${routes.map((route) => route.id).join(", ")}`,
        });
        this.note(`every free route was cooling down; trying ${routes[0]?.id} early`);
        return { routes, rejected: probe.rejected };
      }
    }
    return plan;
  }

  private noRoute(plan: ReturnType<RoutingProvider["plan"]>): NoFreeRouteError {
    const configured = this.options.registry.configured(this.options.resolveDeps());
    if (configured.length === 0) {
      const hints = this.options.registry
        .list()
        .map((definition) => `${definition.name}: ${definition.setupHint}`)
        .join("; ");
      return new NoFreeRouteError(
        `No provider is configured, and Free mode uses free models only. Add one: ${hints}.`,
        undefined,
      );
    }
    const cooling = plan.rejected.filter((item) => item.reason.includes("cooling down"));
    if (cooling.length > 0) {
      const remaining = cooling.map((item) => {
        const entry = this.entryOf(item.id);
        if (!entry) return Number.POSITIVE_INFINITY;
        const upstream = entry.state.kind === "cloud" ? entry.state.upstream : undefined;
        return Math.max(
          this.options.health.cooldownRemaining(entry.id, entry.provider),
          upstream ? this.options.health.cooldownRemaining(upstreamRouteKey(upstream), upstreamRouteKey(upstream)) : 0,
        );
      });
      const soonest = Math.min(...remaining);
      const long = soonest > SHORT_COOLDOWN_MS;
      const quota = this.lastQuota;
      const detail = Number.isFinite(soonest) ? ` The soonest comes back in about ${Math.ceil(soonest / 1_000)}s.` : "";
      this.options.onEvent?.({ type: "no-route", detail: `${cooling.length} free route(s) cooling down` });
      return new NoFreeRouteError(
        long
          ? `The free quota is used up on every free route (${cooling.length} cooling down).${detail} Free mode never moves to a paid model.`
          : `Every free route is cooling down after failures (${cooling.length}).${detail}`,
        Number.isFinite(soonest) ? soonest : undefined,
        long ? quota?.error : undefined,
      );
    }
    const unproven = plan.rejected.filter((item) => item.reason.startsWith("not free")).length;
    const hint = unproven > 0 ? ` ${unproven} model(s) are not proven free; \`shelra providers\` says why.` : "";
    this.options.onEvent?.({ type: "no-route", detail: `no eligible free route among ${plan.rejected.length}` });
    // Nothing is cooling down, so waiting changes nothing: the wording lets the turn pause at once.
    return new NoFreeRouteError(
      `No free model satisfies this request right now.${hint} Free mode uses free models only, so nothing was sent.`,
      undefined,
    );
  }

  // ── choosing the route a call runs on ─────────────────────────────────────────────────────────────────────────

  private refusal(
    entry: CatalogEntry | undefined,
    canonical: string,
    eligibility?: FreeEligibility,
  ): FreeModeRefusalError {
    const evidence = eligibility?.evidence ?? "it is not in the catalog, so Shelra cannot tell what it costs";
    // Free mode never runs a paid model, however it is asked for: an explicit pick is no exception.
    return new FreeModeRefusalError(
      eligibility?.level === "paid"
        ? paidModelBlockedMessage(entry?.name ?? canonical)
        : `Free mode uses free models only, and ${entry?.name ?? canonical} is not proven free: ${evidence}. Switch to Mixed (ctrl+f) to use it.`,
    );
  }

  /** The entry for a canonical id, and whether Free mode may run it. */
  private freeCheck(canonical: string): { entry: CatalogEntry | undefined; eligibility: FreeEligibility } {
    const entry = this.entryOf(canonical);
    if (!entry) {
      // OpenRouter's free router needs no catalog: it answers with free models only.
      if (canonical.toLowerCase() === "openrouter/free") {
        return {
          entry: undefined,
          eligibility: {
            level: "guaranteed-free",
            eligible: true,
            evidence: "OpenRouter's free router answers with free models only",
          },
        };
      }
      return {
        entry: undefined,
        eligibility: {
          level: "unknown",
          eligible: false,
          evidence: "it is not in the catalog, so Shelra cannot tell what it costs",
        },
      };
    }
    const providerId = entry.provider;
    const quarantined = this.freeQuarantine.get(providerId);
    if (quarantined) {
      return { entry, eligibility: { level: "unknown", eligible: false, evidence: quarantined } };
    }
    return { entry, eligibility: classifyFreeEligibility(entry, this.options.attestations()) };
  }

  /** Forgets what was read of the environment and the stores: a key was added, replaced or removed while running. */
  resetConfigCache(resetHealth = true): void {
    this.configCache.clear();
    // The adapters hold the keys they were built with, and a key refused earlier left its provider cooling down for
    // hours ("skipped until reconfigured"): a reconfigured provider must start clean, or the new key is never tried.
    // A provider taken out of Free mode for billing (freeQuarantine) stays out: a new key does not change that.
    this.adapters.clear();
    this.credentialIndex.clear();
    if (resetHealth) this.options.health.reset();
  }

  /** A provider's configurations, read from the environment and the stores at most every 30 seconds. */
  private configsOf(definition: ProviderDefinition): ReturnType<ProviderDefinition["resolveConfigs"]> {
    const cached = this.configCache.get(definition.id);
    if (cached && this.now() - cached.at < 30_000) return cached.configs;
    const configs = definition.resolveConfigs(this.options.resolveDeps());
    this.configCache.set(definition.id, { at: this.now(), configs });
    return configs;
  }

  private adapterFor(providerId: string): ProviderAdapter {
    const definition = this.options.registry.get(providerId);
    if (!definition) throw new Error(`Unknown provider "${providerId}".`);
    const configs = this.configsOf(definition);
    if (configs.length === 0) {
      throw new Error(`${definition.name} is not configured: ${definition.setupHint}.`);
    }
    const index = Math.min(this.credentialIndex.get(providerId) ?? 0, configs.length - 1);
    const config = configs[index] as (typeof configs)[number];
    const policy = this.options.policy();
    const key = `${providerId}:${policy}:${index}:${config.baseURL}:${config.source}`;
    let adapter = this.adapters.get(key);
    if (adapter) {
      // Most recently used last, so the oldest is the one dropped.
      this.adapters.delete(key);
      this.adapters.set(key, adapter);
      return adapter;
    }
    adapter = definition.createAdapter(config, {
      policy: this.options.policy,
      entries: () => this.options.catalog.entriesOf(providerId),
      ...(this.options.fetch ? { fetch: this.options.fetch } : {}),
      onServed: (routeId, served) => this.checkServed(routeId, served),
    });
    this.adapters.set(key, adapter);
    // One adapter per mode and key a provider has seen, a handful at most: a switch of mode back and forth reuses them.
    const own = [...this.adapters.keys()].filter((existing) => existing.startsWith(`${providerId}:`));
    for (const stale of own.slice(0, Math.max(0, own.length - MAX_ADAPTERS_PER_PROVIDER))) this.adapters.delete(stale);
    return adapter;
  }

  private async resolve(requested: string, request: FreeRouteRequest, exclude: ReadonlySet<string>): Promise<Target> {
    const policy = this.options.policy();
    if (isAutoFreeModel(requested)) {
      const plan = await this.planWithCatalog(request, exclude);
      let lastError: unknown;
      for (const route of plan.routes) {
        try {
          const adapter = this.adapterFor(route.providerId);
          this.options.onEvent?.({ type: "route", requested, chosen: route.id, reasons: route.reasons });
          return { routeId: route.id, providerId: route.providerId, adapter, auto: true, free: true };
        } catch (error) {
          lastError = error;
          this.options.health.recordFailure(route.id, route.providerId, { kind: "credentials" });
        }
      }
      if (lastError && plan.routes.length > 0) {
        throw new NoFreeRouteError(
          `No free provider could be reached: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
          undefined,
        );
      }
      throw this.noRoute(plan);
    }

    const ref = parseModelRef(requested, this.providerIds());
    const canonical = ref.canonical;
    if (this.options.registry.get(ref.providerId) === undefined) {
      throw new Error(`Unknown provider "${ref.providerId}" in model "${requested}".`);
    }
    let free = false;
    if (policy === "free") {
      if (this.entries().length === 0)
        await this.options.catalog.whenReady(this.options.catalogWaitMs ?? CATALOG_WAIT_MS);
      const { entry, eligibility } = this.freeCheck(canonical);
      if (!eligibility.eligible) throw this.refusal(entry, canonical, eligibility);
      free = true;
    }
    const adapter = this.adapterFor(ref.providerId);
    this.options.onEvent?.({ type: "route", requested, chosen: canonical, reasons: ["explicitly selected"] });
    return { routeId: canonical, providerId: ref.providerId, adapter, auto: false, free };
  }

  // ── what happened ─────────────────────────────────────────────────────────────────────────────────────────────

  private note(text: string): void {
    this.notes.push(text);
    if (this.notes.length > MAX_NOTES) this.notes.shift();
  }

  private succeeded(target: Target, startedAt: number): void {
    this.lastProvider = target.providerId;
    this.lastRouteId = target.routeId;
    this.options.health.recordSuccess(target.routeId, target.providerId, this.now() - startedAt);
  }

  /** Records a failed attempt and returns the error the turn should see, and what kind of failure it was. */
  private failed(target: Target, error: unknown): { error: unknown; kind: FailureKind } {
    this.lastProvider = target.providerId;
    const failure = classifyFailure(target.providerId, error, new Date(this.now()));
    this.options.health.recordFailure(target.routeId, target.providerId, failure);
    const upstream = this.entryOf(target.routeId)?.state;
    if (
      upstream?.kind === "cloud" &&
      upstream.upstream &&
      (failure.kind === "quota" || failure.kind === "rate-limit")
    ) {
      // A gateway forwarding to a provider that is out would fail the same way for every model that goes there.
      this.options.health.recordFailure(
        upstreamRouteKey(upstream.upstream),
        upstreamRouteKey(upstream.upstream),
        failure,
      );
    }
    if (failure.kind === "quota") this.lastQuota = { providerId: target.providerId, error };
    const cooldown = this.options.health.cooldownRemaining(target.routeId, target.providerId);
    this.options.onEvent?.({
      type: "failover",
      from: target.routeId,
      kind: failure.kind,
      detail: `${Math.ceil(cooldown / 1_000)}s cooldown`,
    });
    this.note(`${target.routeId}: ${failure.kind}, skipped for ${Math.ceil(cooldown / 1_000)}s`);
    if (failure.kind === "credentials") {
      const definition = this.options.registry.get(target.providerId);
      const count = definition ? this.configsOf(definition).length : 0;
      const next = (this.credentialIndex.get(target.providerId) ?? 0) + 1;
      if (next < count) {
        // Another key of the same provider may work: use it from the next call and do not cool the provider down.
        this.credentialIndex.set(target.providerId, next);
        this.options.health.reset(target.providerId);
      }
      // In Free auto mode a refused key must not read as the session's key being wrong: another provider can answer.
      if (target.auto) {
        return {
          kind: failure.kind,
          error: new Error(
            `${definition?.name ?? target.providerId} refused its key; it is skipped until it is reconfigured (\`shelra auth ${target.providerId}\`).`,
            { cause: error },
          ),
        };
      }
    }
    return { error, kind: failure.kind };
  }

  /** What to tell the user when a route fails and the request moves on. */
  private describeSwitch(from: string, kind: FailureKind, to: string): string {
    const what: Record<FailureKind, string> = {
      "rate-limit": "is rate limited",
      quota: "has no free quota left",
      unavailable: "is not answering",
      "model-unavailable": "cannot serve this request",
      credentials: "refused its key",
      other: "failed",
    };
    return `${from} ${what[kind]}; switching to ${to}${this.options.policy() === "free" ? " (free)" : ""}`;
  }

  /**
   * The cost or the route a provider reports after an answer. A Free request that was charged, or answered by a
   * different provider than the gateway entry names, or by a model known not to be free, is a violation: the provider
   * leaves Free mode for the session. This detects after the fact; prevention is the eligibility check before the call.
   */
  private checkServed(routeId: string, served: ServedRoute): void {
    if (this.options.policy() !== "free") return;
    const entry = this.entryOf(routeId);
    const providerId = entry?.provider ?? parseModelRef(routeId, this.providerIds()).providerId;
    if (served.costUsd !== undefined && served.costUsd > 0) {
      this.violation(providerId, routeId, `the provider reported a cost of $${served.costUsd} for a Free request`);
      return;
    }
    const upstream = entry?.state.kind === "cloud" ? entry.state.upstream : undefined;
    if (upstream && served.servedProviderId && served.servedProviderId !== upstream) {
      this.violation(providerId, routeId, `it forwarded to ${served.servedProviderId} instead of ${upstream}`);
      return;
    }
    if (served.servedModelId) {
      const canonical = `${providerId}/${served.servedModelId}`.toLowerCase();
      const servedEntry = this.entryOf(canonical);
      // A model the catalog knows and does not prove free; an id it does not know is only a dated variant or a rename.
      if (
        servedEntry &&
        canonical !== routeId.toLowerCase() &&
        !classifyFreeEligibility(servedEntry, this.options.attestations()).eligible
      ) {
        this.violation(providerId, routeId, `it answered with ${canonical}, which is not proven free`);
      }
    }
  }

  private violation(providerId: string, routeId: string, detail: string): void {
    const reason = `a Free request to ${routeId} was served unexpectedly: ${detail}`;
    this.freeQuarantine.set(providerId, reason);
    this.options.onEvent?.({ type: "violation", route: routeId, detail });
    this.note(`${providerId} left out of Free mode for this session: ${detail}`);
  }

  /** Whether a step's own report shows paid inference or a model that was not proven free. */
  private checkStep(
    target: Target,
    event: { servedModelId?: string; servedProviderId?: string; usage: { costUsdTicks?: number } },
  ): void {
    if (this.options.policy() !== "free") return;
    const cost = event.usage.costUsdTicks;
    this.checkServed(target.routeId, {
      ...(cost !== undefined && cost > 0 ? { costUsd: cost / 1_000_000 } : {}),
      ...(event.servedProviderId ? { servedProviderId: event.servedProviderId } : {}),
      ...(event.servedModelId && event.servedModelId.toLowerCase() !== target.routeId.toLowerCase()
        ? { servedModelId: event.servedModelId.slice(event.servedModelId.indexOf("/") + 1) }
        : {}),
    });
  }

  /**
   * Whether the session may select this model now, with the same checks a call makes: the model picker and `-m` ask
   * here, so a refusal at selection and a refusal at the call can never disagree. Returns the canonical id.
   */
  async checkSelectable(modelId: string): Promise<{ canonical: string }> {
    if (isAutoFreeModel(modelId)) return { canonical: AUTO_FREE_MODEL_ID };
    const ref = parseModelRef(modelId, this.providerIds());
    const definition = this.options.registry.get(ref.providerId);
    if (!definition) throw new Error(`Unknown provider "${ref.providerId}" in model "${modelId}".`);
    if (this.configsOf(definition).length === 0) {
      throw new Error(`${definition.name} is not configured: ${definition.setupHint}.`);
    }
    if (this.options.policy() === "free") {
      if (this.entries().length === 0)
        await this.options.catalog.whenReady(this.options.catalogWaitMs ?? CATALOG_WAIT_MS);
      const { entry, eligibility } = this.freeCheck(ref.canonical);
      if (!eligibility.eligible) throw this.refusal(entry, ref.canonical, eligibility);
    }
    return { canonical: ref.canonical };
  }

  // ── ProviderAdapter ───────────────────────────────────────────────────────────────────────────────────────────

  resolveModelRuntime(modelId: string): ProviderModelRuntime {
    if (isAutoFreeModel(modelId)) {
      // Asked often (the footer, every step); planning over a large catalog is redone only when something changed.
      const stamp = `${this.options.catalog.snapshot().version}:${this.options.policy()}:${Math.floor(this.now() / 5_000)}`;
      if (this.autoRuntime?.stamp === stamp) return this.autoRuntime.runtime;
      const routes = this.plan({ requiresTools: true }, new Set()).routes;
      const top = routes.slice(0, 3);
      const first = top[0];
      const info: ModelInfo = first
        ? {
            ...catalogEntryToModelInfo(first.entry),
            id: AUTO_FREE_MODEL_ID,
            name: "Auto Free",
            // The smallest window among the best routes: a retry may land on any of them.
            contextWindow: Math.max(16_000, Math.min(...top.map((route) => route.entry.contextWindow))),
            description: "Free mode: the best free model of any configured provider, chosen per request.",
          }
        : {
            ...fallbackInfo(AUTO_FREE_MODEL_ID, "Auto Free"),
            pricingKnown: true,
            description: "Free mode: the best free model of any configured provider, chosen per request.",
          };
      const runtime: ProviderModelRuntime = {
        modelId: AUTO_FREE_MODEL_ID,
        modelInfo: { ...info, inputPrice: 0, outputPrice: 0, pricingKnown: true },
      };
      this.autoRuntime = { stamp, runtime };
      return runtime;
    }
    const ref = parseModelRef(modelId, this.providerIds());
    const entry = this.entryOf(ref.canonical);
    const base = entry ? catalogEntryToModelInfo(entry) : fallbackInfo(ref.canonical, ref.providerModelId);
    return { modelId: ref.canonical, modelInfo: { ...base, id: ref.canonical, provider: ref.providerId } };
  }

  /**
   * Where a turn goes when `modelId` stops answering. Free mode: the next eligible routes of every provider. Mixed:
   * what the provider itself proposes (OpenRouter's routers), as before.
   */
  fallbackModelIds(modelId: string): string[] {
    if (isAutoFreeModel(modelId)) return [];
    const canonical = parseModelRef(modelId, this.providerIds()).canonical;
    if (this.options.policy() === "free") {
      return this.plan({ requiresTools: true }, new Set([canonical]))
        .routes.slice(0, MAX_ROUTE_ATTEMPTS)
        .map((route) => route.id);
    }
    try {
      const providerId = parseModelRef(modelId, this.providerIds()).providerId;
      return this.adapterFor(providerId).fallbackModelIds?.(canonical) ?? [];
    } catch {
      return [];
    }
  }

  routingNotes(): string[] {
    const cooling = [...this.notes];
    for (const [providerId, reason] of this.freeQuarantine)
      cooling.push(`${providerId} is out of Free mode: ${reason}`);
    return cooling;
  }

  getToolContext(): ProviderToolContext {
    return {};
  }

  stream(request: ProviderStreamRequest): ProviderStream {
    type Response = Awaited<ProviderStream["response"]>;
    let resolveResponse: (value: Response) => void = () => undefined;
    let rejectResponse: (error: unknown) => void = () => undefined;
    const response = new Promise<Response>((resolve, reject) => {
      resolveResponse = resolve;
      rejectResponse = reject;
    });
    response.catch(() => undefined);
    const settle = { resolve: resolveResponse, reject: rejectResponse };
    // `this` inside the generator is the provider; the closure keeps it explicit.
    const self = this;
    const requirements = requirementsForStream({
      system: request.system,
      messages: request.messages,
      ...(request.tools === undefined ? {} : { tools: request.tools }),
      ...(request.maxOutputTokens === undefined ? {} : { maxOutputTokens: request.maxOutputTokens }),
    });
    const events = (async function* (): AsyncGenerator<ProviderEvent> {
      const tried = new Set<string>();
      let lastError: unknown;
      let previous: { routeId: string; kind: FailureKind } | undefined;
      const auto = isAutoFreeModel(request.modelId);
      for (let attempt = 0; attempt < (auto ? MAX_ROUTE_ATTEMPTS : 1); attempt += 1) {
        let target: Target;
        try {
          target = await self.resolve(request.modelId, requirements, tried);
        } catch (error) {
          // Nothing left to try after a failover: the failure that led here is the more useful one.
          const final = lastError !== undefined && error instanceof NoFreeRouteError ? lastError : error;
          settle.reject(final);
          throw final;
        }
        tried.add(target.routeId);
        if (previous) {
          request.onRouteChange?.(self.describeSwitch(previous.routeId, previous.kind, target.routeId));
          previous = undefined;
        }
        const startedAt = self.now();
        let stepOk = false;
        let yielded = false;
        let failure: unknown;
        try {
          const inner = target.adapter.stream({
            ...request,
            modelId: target.routeId,
            onStepFinish: (event) => {
              stepOk = true;
              self.succeeded(target, startedAt);
              self.checkStep(target, event);
              request.onStepFinish?.({
                ...event,
                // The route that answered, in canonical form, so the footer and the usage record report reality.
                servedModelId: event.servedModelId ?? target.routeId,
              });
            },
          });
          inner.response.catch(() => undefined);
          for await (const event of inner.events) {
            if (event.type === "error") {
              failure = event.error;
              break;
            }
            // Anything yielded to the turn has been seen by it; a failure after that is the turn's to recover.
            yielded = true;
            yield event;
          }
          if (failure === undefined) {
            try {
              settle.resolve(await inner.response);
              if (!stepOk) self.succeeded(target, startedAt);
              return;
            } catch (error) {
              failure = error;
            }
          }
        } catch (error) {
          failure = error;
        }
        // The person pressed Esc: that is not the route's fault, so it neither cools down nor moves to the next one.
        if (cancelledByPerson(request.signal)) {
          settle.reject(failure);
          yield { type: "error", error: failure };
          return;
        }
        const { error: seen, kind } = self.failed(target, failure);
        lastError = seen;
        if (yielded || !auto || attempt === MAX_ROUTE_ATTEMPTS - 1) {
          settle.reject(seen);
          yield { type: "error", error: seen };
          return;
        }
        previous = { routeId: target.routeId, kind };
        // Nothing reached the turn yet: try the next route as if this one had never been chosen.
      }
      settle.reject(lastError ?? new NoFreeRouteError("No free route answered.", undefined));
      throw lastError ?? new NoFreeRouteError("No free route answered.", undefined);
    })();
    return { events, response };
  }

  private async simple<T>(
    modelId: string,
    requirements: FreeRouteRequest,
    run: (target: Target) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const tried = new Set<string>();
    const auto = isAutoFreeModel(modelId);
    let lastError: unknown;
    for (let attempt = 0; attempt < (auto ? MAX_ROUTE_ATTEMPTS : 1); attempt += 1) {
      let target: Target;
      try {
        target = await this.resolve(modelId, requirements, tried);
      } catch (error) {
        throw lastError !== undefined && error instanceof NoFreeRouteError ? lastError : error;
      }
      tried.add(target.routeId);
      const startedAt = this.now();
      try {
        const result = await run(target);
        this.succeeded(target, startedAt);
        return result;
      } catch (error) {
        // A cancelled call is not a failed route: do not cool it down or try the next one.
        if (cancelledByPerson(signal)) throw error;
        lastError = this.failed(target, error).error;
      }
    }
    throw lastError;
  }

  generateText(request: ProviderTextRequest): Promise<ProviderTextResult> {
    return this.simple(
      request.modelId,
      { minimumContext: Math.ceil((request.system.length + request.prompt.length) / 3) },
      (target) => target.adapter.generateText({ ...request, modelId: target.routeId }),
      request.signal,
    );
  }

  generateStructured(request: ProviderStructuredRequest): Promise<ProviderStructuredResult> {
    return this.simple(
      request.modelId,
      {
        requiresStructuredOutput: true,
        minimumContext: Math.ceil((request.system.length + request.prompt.length) / 3),
      },
      async (target) => {
        if (!target.adapter.generateStructured)
          throw new Error(`${target.providerId} does not support structured output.`);
        return target.adapter.generateStructured({ ...request, modelId: target.routeId });
      },
      request.signal,
    );
  }
}
