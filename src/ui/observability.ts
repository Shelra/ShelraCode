import type { KernelPhase, KernelState } from "../agent/kernel";
import { MEMORY_INDEX_MAX_BYTES, MEMORY_INDEX_MAX_LINES } from "../memory/store";
import type { MemoryIndexEntry, MemoryReadIndexResult } from "../memory/types";
import type { ChatEntry, Plan, ReasoningEffort, UsageEvent } from "../types/index";

export type UiActivityKind = "research" | "step" | "tool" | "agent" | "verification" | "memory" | "error";
export type UiActivityStatus = "active" | "complete" | "failed";

export interface UiActivityEvent {
  id: string;
  kind: UiActivityKind;
  status: UiActivityStatus;
  label: string;
  detail?: string;
  source?: string;
  /** Runtime operation name. Kept separate from the human-facing label for semantic grouping. */
  operation?: string;
  at: number;
}

export type TranscriptActivityKind =
  | "exploration"
  | "research"
  | "changes"
  | "verification"
  | "command"
  | "plan"
  | "agent";

export interface TranscriptActivityItem {
  kind: "activity";
  id: string;
  activityKind: TranscriptActivityKind;
  status: "complete" | "failed";
  title: string;
  details: string[];
  count: number;
  at: number;
}

export interface TranscriptMessageItem {
  kind: "message";
  id: string;
  entry: ChatEntry;
  sourceIndex: number;
}

export type TranscriptItem = TranscriptActivityItem | TranscriptMessageItem;

export interface SessionUsageSummary {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costMicros: number;
  eventCount: number;
  models: string[];
  sources: string[];
  lastUpdatedAt: number | null;
}

export type UiCompletionStatus =
  | "idle"
  | "active"
  | "paused"
  | "verification-needed"
  | "passed"
  | "blocked"
  | "cancelled";

const PHASE_LABELS: Record<KernelPhase, string> = {
  frame: "Framing request",
  discover: "Inspecting project",
  analyze: "Understanding request",
  plan: "Planning",
  act: "Working",
  observe: "Observing result",
  reflect: "Summarizing",
  verify: "Verifying",
  review: "Verification needed",
  complete: "Verified complete",
  blocked: "Blocked",
  cancelled: "Cancelled",
};

export function phaseLabel(kernel: KernelState | null, isProcessing: boolean): string {
  if (kernel)
    return !isProcessing && isActivePhase(kernel.phase)
      ? `Paused: ${PHASE_LABELS[kernel.phase]}`
      : PHASE_LABELS[kernel.phase];
  return isProcessing ? "Starting turn" : "Idle";
}

export function completionStatus(kernel: KernelState | null, isProcessing: boolean): UiCompletionStatus {
  if (!kernel) return isProcessing ? "active" : "idle";

  switch (kernel.phase) {
    case "complete":
      return "passed";
    case "review":
      return "verification-needed";
    case "blocked":
      return "blocked";
    case "cancelled":
      return "cancelled";
    default:
      return isProcessing ? "active" : "paused";
  }
}

export function completionLabel(status: UiCompletionStatus): string {
  switch (status) {
    case "idle":
      return "No active turn";
    case "active":
      return "In progress";
    case "paused":
      return "Last runtime state; not currently running";
    case "verification-needed":
      return "Host verification needed";
    case "passed":
      return "Completion allowed";
    case "blocked":
      return "Completion blocked";
    case "cancelled":
      return "Cancelled";
  }
}

function isActivePhase(phase: KernelPhase): boolean {
  return ["frame", "discover", "analyze", "plan", "act", "observe", "reflect", "verify"].includes(phase);
}

export function upsertActivity(current: UiActivityEvent[], next: UiActivityEvent, limit = 100): UiActivityEvent[] {
  const existingIndex = current.findIndex((event) => event.id === next.id);
  const merged =
    existingIndex < 0 ? [...current, next] : current.map((event, index) => (index === existingIndex ? next : event));
  merged.sort((left, right) => left.at - right.at);
  return merged.slice(-Math.max(1, limit));
}

export function changedFiles(entries: ChatEntry[], kernel: KernelState | null): string[] {
  const paths = new Set<string>(kernel?.mutations ?? []);

  for (const entry of entries) {
    const filePath = entry.toolResult?.diff?.filePath;
    if (filePath) paths.add(filePath);
  }

  return [...paths].sort((left, right) => left.localeCompare(right));
}

