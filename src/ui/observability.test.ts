import { describe, expect, it } from "vitest";
import type { KernelState } from "../agent/kernel";
import { MEMORY_INDEX_MAX_BYTES, MEMORY_INDEX_MAX_LINES } from "../memory/store";
import type { ChatEntry, Plan } from "../types/index";
import {
  AGENT_IDLE_COLLAPSE_MS,
  changedFiles,
  completionLabel,
  completionStatus,
  describeReasoningEffort,
  groupLiveActivity,
  nextPlanStepLabel,
  phaseLabel,
  projectTranscript,
  resolveAgentDisclosure,
  resolvePlanState,
  summarizeMemoryStatus,
  summarizeSessionUsage,
  type UiActivityEvent,
  upsertActivity,
  visibleRuntimeActivity,
} from "./observability";

function kernel(overrides: Partial<KernelState> = {}): KernelState {
  return {
    taskId: "task-1",
    objective: "Restore a session",
    phase: "act",
    scope: [],
    mutations: [],
    observations: [],
    attemptCount: 0,
    verificationPassed: false,
    reviewPassed: false,
    ...overrides,
  };
}

describe("observability projections", () => {
  it("uses the host kernel phase instead of a generated status string", () => {
    expect(phaseLabel(kernel({ phase: "discover" }), true)).toBe("Inspecting project");
    expect(phaseLabel(kernel({ phase: "review" }), false)).toBe("Verification needed");
    expect(phaseLabel(kernel({ phase: "act" }), false)).toBe("Paused: Working");
    expect(phaseLabel(null, true)).toBe("Starting turn");
    expect(phaseLabel(null, false)).toBe("Idle");
  });

  it("keeps review distinct from an allowed completion", () => {
    expect(completionStatus(kernel({ phase: "review" }), false)).toBe("verification-needed");
    expect(completionStatus(kernel({ phase: "complete" }), false)).toBe("passed");
    expect(completionStatus(kernel({ phase: "act" }), false)).toBe("paused");
    expect(completionLabel("verification-needed")).toBe("Host verification needed");
  });

  it("replaces an active event with its completion without duplicating it", () => {
    const active = {
      id: "tool:1",
      kind: "tool" as const,
      status: "active" as const,
      label: "Read file",
      at: 10,
    };
    const complete = { ...active, status: "complete" as const, detail: "exit 0", at: 20 };

    const result = upsertActivity(upsertActivity([], active), complete);

    expect(result).toEqual([complete]);
  });

  it("bounds activity history and preserves chronological order", () => {
    const result = [1, 3, 2].reduce<UiActivityEvent[]>(
      (events, n) =>
        upsertActivity(
          events,
          {
            id: String(n),
            kind: "step",
            status: "complete",
            label: `Step ${n}`,
            at: n,
          },
          2,
        ),
      [],
    );

    expect(result.map((event) => event.id)).toEqual(["2", "3"]);
  });

  it("derives changed files from kernel mutations and persisted tool results", () => {
    const entries: ChatEntry[] = [
      {
        type: "tool_result",
        content: "updated",
        timestamp: new Date(),
        toolResult: {
          success: true,
          diff: {
            filePath: "src/ui/app.tsx",
            additions: 2,
            removals: 1,
            patch: "@@",
            isNew: false,
          },
        },
      },
    ];

    expect(changedFiles(entries, kernel({ mutations: ["README.md", "src/ui/app.tsx"] }))).toEqual([
      "README.md",
      "src/ui/app.tsx",
    ]);
  });

  it("summarizes persisted usage without inventing missing fields", () => {
    const summary = summarizeSessionUsage([
      {
        id: 1,
        sessionId: "session-1",
        messageSeq: null,
        source: "message",
        model: "openrouter/free",
        inputTokens: 10,
        outputTokens: 4,
        totalTokens: 14,
        costMicros: 0,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      },
      {
        id: 2,
        sessionId: "session-1",
        messageSeq: null,
        source: "task",
        model: "openrouter/free",
        inputTokens: 3,
        outputTokens: 2,
        totalTokens: 5,
        costMicros: 12,
        createdAt: new Date("2026-01-01T00:01:00.000Z"),
      },
    ]);

    expect(summary.inputTokens).toBe(13);
    expect(summary.outputTokens).toBe(6);
    expect(summary.totalTokens).toBe(19);
    expect(summary.costMicros).toBe(12);
    expect(summary.eventCount).toBe(2);
    expect(summary.models).toEqual(["openrouter/free"]);
    expect(summary.sources).toEqual(["message", "task"]);
  });

  it("never presents internal model steps as user-facing activity", () => {
    const visible = visibleRuntimeActivity([
      {
        id: "step:1",
        kind: "step",
        status: "active",
        label: "Step 1",
        detail: "Model turn started",
        at: 1,
      },
      {
        id: "tool:1",
        kind: "tool",
        status: "active",
        label: "Running tests",
        operation: "bash",
        at: 2,
      },
    ]);

    expect(visible.map((event) => event.label)).toEqual(["Running tests"]);
  });

  it("collapses consecutive repository exploration into one meaningful transcript row", () => {
    const at = new Date("2026-01-01T00:00:00.000Z");
    const entries: ChatEntry[] = [
      {
        type: "tool_call",
        content: "read_file",
        timestamp: at,
        toolCall: {
          id: "read-1",
          type: "function",
          function: { name: "read_file", arguments: JSON.stringify({ path: "src/a.ts" }) },
        },
      },
      {
        type: "tool_result",
        content: "a",
        timestamp: at,
        toolCall: {
          id: "read-1",
          type: "function",
          function: { name: "read_file", arguments: JSON.stringify({ path: "src/a.ts" }) },
        },
        toolResult: { success: true, output: "a" },
      },
      {
        type: "tool_result",
        content: "matches",
        timestamp: new Date(at.getTime() + 1),
        toolCall: {
          id: "grep-1",
          type: "function",
          function: { name: "grep", arguments: JSON.stringify({ query: "hydrate" }) },
        },
        toolResult: { success: true, output: "matches" },
      },
    ];

    expect(projectTranscript(entries)).toMatchObject([
      {
        kind: "activity",
        activityKind: "exploration",
        status: "complete",
        title: "Explored repository · 2 operations",
        details: ["Read src/a.ts", "Searched hydrate"],
        count: 2,
      },
    ]);
  });

  it("keeps failed verification visible and separate from successful checks", () => {
    const at = new Date("2026-01-01T00:00:00.000Z");
    const command = (id: string, success: boolean, offset: number): ChatEntry => ({
      type: "tool_result",
      content: success ? "18 passed" : "1 failed",
      timestamp: new Date(at.getTime() + offset),
      toolCall: {
        id,
        type: "function",
        function: { name: "bash", arguments: JSON.stringify({ command: `bun run test ${id}` }) },
      },
      toolResult: { success, output: success ? "18 passed" : "1 failed", error: success ? undefined : "1 failed" },
    });

    const projected = projectTranscript([command("one", true, 0), command("two", false, 1)]);
    expect(projected).toMatchObject([
      {
        kind: "activity",
        activityKind: "verification",
        status: "failed",
        title: "Verification failed",
        count: 2,
      },
    ]);
  });

  it("reports deleted files separately from updated files in the collapsed transcript title", () => {
    const at = new Date("2026-01-01T00:00:00.000Z");
    const fileOp = (id: string, name: string, filePath: string, offset: number): ChatEntry => ({
      type: "tool_result",
      content: name,
      timestamp: new Date(at.getTime() + offset),
      toolCall: {
        id,
        type: "function",
        function: { name, arguments: JSON.stringify({ path: filePath }) },
      },
      toolResult: {
        success: true,
        output: name,
        diff: { filePath, additions: 1, removals: 0, patch: "", isNew: true },
      },
    });

    const onlyDeletes = projectTranscript([fileOp("del-1", "delete_file", "src/old.ts", 0)]);
    expect(onlyDeletes).toMatchObject([{ activityKind: "changes", title: "Deleted 1 file" }]);

    const mixed = projectTranscript([
      fileOp("write-1", "write_file", "src/new.ts", 0),
      fileOp("del-2", "delete_file", "src/old.ts", 1),
    ]);
    expect(mixed).toMatchObject([{ activityKind: "changes", title: "Updated 1 file · deleted 1" }]);
  });

  it("replays explicit runtime plan updates without inferring progress", () => {
    const at = new Date("2026-01-01T00:00:00.000Z");
    const entries: ChatEntry[] = [
      {
        type: "tool_result",
        content: "plan",
        timestamp: at,
        toolResult: {
          success: true,
          plan: {
            title: "Restore session",
            summary: "Restore it",
            steps: [
              { title: "Trace hydration", description: "Trace it" },
              { title: "Verify restart", description: "Verify it" },
            ],
          },
        },
      },
      {
        type: "tool_result",
        content: "working",
        timestamp: new Date(at.getTime() + 1),
        toolResult: {
          success: true,
          planUpdate: { index: 0, status: "complete", evidence: "Hydration path traced" },
        },
      },
      {
        type: "tool_result",
        content: "working",
        timestamp: new Date(at.getTime() + 2),
        toolResult: { success: true, planUpdate: { index: 1, status: "working" } },
      },
    ];

    expect(resolvePlanState(entries)?.steps).toMatchObject([
      { status: "complete", evidence: "Hydration path traced" },
      { status: "working" },
    ]);
  });
});

