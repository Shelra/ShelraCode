import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { APICallError } from "@ai-sdk/provider";
import type { ModelMessage, ToolSet } from "ai";
import { compileContextPacket } from "../context/compiler";
import type { ContextPacket } from "../context/types";
import {
  addedCheckSources,
  type CheckDefinition,
  changedCheckDefinitions,
  changeMadeByTurn,
  checkEditsAllowedBy,
  checkKindOf,
  isShortFollowUp,
  type RecordedFiles,
  recordDefinitionFiles,
  runsChangedDefinition,
  snapshotCheckDefinitions,
} from "../contract/check-definitions";
import {
  type ContractCheck,
  type ContractCheckRunner,
  contractChecks,
  evaluateTurnContract,
} from "../contract/contract";
import type { CheckKind } from "../contract/discover";
import { type DiscoveredCheck, discoverChecks, isSameCheck } from "../contract/discover";
import { describeFailures, failureSignature } from "../contract/failures";
import { isTestFile, requestAllowsTestEdits } from "../contract/test-protection";
import { executeEventHooks } from "../hooks/index";
import type {
  NotificationHookInput,
  PostCompactHookInput,
  PreCompactHookInput,
  SessionEndHookInput,
  SessionStartHookInput,
  StopFailureHookInput,
  StopHookInput,
  SubagentStartHookInput,
  SubagentStopHookInput,
  TaskCompletedHookInput,
  TaskCreatedHookInput,
  UserPromptSubmitHookInput,
} from "../hooks/types";
import { foldPath, inScope } from "../ledger/glob";
import {
  activeDecisions,
  approveDecision,
  decisionIdOfFile,
  findDecision,
  inLedgerDir,
  type LedgerResult,
  listDecisions,
  parseDecision,
  proposeDecision,
  rejectDecision,
  requestNamesDecision,
} from "../ledger/store";
import type { Decision, DecisionProposal } from "../ledger/types";
import { shutdownWorkspaceLspManager } from "../lsp/runtime";
import { buildMcpToolSet } from "../mcp/runtime";
import { consolidateMemory } from "../memory/consolidate";
import {
  appendEpisode,
  didWork,
  episodeFrom,
  queuePendingReflection,
  type TurnOutcome,
  takePendingReflection,
  turnOutcome,
} from "../memory/episodes";
import {
  admitCandidates,
  cueTermsOf,
  deterministicFailureCandidates,
  extractUserDirectives,
  reflectOnTurn,
  type TurnCommand,
  type TurnDigest,
  turnQualifiesForReflection,
  typedText,
} from "../memory/reflection";
import type { MemoryContext, MemoryTier } from "../memory/retrieval";
import { proposeProceduresAsSkills } from "../memory/skills";
import {
  appendReflectionAudit,
  creditMemoryUse,
  deliverReminder,
  listMemoryRecords,
  projectMemoryScope,
  reconfirmByPassingCommands,
  recordMemoryUse,
  userMemoryScope,
} from "../memory/store";
import { previousRequestWeight } from "../memory/terms";
import {
  type BudgetLimits,
  type BudgetScope,
  type BudgetUsage,
  checkBudget,
  estimateModelCostMicros,
  estimateRequestCostMicros,
  formatUsdMicros,
} from "../models/budget";
import { getModelInfo, getSupportedReasoningEfforts, normalizeModelId } from "../models/catalog";
import { isOpenRouterBaseURL, lastOpenRouterCatalog } from "../models/openrouter";
import { BASE_URL_ENV, MAX_TOKENS_ENV } from "../product/identity";
import { generateRecap as genRecap, generateTitle as genTitle, normalizeRecap } from "../providers/auxiliary";
import type { CredentialFallback, CredentialFallbackSource } from "../providers/credential-fallback";
import { describeLimit, limitFromError } from "../providers/limits";
import { normalizeModelMessages } from "../providers/messages";
import { createOpenRouterProvider } from "../providers/openrouter";
import { isProviderStreamIdleError } from "../providers/stream";
import type { ProviderAdapter, ProviderModelRuntime, ProviderTimeout } from "../providers/types";
import { createOpenAICompatibleProvider } from "../runtimes/local-provider";
import { destructiveCommandReason } from "../security/destructive";
import {
  appendCompaction,
  appendMessages,
  appendSystemMessage,
  buildChatEntries,
  getLatestObjectiveForSession,
  getNextMessageSequence,
  getSessionTotalCostMicros,
  getSessionTotalTokens,
  getUsageCostSinceMicros,
  listSessionUsage,
  loadPersistedPlanState,
  loadTranscript,
  loadTranscriptState,
  recordCheckpoint,
  recordUsageEvent,
  replaceMessage,
  SessionStore,
  upsertObjectiveIndex,
} from "../storage/index";
import { BashTool, isShuruSupported, VERIFY_UNSUPPORTED_MESSAGE } from "../tools/bash";
import { deleteFile, snapshotForCheckpoint, writeFile } from "../tools/file";
import { type ScheduleDaemonStatus, ScheduleManager, type StoredSchedule } from "../tools/schedule";
import { createTools, hardenToolSet } from "../toolset/tools";
import type {
  AgentMode,
  ChatEntry,
  DelegationRun,
  ModelInfo,
  Plan,
  PlanAcceptanceCriterion,
  PlanStep,
  ReasoningEffort,
  SessionInfo,
  SessionSnapshot,
  StreamChunk,
  SubagentStatus,
  TaskRequest,
  ToolCall,
  ToolResult,
  UsageEvent,
  UsageSource,
  VerifyRecipe,
  WorkspaceInfo,
} from "../types/index";
import { recordSwallowedError } from "../utils/diagnostics";
import { startTurnTrace } from "../utils/session-trace";
import {
  type CustomSubagentConfig,
  getCurrentModel,
  getModeSpecificModel,
  loadMcpServers,
  loadRecapsEnabled,
  loadToolGroupSettings,
  loadUserSettings,
  loadValidSubAgents,
  type SandboxMode,
  type SandboxSettings,
  sessionModelPolicy,
} from "../utils/settings";
import { runSideQuestion, type SideQuestionResult } from "../utils/side-question";
import { buildVerifyDetectPrompt, normalizeVerifyRecipe, prepareVerifySandbox } from "../verify/entrypoint";
import { runVerifyOrchestration } from "../verify/orchestrator";
import { type Ablation, Ablations, ablateTools, NO_ABLATIONS } from "./ablation";
import { AttemptJournal, type RestorePoint } from "./attempt-journal";
import {
  appendActiveCriteriaBlock,
  budgetedContextTokens,
  CONTEXT_ESTIMATE_MARGIN,
  type CompactionSettings,
  compactionSettingsForWindow,
  createCompactionSummaryMessage,
  estimateConversationTokens,
  generateCompactionSummary,
  isCompactionSummaryMessage,
  prepareCompaction,
  relaxCompactionSettings,
  shouldCompactContext,
  truncateTextToTokens,
  truncateUserMessageToTokens,
} from "./compaction";
import { DelegationManager } from "./delegations";
import { AgentKernel, type KernelPhase, type KernelState } from "./kernel";
import {
  applyModelConstraints,
  buildConversationSystemPrompt,
  buildSubagentPrompt,
  buildSystemPrompt,
  memoryContextFor,
} from "./prompts";
import { containsEncryptedReasoning, sanitizeModelMessages } from "./reasoning";
import { extractRequirements, isRequirementDense } from "./requirements";
import { isOutsideProject } from "./scratch";
import {
  describeDelegatedEvidence,
  describeVerificationEvidence,
  isVerificationCommand,
  maskedVerificationCommand,
} from "./verification-evidence";
import { buildVisionUserMessages } from "./vision-input";
import {
  captureWorkspaceState,
  changedPaths,
  existedAt,
  mergeChangedFiles,
  type WorkspaceState,
} from "./workspace-state";

const MAX_TOOL_ROUNDS = 400;

/**
 * A coding turn may legitimately run for several minutes, but a silent model
 * connection should never hold the UI hostage for that long. AI SDK applies
 * chunkMs between streamed events and totalMs/stepMs to the generation.
 */
const DEFAULT_MODEL_TIMEOUT: ProviderTimeout = {
  totalMs: 15 * 60_000,
  stepMs: 5 * 60_000,
  chunkMs: 90_000,
};
const DEFAULT_MCP_TIMEOUT_MS = 20_000;

/** One normal cut plus at most two tightened re-cuts per compaction request. */
const MAX_COMPACTION_PASSES = 3;

/**
 * Overflow-recovery ladder applied when a turn fails with a context-limit error.
 * Level 1 retries with a relaxed compaction budget; level 2 drops the oldest
 * whole turns; level 3 collapses to the checkpoint summary plus the current
 * turn. Above the last level the friendly error is surfaced.
 */
const MAX_OVERFLOW_RECOVERY_LEVEL = 3;
const OVERFLOW_RECOVERY_KEPT_TURNS = 2;

/**
 * Automatic nudges the completion gate sends before it stops asking and reports honestly.
 * Each nudge re-enters the SAME turn's tool loop (the model can keep calling tools in
 * response), so this isn't just "ask again" — it's real additional room to actually reach a
 * verifiable state (install deps, run migrations, start a server, then curl it) before giving
 * up. Raised from 1 to 3 after a live large-scaffold turn (a full multi-tenant SaaS spec) got
 * blocked on its very first turn, before dependencies were even installed — nothing was
 * verifiable yet, so the single nudge was structurally unmeetable, not a caught lie. See
 * docs/architecture/14-AGENT-HARNESS-RECONSTRUCTION.md §12.
 */
const MAX_VERIFICATION_RETRIES = 3;
/** How long one of the project's own checks may run when the host runs it on the final code. */
const CONTRACT_CHECK_TIMEOUT_MS = 10 * 60_000;
/** How long a plan criterion's command may run when the host checks that it fails before the change. */
const CRITERION_PROBE_TIMEOUT_MS = 2 * 60_000;
/** Text documents: nothing runs them, so a turn that only wrote these gets one fact-check request. */
const DOCUMENT_FILE_RE = /\.(?:md|mdx|markdown|txt|rst|adoc|org)$/i;
/**
 * How many times one turn re-requests a model step that ended with neither text nor a tool call
 * before the turn ends visibly. The first retry re-sends the same context (provider routing is
 * non-deterministic); later ones add an explicit continuation request.
 */
const MAX_EMPTY_RESPONSE_RETRIES = 2;
/**
 * A model's native tool-call markup arriving as plain text means the upstream did not parse the
 * call (seen 2026-09-17: `<function=read_file><parameter=path>…` returned as the "answer" and the
 * turn ended after one step). It is a failed step, not a reply.
 */
const LEAKED_TOOL_MARKUP_RE = /<(?:function|tool_call|parameter)(?:=|>)/u;
const EMPTY_RESPONSE_CONTINUATION =
  "Your previous reply was empty. Continue the task: call the next tool you need, and when the work is verified, summarize what you did and observed.";
/**
 * A failing model connection (silence, a cut stream, a timeout, a rate limit, a provider error, a
 * missing endpoint, no credits) interrupts a turn and never ends it on its own: completed steps
 * are kept, the step is retried after a pause, and a model that keeps failing is replaced by the
 * provider's next fallback. Only the user's cancellation ends a turn at once; a rejected
 * credential moves the session to a fallback the host configured, and ends the turn only when
 * there is none. Seen live 2026-09-19: two turns on free models ended as "The operation was
 * aborted." 99 s in, with every step lost, because the AI SDK's 90 s chunk timeout aborted the
 * generation and the loop treated any non-context error as the end of the turn.
 */
const FAILURES_BEFORE_MODEL_SWITCH = 2;
/** Consecutive failures without any completed step, across models, before a turn pauses. */
const MAX_INTERRUPTIONS_WITHOUT_PROGRESS = 8;
/** Bound on interruptions in one turn even while steps keep completing. */
const MAX_INTERRUPTIONS_PER_TURN = 20;
const INTERRUPTION_BACKOFF_MS = [2_000, 5_000, 10_000, 20_000, 30_000];
/** A reflection deferred from an earlier turn waits at most this long, after this turn's own (doc 18 §4.2). */
const DEFERRED_REFLECTION_MS = 30_000;
/**
 * A sub-agent recovers from a failing model connection on its own, like the main turn, within a
 * tighter bound: the parent waits on it and can still route around a sub-agent no model serves.
 */
const MAX_SUBAGENT_INTERRUPTIONS_WITHOUT_PROGRESS = 4;
const MAX_SUBAGENT_INTERRUPTIONS = 10;

interface InterruptionState {
  withoutProgress: number;
  onModel: number;
  total: number;
  triedModels: Set<string>;
  /** The last failure and the provider it came from: a used-up free allowance ends the turn "Limited". */
  lastError?: unknown;
  lastProvider?: string;
  /** Rounds cut because the model sent nothing for too long: each one gives the next round more patience. */
  silences?: number;
}

/**
 * The timeout for a round after `silences` rounds were cut for sending nothing. Some providers deliver a large tool
 * call only once it is complete, so a model writing a long file sends nothing for minutes (seen live 2026-09-24: a free
 * model writing a game's modules was cut at 90 s on every attempt and lost the file each time). The wait doubles after
 * each cut, up to a step's own limit, so a dead connection still ends and a long write can finish.
 */
export function patienceAfterSilences(timeout: ProviderTimeout, silences: number): ProviderTimeout {
  if (!timeout.chunkMs || silences <= 0) return timeout;
  const cap = timeout.stepMs ?? timeout.totalMs ?? timeout.chunkMs * 4;
  return { ...timeout, chunkMs: Math.min(cap, timeout.chunkMs * 2 ** silences) };
}

/** An interruption in which the model sent nothing for too long, as `describeInterruption` words it. */
function isSilence(reason: string): boolean {
  return reason === "no response within the time limit" || reason.startsWith("no output for ");
}

type InterruptionOutcome =
  | { action: "retry" }
  | { action: "switch"; modelId: string }
  | { action: "pause"; message: string };

/** Asks the user whether a destructive shell command may run; resolving false refuses it. */
export type DestructiveCommandConfirm = (command: string, reason: string, signal?: AbortSignal) => Promise<boolean>;

/** The user's answer to a proposed decision: record it, drop it, or leave it waiting in the ledger. */
export type DecisionApproval = (decision: Decision, signal?: AbortSignal) => Promise<"approve" | "reject" | "later">;

export interface AgentOptions {
  persistSession?: boolean;
  provider?: ProviderAdapter;
  session?: string;
  /**
   * Workspace root for this agent. Defaults to the process working directory; benchmarks and
   * embedded hosts pass an explicit path so shell, file, memory, and session state all bind to
   * the same directory without a process-wide `chdir`.
   */
  cwd?: string;
  sandboxMode?: SandboxMode;
  sandboxSettings?: SandboxSettings;
  budget?: BudgetLimits;
  /** Injectable model timeout policy; environment values are used by default. */
  modelTimeout?: ProviderTimeout;
  /** Pauses before retrying an interrupted model round; tests pass zeros. */
  interruptionBackoffMs?: readonly number[];
  /** Injectable MCP discovery timeout; environment values are used by default. */
  mcpTimeoutMs?: number;
  /** Harness subsystems switched off to measure what each adds (`shelra bench --ablate`); see ablation.ts. */
  ablate?: readonly Ablation[];
  /** Runs the task contract's checks on the final code; the agent's own shell by default. Tests inject one. */
  checkRunner?: ContractCheckRunner;
}

type ProcessMessageFinishReason = "stop" | "length" | "content-filter" | "tool-calls" | "error" | "other";

export interface ProcessMessageUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  costUsdTicks?: number;
}

export interface ProcessMessageStepStart {
  stepNumber: number;
  timestamp: number;
}

export interface ProcessMessageStepFinish {
  stepNumber: number;
  timestamp: number;
  finishReason: ProcessMessageFinishReason;
  usage: ProcessMessageUsage;
}

export interface ProcessMessageToolStart {
  toolCall: ToolCall;
  timestamp: number;
}

export interface ProcessMessageToolFinish {
  toolCall: ToolCall;
  toolResult: ToolResult;
  timestamp: number;
}

export type ProcessMessageStage = "hooks" | "notifications" | "context" | "mcp" | "model" | "checks" | "recap";

export interface ProcessMessageStatus {
  stage: ProcessMessageStage;
  detail: string;
  timestamp: number;
}

export interface ProcessMessageError {
  message: string;
  timestamp: number;
}

export interface ProcessMessageMemory {
  qualified: boolean;
  reason: string;
  error?: string;
  written: string[];
  decisions: Array<{ slug: string; action: "create" | "update" | "skip" | "reject"; reason: string }>;
  timestamp: number;
}

/** What memory a turn was given and why (doc 18 §4.5). */
export interface ProcessMessageMemoryRecall {
  /** Standing rules shown in full. */
  rules: string[];
  /** Knowledge entries expanded and pointers listed, with the reasons each was chosen. */
  entries: Array<{
    slug: string;
    tier: MemoryTier;
    score: number;
    reasons: string[];
  }>;
  /** Size of the memory section of the prompt. */
  chars: number;
  timestamp: number;
}

export interface ProcessMessageObserver {
  onMemory?(info: ProcessMessageMemory): void;
  onMemoryRecall?(info: ProcessMessageMemoryRecall): void;
  onStepStart?(info: ProcessMessageStepStart): void;
  onStepFinish?(info: ProcessMessageStepFinish): void;
  onStatus?(info: ProcessMessageStatus): void;
  onToolStart?(info: ProcessMessageToolStart): void;
  onToolFinish?(info: ProcessMessageToolFinish): void;
  onError?(info: ProcessMessageError): void;
}

/** Read-only context metadata compiled by the host for the current turn. */
export interface AgentContextSummary {
  classification: ContextPacket["classification"];
  files: string[];
  truncated: boolean;
}

function findCustomSubagent(
  agent: string,
  subagents: CustomSubagentConfig[] = loadValidSubAgents(),
): CustomSubagentConfig | undefined {
  return (
    subagents.find((item) => item.name === agent) ??
    subagents.find((item) => item.name.toLowerCase() === agent.toLowerCase())
  );
}

/**
 * Whether the model a provider says answered is another model than the one asked for: a router's pick, or a
 * server-side fallback. A dated variant of the same model ("vendor/model-2026-01-01" for "vendor/model") is not.
 */
export function servedByAnother(served: string, requested: string): boolean {
  const a = served.toLowerCase();
  const b = requested.toLowerCase();
  return a !== b && !a.startsWith(`${b}-`) && !a.startsWith(`${b.replace(/:free$/u, "")}-`);
}

function maxOutputTokensForTurn(runtime: ProviderModelRuntime, configured: number): number {
  // The managed local runtime is single-threaded; a bounded reply keeps it responsive.
  if (runtime.modelInfo?.runtimeKind !== "managed-llama") return configured;
  return Math.min(configured, 2_048);
}

export class Agent {
  private provider: ProviderAdapter | null = null;
  private baseURL: string | null = null;
  private bash: BashTool;
  private delegations: DelegationManager;
  private schedules: ScheduleManager;
  private sessionStore: SessionStore | null = null;
  private workspace: WorkspaceInfo | null = null;
  private session: SessionInfo | null = null;
  private messages: ModelMessage[] = [];
  private messageSeqs: Array<number | null> = [];
  private abortController: AbortController | null = null;
  private maxToolRounds: number;
  private mode: AgentMode = "agent";
  private modelId: string;
  /**
   * Explicit, session-wide `/effort` override; `null` means "auto" — see `resolveReasoningEffort`,
   * which also consults the separate per-model `reasoningEffortByModel` setting the `/models`
   * picker's arrow keys write to (this override wins when both are set).
   */
  private reasoningEffortOverride: ReasoningEffort | null = null;
  private maxTokens: number;
  /** True when the user pinned the output budget; it then wins over any
   * window-relative cap. */
  private maxTokensExplicit = false;
  private planContext: string | null = null;
  /**
   * The most recently published plan's acceptance criteria — SESSION-scoped, not turn-scoped: it
   * survives across turns (a `generate_plan` in turn 1 still governs turn 5's mutations) and is
   * only ever replaced, never merged, by a later `generate_plan` call. Deliberately NOT reset in
   * `processMessage`'s per-turn setup (docs/architecture/14-AGENT-HARNESS-RECONSTRUCTION.md §14 Phase
   * 2 item 1) — a plan from an earlier turn in the same session must still be checkable by a later
   * turn that keeps mutating files without ever re-publishing it. `turnVerificationEvidence` stays
   * turn-scoped on purpose: each turn that mutates must still supply its OWN evidence, not borrow
   * an earlier turn's.
   */
  private activeAcceptanceCriteria: PlanAcceptanceCriterion[] | null = null;
  /**
   * The most recently published plan's steps (with their `satisfies` acceptance-criterion ids) —
   * session-scoped like `activeAcceptanceCriteria` above, replaced (never merged) by the same
   * `generate_plan` call that replaces it. Exists solely to resolve `update_plan_step`'s 0-based
   * `index` back to which criteria that step advances, for `turnLinkedCriteriaIds` below (§14
   * Phase 3 item 1: per-criterion evidence, not aggregate).
   */
  private activePlanSteps: PlanStep[] | null = null;
  private turnVerificationEvidence: string[] = [];
  /**
   * Criterion ids explicitly linked to a completed step THIS turn, via `update_plan_step(status:
   * "complete")` on a step whose `satisfies` names them — turn-scoped, reset with
   * `turnVerificationEvidence`. Deliberately NOT sufficient evidence on its own (a model could
   * call `update_plan_step` with zero real verification, which is the exact original bug §9
   * fixed) — a criterion only counts as explicitly evidenced when this set contains its id AND
   * `turnVerificationEvidence.length > 0` (checked at read time in `getVerificationStatus`, not
   * cached, so ordering between the two kinds of tool call within a turn never matters). This is
   * turn-level co-occurrence, not a precise causal link between one specific bash call and one
   * specific criterion — genuinely more precise than the old fully-flat aggregate (the id came
   * from the model's own structural `satisfies` declaration, not inferred from text), but not
   * fabricating exact causality either. See docs/architecture/14-AGENT-HARNESS-RECONSTRUCTION.md §18.
   */
  private turnLinkedCriteriaIds: Set<string> = new Set();
  /**
   * Plan state shared across every `createTools` call within one turn — the turn loop calls
   * `createTools` fresh on every round (initial + verification-nudge + overflow-recovery retries),
   * so a structured plan published in one round is still there for `update_plan_step` in the next.
   * `published` fed the plan gate, which was removed (doc 14 §23.3): nothing requires a plan before a
   * write, and nothing reads `published` now. Reset only at the true start of a turn (`processMessage`).
   */
  private planState: { published: boolean; structured: boolean } = { published: true, structured: false };
  /** Files as they were before each attempt of this turn changed them; read by restore_file. */
  private attemptJournal = new AttemptJournal();
  /**
   * The checks a turn is judged by, carried to the next turn while a change to them is unresolved (audit doc 17,
   * S10): the turn ended on it, or stopped before its gate. Without it, a check one turn rewrote would be the next
   * turn's starting point, and "continue" would be judged by it.
   */
  private checkBaselineCarry: { workspace: string; checks: CheckDefinition[]; recorded: RecordedFiles } | null = null;
  /**
   * Models whose endpoints refused the sampling `temperature` (OpenAI's pro reasoning models take none): requests
   * to them leave it out, so the model the user chose answers instead of the turn falling back to another.
   */
  private readonly samplingRejected = new Set<string>();
  /** The check kinds the previous request allowed to change, which a short follow-up ("yes, go ahead") keeps. */
  private previousAllowedCheckKinds = new Set<CheckKind>();
  /**
   * Ledger files this turn wrote through the ledger itself, with the text it left (null: it removed the
   * file): the host's record, never work to verify, as long as nothing else changed them afterwards.
   */
  private turnLedgerWrites = new Map<string, string | null>();
  /**
   * The decisions in force for this turn: the active ones when it started, plus those the user approved
   * during it. The gate checks these, never the working tree's copy, which the turn itself can edit.
   */
  private turnDecisions: Decision[] = [];
  /** Every record of the ledger when the turn began, any status, by its path as the filesystem compares it. */
  private turnStartLedger = new Map<string, Decision>();
  /** The host's own end notes of the current turn; see `getTurnEndNotes`. */
  private turnEndNotes: string[] = [];
  /** What the running turn did, across all its rounds, for memory; null outside a turn (doc 18 §4.2). */
  private turnMemoryDigest: (() => TurnDigest) | null = null;
  /** Set once the turn's learning ran; a turn that ends any other way records its episode when it closes. */
  private turnLearned = false;
  /** The session's previous request: a short follow-up ("sí, hazlo") retrieves the memory it needs (doc 18 R2). */
  private previousRequest: string | undefined;
  /** Reminders the running turn's recall found due, crossed off when it closes if a model answered. */
  private turnDueReminders: { scope: ReturnType<typeof projectMemoryScope>; slugs: string[] } | null = null;
  private subagentStatusListeners = new Set<(status: SubagentStatus | null) => void>();
  private sendTelegramFile: ((filePath: string) => Promise<ToolResult>) | null = null;
  private confirmDestructiveCommand: DestructiveCommandConfirm | null = null;
  /** Asks the user about a proposed decision (the terminal UI supplies it); without it proposals wait. */
  private askDecisionApproval: DecisionApproval | null = null;
  /** Subsystems a benchmark switched off for this agent; none outside `--ablate` runs. */
  private readonly ablations: Ablations;
  /** Runs the project's checks when the host verifies a turn's final code (the task contract). */
  private readonly checkRunner: ContractCheckRunner;
  /** Questions to the user (destructive commands, decisions) wait in line, so they see one at a time. */
  private userQuestionQueue: Promise<unknown> = Promise.resolve();
  private sessionStartHookFired = false;
  private recapsEnabled = true;
  private kernel: AgentKernel | null = null;
  private contextSummary: AgentContextSummary | null = null;
  private lastMemoryContext: MemoryContext | null = null;
  /** Where a turn continues when the provider rejects its API key; see `setCredentialFallback`. */
  private credentialFallback: CredentialFallbackSource | null = null;
  /** Where a turn continues when no model of this provider can serve it; see `setProviderFallback`. */
  private providerFallback: CredentialFallbackSource | null = null;
  /**
   * The model the session was serving before a provider fallback moved it to another provider; null while
   * it is on its own provider. A key the other provider rejects must not hand that provider's model id to
   * the first provider's key fallback, where the same id can name a paid model.
   */
  private modelBeforeProviderFallback: string | null = null;
  /** The fallback serving this session after a rejected key, released on cleanup. */
  private activeCredentialFallback: CredentialFallback | null = null;
  private readonly budget: BudgetLimits;
  private readonly modelTimeout: ProviderTimeout;
  private readonly interruptionBackoffMs: readonly number[];
  private readonly mcpTimeoutMs: number;
  private localCostMicros = 0;
  private taskCostMicros = 0;

