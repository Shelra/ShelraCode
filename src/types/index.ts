import type { ModelMessage } from "ai";
import type { LspDiagnosticFile } from "../lsp/types";

export interface FileDiff {
  filePath: string;
  additions: number;
  removals: number;
  patch: string;
  isNew: boolean;
}

export interface PlanStep {
  title: string;
  description: string;
  filePaths?: string[];
  /** Acceptance criterion ids advanced by this step. */
  satisfies?: string[];
  /** Runtime-owned execution state, updated through update_plan_step. */
  status?: PlanStepStatus;
  evidence?: string;
}

export type PlanStepStatus = "pending" | "working" | "complete" | "failed";

export interface PlanStepUpdate {
  index: number;
  status: PlanStepStatus;
  evidence?: string;
}

export interface PlanAcceptanceCriterion {
  id: string;
  description: string;
  /** Concrete command, test, observation, or evidence that will prove the criterion. */
  verification: string;
  /** A command that exits 0 once the criterion holds; the host runs it on the final code (the task contract). */
  command?: string;
  /**
   * What `command` did when the plan was published: a check that already passed before the change cannot show
   * the change works, so it does not join the contract. "not_run" when the turn had already changed files.
   */
  commandBefore?: "failed" | "passed" | "not_run";
}

export interface PlanQuestion {
  id: string;
  question: string;
  header?: string;
  type: "select" | "multiselect" | "text";
  options?: { id: string; label: string }[];
}

export interface Plan {
  title: string;
  summary: string;
  /** Optional only for compatibility with plans persisted before the executable-plan contract. */
  goal?: string;
  requirements?: string[];
  acceptanceCriteria?: PlanAcceptanceCriterion[];
  steps: PlanStep[];
  questions?: PlanQuestion[];
}

export type BuiltinSubagentId =
  | "general"
  | "explore"
  | "vision"
  | "verify"
  | "ui-verify"
  | "verify-detect"
  | "verify-manifest"
  | "computer";

export interface TaskRequest {
  agent: BuiltinSubagentId | string;
  description: string;
  prompt: string;
}

export interface TaskRun {
  agent: string;
  description: string;
  summary: string;
  activity?: string;
  /** Checks the sub-agent itself ran successfully; a delegation counts as verification only with these. */
  evidence?: string[];
}

export type DelegationStatus = "running" | "complete" | "error";

export interface DelegationRun {
  id: string;
  agent: "explore";
  description: string;
  summary: string;
  status: DelegationStatus;
  startedAt?: string;
  completedAt?: string;
}

export interface SubagentStatus {
  agent: string;
  description: string;
  detail: string;
}

export interface BackgroundProcessInfo {
  id: number;
  pid: number;
  command: string;
}

export interface MediaAsset {
  kind: "image" | "video";
  path: string;
  url?: string;
  mediaType?: string;
  prompt?: string;
  sourcePath?: string;
  sourceUrl?: string;
  durationSeconds?: number;
  modelId?: string;
}

export interface ComputerToolMetadata {
  action: string;
  path?: string;
  hint?: string;
  ref?: string;
  app?: string;
  windowId?: string;
}

export interface VerifyRecipe {
  ecosystem: string;
  appKind: string;
  appLabel: string;
  shellInitCommands: string[];
  bootstrapCommands: string[];
  installCommands: string[];
  buildCommands: string[];
  testCommands: string[];
  startCommand?: string;
  startPort?: string;
  smokeKind: "http" | "cli" | "none";
  smokeTarget?: string;
  evidence: string[];
  notes: string[];
}

export interface VerifyEnvironmentManifest {
  ecosystem?: string;
  appKind?: string;
  appLabel?: string;
  shellInit?: string[] | string;
  shellInitCommands?: string[] | string;
  bootstrap?: string[] | string;
  bootstrapCommands?: string[] | string;
  install?: string[] | string;
  installCommands?: string[] | string;
  build?: string[] | string;
  buildCommands?: string[] | string;
  test?: string[] | string;
  testCommands?: string[] | string;
  start?: string;
  startCommand?: string;
  startPort?: string;
  smokeKind?: "http" | "cli" | "none";
  smokeTarget?: string;
  evidence?: string[] | string;
  notes?: string[] | string;
  sandbox?: {
    allowNet?: boolean;
    allowedHosts?: string[];
    ports?: string[];
    cpus?: number;
    memory?: number;
    diskSize?: number;
    secrets?: Array<{ name: string; fromEnv: string; hosts: string[] }>;
    from?: string;
    verifyBaseFrom?: string;
    guestWorkdir?: string;
    syncHostWorkspace?: boolean;
    shellInit?: string[];
    hostBrowserCommandsOnHost?: boolean;
  };
  recipe?: Partial<VerifyRecipe> & Record<string, unknown>;
}

