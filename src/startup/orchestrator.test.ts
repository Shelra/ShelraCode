import { describe, expect, it } from "vitest";
import { FakeProvider } from "../providers/fake";
import type { LocalRuntimeDiscovery } from "../runtimes/types";
import { runStartup } from "./orchestrator";

const hardware = {
  platform: "win32",
  arch: "x64",
  cpuModel: "Test CPU",
  cpuCores: 8,
  memoryGb: 32,
  memoryAvailableGb: 24,
  gpu: [{ vendor: "NVIDIA", model: "Test GPU", vramTotalGb: 12, vramAvailableGb: 10, accelerationBackends: ["cuda"] }],
};

function discovery(provider = new FakeProvider("READY")): LocalRuntimeDiscovery {
  const model = {
    id: "hf:Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF:Q4_K_M",
    name: "Qwen2.5 Coder 1.5B · Q4_K_M",
    runtimeId: "shelra-llama",
    runtimeKind: "managed-llama" as const,
    baseURL: "http://127.0.0.1:19199/v1",
    contextWindow: 32_768,
    tools: true,
    structuredOutput: true,
    reasoning: false,
    parameters: 7_000_000_000,
    quantization: "Q4_K_M",
    source: "local" as const,
    loaded: true,
  };
  return {
    runtimes: [
      {
        id: "shelra-llama",
        kind: "managed-llama",
        baseURL: model.baseURL,
        detect: async () => true,
        health: async () => ({ healthy: true }),
        listModels: async () => [model],
        provider: () => provider,
      },
    ],
    health: { "shelra-llama": { healthy: true } },
    models: [model],
  };
}

describe("startup orchestrator", () => {
  it("emits ordered progress and reaches ready after a real provider probe", async () => {
    const states: string[] = [];
    const result = await runStartup({
      hardware,
      discovery: discovery(),
      onProgress: (progress) => states.push(progress.state),
      persistSelection: false,
    });
    expect(result.state).toBe("ready");
    expect(result.healthChecked).toBe(true);
    expect(result.model?.id).toBe("hf:Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF:Q4_K_M");
    expect(states).toContain("health-check");
    expect(states.at(-1)).toBe("ready");
  });

  it("enters onboarding when no local model is available", async () => {
    const result = await runStartup({ hardware, discovery: { runtimes: [], health: {}, models: [] } });
    expect(result.state).toBe("onboarding");
    expect(result.healthChecked).toBe(false);
  });

  it("health-checks the model it prepared, not an arbitrary installed one", async () => {
    const small = {
      id: "hf:small",
      name: "Small",
      runtimeId: "shelra-llama",
      runtimeKind: "managed-llama" as const,
      baseURL: "http://127.0.0.1:19199/v1",
      contextWindow: 32_768,
      tools: true,
      structuredOutput: true,
      reasoning: false,
      parameters: 1_500_000_000,
      source: "local" as const,
    };
    const large = { ...small, id: "hf:large", name: "Large", parameters: 7_000_000_000 };
    let served: string | undefined;
    const healthCalls: (string | undefined)[] = [];

    const result = await runStartup({
      hardware,
      discovery: {
        runtimes: [
          {
            id: "shelra-llama",
            kind: "managed-llama",
            baseURL: small.baseURL,
            detect: async () => true,
            prepareModel: async (modelId: string) => {
              served = modelId;
              return true;
            },
            health: async (_signal?: AbortSignal, modelId?: string) => {
              healthCalls.push(modelId);
              // A runtime asked without an id would report on its first model.
              const inspected = modelId ?? "hf:small";
              return inspected === served ? { healthy: true } : { healthy: false, reason: `not serving ${inspected}` };
            },
            listModels: async () => [small, large],
            provider: () => new FakeProvider("READY"),
          },
        ],
        health: { "shelra-llama": { healthy: true } },
        models: [small, large],
      },
      persistSelection: false,
    });

    expect(result.state).toBe("ready");
    expect(healthCalls).toEqual([result.model?.id]);
    expect(served).toBe(result.model?.id);
  });

  it("returns no provider when the primary and the fallback both fail their probe", async () => {
    const large = {
      id: "hf:large",
      name: "Large",
      runtimeId: "shelra-llama",
      runtimeKind: "managed-llama" as const,
      baseURL: "http://127.0.0.1:19199/v1",
      contextWindow: 32_768,
      tools: true,
      structuredOutput: true,
      reasoning: false,
      parameters: 7_000_000_000,
      memoryRequiredGb: 5.3,
      loaded: true,
      source: "local" as const,
    };
    const small = {
      ...large,
      id: "hf:small",
      name: "Small",
      parameters: 1_500_000_000,
      memoryRequiredGb: 2.2,
      loaded: false,
    };
    const prepared: string[] = [];
    class OutOfMemoryProvider extends FakeProvider {
      override async generateText(): Promise<never> {
        throw new Error("llama runtime out of memory");
      }
    }
    const failingProvider = new OutOfMemoryProvider("READY");

    const result = await runStartup({
      hardware,
      discovery: {
        runtimes: [
          {
            id: "shelra-llama",
            kind: "managed-llama",
            baseURL: large.baseURL,
            detect: async () => true,
            prepareModel: async (modelId: string) => {
              prepared.push(modelId);
              return true;
            },
            health: async () => ({ healthy: true }),
            listModels: async () => [large, small],
            provider: () => failingProvider,
          },
        ],
        health: { "shelra-llama": { healthy: true } },
        models: [large, small],
      },
      persistSelection: false,
    });

    expect(result.state).toBe("recoverable-error");
    expect(prepared).toEqual(["hf:large", "hf:small"]);
    expect(result.provider).toBeUndefined();
    expect(result.error).toContain("Small");
  });

  it("exposes a hardware-ranked recommendation when a runtime can install", async () => {
    const state = await runStartup({
      hardware,
      discovery: {
        runtimes: [
          {
            id: "shelra-llama",
            kind: "managed-llama",
            baseURL: "http://127.0.0.1:19199/v1",
            detect: async () => true,
            health: async () => ({ healthy: true }),
            listModels: async () => [],
            installModel: async () => ({ success: true }),
            provider: () => new FakeProvider(),
          },
        ],
        health: { "shelra-llama": { healthy: true } },
        models: [],
      },
      persistSelection: false,
    });
    expect(state.state).toBe("onboarding");
    expect(state.recommendation?.id).toBe("hf:Qwen/Qwen2.5-Coder-7B-Instruct-GGUF:Q4_K_M");
  });
});
