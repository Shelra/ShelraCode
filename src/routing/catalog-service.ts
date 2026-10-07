import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CatalogEntry } from "../models/types";
import { getProductUserDir } from "../product/identity";
import type { ConfiguredProvider, ProviderDefinition, ProviderRegistry, ResolveDeps } from "../providers/registry";
import { recordSwallowedError } from "../utils/diagnostics";

/**
 * One catalog for every provider. It discovers models concurrently and within a time bound, keeps the last good
 * answer when a provider stops answering, writes each answer to disk so the next start has a catalog at once, and
 * swaps in a provider's models atomically, so a reader never sees half a refresh. Nothing here blocks the terminal UI:
 * `snapshot()` is synchronous and `refresh()` is the only thing that waits on a network.
 */

export type ProviderStatusKind = "unconfigured" | "loading" | "ready" | "stale" | "unavailable";

export interface ProviderCatalogStatus {
  providerId: string;
  name: string;
  status: ProviderStatusKind;
  modelCount: number;
  fetchedAt?: number;
  /** Why the last refresh failed. Never contains a key. */
  error?: string;
  /** Where its configuration came from, for display ("OMNIROUTE_BASE_URL"). */
  source?: string;
  /** Earliest time a failed provider is asked again. */
  nextAttemptAt?: number;
}

export interface CatalogSnapshot {
  /** Every provider's models, in registration order. A new array only when something changed. */
  entries: readonly CatalogEntry[];
  /** Increases each time the entries change; cheap for a UI to compare. */
  version: number;
}

export interface CatalogServiceOptions {
  registry: ProviderRegistry;
  resolveDeps: () => ResolveDeps;
  now?: () => number;
  fetch?: typeof fetch;
  /** A provider answered within this long is not asked again. */
  ttlMs?: number;
  /** Longest a single provider may take to list its models. */
  discoveryTimeoutMs?: number;
  /** Providers asked at the same time. */
  concurrency?: number;
  /** Where each provider's last answer is kept; `null` turns the disk cache off (tests). */
  cacheDir?: string | null;
  maxEntriesPerProvider?: number;
}

interface ProviderState {
  entries: CatalogEntry[];
  status: ProviderStatusKind;
  fetchedAt?: number;
  error?: string;
  source?: string;
  failures: number;
  nextAttemptAt: number;
}

interface CacheFile {
  version: 1;
  fetchedAt: number;
  entries: CatalogEntry[];
}

export const CATALOG_TTL_MS = 15 * 60_000;
const RETRY_BASE_MS = 15_000;
const RETRY_CAP_MS = 5 * 60_000;

function isOwnEntry(definition: ProviderDefinition, entry: unknown): entry is CatalogEntry {
  if (!entry || typeof entry !== "object") return false;
  const item = entry as Partial<CatalogEntry>;
  // A definition may only describe its own models; anything else would impersonate another provider's ids.
  return (
    typeof item.id === "string" &&
    item.id.startsWith(`${definition.id}/`) &&
    item.provider === definition.id &&
    typeof item.name === "string" &&
    typeof item.contextWindow === "number" &&
    item.contextWindow > 0 &&
    typeof item.capabilities === "object" &&
    item.capabilities !== null &&
    typeof item.cost === "object" &&
    item.cost !== null &&
    item.state?.kind === "cloud"
  );
}

function messageOf(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.length > 300 ? `${raw.slice(0, 300)}…` : raw;
}

export class CatalogService {
  private readonly registry: ProviderRegistry;
  private readonly resolveDeps: () => ResolveDeps;
  private readonly now: () => number;
  private readonly fetchImpl: typeof fetch | undefined;
  private readonly ttlMs: number;
  private readonly timeoutMs: number;
  private readonly concurrency: number;
  private readonly cacheDir: string | null;
  private readonly maxEntries: number;
  private readonly states = new Map<string, ProviderState>();
  private readonly listeners = new Set<() => void>();
  private snapshotValue: CatalogSnapshot = { entries: [], version: 0 };
  private inflight: Promise<void> | null = null;
  private inflightForced = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(options: CatalogServiceOptions) {
    this.registry = options.registry;
    this.resolveDeps = options.resolveDeps;
    this.now = options.now ?? Date.now;
    this.fetchImpl = options.fetch;
    this.ttlMs = options.ttlMs ?? CATALOG_TTL_MS;
    this.timeoutMs = options.discoveryTimeoutMs ?? 5_000;
    this.concurrency = Math.max(1, options.concurrency ?? 3);
    this.cacheDir = options.cacheDir === undefined ? join(getProductUserDir(), "cache") : options.cacheDir;
    this.maxEntries = options.maxEntriesPerProvider ?? 5_000;
  }

