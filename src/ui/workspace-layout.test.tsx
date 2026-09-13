import { RGBA } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { describe, expect, it } from "vitest";
import type { KernelState } from "../agent/kernel";
import type { DelegationRun, Plan, SubagentStatus } from "../types/index";
import { AuroraEdge } from "./aurora";
import {
  ActiveAgentsStrip,
  SessionInspector,
  SessionStatusStrip,
  type VerificationStatus,
  WorkspaceSidebar,
} from "./session-inspector";
import { dark as defaultDark, light, type Theme } from "./theme";

const dark = defaultDark;
const NOW = new Date("2026-09-13T12:00:42.000Z").getTime();

function frameUsesForeground(
  frame: ReturnType<Awaited<ReturnType<typeof testRender>>["captureSpans"]>,
  hex: string,
): boolean {
  const expected = RGBA.fromHex(hex);
  return frame.lines.some((line) => line.spans.some((span) => span.fg.equals(expected)));
}

function fixture(state: "working" | "failed") {
  const failed = state === "failed";
  const kernel: KernelState = {
    taskId: "task-ui",
    objective: "Make autonomous work visible",
    phase: failed ? "blocked" : "verify",
    scope: ["src/ui/app.tsx"],
    mutations: ["src/ui/app.tsx", "src/ui/session-inspector.tsx", "src/ui/observability.ts"],
    observations: ["Internal model steps are presentation noise."],
    attemptCount: 3,
    verificationPassed: false,
    reviewPassed: false,
    ...(failed ? { blockedReason: "Agent restoration check failed." } : {}),
  };
  const plan: Plan = {
    title: "Reconstruct workspace",
    summary: "Expose real execution state.",
    acceptanceCriteria: [
      { id: "AC1", description: "Activity is visible", verification: "rendered workspace inspection" },
    ],
    steps: [
      { title: "Understand current flow", description: "Trace it", status: "complete" },
      { title: "Research current CLIs", description: "Research it", status: "complete" },
      { title: "Implement activity workspace", description: "Build it", status: failed ? "failed" : "complete" },
      { title: "Verify rendered lifecycle", description: "Inspect it", status: failed ? "working" : "working" },
      { title: "Final review", description: "Review it", status: "pending" },
    ],
  };
  const delegations: DelegationRun[] = [
    {
      id: "verify-1",
      agent: "explore",
      description: "Checking restart behavior",
      summary: "Running in the background.",
      status: "running",
      startedAt: new Date(NOW - 14_000).toISOString(),
    },
  ];
  // Honest, aggregate-only status — no fabricated per-criterion verdict. See
  // `criterionMark` in session-inspector.tsx.
  const verificationStatus: VerificationStatus = {
    criteria: plan.acceptanceCriteria ?? null,
    evidenceCount: failed ? 0 : 1,
    evidenceSummary: failed ? [] : ["bash: curl http://localhost:8080"],
    linkedCriteriaIds: [],
  };
  return { kernel, plan, delegations, verificationStatus };
}