  constructor(
    apiKey: string | undefined,
    baseURL?: string,
    model?: string,
    maxToolRounds?: number,
    options: AgentOptions = {},
  ) {
    const initialMode: AgentMode = "agent";
    this.modelId = normalizeModelId(model || getCurrentModel(initialMode));
    this.baseURL = baseURL || null;
    if (options.provider) {
      this.provider = options.provider;
    } else if (apiKey && baseURL) {
      this.setApiKey(apiKey, baseURL);
    }
    this.bash = new BashTool(options.cwd ?? process.cwd(), {
      sandboxMode: options.sandboxMode ?? "off",
      sandboxSettings: options.sandboxSettings,
    });
    this.delegations = new DelegationManager(() => this.bash.getCwd());

    this.schedules = new ScheduleManager(
      () => this.bash.getCwd(),
      () => this.modelId,
    );
    this.maxToolRounds = maxToolRounds || MAX_TOOL_ROUNDS;
    const envMax = Number(process.env[MAX_TOKENS_ENV]);
    this.maxTokensExplicit = Number.isFinite(envMax) && envMax > 0;
    this.maxTokens = this.maxTokensExplicit ? envMax : 16_384;
    this.recapsEnabled = loadRecapsEnabled();
    this.reasoningEffortOverride = loadUserSettings().reasoningEffort ?? null;
    this.budget = options.budget ?? {};
    this.modelTimeout = options.modelTimeout ?? readModelTimeoutFromEnvironment();
    this.interruptionBackoffMs = options.interruptionBackoffMs ?? INTERRUPTION_BACKOFF_MS;
    this.mcpTimeoutMs =
      options.mcpTimeoutMs ?? readPositiveMilliseconds("SHELRA_MCP_TIMEOUT_MS", DEFAULT_MCP_TIMEOUT_MS);
    this.ablations = options.ablate?.length ? new Ablations(options.ablate) : NO_ABLATIONS;
    // Host checks run the way the agent's own commands do: same shell, same sandbox, same workspace.
    this.checkRunner =
      options.checkRunner ??
      (async (command, { timeoutMs, signal, cwd }) => {
        const startedAt = Date.now();
        // How the process ended goes along, so a decision check that could not run is not read as broken.
        const run = await this.bash.run(command, timeoutMs, signal, cwd);
        const printed = [run.stdout, run.stderr ? `STDERR: ${run.stderr}` : ""].filter(Boolean).join("\n").trim();
        const passed = run.state === "completed" && run.exitCode === 0;
        const fallback =
          run.state === "timed_out"
            ? `Command timed out after ${timeoutMs}ms`
            : run.state === "killed"
              ? "[Cancelled]"
              : `Command failed with exit code ${run.exitCode ?? "unknown"}`;
        return {
          passed,
          output: printed || (passed ? "Command executed successfully (no output)" : fallback),
          durationMs: Date.now() - startedAt,
          state: run.state,
          exitCode: run.exitCode,
        };
      });

    if (options.persistSession !== false) {
      this.sessionStore = new SessionStore(this.bash.getCwd());
      this.workspace = this.sessionStore.getWorkspace();
      this.session = this.sessionStore.openSession(options.session, this.modelId, this.mode, this.bash.getCwd());
      this.mode = this.session.mode;
      const transcript = loadTranscriptState(this.session.id);
      this.messages = normalizeModelMessages(transcript.messages);
      this.messageSeqs = transcript.seqs;
      this.restorePersistedPlanState();
      this.sessionStore.setModel(this.session.id, this.modelId);
      this.kernel = this.loadPersistedKernel();
    }
  }

  getModel(): string {
    return this.modelId;
  }

  /** Runtime metadata is resolved through the active adapter, so local models
   * participate in the same context and capability UI as compatibility models. */
  getModelInfo(): ModelInfo | undefined {
    return this.provider?.resolveModelRuntime(this.modelId).modelInfo ?? getModelInfo(this.modelId);
  }

  getBudgetStatus(): { limits: BudgetLimits; usage: BudgetUsage } {
    const sessionMicros = this.session ? getSessionTotalCostMicros(this.session.id) : this.localCostMicros;
    const dayMicros = this.session ? getUsageCostSinceMicros(utcDayStart().toISOString()) : this.localCostMicros;
    return {
      limits: { ...this.budget },
      usage: {
        requestMicros: 0,
        taskMicros: this.taskCostMicros,
        sessionMicros,
        dayMicros,
      },
    };
  }

  setModel(model: string): void {
    this.modelId = normalizeModelId(model);
    if (this.sessionStore && this.session) {
      this.sessionStore.setModel(this.session.id, this.modelId);
      this.session = this.sessionStore.getRequiredSession(this.session.id);
    }
  }

  getMode(): AgentMode {
    return this.mode;
  }

  getSandboxMode(): SandboxMode {
    return this.bash.getSandboxMode();
  }

  setSandboxMode(mode: SandboxMode): void {
    this.bash.setSandboxMode(mode);
  }

  getSandboxSettings(): SandboxSettings {
    return this.bash.getSandboxSettings();
  }

  setSandboxSettings(settings: SandboxSettings): void {
    this.bash.setSandboxSettings(settings);
  }

  setMode(mode: AgentMode): void {
    if (mode !== this.mode) {
      this.mode = mode;
      const modeModel = getModeSpecificModel(mode);
      if (modeModel) {
        this.modelId = normalizeModelId(modeModel);
      }
      if (this.sessionStore && this.session) {
        this.sessionStore.setMode(this.session.id, mode);
        this.sessionStore.setModel(this.session.id, this.modelId);
        this.session = this.sessionStore.getRequiredSession(this.session.id);
      }
    }
  }

  setPlanContext(ctx: string | null): void {
    this.planContext = ctx;
  }

  /** Explicit `/effort` override for this session; `null` restores the automatic default. */
  setReasoningEffort(effort: ReasoningEffort | null): void {
    this.reasoningEffortOverride = effort;
  }

  getReasoningEffort(): ReasoningEffort | null {
    return this.reasoningEffortOverride;
  }

  /**
   * The effort level that will actually be sent with the next request for `modelId` (or the
   * current model if omitted). Precedence: an explicit session-wide `/effort` override when the
   * model supports it; otherwise the `/models` picker's per-model choice
   * (`reasoningEffortByModel[modelId]` in settings — re-read live, since it can change mid-session
   * via `/models`' arrow keys) when the model supports it; otherwise `"high"` by default in agent
   * mode (coding/agentic work benefits from the model's best reasoning); otherwise the provider's
   * own silent default (`undefined`, no param sent). Never claims a level the model doesn't
   * actually support. See docs/architecture/14-AGENT-HARNESS-RECONSTRUCTION.md §14 Phase 2 item 2 —
   * before this, `reasoningEffortByModel` was written by the UI but read by nothing.
   */
  resolveReasoningEffort(modelId: string = this.modelId): ReasoningEffort | undefined {
    const supported = getSupportedReasoningEfforts(modelId);
    if (supported.length === 0) return undefined;
    if (this.reasoningEffortOverride && supported.includes(this.reasoningEffortOverride)) {
      return this.reasoningEffortOverride;
    }
    const perModel = loadUserSettings().reasoningEffortByModel?.[normalizeModelId(modelId)];
    if (perModel && supported.includes(perModel)) {
      return perModel;
    }
    if (this.mode === "agent") {
      return supported.includes("high") ? "high" : supported[supported.length - 1];
    }
    return undefined;
  }

  setSendTelegramFile(fn: ((filePath: string) => Promise<ToolResult>) | null): void {
    this.sendTelegramFile = fn;
  }

  /**
   * The terminal UI asks the user before a destructive shell command runs. Hosts that cannot ask
   * (headless runs, benchmarks, the Telegram bridge) leave this unset, and such commands are refused.
   */
  setDestructiveCommandConfirm(fn: DestructiveCommandConfirm | null): void {
    this.confirmDestructiveCommand = fn;
  }

  /** The tool-set option that asks the user, one question at a time; absent when nobody can be asked. */
  private destructiveCommandOption(): { confirmDestructiveCommand?: DestructiveCommandConfirm } {
    const confirm = this.confirmDestructiveCommand;
    if (!confirm) return {};
    return {
      confirmDestructiveCommand: (command, reason, signal) =>
        this.queueUserQuestion(() => (signal?.aborted ? Promise.resolve(false) : confirm(command, reason, signal))),
    };
  }

  private queueUserQuestion<T>(ask: () => Promise<T>): Promise<T> {
    const answer = this.userQuestionQueue.then(ask);
    this.userQuestionQueue = answer.catch(() => undefined);
    return answer;
  }

  setDecisionApproval(fn: DecisionApproval | null): void {
    this.askDecisionApproval = fn;
  }

  /**
   * propose_decision (the decision ledger, phase 2 of the 2026-09-18 objective): the model proposes, and only
   * the user's yes makes a commitment. Where nobody can be asked, the proposal waits in the ledger for
   * `shelra decisions approve`.
   */
  private proposeDecisionFromTool = async (input: Omit<DecisionProposal, "source">): Promise<ToolResult> => {
    const cwd = this.bash.getCwd();
    let result: LedgerResult;
    try {
      result = proposeDecision(cwd, { ...input, source: "agent" });
    } catch (error) {
      recordSwallowedError("ledger.write", error);
      return {
        success: false,
        output: `The proposal could not be saved: ${error instanceof Error ? error.message : error}`,
      };
    }
    if (!result.ok) return { success: false, output: result.reason };
    const { decision } = result;
    const replaced = decision.supersedes ? findDecision(cwd, decision.supersedes) : undefined;
    // What the ledger wrote, as it wrote it: the files it touched, now and after the user's answer.
    const recordLedgerWrites = () => {
      for (const file of [decision.file, ...(replaced ? [replaced.file] : [])]) {
        this.turnLedgerWrites.set(file, readTextOrNull(join(cwd, file)));
      }
    };
    recordLedgerWrites();
    const waiting = `Saved as ${decision.id}, a proposal in ${decision.file}. It counts once the user approves it (\`shelra decisions approve ${decision.id}\`); tell the user it is waiting.`;
    const ask = this.askDecisionApproval;
    if (!ask) return { success: true, output: waiting };
    const signal = this.abortController?.signal;
    const answer = await this.queueUserQuestion(() =>
      signal?.aborted ? Promise.resolve("later" as const) : ask(decision, signal),
    ).catch(() => "later" as const);
    try {
      if (answer === "approve") {
        const approved = approveDecision(cwd, decision.id);
        recordLedgerWrites();
        // The user's yes puts it in force for the rest of this turn too, in place of what it supersedes.
        if (approved.ok) {
          this.turnDecisions = [
            ...this.turnDecisions.filter((active) => active.id !== approved.decision.supersedes),
            approved.decision,
          ];
        }
        return approved.ok
          ? {
              success: true,
              output: `The user approved ${decision.id}: it is an active decision now (${decision.file}).`,
            }
          : { success: false, output: approved.reason };
      }
      if (answer === "reject") {
        rejectDecision(cwd, decision.id);
        recordLedgerWrites();
        return {
          success: true,
          output: `The user declined ${decision.id}; it was not recorded. Do not propose it again unless the user asks.`,
        };
      }
    } catch (error) {
      recordSwallowedError("ledger.write", error);
    }
    return { success: true, output: waiting };
  };

  hasApiKey(): boolean {
    return !!this.provider;
  }

  /** Installs a provider-neutral adapter without exposing provider SDK objects. */
  setProvider(provider: ProviderAdapter, modelId?: string): void {
    this.provider = provider;
    if (modelId) this.setModel(modelId);
    // A provider chosen afterwards replaces the fallback that was serving the session.
    const fallback = this.activeCredentialFallback;
    if (fallback && fallback.provider !== provider) {
      this.activeCredentialFallback = null;
      this.modelBeforeProviderFallback = null;
      void fallback.dispose?.().catch(() => undefined);
    }
  }

  /**
   * A rejected API key fails the same way for every model and every retry, so a turn that hits one
   * continues on a fallback the user already has (another configured key, an installed local
   * model) instead of ending. The host knows what is configured and supplies the sources.
   */
  setCredentialFallback(source: CredentialFallbackSource | null): void {
    this.credentialFallback = source;
  }

  /**
   * A provider none of whose models can serve the turn (OpenRouter's free models with the day's quota
   * spent, or none answering) would pause it; the turn continues instead on another provider the user
   * configured, such as a free Groq, Gemini or Cloudflare account. Never set for a benchmark, whose
   * model is the measured variable.
   */
  setProviderFallback(source: CredentialFallbackSource | null): void {
    this.providerFallback = source;
  }

  setApiKey(apiKey: string, baseURL = this.baseURL ?? undefined): void {
    const endpoint = baseURL || process.env[BASE_URL_ENV];
    if (!endpoint) {
      throw new Error("Remote provider base URL required. Set SHELRA_BASE_URL or pass --base-url.");
    }
    this.baseURL = endpoint;
    const modelId = this.modelId || getCurrentModel("agent");
    // OpenRouter always goes through its own adapter under the session's model mode, so an agent built from a key and
    // a URL (a Telegram chat, a host that skipped model routing) never runs a paid model in Free mode.
    this.provider = isOpenRouterBaseURL(endpoint)
      ? createOpenRouterProvider(apiKey, {
          modelId,
          entries: lastOpenRouterCatalog(),
          baseURL: endpoint,
          policy: sessionModelPolicy(),
        })
      : createOpenAICompatibleProvider(apiKey, endpoint, modelId);
  }

  getCwd(): string {
    return this.bash.getCwd();
  }

  getKernelState(): KernelState | null {
    return this.kernel?.snapshot() ?? null;
  }

  /** What retrieval injected into the most recent turn: expanded slugs and listed pointers. */
  getLastMemoryContext(): MemoryContext | null {
    return this.lastMemoryContext;
  }

  /**
   * The notes the host ended the most recent turn with ("[Not verified — …]", "[Paused — …]", "[Checked by
   * Shelra …]"), never the model's own words: a model that writes "[Stopped" in its reply ended nothing.
   */
  getTurnEndNotes(): readonly string[] {
    return this.turnEndNotes;
  }

  getContextSummary(): AgentContextSummary | null {
    if (!this.contextSummary) return null;
    return {
      classification: { ...this.contextSummary.classification },
      files: [...this.contextSummary.files],
      truncated: this.contextSummary.truncated,
    };
  }

  /**
   * Real state behind the completion gate (docs/architecture/14-AGENT-HARNESS-RECONSTRUCTION.md §9,
   * §18). Does NOT claim a causal per-criterion pass/fail (which bash call proved which
   * criterion) — that precision doesn't exist. It DOES honestly distinguish a criterion the model
   * explicitly linked to a completed step (`linkedCriteriaIds`, via `update_plan_step`'s own
   * `satisfies` declaration) from one with only turn-level aggregate evidence: a criterion only
   * counts as explicitly evidenced when its id is in `linkedCriteriaIds` AND `evidenceCount > 0`
   * (checked by the caller, not cached here, since the two kinds of tool call can happen in
   * either order within a turn). Everything else stays the same honest aggregate as before.
   */
  getVerificationStatus(): {
    criteria: PlanAcceptanceCriterion[] | null;
    evidenceCount: number;
    evidenceSummary: string[];
    linkedCriteriaIds: string[];
  } {
    return {
      criteria: this.activeAcceptanceCriteria ? [...this.activeAcceptanceCriteria] : null,
      evidenceCount: this.turnVerificationEvidence.length,
      evidenceSummary: [...this.turnVerificationEvidence],
      linkedCriteriaIds: [...this.turnLinkedCriteriaIds],
    };
  }

  /** Latest durable executable plan, including persisted step updates. */
  getPlanState(): Plan | null {
    if (!this.session) return null;
    return loadPersistedPlanState(this.session.id);
  }

  private restorePersistedPlanState(): void {
    if (!this.session) return;
    try {
      const plan = loadPersistedPlanState(this.session.id);
      this.activeAcceptanceCriteria = plan?.acceptanceCriteria?.map((criterion) => ({ ...criterion })) ?? null;
      this.activePlanSteps =
        plan?.steps.map((step) => ({
          ...step,
          filePaths: step.filePaths ? [...step.filePaths] : undefined,
          satisfies: step.satisfies ? [...step.satisfies] : undefined,
        })) ?? null;
    } catch (error) {
      recordSwallowedError("plan.restore", error);
      this.activeAcceptanceCriteria = null;
      this.activePlanSteps = null;
    }
  }

  private loadPersistedKernel(): AgentKernel | null {
    if (!this.session) return null;
    try {
      const record = getLatestObjectiveForSession(this.session.id);
      if (!record || record.runDir !== null || !isKernelPhase(record.phase)) return null;
      return AgentKernel.fromSnapshot({
        taskId: record.id,
        objective: record.request,
        phase: record.phase,
        scope: [],
        mutations: [],
        observations: [],
        attemptCount: 0,
        verificationPassed: record.phase === "complete",
        reviewPassed: record.phase === "complete",
        ...(record.blocker ? { blockedReason: record.blocker } : {}),
      });
    } catch (error) {
      recordSwallowedError("kernel.restore", error);
      return null;
    }
  }

  /**
   * Indexes the chat-turn kernel's state into the same `objectives` table the autonomy
   * runtime writes into (see `src/autonomy/runtime.ts`'s `indexObjective` and
   * `docs/architecture/14-AGENT-HARNESS-RECONSTRUCTION.md` §5-6). This is what makes
   * `getKernelState()` — previously computed and read by nothing — answerable from outside
   * the running process: "what is this session doing right now" becomes a query against
   * `objectives WHERE session_id = ?`, not a guess reconstructed from chat history.
   */
  private persistKernelIndex(blockerOverride?: string): void {
    const kernel = this.kernel;
    if (!kernel || !this.session || !this.workspace) return;
    try {
      const state = kernel.snapshot();
      upsertObjectiveIndex({
        id: state.taskId,
        sessionId: this.session.id,
        workspaceId: this.workspace.id,
        request: state.objective,
        phase: state.phase,
        // `evaluateCompletion`'s own blockedReason is a generic phase-level message (e.g.
        // "Host verification has not passed."); a Stop hook's specific reason is more useful
        // to whoever queries this row, so it takes priority when one triggered the block.
        blocker: blockerOverride ?? state.blockedReason ?? null,
        runDir: null,
      });
    } catch (error) {
      // Indexing must never take down a turn.
      recordSwallowedError("kernel.index", error);
    }
  }

  /** Bound `onCheckpoint` for `createTools` — keeps the storage import out of `toolset/tools.ts`. */
  private onToolCheckpoint = (input: {
    filePath: string;
    previousContent: string | null;
    previousExisted: boolean;
    reason: "pre-write" | "pre-edit" | "pre-delete";
  }): void => {
    this.attemptJournal.record(input.filePath, input);
    if (!this.workspace) return;
    try {
      recordCheckpoint({
        sessionId: this.session?.id ?? null,
        objectiveId: this.kernel?.snapshot().taskId ?? null,
        workspaceId: this.workspace.id,
        ...input,
      });
    } catch (error) {
      // Checkpointing must never block a mutation.
      recordSwallowedError("checkpoint", error);
    }
  };

  /**
   * restore_file (audit doc 15, Phase 2.3): puts a file back as the journal saw it before the last checked
   * attempt or before the turn. Only when the model asks; the restore is itself checkpointed, and it
   * returns a diff, so it counts as a change and the checks run again.
   */
  private restoreFileFromJournal = async (path: string, to: RestorePoint): Promise<ToolResult> => {
    const cwd = this.bash.getCwd();
    try {
      const current = snapshotForCheckpoint(path, cwd);
      const entry = this.attemptJournal.before(current.relativePath, to);
      if (!entry) {
        return {
          success: false,
          output: `${current.relativePath} was not changed with write_file, edit_file or delete_file ${
            to === "before_turn" ? "in this turn" : "since before your last checked attempt"
          }, so there is nothing to restore.`,
        };
      }
      if (entry.previousExisted === current.previousExisted && entry.previousContent === current.previousContent) {
        return { success: true, output: `${current.relativePath} is already as it was; nothing changed.` };
      }
      this.onToolCheckpoint({ ...current, filePath: current.relativePath, reason: "pre-write" });
      const result = entry.previousExisted
        ? await writeFile(current.relativePath, entry.previousContent ?? "", cwd)
        : await deleteFile(current.relativePath, cwd);
      const point = to === "before_turn" ? "before this turn" : "before your last checked attempt";
      return result.success
        ? {
            ...result,
            output: `${entry.previousExisted ? "Restored" : "Removed"} ${current.relativePath}: it is as it was ${point}${
              entry.previousExisted ? "" : ", when it did not exist"
            }.`,
          }
        : result;
    } catch (error) {
      return { success: false, output: `Could not restore ${path}: ${error instanceof Error ? error.message : error}` };
    }
  };

  async listSchedules(): Promise<StoredSchedule[]> {
    return this.schedules.list();
  }

  async removeSchedule(id: string): Promise<string> {
    const removed = await this.schedules.remove(id);
    return removed ? `Removed schedule "${removed.name}".` : `Schedule "${id}" not found.`;
  }

  async getScheduleDaemonStatus(): Promise<ScheduleDaemonStatus> {
    return this.schedules.getDaemonStatus();
  }

  getContextStats(
    contextWindow: number,
    inFlightText = "",
  ): {
    contextWindow: number;
    usedTokens: number;
    remainingTokens: number;
    ratioUsed: number;
    ratioRemaining: number;
  } {
    const system = buildSystemPrompt(
      this.bash.getCwd(),
      this.mode,
      this.bash.getSandboxMode(),
      this.planContext,
      undefined,
      this.bash.getSandboxSettings(),
      undefined,
      this.ablations,
    );
    const usedTokens = Math.min(contextWindow, estimateConversationTokens(system, this.messages, inFlightText));
    const remainingTokens = Math.max(0, contextWindow - usedTokens);

    return {
      contextWindow,
      usedTokens,
      remainingTokens,
      ratioUsed: usedTokens / contextWindow,
      ratioRemaining: remainingTokens / contextWindow,
    };
  }

