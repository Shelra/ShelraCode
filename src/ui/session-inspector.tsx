import type React from "react";
import type { AgentContextSummary } from "../agent/agent";
import type { KernelState } from "../agent/kernel";
import type {
  DelegationRun,
  Plan,
  PlanAcceptanceCriterion,
  PlanStepStatus,
  SubagentStatus,
  ToolCall,
} from "../types/index";
import { formatSubagentName } from "../utils/subagent-display";
import {
  AGENT_IDLE_COLLAPSE_MS,
  type AgentDisclosureState,
  completionLabel,
  completionStatus,
  type MemoryStatus,
  phaseLabel,
  resolveAgentDisclosure,
  type SessionUsageSummary,
  type UiActivityEvent,
  type UiCompletionStatus,
} from "./observability";
import { PlanView } from "./plan";
import type { Theme } from "./theme";

export type InspectorTab = "overview" | "plan" | "activity" | "evidence" | "agents";

export interface InspectorContextStats {
  contextWindow: number;
  usedTokens: number;
  remainingTokens: number;
  ratioUsed: number;
  ratioRemaining: number;
}

interface SessionStatusStripProps {
  t: Theme;
  width: number;
  isProcessing: boolean;
  kernel: KernelState | null;
  currentActivity: string;
  elapsedMs?: number | null;
  changedFileCount: number;
  planStepCount: number;
  activeAgent: SubagentStatus | null;
}

export function SessionStatusStrip({
  t,
  width,
  isProcessing,
  kernel,
  currentActivity,
  elapsedMs,
}: SessionStatusStripProps) {
  const status = completionStatus(kernel, isProcessing);
  if (!isProcessing && status !== "blocked" && status !== "verification-needed") return null;

  const marker = isProcessing ? "●" : status === "blocked" ? "×" : "!";
  const statusColor = isProcessing ? t.accent : completionColor(status, t);
  const title = isProcessing
    ? currentActivity || phaseLabel(kernel, true)
    : status === "blocked"
      ? kernel?.blockedReason || "Completion blocked"
      : "Verification required before completion";
  const available = Math.max(18, width - 10);
  const elapsed = elapsedMs !== null && elapsedMs !== undefined ? formatElapsed(elapsedMs) : null;

  return (
    <box width="100%" flexShrink={0} paddingLeft={2} paddingRight={2} paddingTop={1} flexDirection="row">
      <text fg={statusColor}>
        <b>{`${marker} ${truncate(title, available)}`}</b>
      </text>
      <box flexGrow={1} />
      {elapsed ? <text fg={t.textMuted}>{elapsed}</text> : null}
    </box>
  );
}

interface ActiveAgentsStripProps {
  t: Theme;
  activeSubagent: SubagentStatus | null;
  startedAt: number | null;
  /**
   * When the host last observed the foreground sub-agent report a new action — the timestamp of its
   * most recent `onSubagentStatus` emission, one per child tool call. Drives the tier-2 collapse
   * (docs/migration/14-AGENT-HARNESS-RECONSTRUCTION.md §19). `null` keeps the row expanded, because
   * nothing about idleness can honestly be claimed without a real timestamp.
   */
  lastActivityAt: number | null;
  delegations: DelegationRun[];
  now: number;
}

export function ActiveAgentsStrip({
  t,
  activeSubagent,
  startedAt,
  lastActivityAt,
  delegations,
  now,
}: ActiveAgentsStripProps) {
  const running = delegations.filter((delegation) => delegation.status === "running");
  const recentlyCompleted = delegations
    .filter((delegation) => {
      if (delegation.status === "running" || !delegation.completedAt) return false;
      const completedAt = new Date(delegation.completedAt).getTime();
      return Number.isFinite(completedAt) && now - completedAt < 120_000;
    })
    .slice(0, 1);
  if (!activeSubagent && running.length === 0 && recentlyCompleted.length === 0) return null;
  const elapsed = startedAt ? formatElapsed(Math.max(0, now - startedAt)) : null;
  const foreground = activeSubagent
    ? resolveAgentDisclosure({ status: "running", lastObservedActivityAt: lastActivityAt, now })
    : null;
  const runningRows = running.map((delegation) => ({
    delegation,
    disclosure: delegationDisclosure(delegation, now),
  }));
  const collapsedCount =
    (foreground?.tier === "collapsed" ? 1 : 0) +
    runningRows.filter((row) => row.disclosure.tier === "collapsed").length;
  return (
    <box
      flexShrink={0}
      paddingLeft={2}
      paddingRight={2}
      paddingTop={1}
      paddingBottom={1}
      flexDirection="column"
      border={["top"]}
      borderColor={t.border}
    >
      <text fg={t.textDim}>{"AGENTS"}</text>
      {activeSubagent && foreground ? (
        foreground.tier === "collapsed" ? (
          <AgentPointerRow
            t={t}
            name={formatSubagentName(activeSubagent.agent)}
            idleMs={foreground.idleMs}
            source="reported"
            elapsed={elapsed}
          />
        ) : (
          <AgentStripRow
            t={t}
            marker="●"
            name={formatSubagentName(activeSubagent.agent)}
            detail={activeSubagent.detail || activeSubagent.description}
            elapsed={elapsed}
            active
          />
        )
      ) : null}
      {runningRows.map(({ delegation, disclosure }) =>
        disclosure.tier === "collapsed" ? (
          <AgentPointerRow
            key={delegation.id}
            t={t}
            name={formatSubagentName(delegation.agent)}
            idleMs={disclosure.idleMs}
            source="start-only"
            elapsed={elapsedFromIso(delegation.startedAt, now)}
          />
        ) : (
          <AgentStripRow
            key={delegation.id}
            t={t}
            marker="●"
            name={formatSubagentName(delegation.agent)}
            detail={delegation.description}
            elapsed={elapsedFromIso(delegation.startedAt, now)}
            active
          />
        ),
      )}
      {recentlyCompleted.map((delegation) => (
        <AgentStripRow
          key={delegation.id}
          t={t}
          marker={delegation.status === "error" ? "×" : "✓"}
          name={formatSubagentName(delegation.agent)}
          detail={delegation.summary}
          elapsed={null}
          active={false}
          failed={delegation.status === "error"}
        />
      ))}
      {collapsedCount > 0 ? <text fg={t.textDim}>{collapsedAgentsHint(collapsedCount)}</text> : null}
    </box>
  );
}

