import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Agent, type AgentOptions, type DecisionApproval, type ProcessMessageObserver } from "../agent/agent";
import { isVerificationCommand } from "../agent/verification-evidence";
import type { CheckSpec } from "../contract/types";
import type { BudgetLimits } from "../models/budget";
import type { ProviderAdapter } from "../providers/types";
import type { ToolCall, ToolResult } from "../types/index";
import { describeFailures, gradeWorkspace } from "./grading";
import type { BenchmarkExecutionNotice, BenchmarkTaskExecution } from "./runner";
import type {
  BenchmarkAcceptanceCriterion,
  BenchmarkAcceptanceResult,
  BenchmarkBehavior,
  BenchmarkFailureType,
  BenchmarkTaskDefinition,
} from "./types";

/**
 * Benchmark executor for Shelra's real product path.
 *
 * `--agent shelra` drives every task through `Agent.processMessage()` — the same turn loop,
 * tool set, completion gate, checkpoints, hooks and memory that an interactive or
 * `--prompt` session uses. The older `shelra-executor.ts` drives `AutonomyKernel` instead, a
 * separate engine that shares none of that hardening, so its scores never described what a
 * user actually gets (research/lanes/15-shelracode-forensic-audit.md, section 5.1). This
 * executor exists so a benchmark number can be attributed to the harness people run.
 *
 * The agent never sees the benchmark-owned `CheckSpec`s. It must plan, implement, and verify
 * on its own; the host then grades the finished workspace with the external oracle. That
 * keeps the model from grading its own homework while still measuring whether the harness
 * made it verify before claiming completion.
 */

export interface AgentBenchmarkExecutorOptions {
  provider: ProviderAdapter;
  modelId: string;
  /** Repository root used to resolve `{{benchmarkRoot}}` in oracle commands. */
  benchmarkRoot?: string;
  budget?: BudgetLimits;
  maxToolRounds?: number;
  /** Hard ceiling for one task's agent turn; the turn is aborted and graded as-is afterwards. */
  taskTimeoutMs?: number;
  /** Persist each task's session to SQLite so the full transcript stays inspectable. */
  persistSession?: boolean;
  signal?: AbortSignal;
  /** Extra agent options for tests (timeouts, injected research). */
  agentOptions?: Partial<AgentOptions>;
}

export const DEFAULT_TASK_TIMEOUT_MS = 20 * 60_000;

/**
 * The simulated user of a chain task: it approves a proposed decision that records a rule it stated in
 * this task (its title or rule matches one of the approve patterns) and declines any other, as a user who
 * reads the approval question would. A decline pattern is its veto: a proposal that inverts the rule or
 * replaces it with another is declined even when an approve pattern matches it. So is a proposal that
 * supersedes a decision the task's user did not agree to replace (`replaceable`): the approval question
 * says which decision it replaces, and approving it would retire that one.
 */
export function simulatedDecisionApproval(
  patterns: readonly string[],
  declines: readonly string[] = [],
  replaceable: readonly string[] = [],
): DecisionApproval {
  const approve = patterns.map((pattern) => new RegExp(pattern, "iu"));
  const decline = declines.map((pattern) => new RegExp(pattern, "iu"));
  const agreed = new Set(replaceable.map((id) => id.toUpperCase()));
  return async (decision) => {
    if (decision.supersedes && !agreed.has(decision.supersedes.toUpperCase())) return "reject";
    const text = `${decision.title}\n${decision.rule}`;
    if (decline.some((expression) => expression.test(text))) return "reject";
    return approve.some((expression) => expression.test(text)) ? "approve" : "reject";
  };
}

/**
 * A note the host ends a turn with when the work is not done; a turn that carries one claims nothing. Read
 * from the agent's own record of its end notes, never from the streamed text, where the model can write the
 * same words (review round 3, 2026-09-24).
 */
