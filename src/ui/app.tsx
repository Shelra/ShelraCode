import type { KeyBinding, KeyEvent, ScrollBoxRenderable, TextareaRenderable } from "@opentui/core";
import { decodePasteBytes, type PasteEvent, parseKeypress } from "@opentui/core";
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react";
import os from "os";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Agent, type ProcessMessageObserver } from "../agent/agent";
import type { KernelState } from "../agent/kernel";
import { POPULAR_MCP_CATALOG } from "../mcp/catalog";
import { parseEnvLines, parseHeaderLines } from "../mcp/parse-headers";
import { toMcpServerId, validateMcpServerConfig } from "../mcp/validate";
import { projectMemoryScope, readMemoryIndex } from "../memory/store";
import {
  getEffectiveReasoningEffort,
  getModelInfo,
  getSupportedReasoningEfforts,
  normalizeModelId,
} from "../models/catalog";
import { createTelegramBridge, type TelegramBridgeHandle } from "../telegram/bridge";
import { approvePairingCode } from "../telegram/pairing";
import { createTurnCoordinator } from "../telegram/turn-coordinator";
import type { ScheduleDaemonStatus, StoredSchedule } from "../tools/schedule";
import type {
  AgentMode,
  ChatEntry,
  DelegationRun,
  FileDiff,
  ModelInfo,
  Plan,
  PlanQuestion,
  ReasoningEffort,
  SubagentStatus,
  ToolCall,
  ToolResult,
} from "../types/index";
import { MODES } from "../types/index";
import { processAtMentions } from "../utils/at-mentions.js";
import { FileIndex } from "../utils/file-index.js";
import { copyTextToHostClipboard } from "../utils/host-clipboard";
import {
  type CustomSubagentConfig,
  getApiKey,
  getTelegramBotToken,
  isReservedSubagentName,
  loadAppearancePreference,
  loadMcpServers,
  loadMotionPreference,
  loadPaymentSettings,
  loadUserSettings,
  loadValidSubAgents,
  type McpRemoteTransport,
  type McpServerConfig,
  type PaymentChain,
  type PaymentSettings,
  type SandboxMode,
  type SandboxSettings,
  saveApprovedTelegramUserId,
  saveMcpServers,
  savePaymentSettings,
  saveProjectSettings,
  saveRecapsEnabled,
  saveUserSettings,
} from "../utils/settings";
import { discoverSkills, formatSkillsForChat } from "../utils/skills";
import { formatSubagentName } from "../utils/subagent-display";
import { checkForUpdate, runUpdate, type UpdateCheckResult } from "../utils/update-checker";
import {
  buildSubagentBrowseRows,
  SUBAGENT_EDITOR_FIELDS,
  type SubagentEditorField,
  SubagentEditorModal,
  SubagentsBrowserModal,
} from "./agents-modal";
import { BtwOverlay, type BtwState } from "./components/btw-overlay.js";
import { SuggestionOverlay } from "./components/SuggestionOverlay.js";
import { type TypeaheadState, useTypeahead } from "./hooks/useTypeahead.js";
import { Markdown } from "./markdown";
import { buildMcpBrowseRows, McpBrowserModal, McpEditorModal } from "./mcp-modal";
import { createEmptyMcpEditorDraft, type McpEditorDraft, type McpEditorField } from "./mcp-modal-types";
import {
  changedFiles,
  describeReasoningEffort,
  groupLiveActivity,
  nextPlanStepLabel,
  phaseLabel,
  projectTranscript,
  resolvePlanState,
  type SessionUsageSummary,
  summarizeMemoryStatus,
  summarizeSessionUsage,
  type TranscriptActivityItem,
  type UiActivityEvent,
  upsertActivity,
  visibleRuntimeActivity,
} from "./observability";
import {
  formatPlanAnswers,
  initialPlanQuestionsState,
  type PlanAnswers,
  PlanQuestionsPanel,
  type PlanQuestionsState,
  PlanView,
} from "./plan";
import { buildScheduleBrowseRows, ScheduleBrowserModal } from "./schedule-modal";
import {
  ActiveAgentsStrip,
  type InspectorContextStats,
  type InspectorTab,
  SessionInspector,
  SessionStatusStrip,
  WorkspaceSidebar,
} from "./session-inspector";
import { filterSlashMenuItems, SLASH_MENU_ITEMS, type SlashMenuItem } from "./slash-menu";
import {
  buildAssistantEntry,
  buildToolResultEntry,
  buildUserEntry,
  decorateTelegramEntries,
  getTelegramSourceLabel,
  getUnflushedTelegramAssistantContent,
  replaceTurnEntries,
} from "./telegram-turn-ui";
import { getCompactTuiSelectionText } from "./terminal-selection-text";
import {
  type MotionPreference,
  reducedMotionEnabled,
  resolveTheme,
  type TerminalThemeMode,
  type Theme,
  type ThemePreference,
} from "./theme";
import { resolveWorkspaceLayout } from "./workspace-layout";

const THEME_OPTIONS: ThemePreference[] = ["system", "dark", "light"];
const MOTION_OPTIONS: MotionPreference[] = ["full", "reduced"];

function modeAccent(t: Theme, mode: (typeof MODES)[number]): string {
  return t[mode.tone];
}

function resolvedEntryModeColor(t: Theme, storedColor: string | undefined, fallback: string): string {
  switch (storedColor?.toLowerCase()) {
    case "brand":
    case "#22c55e":
      return t.brand;
    case "info":
    case "#5c9cf5":
      return t.info;
    case "warning":
    case "#e5c07b":
      return t.warning;
    default:
      return storedColor || fallback;
  }
}

type ContextStats = {
  contextWindow: number;
  usedTokens: number;
  remainingTokens: number;
  ratioUsed: number;
  ratioRemaining: number;
};
type PasteBlock = { id: number; content: string; lines: number; isImage?: boolean };
type FileMentionBlock = { id: number; path: string };
type QueuedMessage = { text: string; displayText: string };

function getPasteBlockToken(block: Pick<PasteBlock, "id" | "lines" | "isImage">): string {
  if (block.isImage) {
    return `[Image #${block.id}]`;
  }
  return `[Pasted #${block.id} ${block.lines}+ lines]`;
}

function getFileMentionToken(block: FileMentionBlock): string {
  const name = block.path.split("/").pop() || block.path;
  return `[File: ${name}]`;
}

// Original ShelraCode home mark, copied from the reference checkout. The
// compact raster keeps the welcome screen readable at the common 80-column
// terminal size; the wide mark is reserved for wide terminals.
const WIDE_HERO_LOGO = [
  "███████╗ ██╗  ██╗ ███████╗ ██╗      ██████╗   █████╗       ██████╗  ██████╗  ██████╗  ███████╗",
  "██╔════╝ ██║  ██║ ██╔════╝ ██║      ██╔══██╗ ██╔══██╗     ██╔════╝ ██╔═══██╗ ██╔══██╗ ██╔════╝",
  "███████╗ ███████║ █████╗   ██║      ██████╔╝ ███████║     ██║      ██║   ██║ ██║  ██║ █████╗  ",
  "╚════██║ ██╔══██║ ██╔══╝   ██║      ██╔══██╗ ██╔══██║     ██║      ██║   ██║ ██║  ██║ ██╔══╝  ",
  "███████║ ██║  ██║ ███████╗ ███████╗ ██║  ██║ ██║  ██║     ╚██████╗ ╚██████╔╝ ██████╔╝ ███████╗",
  "╚══════╝ ╚═╝  ╚═╝ ╚══════╝ ╚══════╝ ╚═╝  ╚═╝ ╚═╝  ╚═╝      ╚═════╝  ╚═════╝  ╚═════╝  ╚══════╝",
] as const;

const COMPACT_HERO_LOGO = [
  "░░░░ ░░░░ ░░░░ ░░░░ ░░░░ ░░░░ ░░░ ░░░░ ░░░░ ░░░░ ░░░░",
  "░███ █░░█ ████ █░░░ ███░ ░██░ ░░░ ████ ░██░ ███░ ████",
  "█    █░░█ █    █░░░ █  █ █  █ ░░░ █    █  █ █  █ █   ",
  " ██░ ████ ███░ █░░░ ███  ████ ░░░ █░░░ █░░█ █░░█ ███░",
  "░  █ █  █ █  ░ █░░░ █  █ █  █ ░░░ █░░░ █░░█ █░░█ █  ░",
  "███  █░░█ ████ ████ █░░█ █░░█ ░░░ ████  ██  ███  ████",
  "   ░  ░░             ░░   ░░  ░░░      ░  ░    ░     ",
  "░░░░ ░░░░ ░░░░ ░░░░ ░░░░ ░░░░ ░░░ ░░░░ ░░░░ ░░░░ ░░░░",
] as const;

function HeroLogo({ t, width }: { t: Theme; width: number }) {
  const logo = width >= 110 ? WIDE_HERO_LOGO : width >= 58 ? COMPACT_HERO_LOGO : [];

  if (logo.length === 0) return null;

  return (
    <box flexDirection="column" alignItems="center">
      {logo.map((line, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static logo rows never reorder
        <text key={index} style={{ fg: t.primary }} wrapMode="none">
          {line}
        </text>
      ))}
    </box>
  );
}

const SPLIT = {
  topLeft: "",
  bottomLeft: "",
  vertical: "┃",
  topRight: "",
  bottomRight: "",
  horizontal: " ",
  bottomT: "",
  topT: "",
  cross: "",
  leftT: "",
  rightT: "",
};
const _SPLIT_END = { ...SPLIT, bottomLeft: "╹" };
const _EMPTY = {
  topLeft: "",
  bottomLeft: "",
  vertical: "",
  topRight: "",
  bottomRight: "",
  horizontal: " ",
  bottomT: "",
  topT: "",
  cross: "",
  leftT: "",
  rightT: "",
};
const _LINE = {
  topLeft: "━",
  bottomLeft: "━",
  vertical: "",
  topRight: "━",
  bottomRight: "━",
  horizontal: "━",
  bottomT: "━",
  topT: "━",
  cross: "━",
  leftT: "━",
  rightT: "━",
};

const REVIEW_PROMPT = `Review all current changes in this repository. Follow these steps:

1. Run \`git status\` to see which files have been modified, staged, or are untracked.
2. Run \`git diff\` to see unstaged changes and \`git diff --cached\` to see staged changes.
3. If there are no changes at all, say so and stop.
4. Read any changed files in full if needed for context.

Then produce a **Review Report** in this exact structure:

## Summary
One paragraph overview of what changed and why (inferred from the diff).

## Files Changed
For each changed file, list the filename and a brief description of the change.

## Issues Found
List any bugs, logic errors, security concerns, missing error handling, or correctness problems. If none, say "No issues found."

## Suggestions
Code quality, naming, performance, and best-practice improvements. If none, say "No suggestions."

## Risk Assessment
Rate the overall risk of these changes as **Low**, **Medium**, or **High** with a short justification.`;

const COMMIT_PUSH_PROMPT = `Create a git commit for the current repository changes and push the current branch to its remote.

Before committing, inspect the current branch. If it is not already a feature branch, create and switch to a new feature branch with a descriptive name based on the changes.

Follow the repository's commit workflow and safety checks. Inspect the current changes, stage any relevant untracked files, create an appropriate commit message, and push the branch if a commit was created. If there is nothing to commit, say so and stop.`;

const COMMIT_PR_PROMPT = `Create a git commit for the current repository changes and open a pull request for the current branch.

Before committing, inspect the current branch. If it is not already a feature branch, create and switch to a new feature branch with a descriptive name based on the changes.

Follow the repository's commit and pull request workflows. Inspect the current changes, stage any relevant untracked files, create an appropriate commit, push the branch if needed, then open a pull request with a concise summary and test plan. Return the pull request URL. If there is nothing to commit or open in a pull request, explain why and stop.`;

const BUILTIN_TYPED_SLASH_COMMANDS = new Set([
  "/clear",
  "/model",
  "/models",
  "/sandbox",
  "/recap",
  "/recaps",
  "/remote-control",
  "/mcp",
  "/mcps",
  "/agents",
  "/agent",
  "/status",
  "/tasks",
  "/delegations",
  "/schedule",
  "/schedules",
  "/quit",
  "/exit",
  "/q",
  "/review",
  "/verify",
  "/commit-push",
  "/commit-pr",
  "/wallet",
  "/btw",
]);

interface SandboxRow {
  key: string;
  label: string;
  type: "toggle" | "text";
  placeholder?: string;
  getDisplay: (mode: SandboxMode, s: SandboxSettings) => string;
  getOptions?: () => string[];
  apply: (mode: SandboxMode, s: SandboxSettings, value: string) => { mode?: SandboxMode; settings?: SandboxSettings };
}

const SANDBOX_ROWS: SandboxRow[] = [
  {
    key: "mode",
    label: "Mode",
    type: "toggle",
    getDisplay: (mode) => (mode === "shuru" ? "Shuru" : "Off"),
    getOptions: () => ["Off", "Shuru"],
    apply: (_mode, _s, value) => ({ mode: value === "Shuru" ? "shuru" : "off" }),
  },
  {
    key: "allowNet",
    label: "Network",
    type: "toggle",
    getDisplay: (_m, s) => (s.allowNet ? "On" : "Off"),
    getOptions: () => ["Off", "On"],
    apply: (_m, _s, value) => ({ settings: { allowNet: value === "On" } }),
  },
  {
    key: "allowedHosts",
    label: "Allowed hosts",
    type: "text",
    placeholder: "api.openai.com, registry.npmjs.org",
    getDisplay: (_m, s) => s.allowedHosts?.join(", ") || "(unrestricted)",
    apply: (_m, _s, value) => ({
      settings: {
        allowedHosts: value
          ? value
              .split(",")
              .map((h) => h.trim())
              .filter(Boolean)
          : undefined,
      },
    }),
  },
  {
    key: "ports",
    label: "Port forwards",
    type: "text",
    placeholder: "8080:80, 8443:443",
    getDisplay: (_m, s) => s.ports?.join(", ") || "(none)",
    apply: (_m, _s, value) => ({
      settings: {
        ports: value
          ? value
              .split(",")
              .map((p) => p.trim())
              .filter(Boolean)
          : undefined,
      },
    }),
  },
  {
    key: "cpus",
    label: "CPUs",
    type: "text",
    placeholder: "e.g. 4",
    getDisplay: (_m, s) => (s.cpus ? String(s.cpus) : "(default)"),
    apply: (_m, _s, value) => ({ settings: { cpus: value ? parseInt(value, 10) || undefined : undefined } }),
  },
  {
    key: "memory",
    label: "Memory (MB)",
    type: "text",
    placeholder: "e.g. 4096",
    getDisplay: (_m, s) => (s.memory ? String(s.memory) : "(default)"),
    apply: (_m, _s, value) => ({ settings: { memory: value ? parseInt(value, 10) || undefined : undefined } }),
  },
  {
    key: "diskSize",
    label: "Disk size (MB)",
    type: "text",
    placeholder: "e.g. 8192",
    getDisplay: (_m, s) => (s.diskSize ? String(s.diskSize) : "(default)"),
    apply: (_m, _s, value) => ({ settings: { diskSize: value ? parseInt(value, 10) || undefined : undefined } }),
  },
  {
    key: "from",
    label: "Checkpoint",
    type: "text",
    placeholder: "checkpoint name",
    getDisplay: (_m, s) => s.from || "(none)",
    apply: (_m, _s, value) => ({ settings: { from: value || undefined } }),
  },
];

function getSandboxVisibleRows(mode: SandboxMode): SandboxRow[] {
  return mode === "shuru" ? SANDBOX_ROWS : SANDBOX_ROWS.slice(0, 1);
}

const RECAP_OPTIONS = ["Off", "On"] as const;

function formatRecapsEnabled(enabled: boolean): (typeof RECAP_OPTIONS)[number] {
  return enabled ? "On" : "Off";
}

interface WalletDisplayInfo {
  address: string | null;
  ethBalance: string | null;
  usdcBalance: string | null;
}

interface WalletRow {
  key: string;
  label: string;
  type: "toggle" | "readonly";
  getDisplay: (settings: Required<PaymentSettings>, info: WalletDisplayInfo) => string;
  getOptions?: () => string[];
  apply?: (settings: Required<PaymentSettings>, value: string) => Partial<PaymentSettings>;
}

const WALLET_ROWS: WalletRow[] = [
  {
    key: "enabled",
    label: "Payments",
    type: "toggle",
    getDisplay: (s) => (s.enabled ? "enabled" : "disabled"),
    getOptions: () => ["enabled", "disabled"],
    apply: (_s, v) => ({ enabled: v === "enabled" }),
  },
  {
    key: "chain",
    label: "Chain",
    type: "toggle",
    getDisplay: (s) => s.chain,
    getOptions: () => ["base-sepolia", "base"] as PaymentChain[],
    apply: (_s, v) => ({ chain: v as PaymentChain }),
  },
  {
    key: "autoApprove",
    label: "Auto-approve",
    type: "toggle",
    getDisplay: (s) => (s.approval.autoApprove ? "on" : "off"),
    getOptions: () => ["off", "on"],
    apply: (s, v) => ({ approval: { ...s.approval, autoApprove: v === "on" } }),
  },
  {
    key: "address",
    label: "Address",
    type: "readonly",
    getDisplay: (_s, info) => info.address ?? "No wallet",
  },
  {
    key: "eth",
    label: "ETH",
    type: "readonly",
    getDisplay: (_s, info) => info.ethBalance ?? "...",
  },
  {
    key: "usdc",
    label: "USDC",
    type: "readonly",
    getDisplay: (_s, info) => info.usdcBalance ?? "...",
  },
];

function parseCustomSubagentSlashCommand(
  cmd: string,
  subagents: CustomSubagentConfig[],
): { agentName: string; prompt: string } | null {
  const trimmed = cmd.trim();
  if (!trimmed.startsWith("/")) return null;

  const body = trimmed.slice(1).trim();
  if (!body) return null;

  const commandToken = body.split(/\s+/, 1)[0]?.toLowerCase();
  if (commandToken && BUILTIN_TYPED_SLASH_COMMANDS.has(`/${commandToken}`)) {
    return null;
  }

  const lowerBody = body.toLowerCase();
  const sortedSubagents = [...subagents].sort((a, b) => b.name.length - a.name.length);
  const match = sortedSubagents.find((item) => {
    const lowerName = item.name.trim().toLowerCase();
    return lowerBody === lowerName || lowerBody.startsWith(`${lowerName} `);
  });
  if (!match) return null;

  return {
    agentName: match.name,
    prompt: body.slice(match.name.length).trim(),
  };
}

function buildCustomSubagentSlashPrompt(agentName: string, prompt: string): string {
  return `Use the custom sub-agent "${agentName}" for this task.

Delegate the work with the \`task\` tool using:
- \`agent\`: "${agentName}"
- \`description\`: a short summary of the work
- \`prompt\`: a detailed prompt based on the user's request

User request:
${prompt}`;
}

const CONNECT_CHANNELS: { id: string; label: string; description: string }[] = [
  { id: "telegram", label: "Telegram", description: "Chat with ShelraCode from Telegram" },
];

const MCP_REMOTE_FIELDS: McpEditorField[] = ["transport", "label", "url", "headers", "env"];
const MCP_STDIO_FIELDS: McpEditorField[] = ["transport", "label", "command", "args", "cwd", "env"];

export interface AppStartupConfig {
  apiKey: string | undefined;
  baseURL: string;
  model: string;
  sandboxMode: SandboxMode;
  sandboxSettings: SandboxSettings;
  maxToolRounds: number;
  version: string;
  localModels?: ModelInfo[];
  onSelectLocalModel?: (modelId: string) => Promise<{ success: boolean; error?: string }>;
  onApiKey?: (apiKey: string) => Promise<{ success: boolean; error?: string }>;
}

interface AppProps {
  agent: Agent;
  startupConfig: AppStartupConfig;
  initialMessage?: string;
  onExit?: () => void;
}

interface ActiveTurnState {
  kind: "local" | "telegram";
  agent: Agent;
  modeColor?: string;
  remoteKey?: string;
  sourceLabel?: string;
  userId?: number;
  latestAssistantText: string;
  flushedAssistantChars: number;
}