export function summarizeSessionUsage(events: UsageEvent[]): SessionUsageSummary {
  const summary: SessionUsageSummary = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    costMicros: 0,
    eventCount: events.length,
    models: [],
    sources: [],
    lastUpdatedAt: null,
  };
  const models = new Set<string>();
  const sources = new Set<string>();

  for (const event of events) {
    summary.inputTokens += event.inputTokens;
    summary.outputTokens += event.outputTokens;
    summary.totalTokens += event.totalTokens;
    summary.costMicros += event.costMicros;
    if (event.model) models.add(event.model);
    if (event.source) sources.add(event.source);
    const at = event.createdAt instanceof Date ? event.createdAt.getTime() : new Date(event.createdAt).getTime();
    if (Number.isFinite(at)) summary.lastUpdatedAt = Math.max(summary.lastUpdatedAt ?? 0, at);
  }

  summary.models = [...models].sort((left, right) => left.localeCompare(right));
  summary.sources = [...sources].sort((left, right) => left.localeCompare(right));
  return summary;
}

/**
 * Converts persisted transcript tool traffic into calm, semantic activity rows.
 * Model-cycle events never enter this projection: they remain runtime telemetry,
 * not user-facing work.
 */
export function projectTranscript(entries: ChatEntry[]): TranscriptItem[] {
  const items: TranscriptItem[] = [];

  entries.forEach((entry, sourceIndex) => {
    if (entry.type === "tool_call") return;
    if (entry.type === "tool_result" && entry.toolCall?.function.name === "update_plan_step") return;
    if (entry.type !== "tool_result") {
      items.push({
        kind: "message",
        id: `message:${sourceIndex}:${entry.timestamp.getTime()}`,
        entry,
        sourceIndex,
      });
      return;
    }

    const activity = activityFromToolResult(entry, sourceIndex);
    if (!activity) {
      items.push({
        kind: "message",
        id: `message:${sourceIndex}:${entry.timestamp.getTime()}`,
        entry,
        sourceIndex,
      });
      return;
    }

    const previous = items.at(-1);
    if (
      previous?.kind === "activity" &&
      previous.activityKind === activity.activityKind &&
      isCollapsibleActivity(activity.activityKind)
    ) {
      previous.status = previous.status === "failed" || activity.status === "failed" ? "failed" : "complete";
      previous.count += activity.count;
      previous.details = uniqueDetails([...previous.details, ...activity.details]);
      previous.at = activity.at;
      previous.title = activityTitle(previous.activityKind, previous.status, previous.count, previous.details);
      return;
    }

    items.push(activity);
  });

  return items;
}

/** Replays persisted, explicit plan updates over the latest published plan. */
export function resolvePlanState(entries: ChatEntry[]): Plan | null {
  let plan: Plan | null = null;

  for (const entry of entries) {
    if (entry.toolResult?.plan) {
      plan = {
        ...entry.toolResult.plan,
        steps: entry.toolResult.plan.steps.map((step) => ({ ...step, status: step.status ?? "pending" })),
      };
      continue;
    }

    const update = entry.toolResult?.planUpdate;
    if (!plan || !update || !plan.steps[update.index]) continue;
    plan = {
      ...plan,
      steps: plan.steps.map((step, index) =>
        index === update.index
          ? { ...step, status: update.status, ...(update.evidence ? { evidence: update.evidence } : {}) }
          : step,
      ),
    };
  }

  return plan;
}

/** Only meaningful host activity belongs in the live tree. */
export function visibleRuntimeActivity(events: UiActivityEvent[]): UiActivityEvent[] {
  return events.filter(
    (event) =>
      event.kind !== "step" &&
      event.operation !== "update_plan_step" &&
      (event.status === "active" ||
        event.kind === "research" ||
        event.kind === "verification" ||
        event.kind === "memory" ||
        event.kind === "error"),
  );
}

export interface LiveActivityLine {
  key: string;
  text: string;
}

/**
 * Collapses raw in-flight tool events into counted summary lines — "Explored 12 files",
 * "Searched 18 symbols" — instead of one row per tool call. Mirrors the categorization
 * `activityFromToolResult` already uses for the persisted transcript, so a still-running
 * phase and its eventual collapsed history line read the same way. Real counts only; a
 * category with zero events produces no line rather than a "0" line.
 */
