import type { KernelPhase, KernelState } from "../agent/kernel";
import { MEMORY_INDEX_MAX_BYTES, MEMORY_INDEX_MAX_LINES } from "../memory/store";
import type { MemoryIndexEntry, MemoryReadIndexResult } from "../memory/types";
import type { ChatEntry, Plan, ReasoningEffort, UsageEvent } from "../types/index";
import {
  type ActivityGroup,
  type ActivityRowModel,
  type ActivityTone,
  describeToolResult,
  formatDuration,
} from "./activity";

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

export interface TranscriptActivityItem {
  kind: "activity";
  id: string;
  group: ActivityGroup;
  /** One evidence row per finished operation, oldest first. */
  rows: ActivityRowModel[];
  at: number;
}

export interface TranscriptMessageItem {
  kind: "message";
  id: string;
  entry: ChatEntry;
  sourceIndex: number;
}

/** What the model reasoned about during one turn, shown right after the user message. */
export interface TurnThought {
  durationMs: number;
  /** Bounded tail of the streamed reasoning. Never persisted. */
  text: string;
  /** How many separate reasoning phases the turn had. */
  steps: number;
}

export interface TranscriptThoughtItem extends TurnThought {
  kind: "thought";
  id: string;
}

/**
 * What one finished turn did, in one line: files changed with their diffstat, checks that ran, and
 * how long it took. Only emitted for turns that changed files or ran a check.
 */
export interface TranscriptSummaryItem {
  kind: "summary";
  id: string;
  changes: ChangeSummary[];
  checks: CheckSummary[];
  /** Wall time from the user's message to the last thing that happened, when known. */
  durationMs: number | null;
}

export type TranscriptItem =
  | TranscriptActivityItem
  | TranscriptMessageItem
  | TranscriptThoughtItem
  | TranscriptSummaryItem;

export interface SummarySegment {
  text: string;
  tone: ActivityTone | "added" | "removed";
}

/**
 * The parts of a turn's one-line summary, grouped as files, checks and time. The renderer joins the
 * groups with a dot: `2 files +6 -1 · tests ✓ · 42s`.
 */
export function turnSummaryGroups(item: TranscriptSummaryItem): SummarySegment[][] {
  const groups: SummarySegment[][] = [];
  if (item.changes.length > 0) {
    const additions = item.changes.reduce((sum, change) => sum + change.additions, 0);
    const removals = item.changes.reduce((sum, change) => sum + change.removals, 0);
    const files = item.changes.length;
    const group: SummarySegment[] = [{ text: `${files} file${files === 1 ? "" : "s"}`, tone: "neutral" }];
    if (additions > 0) group.push({ text: ` +${additions}`, tone: "added" });
    if (removals > 0) group.push({ text: ` -${removals}`, tone: "removed" });
    groups.push(group);
  }
  for (const check of item.checks.slice(0, 3)) {
    const failed = check.tone === "danger";
    const failures = /(\d+)\s*fail/i.exec(check.meta)?.[1];
    groups.push([
      { text: `${check.label} `, tone: "neutral" },
      { text: failed ? (failures ? `× ${failures} failed` : "×") : "✓", tone: failed ? "danger" : "success" },
    ]);
  }
  if (item.durationMs !== null && item.durationMs >= 1000) {
    groups.push([{ text: formatDuration(item.durationMs), tone: "neutral" }]);
  }
  return groups;
}

export interface ProjectTranscriptOptions {
  /** Wall time per tool call, keyed by tool call id. Absent for calls made before this process started. */
  durations?: ReadonlyMap<string, number>;
  /** Reasoning per user turn, indexed by the turn's ordinal (0 = first user message). */
  thoughts?: ReadonlyArray<TurnThought | undefined>;
  /** How many memories retrieval injected per user turn, indexed like `thoughts`. */
  recalls?: ReadonlyArray<number | undefined>;
  /** The last turn is still running, so it has no summary yet. */
  live?: boolean;
}

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
 * Converts persisted transcript tool traffic into evidence rows: what was read, what changed
 * (with a diffstat), what ran and what it reported. Consecutive rows of one group share an item so
 * the renderer can fold a run of reads into a single "Read 3 files" line. Model-cycle events never
 * enter this projection: they remain runtime telemetry, not user-facing work.
 */
