import { describe, expect, it } from "vitest";
import type { LocalRuntimeDiscovery } from "../runtimes/types";
import { collectOnboardingState, renderOnboarding } from "./onboarding";

const discovery: LocalRuntimeDiscovery = {
  runtimes: [
    {
      id: "shelra-llama",
      kind: "managed-llama",
      baseURL: "http://127.0.0.1:19199/v1",
      detect: async () => true,
      health: async () => ({ healthy: true, latencyMs: 2 }),
      listModels: async () => [],
      provider: () => {
        throw new Error("not used in onboarding test");
      },
    },
  ],
  health: { "shelra-llama": { healthy: true, latencyMs: 2 } },
  models: [
    {
      id: "hf:Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF:Q4_K_M",
      name: "Qwen2.5 Coder 1.5B · Q4_K_M",
      runtimeId: "shelra-llama",
      runtimeKind: "managed-llama",
      baseURL: "http://127.0.0.1:19199/v1",
      contextWindow: 32_768,
      tools: true,
      structuredOutput: true,
      reasoning: false,
      source: "local",
      loaded: true,
      capabilityConfidence: "declared",
    },
  ],
};

describe("local onboarding", () => {
  it("selects an eligible local model and renders runtime guidance", async () => {
    const state = await collectOnboardingState({
      discovery,
      hardware: {
        platform: "win32",
        arch: "x64",
        cpuModel: "Test CPU",
        cpuCores: 8,
        memoryGb: 16,
      },
    });
    expect(state.route.model?.id).toBe("hf:Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF:Q4_K_M");
    expect(renderOnboarding(state)).toContain("recommended");
    expect(renderOnboarding(state)).toContain("prepares a managed model");
  });

  it("explains when no local model is available", async () => {
    const state = await collectOnboardingState({
      discovery: { runtimes: [], health: {}, models: [] },
      hardware: {
        platform: "win32",
        arch: "x64",
        cpuModel: "Test CPU",
        cpuCores: 8,
        memoryGb: 16,
      },
    });
    expect(state.route.model).toBeUndefined();
    expect(renderOnboarding(state)).toContain("No eligible local model yet");
  });
});