export function App({ agent, startupConfig, initialMessage, onExit }: AppProps) {
  const renderer = useRenderer();
  const [themePreference, setThemePreference] = useState<ThemePreference>(() => loadAppearancePreference());
  const [motionPreference, setMotionPreference] = useState<MotionPreference>(() => loadMotionPreference());
  const [systemTheme, setSystemTheme] = useState<TerminalThemeMode>(() => renderer.themeMode ?? "dark");
  const t = resolveTheme(themePreference, systemTheme);
  const reducedMotion = reducedMotionEnabled(motionPreference, process.env);

  useEffect(() => {
    const onThemeMode = (next: "dark" | "light") => setSystemTheme(next);
    renderer.on("theme_mode", onThemeMode);
    return () => {
      renderer.off("theme_mode", onThemeMode);
    };
  }, [renderer]);
  const initialHasApiKey = agent.hasApiKey();
  const [hasApiKey, setHasApiKey] = useState(initialHasApiKey);
  const [messages, setMessages] = useState<ChatEntry[]>(() => agent.getChatEntries());
  const [streamContent, setStreamContent] = useState("");
  const [_streamReasoning, setStreamReasoning] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [liveTurnSourceLabel, setLiveTurnSourceLabel] = useState<string | null>(null);
  const [model, setModel] = useState(agent.getModel());
  const [sandboxMode, setSandboxModeState] = useState<SandboxMode>(agent.getSandboxMode());
  const [mode, setModeState] = useState<AgentMode>(agent.getMode());
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [switchingModel, setSwitchingModel] = useState(false);
  const [modelSwitchError, setModelSwitchError] = useState<string | null>(null);
  const [modelPickerIndex, setModelPickerIndex] = useState(0);
  const [modelSearchQuery, setModelSearchQuery] = useState("");
  const [showSandboxPicker, setShowSandboxPicker] = useState(false);
  const [sandboxSettings, setSandboxSettingsState] = useState<SandboxSettings>(() => agent.getSandboxSettings());
  const [sandboxSettingsFocusIndex, setSandboxSettingsFocusIndex] = useState(0);
  const [sandboxSettingsEditing, setSandboxSettingsEditing] = useState<string | null>(null);
  const [sandboxSettingsEditBuffer, setSandboxSettingsEditBuffer] = useState("");
  const [showRecapPicker, setShowRecapPicker] = useState(false);
  const [recapsEnabled, setRecapsEnabledState] = useState(() => agent.getRecapsEnabled());
  const [showThemePicker, setShowThemePicker] = useState(false);
  const [themePickerIndex, setThemePickerIndex] = useState(0);
  const [showEffortPicker, setShowEffortPicker] = useState(false);
  const [reasoningEffort, setReasoningEffortState] = useState<ReasoningEffort | null>(() => agent.getReasoningEffort());
  const [showWalletPicker, setShowWalletPicker] = useState(false);
  const [walletSettings, setWalletSettings] = useState<Required<PaymentSettings>>(() => loadPaymentSettings());
  const [walletFocusIndex, setWalletFocusIndex] = useState(0);
  const [walletDisplayInfo, setWalletDisplayInfo] = useState<WalletDisplayInfo>({
    address: null,
    ethBalance: null,
    usdcBalance: null,
  });
  const [pendingPaymentApproval, setPendingPaymentApproval] = useState<{
    url: string;
    description: string;
    security: string;
    securityLabel: string;
    securityUrl: string;
    amount: string;
    network: string;
    asset: string;
    approvalId?: string;
    selected: number;
  } | null>(null);
  const [activeToolCalls, setActiveToolCalls] = useState<ToolCall[]>([]);
  const [sessionTitle, setSessionTitle] = useState<string | null>(() => agent.getSessionTitle());
  const [sessionId, setSessionId] = useState<string | null>(() => agent.getSessionId());
  const [sessionRecap, setSessionRecap] = useState<string | null>(() => agent.getSessionRecap());
  const [showApiKeyModal, setShowApiKeyModal] = useState(() => !initialHasApiKey);
  const [apiKeyError, setApiKeyError] = useState<string | null>(null);
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [slashMenuIndex, setSlashMenuIndex] = useState(0);
  const [slashSearchQuery, setSlashSearchQuery] = useState("");
  const [btwState, setBtwState] = useState<BtwState | null>(null);
  const btwAbortRef = useRef<AbortController | null>(null);
  const btwStateRef = useRef<BtwState | null>(null);
  const [reasoningEffortByModel, setReasoningEffortByModel] = useState<Record<string, ReasoningEffort>>(() =>
    Object.fromEntries(
      Object.entries(loadUserSettings().reasoningEffortByModel ?? {}).map(([modelId, effort]) => [
        normalizeModelId(modelId),
        effort,
      ]),
    ),
  );
  const [pasteBlocks, setPasteBlocks] = useState<PasteBlock[]>([]);
  const [activePlan, setActivePlan] = useState<Plan | null>(null);
  const [publishedPlan, setPublishedPlan] = useState<Plan | null>(() => findLatestPlan(agent.getChatEntries()));
  const [kernelState, setKernelState] = useState<KernelState | null>(() => agent.getKernelState());
  const [activityEvents, setActivityEvents] = useState<UiActivityEvent[]>([]);
  const [usageSummary, setUsageSummary] = useState<SessionUsageSummary>(() =>
    summarizeSessionUsage(agent.getSessionUsage()),
  );
  const [showInspector, setShowInspector] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("overview");
  /** Incremented on each successful TUI copy; drives a brief "Copied" banner. */
  const [copyFlashId, setCopyFlashId] = useState(0);
  const [expandedMessages, setExpandedMessages] = useState<Set<number>>(() => new Set());
  const [activeSubagent, setActiveSubagent] = useState<SubagentStatus | null>(null);
  const [activeSubagentStartedAt, setActiveSubagentStartedAt] = useState<number | null>(null);
  /**
   * When the foreground sub-agent last reported a new action. Set from real `onSubagentStatus`
   * emissions (one per child tool call) — never a synthetic heartbeat — and consumed by the
   * three-tier disclosure rule in `resolveAgentDisclosure` (docs/migration/14-AGENT-HARNESS-RECONSTRUCTION.md §19).
   */
  const [activeSubagentActivityAt, setActiveSubagentActivityAt] = useState<number | null>(null);
  const [delegations, setDelegations] = useState<DelegationRun[]>([]);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [pqs, setPqs] = useState<PlanQuestionsState>(initialPlanQuestionsState());
  const pasteCounterRef = useRef(0);
  const pasteBlocksRef = useRef<PasteBlock[]>([]);
  const apiKeyInputRef = useRef<TextareaRenderable>(null);
  const inputRef = useRef<TextareaRenderable>(null);
  const scrollRef = useRef<ScrollBoxRenderable>(null);
  const { width, height } = useTerminalDimensions();
  const processedInitial = useRef(false);
  const contentAccRef = useRef("");
  const startTimeRef = useRef(0);
  const sessionStartedAtRef = useRef(agent.getSessionInfo()?.createdAt.getTime() ?? Date.now());
  const isProcessingRef = useRef(false);
  const hasApiKeyRef = useRef(initialHasApiKey);
  const showApiKeyModalRef = useRef(!initialHasApiKey);
  const showInspectorRef = useRef(false);
  const queuedMessagesRef = useRef<QueuedMessage[]>([]);
  const processMessageRef = useRef<(text: string, displayText?: string) => Promise<void> | void>(() => {});
  const [queuedMessages, setQueuedMessages] = useState<string[]>([]);
  const modeInfoRef = useRef<(typeof MODES)[number]>(MODES[0]);
  const activeRunIdRef = useRef(0);
  const interruptedRunIdRef = useRef<number | null>(null);
  const activeTurnRef = useRef<ActiveTurnState | null>(null);
  const coordinatorRef = useRef(createTurnCoordinator());
  const bridgeRef = useRef<TelegramBridgeHandle | null>(null);
  const telegramAgentsRef = useRef<Map<number, Agent>>(new Map());
  const telegramEntryCountsRef = useRef<Map<number, number>>(new Map());
  const telegramSubagentUnsubsRef = useRef<Map<number, () => void>>(new Map());
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [showTelegramTokenModal, setShowTelegramTokenModal] = useState(false);
  const [showTelegramPairModal, setShowTelegramPairModal] = useState(false);
  const [telegramTokenError, setTelegramTokenError] = useState<string | null>(null);
  const [telegramPairError, setTelegramPairError] = useState<string | null>(null);
  const [connectModalIndex, setConnectModalIndex] = useState(0);
  const telegramTokenInputRef = useRef<TextareaRenderable>(null);
  const telegramPairInputRef = useRef<TextareaRenderable>(null);
  const showConnectModalRef = useRef(false);
  const showTelegramTokenModalRef = useRef(false);
  const showTelegramPairModalRef = useRef(false);
  const [showMcpModal, setShowMcpModal] = useState(false);
  const [showMcpEditor, setShowMcpEditor] = useState(false);
  const [mcpSearchQuery, setMcpSearchQuery] = useState("");
  const [mcpModalIndex, setMcpModalIndex] = useState(0);
  const [mcpServers, setMcpServers] = useState<McpServerConfig[]>(() => loadMcpServers());
  const [mcpEditorDraft, setMcpEditorDraft] = useState<McpEditorDraft>(createEmptyMcpEditorDraft());
  const [mcpEditorField, setMcpEditorField] = useState<McpEditorField>("transport");
  const [mcpEditorSyncKey, setMcpEditorSyncKey] = useState(0);
  const [mcpEditorError, setMcpEditorError] = useState<string | null>(null);
  const [editingMcpId, setEditingMcpId] = useState<string | null>(null);
  const showMcpModalRef = useRef(false);
  const showMcpEditorRef = useRef(false);
  const mcpLabelRef = useRef<TextareaRenderable>(null);
  const mcpUrlRef = useRef<TextareaRenderable>(null);
  const mcpHeadersRef = useRef<TextareaRenderable>(null);
  const mcpCommandRef = useRef<TextareaRenderable>(null);
  const mcpArgsRef = useRef<TextareaRenderable>(null);
  const mcpCwdRef = useRef<TextareaRenderable>(null);
  const mcpEnvRef = useRef<TextareaRenderable>(null);
  const [showAgentsModal, setShowAgentsModal] = useState(false);
  const [showAgentsEditor, setShowAgentsEditor] = useState(false);
  const [subAgents, setSubAgents] = useState<CustomSubagentConfig[]>(() => loadValidSubAgents());
  const [agentsSearchQuery, setAgentsSearchQuery] = useState("");
  const [agentsModalIndex, setAgentsModalIndex] = useState(0);
  const [editingSubagent, setEditingSubagent] = useState<CustomSubagentConfig | null>(null);
  const [agentsEditorDraft, setAgentsEditorDraft] = useState({ name: "", instruction: "" });
  const [agentsEditorField, setAgentsEditorField] = useState<SubagentEditorField>("name");
  const [agentsEditorModelIndex, setAgentsEditorModelIndex] = useState(0);
  const [agentsEditorSyncKey, setAgentsEditorSyncKey] = useState(0);
  const [agentsEditorError, setAgentsEditorError] = useState<string | null>(null);
  const showAgentsModalRef = useRef(false);
  const showAgentsEditorRef = useRef(false);
  const subagentNameRef = useRef<TextareaRenderable>(null);
  const subagentInstructionRef = useRef<TextareaRenderable>(null);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [schedules, setSchedules] = useState<StoredSchedule[]>([]);
  const [scheduleSearchQuery, setScheduleSearchQuery] = useState("");
  const [scheduleModalIndex, setScheduleModalIndex] = useState(0);
  const showScheduleModalRef = useRef(false);

  const [updateInfo, setUpdateInfo] = useState<UpdateCheckResult | null>(null);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateOutput, setUpdateOutput] = useState<string | null>(null);
  const showUpdateModalRef = useRef(false);

  const fileIndexRef = useRef<FileIndex | null>(null);
  if (!fileIndexRef.current) {
    fileIndexRef.current = new FileIndex(agent.getCwd());
  }
  const fileMentionCounterRef = useRef(0);
  const fileMentionBlocksRef = useRef<FileMentionBlock[]>([]);

  const handleFileAccept = useCallback((filePath: string, tokenInfo: { startPos: number; endPos: number }) => {
    const ta = inputRef.current;
    if (!ta) return;

    const id = ++fileMentionCounterRef.current;
    const block: FileMentionBlock = { id, path: fileIndexRef.current?.resolvePath(filePath) ?? filePath };
    fileMentionBlocksRef.current = [...fileMentionBlocksRef.current, block];

    const text = ta.plainText;
    const before = text.slice(0, tokenInfo.startPos);
    const after = text.slice(tokenInfo.endPos);
    const token = getFileMentionToken(block);
    const newText = `${before}${token} ${after}`;
    ta.setText(newText);
    ta.cursorOffset = before.length + token.length + 1;
  }, []);

  const typeahead = useTypeahead(inputRef, fileIndexRef.current, handleFileAccept);
  const typeaheadRef = useRef(typeahead);
  typeaheadRef.current = typeahead;

  const setMode = useCallback(
    (m: AgentMode) => {
      if (m === "agent" && mode === "plan" && activePlan) {
        const planText = [
          `# ${activePlan.title}`,
          activePlan.summary,
          ...(activePlan.goal ? ["", `Goal: ${activePlan.goal}`] : []),
          ...(activePlan.requirements?.length
            ? [
                "",
                "Requirements:",
                ...activePlan.requirements.map((requirement, index) => `R${index + 1}. ${requirement}`),
              ]
            : []),
          ...(activePlan.acceptanceCriteria?.length
            ? [
                "",
                "Acceptance criteria:",
                ...activePlan.acceptanceCriteria.map(
                  (criterion) => `${criterion.id}. ${criterion.description} (verify: ${criterion.verification})`,
                ),
              ]
            : []),
          "",
          ...activePlan.steps.map(
            (s, i) =>
              `${i + 1}. ${s.title}: ${s.description}${s.filePaths?.length ? ` (${s.filePaths.join(", ")})` : ""}${
                s.satisfies?.length ? ` [satisfies: ${s.satisfies.join(", ")}]` : ""
              }`,
          ),
        ].join("\n");
        agent.setPlanContext(planText);
      }
      agent.setMode(m);
      setModeState(m);
      setModel(agent.getModel());
    },
    [agent, mode, activePlan],
  );
  const cycleMode = useCallback(() => {
    const idx = MODES.findIndex((m) => m.id === mode);
    setMode(MODES[(idx + 1) % MODES.length].id);
  }, [mode, setMode]);

  const modeInfo = MODES.find((m) => m.id === mode)!;
  modeInfoRef.current = modeInfo;
  const modelInfo = agent.getModelInfo() ?? getModelInfo(model);
  const contextStats = modelInfo ? agent.getContextStats(modelInfo.contextWindow, streamContent) : null;
  const memoryStatus = summarizeMemoryStatus(readMemoryIndex(projectMemoryScope(agent.getCwd())));
  const modelCatalog = useMemo(
    () =>
      [...(startupConfig.localModels ?? [])].sort((a, b) => {
        const aCloud = a.category === "cloud";
        const bCloud = b.category === "cloud";
        if (aCloud !== bCloud) return Number(bCloud) - Number(aCloud);
        const aFree = aCloud && a.pricingKnown !== false && a.inputPrice === 0 && a.outputPrice === 0;
        const bFree = bCloud && b.pricingKnown !== false && b.inputPrice === 0 && b.outputPrice === 0;
        return Number(bFree) - Number(aFree) || a.name.localeCompare(b.name);
      }),
    [startupConfig.localModels],
  );
  const filteredModels = modelSearchQuery
    ? modelCatalog.filter(
        (m) =>
          m.name.toLowerCase().includes(modelSearchQuery.toLowerCase()) ||
          m.id.toLowerCase().includes(modelSearchQuery.toLowerCase()),
      )
    : modelCatalog;
  const filteredModelIds = filteredModels.map((m) => m.id);
  const selectLocalModel = useCallback(
    /** Resolves true only when the model is actually switched. */
    async (modelId: string): Promise<boolean> => {
      if (switchingModel) return false;
      setModelSwitchError(null);
      setSwitchingModel(true);
      try {
        const result = startupConfig.onSelectLocalModel
          ? await startupConfig.onSelectLocalModel(modelId)
          : { success: true };
        if (!result.success) {
          setModelSwitchError(result.error || "The local model could not be prepared.");
          return false;
        }
        agent.setModel(modelId);
        setModel(modelId);
        saveProjectSettings({ model: modelId });
        saveUserSettings({ defaultModel: modelId });
        return true;
      } finally {
        setSwitchingModel(false);
      }
    },
    [agent, startupConfig.onSelectLocalModel, switchingModel],
  );
  const filteredSlashItems = filterSlashMenuItems(SLASH_MENU_ITEMS, slashSearchQuery);
  const mcpRows = buildMcpBrowseRows(mcpServers, POPULAR_MCP_CATALOG, mcpSearchQuery);
  const mcpEditorFields = mcpEditorDraft.transport === "stdio" ? MCP_STDIO_FIELDS : MCP_REMOTE_FIELDS;
  const agentRows = useMemo(
    () => buildSubagentBrowseRows(subAgents, agentsSearchQuery),
    [subAgents, agentsSearchQuery],
  );
  const scheduleRows = useMemo(
    () => buildScheduleBrowseRows(schedules, scheduleSearchQuery),
    [schedules, scheduleSearchQuery],
  );

  const syncStoredMcpServers = useCallback((servers: McpServerConfig[]) => {
    setMcpServers(servers);
    saveMcpServers(servers);
  }, []);

  const applySandboxMode = useCallback(
    (next: SandboxMode) => {
      agent.setSandboxMode(next);
      for (const telegramAgent of telegramAgentsRef.current.values()) {
        telegramAgent.setSandboxMode(next);
      }
      setSandboxModeState(next);
      saveProjectSettings({ sandboxMode: next });
      saveUserSettings({ sandboxMode: next });
    },
    [agent],
  );

  const applySandboxSettings = useCallback(
    (next: SandboxSettings) => {
      agent.setSandboxSettings(next);
      for (const telegramAgent of telegramAgentsRef.current.values()) {
        telegramAgent.setSandboxSettings(next);
      }
      setSandboxSettingsState(next);
      saveProjectSettings({ sandbox: next });
      saveUserSettings({ sandbox: next });
    },
    [agent],
  );

  const openSandboxPicker = useCallback(() => {
    setSandboxSettingsFocusIndex(0);
    setSandboxSettingsEditing(null);
    setSandboxSettingsEditBuffer("");
    setShowSandboxPicker(true);
  }, []);

  const applyRecapsEnabled = useCallback(
    (enabled: boolean) => {
      agent.setRecapsEnabled(enabled);
      for (const telegramAgent of telegramAgentsRef.current.values()) {
        telegramAgent.setRecapsEnabled(enabled);
      }
      setRecapsEnabledState(enabled);
      saveRecapsEnabled(enabled);
      setSessionRecap(agent.getSessionRecap());
    },
    [agent],
  );

  const openRecapPicker = useCallback(() => {
    setShowRecapPicker(true);
  }, []);

  const applyThemePreference = useCallback((preference: ThemePreference) => {
    setThemePreference(preference);
    saveUserSettings({ appearance: preference });
  }, []);

  const applyMotionPreference = useCallback((preference: MotionPreference) => {
    setMotionPreference(preference);
    saveUserSettings({ motion: preference });
  }, []);

  const openThemePicker = useCallback(() => {
    setThemePickerIndex(0);
    setShowSlashMenu(false);
    setSlashSearchQuery("");
    setShowThemePicker(true);
  }, []);

  const applyReasoningEffort = useCallback(
    (effort: ReasoningEffort | null) => {
      agent.setReasoningEffort(effort);
      for (const telegramAgent of telegramAgentsRef.current.values()) {
        telegramAgent.setReasoningEffort(effort);
      }
      setReasoningEffortState(effort);
      saveUserSettings({ reasoningEffort: effort ?? undefined });
    },
    [agent],
  );

  const openEffortPicker = useCallback(() => {
    setShowEffortPicker(true);
  }, []);

  const applyWalletSettings = useCallback((next: Required<PaymentSettings>) => {
    setWalletSettings(next);
    savePaymentSettings(next);
  }, []);

  const openWalletPicker = useCallback(() => {
    setWalletFocusIndex(0);
    setWalletSettings(loadPaymentSettings());
    setShowWalletPicker(true);
    setWalletDisplayInfo({ address: null, ethBalance: null, usdcBalance: null });
    import("../wallet/manager")
      .then(async ({ WalletManager }) => {
        if (!WalletManager.exists()) {
          setWalletDisplayInfo({ address: null, ethBalance: null, usdcBalance: null });
          return;
        }
        const wm = new WalletManager();
        const data = wm.getWalletData();
        setWalletDisplayInfo({ address: data.address, ethBalance: null, usdcBalance: null });
        const balance = await wm.getBalance();
        setWalletDisplayInfo({
          address: balance.address,
          ethBalance: balance.nativeBalance,
          usdcBalance: balance.usdcBalance,
        });
      })
      .catch(() => {});
  }, []);

  const setReasoningEfforts = useCallback((next: Record<string, ReasoningEffort>) => {
    setReasoningEffortByModel(next);
    saveUserSettings({ reasoningEffortByModel: next });
  }, []);

  const replacePasteBlocks = useCallback((next: PasteBlock[]) => {
    pasteBlocksRef.current = next;
    setPasteBlocks(next);
  }, []);

  const getModelReasoningEffort = useCallback(
    (modelId: string): ReasoningEffort | undefined => {
      const normalizedModelId = normalizeModelId(modelId);
      return getEffectiveReasoningEffort(normalizedModelId, reasoningEffortByModel[normalizedModelId]);
    },
    [reasoningEffortByModel],
  );

  const adjustModelReasoningEffort = useCallback(
    (modelId: string, direction: -1 | 1) => {
      const normalizedModelId = normalizeModelId(modelId);
      const supported = getSupportedReasoningEfforts(normalizedModelId);
      if (supported.length === 0) return;

      const current = getModelReasoningEffort(normalizedModelId);

      if (!current) {
        if (direction > 0) {
          setReasoningEfforts({ ...reasoningEffortByModel, [normalizedModelId]: supported[0] });
        }
        return;
      }

      const currentIndex = supported.indexOf(current);
      if (direction < 0 && currentIndex <= 0) {
        const { [normalizedModelId]: _, ...rest } = reasoningEffortByModel;
        setReasoningEfforts(rest);
      } else {
        const nextIndex = direction < 0 ? currentIndex - 1 : Math.min(supported.length - 1, currentIndex + 1);
        setReasoningEfforts({ ...reasoningEffortByModel, [normalizedModelId]: supported[nextIndex] });
      }
    },
    [getModelReasoningEffort, reasoningEffortByModel, setReasoningEfforts],
  );

  const snapshotMcpEditorDraft = useCallback((): McpEditorDraft => {
    return {
      ...mcpEditorDraft,
      label: mcpLabelRef.current?.plainText ?? mcpEditorDraft.label,
      url: mcpUrlRef.current?.plainText ?? mcpEditorDraft.url,
      headersText: mcpHeadersRef.current?.plainText ?? mcpEditorDraft.headersText,
      command: mcpCommandRef.current?.plainText ?? mcpEditorDraft.command,
      argsText: mcpArgsRef.current?.plainText ?? mcpEditorDraft.argsText,
      cwd: mcpCwdRef.current?.plainText ?? mcpEditorDraft.cwd,
      envText: mcpEnvRef.current?.plainText ?? mcpEditorDraft.envText,
    };
  }, [mcpEditorDraft]);

  const openMcpModal = useCallback(() => {
    const latest = loadMcpServers();
    setMcpServers(latest);
    setMcpSearchQuery("");
    setMcpModalIndex(0);
    setShowMcpModal(true);
    setShowMcpEditor(false);
    setEditingMcpId(null);
    setMcpEditorError(null);
  }, []);

  const openMcpEditor = useCallback((draft: McpEditorDraft, editingId: string | null = null) => {
    setMcpEditorDraft(draft);
    setEditingMcpId(editingId);
    setMcpEditorField("transport");
    setMcpEditorError(null);
    setMcpEditorSyncKey((n) => n + 1);
    setShowMcpEditor(true);
    setShowMcpModal(true);
  }, []);

  const openCatalogMcp = useCallback(
    (entry: (typeof POPULAR_MCP_CATALOG)[number]) => {
      const existing = mcpServers.find((server) => toMcpServerId(server.id) === toMcpServerId(entry.id));
      if (existing) {
        openMcpEditor(
          {
            label: existing.label,
            transport: existing.transport,
            url: existing.url ?? "",
            headersText: Object.entries(existing.headers ?? {})
              .map(([key, value]) => `${key}: ${value}`)
              .join("\n"),
            command: existing.command ?? "",
            argsText: (existing.args ?? []).join("\n"),
            cwd: existing.cwd ?? "",
            envText: Object.entries(existing.env ?? {})
              .map(([key, value]) => `${key}=${value}`)
              .join("\n"),
          },
          existing.id,
        );
        return;
      }
      openMcpEditor({
        ...createEmptyMcpEditorDraft(),
        label: entry.name,
        transport: entry.starterTransport ?? "stdio",
      });
    },
    [mcpServers, openMcpEditor],
  );

  const editSavedMcp = useCallback(
    (server: McpServerConfig) => {
      openMcpEditor(
        {
          label: server.label,
          transport: server.transport,
          url: server.url ?? "",
          headersText: Object.entries(server.headers ?? {})
            .map(([key, value]) => `${key}: ${value}`)
            .join("\n"),
          command: server.command ?? "",
          argsText: (server.args ?? []).join("\n"),
          cwd: server.cwd ?? "",
          envText: Object.entries(server.env ?? {})
            .map(([key, value]) => `${key}=${value}`)
            .join("\n"),
        },
        server.id,
      );
    },
    [openMcpEditor],
  );

  const toggleSavedMcp = useCallback(
    (server: McpServerConfig) => {
      syncStoredMcpServers(
        mcpServers.map((item) => (item.id === server.id ? { ...item, enabled: !item.enabled } : item)),
      );
    },
    [mcpServers, syncStoredMcpServers],
  );

  const deleteSavedMcp = useCallback(
    (server: McpServerConfig) => {
      syncStoredMcpServers(mcpServers.filter((item) => item.id !== server.id));
      setMcpModalIndex((idx) => Math.max(0, Math.min(idx, Math.max(0, mcpRows.length - 2))));
    },
    [mcpRows.length, mcpServers, syncStoredMcpServers],
  );

  const openAgentsModal = useCallback(() => {
    setSubAgents(loadValidSubAgents());
    setAgentsSearchQuery("");
    setAgentsModalIndex(0);
    setEditingSubagent(null);
    setAgentsEditorError(null);
    setShowAgentsEditor(false);
    setShowAgentsModal(true);
  }, []);

  const openScheduleModal = useCallback(() => {
    void agent
      .listSchedules()
      .then((latest) => {
        setSchedules(latest);
        setScheduleSearchQuery("");
        setScheduleModalIndex(0);
        setShowScheduleModal(true);
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        setMessages((prev) => [...prev, buildAssistantEntry(`Failed to load schedules: ${message}`)]);
      });
  }, [agent]);

  const showScheduleDetails = useCallback(
    (schedule: StoredSchedule) => {
      void agent
        .getScheduleDaemonStatus()
        .then((status) => {
          setMessages((prev) => [...prev, buildAssistantEntry(formatScheduleDetails(schedule, status))]);
          setShowScheduleModal(false);
          setScheduleSearchQuery("");
          setTimeout(() => {
            try {
              scrollRef.current?.scrollTo(scrollRef.current?.scrollHeight ?? 99999);
            } catch {
              /* */
            }
          }, 10);
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          setMessages((prev) => [...prev, buildAssistantEntry(`Failed to load schedule details: ${message}`)]);
        });
    },
    [agent],
  );

  const removeSchedule = useCallback(
    (schedule: StoredSchedule) => {
      void agent
        .removeSchedule(schedule.id)
        .then(async (message) => {
          const latest = await agent.listSchedules();
          setSchedules(latest);
          setScheduleModalIndex((index) => Math.max(0, Math.min(index, Math.max(0, latest.length - 1))));
          setMessages((prev) => [...prev, buildAssistantEntry(message)]);
          setTimeout(() => {
            try {
              scrollRef.current?.scrollTo(scrollRef.current?.scrollHeight ?? 99999);
            } catch {
              /* */
            }
          }, 10);
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          setMessages((prev) => [...prev, buildAssistantEntry(`Failed to remove schedule: ${message}`)]);
        });
    },
    [agent],
  );

  const openSubagentEditor = useCallback(
    (agent: CustomSubagentConfig | null) => {
      setEditingSubagent(agent);
      if (agent) {
        setAgentsEditorDraft({ name: agent.name, instruction: agent.instruction });
        setAgentsEditorModelIndex(
          Math.max(
            0,
            modelCatalog.findIndex((model) => model.id === normalizeModelId(agent.model)),
          ),
        );
      } else {
        setAgentsEditorDraft({ name: "", instruction: "" });
        setAgentsEditorModelIndex(0);
      }
      setAgentsEditorField("name");
      setAgentsEditorError(null);
      setAgentsEditorSyncKey((n) => n + 1);
      setShowAgentsEditor(true);
      setShowAgentsModal(true);
    },
    [modelCatalog],
  );

  const submitSubagentEditor = useCallback(() => {
    const name = (subagentNameRef.current?.plainText || "").trim();
    const instruction = subagentInstructionRef.current?.plainText || "";
    const model = modelCatalog[agentsEditorModelIndex]?.id;

    if (!name) {
      setAgentsEditorError("Name is required.");
      return;
    }
    if (isReservedSubagentName(name)) {
      setAgentsEditorError('Names "general" and "explore" are reserved.');
      return;
    }
    if (!model) {
      setAgentsEditorError("Discover a cloud or local model before adding a sub-agent.");
      return;
    }

    const next = [...subAgents];
    if (editingSubagent) {
      const index = next.findIndex((item) => item.name === editingSubagent.name);
      if (index >= 0) next.splice(index, 1);
    }

    if (next.some((item) => item.name.toLowerCase() === name.toLowerCase())) {
      setAgentsEditorError("Another sub-agent already uses this name.");
      return;
    }

    next.push({ name, model, instruction });
    saveUserSettings({ subAgents: next });
    setSubAgents(loadValidSubAgents());
    setShowAgentsEditor(false);
    setEditingSubagent(null);
    setAgentsEditorError(null);
  }, [agentsEditorModelIndex, editingSubagent, modelCatalog, subAgents]);

  const removeEditingSubagent = useCallback(() => {
    if (!editingSubagent) return;

    const next = subAgents.filter((item) => item.name !== editingSubagent.name);
    saveUserSettings({ subAgents: next });
    setSubAgents(loadValidSubAgents());
    setShowAgentsEditor(false);
    setEditingSubagent(null);
    setAgentsEditorError(null);
    setAgentsModalIndex(0);
  }, [editingSubagent, subAgents]);

  const submitMcpEditor = useCallback(() => {
    const draft: McpEditorDraft = {
      label: mcpLabelRef.current?.plainText || "",
      transport: mcpEditorDraft.transport,
      url: mcpUrlRef.current?.plainText || "",
      headersText: mcpHeadersRef.current?.plainText || "",
      command: mcpCommandRef.current?.plainText || "",
      argsText: mcpArgsRef.current?.plainText || "",
      cwd: mcpCwdRef.current?.plainText || "",
      envText: mcpEnvRef.current?.plainText || "",
    };

    const baseId = toMcpServerId(draft.label);
    const currentServers = loadMcpServers();

    const conflictingServer = currentServers.find((s) => s.id === baseId && s.id !== editingMcpId);
    if (conflictingServer) {
      setMcpEditorError(`Only one protocol is supported per MCP. Edit "${conflictingServer.label}" instead.`);
      return;
    }

    const id = editingMcpId ?? baseId;

    const server: McpServerConfig = {
      id,
      label: draft.label.trim(),
      enabled: true,
      transport: draft.transport,
      ...(draft.transport === "stdio"
        ? {
            command: draft.command.trim(),
            args: draft.argsText
              .split("\n")
              .map((line) => line.trim())
              .filter(Boolean),
            cwd: draft.cwd.trim() || undefined,
            env: Object.keys(parseEnvLines(draft.envText)).length ? parseEnvLines(draft.envText) : undefined,
          }
        : {
            url: draft.url.trim(),
            headers: Object.keys(parseHeaderLines(draft.headersText)).length
              ? parseHeaderLines(draft.headersText)
              : undefined,
            env: Object.keys(parseEnvLines(draft.envText)).length ? parseEnvLines(draft.envText) : undefined,
          }),
    };

    const validation = validateMcpServerConfig(server);
    if (!validation.ok) {
      setMcpEditorError(validation.error);
      return;
    }

    const nextServers = editingMcpId
      ? currentServers.map((item) =>
          item.id === editingMcpId ? { ...server, id: editingMcpId, enabled: item.enabled } : item,
        )
      : [...currentServers, server];
    saveMcpServers(nextServers);
    setMcpServers(nextServers);
    setShowMcpEditor(false);
    setEditingMcpId(null);
    setMcpEditorError(null);
    setMcpSearchQuery("");
    setMcpModalIndex(
      Math.max(
        0,
        nextServers.findIndex((item) => item.id === (editingMcpId ?? server.id)),
      ),
    );
  }, [editingMcpId, mcpEditorDraft.transport]);

  const cycleMcpEditorTransport = useCallback(
    (direction: 1 | -1 = 1) => {
      const draft = snapshotMcpEditorDraft();
      const order: Array<McpRemoteTransport | "stdio"> = ["stdio", "http", "sse"];
      const currentIndex = order.indexOf(draft.transport);
      const nextTransport = order[(currentIndex + direction + order.length) % order.length];
      const nextDraft = { ...draft, transport: nextTransport };
      setMcpEditorDraft(nextDraft);
      setMcpEditorField("transport");
      setMcpEditorSyncKey((n) => n + 1);

      if (!editingMcpId) return;

      const existing = mcpServers.find((server) => server.id === editingMcpId);
      if (!existing) return;

      const optimisticServer: McpServerConfig = {
        id: existing.id,
        label: nextDraft.label.trim() || existing.label,
        enabled: existing.enabled,
        transport: nextTransport,
        ...(nextTransport === "stdio"
          ? {
              command: nextDraft.command.trim() || existing.command,
              args: nextDraft.argsText
                .split("\n")
                .map((line) => line.trim())
                .filter(Boolean),
              cwd: nextDraft.cwd.trim() || undefined,
              env: Object.keys(parseEnvLines(nextDraft.envText)).length ? parseEnvLines(nextDraft.envText) : undefined,
            }
          : {
              url: nextDraft.url.trim() || existing.url,
              headers: Object.keys(parseHeaderLines(nextDraft.headersText)).length
                ? parseHeaderLines(nextDraft.headersText)
                : undefined,
              env: Object.keys(parseEnvLines(nextDraft.envText)).length ? parseEnvLines(nextDraft.envText) : undefined,
            }),
      };

      syncStoredMcpServers(mcpServers.map((server) => (server.id === editingMcpId ? optimisticServer : server)));
    },
    [editingMcpId, mcpServers, snapshotMcpEditorDraft, syncStoredMcpServers],
  );

  useEffect(() => {
    if (!showMcpEditor || !editingMcpId) return;

    const existing = mcpServers.find((server) => server.id === editingMcpId);
    if (!existing) return;
    if (existing.transport === mcpEditorDraft.transport) return;

    const syncedServer: McpServerConfig = {
      id: existing.id,
      label: mcpEditorDraft.label.trim() || existing.label,
      enabled: existing.enabled,
      transport: mcpEditorDraft.transport,
      ...(mcpEditorDraft.transport === "stdio"
        ? {
            command: mcpEditorDraft.command.trim() || undefined,
            args: mcpEditorDraft.argsText
              .split("\n")
              .map((line) => line.trim())
              .filter(Boolean),
            cwd: mcpEditorDraft.cwd.trim() || undefined,
            env: Object.keys(parseEnvLines(mcpEditorDraft.envText)).length
              ? parseEnvLines(mcpEditorDraft.envText)
              : undefined,
          }
        : {
            url: mcpEditorDraft.url.trim() || undefined,
            headers: Object.keys(parseHeaderLines(mcpEditorDraft.headersText)).length
              ? parseHeaderLines(mcpEditorDraft.headersText)
              : undefined,
            env: Object.keys(parseEnvLines(mcpEditorDraft.envText)).length
              ? parseEnvLines(mcpEditorDraft.envText)
              : undefined,
          }),
    };

    syncStoredMcpServers(mcpServers.map((server) => (server.id === editingMcpId ? syncedServer : server)));
  }, [editingMcpId, mcpEditorDraft, mcpServers, showMcpEditor, syncStoredMcpServers]);

  useEffect(() => {
    setMcpModalIndex((idx) => Math.max(0, Math.min(idx, Math.max(0, mcpRows.length - 1))));
  }, [mcpRows.length]);

  useEffect(() => {
    setScheduleModalIndex((idx) => Math.max(0, Math.min(idx, Math.max(0, scheduleRows.length - 1))));
  }, [scheduleRows.length]);

  const scrollToBottom = useCallback(() => {
    try {
      scrollRef.current?.scrollTo(scrollRef.current?.scrollHeight ?? 99999);
    } catch {
      /* */
    }
  }, []);

  const clearLiveTurnUi = useCallback(() => {
    setStreamContent("");
    setStreamReasoning("");
    setActiveToolCalls([]);
    setActiveSubagent(null);
    setActiveSubagentStartedAt(null);
    setActiveSubagentActivityAt(null);
    setLiveTurnSourceLabel(null);
    contentAccRef.current = "";
  }, []);

  const syncKernelState = useCallback(() => {
    setKernelState(agent.getKernelState());
    setUsageSummary(summarizeSessionUsage(agent.getSessionUsage()));
  }, [agent]);

  const recordActivity = useCallback((event: UiActivityEvent) => {
    setActivityEvents((current) => upsertActivity(current, event));
  }, []);

  const createProcessObserver = useCallback(
    (runId: number): ProcessMessageObserver => ({
      // Provider/model steps are internal cycles, not meaningful user activity.
      // Usage stays in runtime accounting; "Step N" never enters the chat presentation.
      onStepStart: syncKernelState,
      onStepFinish: syncKernelState,
      onResearch: (info) => {
        recordActivity({
          id: `research:${runId}`,
          kind: "research",
          status: info.success ? "complete" : "failed",
          label: "Repository research",
          detail: `${info.provider} | ${info.sourceCount} source${info.sourceCount === 1 ? "" : "s"}`,
          source: "runtime",
          operation: "research",
          at: info.timestamp,
        });
        syncKernelState();
      },
      onToolStart: (info) => {
        recordActivity({
          id: `tool:${runId}:${info.toolCall.id}`,
          kind: "tool",
          status: "active",
          label: toolLabel(info.toolCall),
          detail: toolActivityDetail(info.toolCall),
          source: "runtime",
          operation: info.toolCall.function.name,
          at: info.timestamp,
        });
        syncKernelState();
      },
      onToolFinish: (info) => {
        recordActivity({
          id: `tool:${runId}:${info.toolCall.id}`,
          kind: "tool",
          status: info.toolResult.success ? "complete" : "failed",
          label: toolLabel(info.toolCall),
          detail: info.toolResult.success
            ? truncateActivity(info.toolResult.output || "completed")
            : truncateActivity(info.toolResult.error || info.toolResult.output || "failed"),
          source: "runtime",
          operation: info.toolCall.function.name,
          at: info.timestamp,
        });
        syncKernelState();
      },
      onError: (info) => {
        recordActivity({
          id: `error:${runId}:${info.timestamp}`,
          kind: "error",
          status: "failed",
          label: "Runtime error",
          detail: info.message,
          source: "runtime",
          operation: "error",
          at: info.timestamp,
        });
        syncKernelState();
      },
    }),
    [recordActivity, syncKernelState],
  );

  useEffect(() => {
    syncKernelState();
    if (!isProcessing) return;
    const id = setInterval(syncKernelState, 100);
    return () => clearInterval(id);
  }, [isProcessing, syncKernelState]);

  useEffect(() => {
    if (!isProcessing && !activeSubagent && !delegations.some((delegation) => delegation.status === "running")) return;
    setNowTick(Date.now());
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [activeSubagent, delegations, isProcessing]);

  const refreshDelegations = useCallback(async () => {
    try {
      setDelegations(await agent.getDelegations());
    } catch {
      // Agent telemetry must not interrupt the conversation surface.
    }
  }, [agent]);

  useEffect(() => {
    void refreshDelegations();
  }, [refreshDelegations]);

  useEffect(() => {
    if (!isProcessing && !delegations.some((delegation) => delegation.status === "running")) return;
    const id = setInterval(() => void refreshDelegations(), 1000);
    return () => clearInterval(id);
  }, [delegations, isProcessing, refreshDelegations]);

  const finishTurnProcessing = useCallback(() => {
    const nextQueued = queuedMessagesRef.current.shift();
    if (nextQueued) {
      setQueuedMessages(queuedMessagesRef.current.map((msg) => msg.displayText));
      isProcessingRef.current = false;
      void processMessageRef.current(nextQueued.text, nextQueued.displayText);
      return;
    }

    isProcessingRef.current = false;
    setIsProcessing(false);
  }, []);

  const beginLiveTurn = useCallback(
    (turn: Omit<ActiveTurnState, "latestAssistantText" | "flushedAssistantChars">) => {
      clearLiveTurnUi();
      activeTurnRef.current = {
        ...turn,
        latestAssistantText: "",
        flushedAssistantChars: 0,
      };
      isProcessingRef.current = true;
      setIsProcessing(true);
      setLiveTurnSourceLabel(turn.sourceLabel ?? null);
      startTimeRef.current = Date.now();
    },
    [clearLiveTurnUi],
  );

  const flushPendingAssistantMessage = useCallback(() => {
    const activeTurn = activeTurnRef.current;
    if (!activeTurn) return;

    const cleaned = sanitizeContent(contentAccRef.current);
    if (!cleaned) {
      contentAccRef.current = "";
      setStreamContent("");
      if (activeTurn.kind === "telegram") {
        activeTurn.flushedAssistantChars = activeTurn.latestAssistantText.length;
      }
      return;
    }

    setMessages((prev) => [
      ...prev,
      buildAssistantEntry(cleaned, {
        modeColor: activeTurn.modeColor,
        remoteKey: activeTurn.remoteKey,
        sourceLabel: activeTurn.sourceLabel,
      }),
    ]);

    if (activeTurn.kind === "telegram") {
      activeTurn.flushedAssistantChars = activeTurn.latestAssistantText.length;
    }

    contentAccRef.current = "";
    setStreamContent("");
  }, []);

  const applyLocalAssistantDelta = useCallback(
    (delta: string) => {
      contentAccRef.current += delta;
      setStreamContent(sanitizeContent(contentAccRef.current));
      setTimeout(scrollToBottom, 10);
    },
    [scrollToBottom],
  );

  const applyTelegramAssistantPreview = useCallback(
    (fullContent: string) => {
      const activeTurn = activeTurnRef.current;
      if (!activeTurn || activeTurn.kind !== "telegram") return;

      activeTurn.latestAssistantText = fullContent;
      contentAccRef.current = getUnflushedTelegramAssistantContent(fullContent, activeTurn.flushedAssistantChars);
      setStreamContent(sanitizeContent(contentAccRef.current));
      setTimeout(scrollToBottom, 10);
    },
    [scrollToBottom],
  );

  const showLiveToolCalls = useCallback(
    (toolCalls: ToolCall[]) => {
      flushPendingAssistantMessage();
      setActiveToolCalls(toolCalls);
      setTimeout(scrollToBottom, 10);
    },
    [flushPendingAssistantMessage, scrollToBottom],
  );

  const appendLiveToolResult = useCallback(
    (toolCall: ToolCall, toolResult: ToolResult) => {
      const activeTurn = activeTurnRef.current;
      if (!activeTurn) return;

      setMessages((prev) => [
        ...prev,
        buildToolResultEntry(toolCall, toolResult, {
          modeColor: activeTurn.modeColor,
          remoteKey: activeTurn.remoteKey,
          sourceLabel: activeTurn.sourceLabel,
        }),
      ]);

      if (toolResult.plan) {
        setPublishedPlan(toolResult.plan);
        if (mode === "plan") {
          setActivePlan(toolResult.plan);
          if (toolResult.plan.questions?.length) setPqs(initialPlanQuestionsState());
        }
      }

      setActiveToolCalls((current) => current.filter((active) => active.id !== toolCall.id));
      setTimeout(scrollToBottom, 10);
    },
    [mode, scrollToBottom],
  );

  const syncTelegramTurnEntries = useCallback((activeTurn: ActiveTurnState) => {
    if (activeTurn.kind !== "telegram" || activeTurn.userId === undefined || !activeTurn.remoteKey) return;

    const currentEntries = activeTurn.agent.getChatEntries();
    const syncedCount = telegramEntryCountsRef.current.get(activeTurn.userId) ?? 0;
    if (currentEntries.length <= syncedCount) return;

    const delta = decorateTelegramEntries(currentEntries.slice(syncedCount), activeTurn.userId, activeTurn.remoteKey);
    telegramEntryCountsRef.current.set(activeTurn.userId, currentEntries.length);
    setMessages((prev) => replaceTurnEntries(prev, activeTurn.remoteKey!, delta));
  }, []);

  const finalizeActiveTurn = useCallback(
    ({ wasInterrupted = false, hadError = false }: { wasInterrupted?: boolean; hadError?: boolean } = {}) => {
      const activeTurn = activeTurnRef.current;
      if (!activeTurn) {
        finishTurnProcessing();
        return;
      }

      const finalContent = sanitizeContent(contentAccRef.current);
      if (!wasInterrupted && finalContent) {
        setMessages((prev) => [
          ...prev,
          buildAssistantEntry(finalContent, {
            modeColor: activeTurn.modeColor,
            remoteKey: activeTurn.remoteKey,
            sourceLabel: activeTurn.sourceLabel,
          }),
        ]);
      }

      if (!wasInterrupted && !hadError) {
        if (activeTurn.kind === "local" && activeTurn.agent.getSessionId()) {
          setMessages((prev) => {
            const fresh = activeTurn.agent.getChatEntries();
            let prevUserIdx = 0;
            for (let i = 0; i < fresh.length; i++) {
              if (fresh[i]!.type !== "user") continue;
              while (prevUserIdx < prev.length && prev[prevUserIdx]!.type !== "user") prevUserIdx++;
              if (prevUserIdx < prev.length) {
                fresh[i] = { ...fresh[i]!, content: prev[prevUserIdx]!.content };
                prevUserIdx++;
              }
            }
            return fresh;
          });
          setSessionTitle(activeTurn.agent.getSessionTitle());
          setSessionId(activeTurn.agent.getSessionId());
          setSessionRecap(activeTurn.agent.getSessionRecap());
        } else if (activeTurn.kind === "telegram") {
          syncTelegramTurnEntries(activeTurn);
        }
      }

      activeTurnRef.current = null;
      clearLiveTurnUi();
      finishTurnProcessing();
      setTimeout(scrollToBottom, 50);
    },
    [clearLiveTurnUi, finishTurnProcessing, scrollToBottom, syncTelegramTurnEntries],
  );

  const runHostVerification = useCallback(async () => {
    if (isProcessingRef.current) return;
    const runId = ++activeRunIdRef.current;
    isProcessingRef.current = true;
    setIsProcessing(true);

    await coordinatorRef.current.run(async () => {
      const color = modeInfoRef.current.tone;
      beginLiveTurn({ kind: "local", agent, modeColor: color });
      setMessages((prev) => [...prev, buildUserEntry("/verify", { modeColor: color })]);
      setTimeout(scrollToBottom, 50);
      recordActivity({
        id: `verification:${runId}`,
        kind: "verification",
        status: "active",
        label: "Host verification",
        detail: "Starting verification orchestration",
        source: "runtime",
        at: Date.now(),
      });

      try {
        const result = await agent.runVerify((detail) => {
          recordActivity({
            id: `verification:${runId}`,
            kind: "verification",
            status: "active",
            label: "Host verification",
            detail: truncateActivity(detail),
            source: "runtime",
            at: Date.now(),
          });
          syncKernelState();
        });
        if (activeRunIdRef.current !== runId) return;
        recordActivity({
          id: `verification:${runId}`,
          kind: "verification",
          status: result.success ? "complete" : "failed",
          label: result.success ? "Verification passed" : "Verification failed",
          detail: truncateActivity(result.output || result.error || "No verification detail returned"),
          source: "runtime",
          at: Date.now(),
        });
        syncKernelState();
        if (interruptedRunIdRef.current === runId) {
          interruptedRunIdRef.current = null;
          finishTurnProcessing();
          return;
        }
        finalizeActiveTurn();
      } catch (error) {
        if (activeRunIdRef.current !== runId) return;
        recordActivity({
          id: `verification:${runId}`,
          kind: "verification",
          status: "failed",
          label: "Verification failed",
          detail: truncateActivity(error instanceof Error ? error.message : String(error)),
          source: "runtime",
          at: Date.now(),
        });
        syncKernelState();
        finalizeActiveTurn({ hadError: true });
      }
    });
  }, [agent, beginLiveTurn, finalizeActiveTurn, finishTurnProcessing, recordActivity, scrollToBottom, syncKernelState]);

  const wireTelegramAgentUi = useCallback((userId: number, telegramAgent: Agent) => {
    if (!telegramEntryCountsRef.current.has(userId)) {
      telegramEntryCountsRef.current.set(userId, telegramAgent.getChatEntries().length);
    }

    if (telegramSubagentUnsubsRef.current.has(userId)) {
      return;
    }

    const unsubscribe = telegramAgent.onSubagentStatus((status) => {
      if (activeTurnRef.current?.agent !== telegramAgent) return;
      const observedAt = Date.now();
      setActiveSubagent(status);
      setActiveSubagentStartedAt((current) => (status ? (current ?? observedAt) : null));
      setActiveSubagentActivityAt(status ? observedAt : null);
    });
    telegramSubagentUnsubsRef.current.set(userId, unsubscribe);
  }, []);

  const getTelegramAgent = useCallback(
    (userId: number) => {
      const map = telegramAgentsRef.current;
      const existing = map.get(userId);
      if (existing) {
        wireTelegramAgentUi(userId, existing);
        return existing;
      }

      const apiKey = getApiKey();
      if (!apiKey) {
        throw new Error("Provider API key required. Set OPENROUTER_API_KEY or use `shelra auth openrouter <key>`.");
      }

      const u = loadUserSettings();
      const sid = u.telegram?.sessionsByUserId?.[String(userId)];
      const a = new Agent(apiKey, startupConfig.baseURL, startupConfig.model, startupConfig.maxToolRounds, {
        session: sid,
        sandboxMode,
        sandboxSettings,
      });
      if (!sid && a.getSessionId()) {
        saveUserSettings({
          telegram: {
            ...u.telegram,
            sessionsByUserId: {
              ...u.telegram?.sessionsByUserId,
              [String(userId)]: a.getSessionId()!,
            },
          },
        });
      }
      wireTelegramAgentUi(userId, a);
      map.set(userId, a);
      return a;
    },
    [sandboxMode, sandboxSettings, startupConfig, wireTelegramAgentUi],
  );

  const appendTelegramUserMessage = useCallback(
    (event: { turnKey: string; userId: number; content: string }) => {
      const telegramAgent = getTelegramAgent(event.userId);
      beginLiveTurn({
        kind: "telegram",
        agent: telegramAgent,
        remoteKey: event.turnKey,
        userId: event.userId,
        sourceLabel: getTelegramSourceLabel("assistant", event.userId),
      });
      setMessages((prev) => [
        ...prev,
        buildUserEntry(event.content, {
          remoteKey: event.turnKey,
          sourceLabel: getTelegramSourceLabel("user", event.userId),
        }),
      ]);
      setTimeout(scrollToBottom, 10);
    },
    [beginLiveTurn, getTelegramAgent, scrollToBottom],
  );

  const upsertTelegramAssistantMessage = useCallback(
    (event: { turnKey: string; userId: number; content: string; done: boolean }) => {
      if (activeTurnRef.current?.remoteKey !== event.turnKey) {
        const telegramAgent = getTelegramAgent(event.userId);
        beginLiveTurn({
          kind: "telegram",
          agent: telegramAgent,
          remoteKey: event.turnKey,
          userId: event.userId,
          sourceLabel: getTelegramSourceLabel("assistant", event.userId),
        });
      }

      applyTelegramAssistantPreview(event.content);
      if (event.done) {
        finalizeActiveTurn();
      }
    },
    [applyTelegramAssistantPreview, beginLiveTurn, finalizeActiveTurn, getTelegramAgent],
  );

  const showTelegramToolCalls = useCallback(
    (event: { turnKey: string; userId: number; toolCalls: ToolCall[] }) => {
      if (activeTurnRef.current?.remoteKey !== event.turnKey) {
        const telegramAgent = getTelegramAgent(event.userId);
        beginLiveTurn({
          kind: "telegram",
          agent: telegramAgent,
          remoteKey: event.turnKey,
          userId: event.userId,
          sourceLabel: getTelegramSourceLabel("assistant", event.userId),
        });
      }
      showLiveToolCalls(event.toolCalls);
    },
    [beginLiveTurn, getTelegramAgent, showLiveToolCalls],
  );

  const appendTelegramToolResult = useCallback(
    (event: { turnKey: string; userId: number; toolCall: ToolCall; toolResult: ToolResult }) => {
      if (activeTurnRef.current?.remoteKey !== event.turnKey) {
        const telegramAgent = getTelegramAgent(event.userId);
        beginLiveTurn({
          kind: "telegram",
          agent: telegramAgent,
          remoteKey: event.turnKey,
          userId: event.userId,
          sourceLabel: getTelegramSourceLabel("assistant", event.userId),
        });
      }
      appendLiveToolResult(event.toolCall, event.toolResult);
    },
    [appendLiveToolResult, beginLiveTurn, getTelegramAgent],
  );

  const startTelegramBridge = useCallback(() => {
    const token = getTelegramBotToken();
    if (!token || !getApiKey() || !startupConfig.baseURL) return;
    if (bridgeRef.current) return;

    const bridge = createTelegramBridge({
      token,
      getApprovedUserIds: () => loadUserSettings().telegram?.approvedUserIds ?? [],
      coordinator: coordinatorRef.current,
      getTelegramAgent,
      onUserMessage: appendTelegramUserMessage,
      onAssistantMessage: upsertTelegramAssistantMessage,
      onToolCalls: showTelegramToolCalls,
      onToolResult: appendTelegramToolResult,
      onError: (msg) => {
        setMessages((p) => [...p, { type: "assistant", content: `Telegram: ${msg}`, timestamp: new Date() }]);
      },
    });
    bridgeRef.current = bridge;
    bridge.start();
  }, [
    appendTelegramToolResult,
    appendTelegramUserMessage,
    getTelegramAgent,
    showTelegramToolCalls,
    startupConfig.baseURL,
    upsertTelegramAssistantMessage,
  ]);

  /** Start long polling when a bot token is already saved (pairing UI is optional if already approved). */
  useEffect(() => {
    if (!hasApiKey) return;
    if (!getTelegramBotToken()) return;
    startTelegramBridge();
  }, [hasApiKey, startTelegramBridge]);

  const handleExit = useCallback(() => {
    void bridgeRef.current?.stop();
    bridgeRef.current = null;
    onExit?.();
  }, [onExit]);

  const showCopyBanner = useCallback(() => {
    setCopyFlashId((n) => n + 1);
  }, []);

  /** Match OpenCode: OSC 52 + real OS clipboard; used from keyboard and root onMouseUp. */
  const copyTuiSelectionToHost = useCallback((): boolean => {
    if (!renderer.hasSelection) return false;
    const sel = renderer.getSelection();
    const text = sel ? getCompactTuiSelectionText(sel) : "";
    if (!text) return false;
    renderer.copyToClipboardOSC52(text);
    copyTextToHostClipboard(text);
    renderer.clearSelection();
    showCopyBanner();
    return true;
  }, [renderer, showCopyBanner]);

  const handleRootMouseUp = useCallback(() => {
    copyTuiSelectionToHost();
  }, [copyTuiSelectionToHost]);

  useEffect(() => {
    if (copyFlashId === 0) return;
    const id = setTimeout(() => setCopyFlashId(0), 2000);
    return () => clearTimeout(id);
  }, [copyFlashId]);

  const openApiKeyModal = useCallback(() => {
    showApiKeyModalRef.current = true;
    setApiKeyError(null);
    setShowApiKeyModal(true);
  }, []);

  const closeApiKeyModal = useCallback(() => {
    showApiKeyModalRef.current = false;
    setApiKeyError(null);
    setShowApiKeyModal(false);
  }, []);

  const submitApiKey = useCallback(async () => {
    const apiKey = (apiKeyInputRef.current?.plainText || "").trim();
    if (!apiKey) {
      setApiKeyError("Enter an API key to continue.");
      return;
    }
    if (startupConfig.onApiKey) {
      const result = await startupConfig.onApiKey(apiKey);
      if (!result.success) {
        setApiKeyError(result.error || "The cloud provider could not be configured.");
        return;
      }
    } else {
      try {
        saveUserSettings({ apiKey });
        agent.setApiKey(apiKey);
      } catch (error: unknown) {
        setApiKeyError(error instanceof Error ? error.message : String(error));
        return;
      }
    }
    hasApiKeyRef.current = true;
    showApiKeyModalRef.current = false;
    setHasApiKey(true);
    setApiKeyError(null);
    setShowApiKeyModal(false);
    apiKeyInputRef.current?.clear();
    if (getTelegramBotToken()) {
      startTelegramBridge();
    }
  }, [agent, startupConfig.onApiKey, startTelegramBridge]);

  useEffect(() => {
    hasApiKeyRef.current = hasApiKey;
  }, [hasApiKey]);

  useEffect(() => {
    showApiKeyModalRef.current = showApiKeyModal;
  }, [showApiKeyModal]);

  useEffect(() => {
    showInspectorRef.current = showInspector;
  }, [showInspector]);

  useEffect(() => {
    showConnectModalRef.current = showConnectModal;
  }, [showConnectModal]);
  useEffect(() => {
    showTelegramTokenModalRef.current = showTelegramTokenModal;
  }, [showTelegramTokenModal]);
  useEffect(() => {
    showTelegramPairModalRef.current = showTelegramPairModal;
  }, [showTelegramPairModal]);
  useEffect(() => {
    showMcpModalRef.current = showMcpModal;
  }, [showMcpModal]);
  useEffect(() => {
    showMcpEditorRef.current = showMcpEditor;
  }, [showMcpEditor]);
  useEffect(() => {
    showAgentsModalRef.current = showAgentsModal;
  }, [showAgentsModal]);
  useEffect(() => {
    showAgentsEditorRef.current = showAgentsEditor;
  }, [showAgentsEditor]);
  useEffect(() => {
    showScheduleModalRef.current = showScheduleModal;
  }, [showScheduleModal]);
  useEffect(() => {
    showUpdateModalRef.current = showUpdateModal;
  }, [showUpdateModal]);

  useEffect(() => {
    let cancelled = false;
    checkForUpdate(startupConfig.version).then((result) => {
      if (cancelled || !result?.hasUpdate) return;
      setUpdateInfo(result);
      setShowUpdateModal(true);
    });
    return () => {
      cancelled = true;
    };
  }, [startupConfig.version]);

  useEffect(() => {
    return () => {
      void bridgeRef.current?.stop();
      bridgeRef.current = null;
    };
  }, []);

  const submitTelegramToken = useCallback(() => {
    const token = (telegramTokenInputRef.current?.plainText || "").trim();
    if (!token) {
      setTelegramTokenError("Paste your bot token from @BotFather.");
      return;
    }
    if (!getApiKey()) {
      setTelegramTokenError("Add a compatible provider API key first.");
      return;
    }
    const u = loadUserSettings();
    saveUserSettings({ telegram: { ...u.telegram, botToken: token } });
    telegramTokenInputRef.current?.clear();
    setShowTelegramTokenModal(false);
    setTelegramTokenError(null);
    startTelegramBridge();
    setShowTelegramPairModal(true);
    setTelegramPairError(null);
    setMessages((p) => [
      ...p,
      {
        type: "assistant",
        content:
          "Telegram polling started. In Telegram, DM your bot and send /pair. Copy the code, then enter it below.",
        timestamp: new Date(),
      },
    ]);
  }, [startTelegramBridge]);

  const submitTelegramPair = useCallback(async () => {
    const code = (telegramPairInputRef.current?.plainText || "").trim();
    if (!code) {
      setTelegramPairError("Enter the pairing code.");
      return;
    }
    const result = approvePairingCode(code);
    if (!result.ok) {
      setTelegramPairError(result.error);
      return;
    }
    saveApprovedTelegramUserId(result.userId);
    telegramPairInputRef.current?.clear();
    setShowTelegramPairModal(false);
    setTelegramPairError(null);
    setMessages((p) => [
      ...p,
      {
        type: "assistant",
        content: `Telegram user ${result.userId} paired. Keep this CLI open while you use the bot.`,
        timestamp: new Date(),
      },
    ]);
    try {
      await bridgeRef.current?.sendDm(result.userId, "Pairing approved. You can message ShelraCode here.");
    } catch {
      /* optional DM */
    }
  }, []);

  const beginTelegramFromConnect = useCallback(() => {
    setShowConnectModal(false);
    if (!getApiKey()) {
      setMessages((p) => [
        ...p,
        {
          type: "assistant",
          content: "Telegram remote control needs a compatible provider API key.",
          timestamp: new Date(),
        },
      ]);
      openApiKeyModal();
      return;
    }
    if (!getTelegramBotToken()) {
      setShowTelegramTokenModal(true);
      setTelegramTokenError(null);
      return;
    }
    startTelegramBridge();
    const alreadyPaired = (loadUserSettings().telegram?.approvedUserIds?.length ?? 0) > 0;
    if (!alreadyPaired) {
      setShowTelegramPairModal(true);
      setTelegramPairError(null);
      setMessages((p) => [
        ...p,
        {
          type: "assistant",
          content:
            "Telegram polling started. In Telegram, DM your bot and send /pair. Copy the code, then enter it below.",
          timestamp: new Date(),
        },
      ]);
    } else {
      setMessages((p) => [
        ...p,
        {
          type: "assistant",
          content: "Telegram polling is running. Your chat is already paired.",
          timestamp: new Date(),
        },
      ]);
    }
  }, [openApiKeyModal, startTelegramBridge]);

  const interruptActiveRun = useCallback(
    (key?: KeyEvent) => {
      if (showInspector) {
        setShowInspector(false);
        setInspectorTab("overview");
        key?.preventDefault();
        key?.stopPropagation();
        return true;
      }
      if (btwStateRef.current) {
        btwAbortRef.current?.abort();
        btwAbortRef.current = null;
        btwStateRef.current = null;
        setBtwState(null);
        key?.preventDefault();
        key?.stopPropagation();
        return true;
      }
      if (!isProcessingRef.current) return false;
      key?.preventDefault();
      key?.stopPropagation();
      interruptedRunIdRef.current = activeRunIdRef.current;
      queuedMessagesRef.current = [];
      setQueuedMessages([]);
      const activeAgent = activeTurnRef.current?.agent ?? agent;
      activeTurnRef.current = null;
      clearLiveTurnUi();
      activeAgent.abort();
      return true;
    },
    [agent, clearLiveTurnUi, showInspector],
  );

  useEffect(() => {
    const onInternalKey = (key: KeyEvent) => {
      if (isEscapeKey(key)) {
        interruptActiveRun(key);
      }
    };

    renderer._internalKeyInput.onInternal("keypress", onInternalKey);
    return () => {
      renderer._internalKeyInput.offInternal("keypress", onInternalKey);
    };
  }, [interruptActiveRun, renderer]);

  useEffect(() => {
    const onRawInput = (sequence: string) => {
      const parsed = parseKeypress(sequence, { useKittyKeyboard: renderer.useKittyKeyboard });
      if (parsed?.name === "escape" || sequence === "\u001b" || sequence === "\u001b\u001b") {
        if (showInspectorRef.current) {
          setShowInspector(false);
          setInspectorTab("overview");
          return true;
        }
        return interruptActiveRun();
      }
      return false;
    };

    renderer.prependInputHandler(onRawInput);
    return () => {
      renderer.removeInputHandler(onRawInput);
    };
  }, [interruptActiveRun, renderer]);

  useEffect(() => {
    const onStdinData = (chunk: Buffer | string) => {
      const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (data.length === 1 && data[0] === 27) {
        interruptActiveRun();
      }
    };

    renderer.stdin.on("data", onStdinData);
    return () => {
      renderer.stdin.off("data", onStdinData);
    };
  }, [interruptActiveRun, renderer]);

  const resetToNewSession = useCallback(() => {
    const snapshot = agent.startNewSession();
    setMessages(snapshot?.entries ?? []);
    setExpandedMessages(new Set());
    activeTurnRef.current = null;
    clearLiveTurnUi();
    setSessionTitle(snapshot?.session.title ?? null);
    setSessionId(snapshot?.session.id ?? agent.getSessionId());
    setSessionRecap(agent.getSessionRecap());
    setActivePlan(null);
    setPublishedPlan(null);
    setKernelState(null);
    setActivityEvents([]);
    setUsageSummary(summarizeSessionUsage(agent.getSessionUsage()));
    sessionStartedAtRef.current = snapshot?.session.createdAt.getTime() ?? Date.now();
    setNowTick(Date.now());
    setShowInspector(false);
    setInspectorTab("overview");
    setPqs(initialPlanQuestionsState());
    replacePasteBlocks([]);
    queuedMessagesRef.current = [];
    setQueuedMessages([]);
  }, [agent, clearLiveTurnUi, replacePasteBlocks]);

  const processMessage = useCallback(
    async (text: string, displayText?: string) => {
      if (!text.trim() || isProcessingRef.current) return;
      const runId = ++activeRunIdRef.current;
      const isStale = () => activeRunIdRef.current !== runId;
      isProcessingRef.current = true;
      setIsProcessing(true);
      setKernelState(null);
      setPublishedPlan(null);
      setActivityEvents((current) =>
        current.map((event) => (event.status === "active" ? { ...event, status: "complete" } : event)),
      );
      if (!sessionTitle)
        agent
          .generateTitle((displayText ?? text).trim())
          .then(setSessionTitle)
          .catch(() => {});
      await coordinatorRef.current.run(async () => {
        const color = modeInfoRef.current.tone;
        beginLiveTurn({ kind: "local", agent, modeColor: color });
        setMessages((prev) => [...prev, buildUserEntry((displayText ?? text).trim(), { modeColor: color })]);
        setTimeout(scrollToBottom, 50);
        await new Promise((r) => setTimeout(r, 0));
        let turnHadError = false;
        let turnHadAuthError = false;
        const observer = createProcessObserver(runId);
        try {
          for await (const chunk of agent.processMessage(text.trim(), observer)) {
            if (isStale()) {
              break;
            }

            switch (chunk.type) {
              case "content":
                applyLocalAssistantDelta(chunk.content || "");
                break;
              case "reasoning":
                setStreamReasoning((p) => p + (chunk.content || ""));
                break;
              case "tool_calls":
                if (chunk.toolCalls) {
                  showLiveToolCalls(chunk.toolCalls);
                }
                break;
              case "tool_result":
                if (chunk.toolCall && chunk.toolResult) {
                  appendLiveToolResult(chunk.toolCall, chunk.toolResult);
                }
                break;
              case "tool_approval_request":
                if (chunk.toolCall && chunk.approvalId) {
                  let args: Record<string, string> = {};
                  try {
                    args = JSON.parse(chunk.toolCall.function.arguments);
                  } catch {
                    /* ignore */
                  }
                  const pc = chunk.paymentPrecheck;
                  setPendingPaymentApproval({
                    url: args?.url ?? "",
                    description: pc?.description ?? "",
                    security: pc?.security ?? "",
                    securityLabel: pc?.securityLabel ?? "",
                    securityUrl: pc?.securityUrl ?? "",
                    amount: pc?.amount ?? "",
                    network: pc?.network ?? "",
                    asset: pc?.asset ?? "",
                    approvalId: chunk.approvalId,
                    selected: 0,
                  });
                }
                break;
              case "error":
                turnHadError = true;
                if (chunk.isAuthError) {
                  turnHadAuthError = true;
                }
                contentAccRef.current += `\n${chunk.content || "Unknown error"}`;
                setStreamContent(contentAccRef.current);
                break;
              case "done":
                break;
            }
          }
          syncKernelState();
        } catch {
          turnHadError = true;
          if (!isStale()) {
            contentAccRef.current += "\nAn unexpected error occurred.";
            setStreamContent(contentAccRef.current);
          }
        }
        const wasInterrupted = interruptedRunIdRef.current === runId;
        if (isStale()) {
          contentAccRef.current = "";
          return;
        }

        if (turnHadAuthError) {
          setApiKeyError("Your API key is invalid or expired. Please enter a new key.");
          setShowApiKeyModal(true);
          showApiKeyModalRef.current = true;
        }

        if (!isStale()) {
          finalizeActiveTurn({ wasInterrupted, hadError: turnHadError });
        }
        if (wasInterrupted) {
          interruptedRunIdRef.current = null;
        }
      });
    },
    [
      agent,
      appendLiveToolResult,
      applyLocalAssistantDelta,
      beginLiveTurn,
      createProcessObserver,
      finalizeActiveTurn,
      scrollToBottom,
      sessionTitle,
      showLiveToolCalls,
      syncKernelState,
    ],
  );

  useEffect(() => {
    if (initialMessage && hasApiKey && !processedInitial.current) {
      processedInitial.current = true;
      processMessage(initialMessage);
    }
  }, [hasApiKey, initialMessage, processMessage]);
  useEffect(() => {
    processMessageRef.current = processMessage;
  }, [processMessage]);
  useEffect(
    () =>
      agent.onSubagentStatus((status) => {
        if (activeTurnRef.current?.agent !== agent) return;
        setActiveSubagent(status);
        if (status) {
          // Every emission is one real reported action from the child (`runTaskRequest` calls
          // `onActivity` per child tool call), so this timestamp is genuinely "last observed
          // activity" — exactly what the tier-2 collapse rule measures against.
          const observedAt = Date.now();
          setActiveSubagentStartedAt((current) => current ?? observedAt);
          setActiveSubagentActivityAt(observedAt);
          recordActivity({
            id: `agent:${status.agent}`,
            kind: "agent",
            status: "active",
            label: `Delegated agent: ${formatSubagentName(status.agent)}`,
            detail: `${status.description}: ${status.detail}`,
            source: "runtime",
            at: observedAt,
          });
        } else {
          setActivityEvents((current) =>
            current.map((event) =>
              event.kind === "agent" && event.status === "active"
                ? { ...event, status: "complete", detail: `${event.detail || ""} | finished` }
                : event,
            ),
          );
          setActiveSubagentStartedAt(null);
          setActiveSubagentActivityAt(null);
        }
        syncKernelState();
      }),
    [agent, recordActivity, syncKernelState],
  );
  useEffect(
    () => () => {
      for (const unsubscribe of telegramSubagentUnsubsRef.current.values()) {
        unsubscribe();
      }
      telegramSubagentUnsubsRef.current.clear();
    },
    [],
  );
  useEffect(() => {
    let active = true;
    const id = setInterval(() => {
      agent
        .consumeBackgroundNotifications()
        .then((notifications) => {
          if (!active || notifications.length === 0) return;
          setMessages((prev) => [
            ...prev,
            ...notifications.map((message) => ({
              type: "assistant" as const,
              content: message,
              timestamp: new Date(),
            })),
          ]);
          setTimeout(scrollToBottom, 10);
        })
        .catch(() => {});
    }, 2000);

    return () => {
      active = false;
      clearInterval(id);
    };
  }, [agent, scrollToBottom]);

  const handleCommand = useCallback(
    (cmd: string): boolean => {
      const c = cmd.trim().toLowerCase();
      if (c === "/clear") {
        resetToNewSession();
        return true;
      }
      if (c === "/status") {
        setInspectorTab("overview");
        setShowInspector(true);
        return true;
      }
      if (c === "/tasks" || c === "/delegations") {
        setInspectorTab("agents");
        setShowInspector(true);
        return true;
      }
      if (c === "/model" || c === "/models") {
        setShowModelPicker(true);
        setModelPickerIndex(0);
        setModelSearchQuery("");
        return true;
      }
      if (c === "/sandbox") {
        openSandboxPicker();
        return true;
      }
      if (c === "/recap" || c === "/recaps") {
        openRecapPicker();
        return true;
      }
      if (c === "/theme" || c === "/appearance") {
        openThemePicker();
        return true;
      }
      if (c === "/effort" || c === "/reasoning") {
        openEffortPicker();
        return true;
      }
      if (c === "/wallet") {
        openWalletPicker();
        return true;
      }
      if (c === "/remote-control") {
        setConnectModalIndex(0);
        setShowConnectModal(true);
        return true;
      }
      if (c === "/mcp" || c === "/mcps") {
        openMcpModal();
        return true;
      }
      if (c === "/agents" || c === "/agent") {
        openAgentsModal();
        return true;
      }
      if (c === "/schedule" || c === "/schedules") {
        openScheduleModal();
        return true;
      }
      if (c === "/quit" || c === "/exit" || c === "/q") {
        handleExit();
        return true;
      }
      if (c === "/review") {
        processMessage(REVIEW_PROMPT);
        return true;
      }
      if (c === "/verify") {
        void runHostVerification();
        return true;
      }
      if (c === "/commit-push") {
        processMessage(COMMIT_PUSH_PROMPT);
        return true;
      }
      if (c === "/commit-pr") {
        processMessage(COMMIT_PR_PROMPT);
        return true;
      }
      if (c.startsWith("/btw ") || c === "/btw") {
        const question = cmd.trim().slice(4).trim();
        if (!question) {
          setMessages((prev) => [
            ...prev,
            buildAssistantEntry("Usage: /btw <question>\nExample: /btw what does useEffect cleanup do?"),
          ]);
          return true;
        }
        const ac = new AbortController();
        btwAbortRef.current = ac;
        const loadingState: BtwState = { status: "loading", question };
        btwStateRef.current = loadingState;
        setBtwState(loadingState);
        agent
          .askSideQuestion(question, ac.signal)
          .then((result) => {
            if (ac.signal.aborted) return;
            const doneState: BtwState = { status: "done", question, answer: result.response };
            btwStateRef.current = doneState;
            setBtwState(doneState);
          })
          .catch((err) => {
            if (ac.signal.aborted) return;
            const errState: BtwState = {
              status: "error",
              question,
              error: err instanceof Error ? err.message : String(err),
            };
            btwStateRef.current = errState;
            setBtwState(errState);
          });
        return true;
      }
      const customSubagentCommand = parseCustomSubagentSlashCommand(cmd, subAgents);
      if (customSubagentCommand) {
        if (!customSubagentCommand.prompt) {
          setMessages((prev) => [
            ...prev,
            buildAssistantEntry(
              `Usage: /${customSubagentCommand.agentName} <task>\nExample: /${customSubagentCommand.agentName} review the latest changes`,
            ),
          ]);
          return true;
        }

        processMessage(buildCustomSubagentSlashPrompt(customSubagentCommand.agentName, customSubagentCommand.prompt));
        return true;
      }
      return false;
    },
    [
      agent,
      handleExit,
      openAgentsModal,
      openEffortPicker,
      openMcpModal,
      openRecapPicker,
      openSandboxPicker,
      openThemePicker,
      openWalletPicker,
      openScheduleModal,
      processMessage,
      resetToNewSession,
      runHostVerification,
      subAgents,
    ],
  );

  const handleSlashMenuSelect = useCallback(
    (item: SlashMenuItem) => {
      setShowSlashMenu(false);
      inputRef.current?.clear();
      switch (item.id) {
        case "new":
          resetToNewSession();
          break;
        case "models":
          setShowModelPicker(true);
          setModelPickerIndex(0);
          setModelSearchQuery("");
          break;
        case "sandbox":
          openSandboxPicker();
          break;
        case "recaps":
          openRecapPicker();
          break;
        case "theme":
          openThemePicker();
          break;
        case "effort":
          openEffortPicker();
          break;
        case "wallet":
          openWalletPicker();
          break;
        case "remote-control":
          setConnectModalIndex(0);
          setShowConnectModal(true);
          break;
        case "exit":
          handleExit();
          break;
        case "help":
          setMessages((p) => [
            ...p,
            {
              type: "assistant",
              content: SLASH_MENU_ITEMS.map((i) => `/${i.label} — ${i.description}`).join("\n"),
              timestamp: new Date(),
            },
          ]);
          break;
        case "skills":
          setMessages((p) => [
            ...p,
            {
              type: "assistant",
              content: formatSkillsForChat(discoverSkills(agent.getCwd()), agent.getCwd()),
              timestamp: new Date(),
            },
          ]);
          break;
        case "mcp":
          openMcpModal();
          break;
        case "agents":
          openAgentsModal();
          break;
        case "status":
          setInspectorTab("overview");
          setShowInspector(true);
          break;
        case "tasks":
          setInspectorTab("agents");
          setShowInspector(true);
          break;
        case "schedule":
          openScheduleModal();
          break;
        case "review":
          processMessage(REVIEW_PROMPT);
          break;
        case "verify":
          void runHostVerification();
          break;
        case "commit-push":
          processMessage(COMMIT_PUSH_PROMPT);
          break;
        case "commit-pr":
          processMessage(COMMIT_PR_PROMPT);
          break;
        case "btw":
          inputRef.current?.clear();
          inputRef.current?.insertText("/btw ");
          break;
        case "update":
          setIsUpdating(true);
          setUpdateOutput(null);
          runUpdate(startupConfig.version).then((result) => {
            setIsUpdating(false);
            setUpdateOutput(result.success ? result.output : `Update failed: ${result.output}`);
          });
          break;
      }
    },
    [
      agent,
      handleExit,
      openAgentsModal,
      openEffortPicker,
      openMcpModal,
      openRecapPicker,
      openSandboxPicker,
      openThemePicker,
      openWalletPicker,
      openScheduleModal,
      processMessage,
      resetToNewSession,
      runHostVerification,
      startupConfig.version,
    ],
  );

  const blockPrompt =
    showConnectModal ||
    showTelegramTokenModal ||
    showTelegramPairModal ||
    showMcpModal ||
    showSandboxPicker ||
    showRecapPicker ||
    showThemePicker ||
    showEffortPicker ||
    showWalletPicker ||
    !!pendingPaymentApproval ||
    showScheduleModal ||
    showAgentsModal ||
    showAgentsEditor ||
    showUpdateModal ||
    showInspector;

  const showPlanPanel = !!activePlan?.questions?.length;
  const planQuestions = activePlan?.questions ?? [];
  const isSinglePlan = planQuestions.length === 1 && planQuestions[0]?.type !== "multiselect";
  const planTabCount = isSinglePlan ? 1 : planQuestions.length + 1;
  const isPlanConfirmTab = !isSinglePlan && pqs.tab === planQuestions.length;

  const dismissPlan = useCallback(() => {
    setActivePlan(null);
    setPqs(initialPlanQuestionsState());
  }, []);

  const submitPlanAnswers = useCallback(
    (answers: PlanAnswers = pqs.answers) => {
      if (!activePlan?.questions?.length) return;
      const text = formatPlanAnswers(activePlan.questions, answers);
      setActivePlan(null);
      setPqs(initialPlanQuestionsState());
      processMessage(text);
    },
    [activePlan, pqs.answers, processMessage],
  );

  const handlePlanSelect = useCallback(
    (q: PlanQuestion, idx: number, options: { id: string; label: string }[], showCustom: boolean) => {
      const isCustom = showCustom && idx === options.length;
      if (isCustom) {
        if (q.type === "multiselect") {
          const customVal = pqs.customInputs[q.id] ?? "";
          if (customVal) {
            const existing = (pqs.answers[q.id] as string[] | undefined) ?? [];
            if (existing.includes(customVal)) {
              setPqs((s) => ({ ...s, answers: { ...s.answers, [q.id]: existing.filter((x) => x !== customVal) } }));
            } else {
              setPqs((s) => ({ ...s, editing: true }));
            }
          } else {
            setPqs((s) => ({ ...s, editing: true }));
          }
        } else {
          setPqs((s) => ({ ...s, editing: true }));
        }
        return;
      }
      const opt = options[idx];
      if (!opt) return;

      if (q.type === "multiselect") {
        setPqs((s) => {
          const existing = (s.answers[q.id] as string[] | undefined) ?? [];
          const next = existing.includes(opt.id) ? existing.filter((x) => x !== opt.id) : [...existing, opt.id];
          return { ...s, answers: { ...s.answers, [q.id]: next } };
        });
      } else {
        const nextAnswers = { ...pqs.answers, [q.id]: opt.id };
        setPqs((s) => ({ ...s, answers: nextAnswers }));
        if (isSinglePlan) {
          submitPlanAnswers(nextAnswers);
          return;
        }
        setPqs((s) => ({ ...s, tab: s.tab + 1, selected: 0 }));
      }
    },
    [pqs, isSinglePlan, submitPlanAnswers],
  );

  const dismissBtw = useCallback(() => {
    btwAbortRef.current?.abort();
    btwAbortRef.current = null;
    btwStateRef.current = null;
    setBtwState(null);
  }, []);

  const handleKey = useCallback(
    (key: KeyEvent) => {
      if (btwState) {
        if (isEscapeKey(key) || key.name === "return") {
          dismissBtw();
        }
        return;
      }
      if (showInspector) {
        if (isEscapeKey(key)) {
          setShowInspector(false);
          setInspectorTab("overview");
          key.preventDefault();
          key.stopPropagation();
          return;
        }
        const inspectorTabs: InspectorTab[] = ["overview", "plan", "activity", "evidence", "agents"];
        const keyTab: Record<string, InspectorTab> = {
          "1": "overview",
          "2": "plan",
          "3": "activity",
          "4": "evidence",
          "5": "agents",
        };
        const directTab = keyTab[key.name] ?? keyTab[key.sequence ?? ""];
        if (directTab) {
          setInspectorTab(directTab);
          return;
        }
        if (key.name === "tab" || key.name === "left" || key.name === "right") {
          const current = inspectorTabs.indexOf(inspectorTab);
          const direction = key.name === "left" || key.shift ? -1 : 1;
          setInspectorTab(inspectorTabs[(current + direction + inspectorTabs.length) % inspectorTabs.length]);
          return;
        }
        return;
      }
      if (key.name === "i" && key.ctrl) {
        setInspectorTab("overview");
        setShowInspector(true);
        return;
      }
      if (showPlanPanel) {
        const q = planQuestions[pqs.tab];

        // Escape always dismisses
        if (isEscapeKey(key)) {
          dismissPlan();
          return;
        }

        // When editing custom text input
        if (pqs.editing && !isPlanConfirmTab) {
          if (key.name === "return") {
            const qId = q?.id;
            if (qId) {
              const text = (pqs.customInputs[qId] ?? "").trim();
              if (text) {
                if (q.type === "multiselect") {
                  const existing = (pqs.answers[qId] as string[] | undefined) ?? [];
                  const next = existing.includes(text) ? existing : [...existing, text];
                  setPqs((s) => ({ ...s, editing: false, answers: { ...s.answers, [qId]: next } }));
                } else if (q.type === "text") {
                  const nextAnswers = { ...pqs.answers, [qId]: text };
                  setPqs((s) => ({ ...s, editing: false, answers: nextAnswers }));
                  if (isSinglePlan) {
                    submitPlanAnswers(nextAnswers);
                    return;
                  }
                  setPqs((s) => ({ ...s, tab: s.tab + 1, selected: 0 }));
                } else {
                  const nextAnswers = { ...pqs.answers, [qId]: text };
                  setPqs((s) => ({ ...s, editing: false, answers: nextAnswers }));
                  if (isSinglePlan) {
                    submitPlanAnswers(nextAnswers);
                    return;
                  }
                  setPqs((s) => ({ ...s, tab: s.tab + 1, selected: 0 }));
                }
              } else {
                setPqs((s) => ({ ...s, editing: false }));
              }
            }
            return;
          }
          if (key.name === "backspace") {
            const qId = q?.id;
            if (qId)
              setPqs((s) => ({
                ...s,
                customInputs: { ...s.customInputs, [qId]: (s.customInputs[qId] ?? "").slice(0, -1) },
              }));
            return;
          }
          if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) {
            const qId = q?.id;
            if (qId)
              setPqs((s) => ({
                ...s,
                customInputs: { ...s.customInputs, [qId]: (s.customInputs[qId] ?? "") + key.sequence },
              }));
            return;
          }
          return;
        }

        // Tab / left / right — switch between question tabs
        if (key.name === "tab") {
          const dir = key.shift ? -1 : 1;
          setPqs((s) => ({ ...s, tab: (s.tab + dir + planTabCount) % planTabCount, selected: 0 }));
          return;
        }
        if (key.name === "left" || key.name === "h") {
          setPqs((s) => ({ ...s, tab: (s.tab - 1 + planTabCount) % planTabCount, selected: 0 }));
          return;
        }
        if (key.name === "right" || key.name === "l") {
          setPqs((s) => ({ ...s, tab: (s.tab + 1) % planTabCount, selected: 0 }));
          return;
        }

        // Confirm tab
        if (isPlanConfirmTab) {
          if (key.name === "return") {
            submitPlanAnswers();
            return;
          }
          return;
        }

        if (!q) return;

        // Text-only question (no options)
        if (q.type === "text") {
          setPqs((s) => ({ ...s, editing: true }));
          return;
        }

        // Up/down — navigate options
        const options = q.options ?? [];
        const showCustom = true;
        const totalItems = options.length + 1;

        if (key.name === "up" || key.name === "k") {
          setPqs((s) => ({ ...s, selected: (s.selected - 1 + totalItems) % totalItems }));
          return;
        }
        if (key.name === "down" || key.name === "j") {
          setPqs((s) => ({ ...s, selected: (s.selected + 1) % totalItems }));
          return;
        }

        // Number keys 1-9 for quick selection
        const digit = Number(key.name);
        if (!Number.isNaN(digit) && digit >= 1 && digit <= Math.min(totalItems, 9)) {
          const idx = digit - 1;
          setPqs((s) => ({ ...s, selected: idx }));
          handlePlanSelect(q, idx, options, showCustom);
          return;
        }

        // Enter — select current option
        if (key.name === "return") {
          handlePlanSelect(q, pqs.selected, options, showCustom);
          return;
        }

        return;
      }
      if (showUpdateModalRef.current) {
        if (isEscapeKey(key)) {
          setShowUpdateModal(false);
          return;
        }
        if (key.name === "return") {
          setIsUpdating(true);
          setShowUpdateModal(false);
          runUpdate(startupConfig.version).then((result) => {
            setIsUpdating(false);
            setUpdateOutput(result.output);
          });
          return;
        }
        return;
      }
      if (showMcpEditorRef.current) {
        if (isEscapeKey(key)) {
          setShowMcpEditor(false);
          setMcpEditorError(null);
          setMcpSearchQuery("");
          return;
        }
        if (key.name === "return") {
          submitMcpEditor();
          return;
        }
        if (mcpEditorField === "transport" && (key.name === "left" || key.name === "right")) {
          cycleMcpEditorTransport(key.name === "left" ? -1 : 1);
          return;
        }
        if (key.name === "tab") {
          const idx = mcpEditorFields.indexOf(mcpEditorField);
          const nextIdx = (idx + (key.shift ? -1 : 1) + mcpEditorFields.length) % mcpEditorFields.length;
          setMcpEditorField(mcpEditorFields[nextIdx]);
          return;
        }
        if (mcpEditorField === "transport") {
          return;
        }
      }
      if (showAgentsEditorRef.current) {
        if (isEscapeKey(key)) {
          setShowAgentsEditor(false);
          setAgentsEditorError(null);
          return;
        }
        if (key.name === "x" && key.ctrl && editingSubagent) {
          removeEditingSubagent();
          return;
        }
        if (key.name === "return") {
          submitSubagentEditor();
          return;
        }
        if (
          agentsEditorField === "model" &&
          (key.name === "up" ||
            key.name === "down" ||
            key.name === "left" ||
            key.name === "right" ||
            key.name === "j" ||
            key.name === "k")
        ) {
          const decrement = key.name === "up" || key.name === "left" || key.name === "k";
          setAgentsEditorModelIndex((index) =>
            decrement ? Math.max(0, index - 1) : Math.min(Math.max(0, modelCatalog.length - 1), index + 1),
          );
          return;
        }
        if (key.name === "tab") {
          const index = SUBAGENT_EDITOR_FIELDS.indexOf(agentsEditorField);
          const nextIndex =
            (index + (key.shift ? -1 : 1) + SUBAGENT_EDITOR_FIELDS.length) % SUBAGENT_EDITOR_FIELDS.length;
          setAgentsEditorField(SUBAGENT_EDITOR_FIELDS[nextIndex]);
          return;
        }
        if (agentsEditorField === "model") {
          return;
        }
      }
      if (showMcpModalRef.current) {
        const row = mcpRows[mcpModalIndex];
        if (isEscapeKey(key)) {
          setShowMcpEditor(false);
          setShowMcpModal(false);
          setMcpSearchQuery("");
          setEditingMcpId(null);
          setMcpEditorError(null);
          return;
        }
        if (key.name === "up") {
          setMcpModalIndex((i) => Math.max(0, i - 1));
          return;
        }
        if (key.name === "down") {
          setMcpModalIndex((i) => Math.min(mcpRows.length - 1, i + 1));
          return;
        }
        if (key.name === "return") {
          if (row?.kind === "server") {
            toggleSavedMcp(row.server);
          } else if (row?.kind === "catalog") {
            openCatalogMcp(row.entry);
          } else {
            openMcpEditor(createEmptyMcpEditorDraft());
          }
          return;
        }
        if (key.name === "a" && key.ctrl) {
          openMcpEditor(createEmptyMcpEditorDraft());
          return;
        }
        if (key.name === "e" && key.ctrl && row?.kind === "server") {
          editSavedMcp(row.server);
          return;
        }
        if (key.name === "x" && key.ctrl && row?.kind === "server") {
          deleteSavedMcp(row.server);
          return;
        }
        if (key.name === "backspace") {
          setMcpSearchQuery((q) => q.slice(0, -1));
          setMcpModalIndex(0);
          return;
        }
        if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) {
          setMcpSearchQuery((q) => q + key.sequence);
          setMcpModalIndex(0);
          return;
        }
        return;
      }
      if (showScheduleModalRef.current) {
        const row = scheduleRows[scheduleModalIndex];
        if (isEscapeKey(key)) {
          setShowScheduleModal(false);
          setScheduleSearchQuery("");
          return;
        }
        if (key.name === "up") {
          setScheduleModalIndex((index) => Math.max(0, index - 1));
          return;
        }
        if (key.name === "down") {
          setScheduleModalIndex((index) => Math.min(Math.max(0, scheduleRows.length - 1), index + 1));
          return;
        }
        if (key.name === "return") {
          if (row?.kind === "schedule") {
            showScheduleDetails(row.schedule);
          }
          return;
        }
        if (key.name === "x" && key.ctrl && row?.kind === "schedule") {
          removeSchedule(row.schedule);
          return;
        }
        if (key.name === "backspace") {
          setScheduleSearchQuery((query) => query.slice(0, -1));
          setScheduleModalIndex(0);
          return;
        }
        if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) {
          setScheduleSearchQuery((query) => query + key.sequence);
          setScheduleModalIndex(0);
          return;
        }
        return;
      }
      if (showAgentsModalRef.current && !showAgentsEditorRef.current) {
        const row = agentRows[agentsModalIndex];
        if (isEscapeKey(key)) {
          setShowAgentsModal(false);
          setShowAgentsEditor(false);
          setAgentsSearchQuery("");
          setEditingSubagent(null);
          setAgentsEditorError(null);
          return;
        }
        if (key.name === "up") {
          setAgentsModalIndex((index) => Math.max(0, index - 1));
          return;
        }
        if (key.name === "down") {
          setAgentsModalIndex((index) => Math.min(Math.max(0, agentRows.length - 1), index + 1));
          return;
        }
        if (key.name === "return") {
          if (row?.kind === "agent") {
            openSubagentEditor(row.agent);
          }
          return;
        }
        if (key.name === "a" && key.ctrl) {
          openSubagentEditor(null);
          return;
        }
        if (key.name === "backspace") {
          setAgentsSearchQuery((query) => query.slice(0, -1));
          setAgentsModalIndex(0);
          return;
        }
        if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) {
          setAgentsSearchQuery((query) => query + key.sequence);
          setAgentsModalIndex(0);
          return;
        }
        return;
      }
      if (showTelegramTokenModalRef.current) {
        if (isEscapeKey(key)) {
          setShowTelegramTokenModal(false);
          setTelegramTokenError(null);
          return;
        }
        if (key.name === "return") {
          submitTelegramToken();
        }
        return;
      }
      if (showTelegramPairModalRef.current) {
        if (isEscapeKey(key)) {
          setShowTelegramPairModal(false);
          setTelegramPairError(null);
          return;
        }
        if (key.name === "return") {
          void submitTelegramPair();
        }
        return;
      }
      if (showConnectModalRef.current) {
        if (isEscapeKey(key)) {
          setShowConnectModal(false);
          return;
        }
        if (key.name === "up") {
          setConnectModalIndex((i) => Math.max(0, i - 1));
          return;
        }
        if (key.name === "down") {
          setConnectModalIndex((i) => Math.min(CONNECT_CHANNELS.length - 1, i + 1));
          return;
        }
        if (key.name === "return") {
          const ch = CONNECT_CHANNELS[connectModalIndex];
          if (ch?.id === "telegram") beginTelegramFromConnect();
          return;
        }
        return;
      }
      if (showApiKeyModalRef.current) {
        if (isEscapeKey(key)) {
          closeApiKeyModal();
          return;
        }
        if (key.name === "return") {
          submitApiKey();
        }
        return;
      }
      if (showSlashMenu) {
        if (isEscapeKey(key)) {
          setShowSlashMenu(false);
          setSlashSearchQuery("");
          inputRef.current?.clear();
          return;
        }
        if (key.name === "up") {
          setSlashMenuIndex((i) => Math.max(0, i - 1));
          return;
        }
        if (key.name === "down") {
          setSlashMenuIndex((i) => Math.min(filteredSlashItems.length - 1, i + 1));
          return;
        }
        if (key.name === "return") {
          const item = filteredSlashItems[slashMenuIndex];
          if (item) handleSlashMenuSelect(item);
          setSlashSearchQuery("");
          return;
        }
        if (key.name === "backspace") {
          setSlashSearchQuery((q) => q.slice(0, -1));
          setSlashMenuIndex(0);
          return;
        }
        if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) {
          setSlashSearchQuery((q) => q + key.sequence);
          setSlashMenuIndex(0);
          return;
        }
        return;
      }
      if (showModelPicker) {
        if (isEscapeKey(key)) {
          setShowModelPicker(false);
          setModelSearchQuery("");
          return;
        }
        if (key.name === "up") {
          setModelPickerIndex((i) => Math.max(0, i - 1));
          return;
        }
        if (key.name === "down") {
          setModelPickerIndex((i) => Math.min(filteredModelIds.length - 1, i + 1));
          return;
        }
        if (key.name === "left" || key.name === "right") {
          const sel = filteredModelIds[modelPickerIndex];
          if (sel) {
            adjustModelReasoningEffort(sel, key.name === "left" ? -1 : 1);
          }
          return;
        }
        if (key.name === "return") {
          const sel = filteredModelIds[modelPickerIndex];
          if (sel && !switchingModel) {
            // Keep the picker open on failure so its error is visible; closing
            // it unconditionally hid every model-switch failure.
            void selectLocalModel(sel).then((switched) => {
              if (!switched) return;
              setShowModelPicker(false);
              setModelSearchQuery("");
            });
          }
          return;
        }
        if (key.name === "backspace") {
          setModelSearchQuery((q) => q.slice(0, -1));
          setModelPickerIndex(0);
          return;
        }
        if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) {
          setModelSearchQuery((q) => q + key.sequence);
          setModelPickerIndex(0);
          return;
        }
        return;
      }
      if (pendingPaymentApproval) {
        if (isEscapeKey(key)) {
          setPendingPaymentApproval(null);
          return;
        }
        if (key.name === "up" || key.name === "down") {
          setPendingPaymentApproval((p) => (p ? { ...p, selected: p.selected === 0 ? 1 : 0 } : p));
          return;
        }
        if (key.name === "return") {
          const approved = pendingPaymentApproval.selected === 0;
          const aid = pendingPaymentApproval.approvalId;
          setPendingPaymentApproval(null);
          if (aid) {
            agent.respondToToolApproval(aid, approved);
            if (approved) {
              processMessage("[Payment approved]");
            }
          }
          return;
        }
        return;
      }
      if (showThemePicker) {
        if (isEscapeKey(key)) {
          setShowThemePicker(false);
          return;
        }
        if (key.name === "up") {
          setThemePickerIndex((index) => Math.max(0, index - 1));
          return;
        }
        if (key.name === "down") {
          setThemePickerIndex((index) => Math.min(1, index + 1));
          return;
        }

        const options: readonly string[] = themePickerIndex === 0 ? THEME_OPTIONS : MOTION_OPTIONS;
        const current = themePickerIndex === 0 ? themePreference : motionPreference;
        if (key.name === "left" || key.name === "right" || key.name === "return") {
          const currentIndex = options.indexOf(current);
          const nextIndex =
            key.name === "left"
              ? Math.max(0, currentIndex - 1)
              : key.name === "right"
                ? Math.min(options.length - 1, currentIndex + 1)
                : (currentIndex + 1) % options.length;
          const next = options[nextIndex];
          if (next && next !== current) {
            if (themePickerIndex === 0) applyThemePreference(next as ThemePreference);
            else applyMotionPreference(next as MotionPreference);
          }
          return;
        }
        return;
      }
      if (showRecapPicker) {
        if (isEscapeKey(key)) {
          setShowRecapPicker(false);
          return;
        }
        if (key.name === "left" || key.name === "right") {
          const current = formatRecapsEnabled(recapsEnabled);
          const idx = RECAP_OPTIONS.indexOf(current);
          const next =
            key.name === "right"
              ? RECAP_OPTIONS[Math.min(RECAP_OPTIONS.length - 1, idx + 1)]
              : RECAP_OPTIONS[Math.max(0, idx - 1)];
          if (next && next !== current) {
            applyRecapsEnabled(next === "On");
          }
          return;
        }
        if (key.name === "return") {
          applyRecapsEnabled(!recapsEnabled);
          return;
        }
        return;
      }
      if (showEffortPicker) {
        if (isEscapeKey(key)) {
          setShowEffortPicker(false);
          return;
        }
        const supportedEfforts = getSupportedReasoningEfforts(model);
        if (supportedEfforts.length === 0) {
          if (key.name === "return") setShowEffortPicker(false);
          return;
        }
        const effortOptions: Array<ReasoningEffort | "auto"> = ["auto", ...supportedEfforts];
        const currentEffort = reasoningEffort ?? "auto";
        if (key.name === "left" || key.name === "right") {
          const idx = effortOptions.indexOf(currentEffort);
          const next =
            key.name === "right"
              ? effortOptions[Math.min(effortOptions.length - 1, idx + 1)]
              : effortOptions[Math.max(0, idx - 1)];
          if (next && next !== currentEffort) {
            applyReasoningEffort(next === "auto" ? null : next);
          }
          return;
        }
        if (key.name === "return") {
          const idx = effortOptions.indexOf(currentEffort);
          const next = effortOptions[(idx + 1) % effortOptions.length];
          applyReasoningEffort(next === "auto" ? null : next);
          return;
        }
        return;
      }
      if (showWalletPicker) {
        if (isEscapeKey(key)) {
          setShowWalletPicker(false);
          return;
        }
        if (key.name === "up") {
          setWalletFocusIndex((i) => Math.max(0, i - 1));
          return;
        }
        if (key.name === "down") {
          setWalletFocusIndex((i) => Math.min(WALLET_ROWS.length - 1, i + 1));
          return;
        }

        const focusedWalletRow = WALLET_ROWS[walletFocusIndex];
        if (!focusedWalletRow || focusedWalletRow.type === "readonly") return;

        if (key.name === "left" || key.name === "right") {
          const options = focusedWalletRow.getOptions!();
          const current = focusedWalletRow.getDisplay(walletSettings, walletDisplayInfo);
          const idx = options.indexOf(current);
          const next =
            key.name === "right" ? options[Math.min(options.length - 1, idx + 1)] : options[Math.max(0, idx - 1)];
          if (next && next !== current && focusedWalletRow.apply) {
            const patch = focusedWalletRow.apply(walletSettings, next);
            applyWalletSettings({ ...walletSettings, ...patch });
          }
          return;
        }

        if (key.name === "return") {
          const options = focusedWalletRow.getOptions!();
          const current = focusedWalletRow.getDisplay(walletSettings, walletDisplayInfo);
          const idx = options.indexOf(current);
          const next = options[(idx + 1) % options.length];
          if (next && focusedWalletRow.apply) {
            const patch = focusedWalletRow.apply(walletSettings, next);
            applyWalletSettings({ ...walletSettings, ...patch });
          }
          return;
        }
        return;
      }
      if (showSandboxPicker) {
        const visibleRows = getSandboxVisibleRows(sandboxMode);

        if (sandboxSettingsEditing) {
          if (isEscapeKey(key)) {
            setSandboxSettingsEditing(null);
            setSandboxSettingsEditBuffer("");
            return;
          }
          if (key.name === "return") {
            const row = visibleRows.find((r) => r.key === sandboxSettingsEditing);
            if (row) {
              const result = row.apply(sandboxMode, sandboxSettings, sandboxSettingsEditBuffer.trim());
              if (result.mode !== undefined) applySandboxMode(result.mode);
              if (result.settings) applySandboxSettings({ ...sandboxSettings, ...result.settings });
            }
            setSandboxSettingsEditing(null);
            setSandboxSettingsEditBuffer("");
            return;
          }
          if (key.name === "backspace") {
            setSandboxSettingsEditBuffer((b) => b.slice(0, -1));
            return;
          }
          if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) {
            setSandboxSettingsEditBuffer((b) => b + key.sequence);
            return;
          }
          return;
        }

        if (isEscapeKey(key)) {
          setShowSandboxPicker(false);
          return;
        }
        if (key.name === "up") {
          setSandboxSettingsFocusIndex((i) => Math.max(0, i - 1));
          return;
        }
        if (key.name === "down") {
          setSandboxSettingsFocusIndex((i) => Math.min(visibleRows.length - 1, i + 1));
          return;
        }

        const focusedRow = visibleRows[sandboxSettingsFocusIndex];
        if (!focusedRow) return;

        if (focusedRow.type === "toggle" && (key.name === "left" || key.name === "right")) {
          const options = focusedRow.getOptions!();
          const current = focusedRow.getDisplay(sandboxMode, sandboxSettings);
          const idx = options.indexOf(current);
          const next =
            key.name === "right" ? options[Math.min(options.length - 1, idx + 1)] : options[Math.max(0, idx - 1)];
          if (next && next !== current) {
            const result = focusedRow.apply(sandboxMode, sandboxSettings, next);
            if (result.mode !== undefined) applySandboxMode(result.mode);
            if (result.settings) applySandboxSettings({ ...sandboxSettings, ...result.settings });
          }
          return;
        }

        if (key.name === "return") {
          if (focusedRow.type === "toggle") {
            const options = focusedRow.getOptions!();
            const current = focusedRow.getDisplay(sandboxMode, sandboxSettings);
            const idx = options.indexOf(current);
            const next = options[(idx + 1) % options.length];
            const result = focusedRow.apply(sandboxMode, sandboxSettings, next);
            if (result.mode !== undefined) applySandboxMode(result.mode);
            if (result.settings) applySandboxSettings({ ...sandboxSettings, ...result.settings });
          } else {
            setSandboxSettingsEditing(focusedRow.key);
            const current = sandboxSettings[focusedRow.key as keyof SandboxSettings];
            setSandboxSettingsEditBuffer(
              Array.isArray(current) ? current.join(", ") : current != null ? String(current) : "",
            );
          }
          return;
        }
        return;
      }

      if (isEscapeKey(key) && interruptActiveRun(key)) {
        return;
      }

      if (!hasApiKeyRef.current && shouldOpenApiKeyModalForKey(key)) {
        openApiKeyModal();
        return;
      }
      if (key.sequence === "/" && !isProcessing) {
        const text = inputRef.current?.plainText || "";
        if (!text.trim()) {
          setShowSlashMenu(true);
          setSlashMenuIndex(0);
          setSlashSearchQuery("");
          return;
        }
      }

      if (key.name === "e" && key.ctrl) {
        let lastUserIdx = -1;
        for (let i = messages.length - 1; i >= 0; i--) {
          if (messages[i]!.type === "user") {
            lastUserIdx = i;
            break;
          }
        }
        if (lastUserIdx >= 0) {
          setExpandedMessages((prev) => {
            const next = new Set(prev);
            if (next.has(lastUserIdx)) next.delete(lastUserIdx);
            else next.add(lastUserIdx);
            return next;
          });
        }
        return;
      }
      if (key.name === "c" && key.ctrl && key.shift) {
        if (copyTuiSelectionToHost()) {
          key.preventDefault();
          key.stopPropagation();
        }
        return;
      }
      if (key.name === "y" && key.ctrl && copyTuiSelectionToHost()) {
        key.preventDefault();
        key.stopPropagation();
        return;
      }
      // ⌘C: Kitty / iTerm report Command as `super`; some setups use `meta` instead.
      if (key.name === "c" && !key.ctrl && (key.meta || key.super)) {
        if (copyTuiSelectionToHost()) {
          key.preventDefault();
          key.stopPropagation();
          return;
        }
      }
      if (key.name === "c" && key.ctrl) {
        if (copyTuiSelectionToHost()) {
          key.preventDefault();
          key.stopPropagation();
          return;
        }
        const text = inputRef.current?.plainText || "";
        if (text.trim()) {
          inputRef.current?.clear();
          replacePasteBlocks([]);
        } else {
          handleExit();
        }
        return;
      }
      if (typeaheadRef.current.visible) {
        if (key.name === "up") {
          typeaheadRef.current.navigateUp();
          return;
        }
        if (key.name === "down") {
          typeaheadRef.current.navigateDown();
          return;
        }
        if (key.name === "tab" || key.name === "return") {
          key.preventDefault();
          key.stopPropagation();
          typeaheadRef.current.accept();
          return;
        }
        if (isEscapeKey(key)) {
          typeaheadRef.current.dismiss();
          return;
        }
      }
      if (key.name === "tab" && !isProcessing) {
        cycleMode();
        return;
      }
    },
    [
      agent,
      agentRows,
      agentsEditorField,
      agentsModalIndex,
      beginTelegramFromConnect,
      btwState,
      closeApiKeyModal,
      connectModalIndex,
      cycleMode,
      cycleMcpEditorTransport,
      deleteSavedMcp,
      dismissBtw,
      dismissPlan,
      editingSubagent,
      editSavedMcp,
      adjustModelReasoningEffort,
      selectLocalModel,
      switchingModel,
      filteredModelIds,
      filteredSlashItems,
      handleExit,
      handlePlanSelect,
      handleSlashMenuSelect,
      interruptActiveRun,
      inspectorTab,
      isPlanConfirmTab,
      isProcessing,
      isSinglePlan,
      mcpEditorField,
      mcpEditorFields,
      mcpModalIndex,
      mcpRows,
      modelPickerIndex,
      openApiKeyModal,
      openCatalogMcp,
      openMcpEditor,
      replacePasteBlocks,
      openSubagentEditor,
      removeSchedule,
      scheduleModalIndex,
      scheduleRows,
      showScheduleDetails,
      submitTelegramPair,
      submitTelegramToken,
      submitMcpEditor,
      submitSubagentEditor,
      planQuestions,
      planTabCount,
      pqs,
      removeEditingSubagent,
      applyRecapsEnabled,
      applyReasoningEffort,
      applySandboxMode,
      applySandboxSettings,
      applyThemePreference,
      applyMotionPreference,
      model,
      motionPreference,
      recapsEnabled,
      reasoningEffort,
      showEffortPicker,
      sandboxSettings,
      sandboxSettingsEditing,
      sandboxSettingsEditBuffer,
      sandboxSettingsFocusIndex,
      sandboxMode,
      showModelPicker,
      showPlanPanel,
      showRecapPicker,
      showSandboxPicker,
      showThemePicker,
      pendingPaymentApproval,
      processMessage,
      showWalletPicker,
      walletSettings,
      walletFocusIndex,
      walletDisplayInfo,
      applyWalletSettings,
      showSlashMenu,
      slashMenuIndex,
      showInspector,
      submitApiKey,
      submitPlanAnswers,
      themePickerIndex,
      themePreference,
      copyTuiSelectionToHost,
      toggleSavedMcp,
      messages,
      modelCatalog,
      startupConfig.version,
    ],
  );
  useKeyboard(handleKey);

  const handlePaste = useCallback(
    (event: PasteEvent) => {
      if (!hasApiKeyRef.current) {
        event.preventDefault();
        openApiKeyModal();
        return;
      }

      const text = decodePasteBytes(event.bytes);
      const trimmed = text.trim();
      const imageExts = /\.(png|jpe?g|gif|webp|svg|bmp|ico|tiff?)$/i;
      if (imageExts.test(trimmed) && !trimmed.includes("\n")) {
        event.preventDefault();
        const id = ++pasteCounterRef.current;
        const block = { id, content: trimmed, lines: 1, isImage: true } satisfies PasteBlock;
        replacePasteBlocks([...pasteBlocksRef.current, block]);
        inputRef.current?.insertText(getPasteBlockToken(block));
        return;
      }
      const lineCount = text.split("\n").length;
      if (lineCount < 2) return;
      event.preventDefault();
      const id = ++pasteCounterRef.current;
      const block = { id, content: text, lines: lineCount } satisfies PasteBlock;
      replacePasteBlocks([...pasteBlocksRef.current, block]);
      inputRef.current?.insertText(getPasteBlockToken(block));
    },
    [openApiKeyModal, replacePasteBlocks],
  );

  const handleSubmit = useCallback(() => {
    const raw = inputRef.current?.plainText || "";
    if (!raw.trim() && pasteBlocksRef.current.length === 0) {
      if (queuedMessagesRef.current.length > 0 && isProcessingRef.current) {
        interruptedRunIdRef.current = activeRunIdRef.current;
        const activeAgent = activeTurnRef.current?.agent ?? agent;
        activeTurnRef.current = null;
        clearLiveTurnUi();
        activeAgent.abort();
      }
      return;
    }
    inputRef.current?.clear();
    let message = raw;
    const blocks = [...pasteBlocksRef.current];
    replacePasteBlocks([]);
    for (const block of blocks) {
      message = message.replace(getPasteBlockToken(block), block.content);
    }
    const displayText = message.trim();
    const fileBlocks = [...fileMentionBlocksRef.current];
    fileMentionBlocksRef.current = [];
    for (const block of fileBlocks) {
      message = message.replace(getFileMentionToken(block), `@${block.path}`);
    }
    if (!message.trim()) return;
    if (!hasApiKeyRef.current) {
      openApiKeyModal();
      return;
    }
    if (handleCommand(message)) return;
    const { enhancedMessage } = processAtMentions(message.trim(), agent.getCwd());
    if (isProcessingRef.current) {
      queuedMessagesRef.current.push({ text: enhancedMessage, displayText });
      setQueuedMessages(queuedMessagesRef.current.map((msg) => msg.displayText));
      setTimeout(scrollToBottom, 10);
      return;
    }
    processMessage(enhancedMessage, displayText);
  }, [agent, clearLiveTurnUi, handleCommand, openApiKeyModal, processMessage, replacePasteBlocks, scrollToBottom]);

  const inspectorPlan = useMemo(
    () => resolvePlanState(messages) ?? publishedPlan ?? activePlan,
    [activePlan, messages, publishedPlan],
  );
  const inspectorChangedFiles = changedFiles(messages, kernelState);
  const originalIntent = messages.find((entry) => entry.type === "user")?.content ?? null;
  const currentActivity = useMemo(() => {
    if (activeSubagent) {
      return `${formatSubagentName(activeSubagent.agent)}: ${truncateActivity(activeSubagent.detail)}`;
    }
    const activeTool = [...activeToolCalls].reverse().find(isPresentationToolCall);
    if (activeTool) {
      return toolLabel(activeTool);
    }
    const activeEvent = [...activityEvents]
      .reverse()
      .find((event) => event.status === "active" && event.operation !== "update_plan_step");
    if (activeEvent) return activeEvent.label + (activeEvent.detail ? `: ${truncateActivity(activeEvent.detail)}` : "");
    return phaseLabel(kernelState, isProcessing);
  }, [activeSubagent, activeToolCalls, activityEvents, isProcessing, kernelState]);
  const currentActivityStartedAt = useMemo(() => {
    if (activeSubagent && activeSubagentStartedAt) return activeSubagentStartedAt;
    const presentationTools = activeToolCalls.filter(isPresentationToolCall);
    if (presentationTools.length > 0) {
      const activeToolIds = new Set(presentationTools.map((toolCall) => toolCall.id));
      const activeToolEvent = [...activityEvents]
        .reverse()
        .find((event) => event.status === "active" && [...activeToolIds].some((id) => event.id.includes(id)));
      if (activeToolEvent) return activeToolEvent.at;
    }
    const activeEvent = [...activityEvents]
      .reverse()
      .find((event) => event.status === "active" && event.operation !== "update_plan_step");
    if (activeEvent) return activeEvent.at;
    return isProcessing ? startTimeRef.current || null : null;
  }, [activeSubagent, activeSubagentStartedAt, activeToolCalls, activityEvents, isProcessing]);
  const currentActivityElapsedMs = currentActivityStartedAt ? Math.max(0, nowTick - currentActivityStartedAt) : null;
  const inspectorContextSummary = agent.getContextSummary();
  const inspectorContextStats: InspectorContextStats | null = contextStats;
  const transcriptItems = useMemo(() => projectTranscript(messages), [messages]);
  const liveActivityItems = useMemo(() => visibleRuntimeActivity(activityEvents), [activityEvents]);
  const hasMessages = messages.length > 0 || streamContent.length > 0 || isProcessing;
  const workspaceLayout = resolveWorkspaceLayout(width, hasMessages);
  const { sidebarWidth, showSidebar: showWorkspaceSidebar, chatWidth } = workspaceLayout;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: OpenCode-style copy-on-mouse-up on root surface
    <box
      width={width}
      height={height}
      backgroundColor={t.background}
      flexDirection="column"
      onMouseUp={handleRootMouseUp}
    >
      {copyFlashId > 0 ? <CopyFlashBanner t={t} width={width} /> : null}
      {hasMessages ? (
        <box flexGrow={1} flexDirection="row" minHeight={0}>
          <box width={chatWidth} flexDirection="column" minHeight={0}>
            <SessionHeader t={t} modeInfo={modeInfo} sessionTitle={sessionTitle} sessionId={sessionId} />
            <box flexGrow={1} paddingBottom={1} paddingTop={1} paddingLeft={2} paddingRight={2} gap={1}>
              {/* Scrollable messages */}
              <scrollbox
                ref={scrollRef}
                flexGrow={1}
                stickyScroll={true}
                // biome-ignore lint/suspicious/noExplicitAny: OpenTUI type mismatch for stickyStart
                stickyStart={"bottom" as any}
                // A short conversation must hug the composer, not float at the top with a dead
                // gap below it — the scrollbox's internal content box has a forced 100% min
                // height (so scrollbar math works), so without this the empty leftover space
                // lands below the messages instead of above them.
                contentOptions={{ justifyContent: "flex-end" }}
              >
                {transcriptItems.map((item) =>
                  item.kind === "message" ? (
                    <MessageView
                      key={item.id}
                      entry={item.entry}
                      index={item.sourceIndex}
                      t={t}
                      modeColor={modeAccent(t, modeInfo)}
                      expandedMessages={expandedMessages}
                    />
                  ) : (
                    <TranscriptActivityView key={item.id} t={t} item={item} />
                  ),
                )}
                {liveTurnSourceLabel && (activeToolCalls.length > 0 || streamContent || isProcessing) && (
                  <box paddingLeft={3} marginTop={1} flexShrink={0}>
                    <text fg={t.textMuted}>{liveTurnSourceLabel}</text>
                  </box>
                )}
                {/* Active tool calls — pending inline */}
                <RuntimeActivityTree
                  t={t}
                  title={isProcessing ? currentActivity : null}
                  elapsedMs={currentActivityElapsedMs}
                  activities={liveActivityItems}
                  found={liveActivityItems.length > 0 ? streamContent || null : null}
                  next={liveActivityItems.length > 0 ? nextPlanStepLabel(inspectorPlan) : null}
                  isProcessing={isProcessing}
                  reducedMotion={reducedMotion}
                />
                {/* Streaming assistant content — only when there's no live activity tree to fold it into */}
                {streamContent && liveActivityItems.length === 0 && (
                  <box paddingLeft={3} marginTop={1} flexShrink={0}>
                    <Markdown content={streamContent} t={t} />
                  </box>
                )}
                {/* Waiting indicator */}
                {/* Plan questions panel — inline, OpenCode-style */}
                {showPlanPanel && <PlanQuestionsPanel t={t} questions={planQuestions} state={pqs} />}
                {pendingPaymentApproval && <PaymentApprovalPanel t={t} payment={pendingPaymentApproval} />}
              </scrollbox>
              {btwState && <BtwOverlay state={btwState} theme={t} />}
              {/* Prompt */}
              <box flexShrink={0} flexDirection="column">
                {sessionRecap ? <RecapBanner t={t} recap={sessionRecap} /> : null}
                <SessionStatusStrip
                  t={t}
                  width={chatWidth}
                  isProcessing={isProcessing}
                  kernel={kernelState}
                  currentActivity={currentActivity}
                  elapsedMs={currentActivityElapsedMs}
                  changedFileCount={inspectorChangedFiles.length}
                  planStepCount={inspectorPlan?.steps.length ?? 0}
                  activeAgent={activeSubagent}
                />
                <PromptBox
                  t={t}
                  inputRef={inputRef}
                  isProcessing={isProcessing}
                  showModelPicker={showModelPicker}
                  showSandboxPicker={showSandboxPicker}
                  showWalletPicker={showWalletPicker}
                  showSlashMenu={showSlashMenu}
                  showPlanQuestions={showPlanPanel}
                  showApiKeyModal={showApiKeyModal}
                  blockPrompt={blockPrompt}
                  onSubmit={handleSubmit}
                  onPaste={handlePaste}
                  pasteBlocks={pasteBlocks}
                  modeInfo={modeInfo}
                  model={model}
                  modelInfo={modelInfo}
                  contextStats={contextStats}
                  queuedCount={queuedMessages.length}
                  queuedMessages={queuedMessages}
                  typeahead={typeahead}
                />
                <ActiveAgentsStrip
                  t={t}
                  activeSubagent={activeSubagent}
                  startedAt={activeSubagentStartedAt}
                  lastActivityAt={activeSubagentActivityAt}
                  delegations={delegations}
                  now={nowTick}
                />
              </box>
            </box>
            <box paddingLeft={2} paddingRight={2} paddingBottom={1} flexDirection="row" flexShrink={0}>
              <text fg={t.textDim}>{agent.getCwd().replace(os.homedir(), "~")}</text>
              {sandboxMode === "shuru" ? <text fg={t.warning}>{" · sandbox"}</text> : null}
              <box flexGrow={1} />
            </box>
          </box>
          {showWorkspaceSidebar ? (
            <WorkspaceSidebar
              t={t}
              width={sidebarWidth}
              isProcessing={isProcessing}
              kernel={kernelState}
              currentActivity={currentActivity}
              plan={inspectorPlan}
              changedFiles={inspectorChangedFiles}
              activities={activityEvents}
              activeSubagent={activeSubagent}
              lastActivityAt={activeSubagentActivityAt}
              delegations={delegations}
              activeToolCalls={activeToolCalls}
              contextSummary={inspectorContextSummary}
              contextStats={inspectorContextStats}
              usage={usageSummary}
              sessionStartedAt={sessionStartedAtRef.current}
              now={nowTick}
              model={model}
              modeLabel={modeInfo.label}
              reasoningEffort={describeReasoningEffort(
                reasoningEffort,
                reasoningEffortByModel[normalizeModelId(model)],
                agent.resolveReasoningEffort(model),
                getSupportedReasoningEfforts(model),
              )}
              verificationStatus={agent.getVerificationStatus()}
              memoryStatus={memoryStatus}
            />
          ) : null}
        </box>
      ) : (
        /* ── Home ───────────────────────────────────────── */
        <>
          <box flexGrow={1} alignItems="center" paddingLeft={2} paddingRight={2}>
            <box flexGrow={1} minHeight={0} />
            <box flexShrink={0} alignItems="center">
              <HeroLogo t={t} width={width} />
            </box>
            <box height={1} minHeight={0} flexShrink={1} />
            <box width="100%" maxWidth={75} flexShrink={0}>
              <PromptBox
                t={t}
                inputRef={inputRef}
                isProcessing={isProcessing}
                showModelPicker={showModelPicker}
                showSandboxPicker={showSandboxPicker}
                showWalletPicker={showWalletPicker}
                showSlashMenu={showSlashMenu}
                showPlanQuestions={showPlanPanel}
                showApiKeyModal={showApiKeyModal}
                blockPrompt={blockPrompt}
                onSubmit={handleSubmit}
                onPaste={handlePaste}
                pasteBlocks={pasteBlocks}
                modeInfo={modeInfo}
                model={model}
                modelInfo={modelInfo}
                contextStats={contextStats}
                placeholder={"What are we building?"}
                typeahead={typeahead}
              />
            </box>
            <box height={2} minHeight={0} flexShrink={1} />
            <box flexGrow={1} minHeight={0} />
          </box>
          {updateInfo?.hasUpdate && (
            <box paddingLeft={2} paddingRight={2} flexDirection="row" flexShrink={0}>
              <text fg={t.warning}>
                {"┃ Update available: v"}
                {startupConfig.version}
                {" → v"}
                {updateInfo.latestVersion}
                {" — run /update to install"}
              </text>
            </box>
          )}
          {isUpdating && (
            <box paddingLeft={2} paddingRight={2} flexDirection="row" flexShrink={0}>
              <text fg={t.warning}>{"┃ Updating..."}</text>
            </box>
          )}
          {updateOutput && !isUpdating && (
            <box paddingLeft={2} paddingRight={2} flexDirection="row" flexShrink={0}>
              <text fg={updateOutput.startsWith("Update complete") ? t.success : t.danger}>
                {"┃ "}
                {updateOutput}
              </text>
            </box>
          )}
          <box paddingLeft={2} paddingRight={2} paddingBottom={1} flexDirection="row" flexShrink={0}>
            <text fg={t.textDim}>{agent.getCwd().replace(os.homedir(), "~")}</text>
            {sandboxMode === "shuru" ? <text fg={t.warning}>{" · sandbox"}</text> : null}
            <box flexGrow={1} />
            <text fg={t.textDim}>{`v${startupConfig.version}`}</text>
          </box>
        </>
      )}
      {showApiKeyModal && (
        <ApiKeyModal
          t={t}
          width={width}
          height={height}
          inputRef={apiKeyInputRef}
          error={apiKeyError}
          onSubmit={submitApiKey}
          cloudMode={Boolean(startupConfig.onApiKey)}
        />
      )}
      {showUpdateModal && updateInfo && (
        <UpdateModal
          t={t}
          width={width}
          height={height}
          currentVersion={startupConfig.version}
          latestVersion={updateInfo.latestVersion}
        />
      )}
      {showSlashMenu && (
        <SlashMenuModal
          t={t}
          selectedIndex={slashMenuIndex}
          width={width}
          height={height}
          searchQuery={slashSearchQuery}
          filteredItems={filteredSlashItems}
        />
      )}
      {showMcpModal && !showMcpEditor && (
        <McpBrowserModal
          t={t}
          width={width}
          height={height}
          selectedIndex={mcpModalIndex}
          searchQuery={mcpSearchQuery}
          rows={mcpRows}
        />
      )}
      {showMcpEditor && (
        <McpEditorModal
          t={t}
          width={width}
          height={height}
          draft={mcpEditorDraft}
          focusedField={mcpEditorField}
          syncKey={mcpEditorSyncKey}
          error={mcpEditorError}
          title={editingMcpId ? "Edit MCP Server" : "Add MCP Server"}
          labelRef={mcpLabelRef}
          urlRef={mcpUrlRef}
          headersRef={mcpHeadersRef}
          commandRef={mcpCommandRef}
          argsRef={mcpArgsRef}
          cwdRef={mcpCwdRef}
          envRef={mcpEnvRef}
          onSubmit={submitMcpEditor}
        />
      )}
      {showScheduleModal && (
        <ScheduleBrowserModal
          t={t}
          width={width}
          height={height}
          selectedIndex={scheduleModalIndex}
          searchQuery={scheduleSearchQuery}
          rows={scheduleRows}
        />
      )}
      {showAgentsModal && !showAgentsEditor && (
        <SubagentsBrowserModal
          t={t}
          width={width}
          height={height}
          selectedIndex={agentsModalIndex}
          searchQuery={agentsSearchQuery}
          rows={agentRows}
        />
      )}
      {showAgentsEditor && (
        <SubagentEditorModal
          key={`subagent-editor-${agentsEditorSyncKey}`}
          t={t}
          width={width}
          height={height}
          draft={agentsEditorDraft}
          focusedField={agentsEditorField}
          modelIndex={agentsEditorModelIndex}
          models={modelCatalog}
          error={agentsEditorError}
          title={editingSubagent ? `Edit sub-agent: ${formatSubagentName(editingSubagent.name)}` : "Add sub-agent"}
          nameRef={subagentNameRef}
          instructionRef={subagentInstructionRef}
          onSubmit={submitSubagentEditor}
          showRemoveHint={!!editingSubagent}
        />
      )}
      {showModelPicker && (
        <ModelPickerModal
          t={t}
          currentModel={model}
          selectedIndex={modelPickerIndex}
          width={width}
          height={height}
          searchQuery={modelSearchQuery}
          filteredModels={filteredModels}
          reasoningEffortByModel={reasoningEffortByModel}
          switching={switchingModel}
          error={modelSwitchError}
        />
      )}
      {showWalletPicker && (
        <WalletPickerModal
          t={t}
          settings={walletSettings}
          walletInfo={walletDisplayInfo}
          focusIndex={walletFocusIndex}
          width={width}
          height={height}
        />
      )}
      {showRecapPicker && <RecapPickerModal t={t} enabled={recapsEnabled} width={width} height={height} />}
      {showThemePicker && (
        <ThemePickerModal
          t={t}
          appearance={themePreference}
          motion={motionPreference}
          focusIndex={themePickerIndex}
          width={width}
          height={height}
        />
      )}
      {showEffortPicker && (
        <EffortPickerModal t={t} modelId={model} effort={reasoningEffort} width={width} height={height} />
      )}
      {showSandboxPicker && (
        <SandboxPickerModal
          t={t}
          currentMode={sandboxMode}
          settings={sandboxSettings}
          focusIndex={sandboxSettingsFocusIndex}
          editing={sandboxSettingsEditing}
          editBuffer={sandboxSettingsEditBuffer}
          width={width}
          height={height}
        />
      )}
      {showConnectModal && (
        <ConnectModal
          t={t}
          width={width}
          height={height}
          selectedIndex={connectModalIndex}
          channels={CONNECT_CHANNELS}
        />
      )}
      {showTelegramTokenModal && (
        <TelegramTokenModal
          t={t}
          width={width}
          height={height}
          inputRef={telegramTokenInputRef}
          error={telegramTokenError}
          onSubmit={submitTelegramToken}
        />
      )}
      {showTelegramPairModal && (
        <TelegramPairModal
          t={t}
          width={width}
          height={height}
          inputRef={telegramPairInputRef}
          error={telegramPairError}
          onSubmit={() => void submitTelegramPair()}
        />
      )}
      {showInspector && (
        <SessionInspector
          t={t}
          width={width}
          height={height}
          tab={inspectorTab}
          sessionId={sessionId}
          cwd={agent.getCwd().replace(os.homedir(), "~")}
          model={model}
          modeLabel={modeInfo.label}
          isProcessing={isProcessing}
          kernel={kernelState}
          currentActivity={currentActivity}
          plan={inspectorPlan}
          originalIntent={originalIntent}
          activities={activityEvents}
          changedFiles={inspectorChangedFiles}
          activeSubagent={activeSubagent}
          activeSubagentStartedAt={activeSubagentStartedAt}
          lastActivityAt={activeSubagentActivityAt}
          delegations={delegations}
          activeToolCalls={activeToolCalls}
          contextSummary={inspectorContextSummary}
          contextStats={inspectorContextStats}
          now={nowTick}
        />
      )}
    </box>
  );
}

