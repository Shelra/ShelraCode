import { APICallError } from "@ai-sdk/provider";
import { limitFromError } from "../providers/limits";

/**
 * Which routes and providers answered lately and which did not, so Free routing stops sending turns to an endpoint
 * that just failed and takes it back once its cooldown has passed. In memory only: a fresh process asks again, and the
 * map is bounded so a long session cannot grow it without end.
 */

export type FailureKind =
  /** A burst limit: a short wait gets past it. */
  | "rate-limit"
  /** The allowance for the day (or month) is spent; the wait is long. */
  | "quota"
  /** A server fault, a dropped connection, a silent stream. */
  | "unavailable"
  /** This model is not served right now (no endpoint, not found, rejects the request shape). */
  | "model-unavailable"
  /** The key was refused. Every model of the provider fails the same way. */
  | "credentials"
  | "other";

export interface ClassifiedFailure {
  kind: FailureKind;
  /** How long the provider asked us to wait, when it said. */
  retryAfterMs?: number;
}

const MINUTE = 60_000;

/** Base cooldowns, doubled for each failure in a row, up to the cap. */
const COOLDOWNS: Record<FailureKind, { base: number; cap: number }> = {
  "rate-limit": { base: MINUTE, cap: 10 * MINUTE },
  quota: { base: 30 * MINUTE, cap: 6 * 60 * MINUTE },
  unavailable: { base: 30_000, cap: 5 * MINUTE },
  "model-unavailable": { base: 10 * MINUTE, cap: 60 * MINUTE },
  credentials: { base: 30 * MINUTE, cap: 6 * 60 * MINUTE },
  other: { base: 30_000, cap: 5 * MINUTE },
};

/** Routes kept before the oldest is forgotten. */
const MAX_TRACKED = 512;
/** Failures of different models of one provider that put the whole provider on cooldown. */
const PROVIDER_BREAKER_THRESHOLD = 3;

function innermost(error: unknown): unknown {
  let current = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth += 1) {
    if (APICallError.isInstance(current)) break;
    const next = (current as { lastError?: unknown }).lastError ?? (current as { cause?: unknown }).cause;
    if (!next || next === current) break;
    current = next;
  }
  return current;
}

/** Reads a provider failure into what routing needs to know. Never throws. */
export function classifyFailure(providerId: string, error: unknown, now = new Date()): ClassifiedFailure {
  try {
    const inner = innermost(error);
    const status = APICallError.isInstance(inner) ? inner.statusCode : undefined;
    const text = `${inner instanceof Error ? inner.message : String(inner ?? "")}\n${
      APICallError.isInstance(inner) ? (inner.responseBody ?? "") : ""
    }`;
    const limit = limitFromError(providerId, error, now);
    if (limit) {
      const retryAfterMs = limit.resetsAt ? Math.max(0, limit.resetsAt.getTime() - now.getTime()) : undefined;
      return { kind: "quota", ...(retryAfterMs === undefined ? {} : { retryAfterMs }) };
    }
    if (status === 429 || /rate[- ]?limit|too many requests/i.test(text)) {
      const header = APICallError.isInstance(inner) ? inner.responseHeaders?.["retry-after"] : undefined;
      const seconds = header === undefined ? Number.NaN : Number(header);
      return { kind: "rate-limit", ...(Number.isFinite(seconds) ? { retryAfterMs: seconds * 1_000 } : {}) };
    }
    if (status === 401 || status === 403 || /invalid api key|unauthori[sz]ed|authentication/i.test(text)) {
      return { kind: "credentials" };
    }
    if (status === 402 || /insufficient (credits|balance|funds)|more credits/i.test(text)) {
      return { kind: "quota" };
    }
    if (
      status === 404 ||
      /no endpoints found|model .*not (found|available)|not a valid model|does not support tool/i.test(text)
    ) {
      return { kind: "model-unavailable" };
    }
    if (
      (status !== undefined && status >= 500) ||
      /timed? ?out|timeout|econnre|enotfound|fetch failed|socket|network|connection|stream.*(idle|silent|cut)|no content/i.test(
        text,
      )
    ) {
      return { kind: "unavailable" };
    }
    return { kind: "other" };
  } catch {
    return { kind: "other" };
  }
}

export interface RouteHealthView {
  routeId: string;
  providerId: string;
  /** Consecutive failures since the last success. */
  failures: number;
  lastFailure?: FailureKind;
  /** Epoch ms until which the route is skipped; 0 when it is available. */
  cooldownUntil: number;
  lastSuccessAt?: number;
  /** Smoothed latency of the first token or the whole answer, ms. */
  latencyMs?: number;
}

interface RouteRecord extends RouteHealthView {
  touchedAt: number;
}

export interface HealthTrackerOptions {
  now?: () => number;
}

export class HealthTracker {
  private readonly routes = new Map<string, RouteRecord>();
  private readonly providerCooldown = new Map<string, { until: number; kind: FailureKind; failures: number }>();
  private readonly now: () => number;

  constructor(options: HealthTrackerOptions = {}) {
    this.now = options.now ?? Date.now;
  }