function AgentStripRow({
  t,
  marker,
  name,
  detail,
  elapsed,
  active,
  failed = false,
}: {
  t: Theme;
  marker: string;
  name: string;
  detail: string;
  elapsed: string | null;
  active: boolean;
  failed?: boolean;
}) {
  return (
    <box paddingTop={1} flexDirection="column">
      <box flexDirection="row">
        <text fg={failed ? t.danger : active ? t.subagentAccent : t.success}>
          <b>{`${marker} ${name}`}</b>
        </text>
        <box flexGrow={1} />
        {elapsed ? <text fg={t.textMuted}>{elapsed}</text> : null}
      </box>
      <text fg={t.textMuted}>{`  ${truncate(detail, 140)}`}</text>
    </box>
  );
}

/**
 * Tier 2 (docs/migration/14-AGENT-HARNESS-RECONSTRUCTION.md §19): a sub-agent that is still running
 * but has reported nothing new for `AGENT_IDLE_COLLAPSE_MS`. Keeps the honest running marker and
 * the live elapsed timer — the work really is still in flight — and drops only the stale detail
 * line, pointing at `/tasks`, which still holds the full record. Status is never carried by color
 * alone: the marker, the literal "idle" text, and the ticking timer all still say "running".
 */
function AgentPointerRow({
  t,
  name,
  idleMs,
  source,
  elapsed,
}: {
  t: Theme;
  name: string;
  idleMs: number | null;
  source: AgentActivitySource;
  elapsed: string | null;
}) {
  return (
    <box paddingTop={1} flexDirection="row">
      <text fg={t.textMuted}>
        <b>{`● ${name}`}</b>
      </text>
      <text fg={t.textDim}>{`  ${idlePointerLine(idleMs, source)}`}</text>
      <box flexGrow={1} />
      {elapsed ? <text fg={t.textMuted}>{elapsed}</text> : null}
    </box>
  );
}

/**
 * Disclosure tier for a background delegation. Its only real timestamp is `startedAt`: the detached
 * child process writes nothing back into its job record between start and finish, so "the last
 * activity this host observed" genuinely IS the start. That is a true statement about the data, not
 * a placeholder standing in for progress the host does not have.
 */
function delegationDisclosure(delegation: DelegationRun, now: number): AgentDisclosureState {
  return resolveAgentDisclosure({
    status: delegation.status,
    lastObservedActivityAt: isoToMs(delegation.startedAt),
    now,
  });
}

/**
 * Where the host's knowledge of an agent's activity comes from. `reported` means the host has been
 * receiving real per-action updates (a foreground `task` sub-agent's `onSubagentStatus` stream), so
 * a gap in them is genuinely an idle period. `start-only` means the host has never observed anything
 * beyond the start (a background `delegate` child writes no progress into its job record), so
 * calling that same gap "idle" would imply work-then-silence that never happened.
 */
type AgentActivitySource = "reported" | "start-only";

/** Real idle duration plus where the full record still lives. Never a fabricated duration. */
function idlePointerLine(idleMs: number | null, source: AgentActivitySource): string {
  if (idleMs === null) return "/tasks for full detail";
  if (source === "start-only") return "no progress reported · /tasks";
  return `idle ${formatElapsed(idleMs)} · /tasks`;
}

/** Explains the collapse rule once per strip instead of repeating it on every collapsed row. */
function collapsedAgentsHint(count: number): string {
  const seconds = Math.round(AGENT_IDLE_COLLAPSE_MS / 1000);
  return `${count} collapsed after ${seconds}s with no new activity · /tasks for full detail`;
}

export interface VerificationStatus {
  criteria: PlanAcceptanceCriterion[] | null;
  evidenceCount: number;
  evidenceSummary: string[];
  /**
   * Criterion ids the model explicitly linked to a completed step this turn (§18). Combined with
   * `evidenceCount > 0` this lets a specific criterion show as more than the flat aggregate mark
   * — still never a fabricated causal "this exact check proved this exact criterion," just an
   * honest "the model declared this link AND some real verification happened this turn."
   */
  linkedCriteriaIds: string[];
}

interface WorkspaceSidebarProps {
  t: Theme;
  width: number;
  isProcessing: boolean;
  kernel: KernelState | null;
  currentActivity: string;
  plan: Plan | null;
  changedFiles: string[];
  activities: UiActivityEvent[];
  activeSubagent: SubagentStatus | null;
  /** Same real last-observed-activity timestamp the strip collapses on (§19). */
  lastActivityAt: number | null;
  delegations: DelegationRun[];
  activeToolCalls: ToolCall[];
  contextSummary: AgentContextSummary | null;
  contextStats: InspectorContextStats | null;
  usage: SessionUsageSummary;
  sessionStartedAt: number;
  now: number;
  model: string;
  modeLabel: string;
  reasoningEffort: string;
  verificationStatus: VerificationStatus | null;
  memoryStatus: MemoryStatus;
}

