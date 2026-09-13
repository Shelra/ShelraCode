import { describe, expect, it } from "vitest";
import { recommendBootstrapModel } from "./recommendation";

describe("bootstrap model recommendation", () => {
  it("prioritizes GPU headroom while keeping CPU-only machines supported", () => {
    const gpu = recommendBootstrapModel({
      platform: "win32",
      arch: "x64",
      cpuModel: "gpu",
      cpuCores: 8,
      memoryGb: 32,
      memoryAvailableGb: 20,
      gpu: [{ vendor: "NVIDIA", model: "test", vramTotalGb: 24, vramAvailableGb: 20, accelerationBackends: ["cuda"] }],
    });
    const cpu = recommendBootstrapModel({
      platform: "linux",
      arch: "x64",
      cpuModel: "cpu",
      cpuCores: 4,
      memoryGb: 8,
      memoryAvailableGb: 6,
      gpu: [],
    });
    expect(gpu.id).toBe("hf:Qwen/Qwen2.5-Coder-7B-Instruct-GGUF:Q4_K_M");
    expect(cpu.id).toBe("hf:Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF:Q4_K_M");
  });
});