export function projectTranscript(entries: ChatEntry[], options: ProjectTranscriptOptions = {}): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  let userOrdinal = 0;

  // The turn being read: from a user message up to the next one.
  let turnEntries: ChatEntry[] = [];
  let turnItemsFrom = 0;
  let turnStartAt: number | null = null;
  let turnLastAt: number | null = null;

  const closeTurn = (isLast: boolean) => {
    if (turnStartAt === null || (isLast && options.live)) return;
    const changes = summarizeChanges(turnEntries);
    const checks = summarizeChecks(items.slice(turnItemsFrom));
    if (changes.length === 0 && checks.length === 0) return;
    const elapsed = turnLastAt !== null ? turnLastAt - turnStartAt : 0;
    items.push({
      kind: "summary",
      id: `summary:${userOrdinal - 1}`,
      changes,
      checks,
      durationMs: elapsed > 0 ? elapsed : null,
    });
  };

  entries.forEach((entry, sourceIndex) => {
    if (entry.type === "user") closeTurn(false);
    else {
      turnEntries.push(entry);
      turnLastAt = entry.timestamp.getTime();
    }

    if (entry.type === "tool_call") return;
    if (entry.type === "tool_result" && entry.toolCall?.function.name === "update_plan_step") return;

    const messageItem = (): TranscriptMessageItem => ({
      kind: "message",
      id: `message:${sourceIndex}:${entry.timestamp.getTime()}`,
      entry,
      sourceIndex,
    });

    if (entry.type !== "tool_result") {
      items.push(messageItem());
      if (entry.type === "user") {
        const thought = options.thoughts?.[userOrdinal];
        if (thought) items.push({ ...thought, kind: "thought", id: `thought:${userOrdinal}` });
        const recalled = options.recalls?.[userOrdinal] ?? 0;
        if (recalled > 0) {
          const at = entry.timestamp.getTime();
          items.push({
            kind: "activity",
            id: `load:${userOrdinal}`,
            group: "load",
            at,
            rows: [
              {
                id: `load:${userOrdinal}:memory`,
                group: "load",
                tone: "neutral",
                verb: "Recalled",
                object: `${recalled} ${recalled === 1 ? "memory" : "memories"}`,
                lines: [],
                operation: "memory_recall",
              },
            ],
          });
        }
        userOrdinal += 1;
        turnEntries = [];
        turnItemsFrom = items.length;
        turnStartAt = entry.timestamp.getTime();
        turnLastAt = turnStartAt;
      }
      return;
    }

    const at = entry.timestamp.getTime();
    const row =
      entry.toolCall && entry.toolResult
        ? describeToolResult(entry.toolCall, entry.toolResult, {
            id: `row:${sourceIndex}:${at}`,
            durationMs: options.durations?.get(entry.toolCall.id),
          })
        : null;
    if (!row) {
      items.push(messageItem());
      return;
    }

    const previous = items.at(-1);
    if (previous?.kind === "activity" && previous.group === row.group) {
      previous.rows.push(row);
      previous.at = at;
      return;
    }
    items.push({ kind: "activity", id: `activity:${sourceIndex}:${at}`, group: row.group, rows: [row], at });
  });

  closeTurn(true);
  return items;
}

export interface ChangeSummary {
  path: string;
  additions: number;
  removals: number;
  kind: "added" | "modified" | "deleted";
}

/**
 * One line per file the session changed, with accumulated diffstat. Built from persisted tool
 * results only, so every number can be traced to a real edit. Order = first time a file was touched.
 */
export function summarizeChanges(entries: readonly ChatEntry[]): ChangeSummary[] {
  const byPath = new Map<string, ChangeSummary>();
  for (const entry of entries) {
    const name = entry.toolCall?.function.name;
    const diff = entry.toolResult?.diff;
    if (entry.type !== "tool_result" || !entry.toolResult?.success || !diff) continue;
    if (name !== "write_file" && name !== "edit_file" && name !== "delete_file") continue;
    const previous = byPath.get(diff.filePath);
    const kind = name === "delete_file" ? "deleted" : previous?.kind === "added" || diff.isNew ? "added" : "modified";
    byPath.set(diff.filePath, {
      path: diff.filePath,
      additions: (previous?.additions ?? 0) + diff.additions,
      removals: (previous?.removals ?? 0) + diff.removals,
      kind,
    });
  }
  return [...byPath.values()];
}