export function WorkspaceSidebar({
  t,
  width,
  isProcessing,
  kernel,
  currentActivity,
  plan,
  changedFiles,
  activities,
  activeSubagent,
  lastActivityAt,
  delegations,
  activeToolCalls,
  contextSummary,
  contextStats,
  usage,
  sessionStartedAt,
  now,
  model,
  modeLabel,
  reasoningEffort,
  verificationStatus,
  memoryStatus,
}: WorkspaceSidebarProps) {
  const status = completionStatus(kernel, isProcessing);
  const innerWidth = Math.max(16, width - 4);
  const completedForegroundAgents = activities.filter(
    (event) => event.kind === "agent" && event.status === "complete",
  ).length;
  const runningDelegations = delegations.filter((delegation) => delegation.status === "running");
  const completedDelegations = delegations.filter((delegation) => delegation.status !== "running");
  // Disclosure tiers only change how much of a running agent is RESTATED here; the counts below
  // stay derived from real status, so a collapsed agent still counts as active.
  const foregroundDisclosure = activeSubagent
    ? resolveAgentDisclosure({ status: "running", lastObservedActivityAt: lastActivityAt, now })
    : null;
  const runningDelegationRows = runningDelegations
    .slice(0, 3)
    .map((delegation) => ({ delegation, disclosure: delegationDisclosure(delegation, now) }));
  const activeAgentCount = (activeSubagent ? 1 : 0) + runningDelegations.length;
  const failedEvents = activities.filter((event) => event.status === "failed").length;
  const toolEvents = activities.filter((event) => event.kind === "tool").length;
  const completedPlanSteps = plan?.steps.filter((step) => step.status === "complete").length ?? 0;
  const currentPlanStep =
    plan?.steps.find((step) => step.status === "working") ??
    plan?.steps.find((step) => step.status === "failed") ??
    null;

  return (
    <box
      width={width}
      flexShrink={0}
      border={["left"]}
      borderColor={t.border}
      backgroundColor={t.background}
      paddingLeft={1}
      paddingRight={1}
      flexDirection="column"
    >
      <scrollbox flexGrow={1} minHeight={0}>
        <SidebarSection t={t} title="PLAN">
          {plan ? (
            <>
              <text fg={t.textMuted}>{`${completedPlanSteps} / ${plan.steps.length} completed`}</text>
              {plan.steps.slice(0, 6).map((step) => (
                <text
                  key={`${step.title}:${step.description}:${step.satisfies?.join(",") ?? ""}`}
                  fg={planStepColor(step.status, t)}
                >
                  {`${planStepMark(step.status)} ${truncate(step.title, innerWidth - 2)}`}
                </text>
              ))}
              {plan.steps.length > 6 ? <text fg={t.textDim}>{`+ ${plan.steps.length - 6} more steps`}</text> : null}
            </>
          ) : (
            <text fg={t.textMuted}>{"No structured plan published."}</text>
          )}
        </SidebarSection>

        <SidebarSection t={t} title="CURRENT">
          {currentPlanStep ? (
            <text fg={planStepColor(currentPlanStep.status, t)}>{truncate(currentPlanStep.title, innerWidth)}</text>
          ) : kernel?.objective ? (
            <text fg={t.text}>{truncate(kernel.objective, innerWidth)}</text>
          ) : null}
          <text fg={completionColor(status, t)}>{phaseLabel(kernel, isProcessing)}</text>
          {currentActivity !== phaseLabel(kernel, isProcessing) ? (
            <text fg={t.textMuted}>{truncate(currentActivity, innerWidth)}</text>
          ) : null}
          {kernel?.blockedReason ? (
            <box paddingTop={1} flexDirection="column">
              <text fg={t.danger}>{"× Completion blocked"}</text>
              <text fg={t.textMuted}>{truncate(kernel.blockedReason, innerWidth)}</text>
            </box>
          ) : null}
        </SidebarSection>

        <SidebarSection t={t} title="CONTEXT">
          {contextStats ? (
            <>
              <SidebarFact
                t={t}
                label="Estimate"
                value={`${formatTokenCount(contextStats.usedTokens)} / ${formatTokenCount(contextStats.contextWindow)}`}
              />
              <ContextBar t={t} ratio={contextStats.ratioUsed} width={Math.min(18, innerWidth)} />
              <SidebarFact t={t} label="Used" value={`${Math.round(contextStats.ratioUsed * 100)}%`} />
              <SidebarFact
                t={t}
                label="Health"
                value={contextHealth(contextStats.ratioUsed)}
                tone={contextHealthColor(contextStats.ratioUsed, t)}
              />
            </>
          ) : (
            <text fg={t.textMuted}>{"Context estimate unavailable."}</text>
          )}
          {contextSummary ? (
            <>
              <SidebarFact t={t} label="Kind" value={contextSummary.classification.kind} />
              <SidebarFact
                t={t}
                label="Files"
                value={`${contextSummary.files.length}${contextSummary.truncated ? " (truncated)" : ""}`}
              />
            </>
          ) : (
            <text fg={t.textDim}>{"Breakdown appears after context compilation."}</text>
          )}
        </SidebarSection>

        <SidebarSection t={t} title="AGENTS">
          <SidebarFact
            t={t}
            label="Active"
            value={String(activeAgentCount)}
            tone={activeAgentCount > 0 ? t.subagentAccent : undefined}
          />
          <SidebarFact
            t={t}
            label="Completed"
            value={String(completedForegroundAgents + completedDelegations.length)}
          />
          {activeSubagent && foregroundDisclosure ? (
            <>
              <text fg={foregroundDisclosure.tier === "collapsed" ? t.textMuted : t.subagentAccent}>
                {formatSubagentName(activeSubagent.agent)}
              </text>
              <text fg={t.textMuted}>
                {foregroundDisclosure.tier === "collapsed"
                  ? idlePointerLine(foregroundDisclosure.idleMs, "reported")
                  : truncate(activeSubagent.detail, innerWidth)}
              </text>
            </>
          ) : runningDelegations.length === 0 ? (
            <text fg={t.textDim}>{"No delegated agent is active."}</text>
          ) : null}
          {runningDelegationRows.map(({ delegation, disclosure }) => (
            <box key={delegation.id} paddingTop={1} flexDirection="column">
              <text fg={disclosure.tier === "collapsed" ? t.textMuted : t.subagentAccent}>
                {`● ${formatSubagentName(delegation.agent)}`}
              </text>
              <text fg={t.textMuted}>
                {disclosure.tier === "collapsed"
                  ? idlePointerLine(disclosure.idleMs, "start-only")
                  : truncate(delegation.description, innerWidth)}
              </text>
            </box>
          ))}
        </SidebarSection>

        <SidebarSection t={t} title="TOKENS">
          {usage.eventCount > 0 ? (
            <>
              <SidebarFact t={t} label="Input" value={formatTokenCount(usage.inputTokens)} />
              <SidebarFact t={t} label="Output" value={formatTokenCount(usage.outputTokens)} />
              <SidebarFact t={t} label="Total" value={formatTokenCount(usage.totalTokens)} />
              <SidebarFact
                t={t}
                label={usage.costMicros > 0 ? "Est. cost" : "Cost"}
                value={formatCostMicros(usage.costMicros)}
              />
            </>
          ) : (
            <text fg={t.textMuted}>{"No token usage recorded yet."}</text>
          )}
        </SidebarSection>

        <SidebarSection t={t} title="VERIFICATION">
          <SidebarFact t={t} label="Gate" value={completionLabel(status)} tone={completionColor(status, t)} />
          <SidebarFact
            t={t}
            label="Host verify"
            value={verificationLabel(kernel)}
            tone={verificationColor(kernel, t)}
          />
          {kernel?.verificationDetails ? (
            <text fg={t.textMuted}>{normalizeText(kernel.verificationDetails)}</text>
          ) : null}
          {verificationStatus?.criteria?.length ? (
            <box paddingTop={1} flexDirection="column">
              {verificationStatus.criteria.map((criterion) => {
                const mark = criterionMark(
                  kernel,
                  verificationStatus.evidenceCount,
                  criterion.id,
                  verificationStatus.linkedCriteriaIds,
                );
                return (
                  <text key={criterion.id} fg={criterionTone(mark, t)}>
                    {`${criterionMarkSymbol(mark)} ${normalizeText(`${criterion.id}: ${criterion.description}`)}`}
                  </text>
                );
              })}
              <text fg={t.textDim}>{verificationEvidenceSummaryLine(verificationStatus)}</text>
            </box>
          ) : null}
        </SidebarSection>

        <SidebarSection t={t} title="MEMORY">
          {memoryStatus.entryCount > 0 ? (
            <>
              <SidebarFact t={t} label="Entries" value={String(memoryStatus.entryCount)} />
              <ContextBar t={t} ratio={memoryStatus.capacityRatio} width={Math.min(18, innerWidth)} />
              <SidebarFact t={t} label="Capacity" value={`${Math.round(memoryStatus.capacityRatio * 100)}%`} />
            </>
          ) : (
            <text fg={t.textMuted}>{"No project memory saved yet."}</text>
          )}
        </SidebarSection>

        <SidebarSection t={t} title="SESSION">
          <SidebarFact t={t} label="Duration" value={formatElapsed(Math.max(0, now - sessionStartedAt))} />
          <SidebarFact t={t} label="Files" value={String(changedFiles.length)} />
          <SidebarFact t={t} label="Tools" value={String(toolEvents)} />
          <SidebarFact
            t={t}
            label="Failures"
            value={String(failedEvents)}
            tone={failedEvents > 0 ? t.danger : undefined}
          />
          <SidebarFact t={t} label="Mode" value={modeLabel} />
          <SidebarFact t={t} label="Model" value={truncate(model, innerWidth)} />
          <SidebarFact t={t} label="Effort" value={reasoningEffort} />
          {activeToolCalls.length > 0 ? (
            <SidebarFact t={t} label="Live tools" value={String(activeToolCalls.length)} tone={t.accent} />
          ) : null}
        </SidebarSection>
      </scrollbox>
    </box>
  );
}

