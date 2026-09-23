import type { ToolSet } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  calls: [] as Array<{ event: string; name: string; detail?: string }>,
  blocked: null as string | null,
}));

const empty = { blocked: false, blockingErrors: [], preventContinuation: false, additionalContexts: [], results: [] };

vi.mock("../hooks/index", () => ({
  executeEventHooks: vi.fn(async () => empty),
  executePreToolHooks: vi.fn(async (name: string) => {
    state.calls.push({ event: "PreToolUse", name });
    if (name !== state.blocked) return empty;
    return {
      ...empty,
      blocked: true,
      blockingErrors: [{ command: "guard.sh", stderr: "edits to .env are not allowed" }],
    };
  }),
  executePostToolHooks: vi.fn(async (name: string) => {
    state.calls.push({ event: "PostToolUse", name });
    return empty;
  }),
  executePostToolFailureHooks: vi.fn(async (name: string, _input: unknown, error: string) => {
    state.calls.push({ event: "PostToolUseFailure", name, detail: error });
    return empty;
  }),
}));

const { hardenToolSet } = await import("./tools");

function fakeTools(behaviour: (name: string) => unknown): { tools: ToolSet; ran: string[] } {
  const ran: string[] = [];
  const make = (name: string) => ({
    description: name,
    inputSchema: undefined,
    execute: async () => {
      ran.push(name);
      return behaviour(name);
    },
  });
  return { tools: { edit_file: make("edit_file"), mcp_github__search: make("mcp_github__search") } as never, ran };
}

async function call(tools: ToolSet, name: string, input: unknown = { path: "a.ts" }) {
  const result = await (tools[name] as { execute: (i: unknown, o: object) => Promise<unknown> }).execute(input, {});
  await new Promise((resolve) => setTimeout(resolve, 0));
  return result;
}

const hooks = { cwd: () => "D:/repo", sessionId: "s1" };

beforeEach(() => {
  state.calls.length = 0;
  state.blocked = null;
});

describe("tool hooks run for every tool, not only bash", () => {
  it("runs PreToolUse then PostToolUse around a file edit and an MCP tool", async () => {
    const { tools } = fakeTools(() => ({ success: true, output: "ok" }));
    const hardened = hardenToolSet(tools, hooks);
    await call(hardened, "edit_file");
    await call(hardened, "mcp_github__search", { query: "x" });
    expect(state.calls).toEqual([
      { event: "PreToolUse", name: "edit_file" },
      { event: "PostToolUse", name: "edit_file" },
      { event: "PreToolUse", name: "mcp_github__search" },
      { event: "PostToolUse", name: "mcp_github__search" },
    ]);
  });

  it("lets a blocking PreToolUse hook stop the call before it runs", async () => {
    state.blocked = "edit_file";
    const { tools, ran } = fakeTools(() => ({ success: true, output: "ok" }));
    const result = await call(hardenToolSet(tools, hooks), "edit_file");
    expect(result).toEqual({ success: false, output: "[Hook blocked] edits to .env are not allowed" });
    expect(ran).toEqual([]);
    expect(state.calls.map((entry) => entry.event)).toEqual(["PreToolUse"]);
  });

  it("reports a failed result and a thrown error as PostToolUseFailure", async () => {
    const failing = hardenToolSet(fakeTools(() => ({ success: false, output: "no such file" })).tools, hooks);
    await call(failing, "edit_file");
    const throwing = hardenToolSet(
      fakeTools(() => {
        throw new Error("disk full");
      }).tools,
      hooks,
    );
    const result = (await call(throwing, "edit_file")) as { success: boolean; output: string };
    expect(result.success).toBe(false);
    const failures = state.calls.filter((entry) => entry.event === "PostToolUseFailure");
    expect(failures.map((entry) => entry.detail)).toEqual(["no such file", result.output]);
  });

  it("runs no hooks when the tool set is hardened without a hook context", async () => {
    const { tools } = fakeTools(() => ({ success: true, output: "ok" }));
    await call(hardenToolSet(tools), "edit_file");
    expect(state.calls).toEqual([]);
  });
});