/* ── Session Header ──────────────────────────────────────────── */

function SessionHeader({
  t,
  modeInfo,
  sessionTitle,
  sessionId,
}: {
  t: Theme;
  modeInfo: (typeof MODES)[number];
  sessionTitle: string | null;
  sessionId: string | null;
}) {
  return (
    <box flexShrink={0} width="100%">
      <box flexDirection="row" width="100%" paddingTop={1} paddingBottom={1} paddingLeft={2} paddingRight={2}>
        <text>
          <span style={{ fg: modeAccent(t, modeInfo) }}>
            <b>{modeInfo.label}</b>
          </span>
          {sessionTitle ? (
            <span style={{ fg: t.text }}>
              <b>
                {": "}
                {sessionTitle}
              </b>
            </span>
          ) : null}
        </text>
        <box flexGrow={1} />
        {sessionId ? <text fg={t.textDim}>{sessionId}</text> : null}
      </box>
    </box>
  );
}

function RecapBanner({ t, recap }: { t: Theme; recap: string }) {
  return (
    <box width="100%" paddingBottom={1}>
      <text>
        <span style={{ fg: t.textDim }}>{"※ recap: "}</span>
        <span style={{ fg: t.textMuted }}>{truncateLine(recap, 180)}</span>
      </text>
    </box>
  );
}

