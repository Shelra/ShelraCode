import { describe, expect, it } from "vitest";
import { localModelFitScore } from "./profile";

describe("local model hardware fit", () => {
  it("scores a tool-capable model that fits available memory", () => {
    const score = localModelFitScore(
      {
        id: "coder",
        name: "coder",
        runtimeId: "shelra-llama",
        runtimeKind: "managed-llama",
        baseURL: "http://127.0.0.1:19199/v1",
        contextWindow: 32_768,
        tools: true,
        structuredOutput: true,
        reasoning: false,
        parameters: 7_000_000_000,
        source: "local",
      },
      { platform: "win32", arch: "x64", cpuModel: "test", cpuCores: 8, memoryGb: 32 },
    );
    expect(score).toBeGreaterThan(50);
  });
});