  snapshot(): CatalogSnapshot {
    return this.snapshotValue;
  }

  entriesOf(providerId: string): readonly CatalogEntry[] {
    return this.states.get(providerId)?.entries ?? [];
  }

  /** One row per registered provider, for the status view and the model picker's headings. */
  status(): ProviderCatalogStatus[] {
    const configured = new Map(this.registry.configured(this.resolveDeps()).map((item) => [item.definition.id, item]));
    return this.registry.list().map((definition) => {
      const state = this.states.get(definition.id);
      const config = configured.get(definition.id);
      if (!config) {
        return { providerId: definition.id, name: definition.name, status: "unconfigured", modelCount: 0 };
      }
      return {
        providerId: definition.id,
        name: definition.name,
        status: state?.status ?? "loading",
        modelCount: state?.entries.length ?? 0,
        ...(state?.fetchedAt === undefined ? {} : { fetchedAt: state.fetchedAt }),
        ...(state?.error ? { error: state.error } : {}),
        source: config.configs[0]?.source,
        ...(state && state.nextAttemptAt > this.now() ? { nextAttemptAt: state.nextAttemptAt } : {}),
      };
    });
  }

  /** Calls `listener` after the catalog changes. Returns the way to stop. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Loads each configured provider's last answer from disk, so a start has a catalog before any network call. */
  async loadCached(): Promise<void> {
    if (this.cacheDir === null) return;
    const dir = this.cacheDir;
    const configured = this.registry.configured(this.resolveDeps());
    let changed = false;
    await Promise.all(
      configured.map(async ({ definition, configs }) => {
        if (this.states.get(definition.id)?.entries.length) return;
        try {
          const file = JSON.parse(await readFile(join(dir, `catalog-${definition.id}.json`), "utf8")) as CacheFile;
          if (file.version !== 1 || !Array.isArray(file.entries) || typeof file.fetchedAt !== "number") return;
          const entries = file.entries.filter((entry) => isOwnEntry(definition, entry)).slice(0, this.maxEntries);
          if (entries.length === 0) return;
          this.states.set(definition.id, {
            entries,
            status: "stale",
            fetchedAt: file.fetchedAt,
            source: configs[0]?.source,
            failures: 0,
            nextAttemptAt: 0,
          });
          changed = true;
        } catch {
          // No cache, or an unreadable one: the first refresh fills it.
        }
      }),
    );
    if (changed) this.publish();
  }

  /**
   * Asks every configured provider whose answer is older than the TTL (or all of them with `force`), up to
   * `concurrency` at a time, each within its own time limit. Calls that overlap share one pass.
   */
  refresh(options: { force?: boolean; signal?: AbortSignal } = {}): Promise<void> {
    if (this.inflight) {
      // A forced pass asked for during one that was not forced (a key was just added) must not be answered by it: that
      // pass may have started before the key existed. Run one more right after.
      if (options.force && !this.inflightForced)
        return this.inflight.catch(() => undefined).then(() => this.refresh(options));
      return this.inflight;
    }
    this.inflightForced = options.force === true;
    const run = this.runRefresh(options).finally(() => {
      this.inflight = null;
      this.inflightForced = false;
    });
    this.inflight = run;
    return run;
  }

  /** Waits for the pass in progress, but never longer than `timeoutMs`. True when a catalog exists afterwards. */
  async whenReady(timeoutMs: number): Promise<boolean> {
    const pending = this.inflight;
    if (pending) {
      await Promise.race([
        pending.catch(() => undefined),
        new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
      ]);
    }
    return this.snapshotValue.entries.length > 0;
  }