/* ── Prompt Box ──────────────────────────────────────────────── */

const TEXTAREA_KEYBINDINGS: KeyBinding[] = [
  { name: "return", action: "submit" },
  { name: "return", shift: true, action: "newline" },
];

function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`;
  return String(tokens);
}

function ContextMeter({ t, stats }: { t: Theme; stats: ContextStats }) {
  return (
    <text>
      <span style={{ fg: t.textMuted }}>{`${Math.round(stats.ratioRemaining * 100)}%`}</span>
      <span style={{ fg: t.textDim }}>{` ${formatTokenCount(stats.remainingTokens)}`}</span>
    </text>
  );
}

function PromptBox({
  t,
  inputRef,
  isProcessing,
  showModelPicker,
  showSandboxPicker,
  showWalletPicker,
  showSlashMenu,
  showPlanQuestions,
  showApiKeyModal,
  blockPrompt,
  onSubmit,
  onPaste,
  pasteBlocks: _pasteBlocks,
  modeInfo,
  model,
  modelInfo,
  contextStats,
  placeholder,
  queuedCount,
  queuedMessages,
  typeahead,
}: {
  t: Theme;
  inputRef: React.RefObject<TextareaRenderable | null>;
  isProcessing: boolean;
  showModelPicker: boolean;
  showSandboxPicker: boolean;
  showWalletPicker: boolean;
  showSlashMenu: boolean;
  showPlanQuestions: boolean;
  showApiKeyModal: boolean;
  blockPrompt?: boolean;
  onSubmit: () => void;
  onPaste: (event: PasteEvent) => void;
  pasteBlocks: { id: number; content: string; lines: number }[];
  modeInfo: (typeof MODES)[number];
  model: string;
  modelInfo: ReturnType<typeof getModelInfo>;
  contextStats?: ContextStats | null;
  placeholder?: string;
  queuedCount?: number;
  queuedMessages?: string[];
  typeahead?: TypeaheadState;
}) {
  const hasQueue = (queuedMessages?.length ?? 0) > 0;
  const showSuggestions = typeahead?.visible ?? false;
  const inputFocused =
    !showModelPicker &&
    !showSandboxPicker &&
    !showWalletPicker &&
    !showSlashMenu &&
    !showPlanQuestions &&
    !showApiKeyModal &&
    !blockPrompt;
  const composerBorder = isProcessing ? t.borderStrong : inputFocused ? t.composerFocusBorder : t.border;

  return (
    <box
      backgroundColor={t.backgroundPanel}
      border={["top", "left", "right", "bottom"]}
      borderColor={composerBorder}
      flexDirection="column"
    >
      <box>
        {hasQueue && (
          <box
            paddingLeft={2}
            paddingRight={2}
            paddingTop={1}
            paddingBottom={1}
            backgroundColor={t.queueBg}
            flexShrink={0}
          >
            {queuedMessages!.map((msg, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: append-only queue of plain strings
              <text key={i} fg={t.text}>
                {"→ "}
                {msg}
              </text>
            ))}
            <box height={1} />
            <text>
              <span style={{ fg: t.primary }}>{"enter "}</span>
              <span style={{ fg: t.textMuted }}>{"send now"}</span>
              <span style={{ fg: t.textDim }}>{" · "}</span>
              <span style={{ fg: t.primary }}>{"↑ "}</span>
              <span style={{ fg: t.textMuted }}>{"edit"}</span>
              <span style={{ fg: t.textDim }}>{" · "}</span>
              <span style={{ fg: t.primary }}>{"esc "}</span>
              <span style={{ fg: t.textMuted }}>{"cancel"}</span>
            </text>
          </box>
        )}
        {showSuggestions && typeahead && (
          <SuggestionOverlay t={t} suggestions={typeahead.suggestions} selectedIndex={typeahead.selectedIndex} />
        )}
        <box
          paddingLeft={2}
          paddingRight={2}
          paddingTop={1}
          paddingBottom={1}
          backgroundColor={t.backgroundElement}
          flexDirection="row"
          gap={2}
          alignItems="flex-start"
          flexShrink={0}
        >
          <PromptModeLabel t={t} modeInfo={modeInfo} isProcessing={isProcessing} />
          <box flexGrow={1}>
            <textarea
              ref={inputRef}
              focused={inputFocused}
              placeholder={isProcessing ? "Queue a follow-up..." : placeholder || "Ask Shelra..."}
              textColor={t.text}
              backgroundColor={t.backgroundElement}
              placeholderColor={t.textMuted}
              minHeight={1}
              maxHeight={10}
              wrapMode="word"
              keyBindings={TEXTAREA_KEYBINDINGS}
              onSubmit={onSubmit as unknown as () => void}
              onPaste={onPaste as unknown as (event: PasteEvent) => void}
            />
          </box>
        </box>
      </box>
      <box
        flexDirection="row"
        justifyContent="space-between"
        alignItems="center"
        paddingLeft={2}
        paddingRight={2}
        height={1}
        flexShrink={0}
      >
        <box flexDirection="row" gap={1} alignItems="center" height={1}>
          <text fg={t.text}>{modelInfo?.name || model}</text>
          {contextStats ? <ContextMeter t={t} stats={contextStats} /> : null}
        </box>
        <box flexDirection="row" gap={1} alignItems="center" height={1}>
          {isProcessing ? (
            <box flexDirection="row" gap={1}>
              <text fg={t.text}>
                {"enter "}
                <span style={{ fg: t.textMuted }}>{"queue"}</span>
              </text>
              <text fg={t.danger}>
                <b>{"■ Stop"}</b>
                <span style={{ fg: t.textMuted }}>{`  esc${(queuedCount ?? 0) > 0 ? " clears queue first" : ""}`}</span>
              </text>
            </box>
          ) : showSuggestions ? (
            <box flexDirection="row" gap={1}>
              <text fg={t.text}>
                {"tab "}
                <span style={{ fg: t.textMuted }}>{"accept"}</span>
              </text>
              <text fg={t.text}>
                {"↑↓ "}
                <span style={{ fg: t.textMuted }}>{"navigate"}</span>
              </text>
              <text fg={t.text}>
                {"esc "}
                <span style={{ fg: t.textMuted }}>{"dismiss"}</span>
              </text>
            </box>
          ) : (
            <>
              <text fg={t.text}>
                {"@ "}
                <span style={{ fg: t.textMuted }}>{"files"}</span>
              </text>
              <text fg={t.text}>
                {"shift+enter "}
                <span style={{ fg: t.textMuted }}>{"new line"}</span>
              </text>
              <text fg={t.text}>
                {"tab "}
                <span style={{ fg: t.textMuted }}>{"modes"}</span>
              </text>
            </>
          )}
        </box>
      </box>
    </box>
  );
}

function PromptModeLabel({
  t,
  modeInfo,
  isProcessing,
}: {
  t: Theme;
  modeInfo: (typeof MODES)[number];
  isProcessing: boolean;
}) {
  if (!isProcessing) {
    return (
      <text fg={modeAccent(t, modeInfo)}>
        <b>{modeInfo.label}</b>
      </text>
    );
  }

  return <PromptLoadingBoxes color={modeAccent(t, modeInfo)} />;
}

function PromptLoadingBoxes({ color }: { color: string }) {
  // Aurora owns the only working animation. This static marker keeps the mode
  // label useful to screen readers and reduced-motion users alike.
  const step = { active: 0, forward: true };

  return (
    <text>
      {[0, 1, 2].map((idx) => (
        <span key={idx} style={{ fg: promptLoadingCellColor(color, idx, step.active, step.forward) }}>
          {promptLoadingCellGlyph(idx, step.active, step.forward)}
        </span>
      ))}
    </text>
  );
}

function promptLoadingCellGlyph(index: number, active: number, forward: boolean): string {
  const distance = forward ? active - index : index - active;
  return distance >= 0 && distance < 2 ? "■" : "⬝";
}

function promptLoadingCellColor(color: string, index: number, active: number, forward: boolean): string {
  const distance = forward ? active - index : index - active;
  if (distance === 0) return color;
  if (distance === 1) return withAlpha(color, 0.72);
  return withAlpha(color, 0.22);
}

function withAlpha(color: string, alpha: number): string {
  const normalized = color.trim();
  const hex = normalized.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!hex) return color;

  const body = hex[1];
  const expanded =
    body.length === 3
      ? body
          .split("")
          .map((ch) => ch + ch)
          .join("")
      : body;

  const alphaHex = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
    .toString(16)
    .padStart(2, "0");
  return `#${expanded}${alphaHex}`;
}

