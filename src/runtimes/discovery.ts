import { createOpenAICompatibleProvider } from "./local-provider";
import { ManagedLlamaRuntime } from "./managed-llama";
import type { LocalModelCandidate, LocalRuntimeAdapter, LocalRuntimeDiscovery, LocalRuntimeHealth } from "./types";

type FetchLike = typeof fetch;

function explicitEndpointRuntime(endpoint: string, fetchImpl: FetchLike): LocalRuntimeAdapter {
  const baseURL = endpoint.replace(/\/$/u, "");
  return {
    id: "local-openai",
    kind: "openai-compatible",
    baseURL,
    async detect(signal) {
      try {
        return (await fetchImpl(`${baseURL}/models`, { signal })).ok;
      } catch {
        return false;
      }
    },
    async health(signal): Promise<LocalRuntimeHealth> {
      const started = Date.now();
      try {
        const response = await fetchImpl(`${baseURL}/models`, { signal });
        return {
          healthy: response.ok,
          latencyMs: Date.now() - started,
          ...(response.ok ? {} : { reason: `HTTP ${response.status}` }),
        };
      } catch (error) {
        return {
          healthy: false,
          latencyMs: Date.now() - started,
          reason: error instanceof Error ? error.message : String(error),
        };
      }
    },
    async listModels(signal): Promise<LocalModelCandidate[]> {
      try {
        const response = await fetchImpl(`${baseURL}/models`, { signal });
        if (!response.ok) return [];
        const body = (await response.json()) as { data?: unknown };
        if (!Array.isArray(body.data)) return [];
        return body.data.flatMap((item): LocalModelCandidate[] => {
          if (!item || typeof item !== "object" || typeof (item as { id?: unknown }).id !== "string") return [];
          const id = (item as { id: string }).id;
          return [
            {
              id: `local-openai/${id}`,
              name: id,
              runtimeId: "local-openai",
              runtimeKind: "openai-compatible",
              baseURL,
              // A guess: an arbitrary OpenAI-compatible endpoint advertises no window.
              contextWindow: 32_768,
              tools: true,
              structuredOutput: true,
              reasoning: false,
              source: "local",
              capabilityConfidence: "unknown",
              supportsVision: false,
              capabilityClass: "unknown",
            },
          ];
        });
      } catch {
        return [];
      }
    },
    provider(model) {
      return createOpenAICompatibleProvider("local", baseURL, model.id);
    },
  };
}

export function createLocalRuntimeAdapters(
  env: Record<string, string | undefined> = process.env,
  fetchImpl: FetchLike = fetch,
): LocalRuntimeAdapter[] {
  const adapters: LocalRuntimeAdapter[] = [new ManagedLlamaRuntime({ fetchImpl })];
  // Explicit endpoints remain a compatibility escape hatch. Shelra never
  // installs or starts a third-party runtime and never probes vendor apps by
  // default.
  const endpoint = env.SHELRA_LOCAL_ENDPOINT?.trim() || env.OPENAI_BASE_URL?.trim();
  if (endpoint) adapters.push(explicitEndpointRuntime(endpoint.replace(/\/$/u, ""), fetchImpl));
  return adapters;
}

export async function discoverLocalRuntimes(
  adapters = createLocalRuntimeAdapters(),
  signal?: AbortSignal,
): Promise<LocalRuntimeDiscovery> {
  const results = await Promise.all(
    adapters.map(async (adapter) => {
      const [detected, health, models] = await Promise.all([
        adapter.detect(signal),
        adapter.health(signal),
        adapter.listModels(signal),
      ]);
      return { adapter, detected, health, models };
    }),
  );
  // Keep an app-managed runtime visible even before its executable exists. It
  // owns the installation path, so hiding it here would strand first-run
  // onboarding with “no runtime can install models”. External runtimes remain
  // opt-in and are only included when they are actually detected.
  const active = results.filter(
    (result) => result.detected || result.models.length > 0 || typeof result.adapter.installModel === "function",
  );
  return {
    runtimes: active.map((result) => result.adapter),
    health: Object.fromEntries(results.map((result) => [result.adapter.id, result.health])),
    models: active.flatMap((result) => result.models),
  };
}

/** Stops managed runtime children created by a discovery pass. */
export async function disposeLocalRuntimes(discovery: LocalRuntimeDiscovery | undefined): Promise<void> {
  if (!discovery) return;
  await Promise.all(discovery.runtimes.map((runtime) => runtime.dispose?.()));
}