export function groupLiveActivity(events: UiActivityEvent[]): LiveActivityLine[] {
  let filesRead = 0;
  let symbolsSearched = 0;
  let sourcesResearched = 0;
  let filesChanged = 0;
  let filesDeleted = 0;
  let commandsRun = 0;
  const agentLines: string[] = [];
  const memoryLines: string[] = [];

  for (const event of events) {
    switch (event.operation) {
      case "read_file":
        filesRead += 1;
        break;
      case "grep":
      case "lsp":
        symbolsSearched += 1;
        break;
      case "search_web":
      case "search_x":
      case "open_web":
        sourcesResearched += 1;
        break;
      case "write_file":
      case "edit_file":
        filesChanged += 1;
        break;
      case "delete_file":
        filesDeleted += 1;
        break;
      case "bash":
        commandsRun += 1;
        break;
      case "task":
      case "delegate":
        if (event.label) agentLines.push(event.label);
        break;
      case "memory":
        if (event.label) memoryLines.push(event.label);
        break;
      default:
        break;
    }
  }

  const lines: LiveActivityLine[] = [];
  if (filesRead > 0) lines.push({ key: "explored", text: `Explored ${filesRead} file${filesRead === 1 ? "" : "s"}` });
  if (symbolsSearched > 0) {
    lines.push({ key: "searched", text: `Searched ${symbolsSearched} symbol${symbolsSearched === 1 ? "" : "s"}` });
  }
  if (sourcesResearched > 0) {
    lines.push({
      key: "researched",
      text: `Researched ${sourcesResearched} source${sourcesResearched === 1 ? "" : "s"}`,
    });
  }
  if (filesChanged > 0)
    lines.push({ key: "changed", text: `Updated ${filesChanged} file${filesChanged === 1 ? "" : "s"}` });
  if (filesDeleted > 0)
    lines.push({ key: "deleted", text: `Deleted ${filesDeleted} file${filesDeleted === 1 ? "" : "s"}` });
  if (commandsRun > 0)
    lines.push({ key: "commands", text: `Ran ${commandsRun} command${commandsRun === 1 ? "" : "s"}` });
  for (const [index, line] of agentLines.entries()) lines.push({ key: `agent:${index}`, text: line });
  for (const [index, line] of memoryLines.entries()) lines.push({ key: `memory:${index}`, text: line });
  return lines;
}

/**
 * The SESSION sidebar's honest "Effort" line — never claims a level the model doesn't actually
 * support (see docs/migration/14-AGENT-HARNESS-RECONSTRUCTION.md §11, §14 Phase 2 item 2).
 * Mirrors `Agent.resolveReasoningEffort()`'s own precedence exactly: `override` (an explicit
 * `/effort` choice, session-wide) wins first; `perModel` (the `/models` picker's per-model
 * choice, `reasoningEffortByModel[modelId]`) wins next; otherwise `effective` is whatever the
 * agent-mode auto-default resolved to (shown as "<level> (auto)"), or plain "auto" when nothing
 * explicit will be sent at all.
 */
export function describeReasoningEffort(
  override: ReasoningEffort | null,
  perModel: ReasoningEffort | undefined,
  effective: ReasoningEffort | undefined,
  supported: readonly ReasoningEffort[],
): string {
  if (supported.length === 0) return "not supported";
  if (override && supported.includes(override)) return override;
  if (perModel && supported.includes(perModel)) return perModel;
  return effective ? `${effective} (auto)` : "auto";
}

export interface MemoryStatus {
  entryCount: number;
  /** Highest of the byte-cap and line-cap ratios — whichever limit the index would hit first. */
  capacityRatio: number;
}

/**
 * Honest MEMORY sidebar summary — real entry count and real capacity usage against the same
 * `MEMORY_INDEX_MAX_BYTES`/`MEMORY_INDEX_MAX_LINES` caps `writeMemoryEntry` itself enforces
 * (docs/migration/14-AGENT-HARNESS-RECONSTRUCTION.md §16), never a placeholder. Takes the raw
 * `MemoryReadIndexResult` from `readMemoryIndex` directly so this stays a pure, testable function
 * independent of the filesystem call itself.
 */
export function summarizeMemoryStatus(index: Pick<MemoryReadIndexResult, "entries" | "raw">): MemoryStatus {
  const entries: MemoryIndexEntry[] = index.entries;
  const byteRatio = index.raw ? Buffer.byteLength(index.raw, "utf8") / MEMORY_INDEX_MAX_BYTES : 0;
  const lineRatio = entries.length / MEMORY_INDEX_MAX_LINES;
  return { entryCount: entries.length, capacityRatio: Math.max(byteRatio, lineRatio) };
}