function CopyFlashBanner({ t, width }: { t: Theme; width: number }) {
  return (
    <box
      position="absolute"
      left={0}
      top={1}
      width={width}
      zIndex={500}
      alignItems="center"
      flexShrink={0}
      backgroundColor={t.background}
      shouldFill={false}
    >
      <box
        height={3}
        paddingLeft={2}
        paddingRight={2}
        backgroundColor={t.queueBg}
        justifyContent="center"
        alignItems="center"
      >
        <text>
          <span style={{ fg: t.accent }}>{"✓ "}</span>
          <span style={{ fg: t.text }}>{"Copied to clipboard"}</span>
        </text>
      </box>
    </box>
  );
}

function ApiKeyModal({
  t,
  width,
  height,
  inputRef,
  error,
  onSubmit,
  cloudMode,
}: {
  t: Theme;
  width: number;
  height: number;
  inputRef: React.RefObject<TextareaRenderable | null>;
  error: string | null;
  onSubmit: () => void;
  cloudMode: boolean;
}) {
  const overlayBg = t.overlay;
  const panelWidth = Math.min(68, width - 6);
  const panelHeight = 13;
  const top = bottomAlignedModalTop(height, panelHeight);

  return (
    <box
      position="absolute"
      left={0}
      top={0}
      width={width}
      height={height}
      alignItems="center"
      paddingTop={top}
      backgroundColor={overlayBg}
    >
      <box
        width={panelWidth}
        height={panelHeight}
        backgroundColor={t.backgroundPanel}
        paddingTop={1}
        paddingBottom={1}
        flexDirection="column"
      >
        <box flexShrink={0} flexDirection="row" justifyContent="space-between" paddingLeft={2} paddingRight={2}>
          <text fg={t.primary}>
            <b>{cloudMode ? "Connect OpenRouter" : "Add API key"}</b>
          </text>
          <text fg={t.textMuted}>{"esc"}</text>
        </box>
        <box paddingLeft={2} paddingRight={2} paddingTop={1}>
          <text fg={t.text}>
            {cloudMode
              ? "Paste your OpenRouter key. Shelra will discover the Free cloud catalog and keep local mode available with --local."
              : "Paste a compatible provider API key. You can hide this prompt with esc."}
          </text>
        </box>
        <box paddingLeft={2} paddingRight={2} paddingTop={1}>
          <box backgroundColor={t.backgroundElement} paddingLeft={1} paddingRight={1} width="100%">
            <textarea
              ref={inputRef}
              focused={true}
              placeholder={cloudMode ? "sk-or-v1-..." : "provider key..."}
              textColor={t.text}
              backgroundColor={t.backgroundElement}
              placeholderColor={t.textMuted}
              minHeight={1}
              maxHeight={3}
              wrapMode="word"
              keyBindings={TEXTAREA_KEYBINDINGS}
              onSubmit={onSubmit as unknown as () => void}
            />
          </box>
        </box>
        <box flexGrow={1} minHeight={0} />
        <box paddingLeft={2} paddingRight={2} paddingTop={2} paddingBottom={1}>
          {error ? (
            <text fg={t.diffRemovedFg}>{error}</text>
          ) : (
            <text>
              <span style={{ fg: t.primary }}>{"enter "}</span>
              <span style={{ fg: t.textMuted }}>{"save key  ·  "}</span>
              <span style={{ fg: t.primary }}>{"esc "}</span>
              <span style={{ fg: t.textMuted }}>{"hide"}</span>
            </text>
          )}
        </box>
      </box>
    </box>
  );
}