  async generateTitle(userMessage: string, signal?: AbortSignal): Promise<string> {
    const provider = this.provider;
    if (!provider) {
      return "New session";
    }

    const contextWindow = provider.resolveModelRuntime(this.modelId).modelInfo?.contextWindow;
    const titlePrompt = truncateTextToTokens(
      userMessage,
      contextWindow && Number.isFinite(contextWindow) ? Math.max(256, Math.floor(contextWindow * 0.1)) : 2_048,
    );
    this.ensureBudget(
      this.modelInfoFor(provider.defaultModelId ?? this.modelId),
      Math.ceil((titlePrompt.length + 600) / 4),
      60,
      "request",
    );
    const generated = await genTitle(provider, titlePrompt, signal);
    this.recordUsage(generated.usage, "title", generated.modelId);
    if (this.sessionStore && this.session && !this.session.title && generated.title) {
      this.sessionStore.setTitle(this.session.id, generated.title);
      this.session = this.sessionStore.getRequiredSession(this.session.id);
    }
    return generated.title;
  }

  getSessionRecap(): string | null {
    if (!this.recapsEnabled) return null;
    return normalizeRecap(this.session?.recap?.text) || null;
  }

  getRecapsEnabled(): boolean {
    return this.recapsEnabled;
  }

  setRecapsEnabled(enabled: boolean): void {
    this.recapsEnabled = enabled;
  }

  async askSideQuestion(question: string, signal?: AbortSignal): Promise<SideQuestionResult> {
    if (!this.provider) {
      return { response: "No API key configured." };
    }

    const contextParts: string[] = [];
    let charBudget = 2000;
    for (let i = this.messages.length - 1; i >= 0 && charBudget > 0; i--) {
      const msg = this.messages[i];
      if (msg.role !== "user" && msg.role !== "assistant") continue;
      const text =
        typeof msg.content === "string"
          ? msg.content
          : Array.isArray(msg.content)
            ? msg.content
                .filter((p: { type: string }) => p.type === "text")
                .map((p: { type: string; text?: string }) => p.text ?? "")
                .join("")
            : "";
      if (!text) continue;
      const snippet = text.length > 400 ? `${text.slice(0, 400)}…` : text;
      contextParts.unshift(`[${msg.role}]: ${snippet}`);
      charBudget -= snippet.length;
    }
    const conversationContext = contextParts.join("\n\n");

    this.ensureBudget(
      this.modelInfoFor(this.modelId),
      Math.ceil((conversationContext.length + question.length + 800) / 4),
      2_048,
      "request",
    );

    const result = await runSideQuestion(question, this.provider, this.modelId, conversationContext, signal);
    this.recordUsage(result.usage, "other");
    return result;
  }

  abort(): void {
    this.abortController?.abort();
    this.emitSubagentStatus(null);
  }

  async cleanup(): Promise<void> {
    const fallback = this.activeCredentialFallback;
    this.activeCredentialFallback = null;
    await Promise.allSettled([
      this.bash.cleanup(),
      shutdownWorkspaceLspManager(this.bash.getCwd()),
      fallback?.dispose?.(),
    ]);
  }

  respondToToolApproval(approvalId: string, approved: boolean): void {
    const toolApprovalResponse: ModelMessage = {
      role: "tool",
      content: [
        {
          type: "tool-approval-response" as const,
          approvalId,
          approved,
        },
      ],
    };
    this.messages.push(toolApprovalResponse);
    this.messageSeqs.push(null);
  }

  clearHistory(): void {
    this.startNewSession();
  }

  startNewSession(): SessionSnapshot | null {
    this.kernel = null;
    this.contextSummary = null;
    this.activeAcceptanceCriteria = null;
    this.activePlanSteps = null;
    this.turnVerificationEvidence = [];
    this.turnLinkedCriteriaIds = new Set();
    this.planState = { published: true, structured: false };

    if (this.sessionStartHookFired) {
      const endInput: SessionEndHookInput = {
        hook_event_name: "SessionEnd",
        session_id: this.session?.id,
        cwd: this.bash.getCwd(),
      };
      this.fireHook(endInput).catch(() => {});
      this.sessionStartHookFired = false;
    }

    if (!this.sessionStore) {
      this.messages = [];
      this.messageSeqs = [];
      return null;
    }

    this.sessionStore = new SessionStore(this.bash.getCwd());
    this.workspace = this.sessionStore.getWorkspace();
    this.session = this.sessionStore.createSession(this.modelId, this.mode, this.bash.getCwd());
    this.messages = [];
    this.messageSeqs = [];
    return this.getSessionSnapshot();
  }

  getSessionInfo(): SessionInfo | null {
    return this.session;
  }

  /** The provider the session runs on now ("openrouter", a free provider's id, the local runtime), a fallback included. */
  getProviderId(): string | null {
    return this.provider?.id ?? null;
  }

  getSessionId(): string | null {
    return this.session?.id || null;
  }

  getSessionTitle(): string | null {
    return this.session?.title || null;
  }

  getChatEntries(): ChatEntry[] {
    if (!this.session) return [];
    return buildChatEntries(this.session.id);
  }

  getSessionSnapshot(): SessionSnapshot | null {
    if (!this.session || !this.workspace) return null;
    return {
      workspace: this.workspace,
      session: this.session,
      messages: loadTranscript(this.session.id),
      entries: buildChatEntries(this.session.id),
      totalTokens: getSessionTotalTokens(this.session.id),
      totalCostMicros: getSessionTotalCostMicros(this.session.id),
    };
  }

  getSessionUsage(): UsageEvent[] {
    if (!this.session) return [];
    return listSessionUsage(this.session.id);
  }

  /** Real foreground/background agent state for workspace presentation. */
  getDelegations(): Promise<DelegationRun[]> {
    return this.delegations.list();
  }

  onSubagentStatus(listener: (status: SubagentStatus | null) => void): () => void {
    this.subagentStatusListeners.add(listener);
    return () => {
      this.subagentStatusListeners.delete(listener);
    };
  }

  private emitSubagentStatus(status: SubagentStatus | null): void {
    for (const listener of this.subagentStatusListeners) {
      listener(status);
    }
  }

  /**
   * One failed model round, recovered. Completed steps are saved first, so nothing already done
   * is lost; then the turn retries the same model after a pause, or moves to the provider's next
   * fallback when this model failed twice in a row or cannot serve the request at all (no
   * credits, no endpoint, a spend limit). "pause" comes back after many attempts in which no
   * model made progress, or at once when retrying cannot help and no fallback is left.
   */
  private async *recoverFromInterruption(args: {
    reason: string;
    error: unknown;
    state: InterruptionState;
    provider: ProviderAdapter;
    modelId: string;
    userModelMessage: ModelMessage;
    completedSteps: ModelMessage[];
    signal: AbortSignal;
  }): AsyncGenerator<StreamChunk, InterruptionOutcome, unknown> {
    const { reason, state } = args;
    state.lastError = args.error;
    state.lastProvider = args.provider.id;
    if (isSilence(reason)) state.silences = (state.silences ?? 0) + 1;
    // Only a completed step is progress. Text streamed before a stall (a preamble such as "Let me
    // write the file now.") is not: counting it kept a stalling model from ever being replaced and
    // filled the transcript with fragments; the retried round regenerates it.
    if (args.completedSteps.length > 0) {
      this.appendCompletedTurn(args.userModelMessage, args.completedSteps);
      state.withoutProgress = 0;
      state.onModel = 0;
      this.messages.push({ role: "user", content: interruptionContinuation(reason) });
      this.messageSeqs.push(null);
    }
    state.withoutProgress += 1;
    state.onModel += 1;
    state.total += 1;
    this.kernel?.recordObservation(`Model connection interrupted (${reason}); attempt ${state.total}.`);
    this.persistKernelIndex();

    if (state.withoutProgress > MAX_INTERRUPTIONS_WITHOUT_PROGRESS || state.total > MAX_INTERRUPTIONS_PER_TURN) {
      return { action: "pause", message: `No model answered after repeated attempts (last: ${reason}).` };
    }
    if (rejectsSamplingParameters(args.error) && !this.samplingRejected.has(args.modelId)) {
      // No endpoint of the model takes `temperature`, and OpenRouter is asked to honour every parameter: the same
      // model answers once the request leaves it out, so this is not a reason to move to another model.
      this.samplingRejected.add(args.modelId);
      this.kernel?.recordObservation(`${args.modelId} takes no sampling temperature; retrying it without one.`);
      return { action: "retry" };
    }
    const unavailable = isModelUnavailableError(args.error);
    if (unavailable || state.onModel >= FAILURES_BEFORE_MODEL_SWITCH) {
      const fallback = nextFallbackModel(args.provider, args.modelId, state);
      if (fallback) {
        state.onModel = 0;
        yield {
          type: "content",
          content: `\n\n[${args.modelId} is not answering (${reason}); continuing with ${fallback} (${describeModelCost(args.provider, fallback)}).]\n\n`,
        };
        return { action: "switch", modelId: fallback };
      }
      // No credits, an exhausted quota or a spend limit is not fixed by asking again, and nothing
      // is left to switch to: stop spending attempts and say why.
      if (unavailable) {
        return {
          action: "pause",
          message: `${args.modelId} cannot serve this request (${reason}) and no fallback model is left.`,
        };
      }
    }
    const backoff = this.interruptionBackoffMs;
    const delay = backoff[Math.min(state.onModel - 1, backoff.length - 1)] ?? 0;
    yield {
      type: "content",
      content: `\n\n[Model connection interrupted (${reason}); retrying${delay >= 1_000 ? ` in ${Math.round(delay / 1_000)}s` : ""}.]\n\n`,
    };
    await sleepUnlessAborted(delay, args.signal);
    return { action: "retry" };
  }

  /**
   * The end of a turn no model could serve: progress is already saved and resumable. When the provider's free
   * allowance is what ran out, the turn ends "Limited" with the time it comes back, as the provider reports it.
   */
  private async *pauseAfterInterruptions(
    cause: string,
    observer?: ProcessMessageObserver,
    state?: InterruptionState,
  ): AsyncGenerator<StreamChunk, void, unknown> {
    const limit =
      state?.lastProvider && state.lastError !== undefined ? limitFromError(state.lastProvider, state.lastError) : null;
    const free = sessionModelPolicy() === "free";
    const message = limit
      ? `${describeLimit(limit)}${free ? " Free mode does not continue on providers that can bill." : ""} Everything completed so far is saved; send "continue" after the reset${free ? ", or switch to Mixed (ctrl+f) to use paid models" : ", or choose another model with /models"}.`
      : `${cause} Everything completed so far is saved; send "continue" to resume, or choose another model with /models.`;
    this.kernel?.recordObservation(message);
    this.kernel?.transition("blocked");
    this.persistKernelIndex(message);
    notifyObserver(observer?.onError, { message, timestamp: Date.now() });
    if (limit) {
      yield {
        type: "limit",
        limit: {
          provider: limit.provider,
          name: limit.name,
          estimated: limit.estimated,
          ...(limit.resetsAt ? { resetsAt: limit.resetsAt.toISOString() } : {}),
        },
      };
    }
    yield { type: "content", content: `\n\n${this.endNote(`[${limit ? "Limited" : "Paused"} — ${message}]`)}` };
    yield { type: "done" };
  }

  /** The sampling temperature to send, or none for a model that takes none. */
  private samplingTemperature(modelId: string, modelInfo: ModelInfo | undefined, value: number): number | undefined {
    return modelInfo?.supportsTemperature === false || this.samplingRejected.has(modelId) ? undefined : value;
  }

  /** A note the host ends the turn with, kept apart from what the model wrote (see `getTurnEndNotes`). */
  private endNote(note: string): string {
    this.turnEndNotes.push(note);
    return note;
  }

  /**
   * No model of the current provider could serve the turn, which would pause it. The completed steps
   * were saved by the interruption handling; the session moves to the next provider the host
   * configured and stays there. Null when there is none: the turn pauses as before.
   */
  private async *continueOnProviderFallback(args: {
    cause: string;
    modelId: string;
    signal: AbortSignal;
  }): AsyncGenerator<StreamChunk, CredentialFallback | null, unknown> {
    if (!this.providerFallback || args.signal.aborted) return null;
    let fallback: CredentialFallback | null = null;
    try {
      fallback = await this.providerFallback({ modelId: args.modelId, signal: args.signal });
    } catch {
      fallback = null;
    }
    if (!fallback) return null;
    if (args.signal.aborted) {
      await fallback.dispose?.().catch(() => undefined);
      return null;
    }
    const previous = this.activeCredentialFallback;
    const homeModel = this.modelBeforeProviderFallback ?? args.modelId;
    this.activeCredentialFallback = fallback;
    this.setProvider(fallback.provider, fallback.modelId);
    this.modelBeforeProviderFallback = homeModel;
    await previous?.dispose?.().catch(() => undefined);
    const notice = `${args.cause} Continuing with ${fallback.label}, model ${fallback.modelId}, for the rest of this session.`;
    this.kernel?.recordObservation(notice);
    this.persistKernelIndex();
    yield { type: "content", content: `\n\n[${notice}]\n\n` };
    return fallback;
  }

  /**
   * The provider rejected the API key. Completed steps are saved first, then the session moves to
   * the next fallback the host configured and stays there. Null when there is none: the turn then
   * ends with the key error, as the user must fix the key.
   */
  private async *continueOnCredentialFallback(args: {
    error: unknown;
    modelId: string;
    userModelMessage: ModelMessage;
    completedSteps: ModelMessage[];
    signal: AbortSignal;
  }): AsyncGenerator<StreamChunk, CredentialFallback | null, unknown> {
    // On a provider the session moved to, the rejected key is that provider's: the next provider of the
    // same chain comes first, and the first provider's key fallback continues on the model it was serving.
    const onMovedProvider = this.modelBeforeProviderFallback !== null && this.providerFallback !== null;
    if (!this.credentialFallback && !onMovedProvider) return null;
    const reason = describeInterruption(args.error);
    yield {
      type: "content",
      content: `\n\n[The provider rejected the API key (${reason}); looking for another configured key, provider or installed local model.]\n\n`,
    };
    const attempt = async (source: CredentialFallbackSource | null, modelId: string) => {
      if (!source || args.signal.aborted) return null;
      try {
        return await source({ modelId, signal: args.signal });
      } catch {
        return null;
      }
    };
    let fallback = onMovedProvider ? await attempt(this.providerFallback, args.modelId) : null;
    const movedAgain = fallback !== null;
    if (!fallback) fallback = await attempt(this.credentialFallback, this.modelBeforeProviderFallback ?? args.modelId);
    if (!fallback) return null;
    if (!movedAgain) this.modelBeforeProviderFallback = null;
    if (args.signal.aborted) {
      await fallback.dispose?.().catch(() => undefined);
      return null;
    }
    if (args.completedSteps.length > 0) {
      this.appendCompletedTurn(args.userModelMessage, args.completedSteps);
      this.messages.push({ role: "user", content: interruptionContinuation("the provider rejected the API key") });
      this.messageSeqs.push(null);
    }
    const previous = this.activeCredentialFallback;
    this.activeCredentialFallback = fallback;
    this.setProvider(fallback.provider, fallback.modelId);
    await previous?.dispose?.().catch(() => undefined);
    const notice = `Continuing with ${fallback.label}, model ${fallback.modelId} (${describeModelCost(fallback.provider, fallback.modelId)}), for the rest of this session.`;
    this.kernel?.recordObservation(`The provider rejected the API key. ${notice}`);
    this.persistKernelIndex();
    yield { type: "content", content: `[${notice}]\n\n` };
    return fallback;
  }

  /**
   * The host's verdict on a turn ("[Not verified — …]") joins the turn's last reply, in memory and in
   * the stored transcript, so the next turn's model and a resumed session see that the work was not
   * verified. It used to be streamed only, and vanished. It is appended to the reply rather than sent
   * as a separate system message, which some open models' chat templates reject mid-conversation.
   */
  private recordVerdict(verdict: string): void {
    this.endNote(verdict);
    try {
      let index = this.messages.length - 1;
      while (index >= 0 && this.messages[index]?.role !== "assistant") index -= 1;
      if (index < 0) {
        this.messages.push({ role: "assistant", content: verdict });
        this.messageSeqs.push(null);
        return;
      }
      const message = this.messages[index] as ModelMessage & { role: "assistant" };
      const updated: ModelMessage =
        typeof message.content === "string"
          ? { ...message, content: message.content.trim() ? `${message.content}\n\n${verdict}` : verdict }
          : { ...message, content: [...message.content, { type: "text", text: verdict }] };
      this.messages[index] = updated;
      const seq = this.messageSeqs[index];
      if (this.session && typeof seq === "number") replaceMessage(this.session.id, seq, updated);
    } catch (error) {
      // The verdict was already shown; failing to store it must not end the turn.
      recordSwallowedError("verdict.store", error);
    }
  }

  private discardAbortedTurn(userMessage: ModelMessage): void {
    const idx = this.messages.lastIndexOf(userMessage);
    if (idx >= 0) {
      this.messages.splice(idx, 1);
      this.messageSeqs.splice(idx, 1);
    }
  }

  private async refreshSessionRecap(signal?: AbortSignal): Promise<void> {
    if (!this.recapsEnabled || !this.provider || !this.sessionStore || !this.session) {
      return;
    }

    try {
      const prompt = this.buildRecapPrompt();
      if (!prompt) {
        return;
      }

      const modelId = this.provider.defaultModelId ?? this.modelId;
      this.ensureBudget(this.modelInfoFor(modelId), Math.ceil((prompt.length + 500) / 4), 120, "request");

      const generated = await genRecap(this.provider, prompt, withAbortTimeout(signal, 8_000));
      this.recordUsage(generated.usage, "recap", generated.modelId);
      if (!generated.recap) {
        return;
      }

      this.sessionStore.setRecap(this.session.id, {
        text: generated.recap,
        model: generated.modelId,
        updatedAt: new Date(),
      });
      this.session = this.sessionStore.getRequiredSession(this.session.id);
    } catch (error) {
      // Recaps are best-effort and should never make the completed turn fail.
      if (!signal?.aborted) recordSwallowedError("recap", error);
    }
  }

  private buildRecapPrompt(): string | null {
    if (!this.session) {
      return null;
    }

    const transcript = formatEntriesForRecap(buildChatEntries(this.session.id), 5_000);
    if (!transcript) {
      return null;
    }

    const sections = [
      "Refresh the saved recap for this coding session using the latest transcript.",
      this.session.recap?.text
        ? `Existing recap:\n${truncate(this.session.recap.text, 1_200)}`
        : "Existing recap:\n(none)",
      `Session transcript:\n${transcript}`,
    ];
    return sections.join("\n\n");
  }

  private recordUsage(
    usage?: { totalTokens?: number; inputTokens?: number; outputTokens?: number; costUsdTicks?: number },
    source: UsageSource = "message",
    model = this.modelId,
  ): void {
    if (!usage) return;
    const modelInfo = this.modelInfoFor(model);
    const actualCostMicros =
      usage.costUsdTicks !== undefined
        ? Math.max(0, Math.round(usage.costUsdTicks))
        : estimateModelCostMicros(modelInfo, usage.inputTokens ?? 0, usage.outputTokens ?? 0);
    if (this.session) {
      recordUsageEvent(this.session.id, source, model, usage);
    } else {
      this.localCostMicros += actualCostMicros;
    }
    if (source === "task") this.taskCostMicros += actualCostMicros;
  }

  private ensureBudget(
    modelInfo: ModelInfo | undefined,
    inputTokens: number,
    outputTokens: number | undefined,
    scope: BudgetScope,
  ): void {
    if (Object.values(this.budget).every((value) => value === undefined)) return;
    if (modelInfo?.category === "cloud" && modelInfo.pricingKnown === false) {
      throw new Error(
        `Model request blocked by budget: pricing metadata for ${modelInfo.name} is unavailable; refresh the OpenRouter catalog before using a spend limit.`,
      );
    }
    const estimatedMicros = estimateRequestCostMicros(modelInfo, inputTokens, outputTokens);
    const usage = this.getBudgetStatus().usage;
    const scopes: BudgetScope[] =
      scope === "task" ? ["request", "task", "session", "day"] : ["request", "session", "day"];
    for (const currentScope of scopes) {
      const check = checkBudget(this.budget, usage, currentScope, estimatedMicros);
      if (!check.allowed) {
        throw new Error(
          `Model request blocked by budget (${currentScope}): ${check.reason ?? "limit reached"} ` +
            `(estimated ${formatUsdMicros(check.estimatedMicros)} for ${modelInfo?.name ?? "the selected model"}).`,
        );
      }
    }
  }

  private modelInfoFor(modelId: string): ModelInfo | undefined {
    const provider = this.provider;
    if (!provider || typeof provider.resolveModelRuntime !== "function") return undefined;
    try {
      return provider.resolveModelRuntime(modelId).modelInfo;
    } catch {
      return undefined;
    }
  }

  async consumeBackgroundNotifications(): Promise<string[]> {
    try {
      const notifications = await this.delegations.consumeNotifications();
      for (const notification of notifications) {
        this.messages.push({ role: "system", content: notification.message });
        let seq: number | null = null;
        if (this.session) {
          seq = appendSystemMessage(this.session.id, notification.message);
        }
        this.messageSeqs.push(seq);

        const notifInput: NotificationHookInput = {
          hook_event_name: "Notification",
          message: notification.message,
          session_id: this.session?.id,
          cwd: this.bash.getCwd(),
        };
        this.fireHook(notifInput).catch(() => {});
      }
      return notifications.map((notification) => notification.message);
    } catch (error) {
      recordSwallowedError("notifications", error);
      return [];
    }
  }