export interface CheckSummary {
  command: string;
  /** What kind of check it is, in one word: "tests", "types", "lint", "build" — or the command itself. */
  label: string;
  tone: ActivityTone;
  /** "5 pass · 1.1s", "3 pass · 2 fail". */
  meta: string;
}

function checkLabel(row: Pick<ActivityRowModel, "verb" | "object">): string {
  if (/^Tests?\b/i.test(row.verb)) return "tests";
  if (/^Type/i.test(row.verb)) return "types";
  if (/^Lint/i.test(row.verb)) return "lint";
  if (/^Buil(?:t|d)\b/i.test(row.verb)) return "build";
  return row.object.length > 24 ? `${row.object.slice(0, 23)}…` : row.object;
}

/** The latest result of each distinct check (tests, types, lint, build) the agent ran. */
export function summarizeChecks(items: readonly TranscriptItem[], limit = 4): CheckSummary[] {
  const latest = new Map<string, CheckSummary>();
  for (const item of items) {
    if (item.kind !== "activity" || item.group !== "verify") continue;
    for (const row of item.rows) {
      latest.delete(row.object);
      latest.set(row.object, { command: row.object, label: checkLabel(row), tone: row.tone, meta: row.meta ?? "" });
    }
  }
  return [...latest.values()].slice(-limit);
}

export interface WorkStatus {
  tone: ActivityTone;
  label: string;
  hint?: string;
}

/**
 * One honest answer to "where does this stand?", from the host gate and the checks that actually ran.
 * A model-run test is evidence; it is not the same as host verification, and the label says so.
 */
export function workStatus(input: {
  kernel: KernelState | null;
  isProcessing: boolean;
  changedCount: number;
  checks: readonly CheckSummary[];
  /** The last request failed at the provider; nothing about the work itself can be claimed. */
  requestFailed?: boolean;
}): WorkStatus {
  const { kernel, isProcessing, changedCount, checks, requestFailed } = input;
  if (isProcessing) return { tone: "active", label: "Working" };
  if (requestFailed) return { tone: "danger", label: "Request failed", hint: "Retry with ↑ then enter" };
  if (kernel?.phase === "blocked") return { tone: "danger", label: "Blocked", hint: kernel.blockedReason };
  if (kernel?.phase === "cancelled") return { tone: "neutral", label: "Stopped" };
  // The latest result of a check beats the kernel's opinion: "Verified" next to a red check is a contradiction.
  const failing = checks.find((check) => check.tone === "danger");
  if (failing) return { tone: "danger", label: "Checks failing", hint: failing.command };
  // A turn that changed nothing and ran nothing has nothing to verify: "Verified" would be a claim without evidence.
  if (kernel?.phase === "complete" && (changedCount > 0 || checks.length > 0)) {
    return { tone: "success", label: "Verified" };
  }
  if (kernel?.phase === "review") return { tone: "warning", label: "Needs verification", hint: "Run /verify" };
  if (changedCount > 0 && checks.length > 0) {
    return { tone: "success", label: "Checks passed", hint: "Host verification not run · /verify" };
  }
  if (changedCount > 0) return { tone: "warning", label: "Unverified", hint: "No checks ran · try /verify" };
  return { tone: "neutral", label: "Ready" };
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

/**
 * The SESSION sidebar's honest "Effort" line — never claims a level the model doesn't actually
 * support (see docs/architecture/14-AGENT-HARNESS-RECONSTRUCTION.md §11, §14 Phase 2 item 2).
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
 * (docs/architecture/14-AGENT-HARNESS-RECONSTRUCTION.md §16), never a placeholder. Takes the raw
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
 * Three-tier sub-agent disclosure threshold (docs/architecture/14-AGENT-HARNESS-RECONSTRUCTION.md
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