/* ── Messages ────────────────────────────────────────────────── */

const USER_MSG_COLLAPSED_LINES = 5;

function TranscriptActivityView({ t, item }: { t: Theme; item: TranscriptActivityItem }) {
  const failed = item.status === "failed";
  const tone = failed ? t.danger : item.activityKind === "agent" ? t.subagentAccent : t.text;
  const marker = failed ? "×" : "✓";
  const visibleDetails = item.details.slice(0, failed ? 6 : 4);
  const hidden = Math.max(0, item.details.length - visibleDetails.length);

  return (
    <box paddingLeft={3} marginTop={1} marginBottom={1} flexShrink={0} flexDirection="column">
      <text fg={tone}>{`${marker} ${item.title}`}</text>
      {visibleDetails.map((detail, index) => (
        <text
          key={`${item.id}:detail:${detail}`}
          fg={failed && index === visibleDetails.length - 1 ? t.danger : t.textMuted}
        >
          {`  ${truncateLine(detail, 110)}`}
        </text>
      ))}
      {hidden > 0 ? <text fg={t.textDim}>{`  +${hidden} more operation${hidden === 1 ? "" : "s"}`}</text> : null}
    </box>
  );
}

interface ActivityTreeNode {
  key: string;
  /** The branch line itself, e.g. "Explored 3 files" or "Found". */
  branch: string;
  branchTone?: string;
  /** Wrapped lines indented under the branch, e.g. the finding text under "Found". */
  continuation?: string[];
}

/** Classic braille dots spinner — the same glyph set most CLI spinners (Vercel's included) use. */
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPINNER_INTERVAL_MS = 90;

/** A single animated glyph in place of a static marker — proof of life for the current action. */
function Spinner({ color, reducedMotion }: { color: string; reducedMotion: boolean }) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (reducedMotion) return;
    const interval = setInterval(
      () => setFrame((current) => (current + 1) % SPINNER_FRAMES.length),
      SPINNER_INTERVAL_MS,
    );
    return () => clearInterval(interval);
  }, [reducedMotion]);

  return <span style={{ fg: color }}>{reducedMotion ? "●" : SPINNER_FRAMES[frame]}</span>;
}

/**
 * Live, in-progress activity as flat, indented lines — the same calm grammar
 * `TranscriptActivityView` uses for completed history, so a still-running phase reads as the
 * natural in-progress version of what it collapses into once done. No box-drawing connectors:
 * a marker (✓/●/×, spinning while active) plus indentation carries the hierarchy, not tree glyphs.
 * "Found" reuses the model's own real streamed text (never invented); "Next" reuses the
 * real next plan step (never invented) — see `nextPlanStepLabel` in observability.ts.
 */
export function RuntimeActivityTree({
  t,
  title,
  elapsedMs,
  activities,
  found,
  next,
  isProcessing,
  reducedMotion,
}: {
  t: Theme;
  title: string | null;
  elapsedMs: number | null;
  activities: UiActivityEvent[];
  found: string | null;
  next: string | null;
  isProcessing: boolean;
  reducedMotion: boolean;
}) {
  const failedEvent = [...activities].reverse().find((event) => event.status === "failed");
  const counts = groupLiveActivity(activities);
  // Each group gets a blank line before it (except the first) — sibling lines within a group
  // (the count lines) stay tight together, while "Found" and "Next" are their own groups with
  // a little more room above them.
  const groups: ActivityTreeNode[][] = [];
  if (counts.length > 0) groups.push(counts.map((line) => ({ key: line.key, branch: line.text })));
  if (found) groups.push([{ key: "found", branch: "Found", continuation: found.split("\n"), branchTone: t.text }]);
  if (!failedEvent && next) groups.push([{ key: "next", branch: "Next", continuation: [next] }]);

  if (!title && groups.length === 0) return null;
  const spinning = isProcessing && !failedEvent;
  const marker = failedEvent ? "×" : isProcessing ? null : "✓";
  const tone = failedEvent ? t.danger : isProcessing ? t.accent : t.success;
  const elapsed = isProcessing && elapsedMs !== null ? formatActivityElapsed(elapsedMs) : null;

  return (
    <box paddingLeft={3} marginTop={1} marginBottom={1} flexShrink={0} flexDirection="column">
      {title ? (
        <box flexDirection="row">
          <text fg={tone}>
            {isProcessing ? (
              <b>
                {spinning ? <Spinner color={tone} reducedMotion={reducedMotion} /> : marker}
                {` ${title}`}
              </b>
            ) : (
              `${marker} ${title}`
            )}
          </text>
          <box flexGrow={1} />
          {elapsed ? <text fg={t.textMuted}>{elapsed}</text> : null}
        </box>
      ) : null}
      {failedEvent ? (
        <text fg={t.danger}>{`  ${truncateLine(failedEvent.detail || failedEvent.label, 110)}`}</text>
      ) : null}
      {groups.map((group, groupIndex) => (
        <box key={`group:${groupIndex}`} flexDirection="column" marginTop={groupIndex > 0 ? 1 : 0}>
          {group.map((node) => (
            <box key={node.key} flexDirection="column">
              <text fg={node.branchTone ?? t.textMuted}>{`  ${truncateLine(node.branch, 110)}`}</text>
              {node.continuation?.map((line, lineIndex) => (
                <text key={`${node.key}:${lineIndex}`} fg={t.textMuted}>
                  {`  ${truncateLine(line, 108)}`}
                </text>
              ))}
            </box>
          ))}
        </box>
      ))}
    </box>
  );
}

function UserMessageContent({ content, t, expanded }: { content: string; t: Theme; expanded: boolean }) {
  const lines = content.split("\n");
  const isLong = lines.length > USER_MSG_COLLAPSED_LINES;

  if (!isLong) {
    return <text fg={t.text}>{content}</text>;
  }

  if (expanded) {
    return (
      <>
        <text fg={t.text}>{content}</text>
        <box marginTop={1}>
          <text fg={t.textDim}>
            {"ctrl+e "}
            <span style={{ fg: t.textMuted }}>{"collapse"}</span>
          </text>
        </box>
      </>
    );
  }

  const preview = lines.slice(0, USER_MSG_COLLAPSED_LINES).join("\n");
  const hiddenCount = lines.length - USER_MSG_COLLAPSED_LINES;
  return (
    <>
      <text fg={t.text}>{preview}</text>
      <box marginTop={1}>
        <text fg={t.textDim}>
          {"ctrl+e "}
          <span style={{ fg: t.textMuted }}>{`expand (${hiddenCount} more lines)`}</span>
        </text>
      </box>
    </>
  );
}