function WorkspaceFixture({ state, t: dark = defaultDark }: { state: "working" | "failed"; t?: Theme }) {
  const t = dark;
  const { kernel, plan, delegations, verificationStatus } = fixture(state);
  const currentActivity = state === "failed" ? "Repairing agent restoration" : "Running restart verification";
  return (
    <box width="100%" height="100%" flexDirection="row" backgroundColor={t.background}>
      <box width={122} flexDirection="column">
        <box flexGrow={1} paddingLeft={3} paddingTop={1} flexDirection="column">
          <text fg={t.brand}>USER</text>
          <text fg={t.text}>{"Improve session persistence..."}</text>
          <text fg={t.primary}>{"SHELRA"}</text>
          <text fg={t.text}>{"I traced where active task state is lost."}</text>
          <text fg={dark.text}>{"✓ Explored repository · 12 operations"}</text>
          <text fg={dark.textMuted}>{"└─ Found task hydration is missing on resume."}</text>
          {state === "failed" ? <text fg={dark.danger}>{"× Verification failed"}</text> : null}
        </box>
        <SessionStatusStrip
          t={t}
          width={122}
          isProcessing
          kernel={kernel}
          currentActivity={currentActivity}
          elapsedMs={8_000}
          changedFileCount={3}
          planStepCount={5}
          activeAgent={null}
        />
        <box
          height={3}
          paddingLeft={2}
          paddingRight={2}
          alignItems="center"
          flexDirection="column"
          border={["bottom"]}
          borderColor={t.border}
        >
          <AuroraEdge t={t} width={118} active={state === "working"} focused={false} reducedMotion />
          <box flexDirection="row" width="100%" alignItems="center">
            <text fg={t.textMuted}>{"Ask Shelra..."}</text>
            <box flexGrow={1} />
            <text fg={dark.danger}>{"■ Stop"}</text>
          </box>
        </box>
        <ActiveAgentsStrip
          t={dark}
          activeSubagent={null}
          startedAt={null}
          lastActivityAt={null}
          delegations={delegations}
          now={NOW}
        />
      </box>
      <WorkspaceSidebar
        t={t}
        width={38}
        isProcessing
        kernel={kernel}
        currentActivity={currentActivity}
        plan={plan}
        changedFiles={kernel.mutations}
        activities={[]}
        activeSubagent={null}
        lastActivityAt={null}
        delegations={delegations}
        activeToolCalls={[]}
        contextSummary={null}
        contextStats={{
          contextWindow: 128_000,
          usedTokens: 86_000,
          remainingTokens: 42_000,
          ratioUsed: 86_000 / 128_000,
          ratioRemaining: 42_000 / 128_000,
        }}
        usage={{
          inputTokens: 54_200,
          outputTokens: 8_400,
          totalTokens: 62_600,
          costMicros: 0,
          eventCount: 4,
          models: ["openrouter/free"],
          sources: ["message", "task"],
          lastUpdatedAt: NOW,
        }}
        sessionStartedAt={NOW - 21 * 60_000 - 14_000}
        now={NOW}
        model="openrouter/free"
        modeLabel="Agent"
        reasoningEffort="high (auto)"
        verificationStatus={verificationStatus}
        memoryStatus={{ entryCount: 3, capacityRatio: 0.12 }}
      />
    </box>
  );
}

describe("workspace visual hierarchy", () => {
  it.each(["working", "failed"] as const)("renders the %s lifecycle without internal model steps", async (state) => {
    const screen = await testRender(<WorkspaceFixture state={state} />, { width: 160, height: 65 });
    await screen.renderOnce();
    const frame = screen.captureCharFrame();
    if (process.env.SHELRA_CAPTURE_WORKSPACE === "1") console.log(`\n${state.toUpperCase()}\n${frame}`);

    expect(frame).toContain("PLAN");
    expect(frame).toContain("CURRENT");
    expect(frame).toContain("CONTEXT");
    expect(frame).toContain("AGENTS");
    expect(frame).toContain("TOKENS");
    expect(frame).toContain("■ Stop");
    // The SESSION section shows the model and the reasoning effort actually in effect (§11) —
    // never just "Model" with no indication of whether/how hard it's reasoning.
    expect(frame).toContain("openrouter/free");
    expect(frame).toContain("high (auto)");
    expect(frame).not.toContain("Model turn started");
    expect(frame).not.toContain("Step 1");

    // MEMORY shows the real entry count and capacity used (§16) — never a fabricated placeholder.
    expect(frame).toContain("MEMORY");
    expect(frame).toContain("Entries");
    expect(frame).toContain("3");
    expect(frame).toContain("Capacity");
    expect(frame).toContain("12%");

    // Real published criteria are listed — never invented — with an honest, aggregate-only
    // mark (§9 of the reconstruction brief: no fabricated per-criterion precision).
    expect(frame).toContain("AC1: Activity is visible");
    if (state === "failed") {
      expect(frame).toContain("× AC1");
      expect(frame).toContain("No verification action observed");
    } else {
      expect(frame).toContain("○ AC1");
      expect(frame).toContain("1 verification action observed");
    }
    screen.renderer.destroy();
  });

  it("keeps the working workspace legible in the intentional light palette", async () => {
    const screen = await testRender(<WorkspaceFixture state="working" t={light} />, { width: 160, height: 65 });
    await screen.renderOnce();
    const frame = screen.captureCharFrame();
    const colors = screen.captureSpans();
    if (process.env.SHELRA_CAPTURE_WORKSPACE === "1") console.log(`\nLIGHT WORKING\n${frame}`);

    expect(frame).toContain("Ask Shelra...");
    expect(frame).toContain("Running restart verification");
    expect(frame).toContain("VERIFICATION");
    expect(frameUsesForeground(colors, light.brand)).toBe(true);
    expect(frameUsesForeground(colors, light.aurora.green)).toBe(true);
    expect(frameUsesForeground(colors, light.aurora.cyan)).toBe(true);
    expect(frameUsesForeground(colors, light.aurora.violet)).toBe(true);
    screen.renderer.destroy();
  });
});

