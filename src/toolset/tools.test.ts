import { mkdtemp, rm, writeFile as writeFsFile } from "fs/promises";
import os from "os";
import path from "path";
import { describe, expect, it, vi } from "vitest";
import { BashTool } from "../tools/bash";
import { createTools, hardenToolSet } from "./tools";

function createScheduleToolSet(overrides?: {
  getDaemonStatus?: () => Promise<{ running: boolean; pid: number | null }>;
  startDaemon?: () => Promise<{
    status: { running: boolean; pid: number | null };
    pid: number | null;
    alreadyRunning: boolean;
  }>;
  stopDaemon?: () => Promise<{
    status: { running: boolean; pid: number | null };
    pid: number | null;
    wasRunning: boolean;
  }>;
}) {
  const scheduleManager = {
    getDaemonStatus: overrides?.getDaemonStatus ?? vi.fn(async () => ({ running: false, pid: null })),
    startDaemon:
      overrides?.startDaemon ??
      vi.fn(async () => ({ status: { running: true, pid: 1234 }, pid: 1234, alreadyRunning: false })),
    stopDaemon:
      overrides?.stopDaemon ??
      vi.fn(async () => ({ status: { running: false, pid: null }, pid: 1234, wasRunning: true })),
  };

  const tools = createTools(new BashTool("/tmp"), {} as never, "agent", {
    scheduleManager: scheduleManager as never,
    toolGroups: { schedules: true },
  });

  return {
    tools: tools as Record<string, { execute: (input: unknown, context?: unknown) => Promise<unknown> }>,
    scheduleManager,
  };
}