interface SessionInspectorProps {
  t: Theme;
  width: number;
  height: number;
  tab: InspectorTab;
  sessionId: string | null;
  cwd: string;
  model: string;
  modeLabel: string;
  isProcessing: boolean;
  kernel: KernelState | null;
  currentActivity: string;
  plan: Plan | null;
  originalIntent: string | null;
  activities: UiActivityEvent[];
  changedFiles: string[];
  activeSubagent: SubagentStatus | null;
  /** When the foreground sub-agent first started, for its real elapsed time. */
  activeSubagentStartedAt: number | null;
  /** When the host last observed the foreground sub-agent report a new action (§19). */
  lastActivityAt: number | null;
  /** Real delegation records — the same `DelegationManager.list()` output `delegation_list` returns. */
  delegations: DelegationRun[];
  activeToolCalls: ToolCall[];
  contextSummary: AgentContextSummary | null;
  contextStats: InspectorContextStats | null;
  now: number;
}

export function SessionInspector({
  t,
  width,
  height,
  tab,
  sessionId,
  cwd,
  model,
  modeLabel,
  isProcessing,
  kernel,
  currentActivity,
  plan,
  originalIntent,
  activities,
  changedFiles,
  activeSubagent,
  activeSubagentStartedAt,
  lastActivityAt,
  delegations,
  activeToolCalls,
  contextSummary,
  contextStats,
  now,
}: SessionInspectorProps) {
  const status = completionStatus(kernel, isProcessing);
  const panelWidth = Math.max(1, Math.min(104, Math.max(1, width - 6)));
  const panelHeight = Math.max(8, Math.min(Math.max(8, height - 2), Math.max(14, Math.floor(height * 0.84))));
  const top = Math.max(1, Math.floor((height - panelHeight) / 2));
  const compactPanel = panelWidth < 58;
  const tabs: Array<{ id: InspectorTab; label: string; key: string }> = [
    { id: "overview", label: "Overview", key: "1" },
    { id: "plan", label: "Plan", key: "2" },
    { id: "activity", label: "Activity", key: "3" },
    { id: "evidence", label: "Evidence", key: "4" },
    { id: "agents", label: "Agents", key: "5" },
  ];

  return (
    <box
      position="absolute"
      left={0}
      top={0}
      width={width}
      height={height}
      alignItems="center"
      paddingTop={top}
      backgroundColor={t.overlay}
    >
      <box
        width={panelWidth}
        height={panelHeight}
        backgroundColor={t.surface}
        border={["top", "right", "bottom", "left"]}
        borderColor={t.borderStrong}
        paddingTop={1}
        paddingBottom={1}
        flexDirection="column"
      >
        <box flexShrink={0} flexDirection="row" justifyContent="space-between" paddingLeft={2} paddingRight={2}>
          <text fg={t.primary}>
            <b>{"Session control surface"}</b>
          </text>
          <text fg={t.textMuted}>
            {compactPanel ? "esc close" : `${sessionId ? `session ${shortId(sessionId)}` : "no session"} | esc close`}
          </text>
        </box>
        <box flexShrink={0} paddingLeft={2} paddingRight={2} paddingTop={1}>
          <text fg={t.textDim}>{truncate(`${modeLabel} | ${model} | ${cwd}`, Math.max(16, panelWidth - 6))}</text>
        </box>
        <box
          flexShrink={0}
          flexDirection="row"
          gap={1}
          paddingLeft={2}
          paddingRight={2}
          paddingTop={1}
          paddingBottom={1}
        >
          {tabs.map((item) => {
            const selected = item.id === tab;
            return (
              <box key={item.id} backgroundColor={selected ? t.selectedBg : undefined} paddingLeft={1} paddingRight={1}>
                <text fg={selected ? t.primary : t.textMuted}>
                  {compactPanel ? (
                    selected ? (
                      <b>{item.key}</b>
                    ) : (
                      item.key
                    )
                  ) : (
                    <>
                      {`${item.key} `}
                      {selected ? <b>{item.label}</b> : item.label}
                    </>
                  )}
                </text>
              </box>
            );
          })}
        </box>
        <scrollbox flexGrow={1} minHeight={0} paddingLeft={2} paddingRight={2}>
          {tab === "overview" ? (
            <OverviewTab
              t={t}
              status={status}
              kernel={kernel}
              currentActivity={currentActivity}
              originalIntent={originalIntent}
              plan={plan}
              changedFiles={changedFiles}
              activeSubagent={activeSubagent}
              activeToolCalls={activeToolCalls}
              activities={activities}
            />
          ) : null}
          {tab === "plan" ? <PlanTab t={t} plan={plan} kernel={kernel} /> : null}
          {tab === "activity" ? (
            <ActivityTab
              t={t}
              activities={activities}
              activeSubagent={activeSubagent}
              activeToolCalls={activeToolCalls}
            />
          ) : null}
          {tab === "agents" ? (
            <AgentsTab
              t={t}
              activeSubagent={activeSubagent}
              startedAt={activeSubagentStartedAt}
              lastActivityAt={lastActivityAt}
              delegations={delegations}
              now={now}
            />
          ) : null}
          {tab === "evidence" ? (
            <EvidenceTab
              t={t}
              status={status}
              kernel={kernel}
              changedFiles={changedFiles}
              contextSummary={contextSummary}
              contextStats={contextStats}
            />
          ) : null}
        </scrollbox>
        <box flexShrink={0} paddingLeft={2} paddingRight={2} paddingTop={1}>
          <text fg={t.textDim}>
            {compactPanel ? "1-5 view | tab cycle | esc close" : "1-5 switch view | tab/shift-tab move | esc close"}
          </text>
        </box>
      </box>
    </box>
  );
}