/**
 * Three-tier sub-agent disclosure threshold (docs/migration/14-AGENT-HARNESS-RECONSTRUCTION.md
 * §19, §14 Phase 4). 30s is the same interval Claude Code's own changelog documents for its
 * subagent panel ("idle subagents auto-hide after 30s"), and here it is measured against the last
 * activity the host actually OBSERVED — never against total runtime. An agent that keeps reporting
 * tool calls every few seconds therefore stays fully expanded no matter how long it runs; only one
 * that has gone quiet collapses.
 */
export const AGENT_IDLE_COLLAPSE_MS = 30_000;

/**
 * `detail` — tier 1: full live row (name, current activity, elapsed).
 * `collapsed` — tier 2: still running, but nothing new observed for `AGENT_IDLE_COLLAPSE_MS`, so
 *   the row shrinks to a one-line pointer instead of restating stale detail forever.
 * `summary` — tier 3: finished (complete or error); the brief outcome row.
 */
export type AgentDisclosureTier = "detail" | "collapsed" | "summary";

export interface AgentDisclosureState {
  tier: AgentDisclosureTier;
  /**
   * Real elapsed ms since the last activity report this host observed for the agent. `null` when
   * the host holds no usable timestamp at all — in that case nothing may be claimed about idleness
   * and the row stays expanded rather than guessing a plausible number.
   */
  idleMs: number | null;
}

export interface AgentDisclosureInput {
  status: "running" | "complete" | "error";
  /**
   * When the host last observed this agent report something real. For a foreground `task`
   * sub-agent that is the timestamp of its last `onSubagentStatus` emission (one per child tool
   * call). For a background `delegate` run it is the delegation's own `startedAt`: the detached
   * child writes no progress into its job record, so the parent has genuinely observed nothing
   * since it started — that is a fact about the data, not a stand-in for missing data.
   */
  lastObservedActivityAt: number | null;
  now: number;
  idleCollapseMs?: number;
}

/**
 * Pure tier selection, deliberately kept out of JSX so the threshold rule is testable on its own.
 * Never infers activity that was not observed: an unparseable/absent timestamp yields `detail`
 * (show what we have) with `idleMs: null` (claim nothing), not a fabricated idle duration.
 */
export function resolveAgentDisclosure(input: AgentDisclosureInput): AgentDisclosureState {
  if (input.status !== "running") return { tier: "summary", idleMs: null };
  const lastAt = input.lastObservedActivityAt;
  if (lastAt === null || !Number.isFinite(lastAt)) return { tier: "detail", idleMs: null };
  const idleMs = Math.max(0, input.now - lastAt);
  const threshold = input.idleCollapseMs ?? AGENT_IDLE_COLLAPSE_MS;
  return { tier: idleMs >= threshold ? "collapsed" : "detail", idleMs };
}

/**
 * The next not-yet-started plan step, for a "Next" callout. Deliberately sourced from real plan
 * state, never from parsing model text — an invented "next action" would violate the rule that the
 * frontend must not fabricate future intent (only the runtime's own plan can say what happens next).
 */
export function nextPlanStepLabel(plan: Plan | null): string | null {
  if (!plan) return null;
  const next = plan.steps.find((step) => (step.status ?? "pending") === "pending");
  if (!next) return null;
  return next.description && next.description !== next.title ? `${next.title} — ${next.description}` : next.title;
}