  async runTaskRequest(
    request: TaskRequest,
    onActivity?: (detail: string) => void,
    abortSignal?: AbortSignal,
  ): Promise<ToolResult> {
    const provider = this.requireProvider();
    const signal = abortSignal;
    const agentKey = String(request.agent);
    const isExplore = agentKey === "explore";
    const isPlan = agentKey === "plan";
    const isGeneral = agentKey === "general";
    const isVision = agentKey === "vision";
    const isVerify = agentKey === "verify";
    const isUiVerify = agentKey === "ui-verify";
    const isVerifyDetect = agentKey === "verify-detect";
    const isVerifyManifest = agentKey === "verify-manifest";
    const isComputer = agentKey === "computer";
    const subagents = loadValidSubAgents();
    const custom =
      !isExplore &&
      !isPlan &&
      !isGeneral &&
      !isVision &&
      !isVerify &&
      !isUiVerify &&
      !isVerifyDetect &&
      !isVerifyManifest &&
      !isComputer
        ? findCustomSubagent(agentKey, subagents)
        : undefined;

    if (
      !isExplore &&
      !isPlan &&
      !isGeneral &&
      !isVision &&
      !isVerify &&
      !isUiVerify &&
      !isVerifyDetect &&
      !isVerifyManifest &&
      !isComputer &&
      !custom
    ) {
      const message = `Unknown sub-agent "${agentKey}". Use general, explore, plan, vision, verify, ui-verify, verify-detect, verify-manifest, computer, or a configured name from ~/.shelra/user-settings.json.`;
      return {
        success: false,
        output: message,
        task: {
          agent: agentKey,
          description: request.description,
          summary: message,
        },
      };
    }

    if ((isVerify || isVerifyDetect || isVerifyManifest) && !isShuruSupported()) {
      return {
        success: false,
        output: VERIFY_UNSUPPORTED_MESSAGE,
        task: { agent: agentKey, description: request.description, summary: VERIFY_UNSUPPORTED_MESSAGE },
      };
    }

    const childMode: AgentMode = isExplore || isPlan || isVerifyDetect ? "ask" : "agent";
    const verifySandboxOverrides: SandboxSettings = isVerify
      ? { allowNet: true, allowedHosts: undefined, allowEphemeralInstall: true, hostBrowserCommandsOnHost: true }
      : {};
    let verifyPreparedSettings: SandboxSettings | null = null;
    let verifyPreparedRecipe: VerifyRecipe | null = null;
    if (isVerify) {
      const prepared = await prepareVerifySandbox(
        this.bash.getCwd(),
        { ...this.bash.getSandboxSettings(), ...verifySandboxOverrides },
        undefined,
        onActivity,
      );
      verifyPreparedSettings = prepared.sandboxSettings;
      verifyPreparedRecipe = prepared.profile.recipe;
    }
    const childBash = new BashTool(this.bash.getCwd(), {
      root: this.bash.getRootCwd(),
      sandboxMode: isVerify ? "shuru" : this.bash.getSandboxMode(),
      sandboxSettings: isVerify
        ? (verifyPreparedSettings ?? { ...this.bash.getSandboxSettings(), ...verifySandboxOverrides })
        : this.bash.getSandboxSettings(),
    });
    const childToolGroups = loadToolGroupSettings();
    const childBaseTools = ablateTools(
      createTools(childBash, provider.getToolContext(), childMode, {
        toolGroups: { ...childToolGroups, desktop: childToolGroups.desktop || isComputer },
        ...this.destructiveCommandOption(),
      }),
      this.ablations,
    );
    const initialDetail = isExplore
      ? "Scanning the codebase"
      : isPlan
        ? "Drafting implementation plan"
        : isVerifyDetect
          ? "Detecting verification recipe"
          : isVerifyManifest
            ? "Creating verification manifest"
            : isVerify
              ? "Preparing verification pass"
              : isUiVerify
                ? "Starting UI quality pass 1 of 3"
                : isComputer
                  ? "Preparing computer control pass"
                  : "Planning delegated work";
    let assistantText = "";
    let lastActivity = initialDetail;
    /** Checks the sub-agent itself ran successfully; the parent's gate counts the delegation only with these. */
    const childEvidence: string[] = [];
    const childChangedFiles: string[] = [];
    let childTools: ToolSet = childBaseTools;
    let closeMcp: (() => Promise<void>) | undefined;
    const childModelId = normalizeModelId(custom?.model || this.modelId);
    const childRuntime = isVision
      ? provider.resolveModelRuntime(childModelId, { preferResponses: true })
      : provider.resolveModelRuntime(childModelId);
    if (isComputer && childRuntime.modelInfo?.supportsClientTools === false) {
      return {
        success: false,
        output:
          "Computer sub-agent requires a tool-capable model, but the selected runtime does not support client tools.",
        task: {
          agent: agentKey,
          description: request.description,
          summary: "Computer sub-agent could not start because the chosen model does not support tools.",
        },
      };
    }
    const childSystem = applyModelConstraints(
      buildSubagentPrompt(
        request,
        childBash.getCwd(),
        custom ?? null,
        childBash.getSandboxMode(),
        subagents,
        childBash.getSandboxSettings(),
        this.ablations,
        childBash.getRootCwd(),
      ),
      childRuntime.modelId,
    );

    onActivity?.(initialDetail);

    try {
      if (childMode === "agent" && childRuntime.modelInfo?.supportsClientTools !== false) {
        const mcpBundle = await buildMcpToolSet(loadMcpServers(), {
          signal,
          timeoutMs: this.mcpTimeoutMs,
        });
        closeMcp = mcpBundle.close;
        childTools = {
          ...childBaseTools,
          ...hardenToolSet(mcpBundle.tools, {
            cwd: () => childBash.getCwd(),
            sessionId: this.session?.id ?? undefined,
          }),
        };
        if (mcpBundle.errors.length > 0) {
          lastActivity = `MCP unavailable: ${mcpBundle.errors.join(" | ")}`;
          onActivity?.(lastActivity);
        }
      }

      const childPrompt =
        isVerify && verifyPreparedRecipe
          ? `${request.prompt}\n\nPrepared verify recipe JSON (use this as the primary execution recipe and keep .shelra/environment.json aligned with it if present):\n${JSON.stringify(verifyPreparedRecipe, null, 2)}`
          : request.prompt;

      const childMessages: ModelMessage[] =
        isVision && childRuntime.modelInfo?.supportsVision !== false
          ? await buildVisionUserMessages(request.prompt, childBash.getCwd(), signal)
          : [{ role: "user" as const, content: childPrompt }];

      // A failing model connection interrupts a sub-agent and never ends it on its own, as in the
      // main turn: completed steps are kept, the attempt is retried after a pause, and a model that
      // keeps failing is replaced by the provider's next fallback. It used to end the sub-agent at
      // the first timeout, losing every step it had completed.
      let conversation = childMessages;
      let runtime = childRuntime;
      let earlierText = "";
      const attempts: InterruptionState = {
        withoutProgress: 0,
        onModel: 0,
        total: 0,
        triedModels: new Set([runtime.modelId]),
      };
      while (true) {
        const attemptModelId = runtime.modelId;
        const childMaxOutputTokens =
          runtime.modelInfo?.supportsMaxOutputTokens === false
            ? undefined
            : Math.min(this.effectiveMaxOutputTokens(runtime.modelInfo?.contextWindow), 8_192);
        const childReasoningEffort = this.resolveReasoningEffort(attemptModelId);
        this.ensureBudget(
          runtime.modelInfo,
          estimateConversationTokens(childSystem, conversation),
          childMaxOutputTokens,
          "task",
        );
        let completedSteps: ModelMessage[] = [];
        let interruption: { reason: string; error: unknown } | null = null;
        let attemptText = "";
        let attemptServed: string | null = null;
        const childStream = provider.stream({
          modelId: attemptModelId,
          system: childSystem,
          messages: conversation,
          tools: runtime.modelInfo?.supportsClientTools === false ? {} : childTools,
          maxSteps: Math.min(this.maxToolRounds, isExplore || isPlan ? 60 : 120),
          timeout: patienceAfterSilences(this.modelTimeout, attempts.silences ?? 0),
          signal: withAbortTimeout(signal, this.modelTimeout.totalMs),
          temperature: this.samplingTemperature(attemptModelId, runtime.modelInfo, isExplore || isPlan ? 0.2 : 0.5),
          ...(childMaxOutputTokens === undefined ? {} : { maxOutputTokens: childMaxOutputTokens }),
          ...(childReasoningEffort === undefined ? {} : { reasoningEffort: childReasoningEffort }),
          onStepFinish: (event) => {
            if (event.responseMessages) {
              completedSteps = sanitizeModelMessages(event.responseMessages as ModelMessage[]);
            }
            if (event.servedModelId && servedByAnother(event.servedModelId, attemptModelId)) {
              attemptServed = event.servedModelId;
            }
          },
          onFinish: (usage) => {
            this.recordUsage(usage, "task", attemptServed ?? attemptModelId);
          },
        });
        // An interrupted attempt never awaits its response; its rejection must not go unhandled.
        childStream.response.catch(() => undefined);

        for await (const part of childStream.events) {
          if (signal?.aborted) break;
          if (part.type === "text-delta") {
            attemptText += part.text;
          } else if (part.type === "tool-call") {
            lastActivity = formatSubagentActivity(
              part.toolCall.function.name,
              parseToolArgumentsOrRaw(part.toolCall.function.arguments),
            );
            onActivity?.(lastActivity);
          } else if (part.type === "tool-result") {
            const childResult = toToolResult(part.output);
            if (childResult.success && childResult.diff?.filePath) childChangedFiles.push(childResult.diff.filePath);
            const evidence = childResult.success
              ? describeVerificationEvidence(
                  part.toolCall.function.name,
                  part.toolCall.function.arguments,
                  childChangedFiles,
                )
              : null;
            if (evidence) childEvidence.push(evidence);
          } else if (part.type === "error") {
            // A rejected key fails every attempt; the parent turn handles it.
            if (isRejectedCredentialError(part.error)) throw part.error;
            interruption = { reason: describeInterruption(part.error), error: part.error };
            break;
          } else if (part.type === "abort") {
            // Not the user: an SDK chunk, step or total timeout aborted the generation.
            if (!signal?.aborted) interruption = { reason: "no response within the time limit", error: null };
            break;
          }
        }

        if (signal?.aborted) {
          return { success: false, output: "[Cancelled]" };
        }
        if (!interruption) {
          try {
            await childStream.response;
          } catch (error) {
            if (signal?.aborted || isRejectedCredentialError(error)) throw error;
            interruption = { reason: describeInterruption(error), error };
          }
        }
        if (!interruption) {
          assistantText = attemptText;
          break;
        }

        // Only a completed step is progress; text streamed before a stall is regenerated.
        if (completedSteps.length > 0) {
          conversation = [
            ...conversation,
            ...completedSteps,
            { role: "user", content: interruptionContinuation(interruption.reason) },
          ];
          earlierText = [earlierText, assistantTextOf(completedSteps)].filter(Boolean).join("\n\n");
          attempts.withoutProgress = 0;
          attempts.onModel = 0;
        }
        attempts.withoutProgress += 1;
        attempts.onModel += 1;
        attempts.total += 1;
        if (isSilence(interruption.reason)) attempts.silences = (attempts.silences ?? 0) + 1;

        let stopped: string | null = null;
        if (
          attempts.withoutProgress > MAX_SUBAGENT_INTERRUPTIONS_WITHOUT_PROGRESS ||
          attempts.total > MAX_SUBAGENT_INTERRUPTIONS
        ) {
          stopped = `no model answered after ${attempts.total} attempts (last: ${interruption.reason})`;
        } else if (rejectsSamplingParameters(interruption.error) && !this.samplingRejected.has(attemptModelId)) {
          // As for the main turn: the model takes no `temperature`; the next attempt leaves it out.
          this.samplingRejected.add(attemptModelId);
          continue;
        } else {
          const unavailable = isModelUnavailableError(interruption.error);
          if (unavailable || attempts.onModel >= FAILURES_BEFORE_MODEL_SWITCH) {
            const fallback = nextFallbackModel(provider, attemptModelId, attempts);
            if (fallback) {
              attempts.onModel = 0;
              lastActivity = `${attemptModelId} is not answering (${interruption.reason}); continuing with ${fallback}`;
              onActivity?.(lastActivity);
              runtime = isVision
                ? provider.resolveModelRuntime(fallback, { preferResponses: true })
                : provider.resolveModelRuntime(fallback);
              continue;
            }
            if (unavailable) {
              stopped = `${attemptModelId} cannot serve this request (${interruption.reason}) and no fallback model is left`;
            }
          }
        }
        if (stopped) {
          const output = [
            `Task interrupted: ${stopped}.`,
            earlierText.trim()
              ? `Completed before the interruption:\n${earlierText.trim()}`
              : `Last action: ${lastActivity}`,
            "Files it changed are still on disk. Continue the work yourself or delegate it again.",
          ].join("\n\n");
          return {
            success: false,
            output,
            task: {
              agent: request.agent,
              description: request.description,
              summary: `Task interrupted: ${stopped}`,
              activity: lastActivity,
            },
          };
        }
        const delay =
          this.interruptionBackoffMs[Math.min(attempts.onModel - 1, this.interruptionBackoffMs.length - 1)] ?? 0;
        lastActivity = `Model connection interrupted (${interruption.reason}); retrying${delay >= 1_000 ? ` in ${Math.round(delay / 1_000)}s` : ""}`;
        onActivity?.(lastActivity);
        if (signal) await sleepUnlessAborted(delay, signal);
        else await new Promise((resolve) => setTimeout(resolve, delay));
        if (signal?.aborted) {
          return { success: false, output: "[Cancelled]" };
        }
      }

      const output = assistantText.trim() || earlierText.trim() || `Task completed. Last action: ${lastActivity}`;
      return {
        success: true,
        output,
        task: {
          agent: request.agent,
          description: request.description,
          summary: firstLine(output),
          activity: lastActivity,
          ...(childEvidence.length > 0 ? { evidence: [...childEvidence] } : {}),
        },
      };
    } catch (err: unknown) {
      if (signal?.aborted) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      const output = `Task failed: ${msg}`;
      return {
        success: false,
        output,
        task: {
          agent: request.agent,
          description: request.description,
          summary: output,
          activity: lastActivity,
        },
      };
    } finally {
      await closeMcp?.().catch(() => {});
    }
  }

  private async runTask(request: TaskRequest, abortSignal?: AbortSignal): Promise<ToolResult> {
    const startInput: SubagentStartHookInput = {
      hook_event_name: "SubagentStart",
      agent_type: request.agent,
      description: request.description,
      session_id: this.session?.id,
      cwd: this.bash.getCwd(),
    };
    await this.fireHook(startInput, abortSignal).catch(() => {});

    let result: ToolResult;
    try {
      result = await this.runTaskRequest(
        request,
        (detail) => {
          if (abortSignal?.aborted) return;
          this.emitSubagentStatus({
            agent: request.agent,
            description: request.description,
            detail,
          });
        },
        abortSignal,
      );
    } finally {
      this.emitSubagentStatus(null);
    }

    const stopInput: SubagentStopHookInput = {
      hook_event_name: "SubagentStop",
      agent_type: request.agent,
      description: request.description,
      success: result.success,
      session_id: this.session?.id,
      cwd: this.bash.getCwd(),
    };
    await this.fireHook(stopInput, abortSignal).catch(() => {});

    return result;
  }

  private async runDelegation(request: TaskRequest, abortSignal?: AbortSignal): Promise<ToolResult> {
    const taskCreatedInput: TaskCreatedHookInput = {
      hook_event_name: "TaskCreated",
      agent_type: request.agent,
      description: request.description,
      session_id: this.session?.id,
      cwd: this.bash.getCwd(),
    };
    await this.fireHook(taskCreatedInput, abortSignal).catch(() => {});

    let result: ToolResult;
    try {
      if (abortSignal?.aborted) {
        return { success: false, output: "[Cancelled]" };
      }

      result = await this.delegations.start(request, {
        model: this.modelId,
        sandboxMode: this.bash.getSandboxMode(),
        sandboxSettings: this.bash.getSandboxSettings(),
        maxToolRounds: this.maxToolRounds,
        maxTokens: this.maxTokens,
      });
    } catch (err: unknown) {
      if (abortSignal?.aborted) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      result = {
        success: false,
        output: `Delegation failed: ${msg}`,
      };
    }

    const taskCompletedInput: TaskCompletedHookInput = {
      hook_event_name: "TaskCompleted",
      agent_type: request.agent,
      description: request.description,
      success: result.success,
      session_id: this.session?.id,
      cwd: this.bash.getCwd(),
    };
    await this.fireHook(taskCompletedInput, abortSignal).catch(() => {});

    return result;
  }

  private async readDelegation(id: string): Promise<ToolResult> {
    try {
      return {
        success: true,
        output: await this.delegations.read(id),
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        output: `Failed to read delegation: ${msg}`,
      };
    }
  }

  private async listDelegations(): Promise<ToolResult> {
    try {
      const delegations = await this.delegations.list();
      if (delegations.length === 0) {
        return {
          success: true,
          output: "No delegations found for this project.",
        };
      }

      const lines = delegations.map((delegation) => {
        const title = delegation.description || delegation.id;
        return `- \`${delegation.id}\` [${delegation.status}] ${title}\n  ${delegation.summary}`;
      });

      return {
        success: true,
        output: `## Delegations\n\n${lines.join("\n")}`,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        output: `Failed to list delegations: ${msg}`,
      };
    }
  }

  /**
   * The compaction budget follows the model's real context window. Deriving it
   * from a fixed 16K reserve made the kept-recent budget larger than the whole
   * usable window on a small local model, so compaction could never satisfy its
   * own trigger.
   */
  private getCompactionSettings(contextWindow?: number): CompactionSettings {
    return compactionSettingsForWindow(contextWindow);
  }

  /**
   * Output reservation scaled to the window. A user-set SHELRA_MAX_TOKENS stays
   * authoritative; otherwise a small window never gets asked for an output
   * budget that cannot fit alongside its own prompt.
   */
  private effectiveMaxOutputTokens(contextWindow?: number): number {
    if (this.maxTokensExplicit) return this.maxTokens;
    if (contextWindow === undefined || !Number.isFinite(contextWindow) || contextWindow <= 0) return this.maxTokens;
    return Math.min(this.maxTokens, Math.max(1_024, Math.round(contextWindow * 0.25)));
  }

  /**
   * Compacts, then re-checks. A single cut can land above the trigger when the
   * kept suffix is itself oversized, so the budget is tightened and re-applied a
   * bounded number of times. The loop stops as soon as a pass cannot shrink the
   * budget further, so it can never spin.
   */
  private async compactForContext(
    provider: ProviderAdapter,
    system: string,
    contextWindow: number,
    signal: AbortSignal,
    settings = this.getCompactionSettings(contextWindow),
    force = false,
  ): Promise<boolean> {
    let active = settings;
    let compacted = false;

    for (let pass = 0; pass < MAX_COMPACTION_PASSES; pass++) {
      if (!(await this.compactOnce(provider, system, contextWindow, signal, active, force && pass === 0))) break;
      compacted = true;

      const remaining = estimateConversationTokens(system, this.messages);
      if (!shouldCompactContext(remaining, contextWindow, active)) break;

      const relaxed = relaxCompactionSettings(active);
      if (relaxed.keepRecentTokens >= active.keepRecentTokens) break;
      active = relaxed;
    }

    return compacted;
  }

  private async compactOnce(
    provider: ProviderAdapter,
    system: string,
    contextWindow: number,
    signal: AbortSignal,
    settings: CompactionSettings,
    force: boolean,
  ): Promise<boolean> {
    if (!this.session) return false;

    const preparation = prepareCompaction(this.messages, system, settings);
    if (!preparation) return false;
    if (!force && !shouldCompactContext(preparation.tokensBefore, contextWindow, settings)) {
      return false;
    }

    const trigger = force ? "manual" : "auto";
    const preCompactInput: PreCompactHookInput = {
      hook_event_name: "PreCompact",
      trigger,
      session_id: this.session?.id,
      cwd: this.bash.getCwd(),
    };
    await this.fireHook(preCompactInput, signal).catch(() => {});

    const keptSeqs = this.messageSeqs.slice(preparation.firstKeptIndex);
    const firstKeptSeq = keptSeqs.find((seq): seq is number => seq !== null) ?? getNextMessageSequence(this.session.id);
    const rawSummary = await generateCompactionSummary(
      provider,
      this.modelId,
      preparation,
      undefined,
      withAbortTimeout(signal, this.modelTimeout.totalMs),
      this.modelTimeout,
    );
    const summary = appendActiveCriteriaBlock(rawSummary, this.activeAcceptanceCriteria);

    appendCompaction(this.session.id, firstKeptSeq, summary, preparation.tokensBefore);
    this.messages = [createCompactionSummaryMessage(summary), ...preparation.keptMessages];
    this.messageSeqs = [null, ...keptSeqs];

    const postCompactInput: PostCompactHookInput = {
      hook_event_name: "PostCompact",
      trigger,
      session_id: this.session?.id,
      cwd: this.bash.getCwd(),
    };
    await this.fireHook(postCompactInput, signal).catch(() => {});

    return true;
  }

  /**
   * Advances the overflow-recovery ladder one step and reports whether the next
   * retry can actually be smaller than the last. Returning `false` means the
   * conversation cannot shrink any further, so the caller must surface the
   * error instead of retrying.
   */
  private escalateOverflowRecovery(level: number): boolean {
    if (level > MAX_OVERFLOW_RECOVERY_LEVEL) return false;
    // Level 1 changes nothing structurally: the retry re-enters compaction with
    // a relaxed, forced budget.
    if (level === 1) return true;
    return this.trimToRecentTurns(level === 2 ? OVERFLOW_RECOVERY_KEPT_TURNS : 1);
  }

  /**
   * Emergency in-memory trim: keeps the leading checkpoint summary plus the last
   * `turnsToKeep` user-started turns. Cuts land on user-message boundaries so a
   * tool call never loses its result. The persisted transcript is intentionally
   * left alone — this is a last-resort measure to get one turn through, not a
   * durable checkpoint.
   */
  private trimToRecentTurns(turnsToKeep: number): boolean {
    const start = isCompactionSummaryMessage(this.messages[0]) ? 1 : 0;
    const turnStarts: number[] = [];
    for (let index = start; index < this.messages.length; index++) {
      if (this.messages[index]?.role === "user") turnStarts.push(index);
    }
    if (turnStarts.length === 0) return false;

    const cutIndex = turnStarts[Math.max(0, turnStarts.length - Math.max(1, turnsToKeep))];
    if (cutIndex === undefined || cutIndex <= start) return false;

    this.messages = [...this.messages.slice(0, start), ...this.messages.slice(cutIndex)];
    this.messageSeqs = [...this.messageSeqs.slice(0, start), ...this.messageSeqs.slice(cutIndex)];
    return true;
  }

  /**
   * Compaction can remove old turns, but it cannot shrink one user message that
   * is larger than the remaining context by itself. Build a request-only copy
   * with that message bounded; the original stays in the transcript so the
   * session still shows exactly what the user submitted.
   */
  private messagesForContext(
    userModelMessage: ModelMessage,
    system: string,
    contextWindow: number,
    settings: CompactionSettings,
    conservative = false,
  ): ModelMessage[] {
    const userIndex = this.messages.lastIndexOf(userModelMessage);
    if (userIndex < 0) return this.messages;

    const totalTokens = estimateConversationTokens(system, this.messages);
    if (!conservative && !shouldCompactContext(totalTokens, contextWindow, settings)) return this.messages;

    const history = [...this.messages.slice(0, userIndex), ...this.messages.slice(userIndex + 1)];
    const historyTokens = estimateConversationTokens(system, history);
    // A retry uses no tools and a smaller output budget. Keep its input well
    // below the advertised window even when the provider's token accounting is
    // stricter than our character estimate.
    const inputBudget = conservative ? Math.floor(contextWindow * 0.6) : contextWindow - settings.reserveTokens;
    const maxUserTokens = Math.max(
      1,
      Math.floor(inputBudget / CONTEXT_ESTIMATE_MARGIN) - budgetedContextTokens(historyTokens),
    );
    const boundedUserMessage = truncateUserMessageToTokens(userModelMessage, maxUserTokens);
    if (boundedUserMessage === userModelMessage) return this.messages;

    return this.messages.map((message, index) => (index === userIndex ? boundedUserMessage : message));
  }

  private appendCompletedTurn(userMessage: ModelMessage, newMessages: ModelMessage[]): void {
    if (newMessages.length === 0) return;

    const normalizedMessages = normalizeModelMessages(newMessages);

    const userIndex = this.messages.lastIndexOf(userMessage);
    if (!this.sessionStore || !this.session) {
      this.messages.push(...normalizedMessages);
      this.messageSeqs.push(...normalizedMessages.map(() => null));
      return;
    }

    // Persist every message of this turn that is not stored yet — the user message on the first
    // round plus any host-injected continuation prompts pushed by later rounds — exactly once.
    // Previously each round re-inserted the user message and never stored the nudges, so a
    // replayed transcript showed duplicated prompts and unexplained model replies.
    const pendingIndexes: number[] = [];
    for (let index = userIndex >= 0 ? userIndex : this.messages.length; index < this.messages.length; index += 1) {
      if (this.messageSeqs[index] == null) pendingIndexes.push(index);
    }
    const pending = pendingIndexes.map((index) => this.messages[index] as ModelMessage);
    const insertedSeqs = appendMessages(this.session.id, [...pending, ...normalizedMessages]);
    pendingIndexes.forEach((index, offset) => {
      this.messageSeqs[index] = insertedSeqs[offset] ?? null;
    });
    this.messages.push(...normalizedMessages);
    this.messageSeqs.push(...insertedSeqs.slice(pending.length));
    this.sessionStore.touchSession(this.session.id, this.bash.getCwd());
    this.session = this.sessionStore.getRequiredSession(this.session.id);
  }

  private fireHook(
    input: Parameters<typeof executeEventHooks>[0],
    signal?: AbortSignal,
  ): Promise<Awaited<ReturnType<typeof executeEventHooks>>> {
    // Every caller carries on without the hook's result; the failure is recorded here, once.
    return executeEventHooks(input, this.bash.getCwd(), signal).catch((error: unknown) => {
      if (!signal?.aborted) recordSwallowedError(`hooks.${input.hook_event_name}`, error);
      throw error;
    });
  }