function OverviewTab({
  t,
  status,
  kernel,
  currentActivity,
  originalIntent,
  plan,
  changedFiles,
  activeSubagent,
  activeToolCalls,
  activities,
}: {
  t: Theme;
  status: UiCompletionStatus;
  kernel: KernelState | null;
  currentActivity: string;
  originalIntent: string | null;
  plan: Plan | null;
  changedFiles: string[];
  activeSubagent: SubagentStatus | null;
  activeToolCalls: ToolCall[];
  activities: UiActivityEvent[];
}) {
  return (
    <box flexDirection="column" paddingBottom={1}>
      <SectionTitle t={t} title="What Shelra is doing" />
      <Fact t={t} label="State" value={`${phaseLabel(kernel, status === "active")} | ${completionLabel(status)}`} />
      <Fact t={t} label="Current activity" value={currentActivity} />
      {kernel?.blockedReason ? <Fact t={t} label="Why blocked" value={kernel.blockedReason} tone={t.danger} /> : null}

      <SectionTitle t={t} title="Intent" />
      <Fact
        t={t}
        label="Original request"
        value={originalIntent ? truncate(originalIntent, 220) : "No user request recorded"}
      />
      <Fact
        t={t}
        label="Runtime objective"
        value={kernel?.objective ?? "No host objective is recorded for the current turn."}
      />
      {kernel ? <text fg={t.textDim}>{"Source: host-owned AgentKernel objective"}</text> : null}

      <SectionTitle t={t} title="Work summary" />
      <Fact
        t={t}
        label="Plan"
        value={plan ? `${plan.steps.length} structured step${plan.steps.length === 1 ? "" : "s"}` : "No plan published"}
      />
      <Fact t={t} label="Changed files" value={String(changedFiles.length)} />
      <Fact t={t} label="Structured events" value={String(activities.length)} />
      <Fact t={t} label="Live tools" value={String(activeToolCalls.length)} />
      <Fact t={t} label="Live agent" value={activeSubagent ? formatSubagentName(activeSubagent.agent) : "None"} />

      {activeSubagent ? (
        <box paddingLeft={2} paddingTop={1} flexDirection="column">
          <text fg={t.subagentAccent}>{activeSubagent.description}</text>
          <text fg={t.textMuted}>{activeSubagent.detail}</text>
        </box>
      ) : null}
    </box>
  );
}