  /** One timer for the whole process; a pass inside the TTL does nothing, so this is not polling. */
  startAutoRefresh(intervalMs = CATALOG_TTL_MS): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.refresh().catch(() => undefined);
    }, intervalMs);
    this.timer.unref?.();
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.listeners.clear();
  }

  private async runRefresh(options: { force?: boolean; signal?: AbortSignal }): Promise<void> {
    const deps = this.resolveDeps();
    const configured = this.registry.configured(deps);
    const configuredIds = new Set(configured.map((item) => item.definition.id));
    let changed = false;
    // A provider the user removed leaves the catalog at once.
    for (const [id, state] of [...this.states]) {
      if (!configuredIds.has(id)) {
        this.states.delete(id);
        changed ||= state.entries.length > 0;
      }
    }
    const due = configured.filter(({ definition }) => {
      const state = this.states.get(definition.id);
      if (options.force) return true;
      if (state && state.nextAttemptAt > this.now()) return false;
      return (
        !state || state.fetchedAt === undefined || this.now() - state.fetchedAt > this.ttlMs || state.status === "stale"
      );
    });
    for (const { definition } of due) {
      if (!this.states.has(definition.id)) {
        this.states.set(definition.id, { entries: [], status: "loading", failures: 0, nextAttemptAt: 0 });
      }
    }

    const queue = [...due];
    const worker = async (): Promise<void> => {
      for (let item = queue.shift(); item; item = queue.shift()) {
        if (options.signal?.aborted) return;
        changed = (await this.refreshOne(item, options.signal)) || changed;
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.concurrency, queue.length) }, worker));
    if (changed) this.publish();
  }

  private async refreshOne({ definition, configs }: ConfiguredProvider, signal?: AbortSignal): Promise<boolean> {
    const previous = this.states.get(definition.id);
    let lastError: unknown;
    for (const config of configs) {
      const timeout = AbortSignal.timeout(this.timeoutMs);
      try {
        const found = await definition.discoverModels(config, {
          ...(this.fetchImpl ? { fetch: this.fetchImpl } : {}),
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
          now: this.now,
        });
        const entries = found.filter((entry) => isOwnEntry(definition, entry)).slice(0, this.maxEntries);
        if (entries.length === 0) throw new Error(`${definition.name} listed no usable models`);
        const fetchedAt = this.now();
        this.states.set(definition.id, {
          entries,
          status: "ready",
          fetchedAt,
          source: config.source,
          failures: 0,
          nextAttemptAt: 0,
        });
        void this.writeCache(definition.id, { version: 1, fetchedAt, entries });
        return true;
      } catch (error) {
        lastError = error;
      }
    }
    const failures = (previous?.failures ?? 0) + 1;
    const hadEntries = (previous?.entries.length ?? 0) > 0;
    this.states.set(definition.id, {
      entries: previous?.entries ?? [],
      status: hadEntries ? "stale" : "unavailable",
      ...(previous?.fetchedAt === undefined ? {} : { fetchedAt: previous.fetchedAt }),
      error: messageOf(lastError),
      source: configs[0]?.source,
      failures,
      nextAttemptAt: this.now() + Math.min(RETRY_CAP_MS, RETRY_BASE_MS * 2 ** Math.min(failures - 1, 8)),
    });
    // A status change is worth telling listeners about even when the models did not change.
    return previous?.status !== (hadEntries ? "stale" : "unavailable");
  }

  private publish(): void {
    const entries: CatalogEntry[] = [];
    for (const definition of this.registry.list()) {
      const state = this.states.get(definition.id);
      if (state) entries.push(...state.entries);
    }
    this.snapshotValue = { entries, version: this.snapshotValue.version + 1 };
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch {
        // A listener must never break the catalog.
      }
    }
  }

  private async writeCache(providerId: string, file: CacheFile): Promise<void> {
    if (this.cacheDir === null) return;
    try {
      await mkdir(this.cacheDir, { recursive: true });
      const path = join(this.cacheDir, `catalog-${providerId}.json`);
      const temporary = `${path}.tmp-${process.pid}`;
      await writeFile(temporary, JSON.stringify(file), { encoding: "utf8", mode: 0o600 });
      await rename(temporary, path);
    } catch (error) {
      // The cache is an optimization; a read-only home must not stop discovery, but it is logged.
      recordSwallowedError(`catalog cache ${providerId}`, error);
    }
  }
}