  /** One turn, recorded in the session's local trace (`shelra trace`, `src/utils/session-trace.ts`). */
  async *processMessage(
    userMessage: string,
    observer?: ProcessMessageObserver,
  ): AsyncGenerator<StreamChunk, void, unknown> {
    const cwd = this.bash.getRootCwd();
    const trace = startTurnTrace({
      sessionId: this.session?.id ?? null,
      cwd,
      model: this.modelId,
      mode: this.mode,
      request: userMessage,
      outsideProject: isOutsideProject(cwd),
    });
    try {
      for await (const chunk of this.runTurn(userMessage, trace.observe(observer))) {
        trace.chunk(chunk);
        yield chunk;
      }
    } catch (error) {
      trace.error(error);
      throw error;
    } finally {
      this.deliverDueReminders();
      this.recordUnlearnedTurn();
      trace.end();
    }
  }

  private async *runTurn(
    userMessage: string,
    observer?: ProcessMessageObserver,
  ): AsyncGenerator<StreamChunk, void, unknown> {
    this.abortController = new AbortController();
    const signal = this.abortController.signal;
    this.kernel = null;
    this.contextSummary = null;
    this.attemptJournal = new AttemptJournal();
    this.turnLedgerWrites = new Map();
    this.turnEndNotes = [];
    this.turnDecisions = activeDecisions(this.bash.getRootCwd());
    this.turnStartLedger = new Map(
      listDecisions(this.bash.getRootCwd()).map((decision) => [foldPath(decision.file), decision]),
    );
    this.emitSubagentStatus(null);
    const reportStatus = (stage: ProcessMessageStage, detail: string) => {
      notifyObserver(observer?.onStatus, { stage, detail, timestamp: Date.now() });
    };

    reportStatus("hooks", "Preparing session hooks");
    if (!this.sessionStartHookFired) {
      this.sessionStartHookFired = true;
      const isResume = this.messages.length > 0;
      const sessionStartInput: SessionStartHookInput = {
        hook_event_name: "SessionStart",
        source: isResume ? "resume" : "startup",
        session_id: this.session?.id,
        cwd: this.bash.getCwd(),
      };
      await this.fireHook(sessionStartInput, signal).catch(() => {});
    }

    const promptInput: UserPromptSubmitHookInput = {
      hook_event_name: "UserPromptSubmit",
      user_prompt: userMessage,
      session_id: this.session?.id,
      cwd: this.bash.getCwd(),
    };
    await this.fireHook(promptInput, signal).catch(() => {});

    reportStatus("notifications", "Reading background activity");
    await this.consumeBackgroundNotifications();
    // Reassigned when the provider rejects its API key and the session moves to a fallback.
    let provider = this.requireProvider();
    // Reassigned when a failing model is replaced by a fallback for the rest of this turn.
    let runtime = provider.resolveModelRuntime(this.modelId);
    // Create the host-owned lifecycle before context compilation and research so
    // observers can answer what is happening during the earliest real phase.
    this.kernel = new AgentKernel(userMessage);
    // activeAcceptanceCriteria/activePlanSteps are deliberately NOT reset here — session-scoped
    // (§14 Phase 2 item 1), so a plan published in an earlier turn still governs this turn's
    // mutations.
    this.turnVerificationEvidence = [];
    this.turnLinkedCriteriaIds = new Set();
    this.planState = { published: this.mode !== "agent", structured: false };
    this.persistKernelIndex();
    this.kernel.transition("discover");
    this.persistKernelIndex();
    reportStatus("context", "Compiling workspace context");
    // Let the TUI paint the stage before the synchronous git and check-discovery reads start.
    await yieldToEventLoop();
    const userModelMessages =
      runtime.modelInfo?.supportsVision === false
        ? [{ role: "user", content: userMessage } satisfies ModelMessage]
        : await buildVisionUserMessages(userMessage, this.bash.getCwd(), signal);
    const userModelMessage = userModelMessages[0] ?? ({ role: "user", content: userMessage } satisfies ModelMessage);
    this.messages.push(userModelMessage);
    this.messageSeqs.push(null);

    const subagents = loadValidSubAgents();
    const contextPacket = compileContextPacket(this.bash.getCwd(), userMessage);
    // Standing instructions in the user's own words are memory the moment they are said; no model
    // call is needed to recognize "always ..." / "never ...". The gate still validates them.
    // The store is the session's root folder, never a folder a `cd` moved the shell to (doc 18 §2.2 R4).
    const memoryRoot = this.bash.getRootCwd();
    const memoryScope = projectMemoryScope(memoryRoot);
    const memoryOff = this.ablations.has("memory");
    // A reminder the user asks for now is for a later request: it is kept after this turn's recall, so its own cue
    // in this very message does not give it back at once.
    let remindersAsked: ReturnType<typeof extractUserDirectives> = [];
    try {
      const captured = memoryOff ? [] : extractUserDirectives(userMessage);
      remindersAsked = captured.filter((directive) => directive.type === "reminder");
      const directives = captured.filter((directive) => directive.type !== "reminder");
      // A preference about how Shelra talks to this person holds in every project.
      const routed: Array<[typeof memoryScope, typeof directives]> = [
        [memoryScope, directives.filter((directive) => !directive.tags?.includes("user-wide"))],
        [userMemoryScope(), directives.filter((directive) => directive.tags?.includes("user-wide"))],
      ];
      for (const [scope, list] of routed) {
        if (list.length === 0) continue;
        const admitted = admitCandidates(scope, list);
        appendReflectionAudit(scope, {
          kind: "directive",
          at: new Date().toISOString(),
          qualified: true,
          reason: "the user's own words",
          candidates: list.length,
          decisions: admitted.decisions,
          written: admitted.written,
        });
      }
    } catch (error) {
      // memory capture must never block a turn
      recordSwallowedError("memory.capture", error);
    }
    // Once a day, before recalling anything: recurring failures become lessons, unused inferences fade (doc 18 §4.6).
    if (!memoryOff) consolidateMemory(memoryScope);
    const memoryContext: MemoryContext = memoryOff
      ? { text: "", expanded: [], listed: [] }
      : memoryContextFor(memoryRoot, userMessage, contextPacket.files, this.previousRequest);
    // A reminder due now is crossed off when the turn closes, and only if a model answered it (deliverDueReminders): a
    // turn cut Limited never showed it to anyone.
    this.turnDueReminders = { scope: memoryScope, slugs: memoryContext.reminders ?? [] };
    if (remindersAsked.length > 0) {
      try {
        // "cuando toquemos esto": the cue is what the conversation is about, the request before this one.
        const contextCues = cueTermsOf(this.previousRequest ?? "");
        const reminders = remindersAsked.map((reminder) =>
          reminder.tags?.includes("cue-from-context")
            ? {
                ...reminder,
                tags: [
                  ...reminder.tags.filter((tag) => tag !== "cue-from-context"),
                  ...contextCues.map((term) => `cue:${term}`),
                ],
              }
            : reminder,
        );
        const admitted = admitCandidates(memoryScope, reminders);
        appendReflectionAudit(memoryScope, {
          kind: "reminder",
          at: new Date().toISOString(),
          qualified: true,
          reason: "a reminder the user asked for",
          candidates: remindersAsked.length,
          decisions: admitted.decisions,
          written: admitted.written,
        });
      } catch (error) {
        recordSwallowedError("memory.capture", error);
      }
    }
    // "sí, hazlo" then "dale, sigue": both carry on the request before them, which stays the one memory is found for.
    if (!this.previousRequest || previousRequestWeight(typedText(userMessage)) < 0.8) {
      this.previousRequest = typedText(userMessage);
    }
    this.lastMemoryContext = memoryContext;
    notifyObserver(observer?.onMemoryRecall, {
      rules: memoryContext.rules ?? [],
      entries: (memoryContext.explain ?? []).filter((item) => item.tier !== "rule"),
      chars: memoryContext.text.length,
      timestamp: Date.now(),
    });
    if (memoryContext.expanded.length > 0) recordMemoryUse(memoryScope, memoryContext.expanded);
    const turnCommands: TurnCommand[] = [];
    // Everything the turn said and every tool it called, across all its rounds: a reflection used to see only the
    // last round (doc 18 §2.1 C2).
    let turnText = "";
    let turnToolCalls = 0;
    this.turnLearned = false;
    this.turnMemoryDigest = () => ({
      userMessage,
      assistantText: turnText.slice(-12_000),
      changedFiles: mergeChangedFiles(
        memoryRoot,
        this.kernel?.snapshot().mutations ?? [],
        (turnStartState && changedPaths(turnStartState, captureWorkspaceState(memoryRoot))) ?? [],
      ),
      commands: turnCommands,
      verified: this.turnVerificationEvidence.length > 0,
      toolCalls: turnToolCalls,
    });
    const pendingCommands = new Map<string, string>();
    /** Checks this turn ran whose exit status a later command replaced; the gate names them. */
    const maskedChecks = new Set<string>();
    this.contextSummary = {
      classification: { ...contextPacket.classification },
      files: [...contextPacket.files],
      truncated: contextPacket.truncated,
    };
    this.kernel.setScope(contextPacket.files);
    this.kernel.transition("analyze");
    this.kernel.transition("plan");
    this.persistKernelIndex();
    // The model always receives the full prompt and tool set for its mode. Which tools a turn
    // needs is the model's decision from the request itself — an earlier keyword classifier that
    // stripped tools from "conversational-looking" prompts silently turned requests such as
    // "make the tests pass" or "git status" into tool-less chat turns (24 of 30 realistic coding
    // prompts, measured 2026-09-17). Only a model's declared capability may remove tools now.
    const system = applyModelConstraints(
      [
        buildSystemPrompt(
          this.bash.getCwd(),
          this.mode,
          this.bash.getSandboxMode(),
          this.planContext,
          subagents,
          this.bash.getSandboxSettings(),
          memoryContext,
          this.ablations,
        ),
        this.ablations.has("context") ? "" : contextPacket.promptAppendix,
      ]
        .filter(Boolean)
        .join("\n\n"),
      this.modelId,
    );
    let modelInfo = runtime.modelInfo;
    this.planContext = null;
    let overflowRecoveryLevel = 0;
    let verificationRetries = 0;
    let emptyResponseRetries = 0;
    const interruptions: InterruptionState = {
      withoutProgress: 0,
      onModel: 0,
      total: 0,
      triedModels: new Set([runtime.modelId]),
    };
    const switchModel = (modelId: string) => {
      runtime = provider.resolveModelRuntime(modelId);
      modelInfo = runtime.modelInfo;
      emptyResponseRetries = 0;
    };
    // The model the UI shows is the one answering: the turn's model when a round starts on it, and the model the
    // provider says answered each step when that is another one: a router's pick (`openrouter/auto`), or a model
    // from OpenRouter's server-side fallback list (seen live 2026-09-24: the footer kept showing the chosen model while
    // the auto router billed another). Read per request, so a title or a sub-agent's request never replaces it.
    let announcedModel: string | null = null;
    let announcedServed: string | null = null;
    let roundServed: string | null = null;
    /** The turn continues on another provider or key (a fallback of either kind), with a fresh attempt budget there. */
    const adoptProvider = (fallback: CredentialFallback) => {
      provider = fallback.provider;
      interruptions.onModel = 0;
      interruptions.withoutProgress = 0;
      interruptions.total = 0;
      interruptions.triedModels.clear();
      interruptions.triedModels.add(fallback.modelId);
      switchModel(fallback.modelId);
    };
    // Requirement audit, one round per turn: when the request enumerates several behaviors, a
    // green run is evidence only for the behaviors the executed tests exercise. Measured on the
    // core suite 2026-09-17 (qwen3-coder-30b, run #11): all three failures were tasks whose prompt
    // listed five to eight behaviors; the model's own checks passed while the benchmark's hidden
    // tests failed on behaviors nothing had exercised.
    const requirementChecklist = isRequirementDense(userMessage) ? extractRequirements(userMessage) : [];
    let requirementAudit: { mutations: number; evidence: number } | null = null;
    let turnMutationEvents = 0;
    // What the workspace looked like when the turn started and when the last check passed: the gate
    // compares them with the final state, so a change made through the shell counts, and a check that
    // passed before later changes does not vouch for the final code.
    // The turn is judged in the session's workspace, not in whatever folder a `cd` left the shell in.
    const turnStartWorkspace = this.bash.getRootCwd();
    const turnStartState = this.mode === "agent" ? captureWorkspaceState(turnStartWorkspace) : null;
    // The checks that decide "done", as they stood when the turn started (audit doc 17, S10): a turn is judged by
    // them, not by a check script or command table it rewrote.
    // The kinds of check the request asks to change; a short follow-up carries the request it answers.
    const allowedCheckKinds = checkEditsAllowedBy(userMessage);
    if (isShortFollowUp(userMessage)) for (const kind of this.previousAllowedCheckKinds) allowedCheckKinds.add(kind);
    this.previousAllowedCheckKinds = new Set(allowedCheckKinds);
    const carried = this.checkBaselineCarry?.workspace === turnStartWorkspace ? this.checkBaselineCarry : null;
    // Reading the project's check definitions must never take down a turn: without them the turn runs unprotected.
    const readDefinitions = <T>(read: () => T, fallback: T): T => {
      try {
        return read();
      } catch (error) {
        recordSwallowedError("contract.check-definitions", error);
        return fallback;
      }
    };
    const turnStartChecks =
      this.mode === "agent"
        ? (carried?.checks ?? readDefinitions(() => snapshotCheckDefinitions(turnStartWorkspace), []))
        : [];
    // The files that define package scripts, recipes and runner settings as the turn found them (or as the turn
    // that left a change unresolved found them): a check a turn wrote itself is not evidence about the code.
    const turnStartDefinitionFiles =
      this.mode === "agent"
        ? (carried?.recorded ?? readDefinitions(() => recordDefinitionFiles(turnStartWorkspace), null))
        : null;
    // Until this turn's gate finds the checks as they were, a stop before it leaves any change unresolved.
    if (this.mode === "agent" && turnStartDefinitionFiles) {
      this.checkBaselineCarry = {
        workspace: turnStartWorkspace,
        checks: turnStartChecks,
        recorded: turnStartDefinitionFiles,
      };
    }
    let lastPassingCheck: { state: WorkspaceState; mutationEvents: number; evidence: string } | null = null;
    /** Every check run this turn, the agent's and the host's, with the workspace as it stood then. */
    /** Why the agent said the task cannot be done as asked (report_blocker), if it did. */
    let turnBlocker: string | null = null;
    /** Existing tests changed without the request asking: the turn is asked once to restore them. */
    let testEditsNudged = false;
    let checkEditsNudged = false;
    let decisionEditsNudged = false;
    /**
     * The repair ledger (audit doc 15, Phase 2.2): the last failing contract evaluation, to tell a repeat
     * of the same failures after more changes from progress.
     */
    let lastContractFailure: { signature: string; mutationEvents: number; state: WorkspaceState | null } | null = null;
    /** Each contract check's result at the previous evaluation of this turn, by command. */
    let lastContractResults: ReadonlyMap<string, boolean> | null = null;
    /** After a repair attempt that changed nothing about the failures, later rounds get the model's top effort. */
    let repairEscalated = false;
    /** The turn's contract ran and every check passed on the final code. */
    let contractPassed = false;
    const checkRuns: Array<{
      command: string;
      passed: boolean;
      detail: string;
      mutationEvents: number;
      state: WorkspaceState | null;
      /** Where it ran: only a run in the turn's workspace can stand for the project's check. */
      cwd: string;
      /** A host run of a decision check that reached no verdict keeps that judgment when it is reused. */
      unrunnable?: string;
    }> = [];

    try {
      while (true) {
        let assistantText = "";
        let reasoningPreview = "";
        let encryptedReasoningHidden = false;
        let streamOk = false;
        // Set when the model connection failed during this round; recovered below, never fatal.
        let interruption: { reason: string; error: unknown } | null = null;
        // The generation's completed steps so far, kept if a later step of it fails.
        let completedStepMessages: ModelMessage[] = [];
        let closeMcp: (() => Promise<void>) | undefined;
        let stepNumber = -1;
        let lastStepProducedOutput = false;
        let lastStepToolCalls = 0;
        let lastStepFinishReason: ProcessMessageFinishReason | null = null;
        const activeToolCalls: ToolCall[] = [];

        try {
          const baseSettings = this.getCompactionSettings(modelInfo?.contextWindow);
          const settings = overflowRecoveryLevel > 0 ? relaxCompactionSettings(baseSettings) : baseSettings;
          const requestSystem = overflowRecoveryLevel > 0 ? buildConversationSystemPrompt(this.bash.getCwd()) : system;
          if (modelInfo) {
            reportStatus("context", "Checking context window and saved history");
            await this.compactForContext(
              provider,
              requestSystem,
              modelInfo.contextWindow,
              signal,
              settings,
              overflowRecoveryLevel > 0,
            );
          }
          const requestMessages = modelInfo
            ? this.messagesForContext(
                userModelMessage,
                requestSystem,
                modelInfo.contextWindow,
                settings,
                overflowRecoveryLevel > 0,
              )
            : this.messages;

          const baseTools = createTools(this.bash, provider.getToolContext(), this.mode, {
            runTask: (request, abortSignal) => this.runTask(request, combineAbortSignals(signal, abortSignal)),
            runDelegation: (request, abortSignal) =>
              this.runDelegation(request, combineAbortSignals(signal, abortSignal)),
            readDelegation: (id) => this.readDelegation(id),
            listDelegations: () => this.listDelegations(),
            scheduleManager: this.schedules,
            subagents,
            sendTelegramFile: this.sendTelegramFile ?? undefined,
            sessionId: this.session?.id ?? undefined,
            onCheckpoint: this.onToolCheckpoint,
            restoreFile: this.restoreFileFromJournal,
            ...(this.ablations.has("ledger") ? {} : { proposeDecision: this.proposeDecisionFromTool }),
            planState: this.planState,
            toolGroups: loadToolGroupSettings(),
            ...this.destructiveCommandOption(),
            // A plan criterion's command runs once when the plan is published, to prove it fails before the
            // change; once the turn has changed anything, "before" is gone and it is not run.
            probeCriterionCommand: async (command, abortSignal) => {
              const cwd = turnStartWorkspace;
              if (!turnStartState || turnMutationEvents > 0) return null;
              if (changedPaths(turnStartState, captureWorkspaceState(cwd))?.length !== 0) return null;
              if (destructiveCommandReason(command, cwd)) return null;
              const result = await this.checkRunner(command, {
                timeoutMs: CRITERION_PROBE_TIMEOUT_MS,
                signal: combineAbortSignals(signal, abortSignal),
                cwd,
              });
              return { passed: result.passed, output: result.output };
            },
          });
          let tools: ToolSet = runtime.modelInfo?.supportsClientTools === false ? {} : baseTools;
          if (this.mode === "agent" && runtime.modelInfo?.supportsClientTools !== false) {
            reportStatus("mcp", "Connecting configured MCP tools");
            const mcpBundle = await buildMcpToolSet(loadMcpServers(), {
              signal,
              timeoutMs: this.mcpTimeoutMs,
            });
            closeMcp = mcpBundle.close;
            tools = {
              ...baseTools,
              ...hardenToolSet(mcpBundle.tools, {
                cwd: () => this.bash.getCwd(),
                sessionId: this.session?.id ?? undefined,
              }),
            };
            if (mcpBundle.errors.length > 0) {
              yield { type: "content", content: `MCP unavailable: ${mcpBundle.errors.join(" | ")}\n\n` };
            }
          }
          tools = ablateTools(tools, this.ablations);
          if (overflowRecoveryLevel > 0) tools = {};

          const maxOutputTokens =
            runtime.modelInfo?.supportsMaxOutputTokens === false
              ? undefined
              : Math.min(
                  maxOutputTokensForTurn(runtime, this.effectiveMaxOutputTokens(modelInfo?.contextWindow)),
                  overflowRecoveryLevel > 0 ? 512 : Number.POSITIVE_INFINITY,
                );
          this.ensureBudget(
            modelInfo,
            estimateConversationTokens(requestSystem, requestMessages),
            maxOutputTokens,
            "request",
          );

          if (runtime.modelId !== announcedModel) {
            announcedModel = runtime.modelId;
            announcedServed = null;
            yield { type: "model", modelId: runtime.modelId };
          }
          roundServed = null;
          reportStatus("model", `Waiting for ${runtime.modelId}`);
          // A repair that keeps failing the same way gets the model's top effort (audit doc 15, Phase 2.4). It stays
          // within the spending policy: the model does not change, and budgets still apply.
          const turnReasoningEffort = repairEscalated
            ? (getSupportedReasoningEfforts(runtime.modelId).at(-1) ?? this.resolveReasoningEffort(runtime.modelId))
            : this.resolveReasoningEffort(runtime.modelId);
          const modelSignal = withAbortTimeout(signal, this.modelTimeout.totalMs);
          const stream = provider.stream({
            modelId: runtime.modelId,
            system: requestSystem,
            messages: requestMessages,
            tools,
            maxSteps: this.maxToolRounds,
            timeout: patienceAfterSilences(this.modelTimeout, interruptions.silences ?? 0),
            signal: modelSignal,
            temperature: this.samplingTemperature(runtime.modelId, runtime.modelInfo, 0.7),
            ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
            ...(turnReasoningEffort === undefined ? {} : { reasoningEffort: turnReasoningEffort }),
            onStepStart: (currentStep) => {
              stepNumber = currentStep;
              lastStepProducedOutput = false;
              lastStepToolCalls = 0;
              notifyObserver(observer?.onStepStart, {
                stepNumber,
                timestamp: Date.now(),
              });
            },
            onStepFinish: (event) => {
              const currentStep = Math.max(stepNumber, event.stepNumber);
              stepNumber = currentStep;
              lastStepFinishReason = getBatchFinishReason(event.finishReason);
              if (event.responseMessages) {
                completedStepMessages = sanitizeModelMessages(event.responseMessages as ModelMessage[]);
              }
              if (event.servedModelId && servedByAnother(event.servedModelId, runtime.modelId)) {
                roundServed = event.servedModelId;
              }
              notifyObserver(observer?.onStepFinish, {
                stepNumber: currentStep,
                timestamp: Date.now(),
                finishReason: getBatchFinishReason(event.finishReason),
                usage: event.usage,
              });
            },
            onFinish: (usage) => {
              this.recordUsage(usage, "message", roundServed ?? runtime.modelId);
            },
          });
          // An interrupted or cancelled round never awaits its response; its rejection must not
          // surface as an unhandled rejection. Awaiting it below still sees the rejection.
          stream.response.catch(() => undefined);
          this.kernel?.transition("act");

          for await (const part of stream.events) {
            if (signal.aborted) {
              yield { type: "content", content: `\n\n${this.endNote("[Cancelled]")}` };
              break;
            }
            if (roundServed && roundServed !== announcedServed) {
              announcedServed = roundServed;
              yield { type: "model", modelId: runtime.modelId, servedModelId: roundServed };
            }

            switch (part.type) {
              case "text-delta":
                if (part.text) lastStepProducedOutput = true;
                assistantText += part.text;
                turnText += part.text;
                yield { type: "content", content: part.text };
                break;

              case "tool-input": {
                // The model is writing a tool call (a file's content, a long command): say so, with what has arrived,
                // instead of "Waiting for" the model while the file streams in.
                const size = part.chars >= 1_024 ? `${(part.chars / 1_024).toFixed(1)} KB` : `${part.chars} chars`;
                reportStatus(
                  "model",
                  part.path
                    ? `Writing ${part.path} · ${size}`
                    : `Preparing ${part.toolName}${part.chars > 0 ? ` · ${size}` : ""}`,
                );
                break;
              }

              case "reasoning-delta":
                reasoningPreview = `${reasoningPreview}${part.text}`.slice(-256);
                if (containsEncryptedReasoning(reasoningPreview)) {
                  if (!encryptedReasoningHidden) {
                    encryptedReasoningHidden = true;
                    yield { type: "reasoning", content: "[Encrypted reasoning hidden]" };
                  }
                  break;
                }
                yield { type: "reasoning", content: part.text };
                break;

              case "tool-call": {
                const tc = part.toolCall;
                lastStepProducedOutput = true;
                lastStepToolCalls += 1;
                activeToolCalls.push(tc);
                turnToolCalls += 1;
                if (tc.function.name === "bash") {
                  try {
                    const command = (JSON.parse(tc.function.arguments) as { command?: string }).command;
                    if (typeof command === "string") pendingCommands.set(tc.id, command);
                  } catch {
                    // malformed args; nothing to record
                  }
                }
                notifyObserver(observer?.onToolStart, {
                  toolCall: tc,
                  timestamp: Date.now(),
                });
                yield { type: "tool_calls", toolCalls: [tc] };
                break;
              }

              case "tool-result": {
                const tc = part.toolCall;
                const tr = toToolResult(part.output);
                if (tr.success && tr.diff?.filePath) {
                  this.kernel?.recordMutation(tr.diff.filePath);
                  turnMutationEvents += 1;
                } else this.kernel?.recordObservation(`${tc.function.name}: ${tr.output}`);
                if (tr.success && tr.plan?.acceptanceCriteria?.length) {
                  this.activeAcceptanceCriteria = tr.plan.acceptanceCriteria;
                  this.activePlanSteps = tr.plan.steps;
                }
                if (tr.success && tr.blocker) turnBlocker = tr.blocker;
                if (tr.success && tr.planUpdate?.status === "complete") {
                  for (const id of this.activePlanSteps?.[tr.planUpdate.index]?.satisfies ?? []) {
                    this.turnLinkedCriteriaIds.add(id);
                  }
                }
                const described = !tr.success
                  ? null
                  : tc.function.name === "task"
                    ? describeDelegatedEvidence(tr.task?.agent ?? "task", tr.task?.evidence)
                    : describeVerificationEvidence(
                        tc.function.name,
                        tc.function.arguments,
                        this.kernel?.snapshot().mutations ?? [],
                      );
                // A check that runs a script or recipe this turn created or changed proves only what the turn
                // wrote into it (audit doc 17, S10), unless the request asked for that change.
                const ranCommand = pendingCommands.get(tc.id);
                const ranKind = described !== null && ranCommand ? checkKindOf(ranCommand, turnStartWorkspace) : null;
                const evidence =
                  described !== null &&
                  ranCommand !== undefined &&
                  turnStartDefinitionFiles !== null &&
                  !(ranKind !== null && allowedCheckKinds.has(ranKind)) &&
                  runsChangedDefinition(
                    ranCommand,
                    this.bash.getCwd(),
                    turnStartWorkspace,
                    turnStartDefinitionFiles,
                    new Set(
                      (turnStartState && changedPaths(turnStartState, captureWorkspaceState(turnStartWorkspace))) ?? [],
                    ),
                  )
                    ? null
                    : described;
                if (evidence) {
                  this.turnVerificationEvidence.push(evidence);
                  if (turnStartState) {
                    lastPassingCheck = {
                      state: captureWorkspaceState(turnStartWorkspace),
                      mutationEvents: turnMutationEvents,
                      evidence,
                    };
                  }
                } else if (tr.success) {
                  const masked = maskedVerificationCommand(tc.function.name, tc.function.arguments);
                  if (masked) maskedChecks.add(masked);
                }
                const digestCommand = pendingCommands.get(tc.id);
                if (digestCommand !== undefined) {
                  pendingCommands.delete(tc.id);
                  turnCommands.push({
                    command: digestCommand,
                    success: tr.success,
                    output: (tr.success ? tr.output : (tr.error ?? tr.output)) ?? "",
                  });
                  if (turnCommands.length > 24) turnCommands.shift();
                  if (turnStartState && isVerificationCommand(digestCommand)) {
                    checkRuns.push({
                      command: digestCommand,
                      passed: tr.success,
                      detail: ((tr.success ? tr.output : (tr.error ?? tr.output)) ?? "").slice(-6_000),
                      mutationEvents: turnMutationEvents,
                      state: captureWorkspaceState(turnStartWorkspace),
                      cwd: this.bash.getCwd(),
                    });
                  }
                }
                notifyObserver(observer?.onToolFinish, {
                  toolCall: tc,
                  toolResult: tr,
                  timestamp: Date.now(),
                });
                yield { type: "tool_result", toolCall: tc, toolResult: tr };
                break;
              }

              case "tool-approval-request": {
                const toolCallId = part.toolCall.id;
                const pendingTc = activeToolCalls.find((tc) => tc.id === toolCallId);
                const tcForChunk = pendingTc ?? {
                  id: toolCallId,
                  type: "function" as const,
                  function: {
                    name: part.toolCall.function.name,
                    arguments: part.toolCall.function.arguments,
                  },
                };

                let paymentPrecheck: import("../types/index").PaymentPrecheck | undefined;
                if (part.toolCall.function.name === "paid_request") {
                  try {
                    const input = JSON.parse(part.toolCall.function.arguments) as { url?: string; method?: string };
                    const url = input?.url;
                    if (url) {
                      const { scanUrl } = await import("../payments/brin");
                      const brin = await scanUrl(url);
                      if (brin) {
                        const securityRaw = `${brin.score}/100 (${brin.verdict}, ${brin.confidence} confidence)`;
                        paymentPrecheck = {
                          security: securityRaw,
                          securityLabel: securityRaw,
                          securityUrl: brin.url ?? "",
                        };
                      }

                      const probeRes = await fetch(url, {
                        method: input?.method ?? "GET",
                        signal: AbortSignal.timeout(3_000),
                      });
                      if (probeRes.status === 402) {
                        const header = probeRes.headers.get("payment-required");
                        if (header) {
                          const decoded = JSON.parse(Buffer.from(header, "base64").toString("utf-8"));
                          const opts = decoded.accepts ?? [];
                          if (opts.length > 0) {
                            const opt = opts[0];
                            paymentPrecheck = {
                              ...paymentPrecheck,
                              amount: opt.amount ?? opt.maxAmountRequired ?? opt.price ?? "",
                              network: opt.network ?? "",
                              asset: opt.asset ?? "",
                              description: decoded.resource?.description ?? decoded.description ?? "",
                            };
                          }
                        }
                      }
                    }
                  } catch {
                    // pre-check is best-effort
                  }
                }

                yield {
                  type: "tool_approval_request",
                  approvalId: part.approvalId,
                  toolCall: tcForChunk,
                  paymentPrecheck,
                };
                break;
              }

              case "error": {
                // A provider may surface a context failure as a stream event
                // before `stream.response` rejects. Route it through the same
                // recovery ladder without exposing a transient raw error to
                // the user.
                if (modelInfo && isContextLimitError(part.error)) {
                  throw part.error instanceof Error ? part.error : new Error(humanizeApiError(part.error));
                }
                // A rejected credential cannot be retried around; it ends the turn in the catch below.
                if (isRejectedCredentialError(part.error)) {
                  throw part.error instanceof Error ? part.error : new Error(humanizeApiError(part.error));
                }
                // Anything else (a silent upstream cut by the idle watchdog, "Upstream idle timeout
                // exceeded", a rate limit, a provider error) is the connection failing, not the task.
                interruption = { reason: describeInterruption(part.error), error: part.error };
                break;
              }

              case "abort":
                if (signal.aborted) yield { type: "content", content: `\n\n${this.endNote("[Cancelled]")}` };
                // Not the user: an SDK chunk, step or total timeout aborted the generation.
                else interruption ??= { reason: "no response within the time limit", error: null };
                break;
            }
            if (interruption) break;
          }

          if (signal.aborted) {
            this.kernel?.cancel();
            this.persistKernelIndex();
            this.discardAbortedTurn(userModelMessage);
            yield { type: "done" };
            return;
          }

          let emptyStepRetry = false;
          let leakedStep = false;
          if (lastStepToolCalls === 0 && LEAKED_TOOL_MARKUP_RE.test(assistantText)) {
            // The "reply" is an unparsed tool call; retry the step rather than present it.
            lastStepProducedOutput = false;
            leakedStep = true;
            this.kernel?.recordObservation(
              "Model step returned tool-call markup as text; treating it as a failed step.",
            );
          }
          try {
            const response = interruption ? null : ((await stream.response) as { messages: ModelMessage[] });
            if (response && !signal.aborted) {
              const roundMessages = sanitizeModelMessages(response.messages);
              // An assistant step that produced neither text nor a tool call is not a result —
              // it is a provider or model failure (seen live 2026-09-17: an upstream provider
              // consumed 47 completion tokens of a tool call, returned an empty "stop" delta, and
              // the turn silently ended as if finished). Keep the round's real work, drop the
              // empty reply, and ask again; only repeated failures end the turn, and visibly.
              if (!lastStepProducedOutput && emptyResponseRetries < MAX_EMPTY_RESPONSE_RETRIES) {
                emptyResponseRetries += 1;
                const kept = leakedStep
                  ? dropTrailingAssistantMessage(roundMessages)
                  : dropTrailingEmptyAssistantMessage(roundMessages);
                if (kept.length > 0) this.appendCompletedTurn(userModelMessage, kept);
                this.kernel?.recordObservation(
                  `Model step ended with no output (finish: ${lastStepFinishReason ?? "unknown"}); retrying (${emptyResponseRetries}/${MAX_EMPTY_RESPONSE_RETRIES}).`,
                );
                this.persistKernelIndex();
                if (emptyResponseRetries > 1) {
                  this.messages.push({ role: "user", content: EMPTY_RESPONSE_CONTINUATION });
                  this.messageSeqs.push(null);
                }
                emptyStepRetry = true;
              } else {
                this.appendCompletedTurn(userModelMessage, roundMessages);
                reportStatus("recap", "Saving session state");
                await this.refreshSessionRecap(signal);
                this.kernel?.transition("reflect");
                // A turn that changed files stops at the host-owned review phase; the completion
                // gate below decides whether it may end. A turn that changed nothing has nothing
                // left for the host to verify.
                if ((this.kernel?.snapshot().mutations.length ?? 0) > 0) {
                  this.kernel?.transition("review");
                } else {
                  this.kernel?.evaluateCompletion({ verificationPassed: true, reviewPassed: true });
                }
                streamOk = true;
              }
            }
          } catch (responseError: unknown) {
            if (
              !assistantText.trim() &&
              modelInfo &&
              isContextLimitError(responseError) &&
              this.escalateOverflowRecovery(overflowRecoveryLevel + 1)
            ) {
              overflowRecoveryLevel += 1;
              continue;
            }

            // A stream can yield text and still fail while resolving its final response
            // (network reset, provider timeout, or malformed final metadata). Do not let that
            // failure fall through to the completion gate as if the turn finished normally; it
            // is an interruption, recovered below, unless the user cancelled or the credential
            // was rejected.
            if (signal.aborted || isRejectedCredentialError(responseError)) throw responseError;
            interruption = { reason: describeInterruption(responseError), error: responseError };
          }

          if (signal.aborted) {
            this.kernel?.cancel();
            this.persistKernelIndex();
            this.discardAbortedTurn(userModelMessage);
            yield { type: "done" };
            return;
          }

          if (interruption) {
            const outcome = yield* this.recoverFromInterruption({
              ...interruption,
              state: interruptions,
              provider,
              modelId: runtime.modelId,
              userModelMessage,
              completedSteps: completedStepMessages,
              signal,
            });
            if (outcome.action === "switch") switchModel(outcome.modelId);
            if (outcome.action !== "pause") continue;
            const moved = yield* this.continueOnProviderFallback({
              cause: outcome.message,
              modelId: runtime.modelId,
              signal,
            });
            if (moved) {
              adoptProvider(moved);
              continue;
            }
            yield* this.pauseAfterInterruptions(outcome.message, observer, interruptions);
            return;
          }

          if (emptyStepRetry) continue;

          if (!streamOk && assistantText.trim()) {
            this.appendCompletedTurn(userModelMessage, [{ role: "assistant", content: assistantText }]);
            reportStatus("recap", "Saving session state");
            await this.refreshSessionRecap(signal);
          }

          // Completion/verification gate (docs/architecture/14-AGENT-HARNESS-RECONSTRUCTION.md §9):
          // a coding turn that mutated a file (a plan is optional: no file tool requires
          // generate_plan first) but never made any verification-
          // shaped tool call is not evidence of a working result — it is the model's own
          // unverified claim. Reproduced live 2026-09-13: a headless clock task wrote files,
          // re-read its own source, stopped the dev server it had started, and reported "Done."
          // with zero acceptance criteria actually checked. This is deterministic (§11 of the
          // brief): it gates on whether a real tool call happened, not on an LLM's self-report.
          // `activeAcceptanceCriteria` is session-scoped (§14 Phase 2 item 1) — a plan published
          // turns ago still governs this turn's mutations — so the mutation check below is load-
          // bearing: without it, ANY later coding-classified turn (even one that reads a file and
          // answers a question, mutating nothing) would be wrongly gated just because an earlier
          // turn once published criteria.
          if (!lastStepProducedOutput && !assistantText.trim()) {
            const reason = `The model returned an empty response ${emptyResponseRetries + 1} times in a row.`;
            // A model that keeps answering with nothing is as unavailable as one that is down.
            const fallback = nextFallbackModel(provider, runtime.modelId, interruptions);
            if (fallback) {
              this.kernel?.recordObservation(`${reason} Continuing with ${fallback}.`);
              this.persistKernelIndex();
              yield {
                type: "content",
                content: `\n\n[${runtime.modelId} kept returning empty replies; continuing with ${fallback} (${describeModelCost(provider, fallback)}).]\n\n`,
              };
              this.messages.push({ role: "user", content: EMPTY_RESPONSE_CONTINUATION });
              this.messageSeqs.push(null);
              switchModel(fallback);
              continue;
            }
            this.kernel?.recordObservation(reason);
            this.kernel?.evaluateCompletion({ verificationPassed: false, reviewPassed: false });
            this.persistKernelIndex(reason);
            yield {
              type: "content",
              content: `\n\n${this.endNote(`[No response — ${reason} Try again, or switch models with /models.]`)}`,
            };
            yield { type: "done" };
            return;
          }

          // Every file the turn changed, by the file tools or any other way (a shell command, a code
          // generator): the workspace is read again and compared with its state at the turn's start.
          const cwd = turnStartWorkspace;
          const endState = turnStartState ? captureWorkspaceState(cwd) : null;
          // The ledger's own files are the host's record of the user's answers, not work to verify.
          // A file the ledger wrote stays exempt only while it still holds what the ledger left there: an edit
          // after it (a shell command flipping a proposal to active, say) is the turn's own change.
          const ledgerWrite = (path: string) => {
            const file = path.replaceAll("\\", "/");
            return (
              this.turnLedgerWrites.has(file) && readTextOrNull(join(cwd, file)) === this.turnLedgerWrites.get(file)
            );
          };
          const mutations = mergeChangedFiles(
            cwd,
            this.kernel?.snapshot().mutations ?? [],
            (turnStartState && endState && changedPaths(turnStartState, endState)) ?? [],
          ).filter((path) => !ledgerWrite(path));
          const mutatedThisTurn = mutations.length > 0;
          // A passing check vouches only for the code it ran against: anything changed after it,
          // through a file tool or the shell, needs the checks to run again.
          const changedAfterCheck = lastPassingCheck
            ? mergeChangedFiles(
                cwd,
                turnMutationEvents > lastPassingCheck.mutationEvents ? (this.kernel?.snapshot().mutations ?? []) : [],
                (endState && changedPaths(lastPassingCheck.state, endState)) ?? [],
              ).filter((path) => !ledgerWrite(path))
            : [];
          const staleEvidence =
            mutatedThisTurn &&
            lastPassingCheck !== null &&
            (turnMutationEvents > lastPassingCheck.mutationEvents || changedAfterCheck.length > 0);
          // A fix made in answer to the requirement audit is as unverified as the first write
          // until something runs again.
          const unverifiedSinceAudit =
            staleEvidence ||
            (requirementAudit !== null &&
              turnMutationEvents > requirementAudit.mutations &&
              this.turnVerificationEvidence.length === requirementAudit.evidence);
          // Nothing runs a document, and a code check says nothing about what one states. A turn
          // that only wrote documents is asked once to check its facts, then reported unverified
          // whatever else ran (live 2026-09-23: pressed three times for a command, a model wrote a
          // copy of its own report as "evidence"; asked once, it ran the type-check).
          const documentsOnly =
            mutatedThisTurn && !unverifiedSinceAudit && mutations.every((path) => DOCUMENT_FILE_RE.test(path));

          // An honest exit (audit doc 15, Phase 1.5): the agent said the task cannot be done as asked.
          if (turnBlocker) {
            this.kernel?.evaluateCompletion({ verificationPassed: false, reviewPassed: false });
            this.persistKernelIndex(turnBlocker);
            const verdict = `[Stopped — ${turnBlocker}]`;
            this.recordVerdict(verdict);
            yield { type: "content", content: `\n\n${verdict}` };
            yield { type: "done" };
            return;
          }

          // Test protection (audit doc 15, Phase 1.5): tests that existed before the turn are part of what
          // "done" means. Changing them is how a check gets gamed, unless the request asks for it.
          const changedTests =
            this.mode === "agent" &&
            !this.ablations.has("gate") &&
            mutatedThisTurn &&
            turnStartState !== null &&
            endState !== null &&
            !requestAllowsTestEdits(userMessage)
              ? (changedPaths(turnStartState, endState) ?? []).filter(
                  (path) => isTestFile(path) && existedAt(turnStartState, cwd, path),
                )
              : [];
          if (changedTests.length > 0) {
            if (!testEditsNudged) {
              testEditsNudged = true;
              this.messages.push({
                role: "user",
                content: [
                  `Completion blocked: you changed tests that existed before this request: ${changedTests.join(", ")}.`,
                  "The request does not ask for test changes. Restore them and make the code pass the original tests. If a test itself is wrong, stop and say so with report_blocker instead of changing it.",
                ].join("\n"),
              });
              this.messageSeqs.push(null);
              this.kernel?.recordObservation(`Test protection: existing tests changed (${changedTests.join(", ")}).`);
              this.persistKernelIndex("Existing tests were changed");
              continue;
            }
            const reason = `it changed tests that existed before this request and the request did not ask to change: ${changedTests.join(", ")}.`;
            this.kernel?.evaluateCompletion({ verificationPassed: false, reviewPassed: false });
            this.persistKernelIndex(reason);
            const verdict = `[Not verified — ${reason}]`;
            this.recordVerdict(verdict);
            yield { type: "content", content: `\n\n${verdict}` };
            yield { type: "done" };
            return;
          }

          // The checks that decide "done" are the ones the turn started with (audit doc 17, S10): what a check
          // runs (its scripts, recipe, tooling and runner settings) may only change when the request asks for it,
          // or by adding to it. A turn that rewrote one would otherwise be judged by the check it wrote.
          const checkChanges =
            this.mode === "agent" && !this.ablations.has("gate") && turnStartChecks.length > 0
              ? changedCheckDefinitions(turnStartChecks, turnStartWorkspace, allowedCheckKinds)
              : [];
          // The carry clears only when the checks are as the turn found them and no new check source appeared (a
          // command-table row, a script that now takes precedence): those take effect when a request allows them.
          if (
            this.mode === "agent" &&
            checkChanges.length === 0 &&
            addedCheckSources(turnStartChecks, turnStartWorkspace, allowedCheckKinds).length === 0
          ) {
            this.checkBaselineCarry = null;
          }
          const changedChecks = mutatedThisTurn ? checkChanges.map((change) => change.description) : [];
          // Only a change the turn's own file edits made is sent back to it: read from each file as it was before the
          // turn first wrote it, so a script another session, the user's editor, a merge or a shell command changed is
          // reported, not undone, even when the turn then wrote the same file for another reason.
          const journal = this.attemptJournal.beforeTurn();
          const beforeTurnWrite = (file: string): string | null | undefined => {
            const entry = journal.find(([path]) => {
              const folded = foldPath(path);
              return folded === foldPath(file) || folded.endsWith(`/${foldPath(file)}`);
            })?.[1];
            if (!entry) return undefined;
            return entry.previousExisted ? entry.previousContent : null;
          };
          const ownCheckChange =
            mutatedThisTurn &&
            checkChanges.some((change) => changeMadeByTurn(change, turnStartWorkspace, beforeTurnWrite));
          if (changedChecks.length > 0) {
            if (ownCheckChange && !checkEditsNudged) {
              checkEditsNudged = true;
              this.messages.push({
                role: "user",
                content: [
                  `Completion blocked: you changed the checks this project uses to decide "done": ${changedChecks.join("; ")}.`,
                  "The request does not ask for that. Restore them as they were and make the code pass them. If the request really needs a check changed, stop and say so with report_blocker instead.",
                ].join("\n"),
              });
              this.messageSeqs.push(null);
              this.kernel?.recordObservation(`The turn changed the project's checks (${changedChecks.join("; ")}).`);
              this.persistKernelIndex("The project's checks were changed");
              continue;
            }
            const reason = ownCheckChange
              ? `it changed the checks that decide "done" and the request did not ask to: ${changedChecks.join("; ")}. If the change is intended, say "keep the check changes" in the next request.`
              : `the checks that decide "done" changed during this turn outside its own file edits: ${changedChecks.join("; ")}. Shelra does not judge the work by a changed check; if the change is intended, say "keep the check changes" in the next request.`;
            this.kernel?.evaluateCompletion({ verificationPassed: false, reviewPassed: false });
            this.persistKernelIndex(reason);
            const verdict = `[Not verified — ${reason}]`;
            this.recordVerdict(verdict);
            yield { type: "content", content: `\n\n${verdict}` };
            yield { type: "done" };
            return;
          }

          // Decision records are the user's: only a proposal the user approves changes one (the ledger's own
          // writes are left out). An edit by the turn, through a file tool or the shell, could weaken a check or
          // mark a proposal active. The gate ignores it (it checks `turnDecisions`), and here it is sent back
          // like a change to existing tests, unless the request names the decision. A record is known by the
          // ledger (whatever its file is called, in whatever case the path was written), and read from the
          // workspace as it is now, so a record the turn put back as it was no longer counts.
          const guardsLedger = this.mode === "agent" && !this.ablations.has("gate") && !this.ablations.has("ledger");
          const onDisk =
            (turnStartState && endState && changedPaths(turnStartState, endState))?.filter(
              (path) => !ledgerWrite(path),
            ) ?? mutations;
          const writtenByTools = new Set((this.kernel?.snapshot().mutations ?? []).map((path) => foldPath(path)));
          const recordIdOf = (path: string): string | null => {
            const before = this.turnStartLedger.get(foldPath(path));
            if (before) return before.id;
            if (!inLedgerDir(path) || !/\.md$/iu.test(path)) return null;
            return parseDecision(readTextOrNull(join(cwd, path)) ?? "", basename(path))?.id ?? decisionIdOfFile(path);
          };
          // A proposal that became active (or was removed) with nothing else changed, and not through a file
          // tool: most likely the user's `shelra decisions approve` in another terminal, which the turn must
          // not be told to undo.
          const approvedElsewhere = (path: string): boolean => {
            const before = this.turnStartLedger.get(foldPath(path));
            if (!before || before.status !== "proposed" || writtenByTools.has(foldPath(path))) return false;
            const text = readTextOrNull(join(cwd, path));
            if (text === null) return true;
            const now = parseDecision(text, basename(path));
            return now !== null && now.status === "active" && sameDecisionContent(before, now);
          };
          const touchedRecords = guardsLedger
            ? onDisk.flatMap((path) => {
                const id = recordIdOf(path);
                return id !== null && !requestNamesDecision(userMessage, id, path) ? [{ path, id }] : [];
              })
            : [];
          const changedDecisions = touchedRecords
            .filter((record) => !approvedElsewhere(record.path))
            .map((record) => record.path);
          const decidedElsewhere = touchedRecords.filter((record) => approvedElsewhere(record.path));
          if (changedDecisions.length === 0 && decidedElsewhere.length > 0) {
            const ids = decidedElsewhere.map((record) => record.id).join(", ");
            const reason = `${ids} changed during this turn outside propose_decision, so Shelra did not hold this turn to ${decidedElsewhere.length === 1 ? "it" : "them"}; if you did not approve that, check \`shelra decisions list\`.`;
            this.kernel?.evaluateCompletion({ verificationPassed: false, reviewPassed: false });
            this.persistKernelIndex(reason);
            const verdict = `[Not verified — ${reason}]`;
            this.recordVerdict(verdict);
            yield { type: "content", content: `\n\n${verdict}` };
            yield { type: "done" };
            return;
          }
          if (changedDecisions.length > 0) {
            if (!decisionEditsNudged) {
              decisionEditsNudged = true;
              this.messages.push({
                role: "user",
                content: [
                  `Completion blocked: you changed the project's decision records: ${changedDecisions.join(", ")}.`,
                  "Only the user changes a decision. Restore those files as they were. If a decision should change, propose the change with propose_decision, naming the decision it supersedes, and let the user approve it.",
                ].join("\n"),
              });
              this.messageSeqs.push(null);
              this.kernel?.recordObservation(`Decision records changed by the turn (${changedDecisions.join(", ")}).`);
              this.persistKernelIndex("Decision records were changed");
              continue;
            }
            const reason = `it changed decision records that only the user may change: ${changedDecisions.join(", ")}.`;
            this.kernel?.evaluateCompletion({ verificationPassed: false, reviewPassed: false });
            this.persistKernelIndex(reason);
            const verdict = `[Not verified — ${reason}]`;
            this.recordVerdict(verdict);
            yield { type: "content", content: `\n\n${verdict}` };
            yield { type: "done" };
            return;
          }

          // The task contract (audit doc 15, Phase 1.3–1.4): when the project states its checks, or the plan
          // gave a command that failed before the change, the host decides "done" by running them on the
          // final code, instead of accepting any check at all.
          const contractApplies =
            this.mode === "agent" &&
            !this.ablations.has("gate") &&
            !this.ablations.has("contract") &&
            mutatedThisTurn &&
            !documentsOnly;
          // Decisions the user approved whose files this turn changed: their checks join the contract (the
          // ledger's phase 3), so a change that breaks one cannot be reported as done.
          const governing =
            contractApplies && !this.ablations.has("ledger")
              ? this.turnDecisions.filter(
                  (decision) => decision.check !== undefined && mutations.some((path) => inScope(path, decision.scope)),
                )
              : [];
          const brokenDecisions = (command: string) =>
            governing.filter(
              (decision) => decision.check !== undefined && isSameCheck(command, { command: decision.check }),
            );
          // Judged by the checks the turn started with, in the folder it started in (a `cd` or a check source the
          // turn added does not move them); a kind the request asked to change is judged as it is now.
          const judgedBy: DiscoveredCheck[] = [
            ...turnStartChecks
              .filter((check) => !allowedCheckKinds.has(check.kind))
              .map(({ kind, command, source, runs }) => ({ kind, command, source, ...(runs ? { runs } : {}) })),
            ...discoverChecks(turnStartWorkspace).filter((check) => allowedCheckKinds.has(check.kind)),
          ];
          const baseContract: ContractCheck[] = contractApplies
            ? [
                ...contractChecks(judgedBy),
                ...(this.activeAcceptanceCriteria ?? []).flatMap((criterion): ContractCheck[] =>
                  criterion.command && criterion.commandBefore !== "passed"
                    ? [{ kind: "task", command: criterion.command, source: `plan ${criterion.id}` }]
                    : [],
                ),
              ]
            : [];
          const contract: ContractCheck[] = [
            ...baseContract,
            // A decision whose check is already one of the project's checks runs once, under that check.
            ...governing.flatMap((decision): ContractCheck[] =>
              decision.check && !baseContract.some((check) => isSameCheck(decision.check as string, check))
                ? [{ kind: "decision", command: decision.check, source: decision.id }]
                : [],
            ),
          ].filter(
            // One command is one check, however many criteria name it: five plan criteria with the same command were
            // run and reported five times (seen live 2026-09-25).
            (check, index, all) => all.findIndex((other) => isSameCheck(check.command, other)) === index,
          );
          if (contract.length > 0) {
            const results = await evaluateTurnContract({
              checks: contract,
              runs: checkRuns.map((run) => ({
                command: run.command,
                passed: run.passed,
                detail: run.detail,
                fresh:
                  foldPath(run.cwd) === foldPath(turnStartWorkspace) &&
                  run.mutationEvents === turnMutationEvents &&
                  run.state !== null &&
                  endState !== null &&
                  changedPaths(run.state, endState)?.length === 0,
                beforeFirstChange:
                  foldPath(run.cwd) === foldPath(turnStartWorkspace) &&
                  run.mutationEvents === 0 &&
                  run.state !== null &&
                  turnStartState !== null &&
                  changedPaths(turnStartState, run.state)?.length === 0,
                ...(run.unrunnable ? { unrunnable: run.unrunnable } : {}),
              })),
              workspace: turnStartWorkspace,
              runCheck: (command, options) => {
                reportStatus("checks", `Running \`${command}\` on the final code`);
                return this.checkRunner(command, options);
              },
              timeoutMs: CONTRACT_CHECK_TIMEOUT_MS,
              signal,
            });
            // The host's own runs count as runs: unless something changes, they need not run again.
            const stateAfterChecks = captureWorkspaceState(cwd);
            for (const result of results.filter((item) => item.by === "host")) {
              checkRuns.push({
                command: result.check.command,
                passed: result.passed,
                detail: result.detail,
                mutationEvents: turnMutationEvents,
                state: stateAfterChecks,
                cwd: turnStartWorkspace,
                ...(result.unrunnable ? { unrunnable: result.unrunnable } : {}),
              });
            }
            const failing = results.filter((result) => !result.passed);
            contractPassed = failing.length === 0;
            if (failing.length === 0) {
              for (const result of results) {
                this.turnVerificationEvidence.push(
                  `${result.check.command} passed (${result.by === "host" ? "run by Shelra" : "a fresh run, reused"})`,
                );
              }
              if (results.some((result) => result.by === "host")) {
                const note = `[Checked by Shelra on the final code: ${results
                  .map((result) => `\`${result.check.command}\` passed`)
                  .join(", ")}]`;
                this.recordVerdict(note);
                yield { type: "content", content: `\n\n${note}` };
              }
            } else if (verificationRetries < MAX_VERIFICATION_RETRIES) {
              verificationRetries += 1;
              // Evidence-driven repair (audit doc 15, Phase 2.1-2.4): name what failed and where, say when
              // a failure is a regression, and notice an attempt that changed code but not the failures.
              const signature = failing
                .map((result) => `${result.check.command}\n${failureSignature(result.detail)}`)
                .sort()
                .join("\n\n");
              const changedSinceLastFailure =
                lastContractFailure !== null &&
                (turnMutationEvents > lastContractFailure.mutationEvents ||
                  (lastContractFailure.state !== null &&
                    stateAfterChecks.kind !== "unknown" &&
                    (changedPaths(lastContractFailure.state, stateAfterChecks)?.length ?? 1) > 0));
              const repeated = changedSinceLastFailure && lastContractFailure?.signature === signature;
              // An attempt that broke a check which passed before it (audit doc 15, Phase 2.3): say which files
              // it changed and offer restore_file. Nothing is undone unless the model asks (owner, 2026-09-23).
              const previousResults = lastContractResults;
              const brokeByLastAttempt = (command: string) => previousResults?.get(command) === true;
              const regression = failing.some(
                (result) =>
                  brokeByLastAttempt(result.check.command) || (previousResults === null && result.passedBefore),
              );
              const endedAttempt = this.attemptJournal.current;
              const attemptStart = lastContractFailure?.state ?? turnStartState;
              const byFileTools = this.attemptJournal.changedIn(endedAttempt);
              const attemptChanged = [
                ...new Set([
                  ...byFileTools,
                  ...((attemptStart &&
                    stateAfterChecks.kind !== "unknown" &&
                    changedPaths(attemptStart, stateAfterChecks)) ||
                    []),
                ]),
              ].sort();
              const otherwiseChanged = attemptChanged.filter((path) => !byFileTools.includes(path));
              this.attemptJournal.nextAttempt();
              lastContractResults = new Map(results.map((result) => [result.check.command, result.passed]));
              lastContractFailure = { signature, mutationEvents: turnMutationEvents, state: stateAfterChecks };
              if (repeated) repairEscalated = true;
              const fileList = (paths: readonly string[]) =>
                `${paths
                  .slice(0, 10)
                  .map((path) => `\`${path}\``)
                  .join(", ")}${paths.length > 10 ? ` and ${paths.length - 10} more` : ""}`;
              const nudge = [
                "Completion blocked: the project's own checks fail on your final code (Shelra ran them after your last change):",
                ...failing.map((result) => {
                  const note = brokeByLastAttempt(result.check.command)
                    ? " (it passed after your previous attempt: your last attempt broke it)"
                    : result.passedBefore
                      ? " (it passed before your first change: your change broke it)"
                      : result.failedBefore
                        ? " (it already failed before your first change)"
                        : "";
                  const governed = brokenDecisions(result.check.command);
                  const names = governed.map((decision) => `${decision.id} (${decision.title})`).join(", ");
                  const decisionNote =
                    governed.length === 0
                      ? ""
                      : result.unrunnable
                        ? ` It is the check of ${names}, and it could not run, so it says nothing about your change.`
                        : ` It enforces ${names}, a decision the user approved.`;
                  return `- \`${result.check.command}\`${note}:${decisionNote}\n${describeFailures(result.detail)}`;
                }),
                ...(failing.some((result) => !result.unrunnable && brokenDecisions(result.check.command).length > 0)
                  ? [
                      "Your change breaks a decision the user approved. Restore what the decision requires; if the decision itself should change, say so and propose a superseding decision with propose_decision. Never weaken or skip its check.",
                    ]
                  : []),
                ...(failing.some((result) => result.unrunnable && brokenDecisions(result.check.command).length > 0)
                  ? [
                      "A decision's check could not run (it timed out, or its script, command or tool is missing). Do not revert your change for it: make the check runnable if that is part of the task, or tell the user what is missing.",
                    ]
                  : []),
                ...(regression && byFileTools.length > 0
                  ? [
                      `Your last attempt changed ${fileList(byFileTools)}${
                        otherwiseChanged.length > 0
                          ? `, and ${fileList(otherwiseChanged)} outside the file tools, which restore_file cannot undo`
                          : ""
                      }. If that attempt went the wrong way, restore_file puts a file back as it was before it; nothing is undone unless you ask.`,
                    ]
                  : regression && otherwiseChanged.length > 0
                    ? [
                        `Your last attempt changed ${fileList(otherwiseChanged)} outside the file tools; restore_file cannot undo those.`,
                      ]
                    : []),
                ...(repeated
                  ? [
                      "Your last attempt changed code, but the same checks fail in the same way: that approach did not work. Re-read the failures above and test your assumption before changing more code.",
                    ]
                  : []),
                "Fix what your change broke and run the checks again. If a failure predates this request and has nothing to do with it, say so plainly instead of changing unrelated code.",
              ].join("\n");
              this.messages.push({ role: "user", content: nudge });
              this.messageSeqs.push(null);
              this.kernel?.recordObservation(
                `Task contract: ${failing.length} project check(s) fail on the final code (attempt ${verificationRetries}/${MAX_VERIFICATION_RETRIES})${repeated ? "; same failures after a change, escalating effort" : ""}.`,
              );
              this.persistKernelIndex(`Project checks failing: ${failing.map((r) => r.check.command).join(", ")}`);
              continue;
            } else {
              const olderThanTurn = failing.every((result) => result.failedBefore);
              const decisionsOf = (unrunnable: boolean) => [
                ...new Set(
                  failing
                    .filter((result) => Boolean(result.unrunnable) === unrunnable)
                    .flatMap((result) => brokenDecisions(result.check.command)),
                ),
              ];
              const violated = decisionsOf(false);
              const unchecked = decisionsOf(true);
              const reason = `${failing.map((result) => `\`${result.check.command}\``).join(", ")} ${
                failing.length === 1 ? "fails" : "fail"
              } on the final code${olderThanTurn ? ", as before this turn" : ""}, after ${verificationRetries} automatic request(s).${
                violated.length > 0
                  ? ` This breaks ${violated.map((decision) => `${decision.id} (${decision.title})`).join(", ")}: revert the change, or approve a decision that supersedes ${violated.length === 1 ? "it" : "them"}.`
                  : ""
              }${
                unchecked.length > 0
                  ? ` The check of ${unchecked.map((decision) => `${decision.id} (${decision.title})`).join(", ")} could not run, so nothing vouches for ${unchecked.length === 1 ? "that decision" : "those decisions"}.`
                  : ""
              }`;
              this.kernel?.evaluateCompletion({ verificationPassed: false, reviewPassed: false });
              this.persistKernelIndex(reason);
              // The memories this turn was given did not lead to passing checks (audit doc 15, M3).
              if (!this.ablations.has("memory")) creditMemoryUse(memoryScope, memoryContext.expanded, -1);
              const verdict = `[Not verified — ${reason}]`;
              this.recordVerdict(verdict);
              yield { type: "content", content: `\n\n${verdict}` };
              // A turn whose checks still fail teaches too: what fails, and what did not work (audit doc 15, M4).
              reportStatus("recap", "Updating project memory");
              await this.learnFromTurn(
                {
                  userMessage,
                  assistantText: `${turnText.slice(-12_000)}\n\n${verdict}`,
                  changedFiles: [...mutations],
                  commands: [
                    ...turnCommands,
                    ...failing.map((result) => ({
                      command: result.check.command,
                      success: false,
                      output: result.detail,
                    })),
                  ],
                  verified: false,
                  endedUnverified: true,
                  toolCalls: turnToolCalls,
                },
                runtime.modelId,
                signal,
                observer,
                "unverified",
              );
              yield { type: "done" };
              return;
            }
          }

          if (
            contract.length === 0 &&
            !this.ablations.has("gate") &&
            mutatedThisTurn &&
            (documentsOnly || this.turnVerificationEvidence.length === 0 || unverifiedSinceAudit)
          ) {
            const criteria = this.activeAcceptanceCriteria ?? [];
            const criteriaList = criteria
              .map((c) => `- ${c.id}: ${c.description} (verify: ${c.verification})`)
              .join("\n");
            const maxRetries = documentsOnly ? 1 : MAX_VERIFICATION_RETRIES;

            if (verificationRetries < maxRetries) {
              verificationRetries += 1;
              const blockedLine = [
                staleEvidence && lastPassingCheck
                  ? `Completion blocked: you changed ${
                      changedAfterCheck.length > 0 ? changedAfterCheck.slice(0, 10).join(", ") : "files"
                    } after your last passing check (${lastPassingCheck.evidence}), so that check says nothing about the final code. Run the checks again now.`
                  : unverifiedSinceAudit
                    ? "Completion blocked: you changed files after your last verification run and nothing has run since."
                    : criteria.length > 0
                      ? "Completion blocked: none of your stated acceptance criteria have been verified yet."
                      : `Completion blocked: you changed ${mutations.length} file(s) but ran no verification.`,
                ...(maskedChecks.size > 0
                  ? [
                      `Not counted: ${[...maskedChecks].map((check) => `\`${check}\``).join(", ")}. After a pipe, \`;\`, \`||\` or a line break the exit code is the next command's, not the check's. Run the check on its own; long output is shortened for you.`,
                    ]
                  : []),
              ].join("\n");
              const nudge = documentsOnly
                ? [
                    "Completion blocked: you only wrote documents, and re-reading them is not verification.",
                    "Check what they state instead: grep the code for each claim about it, open each source you cite, and run the project's docs check if it has one (a docs build, a Markdown or link linter). Correct what is wrong, then report what you checked, and say plainly which statements you could not check.",
                    criteriaList ? `Acceptance criteria:\n${criteriaList}` : `Written: ${mutations.join(", ")}`,
                  ].join("\n")
                : criteria.length > 0
                  ? [
                      blockedLine,
                      "You wrote files and re-reading them is not verification — actually perform the verification method for each criterion below (make a real request, run the real command, observe the real output), then report what you actually observed for each one:",
                      criteriaList,
                    ].join("\n")
                  : [
                      blockedLine,
                      "Run the project's real checks for what you changed (its tests, build, type-check, or a real request against the running app), fix anything that fails, then report exactly which commands you ran and what they printed.",
                      `Changed: ${mutations.join(", ")}`,
                    ].join("\n");
              this.messages.push({ role: "user", content: nudge });
              this.messageSeqs.push(null);
              this.kernel?.recordObservation(
                `Completion gate: no verification evidence after changing ${mutations.length} file(s); requesting real verification (attempt ${verificationRetries}/${maxRetries}).`,
              );
              this.persistKernelIndex(`Awaiting verification for ${mutations.length} changed file(s)`);
              continue;
            }

            const reason = documentsOnly
              ? `${mutations.length} document(s) written, and no check can run a document.`
              : criteria.length > 0
                ? `No verification action was observed for ${criteria.length} acceptance criteria after ${verificationRetries} automatic request(s).`
                : `No verification action was observed after ${mutations.length} file(s) changed and ${verificationRetries} automatic request(s).`;
            const advice = documentsOnly
              ? "Review them before relying on them."
              : "Run the relevant checks yourself, or ask me to, before treating this as done.";
            this.kernel?.evaluateCompletion({ verificationPassed: false, reviewPassed: false });
            this.persistKernelIndex(reason);
            const verdict = `[Not verified — ${reason} ${advice}${criteriaList ? `\n${criteriaList}` : ""}]`;
            this.recordVerdict(verdict);
            yield { type: "content", content: `\n\n${verdict}` };
            yield { type: "done" };
            return;
          }

          if (
            !this.ablations.has("gate") &&
            !this.ablations.has("audit") &&
            mutatedThisTurn &&
            requirementChecklist.length > 0 &&
            requirementAudit === null
          ) {
            requirementAudit = { mutations: turnMutationEvents, evidence: this.turnVerificationEvidence.length };
            const audit = [
              "Before you finish, audit the request requirement by requirement. It states:",
              ...requirementChecklist.map((requirement, index) => `${index + 1}. ${requirement}`),
              "For each numbered item, list every distinct behavior it names. For each behavior, name the code that implements it and the test or command that exercised exactly that behavior, with the output you observed. A behavior nothing exercised is unverified: exercise it now with a real run (a scratch script you delete afterwards, or a new test file when the request allows adding tests; never edit existing tests), fix what fails, run again, and only then report. Do not report done while any stated behavior is unverified.",
            ].join("\n");
            this.messages.push({ role: "user", content: audit });
            this.messageSeqs.push(null);
            this.kernel?.recordObservation(
              `Requirement audit requested for ${requirementChecklist.length} stated requirement(s).`,
            );
            this.persistKernelIndex("Auditing the stated requirements");
            continue;
          }

          const stopInput: StopHookInput = {
            hook_event_name: "Stop",
            session_id: this.session?.id,
            cwd: this.bash.getCwd(),
          };
          const stopResult = await this.fireHook(stopInput, signal).catch(() => null);

          // A Stop hook can refuse to let this turn count as finished (exit code 2, or
          // JSON {decision:"block"}/{continue:false}) — the same contract PreToolUse already
          // enforces before a tool runs. Previously this result was awaited and discarded, so
          // a configured Stop hook could never actually prevent completion; it only observed.
          if (stopResult && (stopResult.blocked || stopResult.preventContinuation)) {
            const reason =
              stopResult.blockingErrors[0]?.stderr?.trim() ||
              stopResult.stopReason ||
              "A Stop hook declined to let this turn complete.";
            this.kernel?.recordObservation(`Stop hook blocked completion: ${reason}`);
            this.kernel?.evaluateCompletion({ verificationPassed: false, reviewPassed: false });
            this.persistKernelIndex(reason);
            this.recordVerdict(`[Not marked complete — ${reason}]`);
            yield { type: "content", content: `\n\n[Not marked complete — ${reason}]` };
            yield { type: "done" };
            return;
          }

          this.persistKernelIndex();
          // The memories this turn was given were there when the project's checks passed (audit doc 15, M3).
          if (contractPassed && !this.ablations.has("memory")) creditMemoryUse(memoryScope, memoryContext.expanded, 1);
          // An entry that names a command which passed in this turn is current again (audit doc 15, M2).
          if (!this.ablations.has("memory")) {
            reconfirmByPassingCommands(memoryScope, [
              ...turnCommands.filter((command) => command.success).map((command) => command.command),
              ...checkRuns.filter((run) => run.passed).map((run) => run.command),
            ]);
          }
          // Learning after acting: a verified change, a failure that was worked through, or a
          // substantial investigation becomes durable project memory through the write gate.
          reportStatus("recap", "Updating project memory");
          await this.learnFromTurn(
            {
              userMessage,
              assistantText: turnText.slice(-12_000),
              changedFiles: [...mutations],
              commands: turnCommands,
              verified: this.turnVerificationEvidence.length > 0,
              toolCalls: turnToolCalls,
            },
            runtime.modelId,
            signal,
            observer,
            this.turnVerificationEvidence.length > 0 ? "verified" : "answered",
          );
          yield { type: "done" };
          return;
        } catch (err: unknown) {
          if (signal.aborted) {
            this.kernel?.cancel();
            this.persistKernelIndex();
            this.discardAbortedTurn(userModelMessage);
            yield { type: "content", content: `\n\n${this.endNote("[Cancelled]")}` };
            yield { type: "done" };
            return;
          }

          if (
            !assistantText.trim() &&
            modelInfo &&
            isContextLimitError(err) &&
            this.escalateOverflowRecovery(overflowRecoveryLevel + 1)
          ) {
            overflowRecoveryLevel += 1;
            continue;
          }

          // Whatever failed before the round completed (compaction, a spend limit on the current
          // model, a provider that threw, a stream that broke) is recovered like any other
          // interruption: completed steps are kept and the turn retries or moves to a fallback.
          if (!streamOk && !isRejectedCredentialError(err)) {
            const reason = describeInterruption(err);
            const outcome = yield* this.recoverFromInterruption({
              reason,
              error: err,
              state: interruptions,
              provider,
              modelId: runtime.modelId,
              userModelMessage,
              completedSteps: completedStepMessages,
              signal,
            });
            if (outcome.action === "switch") switchModel(outcome.modelId);
            if (outcome.action !== "pause") continue;
            const moved = yield* this.continueOnProviderFallback({
              cause: outcome.message,
              modelId: runtime.modelId,
              signal,
            });
            if (moved) {
              adoptProvider(moved);
              continue;
            }
            yield* this.pauseAfterInterruptions(outcome.message, observer, interruptions);
            return;
          }

          if (!streamOk && isRejectedCredentialError(err)) {
            const fallback = yield* this.continueOnCredentialFallback({
              error: err,
              modelId: runtime.modelId,
              userModelMessage,
              completedSteps: completedStepMessages,
              signal,
            });
            if (fallback) {
              adoptProvider(fallback);
              continue;
            }
          }

          const authError = isAuthenticationError(err);
          const friendly = humanizeApiError(err);
          this.kernel?.recordObservation(friendly);
          this.kernel?.transition("blocked");
          // `transition()` moves the in-memory phase but does not set a blockedReason (only
          // `evaluateCompletion`/`cancel` do) — without this, a real failure (rate limit,
          // provider error, auth error) left the persisted objectives row silently stale at
          // whatever phase the turn was in before it failed, i.e. querying "what happened"
          // after a crash would report the wrong thing. Found live: a rate-limit failure in
          // an interactive session left `objectives.phase="review"`/`blocker=null` with no
          // trace of the failure anywhere queryable.
          this.persistKernelIndex(friendly);
          notifyObserver(observer?.onError, {
            message: friendly,
            timestamp: Date.now(),
          });
          // Memory records how the turn ended: an error, not the last check it happened to pass.
          this.turnEndNotes.push(`[Error — ${friendly}]`);
          yield {
            type: "error",
            content: friendly,
            isAuthError: authError,
          };
          if (assistantText.trim()) {
            this.appendCompletedTurn(userModelMessage, [{ role: "assistant", content: assistantText }]);
          }

          const stopFailureInput: StopFailureHookInput = {
            hook_event_name: "StopFailure",
            error: friendly,
            session_id: this.session?.id,
            cwd: this.bash.getCwd(),
          };
          await this.fireHook(stopFailureInput, signal).catch(() => {});

          yield { type: "done" };
          return;
        } finally {
          await closeMcp?.().catch(() => {});
        }
      }
    } finally {
      if (this.abortController?.signal === signal) {
        this.abortController = null;
      }
    }
  }

  /**
   * Experience → memory → skill. Runs the bounded reflection call through the write gate, then
   * promotes any procedure that retrieval has relied on repeatedly into a project skill. Best
   * effort and time-boxed; the turn's result was already produced.
   */
  private async learnFromTurn(
    digest: Parameters<typeof reflectOnTurn>[0]["digest"],
    modelId: string,
    signal: AbortSignal,
    observer?: ProcessMessageObserver,
    outcome: TurnOutcome = "answered",
  ): Promise<void> {
    this.turnLearned = true;
    if (!this.provider || this.mode !== "agent" || this.ablations.has("memory")) return;
    const scope = projectMemoryScope(this.bash.getRootCwd());
    if (didWork(digest)) {
      appendEpisode(scope, episodeFrom(digest, outcome, { session: this.session?.id, model: modelId }));
    }
    try {
      const report = await reflectOnTurn({
        scope,
        provider: this.provider,
        modelId,
        digest,
        signal: withAbortTimeout(signal, 45_000),
        timeoutMs: 45_000,
      });
      if (report.usage) this.recordUsage(report.usage, "other", modelId);
      if (report.written.length > 0) {
        this.kernel?.recordObservation(`Memory: saved ${report.written.join(", ")}`);
        this.persistKernelIndex();
      }
      notifyObserver(observer?.onMemory, {
        qualified: report.qualified,
        reason: report.reason,
        ...(report.error ? { error: report.error } : {}),
        written: report.written,
        decisions: report.decisions,
        timestamp: Date.now(),
      });
      // A reflection the model could not run (a 429, a timeout) is deferred, not lost (doc 18 §2.1 C6). One deferred
      // from an earlier turn runs only after this turn's own reflection called the model and it answered: a turn that
      // reflected nothing does not wait for an old one.
      if (report.qualified && report.error) queuePendingReflection(scope, digest, outcome);
      else if (report.qualified && !signal.aborted) await this.reflectDeferred(scope, modelId, signal);
      // A procedure that earned it is proposed as a skill; only the user's yes writes it (doc 18 §8).
      const proposal = proposeProceduresAsSkills(scope, this.bash.getRootCwd(), listMemoryRecords(scope));
      if (proposal.proposed.length > 0) {
        this.kernel?.recordObservation(`Skills proposed for approval: ${proposal.proposed.join(", ")}`);
      }
    } catch (error) {
      // learning must never fail the turn
      if (!signal.aborted) recordSwallowedError("memory.learn", error);
    }
  }

  /** Reflects one turn queued when no model could (doc 18 §4.2); re-queues it when the model still cannot. */
  private async reflectDeferred(
    scope: ReturnType<typeof projectMemoryScope>,
    modelId: string,
    signal: AbortSignal,
  ): Promise<void> {
    const pending = takePendingReflection(scope);
    if (!pending || !this.provider) return;
    const report = await reflectOnTurn({
      scope,
      provider: this.provider,
      modelId,
      digest: pending.digest,
      signal: withAbortTimeout(signal, DEFERRED_REFLECTION_MS),
      timeoutMs: DEFERRED_REFLECTION_MS,
    });
    if (report.usage) this.recordUsage(report.usage, "other", modelId);
    // A reflection that keeps failing is dropped after a few tries, with a record of why.
    if (report.error && !queuePendingReflection(scope, pending.digest, pending.outcome, (pending.attempts ?? 0) + 1)) {
      appendReflectionAudit(scope, {
        kind: "dropped",
        at: new Date().toISOString(),
        qualified: true,
        reason: `deferred reflection dropped after ${(pending.attempts ?? 0) + 1} failed attempts`,
        candidates: 0,
        decisions: [],
        written: [],
        error: report.error,
      });
    }
  }

  /**
   * A turn that ended without its learning step (Limited, Paused, blocked, stopped, cancelled, an error, the
   * no-evidence gate) still did work: its episode and the lessons that need no model are recorded now, and its
   * reflection is queued for when a model answers (doc 18 §2.1 C1). Never throws.
   */
  /**
   * Crosses off the reminders this turn's recall gave the model, once the model answered: a turn that ended Limited,
   * Paused, in an error or cancelled keeps them for the next time their cue comes up (doc 18 review, round 3).
   * Never throws.
   */
  private deliverDueReminders(): void {
    const due = this.turnDueReminders;
    this.turnDueReminders = null;
    if (!due || due.slugs.length === 0) return;
    try {
      const digest = this.turnMemoryDigest?.();
      const outcome = turnOutcome(this.turnEndNotes.at(-1), digest?.verified ?? false);
      const answered = (digest?.assistantText.trim().length ?? 0) > 0;
      if (!answered || ["limited", "paused", "error", "cancelled"].includes(outcome)) return;
      for (const slug of due.slugs)
        deliverReminder(due.scope, slug, `given on ${new Date().toISOString().slice(0, 16)}`);
    } catch (error) {
      recordSwallowedError("memory.reminder", error);
    }
  }

  private recordUnlearnedTurn(): void {
    const digestOf = this.turnMemoryDigest;
    this.turnMemoryDigest = null;
    if (this.turnLearned || !digestOf || this.mode !== "agent" || this.ablations.has("memory")) return;
    try {
      const digest = digestOf();
      if (!didWork(digest)) return;
      const note = this.turnEndNotes.at(-1);
      const outcome = turnOutcome(note, digest.verified);
      const scope = projectMemoryScope(this.bash.getRootCwd());
      appendEpisode(scope, episodeFrom(digest, outcome, { session: this.session?.id, note, model: this.modelId }));
      const failures = deterministicFailureCandidates(digest);
      const admitted = failures.length > 0 ? admitCandidates(scope, failures) : { decisions: [], written: [] };
      const qualification = turnQualifiesForReflection(digest);
      // Only a turn no model could finish waits for a reflection. The other exits that skip the learning step are the
      // ones whose work the host would not trust (tests or checks or decision records changed, no evidence, a Stop
      // hook, report_blocker) or the user's own cancel: what the host observed is kept, the model infers nothing.
      const deferrable = outcome === "limited" || outcome === "paused" || outcome === "error";
      const deferred = qualification.qualified && deferrable;
      if (deferred) queuePendingReflection(scope, digest, outcome);
      const why = deferred
        ? "; reflection deferred until a model answers"
        : qualification.qualified && !deferrable
          ? "; no reflection on this exit"
          : "";
      appendReflectionAudit(scope, {
        kind: "unlearned",
        at: new Date().toISOString(),
        qualified: qualification.qualified,
        reason: `ended ${outcome}: ${qualification.reason}${why}`,
        candidates: failures.length,
        decisions: admitted.decisions,
        written: admitted.written,
      });
    } catch (error) {
      recordSwallowedError("memory.unlearned-turn", error);
    }
  }

  private requireProvider(): ProviderAdapter {
    if (!this.provider) {
      throw new Error(
        "No model runtime configured. Use OpenRouter with OPENROUTER_API_KEY or start the explicit local runtime.",
      );
    }

    return this.provider;
  }

  async detectVerifyRecipe(settings?: SandboxSettings, abortSignal?: AbortSignal): Promise<VerifyRecipe | null> {
    try {
      const result = await this.runTaskRequest(
        {
          agent: "verify-detect",
          description: "Detect verification recipe",
          prompt: buildVerifyDetectPrompt(this.bash.getCwd(), settings ?? this.bash.getSandboxSettings()),
        },
        undefined,
        abortSignal,
      );
      if (!result.success || !result.output) return null;
      const maybeJson = extractJsonObject(result.output);
      if (!maybeJson) return null;
      return normalizeVerifyRecipe(JSON.parse(maybeJson));
    } catch {
      return null;
    }
  }

  async runVerify(onProgress?: (detail: string) => void, abortSignal?: AbortSignal): Promise<ToolResult> {
    this.abortController = new AbortController();
    const signal = abortSignal ?? this.abortController.signal;
    if (!this.kernel) this.kernel = new AgentKernel("verification");
    const userModelMessage: ModelMessage = { role: "user", content: "/verify" };
    this.messages.push(userModelMessage);
    this.messageSeqs.push(null);

    try {
      await this.consumeBackgroundNotifications();
      if (!isShuruSupported()) {
        // Every step of the verify flow runs in a sandbox this host does not have; say so instead of
        // running a flow whose commands would all fail.
        this.appendCompletedTurn(userModelMessage, [{ role: "assistant", content: VERIFY_UNSUPPORTED_MESSAGE }]);
        return { success: false, output: VERIFY_UNSUPPORTED_MESSAGE };
      }
      this.kernel?.transition("verify");
      const result = await runVerifyOrchestration(this, { onProgress, abortSignal: signal });
      this.kernel?.recordVerification(result.success, result.output || result.error);
      this.kernel?.evaluateCompletion({ verificationPassed: result.success, reviewPassed: result.success });
      this.persistKernelIndex();
      const assistantText = result.output || result.error || "Verification completed.";
      this.appendCompletedTurn(userModelMessage, [{ role: "assistant", content: assistantText }]);
      return result;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const failureText = signal.aborted ? "Verification aborted." : `Verification failed: ${msg}`;
      this.kernel?.recordObservation(failureText);
      this.kernel?.evaluateCompletion({ verificationPassed: false, reviewPassed: false });
      this.persistKernelIndex(failureText);
      this.appendCompletedTurn(userModelMessage, [{ role: "assistant", content: failureText }]);
      return { success: false, output: failureText };
    } finally {
      if (this.abortController?.signal === signal) {
        this.abortController = null;
      }
    }
  }
}