  recordSuccess(routeId: string, providerId: string, latencyMs?: number): void {
    const at = this.now();
    const record = this.record(routeId, providerId);
    record.failures = 0;
    record.cooldownUntil = 0;
    delete record.lastFailure;
    record.lastSuccessAt = at;
    if (latencyMs !== undefined && Number.isFinite(latencyMs)) {
      record.latencyMs = record.latencyMs === undefined ? latencyMs : record.latencyMs * 0.7 + latencyMs * 0.3;
    }
    // A provider that answers again leaves its cooldown.
    this.providerCooldown.delete(providerId);
    this.evict();
  }

  recordFailure(routeId: string, providerId: string, failure: ClassifiedFailure): void {
    const at = this.now();
    const record = this.record(routeId, providerId);
    record.failures += 1;
    record.lastFailure = failure.kind;
    const { base, cap } = COOLDOWNS[failure.kind];
    const backoff = Math.min(cap, base * 2 ** Math.min(record.failures - 1, 8));
    // What the provider asked for wins, within sanity: never less than a second, never more than a day.
    const wait =
      failure.retryAfterMs !== undefined ? Math.min(24 * 60 * MINUTE, Math.max(1_000, failure.retryAfterMs)) : backoff;
    record.cooldownUntil = Math.max(record.cooldownUntil, at + wait);

    // A refused key, or a quota, ends every model of the provider at once.
    if (failure.kind === "credentials" || failure.kind === "quota") {
      this.coolProvider(providerId, failure.kind, at + wait);
    } else {
      this.noteProviderFailure(providerId, failure.kind, at, wait);
    }
    this.evict();
  }

  /** Whether the route may be tried now. */
  isAvailable(routeId: string, providerId: string): boolean {
    const at = this.now();
    const provider = this.providerCooldown.get(providerId);
    if (provider && provider.until > at) return false;
    const record = this.routes.get(routeId);
    return !record || record.cooldownUntil <= at;
  }

  /**
   * Whether what put the route (or its provider) on cooldown was a passing fault (a server error, a dropped connection,
   * an overloaded model) and not a spent quota, a refused key, a burst limit the provider asked us to wait out, or a
   * model that is not served. Only a passing fault is worth trying again before its cooldown is over: the others fail
   * the same way, or ask for patience.
   */
  isTransient(routeId: string, providerId: string): boolean {
    const at = this.now();
    const provider = this.providerCooldown.get(providerId);
    if (provider && provider.until > at && provider.kind !== "unavailable" && provider.kind !== "other") return false;
    const record = this.routes.get(routeId);
    if (record && record.cooldownUntil > at)
      return record.lastFailure === "unavailable" || record.lastFailure === "other";
    return provider !== undefined && provider.until > at;
  }

  /** Milliseconds until the route or its provider may be tried again; 0 when it may be now. */
  cooldownRemaining(routeId: string, providerId: string): number {
    const at = this.now();
    const provider = this.providerCooldown.get(providerId)?.until ?? 0;
    const route = this.routes.get(routeId)?.cooldownUntil ?? 0;
    return Math.max(0, provider - at, route - at);
  }

  view(routeId: string): RouteHealthView | undefined {
    const record = this.routes.get(routeId);
    if (!record) return undefined;
    const { touchedAt: _touchedAt, ...view } = record;
    return view;
  }

  providerCooldownUntil(providerId: string): number {
    return this.providerCooldown.get(providerId)?.until ?? 0;
  }

  /** Forgets everything: a provider that was reconfigured starts clean. */
  reset(providerId?: string): void {
    if (providerId === undefined) {
      this.routes.clear();
      this.providerCooldown.clear();
      return;
    }
    this.providerCooldown.delete(providerId);
    for (const [id, record] of this.routes) if (record.providerId === providerId) this.routes.delete(id);
  }

  size(): number {
    return this.routes.size;
  }

  private record(routeId: string, providerId: string): RouteRecord {
    let record = this.routes.get(routeId);
    if (!record) {
      record = { routeId, providerId, failures: 0, cooldownUntil: 0, touchedAt: 0 };
      this.routes.set(routeId, record);
    }
    record.touchedAt = this.now();
    return record;
  }

  private coolProvider(providerId: string, kind: FailureKind, until: number): void {
    const current = this.providerCooldown.get(providerId);
    this.providerCooldown.set(providerId, {
      until: Math.max(current?.until ?? 0, until),
      kind,
      failures: (current?.failures ?? 0) + 1,
    });
  }

  /** Several different models of one provider failing in a row means the provider is the problem. */
  private noteProviderFailure(providerId: string, kind: FailureKind, at: number, wait: number): void {
    if (kind === "model-unavailable") return;
    let distinct = 0;
    for (const record of this.routes.values()) {
      if (record.providerId === providerId && record.failures > 0 && record.cooldownUntil > at) distinct += 1;
    }
    if (distinct >= PROVIDER_BREAKER_THRESHOLD) this.coolProvider(providerId, kind, at + wait);
  }

  private evict(): void {
    if (this.routes.size <= MAX_TRACKED) return;
    const oldest = [...this.routes.values()].sort((a, b) => a.touchedAt - b.touchedAt);
    for (const record of oldest.slice(0, this.routes.size - MAX_TRACKED)) this.routes.delete(record.routeId);
  }
}