describe("schedule daemon tools", () => {
  it("publishes executable plans in normal agent mode", async () => {
    const tools = createTools(new BashTool("/tmp"), {} as never, "agent") as Record<
      string,
      { execute: (input: unknown, context?: unknown) => Promise<unknown>; description?: string }
    >;

    expect(tools.generate_plan.description).toContain("acceptance criteria");
    const result = (await tools.generate_plan.execute(
      {
        title: "Implement clock",
        summary: "Create and verify a clock.",
        goal: "A working clock is visible.",
        requirements: ["Show HH:MM:SS"],
        acceptanceCriteria: [
          { id: "AC1", description: "Clock updates", verification: "observe the value change in a browser" },
        ],
        steps: [
          {
            title: "Build clock",
            description: "Create the UI and timer.",
            filePaths: ["index.html"],
            satisfies: ["AC1"],
          },
        ],
      },
      {},
    )) as {
      success: boolean;
      output: string;
      plan: { goal: string; acceptanceCriteria: unknown[]; steps: Array<{ status?: string }> };
    };

    expect(result.success).toBe(true);
    expect(result.output).toContain("Goal: A working clock is visible.");
    expect(result.output).toContain("AC1. Clock updates");
    expect(result.output).toContain("satisfies: AC1");
    expect(result.plan).toMatchObject({ goal: "A working clock is visible." });
    expect(result.plan.steps[0]?.status).toBe("pending");

    const update = (await tools.update_plan_step.execute(
      { index: 1, status: "working", evidence: "Editing index.html" },
      {},
    )) as { success: boolean; planUpdate: { index: number; status: string; evidence: string } };
    expect(update).toMatchObject({
      success: true,
      planUpdate: { index: 0, status: "working", evidence: "Editing index.html" },
    });
  });

  it("normalizes loosely shaped plans from weaker models instead of rejecting them", async () => {
    const tools = createTools(new BashTool("/tmp"), {} as never, "agent") as Record<
      string,
      { execute: (input: unknown, context?: unknown) => Promise<unknown> }
    >;

    const result = (await tools.generate_plan.execute(
      {
        title: "Slugify",
        goal: "slugify works",
        acceptanceCriteria: ["tests pass", { description: "lowercases", verification: "bun test" }],
        steps: ["Implement slugify", { title: "Run tests", satisfies: ["AC1"] }],
      },
      {},
    )) as { success: boolean; plan: { summary: string; acceptanceCriteria: unknown[]; steps: unknown[] } };

    expect(result.success).toBe(true);
    expect(result.plan.summary).toBe("slugify works");
    expect(result.plan.acceptanceCriteria).toEqual([
      { id: "AC1", description: "tests pass", verification: "Run the project's relevant check and observe it pass" },
      { id: "AC2", description: "lowercases", verification: "bun test" },
    ]);
    expect(result.plan.steps).toEqual([
      { title: "Implement slugify", description: "Implement slugify", satisfies: [], status: "pending" },
      { title: "Run tests", description: "Run tests", satisfies: ["AC1"], status: "pending" },
    ]);
  });

  it("lets canonical file mutations proceed without a published plan", async () => {
    // The plan is guidance the prompt asks for on non-trivial work, not a gate: blocking every
    // edit behind a nested plan schema made mid-tier models fumble the schema and give up
    // (observed 2026-09-17). Verification, not planning, is what the host enforces.
    const cwd = await mkdtemp(path.join(os.tmpdir(), "shelra-tools-noplan-"));
    const tools = createTools(new BashTool(cwd), {} as never, "agent") as Record<
      string,
      { execute: (input: unknown, context?: unknown) => Promise<unknown> }
    >;

    const result = (await tools.write_file.execute({ path: "created.txt", content: "yes" }, {})) as {
      success: boolean;
      output: string;
    };

    expect(result.success).toBe(true);
    expect(result.output).toContain("Created created.txt");
    await rm(cwd, { recursive: true, force: true });
  });

  it("checkpoints a file immediately before delete_file removes it", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "shelra-tools-delete-"));
    const filePath = path.join(cwd, "doomed.txt");
    await writeFsFile(filePath, "will be deleted\n", "utf8");

    const onCheckpoint = vi.fn();
    const bash = new BashTool(cwd);
    const tools = createTools(bash, {} as never, "agent", { onCheckpoint }) as Record<
      string,
      { execute: (input: unknown, context?: unknown) => Promise<unknown> }
    >;

    await tools.generate_plan.execute(
      {
        title: "Remove doomed file",
        summary: "Delete it.",
        goal: "The file is gone.",
        requirements: ["doomed.txt no longer exists"],
        acceptanceCriteria: [{ id: "AC1", description: "File removed", verification: "check it is missing" }],
        steps: [
          { title: "Delete it", description: "Remove doomed.txt", filePaths: ["doomed.txt"], satisfies: ["AC1"] },
        ],
      },
      {},
    );

    const result = (await tools.delete_file.execute({ path: "doomed.txt" }, {})) as {
      success: boolean;
      diff?: { removals: number; additions: number };
    };

    expect(result.success).toBe(true);
    expect(result.diff).toMatchObject({ removals: 1, additions: 0 });
    expect(onCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({ filePath: "doomed.txt", previousExisted: true, reason: "pre-delete" }),
    );
    await rm(cwd, { recursive: true, force: true });
  });

  it("keeps a published plan valid across repeated createTools calls sharing the same planState", async () => {
    // Reproduces the live bug (docs/architecture/14-AGENT-HARNESS-RECONSTRUCTION.md §15): the turn
    // loop calls createTools fresh on every round, including verification-nudge retries — without
    // a shared planState reference, each fresh call started its own planPublished=false closure,
    // forcing a redundant generate_plan call before the model could touch a file again mid-turn.
    const cwd = await mkdtemp(path.join(os.tmpdir(), "shelra-tools-planstate-"));
    const planState = { published: false, structured: false };

    const round1 = createTools(new BashTool(cwd), {} as never, "agent", { planState }) as Record<
      string,
      { execute: (input: unknown, context?: unknown) => Promise<unknown> }
    >;
    await round1.generate_plan.execute(
      {
        title: "Write a file",
        summary: "Write it.",
        goal: "a.txt exists.",
        requirements: ["a.txt is created"],
        acceptanceCriteria: [{ id: "AC1", description: "File exists", verification: "read it back" }],
        steps: [{ title: "Write it", description: "Create a.txt", filePaths: ["a.txt"], satisfies: ["AC1"] }],
      },
      {},
    );
    expect(planState).toEqual({ published: true, structured: true });

    // Round 2: a brand-new createTools call — simulating the next turn-loop iteration — but
    // sharing the SAME planState object, as the real turn loop now does. No new plan needed.
    const round2 = createTools(new BashTool(cwd), {} as never, "agent", { planState }) as Record<
      string,
      { execute: (input: unknown, context?: unknown) => Promise<unknown> }
    >;
    const result = (await round2.write_file.execute({ path: "a.txt", content: "two" }, {})) as { success: boolean };
    expect(result.success).toBe(true);
    const update = (await round2.update_plan_step.execute({ index: 1, status: "working" }, {})) as {
      success: boolean;
    };
    expect(update.success).toBe(true);

    await rm(cwd, { recursive: true, force: true });
  });

  it("describes bash sandbox constraints when shuru mode is enabled", () => {
    const tools = createTools(new BashTool("/tmp", { sandboxMode: "shuru" }), {} as never, "agent");
    const bashTool = tools.bash as { description?: string };

    expect(bashTool.description).toContain("Shuru sandbox");
    expect(bashTool.description).toContain("do not persist back to the host");
  });

  it("reflects network enabled in sandbox tool description", () => {
    const tools = createTools(
      new BashTool("/tmp", { sandboxMode: "shuru", sandboxSettings: { allowNet: true } }),
      {} as never,
      "agent",
    );
    const bashTool = tools.bash as { description?: string };
    expect(bashTool.description).toContain("network access is enabled");
  });

  it("reflects restricted hosts in sandbox tool description", () => {
    const tools = createTools(
      new BashTool("/tmp", {
        sandboxMode: "shuru",
        sandboxSettings: { allowNet: true, allowedHosts: ["api.openai.com"] },
      }),
      {} as never,
      "agent",
    );
    const bashTool = tools.bash as { description?: string };
    expect(bashTool.description).toContain("network is restricted to: api.openai.com");
  });

  it("mentions host-side browser automation when enabled", () => {
    const tools = createTools(
      new BashTool("/tmp", {
        sandboxMode: "shuru",
        sandboxSettings: { allowNet: true, hostBrowserCommandsOnHost: true },
      }),
      {} as never,
      "agent",
    );
    const bashTool = tools.bash as { description?: string };
    expect(bashTool.description).toContain("agent-browser run on the host");
  });

  it("routes verify task requests through the task tool", async () => {
    const runTask = vi.fn(async () => ({ success: true, output: "verified" }));
    const tools = createTools(new BashTool("/tmp"), {} as never, "agent", {
      runTask,
      subagents: [],
    }) as Record<string, { execute: (input: unknown, context?: unknown) => Promise<unknown>; description?: string }>;

    const taskTool = tools.task;
    expect(taskTool.description).toContain("`verify`");

    const result = (await taskTool.execute(
      {
        agent: "verify",
        description: "Run local verification",
        prompt: "Verify the current workspace.",
      },
      { abortSignal: undefined },
    )) as { success: boolean; output: string };

    expect(runTask).toHaveBeenCalledWith(
      {
        agent: "verify",
        description: "Run local verification",
        prompt: "Verify the current workspace.",
      },
      undefined,
    );
    expect(result).toEqual({ success: true, output: "verified" });
  });

  it("routes verify-detect task requests through the task tool", async () => {
    const runTask = vi.fn(async () => ({ success: true, output: "recipe" }));
    const tools = createTools(new BashTool("/tmp"), {} as never, "agent", {
      runTask,
      subagents: [],
    }) as Record<string, { execute: (input: unknown, context?: unknown) => Promise<unknown>; description?: string }>;

    const taskTool = tools.task;
    expect(taskTool.description).toContain("`verify-detect`");

    const result = (await taskTool.execute(
      {
        agent: "verify-detect",
        description: "Detect verification recipe",
        prompt: "Inspect the repository and return a VerifyRecipe JSON object.",
      },
      { abortSignal: undefined },
    )) as { success: boolean; output: string };

    expect(runTask).toHaveBeenCalledWith(
      {
        agent: "verify-detect",
        description: "Detect verification recipe",
        prompt: "Inspect the repository and return a VerifyRecipe JSON object.",
      },
      undefined,
    );
    expect(result).toEqual({ success: true, output: "recipe" });
  });

  it("routes verify-manifest task requests through the task tool", async () => {
    const runTask = vi.fn(async () => ({ success: true, output: "manifest written" }));
    const tools = createTools(new BashTool("/tmp"), {} as never, "agent", {
      runTask,
      subagents: [],
    }) as Record<string, { execute: (input: unknown, context?: unknown) => Promise<unknown>; description?: string }>;

    const taskTool = tools.task;
    expect(taskTool.description).toContain("`verify-manifest`");

    const result = (await taskTool.execute(
      {
        agent: "verify-manifest",
        description: "Create verify manifest",
        prompt: "Inspect the repository and write .shelra/environment.json.",
      },
      { abortSignal: undefined },
    )) as { success: boolean; output: string };

    expect(runTask).toHaveBeenCalledWith(
      {
        agent: "verify-manifest",
        description: "Create verify manifest",
        prompt: "Inspect the repository and write .shelra/environment.json.",
      },
      undefined,
    );
    expect(result).toEqual({ success: true, output: "manifest written" });
  });

  it("exposes computer tools and routes computer task requests", async () => {
    const runTask = vi.fn(async () => ({ success: true, output: "computer-ready" }));
    const tools = createTools(new BashTool("/tmp"), {} as never, "agent", {
      runTask,
      subagents: [],
      toolGroups: { desktop: true },
    }) as Record<string, { execute: (input: unknown, context?: unknown) => Promise<unknown>; description?: string }>;

    expect(tools).toHaveProperty("computer_screenshot");
    expect(tools).toHaveProperty("computer_snapshot");
    expect(tools).toHaveProperty("computer_click");
    expect(tools).toHaveProperty("computer_mouse_move");
    expect(tools).toHaveProperty("computer_type");
    expect(tools).toHaveProperty("computer_press");
    expect(tools).toHaveProperty("computer_scroll");
    expect(tools).toHaveProperty("computer_launch");
    expect(tools).toHaveProperty("computer_list_windows");
    expect(tools).toHaveProperty("computer_focus_window");
    expect(tools).toHaveProperty("computer_wait");
    expect(tools).toHaveProperty("computer_get");

    const taskTool = tools.task;
    expect(taskTool.description).toContain("`computer`");

    const result = (await taskTool.execute(
      {
        agent: "computer",
        description: "Drive the host desktop",
        prompt: "Take a screenshot and click the requested target.",
      },
      { abortSignal: undefined },
    )) as { success: boolean; output: string };

    expect(runTask).toHaveBeenCalledWith(
      {
        agent: "computer",
        description: "Drive the host desktop",
        prompt: "Take a screenshot and click the requested target.",
      },
      undefined,
    );
    expect(result).toEqual({ success: true, output: "computer-ready" });
  });

  it("reports daemon status", async () => {
    const { tools } = createScheduleToolSet({
      getDaemonStatus: async () => ({ running: true, pid: 4321 }),
    });

    const result = (await tools.schedule_daemon_status.execute({}, {})) as { success: boolean; output: string };

    expect(result.success).toBe(true);
    expect(result.output).toContain("Daemon status: running");
    expect(result.output).toContain("4321");
  });

  it("formats daemon start output for a fresh start", async () => {
    const { tools } = createScheduleToolSet({
      startDaemon: async () => ({ status: { running: true, pid: 5555 }, pid: 5555, alreadyRunning: false }),
    });

    const result = (await tools.schedule_daemon_start.execute({}, {})) as { success: boolean; output: string };

    expect(result.success).toBe(true);
    expect(result.output).toBe("Schedule daemon started (pid 5555).");
  });

  it("formats daemon start output when already running", async () => {
    const { tools } = createScheduleToolSet({
      startDaemon: async () => ({ status: { running: true, pid: 7777 }, pid: 7777, alreadyRunning: true }),
    });

    const result = (await tools.schedule_daemon_start.execute({}, {})) as { success: boolean; output: string };

    expect(result.success).toBe(true);
    expect(result.output).toBe("Schedule daemon already running (pid 7777).");
  });

  it("formats daemon stop output", async () => {
    const { tools } = createScheduleToolSet({
      stopDaemon: async () => ({ status: { running: false, pid: null }, pid: 8888, wasRunning: true }),
    });

    const result = (await tools.schedule_daemon_stop.execute({}, {})) as { success: boolean; output: string };

    expect(result.success).toBe(true);
    expect(result.output).toBe("Schedule daemon stopped (pid 8888).");
  });
});