function toolEvent(operation: string, overrides: Partial<UiActivityEvent> = {}): UiActivityEvent {
  return {
    id: `tool:${operation}:${Math.random()}`,
    kind: "tool",
    status: "active",
    label: operation,
    operation,
    at: 0,
    ...overrides,
  };
}

describe("groupLiveActivity", () => {
  it("counts routine operations instead of listing one line per tool call", () => {
    const events = [
      toolEvent("read_file"),
      toolEvent("read_file"),
      toolEvent("grep"),
      toolEvent("read_file"),
      toolEvent("grep"),
    ];

    expect(groupLiveActivity(events)).toEqual([
      { key: "explored", text: "Explored 3 files" },
      { key: "searched", text: "Searched 2 symbols" },
    ]);
  });

  it("uses singular phrasing for a single occurrence", () => {
    expect(groupLiveActivity([toolEvent("read_file")])).toEqual([{ key: "explored", text: "Explored 1 file" }]);
  });

  it("produces no line for a category with zero events", () => {
    expect(groupLiveActivity([toolEvent("read_file")])).not.toContainEqual(
      expect.objectContaining({ key: "searched" }),
    );
  });

  it("counts research, file changes, and commands separately", () => {
    const events = [
      toolEvent("search_web"),
      toolEvent("open_web"),
      toolEvent("write_file"),
      toolEvent("bash"),
      toolEvent("bash"),
    ];

    expect(groupLiveActivity(events)).toEqual([
      { key: "researched", text: "Researched 2 sources" },
      { key: "changed", text: "Updated 1 file" },
      { key: "commands", text: "Ran 2 commands" },
    ]);
  });

  it("returns an empty list for events with no groupable operation", () => {
    expect(groupLiveActivity([toolEvent("update_plan_step")])).toEqual([]);
  });

  it("counts deleted files separately from updated files", () => {
    const events = [toolEvent("write_file"), toolEvent("delete_file"), toolEvent("delete_file")];

    expect(groupLiveActivity(events)).toEqual([
      { key: "changed", text: "Updated 1 file" },
      { key: "deleted", text: "Deleted 2 files" },
    ]);
  });
});

