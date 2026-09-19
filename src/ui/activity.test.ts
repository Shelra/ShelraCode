import { describe, expect, it } from "vitest";
import type { ToolCall, ToolResult } from "../types/index";
import {
  type ActivityRowModel,
  classifyCommand,
  describeStatusStage,
  describeToolCall,
  describeToolResult,
  diffStat,
  formatDuration,
  phraseText,
  reasoningPreview,
  shortenPath,
  skillNameFromPath,
  summarizeCommandResult,
  summarizeGroup,
} from "./activity";

function call(name: string, input: Record<string, unknown>, id = "call_1"): ToolCall {
  return { id, type: "function", function: { name, arguments: JSON.stringify(input) } };
}

const BUN_FAIL = `bun test v1.4.1 (4661e494f)

tests\\auth.test.ts:
error: expect(received).toBe(expected)

Expected: true
Received: false
(fail) isExpired > is true exactly at expiry [0.32ms]
(fail) refreshSession > rotates the token inside the window [0.11ms]

 3 pass
 2 fail
 5 expect() calls
Ran 5 tests across 1 file. [23.00ms]`;

describe("describeToolCall", () => {
  it("names the real target of each tool", () => {
    expect(phraseText(describeToolCall(call("read_file", { path: "src/auth.ts" })))).toBe("Reading src/auth.ts");
    expect(phraseText(describeToolCall(call("read_file", { path: "a.ts", start_line: 10, end_line: 30 })))).toBe(
      "Reading a.ts · lines 10–30",
    );
    expect(phraseText(describeToolCall(call("grep", { pattern: "refreshSession" })))).toBe(
      "Searching for refreshSession",
    );
    expect(phraseText(describeToolCall(call("edit_file", { path: "src/auth.ts" })))).toBe("Editing src/auth.ts");
    expect(phraseText(describeToolCall(call("search_web", { query: "bun test reporters" })))).toBe(
      "Searching the web for bun test reporters",
    );
  });

  it("describes commands by what they do while keeping the exact command visible", () => {
    expect(describeToolCall(call("bash", { command: "bun test" }))).toEqual({
      verb: "Running tests",
      object: "bun test",
    });
    expect(describeToolCall(call("bash", { command: "tsc --noEmit" })).verb).toBe("Checking types");
    expect(describeToolCall(call("bash", { command: "ls -la" })).verb).toBe("Running");
    expect(describeToolCall(call("bash", { command: "bun run dev", background: true })).verb).toBe(
      "Starting background process",
    );
  });

  it("reads a target out of arguments that are still streaming", () => {
    const partial: ToolCall = {
      id: "c",
      type: "function",
      function: { name: "write_file", arguments: '{"path":"src/token.ts","content":"import { rando' },
    };
    expect(phraseText(describeToolCall(partial))).toBe("Writing src/token.ts");
  });

  it("never fabricates an object for a call without one", () => {
    expect(describeToolCall(call("process_list", {}))).toEqual({ verb: "Listing processes", object: "" });
  });
});

describe("describeStatusStage", () => {
  it("turns host stages into specific waiting text", () => {
    expect(phraseText(describeStatusStage("model", "Waiting for qwen/qwen3-coder:free"))).toBe(
      "Waiting for qwen/qwen3-coder:free",
    );
    expect(phraseText(describeStatusStage("mcp", "Connecting configured MCP tools"))).toBe("Connecting MCP tools");
    expect(phraseText(describeStatusStage("context", "Compiling workspace context"))).toBe(
      "Compiling workspace context",
    );
  });
});