function activityFromToolResult(entry: ChatEntry, sourceIndex: number): TranscriptActivityItem | null {
  const toolCall = entry.toolCall;
  const result = entry.toolResult;
  if (!toolCall || !result) return null;

  const operation = toolCall.function.name;
  const args = parseToolArguments(toolCall.function.arguments);
  const status = result.success ? "complete" : "failed";
  const at = entry.timestamp.getTime();
  const id = `activity:${sourceIndex}:${at}`;
  const output = firstUsefulLine(result.error || result.output || entry.content);

  if (operation === "read_file" || operation === "grep" || operation === "lsp") {
    const target = stringArg(args, "path") || stringArg(args, "filePath") || stringArg(args, "query");
    const details = target
      ? [`${operation === "read_file" ? "Read" : operation === "grep" ? "Searched" : "Inspected"} ${target}`]
      : [];
    return makeActivity(id, "exploration", status, details, at);
  }

  if (operation === "search_web" || operation === "search_x" || operation === "open_web") {
    const target = stringArg(args, "query") || stringArg(args, "url");
    return makeActivity(id, "research", status, target ? [target] : [], at);
  }

  if (operation === "write_file" || operation === "edit_file" || operation === "delete_file") {
    const filePath = result.diff?.filePath || stringArg(args, "path");
    const prefix = operation === "delete_file" ? "-" : result.diff?.isNew || operation === "write_file" ? "+" : "M";
    return makeActivity(id, "changes", status, filePath ? [`${prefix} ${filePath}`] : [], at);
  }

  if (operation === "bash") {
    const command = stringArg(args, "command") || stringArg(args, "cmd");
    const kind: TranscriptActivityKind = isVerificationCommand(command) ? "verification" : "command";
    const details = [command, status === "failed" ? output : kind === "verification" ? output : ""].filter(Boolean);
    return makeActivity(id, kind, status, details, at);
  }

  if (operation === "generate_plan" && result.plan) {
    const details = result.plan.goal ? [result.plan.goal] : result.plan.summary ? [result.plan.summary] : [];
    return {
      kind: "activity",
      id,
      activityKind: "plan",
      status,
      title: status === "failed" ? "Plan creation failed" : `Plan created · ${result.plan.steps.length} tasks`,
      details,
      count: result.plan.steps.length,
      at,
    };
  }

  if (operation === "task" || operation === "delegate") {
    const task = result.task;
    const delegation = result.delegation;
    const agent = task?.agent || delegation?.agent || stringArg(args, "agent") || "agent";
    const description = task?.description || delegation?.description || stringArg(args, "description");
    const title =
      status === "failed"
        ? `${agent} failed`
        : operation === "delegate" && delegation?.status === "running"
          ? `Delegated to ${agent}`
          : `${agent} completed`;
    const details = [description, status === "failed" ? output : task?.summary || delegation?.summary || ""].filter(
      Boolean,
    );
    return { kind: "activity", id, activityKind: "agent", status, title, details, count: 1, at };
  }

  return null;
}

function makeActivity(
  id: string,
  activityKind: TranscriptActivityKind,
  status: "complete" | "failed",
  details: string[],
  at: number,
): TranscriptActivityItem {
  const cleanDetails = uniqueDetails(details.filter(Boolean));
  return {
    kind: "activity",
    id,
    activityKind,
    status,
    title: activityTitle(activityKind, status, 1, cleanDetails),
    details: cleanDetails,
    count: 1,
    at,
  };
}

function activityTitle(
  kind: TranscriptActivityKind,
  status: "complete" | "failed",
  count: number,
  details: string[],
): string {
  if (status === "failed") {
    if (kind === "verification") return "Verification failed";
    if (kind === "changes") return "File update failed";
    if (kind === "research") return "Research failed";
    if (kind === "exploration") return "Repository exploration failed";
    if (kind === "command") return "Command failed";
  }

  switch (kind) {
    case "exploration":
      return count === 1 ? "Explored repository" : `Explored repository · ${count} operations`;
    case "research":
      return count === 1 ? "Researched external source" : `Researched external sources · ${count} operations`;
    case "changes": {
      const deleted = details.filter((detail) => detail.startsWith("- ")).length;
      const changed = details.filter((detail) => !detail.startsWith("- ")).length;
      if (deleted > 0 && changed > 0) {
        return `Updated ${changed} file${changed === 1 ? "" : "s"} · deleted ${deleted}`;
      }
      if (deleted > 0) return `Deleted ${deleted} file${deleted === 1 ? "" : "s"}`;
      const files = new Set(details.map((detail) => detail.replace(/^[+M]\s+/, ""))).size;
      return `Updated ${files} file${files === 1 ? "" : "s"}`;
    }
    case "verification":
      return count === 1 ? "Verification passed" : `Verification passed · ${count} checks`;
    case "command":
      return count === 1 ? "Ran command" : `Ran ${count} commands`;
    case "plan":
      return `Plan created · ${count} tasks`;
    case "agent":
      return "Agent completed";
  }
}

function isCollapsibleActivity(kind: TranscriptActivityKind): boolean {
  return ["exploration", "research", "changes", "verification", "command"].includes(kind);
}

function isVerificationCommand(command: string): boolean {
  return /(^|\s|:)(test|tests|lint|typecheck|check|verify|build)(\s|$|:)/i.test(command);
}

function parseToolArguments(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function stringArg(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  return typeof value === "string" ? value.trim() : "";
}

function firstUsefulLine(value: string): string {
  return (
    value
      .split("\n")
      .map((line) => line.trim())
      .find(Boolean) || ""
  ).slice(0, 180);
}

function uniqueDetails(details: string[]): string[] {
  return [...new Set(details.map((detail) => detail.replace(/\s+/g, " ").trim()).filter(Boolean))].slice(0, 12);
}