describe("nextPlanStepLabel", () => {
  function plan(steps: Plan["steps"]): Plan {
    return { title: "t", summary: "s", steps };
  }

  it("returns the first not-yet-started step", () => {
    const result = plan([
      { title: "Understand", description: "Read the request", status: "complete" },
      { title: "Fix hydration", description: "Patch task hydration and run restart test", status: "pending" },
      { title: "Verify", description: "Verify", status: "pending" },
    ]);

    expect(nextPlanStepLabel(result)).toBe("Fix hydration — Patch task hydration and run restart test");
  });

  it("returns null when every step is already started or done (never invents a next action)", () => {
    const result = plan([
      { title: "Understand", description: "d", status: "complete" },
      { title: "Implement", description: "d", status: "working" },
    ]);

    expect(nextPlanStepLabel(result)).toBeNull();
  });

  it("returns null when there is no plan", () => {
    expect(nextPlanStepLabel(null)).toBeNull();
  });

  it("treats a step with no status as pending", () => {
    const result = plan([{ title: "Ship it", description: "Ship it" }]);
    expect(nextPlanStepLabel(result)).toBe("Ship it");
  });
});

describe("describeReasoningEffort", () => {
  it("reports the model does not support it at all, over anything else", () => {
    expect(describeReasoningEffort("high", undefined, "high", [])).toBe("not supported");
  });

  it("shows an explicit session-wide /effort override the model actually supports", () => {
    expect(describeReasoningEffort("low", undefined, "high", ["low", "medium", "high"])).toBe("low");
  });

  it("ignores a /effort override the model does not support and falls back to the effective value", () => {
    expect(describeReasoningEffort("xhigh", undefined, "high", ["low", "medium", "high"])).toBe("high (auto)");
  });

  it("labels the automatic default as auto, not a bare value, so it isn't mistaken for an explicit choice", () => {
    expect(describeReasoningEffort(null, undefined, "high", ["low", "medium", "high"])).toBe("high (auto)");
  });

  it("shows plain auto when nothing explicit will be sent (e.g. plan/ask mode)", () => {
    expect(describeReasoningEffort(null, undefined, undefined, ["low", "medium", "high"])).toBe("auto");
  });

  it("falls back to the /models per-model choice when there is no session-wide /effort override", () => {
    expect(describeReasoningEffort(null, "low", "high", ["low", "medium", "high"])).toBe("low");
  });

  it("prefers the session-wide /effort override over a per-model choice when both are set", () => {
    expect(describeReasoningEffort("medium", "low", "high", ["low", "medium", "high"])).toBe("medium");
  });

  it("ignores a per-model choice the model does not support", () => {
    expect(describeReasoningEffort(null, "xhigh", "high", ["low", "medium", "high"])).toBe("high (auto)");
  });
});