describe("summarizeCommandResult", () => {
  it("reports pass/fail counts and the failing test names from a failing bun run", () => {
    const summary = summarizeCommandResult("bun test", BUN_FAIL, false);
    expect(summary).toMatchObject({ headline: "3 pass · 2 fail", tone: "danger", kind: "test" });
    expect(summary.failures).toEqual([
      "isExpired > is true exactly at expiry",
      "refreshSession > rotates the token inside the window",
    ]);
  });

  it("reports a clean run without listing failures", () => {
    const summary = summarizeCommandResult(
      "bun test",
      "bun test v1.4.1\nSTDERR:\n 5 pass\n 0 fail\n 6 expect() calls\nRan 5 tests across 1 file.",
      true,
    );
    expect(summary).toMatchObject({ headline: "5 pass", tone: "success", failures: [] });
  });

  it("understands vitest and jest summaries", () => {
    expect(summarizeCommandResult("bunx vitest run", " Tests  1 failed | 5 passed (6)", false).headline).toBe(
      "5 pass · 1 fail",
    );
    expect(summarizeCommandResult("npx jest", "Tests:       1 failed, 5 passed, 6 total", false).headline).toBe(
      "5 pass · 1 fail",
    );
  });

  it("counts type errors and confirms a clean check", () => {
    const errors = "src/a.ts(3,1): error TS2322: Type 'string' is not assignable to type 'number'.\nFound 1 error.";
    expect(summarizeCommandResult("tsc --noEmit", errors, false)).toMatchObject({
      headline: "1 type error",
      tone: "danger",
    });
    expect(summarizeCommandResult("bun run typecheck", "", true).headline).toBe("no type errors");
  });

  it("never reports success for a failed command it cannot parse", () => {
    const summary = summarizeCommandResult("make deploy", "make: *** [deploy] Error 2\nexit code: 2", false);
    expect(summary).toMatchObject({ headline: "exit 2", tone: "danger" });
    expect(summarizeCommandResult("echo hi", "Command executed successfully (no output)", true).headline).toBe("ok");
  });

  it("strips terminal colour codes before parsing", () => {
    const coloured = "\u001B[32m 4 pass\u001B[0m\n\u001B[31m 0 fail\u001B[0m";
    expect(summarizeCommandResult("bun test", coloured, true).headline).toBe("4 pass");
  });
});

describe("classifyCommand", () => {
  it("separates checks from ordinary commands", () => {
    expect(classifyCommand("bun run typecheck")).toBe("typecheck");
    expect(classifyCommand("bunx biome check src/")).toBe("lint");
    expect(classifyCommand("bun run build")).toBe("build");
    expect(classifyCommand("npm install zod")).toBe("install");
    expect(classifyCommand("git status")).toBe("generic");
  });
});

describe("describeToolResult", () => {
  it("shows an edit with its diffstat", () => {
    const result: ToolResult = {
      success: true,
      diff: { filePath: "src/auth.ts", additions: 1, removals: 1, patch: "", isNew: false },
    };
    const row = describeToolResult(call("edit_file", { path: "src/auth.ts" }), result);
    expect(row).toMatchObject({
      verb: "Edited",
      object: "src/auth.ts",
      meta: "+1 -1",
      group: "change",
      tone: "success",
    });
  });

  it("labels a new file as created", () => {
    const result: ToolResult = {
      success: true,
      diff: { filePath: "src/token.ts", additions: 4, removals: 0, patch: "", isNew: true },
    };
    expect(describeToolResult(call("write_file", { path: "src/token.ts" }), result)).toMatchObject({
      verb: "Created",
      meta: "+4",
    });
  });

  it("summarises a failing test run and keeps the failing names as evidence", () => {
    const row = describeToolResult(
      call("bash", { command: "bun test" }),
      { success: false, error: BUN_FAIL },
      {
        durationMs: 1300,
      },
    );
    expect(row).toMatchObject({
      verb: "Tests failed",
      object: "bun test",
      tone: "danger",
      group: "verify",
      meta: "3 pass · 2 fail · 1.3s",
    });
    expect(row?.lines).toHaveLength(2);
  });

  it("surfaces the reason when an edit fails", () => {
    const row = describeToolResult(call("edit_file", { path: "src/a.ts" }), {
      success: false,
      error: "old_string was not found in src/a.ts",
    });
    expect(row).toMatchObject({ verb: "Could not edit", tone: "danger" });
    expect(row?.lines[0]).toContain("not found");
  });

  it("ignores plan bookkeeping", () => {
    expect(describeToolResult(call("update_plan_step", { index: 1, status: "working" }), { success: true })).toBeNull();
  });
});

