import { describe, expect, it } from "vitest";
import { selectLocalRoute } from "./local-first";

const models = [
  {
    id: "small-chat",
    name: "small-chat",
    runtimeId: "shelra-llama",
    runtimeKind: "managed-llama" as const,
    baseURL: "http://127.0.0.1:19199/v1",
    contextWindow: 16_000,
    tools: false,
    structuredOutput: true,
    reasoning: false,
    source: "local" as const,
  },
  {
    id: "coder-7b",
    name: "coder-7b",
    runtimeId: "shelra-llama",
    runtimeKind: "managed-llama" as const,
    baseURL: "http://127.0.0.1:19199/v1",
    contextWindow: 32_000,
    tools: true,
    structuredOutput: true,
    reasoning: false,
    loaded: true,
    source: "local" as const,
  },
];

describe("local-first routing", () => {
  it("selects a loaded tool-capable local model", () => {
    const result = selectLocalRoute(models, { requiresTools: true, contextTokens: 20_000 });
    expect(result.kind).toBe("local");
    expect(result.model?.id).toBe("coder-7b");
    expect(result.reasons[0]).toContain("selected local model");
  });

  it("fails closed when local-only policy has no eligible model", () => {
    const result = selectLocalRoute(models, { policy: "local-only", requiresTools: true, contextTokens: 64_000 });
    expect(result.kind).toBe("unavailable");
    expect(result.reasons.at(-1)).toContain("local-only");
  });
});
