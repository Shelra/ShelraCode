import { describe, expect, it } from "vitest";
import { type LoadedContext, loadedContextRows } from "./loaded-context";

const loaded: LoadedContext = {
  rules: ["AGENTS.md", "~/.shelra/AGENTS.md"],
  skills: ["terminal-ui", "agent-browser"],
  hooks: { commands: 2, events: ["Stop", "PreToolUse"] },
  agents: { builtIn: ["explore", "plan", "general", "vision", "verify", "computer"], custom: ["docs"] },
  mcp: ["github"],
};

describe("loadedContextRows", () => {
  it("lists one row per kind of thing that is loaded", () => {
    const rows = loadedContextRows(loaded, { saved: 3, recalled: 2 });
    expect(rows.map((row) => row.label)).toEqual(["Rules", "Skills", "Hooks", "Agents", "MCP", "Memory"]);
    expect(rows.find((row) => row.label === "Rules")?.text).toBe("AGENTS.md · ~/.shelra/AGENTS.md");
    expect(rows.find((row) => row.label === "Hooks")?.text).toBe("2 hooks · Stop · PreToolUse");
    expect(rows.find((row) => row.label === "Agents")?.text).toBe("6 built in + docs");
    expect(rows.find((row) => row.label === "Memory")?.text).toBe("3 saved · 2 recalled this turn");
  });

  it("leaves out what is not loaded", () => {
    const rows = loadedContextRows(
      {
        rules: [],
        skills: [],
        hooks: { commands: 0, events: [] },
        agents: { builtIn: ["explore"], custom: [] },
        mcp: [],
      },
      { saved: 0, recalled: 0 },
    );
    expect(rows.map((row) => row.label)).toEqual(["Agents"]);
  });

  it("shortens long lists", () => {
    const rows = loadedContextRows(
      { ...loaded, skills: ["a", "b", "c", "d", "e", "f", "g"] },
      { saved: 0, recalled: 0 },
    );
    expect(rows.find((row) => row.label === "Skills")?.text).toBe("a · b · c · d · e +2");
  });

  it("still reports memory when the configuration could not be read", () => {
    expect(loadedContextRows(null, { saved: 4, recalled: 0 })).toEqual([{ label: "Memory", text: "4 saved" }]);
  });
});