describe("summarizeGroup", () => {
  const rows = (verbs: string[], group: "explore" | "change") =>
    verbs.map((verb, index) => ({
      id: String(index),
      group,
      tone: "neutral" as const,
      verb,
      object: `f${index}.ts`,
      lines: [],
      operation: "x",
    }));

  it("counts reads and searches in one honest line", () => {
    expect(summarizeGroup(rows(["Read", "Read", "Searched for"], "explore")).title).toBe(
      "Read 2 files · searched 1 pattern",
    );
    expect(summarizeGroup(rows(["Searched for"], "explore")).title).toBe("Searched 1 pattern");
  });

  it("counts distinct files for changes", () => {
    const changed = rows(["Edited", "Edited"], "change");
    changed[1] = { ...changed[1]!, object: "f0.ts" };
    expect(summarizeGroup(changed).title).toBe("Changed 1 file");
  });

  it("turns red when any row failed", () => {
    const failing = rows(["Read", "Read"], "explore");
    failing[0] = { ...failing[0]!, tone: "danger" as never };
    expect(summarizeGroup(failing).tone).toBe("danger");
  });
});

describe("small formatters", () => {
  it("formats durations", () => {
    expect(formatDuration(240)).toBe("240ms");
    expect(formatDuration(1300)).toBe("1.3s");
    expect(formatDuration(12_400)).toBe("12s");
    expect(formatDuration(65_000)).toBe("1m 05s");
  });

  it("formats diffstats", () => {
    expect(diffStat({ additions: 3, removals: 1, isNew: false })).toBe("+3 -1");
    expect(diffStat({ additions: 4, removals: 0, isNew: true })).toBe("+4");
  });

  it("keeps the file name when shortening long paths", () => {
    const long = "C:\\Users\\dev\\projects\\acme\\packages\\api\\src\\session\\refresh-token.ts";
    const short = shortenPath(long, 40);
    expect(short.length).toBeLessThanOrEqual(40);
    expect(short.endsWith("refresh-token.ts")).toBe(true);
    expect(short.startsWith("…/")).toBe(true);
  });

  it("keeps only the latest thought, without markdown noise", () => {
    expect(reasoningPreview("**Checking the boundary**\nThe test expects `now === expiresAt` to be expired.")).toBe(
      "Checking the boundary The test expects now === expiresAt to be expired.",
    );
    expect(reasoningPreview("First idea. Second idea is the newest.")).toBe("Second idea is the newest.");
    expect(reasoningPreview("   ")).toBe("");
  });
});

describe("skill loads", () => {
  const read = (path: string): ToolCall => ({
    id: "r",
    type: "function",
    function: { name: "read_file", arguments: JSON.stringify({ path }) },
  });

  it("names a skill by the folder of the SKILL.md that was read", () => {
    expect(skillNameFromPath(".agents/skills/terminal-ui/SKILL.md")).toBe("terminal-ui");
    expect(skillNameFromPath("C:\\Users\\me\\.agents\\skills\\agent-browser\\SKILL.md")).toBe("agent-browser");
    expect(skillNameFromPath("src/skills.ts")).toBeNull();
    expect(skillNameFromPath("docs/SKILL.md.bak")).toBeNull();
  });

  it("turns reading a SKILL.md into a load, not a file read", () => {
    const call = read(".agents/skills/terminal-ui/SKILL.md");
    expect(describeToolCall(call)).toEqual({ verb: "Loading skill", object: "terminal-ui" });
    expect(describeToolResult(call, { success: true, output: "..." })).toMatchObject({
      group: "load",
      verb: "Loaded",
      object: "skill terminal-ui",
    });
    expect(describeToolResult(read("src/a.ts"), { success: true, output: "" })).toMatchObject({ group: "explore" });
  });

  it("folds loads and recalled memories into one line", () => {
    const rows: ActivityRowModel[] = [
      { id: "1", group: "load", tone: "neutral", verb: "Recalled", object: "2 memories", lines: [], operation: "m" },
      {
        id: "2",
        group: "load",
        tone: "neutral",
        verb: "Loaded",
        object: "skill terminal-ui",
        lines: [],
        operation: "r",
      },
      {
        id: "3",
        group: "load",
        tone: "neutral",
        verb: "Loaded",
        object: "skill agent-browser",
        lines: [],
        operation: "r",
      },
    ];
    expect(summarizeGroup(rows).title).toBe("Loaded skills terminal-ui, agent-browser · Recalled 2 memories");
    expect(summarizeGroup(rows.slice(0, 2)).title).toBe("Loaded skill terminal-ui · Recalled 2 memories");
  });
});
