import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

describe("provider boundary architecture", () => {
  it("keeps xAI provider types out of the Agent and tool registry", () => {
    const agent = readFileSync(new URL("../agent/agent.ts", import.meta.url), "utf8");
    const tools = readFileSync(new URL("../toolset/tools.ts", import.meta.url), "utf8");
    const compaction = readFileSync(new URL("../agent/compaction.ts", import.meta.url), "utf8");
    expect(agent).not.toContain("XaiProvider");
    expect(tools).not.toContain("XaiProvider");
    expect(compaction).not.toContain("XaiProvider");
  });

  it("keeps the xAI SDK import out of the Agent", () => {
    const agent = readFileSync(new URL("../agent/agent.ts", import.meta.url), "utf8");
    expect(agent).not.toContain("@ai-sdk/xai");
  });
});