/** Whether two readings of a decision record say the same thing, whatever their status. */
function sameDecisionContent(a: Decision, b: Decision): boolean {
  return (
    a.id === b.id &&
    a.title === b.title &&
    a.rule === b.rule &&
    a.scope.join("\n") === b.scope.join("\n") &&
    a.check === b.check &&
    a.supersedes === b.supersedes
  );
}

/** A text file's content, or null when it does not exist or cannot be read. */
function readTextOrNull(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function isEmptyAssistantMessage(message: ModelMessage | undefined): boolean {
  if (!message || message.role !== "assistant") return false;
  if (typeof message.content === "string") return message.content.trim() === "";
  if (!Array.isArray(message.content)) return false;
  return message.content.every(
    (part) => (part.type === "text" || part.type === "reasoning") && part.text.trim() === "",
  );
}

/** The text an interrupted sub-agent attempt wrote in its completed steps, reported if it later gives up. */
function assistantTextOf(messages: readonly ModelMessage[]): string {
  return messages
    .flatMap((message) => {
      if (message.role !== "assistant") return [];
      if (typeof message.content === "string") return [message.content];
      return message.content.flatMap((part) => (part.type === "text" ? [part.text] : []));
    })
    .join("\n")
    .trim();
}

/** Drops a final assistant message whatever its content (used when that content was unparsed tool markup). */
function dropTrailingAssistantMessage(messages: ModelMessage[]): ModelMessage[] {
  const kept = [...messages];
  while (kept.length > 0 && kept[kept.length - 1]?.role === "assistant") kept.pop();
  return kept;
}

/** Keeps a round's tool calls and results while discarding a final content-less assistant reply. */
function dropTrailingEmptyAssistantMessage(messages: ModelMessage[]): ModelMessage[] {
  const kept = [...messages];
  while (kept.length > 0 && isEmptyAssistantMessage(kept[kept.length - 1])) kept.pop();
  return kept;
}

function isKernelPhase(value: string): value is KernelPhase {
  return [
    "frame",
    "discover",
    "analyze",
    "plan",
    "act",
    "observe",
    "reflect",
    "verify",
    "review",
    "complete",
    "blocked",
    "cancelled",
  ].includes(value as KernelPhase);
}

function extractJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  return text.slice(start, end + 1);
}