function PlanTab({ t, plan, kernel }: { t: Theme; plan: Plan | null; kernel: KernelState | null }) {
  if (!plan) {
    return (
      <EmptyState
        t={t}
        title="No structured plan"
        detail={
          kernel
            ? "The runtime has an objective, but no plan result has been published for this turn."
            : "A plan will appear here when the runtime publishes one."
        }
      />
    );
  }

  return (
    <box flexDirection="column">
      <text fg={t.textDim}>
        {"Latest structured plan result. Execution state comes from runtime state and events."}
      </text>
      <PlanView t={t} plan={plan} />
    </box>
  );
}

function ActivityTab({
  t,
  activities,
  activeSubagent,
  activeToolCalls,
}: {
  t: Theme;
  activities: UiActivityEvent[];
  activeSubagent: SubagentStatus | null;
  activeToolCalls: ToolCall[];
}) {
  if (activities.length === 0 && !activeSubagent && activeToolCalls.length === 0) {
    return (
      <EmptyState
        t={t}
        title="No structured activity"
        detail="Runtime events will be summarized here while a turn runs."
      />
    );
  }

  return (
    <box flexDirection="column" paddingBottom={1}>
      {activeSubagent ? (
        <ActivityRow
          t={t}
          event={{
            id: "live-agent",
            kind: "agent",
            status: "active",
            label: formatSubagentName(activeSubagent.agent),
            detail: `${activeSubagent.description}: ${activeSubagent.detail}`,
            at: 0,
          }}
        />
      ) : null}
      {activeToolCalls.map((toolCall) => (
        <ActivityRow
          key={`live-${toolCall.id}`}
          t={t}
          event={{
            id: `live-tool-${toolCall.id}`,
            kind: "tool",
            status: "active",
            label: toolCall.function.name,
            detail: "Tool call is in progress",
            at: 0,
          }}
        />
      ))}
      {[...activities].reverse().map((event) => (
        <ActivityRow key={event.id} t={t} event={event} />
      ))}
    </box>
  );
}

/**
 * The `/tasks` surface — tier 2's pointer target (docs/migration/14-AGENT-HARNESS-RECONSTRUCTION.md
 * §19). Every value here reads from the same real sources the strip and sidebar use: the live
 * `onSubagentStatus` stream for the foreground sub-agent, and `DelegationManager.list()` (the same
 * on-disk job records the `delegation_list` tool returns) for background runs. Collapsing a row in
 * the transcript therefore hides nothing — it only stops restating what this view still holds.
 */
function AgentsTab({
  t,
  activeSubagent,
  startedAt,
  lastActivityAt,
  delegations,
  now,
}: {
  t: Theme;
  activeSubagent: SubagentStatus | null;
  startedAt: number | null;
  lastActivityAt: number | null;
  delegations: DelegationRun[];
  now: number;
}) {
  const running = delegations.filter((delegation) => delegation.status === "running");
  const finished = delegations.filter((delegation) => delegation.status !== "running");

  if (!activeSubagent && delegations.length === 0) {
    return (
      <EmptyState
        t={t}
        title="No delegated agents"
        detail="Foreground sub-agents and background delegations are listed here while they run and after they finish."
      />
    );
  }

  return (
    <box flexDirection="column" paddingBottom={1}>
      <SectionTitle t={t} title="Foreground sub-agent" />
      {activeSubagent ? (
        <>
          <Fact t={t} label="Agent" value={formatSubagentName(activeSubagent.agent)} tone={t.subagentAccent} />
          <Fact t={t} label="Task" value={activeSubagent.description} />
          <Fact t={t} label="Last reported action" value={activeSubagent.detail} />
          <Fact
            t={t}
            label="Running for"
            value={startedAt === null ? "start time not recorded" : formatElapsed(Math.max(0, now - startedAt))}
          />
          <Fact t={t} label="Idle" value={describeIdle(lastActivityAt, now)} />
        </>
      ) : (
        <text fg={t.textMuted}>{"No foreground sub-agent is running."}</text>
      )}

      <SectionTitle t={t} title={`Background delegations running (${running.length})`} />
      {running.length === 0 ? (
        <text fg={t.textMuted}>{"None running."}</text>
      ) : (
        running.map((delegation) => (
          <box key={delegation.id} paddingBottom={1} flexDirection="column">
            <Fact
              t={t}
              label="Agent"
              value={`${formatSubagentName(delegation.agent)} · ${delegation.id}`}
              tone={t.subagentAccent}
            />
            <Fact t={t} label="Task" value={delegation.description} />
            <Fact
              t={t}
              label="Running for"
              value={elapsedFromIso(delegation.startedAt, now) ?? "start time not recorded"}
            />
          </box>
        ))
      )}
      {running.length > 0 ? (
        <text fg={t.textDim}>
          {
            "A background delegation runs in a detached process and reports no intermediate progress — only start, finish, and its saved output."
          }
        </text>
      ) : null}

      <SectionTitle t={t} title={`Finished (${finished.length})`} />
      {finished.length === 0 ? (
        <text fg={t.textMuted}>{"No delegation has finished in this workspace yet."}</text>
      ) : (
        finished.slice(0, 12).map((delegation) => (
          <box key={delegation.id} paddingBottom={1} flexDirection="column">
            <text fg={delegation.status === "error" ? t.danger : t.success}>
              {`${delegation.status === "error" ? "×" : "✓"} ${formatSubagentName(delegation.agent)} · ${delegation.id}`}
            </text>
            <text fg={t.textMuted}>{normalizeText(delegation.summary)}</text>
            <text fg={t.textDim}>{describeFinishedAgo(delegation.completedAt, now)}</text>
          </box>
        ))
      )}
      {finished.length > 12 ? (
        <text fg={t.textDim}>{`+ ${finished.length - 12} older delegation records on disk`}</text>
      ) : null}

      <box paddingTop={1} flexDirection="column">
        <text fg={t.textDim}>{describeCollapseRule()}</text>
        <text fg={t.textDim}>
          {
            'Source: the live sub-agent status stream and the delegation records `delegation_list`/`delegation_read` read. Use `delegation_read("<id>")` for a finished run\'s full output.'
          }
        </text>
      </box>
    </box>
  );
}