function MessageView({
  entry,
  index,
  t,
  modeColor,
  expandedMessages,
}: {
  entry: ChatEntry;
  index: number;
  t: Theme;
  modeColor: string;
  expandedMessages?: Set<number>;
}) {
  const entryColor = resolvedEntryModeColor(t, entry.modeColor, modeColor);
  switch (entry.type) {
    case "user":
      return (
        <box
          border={["left"]}
          customBorderChars={SPLIT}
          borderColor={entryColor}
          paddingLeft={2}
          marginTop={index === 0 ? 0 : 1}
          marginBottom={1}
          flexDirection="column"
        >
          {entry.sourceLabel ? <text fg={t.textDim}>{entry.sourceLabel}</text> : null}
          <UserMessageContent content={entry.content} t={t} expanded={expandedMessages?.has(index) ?? false} />
        </box>
      );

    case "assistant":
      return (
        <box paddingLeft={3} marginTop={1} flexShrink={0} flexDirection="column">
          <text fg={t.textDim}>{"Shelra"}</text>
          {entry.sourceLabel ? <text fg={t.textMuted}>{entry.sourceLabel}</text> : null}
          <box paddingTop={1} flexDirection="column">
            <Markdown content={entry.content} t={t} />
          </box>
        </box>
      );

    case "tool_call":
      return (
        <box paddingLeft={3} marginTop={1}>
          <text>
            <span style={{ fg: entryColor }}>{"▣ "}</span>
            <span style={{ fg: t.textMuted }}>{entry.content.replace("▣  ", "")}</span>
          </text>
        </box>
      );

    case "tool_result": {
      const name = entry.toolCall?.function.name || "tool";
      const args = toolArgs(entry.toolCall);
      const diff = entry.toolResult?.diff;
      const plan = entry.toolResult?.plan;

      if (name === "generate_plan" && plan) {
        return <PlanView plan={plan} t={t} />;
      }

      if (name === "task" && entry.toolResult?.task) {
        return <TaskResultView t={t} entry={entry} />;
      }

      if (name === "delegate" && entry.toolResult?.delegation) {
        return <DelegationResultView t={t} entry={entry} />;
      }

      if (name === "delegation_list") {
        return <DelegationListView t={t} content={entry.content} />;
      }

      if (name === "delegation_read") {
        return <ToolTextOutputView t={t} label={toolLabel(entry.toolCall!)} content={entry.content} />;
      }

      if (name === "lsp") {
        const lspOp = tryParseArg(entry.toolCall, "operation") || "query";
        const lspFile = tryParseArg(entry.toolCall, "filePath") || "";
        const lspLine = tryParseArg(entry.toolCall, "line");
        const lspPos = lspLine ? `:${lspLine}` : "";
        return (
          <box gap={0} marginTop={1}>
            <InlineTool t={t} pending={false}>
              {`lsp ${lspOp} ${lspFile}${lspPos}`}
            </InlineTool>
            <LspResultView t={t} operation={lspOp} filePath={lspFile} position={lspPos} content={entry.content} />
          </box>
        );
      }

      if ((entry.toolResult?.media?.length ?? 0) > 0) {
        if (name === "generate_image" || name === "generate_video") {
          return <MediaAutoOpenView t={t} label={toolLabel(entry.toolCall!)} toolResult={entry.toolResult!} />;
        }
        return <MediaToolResultView t={t} label={toolLabel(entry.toolCall!)} toolResult={entry.toolResult!} />;
      }

      if (name === "write_file" || name === "edit_file" || name === "delete_file") {
        const filePath = diff?.filePath || tryParseArg(entry.toolCall, "path") || args;
        const label =
          name === "write_file"
            ? `Write ${filePath}`
            : name === "edit_file"
              ? `Edit ${filePath}`
              : `Delete ${filePath}`;
        return (
          <box gap={0}>
            <InlineTool t={t} pending={false}>
              {label}
            </InlineTool>
            {diff && <DiffView t={t} diff={diff} />}
            {(entry.toolResult?.lspDiagnostics?.length ?? 0) > 0 && (
              <LspDiagnosticsView t={t} diagnostics={entry.toolResult?.lspDiagnostics ?? []} />
            )}
          </box>
        );
      }

      if (name === "bash" && entry.toolResult?.backgroundProcess) {
        const bp = entry.toolResult.backgroundProcess;
        return <BackgroundProcessLine t={t} id={bp.id} pid={bp.pid} command={bp.command} />;
      }

      if (name === "process_logs") {
        return <ProcessLogsView t={t} content={entry.content} />;
      }

      if (name === "process_stop" || name === "process_list") {
        return (
          <InlineTool t={t} pending={false}>
            {entry.content}
          </InlineTool>
        );
      }

      if (name === "read_file")
        return (
          <InlineTool
            t={t}
            pending={false}
          >{`Read ${trunc(tryParseArg(entry.toolCall, "path") || args, 60)}`}</InlineTool>
        );
      if (name === "search_web" || name === "search_x")
        return (
          <InlineTool t={t} pending={false}>
            {name === "search_web" ? "Web" : "X"}
            {` Search "${trunc(args, 60)}"`}
          </InlineTool>
        );

      return (
        <InlineTool t={t} pending={false}>
          {trunc(name === "bash" ? args : `${name} ${args}`, 80)}
        </InlineTool>
      );
    }

    default:
      return <text fg={t.textMuted}>{entry.content}</text>;
  }
}

/* ── Diff View ────────────────────────────────────────────────── */

type DiffRow =
  | { kind: "context"; oldNum: number; newNum: number; text: string }
  | { kind: "added"; newNum: number; text: string }
  | { kind: "removed"; oldNum: number; text: string }
  | { kind: "separator"; count: number };

const MAX_DIFF_ROWS = 20;
const LINE_NUM_WIDTH = 4;

function parsePatch(patch: string): DiffRow[] {
  const lines = patch.split("\n");
  const rows: DiffRow[] = [];
  let oldLine = 0;
  let newLine = 0;
  let prevOldEnd = 0;

  for (const line of lines) {
    const hunkMatch = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunkMatch) {
      oldLine = parseInt(hunkMatch[1], 10);
      newLine = parseInt(hunkMatch[2], 10);
      const skipped = oldLine - prevOldEnd - 1;
      if (skipped > 0) {
        rows.push({ kind: "separator", count: skipped });
      }
      continue;
    }

    if (line.startsWith("---") || line.startsWith("+++") || line.startsWith("\\")) continue;
    if (line.startsWith("Index:") || line.startsWith("====")) continue;

    if (line.startsWith("-")) {
      rows.push({ kind: "removed", oldNum: oldLine, text: line.slice(1) });
      oldLine++;
      prevOldEnd = oldLine - 1;
    } else if (line.startsWith("+")) {
      rows.push({ kind: "added", newNum: newLine, text: line.slice(1) });
      newLine++;
    } else if (line.length > 0 || (oldLine > 0 && newLine > 0)) {
      const content = line.startsWith(" ") ? line.slice(1) : line;
      rows.push({ kind: "context", oldNum: oldLine, newNum: newLine, text: content });
      oldLine++;
      newLine++;
      prevOldEnd = oldLine - 1;
    }
  }

  return rows;
}

function DiffView({ t, diff }: { t: Theme; diff: FileDiff }) {
  const rows = parsePatch(diff.patch);
  if (rows.length === 0) return null;

  const truncated = rows.length > MAX_DIFF_ROWS;
  const visible = truncated ? rows.slice(0, MAX_DIFF_ROWS) : rows;

  const pad = (n: number | undefined) =>
    n !== undefined ? String(n).padStart(LINE_NUM_WIDTH) : " ".repeat(LINE_NUM_WIDTH);

  return (
    <box paddingLeft={5} marginTop={0} flexShrink={0}>
      <box flexDirection="column">
        {/* Header */}
        <box backgroundColor={t.diffHeader} paddingLeft={1} paddingRight={1}>
          <text>
            <span style={{ fg: t.diffHeaderFg }}>{diff.filePath}</span>
            <span style={{ fg: t.textDim }}>{"  "}</span>
            <span style={{ fg: t.diffRemovedFg }}>{`-${diff.removals}`}</span>
            <span style={{ fg: t.textDim }}> </span>
            <span style={{ fg: t.diffAddedFg }}>{`+${diff.additions}`}</span>
          </text>
        </box>

        {/* Rows */}
        {visible.map((row, i) => {
          if (row.kind === "separator") {
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: separator rows lack unique identifiers
              <box key={`sep-${i}`} backgroundColor={t.diffSeparator} paddingLeft={1}>
                <text fg={t.diffSeparatorFg}>
                  {"⌃  "}
                  {row.count}
                  {" unmodified lines"}
                </text>
              </box>
            );
          }
          if (row.kind === "removed") {
            return (
              <box key={`rm-${row.oldNum}`} backgroundColor={t.diffRemoved} flexDirection="row">
                <text fg={t.diffRemovedLineNum}>{pad(row.oldNum)}</text>
                <text fg={t.diffRemovedFg}>{` ${row.text}`}</text>
              </box>
            );
          }
          if (row.kind === "added") {
            return (
              <box key={`add-${row.newNum}`} backgroundColor={t.diffAdded} flexDirection="row">
                <text fg={t.diffAddedLineNum}>{pad(row.newNum)}</text>
                <text fg={t.diffAddedFg}>{` ${row.text}`}</text>
              </box>
            );
          }
          return (
            <box key={`ctx-${row.oldNum}`} backgroundColor={t.diffContext} flexDirection="row">
              <text fg={t.diffLineNumber}>{pad(row.oldNum)}</text>
              <text fg={t.diffContextFg}>{` ${row.text}`}</text>
            </box>
          );
        })}

        {truncated && (
          <box backgroundColor={t.diffSeparator} paddingLeft={1}>
            <text fg={t.diffSeparatorFg}>
              {"⌃  "}
              {rows.length - MAX_DIFF_ROWS}
              {" more lines"}
            </text>
          </box>
        )}
      </box>
    </box>
  );
}

const MAX_LSP_RESULT_LINES = 10;

function LspResultView({
  t,
  operation,
  filePath,
  position,
  content,
}: {
  t: Theme;
  operation: string;
  filePath: string;
  position: string;
  content: string;
}) {
  const body = content.trim();
  const lines = body.split("\n");
  const truncated = lines.length > MAX_LSP_RESULT_LINES;
  const visible = truncated ? lines.slice(0, MAX_LSP_RESULT_LINES).join("\n") : body;
  const label = `${operation} ${filePath}${position}`;

  return (
    <box paddingLeft={5} marginTop={0} flexShrink={0}>
      <box flexDirection="column">
        <box backgroundColor={t.diffHeader} paddingLeft={1} paddingRight={1}>
          <text>
            <span style={{ fg: t.primary }}>{"lsp"}</span>
            <span style={{ fg: t.textDim }}>{" · "}</span>
            <span style={{ fg: t.diffHeaderFg }}>{label}</span>
          </text>
        </box>
        <box backgroundColor={t.mdCodeBlockBg} paddingLeft={1} paddingRight={1}>
          <text fg={t.mdCodeBlockFg}>{visible}</text>
        </box>
        {truncated && (
          <box backgroundColor={t.diffSeparator} paddingLeft={1}>
            <text fg={t.diffSeparatorFg}>
              {"⌃  "}
              {lines.length - MAX_LSP_RESULT_LINES}
              {" more lines"}
            </text>
          </box>
        )}
      </box>
    </box>
  );
}

function LspDiagnosticsView({ t, diagnostics }: { t: Theme; diagnostics: NonNullable<ToolResult["lspDiagnostics"]> }) {
  const files = diagnostics.slice(0, 3);
  return (
    <box paddingLeft={5} marginTop={1}>
      <box flexDirection="column">
        <box>
          <text fg={t.textMuted}>{"LSP diagnostics"}</text>
        </box>
        {files.map((entry) => (
          <box key={`${entry.serverId}:${entry.filePath}`} flexDirection="column">
            <text fg={t.textDim}>{`${entry.serverId} • ${entry.filePath}`}</text>
            {entry.diagnostics.slice(0, 5).map((diagnostic, index) => (
              <text
                // biome-ignore lint/suspicious/noArrayIndexKey: diagnostics may not include stable ids
                key={`${entry.serverId}:${entry.filePath}:${index}`}
                fg={diagnostic.severity === 1 ? t.diffRemovedFg : diagnostic.severity === 2 ? t.primary : t.textMuted}
              >
                {`${formatLspSeverity(diagnostic.severity)} ${diagnostic.range.start.line + 1}:${diagnostic.range.start.character + 1} ${diagnostic.message}`}
              </text>
            ))}
          </box>
        ))}
      </box>
    </box>
  );
}

function formatLspSeverity(severity?: number): string {
  switch (severity) {
    case 1:
      return "error";
    case 2:
      return "warning";
    case 3:
      return "info";
    case 4:
      return "hint";
    default:
      return "issue";
  }
}

function InlineTool({ t, pending: _pending, children }: { t: Theme; pending: boolean; children: React.ReactNode }) {
  return (
    <box paddingLeft={3}>
      <text fg={t.textMuted}>
        {"→ "}
        {children}
      </text>
    </box>
  );
}

function SubagentTaskLine({ t, agent, label, pending }: { t: Theme; agent: string; label: string; pending: boolean }) {
  const displayLabel = compactTaskLabel(label);
  const displayAgent = formatSubagentName(agent);

  return (
    <box paddingLeft={3}>
      <text>
        {pending ? <span style={{ fg: t.subagentAccent }}>{"◌"}</span> : null}
        {pending ? " " : ""}
        <span style={{ fg: t.subagentAccent }}>
          <b>{`${displayAgent}: ${displayLabel}`}</b>
        </span>
      </text>
    </box>
  );
}

function DelegationTaskLine({ t, label, pending, id }: { t: Theme; label: string; pending: boolean; id?: string }) {
  const displayLabel = compactTaskLabel(label);

  return (
    <box paddingLeft={3}>
      <text>
        {pending ? (
          <span style={{ fg: t.subagentAccent }}>{"◌"}</span>
        ) : (
          <span style={{ fg: t.subagentAccent }}>{"◆"}</span>
        )}{" "}
        <span style={{ fg: t.subagentAccent }}>
          <b>{"Background"}</b>
        </span>
        <span style={{ fg: t.textMuted }}>
          {" — "}
          {displayLabel}
        </span>
        {id ? <span style={{ fg: t.textDim }}>{`  (${id})`}</span> : null}
      </text>
    </box>
  );
}

function SubagentActivity({ t, status }: { t: Theme; status: SubagentStatus }) {
  return (
    <box paddingLeft={5}>
      <text fg={t.textMuted}>
        {"→ "}
        {truncateLine(status.detail, 100)}
      </text>
    </box>
  );
}

function TaskResultView({ t, entry }: { t: Theme; entry: ChatEntry }) {
  const task = entry.toolResult?.task;
  if (!task) return null;

  return (
    <box gap={0}>
      <SubagentTaskLine t={t} agent={task.agent} label={task.description} pending={false} />
      <box paddingLeft={5}>
        <text fg={t.text}>
          {formatSubagentName(task.agent)}
          {": "}
          {truncateLine(task.summary, 90)}
        </text>
      </box>
    </box>
  );
}

function DelegationResultView({ t, entry }: { t: Theme; entry: ChatEntry }) {
  const delegation = entry.toolResult?.delegation;
  if (!delegation) return null;

  return <DelegationTaskLine t={t} label={delegation.description} pending={false} id={delegation.id} />;
}

function DelegationListView({ t, content }: { t: Theme; content: string }) {
  const items = parseDelegationList(content);

  if (items.length === 0) {
    return (
      <InlineTool t={t} pending={false}>
        {"No background delegations"}
      </InlineTool>
    );
  }

  return (
    <box paddingLeft={3} gap={0}>
      {items.map((item) => {
        const statusColor =
          item.status === "complete"
            ? t.success
            : item.status === "running"
              ? t.subagentAccent
              : item.status === "error"
                ? t.danger
                : t.textMuted;

        return (
          <box key={item.id}>
            <text>
              <span style={{ fg: statusColor }}>{"◆ "}</span>
              <span style={{ fg: t.text }}>{item.id}</span>
              <span style={{ fg: statusColor }}>{` ${item.status}`}</span>
              <span style={{ fg: t.textMuted }}>
                {" — "}
                {truncateLine(item.label, 60)}
              </span>
            </text>
          </box>
        );
      })}
    </box>
  );
}