describe("memory tools", () => {
  it("reports no memory saved yet before anything is written", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "shelra-tools-memory-"));
    const tools = createTools(new BashTool(cwd), {} as never, "agent") as Record<
      string,
      { execute: (input: unknown, context?: unknown) => Promise<unknown> }
    >;

    const result = (await tools.memory_list.execute({}, {})) as { success: boolean; output: string };
    expect(result).toEqual({ success: true, output: "No project memory saved yet." });
    await rm(cwd, { recursive: true, force: true });
  });

  it("writes a memory entry, lists it in the index, and reads its full body back", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "shelra-tools-memory-"));
    const tools = createTools(new BashTool(cwd), {} as never, "agent") as Record<
      string,
      { execute: (input: unknown, context?: unknown) => Promise<unknown> }
    >;

    const writeResult = (await tools.memory_write.execute(
      {
        slug: "better-auth-org-plugin",
        title: "Better Auth organization plugin",
        hook: "Use the org plugin for multi-tenancy instead of hand-rolling memberships",
        type: "architecture",
        description: "Research notes on Better Auth's organization plugin for CITADEL's multi-tenancy",
        body: "The organization plugin provides memberships, invitations, and roles out of the box.",
      },
      {},
    )) as { success: boolean; output: string };
    expect(writeResult).toEqual({ success: true, output: 'Saved memory entry "better-auth-org-plugin".' });

    const listResult = (await tools.memory_list.execute({}, {})) as { success: boolean; output: string };
    expect(listResult.success).toBe(true);
    expect(listResult.output).toContain("Better Auth organization plugin");
    expect(listResult.output).toContain("better-auth-org-plugin.md");

    const readResult = (await tools.memory_read.execute({ slug: "better-auth-org-plugin" }, {})) as {
      success: boolean;
      output: string;
    };
    expect(readResult.success).toBe(true);
    expect(readResult.output).toContain("Research notes on Better Auth's organization plugin");
    expect(readResult.output).toContain("memberships, invitations, and roles out of the box");

    await rm(cwd, { recursive: true, force: true });
  });

  it("fails clearly when reading a memory slug that was never saved", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "shelra-tools-memory-"));
    const tools = createTools(new BashTool(cwd), {} as never, "agent") as Record<
      string,
      { execute: (input: unknown, context?: unknown) => Promise<unknown> }
    >;

    const result = (await tools.memory_read.execute({ slug: "does-not-exist" }, {})) as {
      success: boolean;
      output: string;
    };
    expect(result.success).toBe(false);
    expect(result.output).toContain('No saved memory entry named "does-not-exist"');
    await rm(cwd, { recursive: true, force: true });
  });

  it("is not gated by the plan-required check — memory is not a file mutation", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "shelra-tools-memory-"));
    const tools = createTools(new BashTool(cwd), {} as never, "agent") as Record<
      string,
      { execute: (input: unknown, context?: unknown) => Promise<unknown> }
    >;

    const result = (await tools.memory_write.execute(
      {
        slug: "no-plan-needed",
        title: "No plan needed",
        hook: "Memory writes work before generate_plan",
        type: "decisions",
        description: "Proves memory_write isn't behind the write_file/edit_file plan gate",
        body: "The decision and its reasoning, kept long enough to be a real memory entry.",
      },
      {},
    )) as { success: boolean };
    expect(result.success).toBe(true);
    await rm(cwd, { recursive: true, force: true });
  });

  it("deletes a memory entry — removing both the index line and the topic file", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "shelra-tools-memory-"));
    const tools = createTools(new BashTool(cwd), {} as never, "agent") as Record<
      string,
      { execute: (input: unknown, context?: unknown) => Promise<unknown> }
    >;

    await tools.memory_write.execute(
      {
        slug: "old-decision",
        title: "Old decision",
        hook: "This turned out to be wrong",
        type: "decisions",
        description: "A decision later superseded",
        body: "The decision and its reasoning, kept long enough to be a real memory entry.",
      },
      {},
    );

    const deleteResult = (await tools.memory_delete.execute({ slug: "old-decision" }, {})) as {
      success: boolean;
      output: string;
    };
    expect(deleteResult).toEqual({ success: true, output: 'Deleted memory entry "old-decision".' });

    const listResult = (await tools.memory_list.execute({}, {})) as { success: boolean; output: string };
    expect(listResult).toEqual({ success: true, output: "No project memory saved yet." });

    const readResult = (await tools.memory_read.execute({ slug: "old-decision" }, {})) as { success: boolean };
    expect(readResult.success).toBe(false);

    await rm(cwd, { recursive: true, force: true });
  });

  it("fails clearly when deleting a memory slug that was never saved", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "shelra-tools-memory-"));
    const tools = createTools(new BashTool(cwd), {} as never, "agent") as Record<
      string,
      { execute: (input: unknown, context?: unknown) => Promise<unknown> }
    >;

    const result = (await tools.memory_delete.execute({ slug: "does-not-exist" }, {})) as {
      success: boolean;
      output: string;
    };
    expect(result.success).toBe(false);
    expect(result.output).toContain('No saved memory entry named "does-not-exist"');
    await rm(cwd, { recursive: true, force: true });
  });

  it("memory_delete is not gated by the plan-required check either", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "shelra-tools-memory-"));
    const tools = createTools(new BashTool(cwd), {} as never, "agent") as Record<
      string,
      { execute: (input: unknown, context?: unknown) => Promise<unknown> }
    >;

    await tools.memory_write.execute(
      {
        slug: "to-remove",
        title: "To remove",
        hook: "hook",
        type: "decisions",
        description: "description",
        body: "A durable note kept long enough to count as a real memory entry.",
      },
      {},
    );
    const result = (await tools.memory_delete.execute({ slug: "to-remove" }, {})) as { success: boolean };
    expect(result.success).toBe(true);
    await rm(cwd, { recursive: true, force: true });
  });
});

describe("hardenToolSet", () => {
  it("turns a tool that throws into a failed result with a way forward", async () => {
    const missing = Object.assign(new Error("spawn rg ENOENT"), { code: "ENOENT" });
    const tools = hardenToolSet({
      grep: { description: "search", inputSchema: {} as never, execute: async () => Promise.reject(missing) },
    } as never);
    const result = (await tools.grep.execute?.({}, { toolCallId: "t", messages: [] })) as {
      success: boolean;
      output: string;
    };
    expect(result.success).toBe(false);
    expect(result.output).toContain("something it needs is missing");
    expect(result.output).toContain("use another tool or approach");
  });

  it("still lets the user's cancellation through", async () => {
    const controller = new AbortController();
    controller.abort();
    const tools = hardenToolSet({
      slow: {
        description: "slow",
        inputSchema: {} as never,
        execute: async () => Promise.reject(new Error("aborted")),
      },
    } as never);
    await expect(
      tools.slow.execute?.({}, { toolCallId: "t", messages: [], abortSignal: controller.signal }),
    ).rejects.toThrow("aborted");
  });
});