export interface VerifyRetryStrategy {
  id: string;
  when: string;
  reason: string;
  commands: string[];
}

export interface VerifyArtifact {
  kind: "log" | "screenshot" | "video";
  path: string;
  description: string;
}

export interface ToolResult {
  success: boolean;
  output?: string;
  error?: string;
  diff?: FileDiff;
  plan?: Plan;
  planUpdate?: PlanStepUpdate;
  task?: TaskRun;
  delegation?: DelegationRun;
  backgroundProcess?: BackgroundProcessInfo;
  media?: MediaAsset[];
  computer?: ComputerToolMetadata;
  verifyRecipe?: VerifyRecipe;
  lspDiagnostics?: LspDiagnosticFile[];
  /** A shell command the destructive-command guard did not run: the user said no, or nobody could be asked. */
  refused?: "declined" | "blocked";
  /** The agent reported that the task cannot be done as asked (report_blocker), and why. */
  blocker?: string;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface ChatEntry {
  type: "user" | "assistant" | "tool_call" | "tool_result";
  content: string;
  timestamp: Date;
  remoteKey?: string;
  sourceLabel?: string;
  queued?: boolean;
  toolCalls?: ToolCall[];
  toolCall?: ToolCall;
  toolResult?: ToolResult;
}

export interface PaymentPrecheck {
  security?: string;
  securityLabel?: string;
  securityUrl?: string;
  amount?: string;
  network?: string;
  asset?: string;
  description?: string;
}

export interface StreamChunk {
  type: "content" | "tool_calls" | "tool_result" | "tool_approval_request" | "done" | "error" | "reasoning";
  content?: string;
  toolCalls?: ToolCall[];
  toolCall?: ToolCall;
  toolResult?: ToolResult;
  approvalId?: string;
  paymentPrecheck?: PaymentPrecheck;
  isAuthError?: boolean;
}

export type ReasoningEffort = "low" | "medium" | "high" | "xhigh";

export interface ModelInfo {
  id: string;
  name: string;
  contextWindow: number;
  inputPrice: number;
  outputPrice: number;
  pricingKnown?: boolean;
  reasoning: boolean;
  description: string;
  aliases?: string[];
  responsesOnly?: boolean;
  multiAgent?: boolean;
  supportsClientTools?: boolean;
  supportsMaxOutputTokens?: boolean;
  defaultReasoningEffort?: ReasoningEffort;
  supportsReasoningEffort?: boolean;
  /** False when no endpoint of the model takes `temperature` (OpenAI's pro reasoning models): sending it fails the request. */
  supportsTemperature?: boolean;
  /** Host evidence quality for tool/agent claims. */
  capabilityConfidence?: "unknown" | "declared" | "probed" | "measured";
  runtimeKind?: string;
  supportsVision?: boolean;
  maxOutputTokens?: number;
  category?: "local" | "cloud";
  provider?: string;
}

export type AgentMode = "agent" | "plan" | "ask";
export type SessionStatus = "active" | "archived";
export type UsageSource = "message" | "title" | "recap" | "task" | "delegation" | "other";

export interface SessionRecap {
  text: string;
  model: string | null;
  updatedAt: Date | null;
}

export interface WorkspaceInfo {
  id: string;
  scopeKey: string;
  canonicalPath: string;
  gitRoot: string | null;
  displayName: string;
  lastSeenAt: Date;
}

export interface SessionInfo {
  id: string;
  workspaceId: string;
  title: string | null;
  recap: SessionRecap | null;
  model: string;
  mode: AgentMode;
  cwdAtStart: string;
  cwdLast: string;
  status: SessionStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface UsageEvent {
  id: number;
  sessionId: string;
  messageSeq: number | null;
  source: UsageSource;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costMicros: number;
  createdAt: Date;
}

export interface SessionSnapshot {
  workspace: WorkspaceInfo;
  session: SessionInfo;
  messages: ModelMessage[];
  entries: ChatEntry[];
  totalTokens: number;
  totalCostMicros?: number;
}

export const MODES: { id: AgentMode; label: string }[] = [
  { id: "agent", label: "Agent" },
  { id: "plan", label: "Plan" },
  { id: "ask", label: "Ask" },
];