function parseDelegationList(content: string): { id: string; status: string; label: string }[] {
  const items: { id: string; status: string; label: string }[] = [];
  for (const line of content.split("\n")) {
    const match = line.match(/`([^`]+)`\s+\[(\w+)]\s+(.*)/);
    if (match) {
      items.push({ id: match[1], status: match[2], label: match[3].trim() });
    }
  }
  return items;
}

function BackgroundProcessLine({ t, id, pid, command }: { t: Theme; id: number; pid: number; command: string }) {
  return (
    <box paddingLeft={3}>
      <text>
        <span style={{ fg: t.subagentAccent }}>{"◆ "}</span>
        <span style={{ fg: t.subagentAccent }}>
          <b>{"Background process"}</b>
        </span>
        <span style={{ fg: t.textMuted }}>{` id:${id} pid:${pid}`}</span>
        <span style={{ fg: t.textDim }}>
          {" — "}
          {truncateLine(command, 60)}
        </span>
      </text>
    </box>
  );
}

function formatScheduleDetails(schedule: StoredSchedule, daemonStatus: ScheduleDaemonStatus): string {
  const daemonText = daemonStatus.running
    ? `running${daemonStatus.pid ? ` (pid ${daemonStatus.pid})` : ""}`
    : "not running";
  return [
    `Schedule: ${schedule.name}`,
    `ID: ${schedule.id}`,
    `Type: ${schedule.cron ? "recurring" : "one-time"}`,
    `Cron: ${schedule.cron ?? "runs once immediately"}`,
    `Enabled: ${schedule.enabled ? "yes" : "no"}`,
    `Model: ${schedule.model}`,
    `Directory: ${schedule.directory}`,
    `Last run: ${schedule.lastRunAt ?? "never"}`,
    `Daemon: ${daemonText}`,
    "",
    "Instruction:",
    schedule.instruction,
  ].join("\n");
}

function ProcessLogsView({ t, content }: { t: Theme; content: string }) {
  const lines = content.split("\n");
  const header = lines[0] || "";
  const body = lines.slice(1).join("\n").trim();

  return (
    <box paddingLeft={3} gap={0}>
      <text fg={t.textMuted}>
        {"→ "}
        {header}
      </text>
      {body ? (
        <box paddingLeft={2} marginTop={0}>
          <box backgroundColor={t.mdCodeBlockBg} paddingLeft={1} paddingRight={1}>
            <text fg={t.mdCodeBlockFg}>{truncateBlock(body, 15)}</text>
          </box>
        </box>
      ) : null}
    </box>
  );
}

function truncateBlock(text: string, maxLines: number): string {
  const lines = text.split("\n");
  if (lines.length <= maxLines) return text;
  return [...lines.slice(0, maxLines), `… ${lines.length - maxLines} more lines`].join("\n");
}

function ToolTextOutputView({ t, label, content }: { t: Theme; label: string; content: string }) {
  return (
    <box gap={0}>
      <InlineTool t={t} pending={false}>
        {label}
      </InlineTool>
      <box paddingLeft={5} marginTop={1} flexShrink={0}>
        <Markdown content={content} t={t} />
      </box>
    </box>
  );
}

function openMediaFile(filePath: string): void {
  try {
    const cmd = process.platform === "darwin" ? "open" : "xdg-open";
    require("child_process").execFile(cmd, [filePath]);
  } catch {}
}

function MediaAutoOpenView({ t, label, toolResult }: { t: Theme; label: string; toolResult: ToolResult }) {
  const media = toolResult.media ?? [];
  const openedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    for (const asset of media) {
      if (!openedRef.current.has(asset.path)) {
        openedRef.current.add(asset.path);
        openMediaFile(asset.path);
      }
    }
  }, [media]);

  return (
    <box gap={0}>
      <InlineTool t={t} pending={false}>
        {label}
      </InlineTool>
    </box>
  );
}

function MediaToolResultView({ t, label, toolResult }: { t: Theme; label: string; toolResult: ToolResult }) {
  const media = toolResult.media ?? [];

  return (
    <box gap={0}>
      <InlineTool t={t} pending={false}>
        {label}
      </InlineTool>
      {toolResult.output ? (
        <box paddingLeft={5} marginTop={1} flexShrink={0}>
          <Markdown content={toolResult.output} t={t} />
        </box>
      ) : null}
      {media.length > 0 ? (
        <box paddingLeft={5} marginTop={toolResult.output ? 1 : 0} flexDirection="column">
          {media.map((asset) => (
            <box
              key={`${asset.path}-${asset.url ?? ""}-${asset.sourcePath ?? ""}-${asset.sourceUrl ?? ""}`}
              flexDirection="column"
            >
              <text fg={t.text}>{asset.path}</text>
              {asset.url ? <text fg={t.textMuted}>{`url: ${asset.url}`}</text> : null}
              {asset.sourcePath ? <text fg={t.textMuted}>{`source: ${asset.sourcePath}`}</text> : null}
              {asset.sourceUrl ? <text fg={t.textMuted}>{`source_url: ${asset.sourceUrl}`}</text> : null}
            </box>
          ))}
        </box>
      ) : null}
    </box>
  );
}

/* ── Slash Menu ──────────────────────────────────────────────── */

function bottomAlignedModalTop(height: number, panelHeight: number): number {
  return Math.max(2, Math.floor((height - panelHeight) / 2));
}

/* ── Update Modal ────────────────────────────────────────────── */

function UpdateModal({
  t,
  width,
  height,
  currentVersion,
  latestVersion,
}: {
  t: Theme;
  width: number;
  height: number;
  currentVersion: string;
  latestVersion: string;
}) {
  const overlayBg = t.overlay;
  const panelWidth = Math.min(60, width - 6);
  const panelHeight = 9;
  const top = bottomAlignedModalTop(height, panelHeight);

  return (
    <box
      position="absolute"
      left={0}
      top={0}
      width={width}
      height={height}
      alignItems="center"
      paddingTop={top}
      backgroundColor={overlayBg}
    >
      <box
        width={panelWidth}
        height={panelHeight}
        backgroundColor={t.backgroundPanel}
        paddingTop={1}
        paddingBottom={1}
        flexDirection="column"
      >
        <box flexShrink={0} flexDirection="row" justifyContent="space-between" paddingLeft={2} paddingRight={2}>
          <text fg={t.warning}>
            <b>{"Update Available"}</b>
          </text>
          <text fg={t.textMuted}>{"esc to dismiss"}</text>
        </box>
        <box flexShrink={0} paddingLeft={2} paddingRight={2} paddingTop={1}>
          <text fg={t.text}>
            {"A new version of ShelraCode is available: "}
            <span style={{ fg: t.textMuted }}>
              {"v"}
              {currentVersion}
            </span>
            {" → "}
            <span style={{ fg: t.success }}>
              {"v"}
              {latestVersion}
            </span>
          </text>
        </box>
        <box flexShrink={0} paddingLeft={2} paddingRight={2} paddingTop={1}>
          <text fg={t.textMuted}>{"Press enter to update now, or esc to dismiss"}</text>
        </box>
      </box>
    </box>
  );
}

function SlashMenuModal({
  t,
  selectedIndex,
  width,
  height,
  searchQuery,
  filteredItems,
}: {
  t: Theme;
  selectedIndex: number;
  width: number;
  height: number;
  searchQuery: string;
  filteredItems: SlashMenuItem[];
}) {
  const listRef = useRef<ScrollBoxRenderable>(null);
  useEffect(() => {
    const item = filteredItems[selectedIndex];
    if (item) listRef.current?.scrollChildIntoView(`slash-${item.id}`);
  }, [selectedIndex, filteredItems]);

  const itemCount = Math.max(filteredItems.length, 1);
  const contentHeight = itemCount + 5;
  const maxH = Math.floor(height * 0.6);
  const panelHeight = Math.min(contentHeight, maxH);
  const top = bottomAlignedModalTop(height, panelHeight);
  const overlayBg = t.overlay;
  return (
    <box
      position="absolute"
      left={0}
      top={0}
      width={width}
      height={height}
      alignItems="center"
      paddingTop={top}
      backgroundColor={overlayBg}
    >
      <box
        width={Math.min(50, width - 6)}
        height={panelHeight}
        backgroundColor={t.backgroundPanel}
        paddingTop={1}
        paddingBottom={1}
        flexDirection="column"
      >
        <box flexShrink={0} flexDirection="row" justifyContent="space-between" paddingLeft={2} paddingRight={2}>
          <text fg={t.primary}>
            <b>{"Commands"}</b>
          </text>
          <text fg={t.textMuted}>{"esc"}</text>
        </box>
        <box flexShrink={0} paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1}>
          <text fg={t.text}>{searchQuery || <span style={{ fg: t.textMuted }}>{"Search..."}</span>}</text>
        </box>
        <scrollbox ref={listRef} flexGrow={1} minHeight={0}>
          {filteredItems.map((item, idx) => (
            <box
              key={item.id}
              id={`slash-${item.id}`}
              backgroundColor={idx === selectedIndex ? t.selectedBg : undefined}
              paddingLeft={2}
              paddingRight={2}
            >
              <box flexDirection="row" justifyContent="space-between">
                <text fg={idx === selectedIndex ? t.selected : t.text}>
                  {"/"}
                  {item.label}
                </text>
                <text fg={t.textMuted}>{item.description}</text>
              </box>
            </box>
          ))}
          {filteredItems.length === 0 && (
            <box paddingLeft={2}>
              <text fg={t.textMuted}>{"No commands match your search"}</text>
            </box>
          )}
        </scrollbox>
      </box>
    </box>
  );
}

function ConnectModal({
  t,
  width,
  height,
  selectedIndex,
  channels,
}: {
  t: Theme;
  width: number;
  height: number;
  selectedIndex: number;
  channels: { id: string; label: string; description: string }[];
}) {
  const listRef = useRef<ScrollBoxRenderable>(null);
  useEffect(() => {
    const ch = channels[selectedIndex];
    if (ch) listRef.current?.scrollChildIntoView(`connect-${ch.id}`);
  }, [selectedIndex, channels]);

  const panelHeight = Math.min(channels.length + 9, Math.floor(height * 0.5));
  const top = bottomAlignedModalTop(height, panelHeight);
  const overlayBg = t.overlay;
  return (
    <box
      position="absolute"
      left={0}
      top={0}
      width={width}
      height={height}
      alignItems="center"
      paddingTop={top}
      backgroundColor={overlayBg}
    >
      <box
        width={Math.min(56, width - 6)}
        height={panelHeight}
        backgroundColor={t.backgroundPanel}
        paddingTop={1}
        paddingBottom={1}
        flexDirection="column"
      >
        <box flexShrink={0} flexDirection="row" justifyContent="space-between" paddingLeft={2} paddingRight={2}>
          <text fg={t.primary}>
            <b>{"Connect"}</b>
          </text>
          <text fg={t.textMuted}>{"esc"}</text>
        </box>
        <box flexShrink={0} paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1}>
          <text fg={t.textMuted}>{"Choose a channel"}</text>
        </box>
        <scrollbox ref={listRef} flexGrow={1} minHeight={0}>
          {channels.map((ch, idx) => (
            <box
              key={ch.id}
              id={`connect-${ch.id}`}
              backgroundColor={idx === selectedIndex ? t.selectedBg : undefined}
              paddingLeft={2}
              paddingRight={2}
            >
              <box flexDirection="row" justifyContent="space-between">
                <text fg={idx === selectedIndex ? t.selected : t.text}>{ch.label}</text>
                <text fg={t.textMuted}>{ch.description}</text>
              </box>
            </box>
          ))}
        </scrollbox>
        <box flexShrink={0} paddingLeft={2} paddingRight={2} paddingTop={2} paddingBottom={1}>
          <text>
            <span style={{ fg: t.primary }}>{"enter "}</span>
            <span style={{ fg: t.textMuted }}>{"select  ·  "}</span>
            <span style={{ fg: t.primary }}>{"↑↓ "}</span>
            <span style={{ fg: t.textMuted }}>{"navigate  ·  "}</span>
            <span style={{ fg: t.primary }}>{"esc "}</span>
            <span style={{ fg: t.textMuted }}>{"close"}</span>
          </text>
        </box>
      </box>
    </box>
  );
}

function TelegramTokenModal({
  t,
  width,
  height,
  inputRef,
  error,
  onSubmit,
}: {
  t: Theme;
  width: number;
  height: number;
  inputRef: React.RefObject<TextareaRenderable | null>;
  error: string | null;
  onSubmit: () => void;
}) {
  const overlayBg = t.overlay;
  const panelWidth = Math.min(68, width - 6);
  const panelHeight = 14;
  const top = bottomAlignedModalTop(height, panelHeight);

  return (
    <box
      position="absolute"
      left={0}
      top={0}
      width={width}
      height={height}
      alignItems="center"
      paddingTop={top}
      backgroundColor={overlayBg}
    >
      <box
        width={panelWidth}
        height={panelHeight}
        backgroundColor={t.backgroundPanel}
        paddingTop={1}
        paddingBottom={1}
        flexDirection="column"
      >
        <box flexShrink={0} flexDirection="row" justifyContent="space-between" paddingLeft={2} paddingRight={2}>
          <text fg={t.primary}>
            <b>{"Telegram bot token"}</b>
          </text>
          <text fg={t.textMuted}>{"esc"}</text>
        </box>
        <box paddingLeft={2} paddingRight={2} paddingTop={1}>
          <text fg={t.text}>
            {"From @BotFather: /newbot, then paste the token here. Stored in ~/.shelra/user-settings.json."}
          </text>
        </box>
        <box paddingLeft={2} paddingRight={2} paddingTop={1}>
          <box backgroundColor={t.backgroundElement} paddingLeft={1} paddingRight={1} width="100%">
            <textarea
              ref={inputRef}
              focused={true}
              placeholder="123456:ABC..."
              textColor={t.text}
              backgroundColor={t.backgroundElement}
              placeholderColor={t.textMuted}
              minHeight={1}
              maxHeight={3}
              wrapMode="word"
              keyBindings={TEXTAREA_KEYBINDINGS}
              onSubmit={onSubmit as unknown as () => void}
            />
          </box>
        </box>
        <box flexGrow={1} minHeight={0} />
        <box paddingLeft={2} paddingRight={2} paddingTop={2} paddingBottom={1}>
          {error ? (
            <text fg={t.diffRemovedFg}>{error}</text>
          ) : (
            <text>
              <span style={{ fg: t.primary }}>{"enter "}</span>
              <span style={{ fg: t.textMuted }}>{"save token  ·  "}</span>
              <span style={{ fg: t.primary }}>{"esc "}</span>
              <span style={{ fg: t.textMuted }}>{"close"}</span>
            </text>
          )}
        </box>
      </box>
    </box>
  );
}

function TelegramPairModal({
  t,
  width,
  height,
  inputRef,
  error,
  onSubmit,
}: {
  t: Theme;
  width: number;
  height: number;
  inputRef: React.RefObject<TextareaRenderable | null>;
  error: string | null;
  onSubmit: () => void;
}) {
  const overlayBg = t.overlay;
  const panelWidth = Math.min(68, width - 6);
  const panelHeight = 13;
  const top = bottomAlignedModalTop(height, panelHeight);

  return (
    <box
      position="absolute"
      left={0}
      top={0}
      width={width}
      height={height}
      alignItems="center"
      paddingTop={top}
      backgroundColor={overlayBg}
    >
      <box
        width={panelWidth}
        height={panelHeight}
        backgroundColor={t.backgroundPanel}
        paddingTop={1}
        paddingBottom={1}
        flexDirection="column"
      >
        <box flexShrink={0} flexDirection="row" justifyContent="space-between" paddingLeft={2} paddingRight={2}>
          <text fg={t.primary}>
            <b>{"Pairing code"}</b>
          </text>
          <text fg={t.textMuted}>{"esc"}</text>
        </box>
        <box paddingLeft={2} paddingRight={2} paddingTop={1}>
          <text fg={t.text}>{"DM your bot with /pair, then paste the 6-character code."}</text>
        </box>
        <box paddingLeft={2} paddingRight={2} paddingTop={1}>
          <box backgroundColor={t.backgroundElement} paddingLeft={1} paddingRight={1} width="100%">
            <textarea
              ref={inputRef}
              focused={true}
              placeholder="ABC123"
              textColor={t.text}
              backgroundColor={t.backgroundElement}
              placeholderColor={t.textMuted}
              minHeight={1}
              maxHeight={2}
              wrapMode="word"
              keyBindings={TEXTAREA_KEYBINDINGS}
              onSubmit={onSubmit as unknown as () => void}
            />
          </box>
        </box>
        <box flexGrow={1} minHeight={0} />
        <box paddingLeft={2} paddingRight={2} paddingTop={2} paddingBottom={1}>
          {error ? (
            <text fg={t.diffRemovedFg}>{error}</text>
          ) : (
            <text>
              <span style={{ fg: t.primary }}>{"enter "}</span>
              <span style={{ fg: t.textMuted }}>{"approve pairing  ·  "}</span>
              <span style={{ fg: t.primary }}>{"esc "}</span>
              <span style={{ fg: t.textMuted }}>{"close"}</span>
            </text>
          )}
        </box>
      </box>
    </box>
  );
}

/* ── Model Picker ────────────────────────────────────────────── */

function ModelPickerModal({
  t,
  currentModel,
  selectedIndex,
  width,
  height,
  searchQuery,
  filteredModels,
  reasoningEffortByModel,
  switching,
  error,
}: {
  t: Theme;
  currentModel: string;
  selectedIndex: number;
  width: number;
  height: number;
  searchQuery: string;
  filteredModels: ModelInfo[];
  reasoningEffortByModel: Record<string, ReasoningEffort>;
  switching: boolean;
  error: string | null;
}) {
  const listRef = useRef<ScrollBoxRenderable>(null);
  useEffect(() => {
    const m = filteredModels[selectedIndex];
    if (m) listRef.current?.scrollChildIntoView(`model-${m.id}`);
  }, [selectedIndex, filteredModels]);

  const itemCount = Math.max(filteredModels.length, 1);
  const selectedModel = filteredModels[selectedIndex];
  const selectedSupportsReasoning = !!selectedModel && getSupportedReasoningEfforts(selectedModel.id).length > 0;
  const contentHeight = itemCount * 2 + 6;
  const maxH = Math.floor(height * 0.6);
  const panelHeight = Math.min(contentHeight, maxH);
  const top = bottomAlignedModalTop(height, panelHeight);
  const overlayBg = t.overlay;
  return (
    <box
      position="absolute"
      left={0}
      top={0}
      width={width}
      height={height}
      alignItems="center"
      paddingTop={top}
      backgroundColor={overlayBg}
    >
      <box
        width={Math.min(60, width - 6)}
        height={panelHeight}
        backgroundColor={t.backgroundPanel}
        paddingTop={1}
        paddingBottom={1}
        flexDirection="column"
      >
        <box flexShrink={0} flexDirection="row" justifyContent="space-between" paddingLeft={2} paddingRight={2}>
          <text fg={t.primary}>
            <b>{"Select model"}</b>
          </text>
          <text fg={t.textMuted}>{"esc"}</text>
        </box>
        <box flexShrink={0} paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1}>
          <text fg={t.text}>{searchQuery || <span style={{ fg: t.textMuted }}>{"Search..."}</span>}</text>
        </box>
        <scrollbox ref={listRef} flexGrow={1} minHeight={0}>
          {filteredModels.map((m, idx) => {
            const selected = idx === selectedIndex;
            const current = m.id === currentModel;
            const supportedReasoningEfforts = getSupportedReasoningEfforts(m.id);
            const reasoningEffort =
              getEffectiveReasoningEffort(m.id, reasoningEffortByModel[normalizeModelId(m.id)]) ?? "auto";
            return (
              <box
                key={m.id}
                id={`model-${m.id}`}
                backgroundColor={selected ? t.selectedBg : undefined}
                paddingLeft={2}
                paddingRight={2}
                width="100%"
              >
                <box width="100%" flexDirection="column">
                  <box width="100%" flexDirection="row" justifyContent="space-between">
                    <text fg={current ? t.accent : selected ? t.selected : t.text}>{m.name}</text>
                    {supportedReasoningEfforts.length > 0 ? (
                      <text fg={selected ? t.primary : t.textMuted}>{`[${reasoningEffort}]`}</text>
                    ) : null}
                  </box>
                  <text fg={selected ? t.textMuted : t.textDim}>{modelMetadataLabel(m)}</text>
                </box>
              </box>
            );
          })}
          {filteredModels.length === 0 && (
            <box paddingLeft={2}>
              <text fg={t.textMuted}>{"No models match your search"}</text>
            </box>
          )}
        </scrollbox>
        <box flexShrink={0} paddingLeft={2} paddingRight={2} paddingTop={1}>
          {error ? <text fg={t.diffRemovedFg}>{error}</text> : null}
          <text fg={switching ? t.accent : t.textMuted}>
            {switching
              ? "Preparing model..."
              : selectedSupportsReasoning
                ? "left/right reasoning  enter select  esc close"
                : "enter select  esc close"}
          </text>
        </box>
      </box>
    </box>
  );
}

function modelMetadataLabel(model: ModelInfo): string {
  const price =
    model.pricingKnown === false
      ? "price unavailable"
      : model.inputPrice === 0 && model.outputPrice === 0
        ? "free"
        : `$${(model.inputPrice * 1_000_000).toFixed(2)}/M in · $${(model.outputPrice * 1_000_000).toFixed(2)}/M out`;
  const capabilities = [
    model.supportsClientTools ? "tools" : undefined,
    model.reasoning ? "reasoning" : undefined,
    model.supportsVision ? "vision" : undefined,
  ]
    .filter(Boolean)
    .join(", ");
  return `${model.category === "cloud" ? price : "local"} · ${formatTokenCount(model.contextWindow)} ctx${capabilities ? ` · ${capabilities}` : ""}`;
}

function SandboxPickerModal({
  t,
  currentMode,
  settings,
  focusIndex,
  editing,
  editBuffer,
  width,
  height,
}: {
  t: Theme;
  currentMode: SandboxMode;
  settings: SandboxSettings;
  focusIndex: number;
  editing: string | null;
  editBuffer: string;
  width: number;
  height: number;
}) {
  const visibleRows = getSandboxVisibleRows(currentMode);
  const panelHeight = Math.min(visibleRows.length + 6, Math.floor(height * 0.6));
  const top = bottomAlignedModalTop(height, panelHeight);
  const overlayBg = t.overlay;

  return (
    <box
      position="absolute"
      left={0}
      top={0}
      width={width}
      height={height}
      alignItems="center"
      paddingTop={top}
      backgroundColor={overlayBg}
    >
      <box
        width={Math.min(64, width - 6)}
        height={panelHeight}
        backgroundColor={t.backgroundPanel}
        paddingTop={1}
        paddingBottom={1}
        flexDirection="column"
      >
        <box flexShrink={0} flexDirection="row" justifyContent="space-between" paddingLeft={2} paddingRight={2}>
          <text fg={t.primary}>
            <b>{"Sandbox settings"}</b>
          </text>
          <text fg={t.textMuted}>{"esc"}</text>
        </box>
        <scrollbox flexGrow={1} minHeight={0}>
          {visibleRows.map((row, idx) => {
            const focused = idx === focusIndex;
            const isEditing = editing === row.key;
            const display = row.getDisplay(currentMode, settings);
            return (
              <box
                key={row.key}
                backgroundColor={focused ? t.selectedBg : undefined}
                paddingLeft={2}
                paddingRight={2}
                width="100%"
              >
                <box width="100%" flexDirection="row" justifyContent="space-between">
                  <text fg={focused ? t.selected : t.text}>{row.label}</text>
                  {isEditing ? (
                    <text fg={t.accent}>
                      {editBuffer || row.placeholder || ""}
                      {"_"}
                    </text>
                  ) : row.type === "toggle" ? (
                    <text fg={focused ? t.primary : t.textMuted}>
                      {"< "}
                      {display}
                      {" >"}
                    </text>
                  ) : (
                    <text fg={focused ? t.primary : t.textMuted}>{display}</text>
                  )}
                </box>
              </box>
            );
          })}
        </scrollbox>
        <box flexShrink={0} paddingLeft={2} paddingRight={2} paddingTop={1}>
          <text fg={t.textMuted}>
            {editing
              ? "type value  enter confirm  esc cancel"
              : "arrows navigate  left/right toggle  enter edit  esc close"}
          </text>
        </box>
      </box>
    </box>
  );
}

function RecapPickerModal({
  t,
  enabled,
  width,
  height,
}: {
  t: Theme;
  enabled: boolean;
  width: number;
  height: number;
}) {
  const panelHeight = Math.min(7, Math.floor(height * 0.6));
  const top = bottomAlignedModalTop(height, panelHeight);
  const overlayBg = t.overlay;
  const display = formatRecapsEnabled(enabled);

  return (
    <box
      position="absolute"
      left={0}
      top={0}
      width={width}
      height={height}
      alignItems="center"
      paddingTop={top}
      backgroundColor={overlayBg}
    >
      <box
        width={Math.min(64, width - 6)}
        height={panelHeight}
        backgroundColor={t.backgroundPanel}
        paddingTop={1}
        paddingBottom={1}
        flexDirection="column"
      >
        <box flexShrink={0} flexDirection="row" justifyContent="space-between" paddingLeft={2} paddingRight={2}>
          <text fg={t.primary}>
            <b>{"Recap settings"}</b>
          </text>
          <text fg={t.textMuted}>{"esc"}</text>
        </box>
        <box flexGrow={1} minHeight={0}>
          <box backgroundColor={t.selectedBg} paddingLeft={2} paddingRight={2} width="100%">
            <box width="100%" flexDirection="row" justifyContent="space-between">
              <text fg={t.selected}>{"Recaps"}</text>
              <text fg={t.primary}>
                {"< "}
                {display}
                {" >"}
              </text>
            </box>
          </box>
        </box>
        <box flexShrink={0} paddingLeft={2} paddingRight={2} paddingTop={1}>
          <text fg={t.textMuted}>{"left/right toggle  enter cycle  esc close"}</text>
        </box>
      </box>
    </box>
  );
}

function ThemePickerModal({
  t,
  appearance,
  motion,
  focusIndex,
  width,
  height,
}: {
  t: Theme;
  width: number;
  appearance: ThemePreference;
  motion: MotionPreference;
  focusIndex: number;
  height: number;
}) {
  const panelHeight = Math.min(10, Math.floor(height * 0.6));
  const top = bottomAlignedModalTop(height, panelHeight);
  const rows = [
    { label: "Appearance", value: formatThemePreference(appearance) },
    { label: "Motion", value: motion === "reduced" ? "Reduced" : "Full" },
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
        width={Math.min(64, width - 6)}
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
            <b>{"Appearance"}</b>
          </text>
          <text fg={t.textMuted}>{"esc"}</text>
        </box>
        <box flexGrow={1} minHeight={0} flexDirection="column">
          {rows.map((row, index) => {
            const focused = focusIndex === index;
            return (
              <box key={row.label} backgroundColor={focused ? t.brandSoft : undefined} paddingLeft={2} paddingRight={2}>
                <box width="100%" flexDirection="row" justifyContent="space-between">
                  <text fg={focused ? t.brand : t.text}>{row.label}</text>
                  <text fg={focused ? t.brand : t.textSecondary}>{`< ${row.value} >`}</text>
                </box>
              </box>
            );
          })}
          <box paddingLeft={2} paddingRight={2} paddingTop={1}>
            <text fg={t.textMuted}>
              {"System follows the terminal when it reports a scheme; otherwise Shelra uses dark."}
            </text>
          </box>
        </box>
        <box flexShrink={0} paddingLeft={2} paddingRight={2} paddingTop={1}>
          <text fg={t.textMuted}>{"up/down select  left/right change  enter cycle  esc close"}</text>
        </box>
      </box>
    </box>
  );
}

function formatThemePreference(preference: ThemePreference): string {
  return preference[0].toUpperCase() + preference.slice(1);
}

function EffortPickerModal({
  t,
  modelId,
  effort,
  width,
  height,
}: {
  t: Theme;
  modelId: string;
  effort: ReasoningEffort | null;
  width: number;
  height: number;
}) {
  const panelHeight = Math.min(9, Math.floor(height * 0.6));
  const top = bottomAlignedModalTop(height, panelHeight);
  const overlayBg = t.overlay;
  const supported = getSupportedReasoningEfforts(modelId);
  const display = effort ?? "auto";

  return (
    <box
      position="absolute"
      left={0}
      top={0}
      width={width}
      height={height}
      alignItems="center"
      paddingTop={top}
      backgroundColor={overlayBg}
    >
      <box
        width={Math.min(64, width - 6)}
        height={panelHeight}
        backgroundColor={t.backgroundPanel}
        paddingTop={1}
        paddingBottom={1}
        flexDirection="column"
      >
        <box flexShrink={0} flexDirection="row" justifyContent="space-between" paddingLeft={2} paddingRight={2}>
          <text fg={t.primary}>
            <b>{"Reasoning effort"}</b>
          </text>
          <text fg={t.textMuted}>{"esc"}</text>
        </box>
        <box flexGrow={1} minHeight={0} flexDirection="column">
          {supported.length === 0 ? (
            <box paddingLeft={2} paddingRight={2}>
              <text fg={t.textMuted}>{`${modelId} does not support reasoning effort control.`}</text>
            </box>
          ) : (
            <box backgroundColor={t.selectedBg} paddingLeft={2} paddingRight={2} width="100%">
              <box width="100%" flexDirection="row" justifyContent="space-between">
                <text fg={t.selected}>{modelId}</text>
                <text fg={t.primary}>
                  {"< "}
                  {display}
                  {" >"}
                </text>
              </box>
            </box>
          )}
          <box paddingLeft={2} paddingRight={2} paddingTop={1}>
            <text fg={t.textMuted}>
              {"auto = "}
              {"high in agent mode when the model supports it, otherwise the provider's default."}
            </text>
          </box>
        </box>
        <box flexShrink={0} paddingLeft={2} paddingRight={2} paddingTop={1}>
          <text fg={t.textMuted}>{"left/right toggle  enter cycle  esc close"}</text>
        </box>
      </box>
    </box>
  );
}

function PaymentApprovalPanel({
  t,
  payment,
}: {
  t: Theme;
  payment: {
    url: string;
    description: string;
    security: string;
    securityLabel: string;
    securityUrl: string;
    amount: string;
    network: string;
    asset: string;
    approvalId?: string;
    selected: number;
  };
}) {
  const options = ["Approve payment", "Reject"];
  return (
    <box
      flexDirection="column"
      border={["left"]}
      customBorderChars={{
        topLeft: "",
        bottomLeft: "",
        vertical: "┃",
        topRight: "",
        bottomRight: "",
        horizontal: " ",
        bottomT: "",
        topT: "",
        cross: "",
        leftT: "",
        rightT: "",
      }}
      borderColor={t.warning}
      marginTop={1}
      paddingLeft={2}
      paddingRight={2}
      paddingTop={1}
      paddingBottom={1}
      backgroundColor={t.backgroundPanel}
    >
      <text>
        <span style={{ fg: t.planTitle ?? t.primary }}>
          <b>{"Payment required"}</b>
        </span>
      </text>
      <box marginTop={1} flexDirection="column">
        <text>
          <span style={{ fg: t.text }}>{payment.url}</span>
        </text>
        {payment.description ? (
          <text>
            <span style={{ fg: t.textMuted }}>{payment.description}</span>
          </text>
        ) : null}
        {payment.security ? (
          <text>
            <span style={{ fg: t.textMuted }}>{"Security: "}</span>
            <span style={{ fg: t.info }}>{payment.securityLabel}</span>
          </text>
        ) : null}
        <text>
          <span style={{ fg: t.textMuted }}>{"Price: "}</span>
          <span style={{ fg: t.success }}>
            <b>{`${payment.amount} USDC`}</b>
          </span>
          <span style={{ fg: t.textMuted }}>{` on ${payment.network}`}</span>
        </text>
      </box>
      <box marginTop={1} flexDirection="column">
        {options.map((label, i) => {
          const isSel = i === payment.selected;
          return (
            <text key={label}>
              <span style={{ fg: isSel ? t.success : t.textMuted }}>{isSel ? "> " : "  "}</span>
              <span style={{ fg: isSel ? t.text : t.textMuted }}>{isSel ? <b>{label}</b> : label}</span>
            </text>
          );
        })}
      </box>
      <box flexDirection="row" gap={3} marginTop={1} flexShrink={0}>
        <text>
          <span style={{ fg: t.text }}>{"↑↓"}</span>
          <span style={{ fg: t.textMuted }}>{" select"}</span>
        </text>
        <text>
          <span style={{ fg: t.text }}>{"enter"}</span>
          <span style={{ fg: t.textMuted }}>{" confirm"}</span>
        </text>
        <text>
          <span style={{ fg: t.text }}>{"esc"}</span>
          <span style={{ fg: t.textMuted }}>{" reject"}</span>
        </text>
      </box>
    </box>
  );
}

function WalletPickerModal({
  t,
  settings,
  walletInfo,
  focusIndex,
  width,
  height,
}: {
  t: Theme;
  settings: Required<PaymentSettings>;
  walletInfo: WalletDisplayInfo;
  focusIndex: number;
  width: number;
  height: number;
}) {
  const panelHeight = Math.min(WALLET_ROWS.length + 6, Math.floor(height * 0.6));
  const top = bottomAlignedModalTop(height, panelHeight);
  const overlayBg = t.overlay;

  return (
    <box
      position="absolute"
      left={0}
      top={0}
      width={width}
      height={height}
      alignItems="center"
      paddingTop={top}
      backgroundColor={overlayBg}
    >
      <box
        width={Math.min(64, width - 6)}
        height={panelHeight}
        backgroundColor={t.backgroundPanel}
        paddingTop={1}
        paddingBottom={1}
        flexDirection="column"
      >
        <box flexShrink={0} flexDirection="row" justifyContent="space-between" paddingLeft={2} paddingRight={2}>
          <text fg={t.primary}>
            <b>{"Wallet & Payments"}</b>
          </text>
          <text fg={t.textMuted}>{"esc"}</text>
        </box>
        <scrollbox flexGrow={1} minHeight={0}>
          {WALLET_ROWS.map((row, idx) => {
            const focused = idx === focusIndex;
            const display = row.getDisplay(settings, walletInfo);
            return (
              <box
                key={row.key}
                backgroundColor={focused ? t.selectedBg : undefined}
                paddingLeft={2}
                paddingRight={2}
                width="100%"
              >
                <box width="100%" flexDirection="row" justifyContent="space-between">
                  <text fg={focused ? t.selected : t.text}>{row.label}</text>
                  {row.type === "toggle" ? (
                    <text fg={focused ? t.primary : t.textMuted}>
                      {"< "}
                      {display}
                      {" >"}
                    </text>
                  ) : (
                    <text fg={focused ? t.primary : t.textMuted}>{display}</text>
                  )}
                </box>
              </box>
            );
          })}
        </scrollbox>
        <box flexShrink={0} paddingLeft={2} paddingRight={2} paddingTop={1}>
          <text fg={t.textMuted}>{"arrows navigate  left/right toggle  esc close"}</text>
        </box>
      </box>
    </box>
  );
}

/* ── Helpers ──────────────────────────────────────────────────── */

function isEscapeKey(key: KeyEvent): boolean {
  return (
    key.name === "escape" ||
    key.code === "Escape" ||
    key.baseCode === 27 ||
    key.sequence === "\u001b" ||
    key.raw === "\u001b"
  );
}

/**
 * Best-effort read of one string field out of a tool call's arguments while they may still be
 * mid-stream (the model emits `function.arguments` token by token, so it's often incomplete,
 * unterminated JSON for a beat). Regex-extracts the field's value directly so an in-progress
 * label like "Writing" can go dynamic — "Writing index.html" — the moment the real target has
 * streamed in, rather than staying a blank placeholder until the whole call finishes.
 */
function extractStreamingArg(rawArguments: string, key: string): string {
  const match = rawArguments.match(new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)`));
  if (!match) return "";
  try {
    return JSON.parse(`"${match[1]}"`);
  } catch {
    return match[1];
  }
}

function streamingArgKey(name: string): string {
  if (name === "bash") return "command";
  if (name === "read_file" || name === "write_file" || name === "edit_file" || name === "delete_file") return "path";
  if (name === "generate_image" || name === "generate_video") return "prompt";
  if (name === "task" || name === "delegate") return "description";
  if (name === "delegation_read" || name === "process_logs" || name === "process_stop") return "id";
  if (name === "lsp") return "filePath";
  return "query";
}

function toolArgs(tc?: ToolCall): string {
  if (!tc) return "";
  try {
    const a = JSON.parse(tc.function.arguments);
    if (tc.function.name === "bash") return a.command || "";
    if (
      tc.function.name === "read_file" ||
      tc.function.name === "write_file" ||
      tc.function.name === "edit_file" ||
      tc.function.name === "delete_file"
    )
      return a.path || "";
    if (tc.function.name === "generate_image" || tc.function.name === "generate_video") return a.prompt || "";
    if (tc.function.name === "task") return a.description || "";
    if (tc.function.name === "lsp") return `${a.operation || "query"} ${a.filePath || ""}`.trim();
    if (tc.function.name === "delegate") return a.description || "";
    if (tc.function.name === "delegation_read") return a.id || "";
    if (tc.function.name === "process_logs" || tc.function.name === "process_stop")
      return a.id != null ? String(a.id) : "";
    return a.query || "";
  } catch {
    return extractStreamingArg(tc.function.arguments, streamingArgKey(tc.function.name));
  }
}
function tryParseArg(tc: ToolCall | undefined, key: string): string {
  if (!tc) return "";
  try {
    return JSON.parse(tc.function.arguments)[key] || "";
  } catch {
    return "";
  }
}
function toolLabel(tc: ToolCall): string {
  const args = toolArgs(tc);
  if (tc.function.name === "bash") {
    try {
      const parsed = JSON.parse(tc.function.arguments);
      if (parsed.background) return `Background: ${trunc(args || "Starting process...", 70)}`;
    } catch {
      /* */
    }
    return commandActivityLabel(args);
  }
  if (tc.function.name === "read_file") return `Reading ${trunc(args, 60)}`;
  if (tc.function.name === "grep") return `Searching repository${args ? `: ${trunc(args, 54)}` : ""}`;
  if (tc.function.name === "write_file") return `Writing ${trunc(args, 60)}`;
  if (tc.function.name === "edit_file") return `Editing ${trunc(args, 60)}`;
  if (tc.function.name === "delete_file") return `Deleting ${trunc(args, 60)}`;
  if (tc.function.name === "search_web") return `Researching ${trunc(args, 60)}`;
  if (tc.function.name === "open_web") return `Inspecting source ${trunc(args, 56)}`;
  if (tc.function.name === "search_x") return `Researching X ${trunc(args, 60)}`;
  if (tc.function.name === "generate_image") return `Generate image "${trunc(args, 60)}"`;
  if (tc.function.name === "generate_video") return `Generate video "${trunc(args, 60)}"`;
  if (tc.function.name === "task") return `Task ${trunc(args, 60)}`;
  if (tc.function.name === "delegate") return `Background ${trunc(args, 60)}`;
  if (tc.function.name === "delegation_read") return `Read delegation ${trunc(args, 60)}`;
  if (tc.function.name === "delegation_list") return "List delegations";
  if (tc.function.name === "process_logs") return `Logs for process ${args}`;
  if (tc.function.name === "process_stop") return `Stop process ${args}`;
  if (tc.function.name === "process_list") return "List processes";
  if (tc.function.name === "generate_plan") return "Generating plan...";
  if (tc.function.name === "update_plan_step") return "Updating plan";
  return trunc(`${tc.function.name} ${args}`, 80);
}

function isPresentationToolCall(toolCall: ToolCall): boolean {
  return toolCall.function.name !== "update_plan_step";
}

function commandActivityLabel(command: string): string {
  if (!command) return "Running command";
  if (/\b(test|vitest|jest|playwright)\b/i.test(command)) return "Running tests";
  if (/\b(typecheck|tsc\s+--noEmit)\b/i.test(command)) return "Checking types";
  if (/\b(lint|biome\s+check)\b/i.test(command)) return "Running lint";
  if (/\b(build|compile)\b/i.test(command)) return "Building project";
  if (/\b(verify|verification)\b/i.test(command)) return "Running verification";
  return `Running ${trunc(command, 68)}`;
}

function toolActivityDetail(tc: ToolCall): string {
  const args = toolArgs(tc);
  switch (tc.function.name) {
    case "read_file":
      return args ? `Reading ${trunc(args, 90)}` : "Reading repository file";
    case "grep":
      return args ? `Searching ${trunc(args, 90)}` : "Searching repository";
    case "search_web":
    case "open_web":
      return args ? trunc(args, 100) : "Inspecting external source";
    case "write_file":
    case "edit_file":
      return args ? trunc(args, 100) : "Updating file";
    case "delete_file":
      return args ? trunc(args, 100) : "Deleting file";
    case "bash":
      return args ? trunc(args, 100) : "Running command";
    case "task":
    case "delegate":
      return args ? trunc(args, 100) : "Delegating work";
    default:
      return args ? trunc(args, 100) : "Working";
  }
}

function formatActivityElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes > 0 ? `${minutes}:${String(remainder).padStart(2, "0")}` : `${remainder}s`;
}

function truncateActivity(value: string): string {
  return trunc(value.replace(/\s+/g, " ").trim(), 120);
}

function sanitizeContent(raw: string): string {
  let s = raw.replace(/^[\s\n]*assistant:\s*/gi, "");
  s = s.replace(/\{"success"\s*:\s*(true|false)\s*,\s*"output"\s*:\s*"[\s\S]*$/m, "");
  return s.trim();
}
function shouldOpenApiKeyModalForKey(key: {
  name?: string;
  sequence?: string;
  ctrl?: boolean;
  meta?: boolean;
}): boolean {
  if (key.ctrl || key.meta) return false;
  if (key.name === "return" || key.name === "backspace") return true;
  return !!(key.sequence && key.sequence.length === 1);
}
function compactTaskLabel(label: string): string {
  const words = label.trim().split(/\s+/).filter(Boolean);
  if (words.length <= 3) return label.trim() || "Working";
  return `${words.slice(0, 3).join(" ")}...`;
}
function trunc(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n)}…`;
}
function truncateLine(s: string, n: number): string {
  return trunc(s.replace(/\s+/g, " ").trim(), n);
}

function findLatestPlan(entries: ChatEntry[]): Plan | null {
  for (let index = entries.length - 1; index >= 0; index--) {
    const plan = entries[index]?.toolResult?.plan;
    if (plan) return plan;
  }
  return null;
}