describe("summarizeMemoryStatus", () => {
  it("reports zero entries and zero capacity for an empty/missing index", () => {
    expect(summarizeMemoryStatus({ entries: [], raw: "" })).toEqual({ entryCount: 0, capacityRatio: 0 });
  });

  it("reports the real entry count and the line-cap ratio when it is the binding constraint", () => {
    const entries = Array.from({ length: 20 }, (_, i) => ({ title: `T${i}`, file: `t${i}.md`, hook: "hook" }));
    const raw = `${entries.map((e) => `- [${e.title}](${e.file}) — ${e.hook}`).join("\n")}\n`;

    const result = summarizeMemoryStatus({ entries, raw });

    expect(result.entryCount).toBe(20);
    expect(result.capacityRatio).toBeCloseTo(20 / MEMORY_INDEX_MAX_LINES, 5);
  });

  it("uses the byte-cap ratio when it is more binding than the line-cap ratio", () => {
    const longHook = "x".repeat(2_000);
    const entries = [{ title: "One giant entry", file: "one.md", hook: longHook }];
    const raw = `- [One giant entry](one.md) — ${longHook}\n`;

    const result = summarizeMemoryStatus({ entries, raw });

    const expectedByteRatio = Buffer.byteLength(raw, "utf8") / MEMORY_INDEX_MAX_BYTES;
    expect(result.capacityRatio).toBeCloseTo(expectedByteRatio, 5);
    expect(result.capacityRatio).toBeGreaterThan(1 / MEMORY_INDEX_MAX_LINES);
  });
});

/**
 * Three-tier sub-agent disclosure (docs/migration/14-AGENT-HARNESS-RECONSTRUCTION.md §19, §14
 * Phase 4). The tier decision is a pure function precisely so the threshold rule can be proven
 * here rather than inferred from a rendered frame.
 */
describe("resolveAgentDisclosure", () => {
  const now = 1_000_000;

  it("keeps a freshly reporting agent at tier 1 full detail", () => {
    expect(resolveAgentDisclosure({ status: "running", lastObservedActivityAt: now - 12_000, now })).toEqual({
      tier: "detail",
      idleMs: 12_000,
    });
  });

  it("collapses a still-running agent once nothing new has been observed for the threshold", () => {
    expect(
      resolveAgentDisclosure({ status: "running", lastObservedActivityAt: now - AGENT_IDLE_COLLAPSE_MS, now }),
    ).toEqual({ tier: "collapsed", idleMs: AGENT_IDLE_COLLAPSE_MS });
  });

  it("stays expanded one millisecond short of the threshold", () => {
    const state = resolveAgentDisclosure({
      status: "running",
      lastObservedActivityAt: now - (AGENT_IDLE_COLLAPSE_MS - 1),
      now,
    });
    expect(state.tier).toBe("detail");
  });

  it("measures idleness against the last observed activity, never against total runtime", () => {
    // The load-bearing property: an agent running for 20 minutes that reported an action 5s ago is
    // NOT collapsed. Collapsing on age would hide the busiest, most informative agents.
    expect(resolveAgentDisclosure({ status: "running", lastObservedActivityAt: now - 5_000, now })).toEqual({
      tier: "detail",
      idleMs: 5_000,
    });
  });

  it("reports a finished agent as the tier-3 summary however long ago it was last seen", () => {
    expect(resolveAgentDisclosure({ status: "complete", lastObservedActivityAt: now - 600_000, now })).toEqual({
      tier: "summary",
      idleMs: null,
    });
    expect(resolveAgentDisclosure({ status: "error", lastObservedActivityAt: now - 1_000, now })).toEqual({
      tier: "summary",
      idleMs: null,
    });
  });

  it("never claims an idle duration it does not have", () => {
    // No usable timestamp: stay expanded and report `null`, rather than guess a plausible-looking
    // number. Fabricating one would be exactly the invented-UI-data failure this project forbids.
    expect(resolveAgentDisclosure({ status: "running", lastObservedActivityAt: null, now })).toEqual({
      tier: "detail",
      idleMs: null,
    });
    expect(resolveAgentDisclosure({ status: "running", lastObservedActivityAt: Number.NaN, now })).toEqual({
      tier: "detail",
      idleMs: null,
    });
  });

  it("clamps a clock-skewed future timestamp to zero instead of a negative idle time", () => {
    expect(resolveAgentDisclosure({ status: "running", lastObservedActivityAt: now + 5_000, now })).toEqual({
      tier: "detail",
      idleMs: 0,
    });
  });

  it("honors an explicit threshold override", () => {
    expect(
      resolveAgentDisclosure({ status: "running", lastObservedActivityAt: now - 6_000, now, idleCollapseMs: 5_000 })
        .tier,
    ).toBe("collapsed");
  });
});