describe("VERIFICATION section with many long criteria", () => {
  it("wraps long criterion descriptions instead of garbling them with mid-word truncation", async () => {
    const kernel: KernelState = {
      taskId: "task-citadel",
      objective: "Build CITADEL",
      phase: "blocked",
      scope: [],
      mutations: [],
      observations: [],
      attemptCount: 1,
      verificationPassed: false,
      reviewPassed: false,
      blockedReason: "No verification action was observed for 10 acceptance criteria.",
    };
    const criteria = [
      { id: "AC1", description: "User can register with email and password and verify their email address" },
      { id: "AC2", description: "Password reset with single-use, expiring tokens invalidates old sessions" },
    ].map((c) => ({ ...c, verification: "manual security review" }));
    const verificationStatus: VerificationStatus = {
      criteria,
      evidenceCount: 0,
      evidenceSummary: [],
      linkedCriteriaIds: [],
    };

    const screen = await testRender(
      <WorkspaceSidebar
        t={dark}
        width={38}
        isProcessing={false}
        kernel={kernel}
        currentActivity="Blocked"
        plan={null}
        changedFiles={[]}
        activities={[]}
        activeSubagent={null}
        lastActivityAt={null}
        delegations={[]}
        activeToolCalls={[]}
        contextSummary={null}
        contextStats={null}
        usage={{
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          costMicros: 0,
          eventCount: 0,
          models: [],
          sources: [],
          lastUpdatedAt: NOW,
        }}
        sessionStartedAt={NOW - 60_000}
        now={NOW}
        model="openrouter/free"
        modeLabel="Agent"
        reasoningEffort="high (auto)"
        verificationStatus={verificationStatus}
        memoryStatus={{ entryCount: 0, capacityRatio: 0 }}
      />,
      { width: 40, height: 40 },
    );
    await screen.renderOnce();
    const frame = screen.captureCharFrame();

    // The full description is reflowed across multiple lines by the renderer — never chopped
    // mid-word with "..." the way a fixed single-line truncate() used to (the exact garbling
    // the user reported: "User can register with...", "Password reset with si...").
    expect(frame).toContain("User can register with");
    expect(frame).toContain("their email address");
    expect(frame).toContain("invalidates");
    expect(frame).toContain("old sessions");
    expect(frame).not.toMatch(/register with\.\.\./);
    expect(frame).not.toMatch(/with si\.\.\./);
    screen.renderer.destroy();
  });

  it("shows an explicitly linked criterion distinctly from the honest aggregate mark (§18)", async () => {
    const kernel: KernelState = {
      taskId: "task-pulse",
      objective: "Build Pulse",
      phase: "act",
      scope: [],
      mutations: [],
      observations: [],
      attemptCount: 1,
      verificationPassed: false,
      reviewPassed: false,
    };
    const criteria = [
      { id: "AC1", description: "Checkout completes", verification: "curl the checkout endpoint" },
      { id: "AC2", description: "Refunds are idempotent", verification: "run the refund test twice" },
    ];
    // AC1 was explicitly linked via update_plan_step; AC2 has none — same turn, same evidence
    // count, but only AC1 may honestly show as more than the flat aggregate mark.
    const verificationStatus: VerificationStatus = {
      criteria,
      evidenceCount: 1,
      evidenceSummary: ["bash: curl http://localhost:3000/checkout"],
      linkedCriteriaIds: ["AC1"],
    };

    const screen = await testRender(
      <WorkspaceSidebar
        t={dark}
        width={38}
        isProcessing={false}
        kernel={kernel}
        currentActivity="Working"
        plan={null}
        changedFiles={[]}
        activities={[]}
        activeSubagent={null}
        lastActivityAt={null}
        delegations={[]}
        activeToolCalls={[]}
        contextSummary={null}
        contextStats={null}
        usage={{
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          costMicros: 0,
          eventCount: 0,
          models: [],
          sources: [],
          lastUpdatedAt: NOW,
        }}
        sessionStartedAt={NOW - 60_000}
        now={NOW}
        model="openrouter/free"
        modeLabel="Agent"
        reasoningEffort="high (auto)"
        verificationStatus={verificationStatus}
        memoryStatus={{ entryCount: 0, capacityRatio: 0 }}
      />,
      { width: 40, height: 40 },
    );
    await screen.renderOnce();
    const frame = screen.captureCharFrame();

    expect(frame).toContain("● AC1: Checkout completes");
    expect(frame).toContain("○ AC2: Refunds are idempotent");
    // Wraps across lines in the narrow sidebar (like the criteria descriptions above) — assert on
    // substrings that survive the wrap rather than the full sentence.
    expect(frame).toContain("1 of 2 criteria");
    expect(frame).toContain("explicitly linked, the rest");
    expect(frame).toContain("aggregate only");
    screen.renderer.destroy();
  });
});