/** Honest idle wording: says so plainly when the host holds no timestamp, instead of showing 0s. */
function describeIdle(lastActivityAt: number | null, now: number): string {
  if (lastActivityAt === null) return "no activity timestamp recorded";
  return `${formatElapsed(Math.max(0, now - lastActivityAt))} since the last reported action`;
}

/** The literal collapse rule, stated in the `/tasks` view so the strip's behavior is explained. */
function describeCollapseRule(): string {
  return `A running agent's transcript row collapses to a one-line /tasks pointer after ${Math.round(
    AGENT_IDLE_COLLAPSE_MS / 1000,
  )}s with no newly observed activity. Nothing is discarded — this view keeps the full record.`;
}

function describeFinishedAgo(completedAt: string | undefined, now: number): string {
  const at = isoToMs(completedAt);
  return at === null ? "completion time not recorded" : `finished ${formatElapsed(Math.max(0, now - at))} ago`;
}

function EvidenceTab({
  t,
  status,
  kernel,
  changedFiles,
  contextSummary,
  contextStats,
}: {
  t: Theme;
  status: UiCompletionStatus;
  kernel: KernelState | null;
  changedFiles: string[];
  contextSummary: AgentContextSummary | null;
  contextStats: InspectorContextStats | null;
}) {
  return (
    <box flexDirection="column" paddingBottom={1}>
      <SectionTitle t={t} title="Completion gate" />
      <Fact t={t} label="Decision" value={completionLabel(status)} tone={completionColor(status, t)} />
      <Fact t={t} label="Kernel phase" value={kernel?.phase ?? "not started"} />
      <Fact t={t} label="Verification" value={verificationLabel(kernel)} tone={verificationColor(kernel, t)} />
      <Fact t={t} label="Diff review" value={kernel?.reviewPassed ? "passed" : "not passed"} />
      {kernel?.verificationDetails ? (
        <Fact t={t} label="Verification detail" value={kernel.verificationDetails} />
      ) : null}
      {kernel?.phase === "review" ? (
        <box paddingTop={1} paddingBottom={1}>
          <text fg={t.warning}>
            {"This coding turn is held at review until host verification runs. Use /verify when ready."}
          </text>
        </box>
      ) : null}

      <SectionTitle t={t} title="Changed files" />
      {changedFiles.length > 0 ? (
        changedFiles.map((filePath) => <text key={filePath} fg={t.text}>{`- ${filePath}`}</text>)
      ) : (
        <text fg={t.textMuted}>{"No changed files recorded by the host."}</text>
      )}

      <SectionTitle t={t} title="Context used" />
      {contextSummary ? (
        <box flexDirection="column">
          <Fact t={t} label="Turn kind" value={contextSummary.classification.kind} />
          <Fact t={t} label="Reason" value={contextSummary.classification.reason} />
          <Fact
            t={t}
            label="Selected files"
            value={contextSummary.files.length + (contextSummary.truncated ? " (truncated)" : "")}
          />
          {contextSummary.files.slice(0, 12).map((filePath) => (
            <text key={filePath} fg={t.textDim}>{`  ${filePath}`}</text>
          ))}
        </box>
      ) : (
        <text fg={t.textMuted}>{"Context is compiled when the next turn starts."}</text>
      )}
      {contextStats ? (
        <Fact
          t={t}
          label="Context estimate"
          value={`${formatTokenCount(contextStats.usedTokens)} used / ${formatTokenCount(contextStats.contextWindow)} window`}
        />
      ) : null}
      <box paddingTop={1}>
        <text fg={t.textDim}>{"Evidence here is host state only; private model reasoning is not displayed."}</text>
      </box>
    </box>
  );
}

function SectionTitle({ t, title }: { t: Theme; title: string }) {
  return (
    <box paddingTop={1} paddingBottom={1}>
      <text fg={t.primary}>
        <b>{title}</b>
      </text>
    </box>
  );
}

function Fact({ t, label, value, tone }: { t: Theme; label: string; value: string; tone?: string }) {
  return (
    <box flexDirection="row">
      <text fg={t.textMuted}>{`${label}: `}</text>
      <text fg={tone ?? t.text}>{value}</text>
    </box>
  );
}

function SidebarSection({ t, title, children }: { t: Theme; title: string; children: React.ReactNode }) {
  return (
    <box paddingTop={1} flexDirection="column">
      <text fg={t.primary}>
        <b>{title}</b>
      </text>
      <box flexDirection="column">{children}</box>
    </box>
  );
}

function SidebarFact({ t, label, value, tone }: { t: Theme; label: string; value: string; tone?: string }) {
  return (
    <box flexDirection="row">
      <text fg={t.textDim}>{`${label}: `}</text>
      <text fg={tone ?? t.textMuted}>{value}</text>
    </box>
  );
}

function ActivityRow({ t, event }: { t: Theme; event: UiActivityEvent }) {
  const tone = event.status === "failed" ? t.danger : event.status === "active" ? t.accent : t.text;
  return (
    <box paddingTop={1} flexDirection="column">
      <text fg={tone}>
        <b>{`${activityMark(event.status)} ${event.label}`}</b>
        <span style={{ fg: t.textDim }}>{`  ${event.kind}`}</span>
      </text>
      {event.detail ? <text fg={t.textMuted}>{truncate(event.detail, 180)}</text> : null}
      {event.source ? <text fg={t.textDim}>{`source: ${event.source}`}</text> : null}
    </box>
  );
}

function EmptyState({ t, title, detail }: { t: Theme; title: string; detail: string }) {
  return (
    <box paddingTop={2} paddingBottom={2} flexDirection="column">
      <text fg={t.text}>{title}</text>
      <text fg={t.textMuted}>{detail}</text>
    </box>
  );
}

function completionColor(status: UiCompletionStatus, t: Theme): string {
  switch (status) {
    case "passed":
      return t.success;
    case "verification-needed":
      return t.warning;
    case "paused":
      return t.warning;
    case "blocked":
    case "cancelled":
      return t.danger;
    case "active":
      return t.accent;
    default:
      return t.textMuted;
  }
}

