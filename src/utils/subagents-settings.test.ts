import { beforeEach, describe, expect, it } from "vitest";
import type { AgentMode } from "../types/index";
import { getCurrentModel, parseSubAgentsRawList, resolveCurrentModel } from "./settings";

describe("parseSubAgentsRawList", () => {
  it("returns empty for non-array or missing", () => {
    expect(parseSubAgentsRawList(undefined)).toEqual([]);
    expect(parseSubAgentsRawList(null)).toEqual([]);
    expect(parseSubAgentsRawList({})).toEqual([]);
  });

  it("keeps local runtime model identifiers", () => {
    expect(
      parseSubAgentsRawList([{ name: "docs", model: "qwen2.5-coder:7b", instruction: "Focus on documentation." }]),
    ).toEqual([{ name: "docs", model: "qwen2.5-coder:7b", instruction: "Focus on documentation." }]);
  });

  it("rejects xAI-hosted model identifiers", () => {
    expect(
      parseSubAgentsRawList([
        { name: "research", model: "x-ai/example-model", instruction: "Focus on research." },
        { name: "legacy", model: "xai/example-model", instruction: "Focus on research." },
      ]),
    ).toEqual([]);
  });

  it("skips empty model identifiers", () => {
    expect(parseSubAgentsRawList([{ name: "bad", model: "", instruction: "x" }])).toEqual([]);
  });

  it("skips reserved and empty names", () => {
    expect(
      parseSubAgentsRawList([
        { name: "general", model: "qwen2.5-coder:7b", instruction: "x" },
        { name: "Explore", model: "qwen2.5-coder:7b", instruction: "x" },
        { name: "vision", model: "qwen2.5-coder:7b", instruction: "x" },
        { name: "Verify", model: "qwen2.5-coder:7b", instruction: "x" },
        { name: "computer", model: "qwen2.5-coder:7b", instruction: "x" },
        { name: "", model: "qwen2.5-coder:7b", instruction: "x" },
        { name: "  ", model: "qwen2.5-coder:7b", instruction: "x" },
      ]),
    ).toEqual([]);
  });

  it("dedupes by case-insensitive name with first entry winning", () => {
    expect(
      parseSubAgentsRawList([
        { name: "Docs", model: "qwen2.5-coder:7b", instruction: "first" },
        { name: "docs", model: "qwen2.5-coder:14b", instruction: "second" },
      ]),
    ).toEqual([{ name: "Docs", model: "qwen2.5-coder:7b", instruction: "first" }]);
  });

  it("ignores non-object rows", () => {
    expect(parseSubAgentsRawList([null, "x", { name: "ok", model: "qwen2.5-coder:7b", instruction: "" }])).toEqual([
      { name: "ok", model: "qwen2.5-coder:7b", instruction: "" },
    ]);
  });
});

describe("getCurrentModel with modeModels", () => {
  beforeEach(() => {
    delete process.env.SHELRA_MODEL;
  });

  it("respects mode-specific models when provided", () => {
    expect(resolveCurrentModel("local-agent", "fallback")).toBe("local-agent");
  });

  it("respects SHELRA_MODEL environment variable over modeModels", () => {
    process.env.SHELRA_MODEL = "qwen2.5-coder:7b";

    const result = getCurrentModel("agent" as AgentMode);
    expect(result).toBe("qwen2.5-coder:7b");
    delete process.env.SHELRA_MODEL;
  });
});
