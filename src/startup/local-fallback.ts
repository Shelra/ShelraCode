import { inspectHardware } from "../hardware/profile";
import type { ProviderAdapter } from "../providers/types";
import { selectLocalRoute } from "../router/local-first";
import { discoverLocalRuntimes, disposeLocalRuntimes } from "../runtimes/discovery";
import type { LocalRuntimeDiscovery } from "../runtimes/types";
import { probeLocalModel } from "./orchestrator";

/** Discovery reads the disk and asks configured local endpoints; one that hangs must not hold the turn. */
const DISCOVERY_TIMEOUT_MS = 5_000;
/** A cold local server can take 15-25 s to answer its first request (see `probeLocalModel`). */
const PROBE_TIMEOUT_MS = 60_000;

export interface InstalledLocalModel {
  provider: ProviderAdapter;
  modelId: string;
  name: string;
  /** Owns the started server; release it with `disposeLocalRuntimes`. */
  discovery: LocalRuntimeDiscovery;
}

function bounded(signal: AbortSignal | undefined, ms: number): AbortSignal {
  const timeout = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

/**
 * Starts a local model that is already installed, for a session whose cloud key was rejected:
 * the managed engine with a GGUF already on disk, or a configured local endpoint that answers.
 * Nothing is downloaded or installed. Null when no installed model can start and answer a probe.
 */
export async function startInstalledLocalModel(signal?: AbortSignal): Promise<InstalledLocalModel | null> {
  const discovery = await discoverLocalRuntimes(undefined, bounded(signal, DISCOVERY_TIMEOUT_MS));
  const release = () => disposeLocalRuntimes(discovery).catch(() => undefined);
  const candidate = selectLocalRoute(discovery.models, { requiresTools: true, hardware: inspectHardware() }).model;
  const runtime = candidate ? discovery.runtimes.find((item) => item.id === candidate.runtimeId) : undefined;
  if (!candidate || !runtime || signal?.aborted) {
    await release();
    return null;
  }
  if (runtime.prepareModel && !(await runtime.prepareModel(candidate.id, signal))) {
    await release();
    return null;
  }
  // The running server reports the context window it actually loaded.
  const loaded = (await runtime.listModels(signal)).find((model) => model.id === candidate.id) ?? candidate;
  const provider = runtime.provider(loaded);
  const probe = await probeLocalModel(provider, loaded, bounded(signal, PROBE_TIMEOUT_MS));
  if (!probe.ok) {
    await release();
    return null;
  }
  return { provider, modelId: loaded.id, name: loaded.name, discovery };
}
