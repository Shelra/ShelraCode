import { describe, expect, it } from "vitest";
import { FakeProvider } from "../providers/fake";
import type { LocalRuntimeDiscovery } from "../runtimes/types";
import { installLocalModel } from "./manager";

describe("local model manager", () => {
  it("uses a runtime-owned install stream and forwards progress", async () => {
    const progress: number[] = [];
    const discovery: LocalRuntimeDiscovery = {
      runtimes: [
        {
          id: "shelra-llama",
          kind: "managed-llama",
          baseURL: "http://127.0.0.1:19199/v1",
          detect: async () => true,
          health: async () => ({ healthy: true }),
          listModels: async () => [],
          installModel: async ({ onProgress }) => {
            onProgress?.({ completed: 5, total: 10, status: "downloading" });
            onProgress?.({ completed: 10, total: 10, status: "verifying" });
            return { success: true };
          },
          provider: () => new FakeProvider(),
        },
      ],
      health: { "shelra-llama": { healthy: true } },
      models: [],
    };
    const result = await installLocalModel(
      discovery,
      "hf:Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF:Q4_K_M",
      { platform: "win32", arch: "x64", cpuModel: "test", cpuCores: 8, memoryGb: 16 },
      (item) => {
        if (item.completed !== undefined) progress.push(item.completed);
      },
    );
    expect(result.success).toBe(true);
    expect(progress).toEqual([5, 10]);
  });

  it("rejects unsafe model identifiers before contacting the runtime", async () => {
    const result = await installLocalModel({ runtimes: [], health: {}, models: [] }, "../model", {
      platform: "win32",
      arch: "x64",
      cpuModel: "test",
      cpuCores: 8,
      memoryGb: 16,
    });
    expect(result.success).toBe(false);
  });
});