function getBatchFinishReason(finishReason: string | null | undefined): ProcessMessageFinishReason {
  switch (finishReason) {
    case "stop":
    case "length":
    case "content-filter":
    case "tool-calls":
    case "error":
    case "other":
      return finishReason;
    case "tool_calls":
      return "tool-calls";
    default:
      return "other";
  }
}

function parseToolArgumentsOrRaw(raw: string): unknown {
  try {
    return raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return raw;
  }
}

function notifyObserver<T>(listener: ((payload: T) => void) | undefined, payload: T): void {
  if (!listener) {
    return;
  }

  try {
    listener(payload);
  } catch (error) {
    // Observer failures should never break generation.
    recordSwallowedError("observer", error);
  }
}

function toToolResult(output: unknown): ToolResult {
  if (output && typeof output === "object" && "success" in output) {
    const r = output as {
      success: boolean;
      output?: string;
      error?: string;
      diff?: ToolResult["diff"];
      plan?: Plan;
      planUpdate?: ToolResult["planUpdate"];
      task?: ToolResult["task"];
      delegation?: ToolResult["delegation"];
      backgroundProcess?: ToolResult["backgroundProcess"];
      media?: ToolResult["media"];
      computer?: ToolResult["computer"];
      lspDiagnostics?: ToolResult["lspDiagnostics"];
      refused?: ToolResult["refused"];
      blocker?: ToolResult["blocker"];
    };
    return {
      success: r.success,
      output: r.output,
      error: r.error ?? (r.success ? undefined : r.output),
      diff: r.diff,
      plan: r.plan,
      planUpdate: r.planUpdate,
      task: r.task,
      delegation: r.delegation,
      backgroundProcess: r.backgroundProcess,
      media: r.media,
      computer: r.computer,
      lspDiagnostics: r.lspDiagnostics,
      ...(r.refused ? { refused: r.refused } : {}),
      ...(r.blocker ? { blocker: r.blocker } : {}),
    };
  }
  return { success: true, output: String(output) };
}

