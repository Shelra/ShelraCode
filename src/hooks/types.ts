export const HOOK_EVENTS = [
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "UserPromptSubmit",
  "SessionStart",
  "SessionEnd",
  "Stop",
  "StopFailure",
  "SubagentStart",
  "SubagentStop",
  "TaskCreated",
  "TaskCompleted",
  "PreCompact",
  "PostCompact",
  "Notification",
  "InstructionsLoaded",
  "CwdChanged",
  // Shelra's own events (not part of the set other agents define).
  "SkillActivated",
  "ExtensionChanged",
] as const;

export type HookEvent = (typeof HOOK_EVENTS)[number];

export function isHookEvent(value: string): value is HookEvent {
  return (HOOK_EVENTS as readonly string[]).includes(value);
}

/** Events only Shelra fires. Every other event has the name and meaning it has in other coding agents. */
export const SHELRA_OWN_EVENTS: ReadonlySet<HookEvent> = new Set<HookEvent>(["SkillActivated", "ExtensionChanged"]);

/**
 * The events whose hook can stop what is about to happen, because the runtime waits for the decision and acts on it:
 * a tool call, a prompt, the end of a turn. On any other event an exit code of 2 is an ordinary failure, and a hook
 * there observes; it never claims to have prevented anything.
 */
export const BLOCKABLE_EVENTS: ReadonlySet<HookEvent> = new Set<HookEvent>(["PreToolUse", "UserPromptSubmit", "Stop"]);

// --- Hook Input types (piped to stdin as JSON) ---

export interface BaseHookInput {
  hook_event_name: HookEvent;
  session_id?: string;
  cwd: string;
}

export interface PreToolUseHookInput extends BaseHookInput {
  hook_event_name: "PreToolUse";
  tool_name: string;
  tool_input: Record<string, unknown>;
}

export interface PostToolUseHookInput extends BaseHookInput {
  hook_event_name: "PostToolUse";
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_output: Record<string, unknown>;
}

export interface PostToolUseFailureHookInput extends BaseHookInput {
  hook_event_name: "PostToolUseFailure";
  tool_name: string;
  tool_input: Record<string, unknown>;
  error: string;
}

export interface UserPromptSubmitHookInput extends BaseHookInput {
  hook_event_name: "UserPromptSubmit";
  user_prompt: string;
}

export interface SessionStartHookInput extends BaseHookInput {
  hook_event_name: "SessionStart";
  source: "startup" | "resume" | "clear";
}

export interface SessionEndHookInput extends BaseHookInput {
  hook_event_name: "SessionEnd";
}

export interface StopHookInput extends BaseHookInput {
  hook_event_name: "Stop";
}

export interface StopFailureHookInput extends BaseHookInput {
  hook_event_name: "StopFailure";
  error: string;
}

export interface SubagentStartHookInput extends BaseHookInput {
  hook_event_name: "SubagentStart";
  agent_type: string;
  description: string;
}

export interface SubagentStopHookInput extends BaseHookInput {
  hook_event_name: "SubagentStop";
  agent_type: string;
  description: string;
  success: boolean;
}

export interface TaskCreatedHookInput extends BaseHookInput {
  hook_event_name: "TaskCreated";
  agent_type: string;
  description: string;
}

export interface TaskCompletedHookInput extends BaseHookInput {
  hook_event_name: "TaskCompleted";
  agent_type: string;
  description: string;
  success: boolean;
}

export interface PreCompactHookInput extends BaseHookInput {
  hook_event_name: "PreCompact";
  trigger: "auto" | "manual";
}

export interface PostCompactHookInput extends BaseHookInput {
  hook_event_name: "PostCompact";
  trigger: "auto" | "manual";
}

export interface NotificationHookInput extends BaseHookInput {
  hook_event_name: "Notification";
  message: string;
}

export interface InstructionsLoadedHookInput extends BaseHookInput {
  hook_event_name: "InstructionsLoaded";
  files_loaded: number;
}

export interface SkillActivatedHookInput extends BaseHookInput {
  hook_event_name: "SkillActivated";
  skill_name: string;
  skill_hash: string;
  invoker: "model" | "user" | "agent";
  reason: string;
}

export interface ExtensionChangedHookInput extends BaseHookInput {
  hook_event_name: "ExtensionChanged";
  kind: string;
  name: string;
  action: string;
  path: string;
  hash: string;
}