/**
 * Three-tier sub-agent disclosure (docs/migration/14-AGENT-HARNESS-RECONSTRUCTION.md §19, §14
 * Phase 4). All three tiers are asserted in ONE rendered frame so the visual distinction between
 * them is proven, not just each tier in isolation.
 */
function disclosureDelegations(): DelegationRun[] {
  return [
    {
      id: "brisk-teal-otter",
      agent: "explore",
      description: "Mapping every call site of resolvePlanState",
      summary: "Running in the background.",
      status: "running",
      // 95s since the only timestamp the host has for it — past the 30s threshold.
      startedAt: new Date(NOW - 95_000).toISOString(),
    },
    {
      id: "calm-amber-lynx",
      agent: "explore",
      description: "Checking restart behavior",
      summary: "Running in the background.",
      status: "running",
      startedAt: new Date(NOW - 9_000).toISOString(),
    },
    {
      id: "keen-ivory-heron",
      agent: "explore",
      description: "Auditing storage migrations",
      summary: "Found two duplicate index definitions in migrations.ts.",
      status: "complete",
      startedAt: new Date(NOW - 300_000).toISOString(),
      completedAt: new Date(NOW - 20_000).toISOString(),
    },
  ];
}

describe("three-tier sub-agent disclosure in the AGENTS strip", () => {
  it("renders tier 1 detail, tier 2 collapsed pointer, and tier 3 summary in one frame", async () => {
    const screen = await testRender(
      <box width={100} flexDirection="column">
        <ActiveAgentsStrip
          t={dark}
          activeSubagent={null}
          startedAt={null}
          lastActivityAt={null}
          delegations={disclosureDelegations()}
          now={NOW}
        />
      </box>,
      { width: 100, height: 24 },
    );
    await screen.renderOnce();
    const frame = screen.captureCharFrame();

    // Tier 1 — fresh: full detail row with the real task description and live elapsed time.
    expect(frame).toContain("● Explore");
    expect(frame).toContain("Checking restart behavior");
    expect(frame).toContain("9s");

    // Tier 2 — past the idle threshold, still running: one-line pointer, no detail line. The
    // wording is "no progress reported" rather than "idle 1m 35s" because a background delegation
    // has never reported anything past its start — claiming an idle period would imply
    // work-then-silence that never happened.
    expect(frame).toContain("no progress reported · /tasks");
    expect(frame).not.toContain("Mapping every call site");
    expect(frame).toContain("1m 35s");
    expect(frame).toContain("1 collapsed after 30s with no new activity · /tasks for full detail");

    // Tier 3 — finished: brief outcome row carrying the delegation's REAL saved summary.
    expect(frame).toContain("✓ Explore");
    expect(frame).toContain("Found two duplicate index definitions in migrations.ts.");
    screen.renderer.destroy();
  });

  it("keeps a long-running but still-reporting foreground sub-agent fully expanded", async () => {
    const activeSubagent: SubagentStatus = {
      agent: "verify",
      description: "Browser smoke test",
      detail: "bash: npx playwright test",
    };
    const screen = await testRender(
      <box width={100} flexDirection="column">
        <ActiveAgentsStrip
          t={dark}
          activeSubagent={activeSubagent}
          // Running for 14 minutes...
          startedAt={NOW - 840_000}
          // ...but it reported a new action 4s ago, so idleness — not age — keeps it expanded.
          lastActivityAt={NOW - 4_000}
          delegations={[]}
          now={NOW}
        />
      </box>,
      { width: 100, height: 12 },
    );
    await screen.renderOnce();
    const frame = screen.captureCharFrame();

    expect(frame).toContain("● Verify");
    expect(frame).toContain("bash: npx playwright test");
    expect(frame).toContain("14m 0s");
    expect(frame).not.toContain("/tasks");
    screen.renderer.destroy();
  });

  it("collapses a foreground sub-agent that has gone quiet, reporting its real idle duration", async () => {
    const activeSubagent: SubagentStatus = {
      agent: "verify",
      description: "Browser smoke test",
      detail: "bash: npx playwright test",
    };
    const screen = await testRender(
      <box width={100} flexDirection="column">
        <ActiveAgentsStrip
          t={dark}
          activeSubagent={activeSubagent}
          startedAt={NOW - 840_000}
          lastActivityAt={NOW - 61_000}
          delegations={[]}
          now={NOW}
        />
      </box>,
      { width: 100, height: 12 },
    );
    await screen.renderOnce();
    const frame = screen.captureCharFrame();

    expect(frame).toContain("● Verify");
    expect(frame).toContain("idle 1m 1s · /tasks");
    expect(frame).not.toContain("npx playwright test");
    // The elapsed timer keeps ticking — the work really is still running, only the disclosure
    // level changed. Status is never conveyed by color alone.
    expect(frame).toContain("14m 0s");
    screen.renderer.destroy();
  });
});