function verificationColor(kernel: KernelState | null, t: Theme): string {
  if (!kernel) return t.textMuted;
  if (kernel.verificationPassed) return t.success;
  if (kernel.phase === "blocked") return t.danger;
  return t.warning;
}

function verificationLabel(kernel: KernelState | null): string {
  if (!kernel) return "not started";
  if (kernel.verificationPassed) return "passed";
  if (kernel.phase === "review") return "not run for this coding turn";
  return "not passed";
}

type CriterionMark = "verified" | "linked" | "unverified" | "attempted" | "pending";

/**
 * Mostly still coarse and honest — evidence is tracked per-turn, not causally per-criterion, so
 * most published criteria get the SAME aggregate mark rather than a fabricated individual
 * verdict. The one real exception (§18): "linked" — this SPECIFIC criterion's id was named in a
 * step the model marked `complete` via `update_plan_step` THIS turn, AND some real verification
 * evidence exists this turn. That is a genuine, model-declared association (not inferred from
 * text, not assumed), but it is still not a causal proof that one particular check covered this
 * one particular criterion — hence a distinct mark from the full `verified` (a real host
 * `/verify` run), not the same one. "passed"/"verified" only follows `kernel.verificationPassed`;
 * "unverified" only when the gate is certain zero verification actions happened; otherwise
 * "attempted" (some unlinked evidence exists) or "pending" (turn still in progress).
 */
function criterionMark(
  kernel: KernelState | null,
  evidenceCount: number,
  criterionId: string,
  linkedCriteriaIds: string[],
): CriterionMark {
  if (kernel?.verificationPassed) return "verified";
  if (kernel?.phase === "blocked" && evidenceCount === 0) return "unverified";
  if (evidenceCount > 0 && linkedCriteriaIds.includes(criterionId)) return "linked";
  if (evidenceCount > 0) return "attempted";
  return "pending";
}

function criterionMarkSymbol(mark: CriterionMark): string {
  switch (mark) {
    case "verified":
      return "✓";
    case "linked":
      return "●";
    case "unverified":
      return "×";
    case "attempted":
      return "○";
    case "pending":
      return "○";
  }
}

/** Honest summary line beneath the criteria list — never claims more linkage than actually happened. */
function verificationEvidenceSummaryLine(status: VerificationStatus): string {
  const total = status.criteria?.length ?? 0;
  if (status.evidenceCount === 0) return "No verification action observed this turn";
  const linkedCount = status.criteria?.filter((c) => status.linkedCriteriaIds.includes(c.id)).length ?? 0;
  const actionWord = `${status.evidenceCount} verification action${status.evidenceCount === 1 ? "" : "s"} observed this turn`;
  if (linkedCount === 0) return `${actionWord} — not mapped to individual criteria`;
  if (linkedCount === total) return `${actionWord} — all criteria explicitly linked to a completed step`;
  return `${actionWord} — ${linkedCount} of ${total} criteria explicitly linked, the rest aggregate only`;
}

function criterionTone(mark: CriterionMark, t: Theme): string {
  switch (mark) {
    case "verified":
      return t.success;
    case "linked":
      return t.success;
    case "unverified":
      return t.danger;
    case "attempted":
      return t.warning;
    case "pending":
      return t.textMuted;
  }
}

function statusMark(status: UiCompletionStatus): string {
  switch (status) {
    case "passed":
      return "OK";
    case "blocked":
      return "!!";
    case "cancelled":
      return "--";
    case "verification-needed":
      return "??";
    case "active":
      return ">>";
    case "paused":
      return "||";
    default:
      return "..";
  }
}

function activityMark(status: UiActivityEvent["status"]): string {
  switch (status) {
    case "complete":
      return "OK";
    case "failed":
      return "!!";
    default:
      return ">>";
  }
}

function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`;
  return String(tokens);
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function ContextBar({ t, ratio, width }: { t: Theme; ratio: number; width: number }) {
  const cells = Math.max(8, width);
  const filled = Math.max(0, Math.min(cells, Math.round(ratio * cells)));
  return (
    <text>
      <span style={{ fg: contextHealthColor(ratio, t) }}>{"█".repeat(filled)}</span>
      <span style={{ fg: t.border }}>{"░".repeat(cells - filled)}</span>
    </text>
  );
}

function planStepMark(status: PlanStepStatus | undefined): string {
  switch (status) {
    case "working":
      return "●";
    case "complete":
      return "✓";
    case "failed":
      return "×";
    default:
      return "○";
  }
}

function planStepColor(status: PlanStepStatus | undefined, t: Theme): string {
  switch (status) {
    case "working":
      return t.accent;
    case "complete":
      return t.success;
    case "failed":
      return t.danger;
    default:
      return t.textMuted;
  }
}

function isoToMs(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function elapsedFromIso(value: string | undefined, now: number): string | null {
  const startedAt = isoToMs(value);
  return startedAt === null ? null : formatElapsed(Math.max(0, now - startedAt));
}

function formatCostMicros(costMicros: number): string {
  if (costMicros <= 0) return "$0.00";
  const dollars = costMicros / 1_000_000;
  return `$${dollars.toFixed(dollars < 0.01 ? 4 : 2)}`;
}

function contextHealth(ratioUsed: number): string {
  if (ratioUsed >= 0.85) return "Near compaction";
  if (ratioUsed >= 0.6) return "Growing";
  return "Healthy";
}

function contextHealthColor(ratioUsed: number, t: Theme): string {
  if (ratioUsed >= 0.85) return t.warning;
  if (ratioUsed >= 0.6) return t.accent;
  return t.success;
}

function shortId(value: string): string {
  return value.length > 16 ? `${value.slice(0, 8)}...${value.slice(-4)}` : value;
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, max: number): string {
  const normalized = normalizeText(value);
  return normalized.length > max ? `${normalized.slice(0, Math.max(1, max - 3))}...` : normalized;
}