const HOST_END_NOTE_RE = /^\[(?:Not verified|Not marked complete|Paused|No response|Cancelled|Stopped)\b/mu;

const MUTATION_TOOLS = new Set(["write_file", "edit_file", "delete_file"]);
const RESEARCH_TOOLS = new Set(["search_web", "open_web"]);
const DELEGATION_TOOLS = new Set(["task", "delegate"]);

interface TurnCounters {
  toolCalls: number;
  commandsExecuted: number;
  successfulCommands: string[];
  filesRead: number;
  filesChanged: Set<string>;
  verificationCommands: number;
  researchCalls: number;
  delegations: number;
  failedToolResults: number;
  planCreated: boolean;
  planStepUpdates: number;
  llmSteps: number;
}

interface TokenTotals {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export function createAgentBenchmarkExecutor(options: AgentBenchmarkExecutorOptions) {
  const taskTimeoutMs = options.taskTimeoutMs ?? DEFAULT_TASK_TIMEOUT_MS;
  return {
    async executeTask(
      task: BenchmarkTaskDefinition,
      context: { signal?: AbortSignal; emit: (notice: BenchmarkExecutionNotice) => void },
    ): Promise<BenchmarkTaskExecution> {
      const workspace = task.workspace ?? process.cwd();
      const startedAt = Date.now();
      const runSignal = context.signal ?? options.signal;
      const controller = new AbortController();
      const abortFromRun = () => controller.abort();
      runSignal?.addEventListener("abort", abortFromRun, { once: true });
      if (runSignal?.aborted) controller.abort();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, taskTimeoutMs);

      const agent = new Agent(undefined, undefined, options.modelId, options.maxToolRounds, {
        provider: options.provider,
        cwd: workspace,
        budget: options.budget,
        persistSession: options.persistSession ?? true,
        ...(options.agentOptions ?? {}),
      });
      controller.signal.addEventListener("abort", () => agent.abort(), { once: true });
      if (task.approveDecisions || task.declineDecisions) {
        const answer = simulatedDecisionApproval(
          task.approveDecisions ?? [],
          task.declineDecisions,
          task.supersedeDecisions,
        );
        agent.setDecisionApproval(async (decision, signal) => {
          const verdict = await answer(decision, signal);
          context.emit({
            type: "note",
            taskId: task.id,
            message: `The simulated user answered "${verdict}" to ${decision.id}: ${decision.title}`,
            payload: { decision: decision.id, verdict },
          });
          return verdict;
        });
      }

      const counters: TurnCounters = {
        toolCalls: 0,
        commandsExecuted: 0,
        successfulCommands: [],
        filesRead: 0,
        filesChanged: new Set(),
        verificationCommands: 0,
        researchCalls: 0,
        delegations: 0,
        failedToolResults: 0,
        planCreated: false,
        planStepUpdates: 0,
        llmSteps: 0,
      };
      const pendingCommands = new Map<string, string>();
      const finishReasons: string[] = [];
      const stepStarts = new Map<number, number>();
      const toolStarts = new Map<string, number>();
      let llmDurationMs = 0;
      let toolDurationMs = 0;
      let finalText = "";
      let turnError: string | null = null;
      let turnUsage: TokenTotals = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
      const memoryWritten: string[] = [];
      let memoryDecisions = 0;
      let memoryQualified: boolean | null = null;
      let memoryError: string | null = null;

      const observer: ProcessMessageObserver = {
        onStepStart: (event) => {
          counters.llmSteps += 1;
          stepStarts.set(event.stepNumber, event.timestamp);
        },
        onStepFinish: (event) => {
          finishReasons.push(event.finishReason);
          const started = stepStarts.get(event.stepNumber);
          if (started !== undefined) llmDurationMs += Math.max(0, event.timestamp - started);
          stepStarts.delete(event.stepNumber);
          if (event.usage) {
            const inputTokens = event.usage.inputTokens ?? 0;
            const outputTokens = event.usage.outputTokens ?? 0;
            turnUsage = {
              inputTokens: turnUsage.inputTokens + inputTokens,
              outputTokens: turnUsage.outputTokens + outputTokens,
              totalTokens: turnUsage.totalTokens + (event.usage.totalTokens ?? inputTokens + outputTokens),
            };
          }
        },
        onToolStart: (event) => {
          toolStarts.set(event.toolCall.id, event.timestamp);
        },
        onToolFinish: (event) => {
          const started = toolStarts.get(event.toolCall.id);
          if (started !== undefined) toolDurationMs += Math.max(0, event.timestamp - started);
          toolStarts.delete(event.toolCall.id);
        },
        onError: (event) => {
          turnError = turnError ?? event.message;
        },
        onMemory: (info) => {
          memoryWritten.push(...info.written);
          memoryDecisions += info.decisions.length;
          memoryQualified = info.qualified;
          memoryError = info.error ?? null;
        },
      };

      context.emit({
        type: "note",
        taskId: task.id,
        message: `Agent turn started with ${options.modelId}`,
        payload: { harness: "agent-chat", workspace },
      });

      try {
        for await (const chunk of agent.processMessage(task.prompt, observer)) {
          switch (chunk.type) {
            case "content":
              finalText += chunk.content ?? "";
              break;
            case "tool_calls":
              for (const call of chunk.toolCalls ?? []) recordToolCall(counters, pendingCommands, call);
              break;
            case "tool_result":
              if (chunk.toolCall && chunk.toolResult) {
                recordToolResult(counters, pendingCommands, chunk.toolCall, chunk.toolResult, (message) =>
                  context.emit({ type: "note", taskId: task.id, message, payload: {} }),
                );
              }
              break;
            case "error":
              turnError = turnError ?? chunk.content ?? "Agent turn failed.";
              break;
            default:
              break;
          }
        }
      } catch (error) {
        turnError = turnError ?? (error instanceof Error ? error.message : String(error));
      } finally {
        clearTimeout(timer);
        runSignal?.removeEventListener("abort", abortFromRun);
        await agent.cleanup().catch(() => {});
      }
      const turnDurationMs = Date.now() - startedAt;
      const sessionId = agent.getSessionId();
      const usage = summarizeUsage(agent, turnUsage);

      if (runSignal?.aborted && !timedOut) {
        return {
          status: "interrupted",
          durationMs: turnDurationMs,
          llmDurationMs: llmDurationMs || null,
          toolDurationMs: toolDurationMs || null,
          tokens: usage.tokens,
          cost: usage.cost,
          behavior: toBehavior(counters, agent.getTurnEndNotes().join("\n")),
          failureReason: "Benchmark run was interrupted during the agent turn.",
          evidence: sessionEvidence(workspace),
          finalResult: { sessionId, harness: "agent-chat", interrupted: true },
        };
      }

      const grade = await gradeWorkspace(task, workspace, {
        benchmarkRoot: options.benchmarkRoot,
        signal: runSignal,
        harness: "agent-chat",
        emit: context.emit,
      });
      const { acceptance, failedRequired, coding, intent, report } = grade;
      const benchmarkVerified = grade.verified;
      const verification = verificationScore(task.acceptanceCriteria ?? [], counters, packageScripts(workspace));
      const hostNotes = agent.getTurnEndNotes().join("\n");
      const behavior = toBehavior(counters, hostNotes);
      behavior.falseCompletion =
        grade.requiredCount > 0 && !benchmarkVerified && !timedOut && !turnError && !HOST_END_NOTE_RE.test(hostNotes);
      const failureType = classifyFailure({ benchmarkVerified, timedOut, turnError, failedRequired, counters });

      return {
        status: benchmarkVerified ? "passed" : "failed",
        scores: {
          ...(coding === undefined ? {} : { coding }),
          ...(intent === undefined ? {} : { intent }),
          ...(verification === undefined ? {} : { verification }),
        },
        tokens: usage.tokens,
        cost: usage.cost,
        behavior,
        acceptance,
        finalResult: {
          harness: "agent-chat",
          sessionId,
          model: options.modelId,
          verified: benchmarkVerified,
          completionBlocked: behavior.completionBlocked ?? false,
          timedOut,
          turnError,
          llmSteps: counters.llmSteps,
          finishReasons,
          routingNotes: options.provider.routingNotes?.() ?? [],
          memoryExpanded: agent.getLastMemoryContext()?.expanded ?? [],
          memoryWritten,
          memoryDecisions,
          memoryQualified,
          memoryError,
          finalTextExcerpt: finalText.trim().slice(-400),
          acceptanceCount: acceptance.length,
          passedCriteria: acceptance.filter((criterion) => criterion.status === "passed").length,
          failedCriteria: acceptance.filter((criterion) => criterion.status === "failed").length,
        },
        failureReason: benchmarkVerified
          ? null
          : timedOut
            ? `Agent turn exceeded ${Math.round(taskTimeoutMs / 1000)}s and was aborted; ${describeFailures(failedRequired)}`
            : turnError
              ? `Agent turn failed: ${turnError}; ${describeFailures(failedRequired)}`
              : describeFailures(failedRequired),
        failureType,
        evidence: sessionEvidence(workspace),
        durationMs: Date.now() - startedAt,
        llmDurationMs: llmDurationMs || null,
        toolDurationMs: toolDurationMs || null,
        verificationDurationMs: report?.durationMs ?? null,
        repairDurationMs: null,
      };
    },
  };
}

function recordToolCall(counters: TurnCounters, pendingCommands: Map<string, string>, call: ToolCall): void {
  counters.toolCalls += 1;
  const name = call.function.name;
  if (name === "bash") {
    counters.commandsExecuted += 1;
    const command = parseCommand(call.function.arguments);
    if (command) pendingCommands.set(call.id, command);
    if (command && isVerificationCommand(command)) counters.verificationCommands += 1;
    return;
  }
  if (name === "read_file") counters.filesRead += 1;
  else if (RESEARCH_TOOLS.has(name)) counters.researchCalls += 1;
  else if (DELEGATION_TOOLS.has(name)) counters.delegations += 1;
}

function recordToolResult(
  counters: TurnCounters,
  pendingCommands: Map<string, string>,
  call: ToolCall,
  result: ToolResult,
  note: (message: string) => void,
): void {
  const name = call.function.name;
  if (!result.success) counters.failedToolResults += 1;
  if (name === "bash") {
    const command = pendingCommands.get(call.id);
    pendingCommands.delete(call.id);
    if (result.success && command) counters.successfulCommands.push(command);
    return;
  }
  if (MUTATION_TOOLS.has(name) && result.success) {
    const path = result.diff?.filePath ?? parsePath(call.function.arguments);
    if (path) counters.filesChanged.add(path);
    return;
  }
  if (name === "generate_plan" && result.success) {
    counters.planCreated = true;
    const count = result.plan?.acceptanceCriteria?.length ?? 0;
    note(`Agent published a plan with ${count} acceptance criteria`);
    return;
  }
  if (name === "update_plan_step" && result.success) counters.planStepUpdates += 1;
}

function parseCommand(argumentsJson: string): string | null {
  try {
    const parsed = JSON.parse(argumentsJson) as { command?: unknown };
    return typeof parsed.command === "string" ? parsed.command : null;
  } catch {
    return null;
  }
}

function parsePath(argumentsJson: string): string | null {
  try {
    const parsed = JSON.parse(argumentsJson) as { path?: unknown };
    return typeof parsed.path === "string" ? parsed.path : null;
  } catch {
    return null;
  }
}

function summarizeUsage(
  agent: Agent,
  fallback: TokenTotals,
): { tokens: BenchmarkTaskExecution["tokens"]; cost: BenchmarkTaskExecution["cost"] } {
  const events = agent.getSessionUsage();
  if (events.length === 0) {
    return {
      tokens: fallback.totalTokens > 0 ? { ...fallback } : {},
      cost: { micros: null, kind: "unavailable", source: "no session usage recorded" },
    };
  }
  const totals = events.reduce(
    (sum, event) => ({
      inputTokens: sum.inputTokens + event.inputTokens,
      outputTokens: sum.outputTokens + event.outputTokens,
      totalTokens: sum.totalTokens + event.totalTokens,
      costMicros: sum.costMicros + event.costMicros,
    }),
    { inputTokens: 0, outputTokens: 0, totalTokens: 0, costMicros: 0 },
  );
  return {
    tokens: { inputTokens: totals.inputTokens, outputTokens: totals.outputTokens, totalTokens: totals.totalTokens },
    // Usage events store provider-reported cost when OpenRouter returns it and a catalog
    // estimate otherwise; the two are not distinguishable after the fact, so stay conservative.
    cost: { micros: totals.costMicros, kind: "estimated", source: "session usage events" },
  };
}

/**
 * Did the agent itself run the checks a careful engineer would before claiming done? Scored
 * against the benchmark's own `command_succeeds` criteria that the agent could plausibly have
 * run (the external oracle behind `{{benchmarkRoot}}` is hidden from it by design): a criterion
 * counts when the agent executed that command successfully at least once, directly or through the
 * project's own package.json script that runs it (`bun run test` runs a `test` script of `bun test`).
 * When a task has no such criteria, fall back to whether any verification-shaped command ran at all.
 */
function verificationScore(
  criteria: readonly BenchmarkAcceptanceCriterion[],
  counters: TurnCounters,
  scripts: Readonly<Record<string, string>>,
): number | undefined {
  if (criteria.length === 0) return undefined;
  const matchable = criteria
    .map((criterion) => criterion.check)
    .filter(
      (check): check is Extract<CheckSpec, { kind: "command_succeeds" }> =>
        check?.kind === "command_succeeds" && !check.command.includes("{{benchmarkRoot}}"),
    );
  if (matchable.length === 0) return counters.verificationCommands > 0 ? 100 : 0;
  const ran = counters.successfulCommands
    .flatMap((command) => withScriptBodies(command, scripts))
    .map(normalizeCommand);
  const covered = matchable.filter((check) =>
    ran.some((command) => command.includes(normalizeCommand(check.command))),
  ).length;
  return Math.round((covered / matchable.length) * 1000) / 10;
}

/** The scripts of the graded workspace's package.json, which `npm test` or `bun run test` run. */
function packageScripts(workspace: string): Record<string, string> {
  try {
    const manifest = JSON.parse(readFileSync(join(workspace, "package.json"), "utf8")) as {
      scripts?: Record<string, unknown>;
    };
    return Object.fromEntries(
      Object.entries(manifest.scripts ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    );
  } catch {
    return {};
  }
}

/** A command, and the body of each package script it ran. */
function withScriptBodies(command: string, scripts: Readonly<Record<string, string>>): string[] {
  const bodies = [...command.matchAll(/\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?([\w:.-]+)/gu)].flatMap((match) => {
    const body = scripts[match[1] ?? ""];
    return body ? [body] : [];
  });
  return [command, ...bodies];
}

function normalizeCommand(command: string): string {
  return command
    .replace(/\{\{workspace\}\}[^\s"']*/gu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase();
}

/** The turn's counters as benchmark behavior; `hostNotes` are the host's own end notes, one per line. */
function toBehavior(counters: TurnCounters, hostNotes: string): BenchmarkBehavior {
  const completionBlocked = /^\[Not (?:verified|marked complete)/mu.test(hostNotes);
  return {
    planCreated: counters.planCreated,
    researchPerformed: counters.researchCalls > 0,
    researchSources: counters.researchCalls,
    delegatedAgents: counters.delegations,
    llmCalls: counters.llmSteps,
    toolCalls: counters.toolCalls,
    commandsExecuted: counters.commandsExecuted,
    filesRead: counters.filesRead,
    filesChanged: counters.filesChanged.size,
    testsExecuted: counters.verificationCommands,
    verificationAttempts: counters.verificationCommands,
    failuresDetected: counters.failedToolResults,
    repairsAttempted: 0,
    repairsSucceeded: 0,
    selfVerification: counters.verificationCommands > 0,
    humanInterventions: 0,
    completionBlocked,
  };
}

function classifyFailure(input: {
  benchmarkVerified: boolean;
  timedOut: boolean;
  turnError: string | null;
  failedRequired: readonly BenchmarkAcceptanceResult[];
  counters: TurnCounters;
}): BenchmarkFailureType | null {
  if (input.benchmarkVerified) return null;
  if (input.timedOut) return "timeout";
  if (input.turnError && input.counters.filesChanged.size === 0) return "model_failure";
  if (input.counters.filesChanged.size === 0) return "implementation_failure";
  // Mirrors `shelra-executor.ts` so the two harness adapters stay comparable in run history.
  return input.failedRequired.some((criterion) => criterion.status === "failed")
    ? "intent_failure"
    : "verification_failure";
}

function sessionEvidence(workspace: string): BenchmarkTaskExecution["evidence"] {
  return [{ kind: "other", path: workspace, label: "Graded task workspace" }];
}