export interface CwdChangedHookInput extends BaseHookInput {
  hook_event_name: "CwdChanged";
  old_cwd: string;
  new_cwd: string;
}

export type HookInput =
  | PreToolUseHookInput
  | PostToolUseHookInput
  | PostToolUseFailureHookInput
  | UserPromptSubmitHookInput
  | SessionStartHookInput
  | SessionEndHookInput
  | StopHookInput
  | StopFailureHookInput
  | SubagentStartHookInput
  | SubagentStopHookInput
  | TaskCreatedHookInput
  | TaskCompletedHookInput
  | PreCompactHookInput
  | PostCompactHookInput
  | NotificationHookInput
  | InstructionsLoadedHookInput
  | CwdChangedHookInput
  | SkillActivatedHookInput
  | ExtensionChangedHookInput;

// --- Hook Output types (parsed from stdout JSON) ---

export interface HookOutput {
  continue?: boolean;
  stopReason?: string;
  decision?: "approve" | "block";
  reason?: string;
  additionalContext?: string;
  /** A PreToolUse `permissionDecision` of "allow" is read and recorded but never widens a permission. */
  permissionDecision?: "allow" | "deny" | "ask";
}

// --- Hook Result (after processing exit code + output) ---

export type HookOutcome = "success" | "blocking" | "non_blocking_error" | "cancelled";

export interface HookResult {
  outcome: HookOutcome;
  output?: HookOutput;
  stderr?: string;
  exitCode: number | null;
  command: string;
  /** Stable name of the hook that produced it (`id` or a fingerprint). */
  hookId?: string;
  source?: HookSource;
  durationMs?: number;
  timedOut?: boolean;
  /** Output was cut at the limit. */
  truncated?: boolean;
  /** Standard output began like JSON but was not valid JSON. */
  invalidOutput?: boolean;
  /** The hook failed (timeout, crash, bad output) and its `closed` policy turned that into a block. */
  failedClosed?: boolean;
}

export interface AggregatedHookResult {
  blocked: boolean;
  blockingErrors: Array<{ command: string; stderr: string }>;
  preventContinuation: boolean;
  stopReason?: string;
  additionalContexts: string[];
  decision?: "approve" | "block";
  results: HookResult[];
}

export type HookSource = "user" | "project" | "local";
export type HookFailurePolicy = "open" | "closed";

// --- Hook Configuration types ---

export interface CommandHook {
  type: "command";
  /** The command line, run by the shell (`sh`, or `cmd` where there is none) unless `args` is given. */
  command: string;
  /** Exec form: `command` is the program and these are its arguments, with no shell in between. */
  args?: string[];
  shell?: "sh" | "cmd" | "powershell";
  /** Seconds. Default 30, at most 600. */
  timeout?: number;
  /** A name for `/hooks`, `shelra hooks` and the run log. */
  id?: string;
  description?: string;
  enabled?: boolean;
  /**
   * What a timeout, a crash or unreadable output means on an event that can block. `open` (the default) lets the
   * action go on and reports the failure; `closed` blocks it. Ignored on events that cannot block.
   */
  failurePolicy?: HookFailurePolicy;
  /** Runs without the runtime waiting for it, so it can never block. Not allowed with `closed`. */
  async?: boolean;
  importedFrom?: string;
}

export type HookCommand = CommandHook;

export interface HookMatcher {
  matcher?: string;
  hooks: HookCommand[];
}

export type HooksConfig = Partial<Record<HookEvent, HookMatcher[]>>;

/**
 * Returns the matcher query field for a given hook event input,
 * used to filter matchers by their `matcher` string.
 */
export function getMatchQuery(input: HookInput): string | undefined {
  switch (input.hook_event_name) {
    case "PreToolUse":
    case "PostToolUse":
    case "PostToolUseFailure":
      return input.tool_name;
    case "SessionStart":
      return input.source;
    case "SubagentStart":
    case "SubagentStop":
    case "TaskCreated":
    case "TaskCompleted":
      return input.agent_type;
    case "PreCompact":
    case "PostCompact":
      return input.trigger;
    case "SkillActivated":
      return input.skill_name;
    case "ExtensionChanged":
      return input.kind;
    default:
      return undefined;
  }
}
