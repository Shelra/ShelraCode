import { RGBA } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { describe, expect, it } from "vitest";
import type { KernelState } from "../agent/kernel";
import type { DelegationRun, Plan, SubagentStatus } from "../types/index";
import type { CheckSummary } from "./observability";
import { ActiveAgentsStrip, MissionPanel, SessionInspector, type VerificationStatus } from "./session-inspector";
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
  const changes = [
    { path: "src/ui/app.tsx", additions: 40, removals: 12, kind: "modified" as const },
    { path: "src/ui/mission.ts", additions: 96, removals: 0, kind: "added" as const },
  ];
  const checks: CheckSummary[] = failed
    ? [{ command: "bun test", label: "tests", tone: "danger", meta: "2 fail · 1.4s" }]
    : [{ command: "bun test", label: "tests", tone: "success", meta: "5 pass · 1.4s" }];
  return { kernel, plan, delegations, verificationStatus, changes, checks };
}

type View = "plan" | "changes" | "checks" | "context";

function MissionFixture({ state, view, t = defaultDark }: { state: "working" | "failed"; view: View; t?: Theme }) {
  const { kernel, plan, delegations, verificationStatus, changes, checks } = fixture(state);
  const currentActivity = state === "failed" ? "Repairing agent restoration" : "Running restart verification";
  const contextStats = {
    contextWindow: 128_000,
    usedTokens: 86_000,
    remainingTokens: 42_000,
    ratioUsed: 86_000 / 128_000,
    ratioRemaining: 42_000 / 128_000,
  };
  return (
    <box
      width="100%"
      height="100%"
      flexDirection="column"
      backgroundColor={t.background}
      paddingLeft={2}
      paddingRight={2}
    >
      <MissionPanel
        view={view}
        t={t}
        width={112}
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
        contextStats={contextStats}
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
        memoryContext={null}
        changes={changes}
        checks={checks}
      />
    </box>
  );
}

async function renderView(state: "working" | "failed", view: View, t?: Theme) {
  const screen = await testRender(<MissionFixture state={state} view={view} t={t} />, { width: 120, height: 40 });
  await screen.renderOnce();
  const frame = screen.captureCharFrame();
  const colors = screen.captureSpans();
  if (process.env.SHELRA_CAPTURE_WORKSPACE === "1") console.log(`\n${state.toUpperCase()} ${view}\n${frame}`);
  return { screen, frame, colors };
}

describe("mission views", () => {
  it.each(["working", "failed"] as const)("plan view draws the whole plan and the agents (%s)", async (state) => {
    const { screen, frame } = await renderView(state, "plan");
    expect(frame).toContain("PLAN");
    expect(frame).toContain("Implement activity workspace");
    expect(frame).toContain("Verify rendered lifecycle");
    expect(frame).toContain("AGENTS");
    // The active step explains itself; internal model steps never appear.
    expect(frame).toContain("Inspect it");
    expect(frame).not.toContain("Model turn started");
    expect(frame).not.toContain("Step 1");
    // A right-hand sidebar no longer exists: the panel owns the full width.
    expect(frame).not.toContain("CURRENT");
    screen.renderer.destroy();
  });

  it("changes view lists every file with its diffstat", async () => {
    const { screen, frame } = await renderView("working", "changes");
    expect(frame).toContain("CHANGES");
    expect(frame).toContain("src/ui/app.tsx");
    expect(frame).toContain("+40");
    expect(frame).toContain("-12");
    expect(frame).toContain("src/ui/mission.ts");
    screen.renderer.destroy();
  });

  it.each(["working", "failed"] as const)("checks view shows results and honest criteria (%s)", async (state) => {
    const { screen, frame } = await renderView(state, "checks");
    expect(frame).toContain("CHECKS");
    expect(frame).toContain("bun test");
    // Real published criteria are listed — never invented — with an honest, aggregate-only
    // mark (§9 of the reconstruction brief: no fabricated per-criterion precision).
    expect(frame).toContain("AC1: Activity is visible");
    if (state === "failed") {
      expect(frame).toContain("× AC1");
      expect(frame).toContain("2 fail");
      expect(frame).toContain("No verification action observed");
    } else {
      expect(frame).toContain("○ AC1");
      expect(frame).toContain("5 pass");
      expect(frame).toContain("1 verification action observed");
    }
    screen.renderer.destroy();
  });

  it("context view shows the window, the memory and the model actually in effect", async () => {
    const { screen, frame } = await renderView("working", "context");
    expect(frame).toContain("CONTEXT");
    expect(frame).toContain("86K of 128K tokens");
    // Memory shows the real saved count — never a fabricated placeholder.
    expect(frame).toContain("LOADED");
    expect(frame).toContain("3 saved");
    expect(frame).toContain("SESSION");
    // The model and the reasoning effort in effect (§11) — never just "Model".
    expect(frame).toContain("openrouter/free");
    expect(frame).toContain("effort high (auto)");
    // Empty telemetry is not rendered.
    expect(frame).not.toContain("TOKENS");
    screen.renderer.destroy();
  });

  it("keeps every view legible in the light palette", async () => {
    const { screen, frame, colors } = await renderView("working", "plan", light);
    expect(frame).toContain("PLAN");
    expect(frameUsesForeground(colors, light.brand)).toBe(true);
    screen.renderer.destroy();
  });

  it("says so when a view has nothing to show", async () => {
    const screen = await testRender(
      <MissionPanel
        view="plan"
        t={dark}
        width={80}
        isProcessing={false}
        kernel={null}
        currentActivity="Idle"
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
        sessionStartedAt={NOW}
        now={NOW}
        model="openrouter/free"
        modeLabel="Agent"
        reasoningEffort="high (auto)"
        verificationStatus={null}
        memoryStatus={{ entryCount: 0, capacityRatio: 0 }}
        memoryContext={null}
      />,
      { width: 84, height: 20 },
    );
    await screen.renderOnce();
    expect(screen.captureCharFrame()).toContain("No plan yet");
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
      <MissionPanel
        view="checks"
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
        memoryContext={null}
      />,
      { width: 40, height: 40 },
    );
    await screen.renderOnce();
    const frame = screen.captureCharFrame();

    // The full description is reflowed across multiple lines by the renderer — never chopped
    // mid-word with "..." the way a fixed single-line truncate() used to (the exact garbling
    // the user reported: "User can register with...", "Password reset with si...").
    expect(frame).toContain("User can register with");
    expect(frame).toContain("verify their email");
    expect(frame).toContain("address");
    expect(frame).toContain("invalidates");
    expect(frame).toContain("sessions");
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
      <MissionPanel
        view="checks"
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
        memoryContext={null}
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
    expect(frame).toContain("linked, the rest");
    expect(frame).toContain("aggregate only");
    screen.renderer.destroy();
  });
});

/**
 * Three-tier sub-agent disclosure (docs/architecture/14-AGENT-HARNESS-RECONSTRUCTION.md §19, §14
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
      <MissionPanel
        view="plan"
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
        memoryContext={null}
      />,
      { width: 40, height: 40 },
    );
    await screen.renderOnce();
    const frame = screen.captureCharFrame();

    expect(frame).toContain("AGENTS");
    // The count comes from real status, never from the disclosure tier — collapsing must not make
    // a running agent disappear from the totals.
    expect(frame).toContain("1 active");
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