function formatSubagentActivity(toolName: string, args?: unknown): string {
  const parsed = parseToolArgs(args);
  if (toolName === "read_file") return `Read ${parsed.path || "file"}`;
  if (toolName === "lsp") return `LSP ${parsed.operation || "query"} ${parsed.filePath || ""}`.trim();
  if (toolName === "write_file") return `Write ${parsed.path || "file"}`;
  if (toolName === "edit_file") return `Edit ${parsed.path || "file"}`;
  if (toolName === "delete_file") return `Delete ${parsed.path || "file"}`;
  if (toolName === "search_web") return `Web search "${truncate(parsed.query || "", 50)}"`;
  if (toolName === "computer_snapshot") return `Snapshot ${parsed.app || "desktop"}`;
  if (toolName === "computer_screenshot") return "Capture desktop screenshot";
  if (toolName === "computer_click")
    return parsed.ref ? `Click ${parsed.ref}` : `Click at ${parsed.x || "?"},${parsed.y || "?"}`;
  if (toolName === "computer_mouse_move")
    return parsed.ref ? `Hover ${parsed.ref}` : `Move mouse to ${parsed.x || "?"},${parsed.y || "?"}`;
  if (toolName === "computer_type") return `Type into ${parsed.ref || "element"}`;
  if (toolName === "computer_press") return `Press ${parsed.key || "key"}`;
  if (toolName === "computer_scroll") return `Scroll ${parsed.ref || "element"} ${parsed.direction || "down"}`;
  if (toolName === "computer_launch") return `Launch ${parsed.app || "app"}`;
  if (toolName === "computer_list_windows") return `List windows${parsed.app ? ` for ${parsed.app}` : ""}`;
  if (toolName === "computer_focus_window")
    return `Focus window ${parsed.window_id || parsed.title || parsed.app || ""}`.trim();
  if (toolName === "computer_wait") return "Wait for desktop state";
  if (toolName === "computer_get") return `Read ${parsed.property || "text"} from ${parsed.ref || "element"}`;
  if (toolName === "bash") return truncate(parsed.command || "Run command", 70);
  return truncate(`${toolName}`, 70);
}

function parseToolArgs(args: unknown): Record<string, string> {
  if (!args || typeof args !== "object") return {};
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(args)) {
    result[key] = typeof value === "string" ? value : JSON.stringify(value);
  }
  return result;
}

function firstLine(text: string): string {
  return text.trim().split("\n").find(Boolean)?.trim() || "Task completed.";
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function formatEntriesForRecap(entries: ChatEntry[], maxChars: number): string {
  const lines: string[] = [];
  let remaining = maxChars;

  for (let i = entries.length - 1; i >= 0 && remaining > 0; i--) {
    const line = formatRecapEntry(entries[i]!);
    if (!line) {
      continue;
    }

    const bounded = truncate(line, Math.min(remaining, 520));
    if (!bounded.trim()) {
      continue;
    }

    lines.unshift(bounded);
    remaining -= bounded.length + 1;
  }

  return lines.join("\n");
}

function formatRecapEntry(entry: ChatEntry): string | null {
  const content = entry.content.trim();
  if (!content) {
    return null;
  }

  switch (entry.type) {
    case "user":
      return `[User] ${truncate(content, 420)}`;
    case "assistant":
      return `[Assistant] ${truncate(content, 420)}`;
    case "tool_result":
      return `[Tool ${entry.toolResult?.success === false ? "error" : "result"}] ${truncate(content, 260)}`;
    default:
      return null;
  }
}

function withAbortTimeout(signal: AbortSignal | undefined, timeoutMs?: number): AbortSignal | undefined {
  if (
    timeoutMs === undefined ||
    !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0 ||
    typeof AbortSignal.timeout !== "function"
  ) {
    return signal;
  }
  return combineAbortSignals(signal, AbortSignal.timeout(timeoutMs));
}

function combineAbortSignals(...signals: Array<AbortSignal | undefined>): AbortSignal | undefined {
  const activeSignals = signals.filter((signal): signal is AbortSignal => Boolean(signal));
  if (activeSignals.length === 0) return undefined;
  if (activeSignals.length === 1) return activeSignals[0];

  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any(activeSignals);
  }

  const controller = new AbortController();
  for (const signal of activeSignals) {
    if (signal.aborted) {
      controller.abort();
      break;
    }

    signal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  return controller.signal;
}

function utcDayStart(): Date {
  const value = new Date();
  value.setUTCHours(0, 0, 0, 0);
  return value;
}

function isContextLimitError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /(context|token|prompt).*(limit|length|large|window|overflow|size|exceed)|too many tokens|maximum context/i.test(
    message,
  );
}

function isAuthenticationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\b(401|403)\b|unauthori[sz]ed|invalid.*(api[_ ]?key|token|credential)|authentication failed|forbidden|access denied/i.test(
    message,
  );
}

const STATUS_MESSAGES: Record<number, string> = {
  400: "The request was invalid. This may be caused by an unsupported parameter or model.",
  401: "Authentication failed. Your API key may be invalid or expired.",
  403: "Access denied. Your API key does not have permission for this request.",
  404: "The requested model or endpoint was not found. Check your model name and base URL.",
  408: "The request timed out. Please try again.",
  422: "The request could not be processed. Check your message format or parameters.",
  429: "Rate limit exceeded. Please wait a moment and try again.",
  500: "The API server encountered an internal error. Please try again later.",
  502: "The API server is temporarily unavailable. Please try again later.",
  503: "The API service is temporarily overloaded. Please try again later.",
  529: "The API service is overloaded. Please try again later.",
};

function interruptionContinuation(reason: string): string {
  return `The connection to the model was interrupted (${reason}). Your completed steps are above and their effects are on disk. Continue the task from where it stopped; do not redo finished work.`;
}

/** A short, user-facing cause for a failed model round. */
function describeInterruption(error: unknown): string {
  if (isProviderStreamIdleError(error)) return `no output for ${Math.round(error.idleMs / 1_000)}s`;
  const name = (error as { name?: unknown } | null)?.name;
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (
    name === "AbortError" ||
    name === "TimeoutError" ||
    /operation was aborted|timed out|\btimeout\b/i.test(message)
  ) {
    return "no response within the time limit";
  }
  return humanizeApiError(error).slice(0, 300);
}

/**
 * A key the provider rejects fails the same way for every model and every retry. Matched on the
 * HTTP status, or on wording that only authentication failures use: a looser pattern (any
 * "invalid ... token") also caught request errors such as "Invalid 'max_tokens'" and ended turns
 * that a retry or another model would have finished.
 */
function isRejectedCredentialError(error: unknown): boolean {
  if (APICallError.isInstance(error)) return error.statusCode === 401;
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /\bunauthori[sz]ed\b|invalid (api[_ -]?key|credentials?|authentication)|incorrect api key|api key (is )?(invalid|revoked|missing)|no auth credentials|authentication failed/i.test(
    message,
  );
}

/**
 * OpenRouter reports an upstream provider's own failure as HTTP 404 "Provider returned error". It is not a
 * missing model: in the audit of 2026-09-23 the same model answered 200 minutes later, but the 404 paused a
 * pinned benchmark turn after one attempt and cost three tasks. Such a failure is retried like a stall.
 */
function isUpstreamProviderFailure(error: unknown): boolean {
  const text = APICallError.isInstance(error)
    ? `${error.message} ${error.responseBody ?? ""}`
    : error instanceof Error
      ? error.message
      : String(error ?? "");
  return /provider returned error/i.test(text);
}

/** OpenRouter's answer when no endpoint of the model takes a parameter the request sent under `require_parameters`. */
function rejectsSamplingParameters(error: unknown): boolean {
  const text = APICallError.isInstance(error)
    ? `${error.message} ${error.responseBody ?? ""}`
    : error instanceof Error
      ? error.message
      : String(error ?? "");
  return /no endpoints found that can handle the requested parameters/i.test(text);
}

/** Failures that retrying the same model cannot fix: no credits, no endpoint, a spend limit, a daily quota. */
function isModelUnavailableError(error: unknown): boolean {
  if (isUpstreamProviderFailure(error)) return false;
  if (APICallError.isInstance(error) && [402, 403, 404].includes(error.statusCode ?? 0)) return true;
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /blocked by budget|insufficient (credits|balance|funds)|more credits|no endpoints found|model .*not (found|available)|not a valid model|does not support tool|free-models-per-day|quota|free mode uses free models only/i.test(
    message,
  );
}

/** The provider's next fallback this turn has not tried yet, marked as tried. */
function nextFallbackModel(provider: ProviderAdapter, modelId: string, state: InterruptionState): string | null {
  let candidates: string[] = [];
  try {
    candidates = provider.fallbackModelIds?.(modelId) ?? [];
  } catch {
    candidates = [];
  }
  const next = candidates.find((id) => !state.triedModels.has(id));
  if (!next) return null;
  state.triedModels.add(next);
  return next;
}

/**
 * What a fallback costs, stated when the turn switches to it: a fallback is not always free (a
 * paid policy falls back to OpenRouter's auto router; `SHELRA_FALLBACK_MODELS` may name paid models).
 */
function describeModelCost(provider: ProviderAdapter, modelId: string): string {
  let info: ModelInfo | undefined;
  try {
    info = provider.resolveModelRuntime(modelId).modelInfo;
  } catch {
    info = undefined;
  }
  if (!info || info.pricingKnown === false) return "paid: billed at the rate of the model it uses";
  if (info.inputPrice === 0 && info.outputPrice === 0) return "free";
  const perMillion = (price: number) => `$${(price * 1_000_000).toFixed(2)}`;
  return `paid: ${perMillion(info.inputPrice)} in / ${perMillion(info.outputPrice)} out per 1M tokens`;
}

function sleepUnlessAborted(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0 || signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal.addEventListener("abort", finish, { once: true });
  });
}

function humanizeApiError(error: unknown): string {
  if (APICallError.isInstance(error)) {
    const detail = extractResponseDetail(error.responseBody);
    if (detail) return detail;
    if (error.statusCode && STATUS_MESSAGES[error.statusCode]) {
      return STATUS_MESSAGES[error.statusCode];
    }
  }

  const raw = error instanceof Error ? error.message : String(error);
  if ((error instanceof Error && error.name === "TimeoutError") || /\btimeout\b|timed out|time out/i.test(raw)) {
    return "The model stopped responding before the configured timeout. Check the selected runtime or increase SHELRA_MODEL_IDLE_TIMEOUT_MS for a slower model.";
  }
  return raw.replace(/^AI_\w+Error:\s*/i, "").trim() || raw;
}

function extractResponseDetail(body: string | undefined): string | null {
  if (!body) return null;
  try {
    const parsed = JSON.parse(body);
    const msg = parsed?.error?.message ?? parsed?.message ?? parsed?.detail;
    if (typeof msg === "string" && msg.trim()) return msg.trim();
  } catch {
    /* not JSON */
  }
  return null;
}

function readPositiveMilliseconds(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 1_000 ? Math.floor(value) : fallback;
}

function readModelTimeoutFromEnvironment(): ProviderTimeout {
  return {
    totalMs: readPositiveMilliseconds("SHELRA_MODEL_TIMEOUT_MS", DEFAULT_MODEL_TIMEOUT.totalMs ?? 0),
    stepMs: readPositiveMilliseconds("SHELRA_MODEL_STEP_TIMEOUT_MS", DEFAULT_MODEL_TIMEOUT.stepMs ?? 0),
    chunkMs: readPositiveMilliseconds("SHELRA_MODEL_IDLE_TIMEOUT_MS", DEFAULT_MODEL_TIMEOUT.chunkMs ?? 0),
  };
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