describe("AGENTS sidebar section under collapse", () => {
  it("still counts a collapsed agent as active while replacing its stale detail with the pointer", async () => {
    const activeSubagent: SubagentStatus = {
      agent: "verify",
      description: "Browser smoke test",
      detail: "bash: npx playwright test",
    };
    const screen = await testRender(
      <WorkspaceSidebar
        t={dark}
        width={38}
        isProcessing
        kernel={null}
        currentActivity="Verifying"
        plan={null}
        changedFiles={[]}
        activities={[]}
        activeSubagent={activeSubagent}
        lastActivityAt={NOW - 61_000}
        delegations={[]}
        activeToolCalls={[]}
        contextSummary={null}
        contextStats={null}
        usage={{
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          costMicros: 0,
          eventCount: 0,
          models: [],
          sources: [],
          lastUpdatedAt: NOW,
        }}
        sessionStartedAt={NOW - 60_000}
        now={NOW}
        model="openrouter/free"
        modeLabel="Agent"
        reasoningEffort="high (auto)"
        verificationStatus={null}
        memoryStatus={{ entryCount: 0, capacityRatio: 0 }}
      />,
      { width: 40, height: 40 },
    );
    await screen.renderOnce();
    const frame = screen.captureCharFrame();

    expect(frame).toContain("AGENTS");
    // The count comes from real status, never from the disclosure tier — collapsing must not make
    // a running agent disappear from the totals.
    expect(frame).toContain("Active");
    expect(frame).toContain("Verify");
    expect(frame).toContain("idle 1m 1s · /tasks");
    expect(frame).not.toContain("npx playwright test");
    screen.renderer.destroy();
  });
});

describe("/tasks agents view", () => {
  it("holds the full record a collapsed strip row stops restating", async () => {
    const activeSubagent: SubagentStatus = {
      agent: "verify",
      description: "Browser smoke test",
      detail: "bash: npx playwright test",
    };
    const screen = await testRender(
      <SessionInspector
        t={dark}
        width={120}
        height={60}
        tab="agents"
        sessionId="session-tasks"
        cwd="~/projects/shelra"
        model="openrouter/free"
        modeLabel="Agent"
        isProcessing
        kernel={null}
        currentActivity="Verifying"
        plan={null}
        originalIntent="Add three-tier disclosure"
        activities={[]}
        changedFiles={[]}
        activeSubagent={activeSubagent}
        activeSubagentStartedAt={NOW - 840_000}
        lastActivityAt={NOW - 61_000}
        delegations={disclosureDelegations()}
        activeToolCalls={[]}
        contextSummary={null}
        contextStats={null}
        now={NOW}
      />,
      { width: 120, height: 60 },
    );
    await screen.renderOnce();
    const frame = screen.captureCharFrame();

    expect(frame).toContain("Agents");
    expect(frame).toContain("Foreground sub-agent");
    expect(frame).toContain("1m 1s since the last reported action");
    // Real counts and the detail the collapsed strip row dropped — nothing was discarded.
    expect(frame).toContain("Background delegations running (2)");
    expect(frame).toContain("Mapping every call site of resolvePlanState");
    expect(frame).toContain("brisk-teal-otter");
    expect(frame).toContain("Finished (1)");
    expect(frame).toContain("Found two duplicate index definitions");
    screen.renderer.destroy();
  });

  it("shows an honest empty state instead of inventing agents that never ran", async () => {
    const screen = await testRender(
      <SessionInspector
        t={dark}
        width={120}
        height={40}
        tab="agents"
        sessionId={null}
        cwd="~/projects/shelra"
        model="openrouter/free"
        modeLabel="Agent"
        isProcessing={false}
        kernel={null}
        currentActivity="Idle"
        plan={null}
        originalIntent={null}
        activities={[]}
        changedFiles={[]}
        activeSubagent={null}
        activeSubagentStartedAt={null}
        lastActivityAt={null}
        delegations={[]}
        activeToolCalls={[]}
        contextSummary={null}
        contextStats={null}
        now={NOW}
      />,
      { width: 120, height: 40 },
    );
    await screen.renderOnce();
    const frame = screen.captureCharFrame();

    expect(frame).toContain("No delegated agents");
    screen.renderer.destroy();
  });
});
