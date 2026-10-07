import type { ModelPolicy } from "../models/routing";
import { createDefaultRegistry, defaultResolveDeps, type ResolveOverrides } from "../providers/default-registry";
import type { ProviderRegistry, ResolveDeps } from "../providers/registry";
import { type RoutingEvent, RoutingProvider } from "../providers/routing-provider";
import { sessionModelPolicy } from "../utils/settings";
import { loadFreeAttestations } from "./attestations";
import { CatalogService } from "./catalog-service";
import type { FreeAttestations } from "./eligibility";
import { HealthTracker } from "./health";

/**
 * The routing machinery of one process: registry, catalog, health and the provider that uses them. One per process,
 * so the terminal UI, `shelra providers` and a headless run all read the same state, and nothing is built twice.
 */
export interface RoutingRuntime {
  registry: ProviderRegistry;
  catalog: CatalogService;
  health: HealthTracker;
  provider: RoutingProvider;
  /** Where each provider's configuration comes from. */
  resolveDeps: () => ResolveDeps;
  /** The session's model mode. */
  policy: () => ModelPolicy;
  /** What the user declared, cached for a couple of seconds: it is read on every request. */
  attestations: () => FreeAttestations;
  /** Loads the disk cache, then refreshes in the background. Resolves when the cache is loaded, not the network. */
  start(): Promise<void>;
  /** A key or a declaration changed while the session runs: read the configuration again, then ask the providers. */
  reload(): Promise<void>;
  /** Asks the providers again without touching what the session learned about them (cooldowns, quotas). */
  refresh(): Promise<void>;
  dispose(): void;
}

export interface RoutingRuntimeOptions extends ResolveOverrides {
  onEvent?: (event: RoutingEvent) => void;
  /** Defaults to the session's mode (`sessionModelPolicy`). */
  policy?: () => ModelPolicy;
  /** Where each provider's catalog is cached; `null` turns it off. */
  cacheDir?: string | null;
}

const ATTESTATION_TTL_MS = 2_000;
let current: RoutingRuntime | null = null;

export function createRoutingRuntime(options: RoutingRuntimeOptions = {}): RoutingRuntime {
  current?.dispose();
  const registry = createDefaultRegistry();
  const resolveDeps = defaultResolveDeps(options.openRouterKey ? { openRouterKey: options.openRouterKey } : {});
  const catalog = new CatalogService({
    registry,
    resolveDeps,
    ...(options.cacheDir === undefined ? {} : { cacheDir: options.cacheDir }),
  });
  const health = new HealthTracker();
  const policy = options.policy ?? sessionModelPolicy;
  let cached: { at: number; value: FreeAttestations } | null = null;
  const attestations = (): FreeAttestations => {
    const now = Date.now();
    if (!cached || now - cached.at > ATTESTATION_TTL_MS) cached = { at: now, value: loadFreeAttestations() };
    return cached.value;
  };
  const provider = new RoutingProvider({
    registry,
    catalog,
    health,
    resolveDeps,
    policy,
    attestations,
    ...(options.onEvent ? { onEvent: options.onEvent } : {}),
  });
  const runtime: RoutingRuntime = {
    registry,
    catalog,
    health,
    provider,
    resolveDeps,
    policy,
    attestations,
    async start() {
      await catalog.loadCached();
      // The first network pass runs behind the caller: opening the terminal never waits for a provider.
      void catalog.refresh().catch(() => undefined);
      catalog.startAutoRefresh();
    },
    async refresh() {
      await catalog.refresh({ force: true });
    },
    async reload() {
      cached = null;
      provider.resetConfigCache();
      await catalog.refresh({ force: true });
    },
    dispose() {
      catalog.dispose();
      if (current === runtime) current = null;
    },
  };
  current = runtime;
  return runtime;
}
