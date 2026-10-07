#!/usr/bin/env bun
import { existsSync } from "node:fs";
import type { KeyEvent } from "@opentui/core";
import { InvalidArgumentError, program } from "commander";
import * as dotenv from "dotenv";
import packageJson from "../package.json" with { type: "json" };
import { signOutAccount } from "./account/commands";
import { type AccountStatus, checkAccount, describeBlocked } from "./account/session";
import { ABLATIONS, parseAblations } from "./agent/ablation";
import { Agent } from "./agent/agent";
import { completeDelegation, failDelegation, loadDelegation } from "./agent/delegations";
import {
  findObjective,
  formatObjective,
  formatObjectiveEvent,
  formatObjectiveList,
  loadObjectives,
  objectiveEventPayload,
} from "./autonomy/presentation";
import { type RuntimeEvent as ObjectiveRuntimeEvent, runObjective } from "./autonomy/runtime";
import { createAgentBenchmarkExecutor } from "./bench/agent-executor";
import { createClaudeCodeExecutor } from "./bench/claude-code-executor";
import { enterBenchCleanRoom } from "./bench/clean-room";
import { createCodexExecutor } from "./bench/codex-executor";
import { collectBenchmarkEnvironment, collectRepositorySnapshot, resolveBenchmarkPath } from "./bench/environment";
import { appendRunsToHistory } from "./bench/history";
import { loadBenchmarkManifest } from "./bench/manifest";
import { formatRepeatSummary, type RepeatTaskOutcome, summarizeRepeats } from "./bench/repeat";
import { runBenchmark } from "./bench/runner";
import { createShelraBenchmarkExecutor } from "./bench/shelra-executor";
import type { BenchmarkManifest } from "./bench/types";
import {
  allowFree,
  buildProviderRows,
  denyFree,
  formatModelCatalog,
  formatProviderTable,
} from "./cli/providers-command";
import { needsOnboarding } from "./config/preferences";
import { createProviderAdmin } from "./config/provider-admin";
import { createConfigServices } from "./config/services";
import { runExtensionCommand, splitCommand } from "./extend/commands";
import { describeHooks } from "./extend/hooks-admin";
import { flushRuns } from "./extend/runs";
import { projectRootFor } from "./extend/settings";
import { resolveSystemPrompt, setSessionPromptFlags } from "./extend/system-prompt";
import { inspectHardware } from "./hardware/profile";
import {
  createHeadlessJsonlEmitter,
  type HeadlessOutputFormat,
  isHeadlessOutputFormat,
  renderHeadlessChunk,
  renderHeadlessPrelude,
} from "./headless/output";
import { awaitBackgroundHooks } from "./hooks/index";
import { createOpenRouterIntelligenceProvider } from "./intelligence";
import { registerMcpCommands } from "./mcp/orionmcp-commands";
import { type BudgetLimits, parseBudgetUsd } from "./models/budget";
import { normalizeModelId, primeCatalog } from "./models/catalog";
import { installLocalModel } from "./models/manager";
import { fetchOpenRouterCatalog, isOpenRouterBaseURL } from "./models/openrouter";
import type { ModelRecommendation } from "./models/recommendation";
import { type ModelPolicy, parseModelPolicy, rankedFreeModels, routeCatalogModel } from "./models/routing";
import type { CatalogEntry } from "./models/types";
import {
  API_KEY_ENV,
  CLI_NAME,
  CONFIG_DIR_NAME,
  MAX_REQUEST_COST_ENV,
  MAX_SESSION_COST_ENV,
  OPENROUTER_BASE_URL,
  PRODUCT_NAME,
} from "./product/identity";
import { type CredentialFallbackSource, credentialFallbackChain, thenFallback } from "./providers/credential-fallback";
import { createDefaultRegistry, defaultResolveDeps } from "./providers/default-registry";
import { OMNIROUTE_API_KEY_ENV } from "./providers/definitions/omniroute";
import {
  configuredFreeProviders,
  createFreeProvider,
  FREE_PROVIDER_IDS,
  FREE_PROVIDERS,
  freeProviderCliError,
  freeProviderFallbackSources,
  isFreeProviderId,
  outsideFreeMode,
  requireFreeProvider,
} from "./providers/free-providers";
import {
  isValidOmniRouteBaseURL,
  normalizeOmniRouteBaseURL,
  OMNIROUTE_BASE_URL_ENV,
  OMNIROUTE_DEFAULT_BASE_URL,
} from "./providers/omniroute";
import { createOpenRouterProvider } from "./providers/openrouter";
import { selectLocalRoute } from "./router/local-first";
import { declareFreePlanForSession, loadFreeAttestations } from "./routing/attestations";
import { isAutoFreeModel, parseModelRef } from "./routing/model-ref";
import { createRoutingRuntime, type RoutingRuntime } from "./routing/runtime";
import { installManagedRuntime, resolveRuntimeInstallPlan } from "./runtimes/bootstrap";
import { discoverLocalRuntimes, disposeLocalRuntimes } from "./runtimes/discovery";
import { localModelsEnabled } from "./runtimes/enabled";
import type { LocalModelCandidate, LocalRuntimeDiscovery } from "./runtimes/types";
import {
  clearOpenRouterApiKey,
  clearProviderCredential,
  getStoredAccount,
  saveOpenRouterApiKey,
  saveProviderCredential,
} from "./security/credentials";
import { runOnboarding } from "./setup/onboarding";
import { startInstalledLocalModel } from "./startup/local-fallback";
import { probeLocalModel, runStartup } from "./startup/orchestrator";
import { configureRoutedSession } from "./startup/routed-session";
import type { StartupProgress, StartupResult } from "./startup/types";
import {
  createBenchmarkRun,
  finalizeBenchmarkRun,
  recoverInterruptedBenchmarkRuns,
  updateBenchmarkRunMetadata,
} from "./storage/benchmarks";
import { getDatabasePath } from "./storage/index";
import { runTelegramHeadlessBridge } from "./telegram/headless-bridge";
import { isShuruSupported } from "./tools/bash";
import { startScheduleDaemon } from "./tools/schedule";
import type { ModelInfo } from "./types/index";
import { processAtMentions } from "./utils/at-mentions.js";
import { recordSwallowedError } from "./utils/diagnostics";
import { runScriptManagedUninstall } from "./utils/install-manager";
import {
  getApiKey,
  getBaseURL,
  getCurrentSandboxMode,
  getCurrentSandboxSettings,
  listOpenRouterApiKeys,
  loadPaymentSettings,
  loadProjectSettings,
  loadUserSettings,
  MODEL_POLICY_ENV,
  mergeSandboxSettings,
  type SandboxMode,
  type SandboxSettings,
  savePaymentSettings,
  saveUserSettings,
  sessionModelPolicy,
} from "./utils/settings";
import { readAll } from "./utils/standard-input";
import { runUpdate } from "./utils/update-checker";
import { buildVerifyPrompt, getVerifyCliError } from "./verify/entrypoint";

dotenv.config();

// The engine runs as a child process, so every exit route — including signals
// and fatal errors — has to release it or it outlives the CLI holding a
// multi-gigabyte model in RAM.
let activeLocalRuntimes: LocalRuntimeDiscovery | undefined;

function trackLocalRuntimes(discovery: LocalRuntimeDiscovery | undefined): void {
  activeLocalRuntimes = discovery;
}

/**
 * The last fallback for a session whose cloud key is rejected: a local model that is already
 * installed. Its server is tracked like any local runtime, so every exit route releases it.
 */
const installedLocalModelFallback: CredentialFallbackSource = async ({ signal }) => {
  const local = await startInstalledLocalModel(signal);
  if (!local) return null;
  trackLocalRuntimes(local.discovery);
  return {
    provider: local.provider,
    modelId: local.modelId,
    label: `the installed local model ${local.name}`,
    dispose: async () => {
      if (activeLocalRuntimes === local.discovery) trackLocalRuntimes(undefined);
      await disposeLocalRuntimes(local.discovery);
    },
  };
};

async function releaseTrackedLocalRuntimes(): Promise<void> {
  const discovery = activeLocalRuntimes;
  activeLocalRuntimes = undefined;
  if (!discovery || discovery.runtimes.length === 0) return;
  await Promise.race([
    disposeLocalRuntimes(discovery).catch(() => undefined),
    new Promise((resolve) => setTimeout(resolve, 3_000)),
  ]);
}

interface RemoteModelSetup {
  models: ModelInfo[];
  catalog: CatalogEntry[];
  /** The routing runtime of a session on the user's providers; absent for a custom endpoint. */
  routing?: RoutingRuntime;
  /** The catalog's models as they are now (it refreshes while the session runs). */
  getModels?: () => ModelInfo[];
  modelId: string;
  selectModel: (modelId: string) => Promise<{ success: boolean; error?: string }>;
  /** The session's model mode, and a way to switch it (Free runs free models only; Mixed any model). */
  policy: ModelPolicy;
  setPolicy?: (policy: ModelPolicy) => Promise<{ success: boolean; error?: string; modelId?: string }>;
}

/**
 * The session's model mode: the flag when one is given, else the mode of the session that started this process (a
 * delegation), else the mode saved from the terminal UI, else Free. A flag that names no mode is an error, never a
 * silent fallback to another mode.
 */
function resolveModelPolicy(flag: unknown): ModelPolicy {
  if (typeof flag === "string" && flag.trim()) {
    const explicit = parseModelPolicy(flag);
    if (!explicit) {
      throw new Error(
        `Unknown model mode "${flag}". Use free or mixed (also auto, economy, balanced, quality or max).`,
      );
    }
    return explicit;
  }
  return sessionModelPolicy();
}

/** A model named with -m, saved as the default only once the session accepted it (Free refuses a paid one). */
let pendingDefaultModel: string | undefined;

/** Saves the mode for the next session; a settings file that cannot be written never fails the switch. */
function saveModelMode(policy: ModelPolicy): void {
  try {
    saveUserSettings({ modelMode: policy === "free" ? "free" : "mixed" });
  } catch (error) {
    recordSwallowedError("settings.modelMode", error);
  }
}

/** OpenRouter's free router on each OpenRouter key the user configured, as fallbacks. */
function openRouterFreeFallbackSources(): CredentialFallbackSource[] {
  return listOpenRouterApiKeys().map(
    ({ key, source }): CredentialFallbackSource =>
      async () => {
        const catalog = await fetchOpenRouterCatalog({ apiKey: key, baseURL: OPENROUTER_BASE_URL });
        return {
          provider: createOpenRouterProvider(key, {
            modelId: "openrouter/free",
            entries: catalog.entries,
            baseURL: OPENROUTER_BASE_URL,
            requireParameters: true,
            policy: "free",
          }),
          modelId: "openrouter/free",
          label: `OpenRouter Free with the key from ${source}`,
        };
      },
  );
}

/**
 * A session on the provider the user named with `--provider`: its model is `provider/model` (the preset's first when
 * none is named). Naming a provider for a run is the user's own choice of that provider's key for it, so a free-plan
 * provider counts as declared free for this run; routing then treats it like any other model.
 */
async function configureProviderSession(
  agent: Agent,
  providerId: string,
  model: string | undefined,
  policy: ModelPolicy,
): Promise<RemoteModelSetup> {
  const registry = createDefaultRegistry();
  const definition = registry.get(providerId);
  if (!definition) {
    throw new Error(
      `Unknown provider "${providerId}". Use one of: ${registry
        .list()
        .map((item) => item.id)
        .join(", ")}.`,
    );
  }
  const preset = isFreeProviderId(providerId) ? FREE_PROVIDERS[providerId] : undefined;
  const wanted = model?.trim() || preset?.models[0];
  if (!wanted) {
    throw new Error(`Name a ${definition.name} model with -m (for example -m ${providerId}/<model>).`);
  }
  const canonical = wanted.toLowerCase().startsWith(`${providerId}/`) ? wanted : `${providerId}/${wanted}`;
  if (definition.freePlan && !definition.selfEnforcing) declareFreePlanForSession(providerId);
  return routedSetup(agent, { requestedModel: canonical, policy, explicitModelSelection: true });
}

/** The routed session as the terminal UI and the headless runs consume it. */
async function routedSetup(
  agent: Agent,
  input: {
    requestedModel: string | undefined;
    policy: ModelPolicy;
    explicitModelSelection: boolean;
    openRouterKey?: string;
  },
): Promise<RemoteModelSetup> {
  const session = await configureRoutedSession(agent, {
    ...input,
    localFallback: installedLocalModelFallback,
    pickedModel: () => loadProjectSettings().model ?? loadUserSettings().defaultModel,
    defaultProvider: () => loadUserSettings().defaultProvider,
    saveMode: saveModelMode,
    onExplicitModelAccepted: (modelId) => {
      // A model named with -m becomes the default only once the session accepted it (Free refuses a paid one).
      if (pendingDefaultModel && input.requestedModel === pendingDefaultModel) {
        saveUserSettings({ defaultModel: modelId });
        pendingDefaultModel = undefined;
      }
    },
  });
  return {
    models: session.models(),
    catalog: [...session.runtime.catalog.snapshot().entries],
    routing: session.runtime,
    getModels: session.models,
    modelId: session.modelId,
    selectModel: session.selectModel,
    policy: session.policy,
    setPolicy: session.setPolicy,
  };
}

async function configureRemoteProvider(
  agent: Agent,
  apiKey: string | undefined,
  baseURL: string,
  requestedModel: string | undefined,
  policy: ModelPolicy,
  explicitModelSelection = false,
): Promise<RemoteModelSetup> {
  // Every agent and child process of this session reads the mode from here (`sessionModelPolicy`).
  process.env[MODEL_POLICY_ENV] = policy;
  if (baseURL && !isOpenRouterBaseURL(baseURL)) {
    // The user's own OpenAI-compatible endpoint (SHELRA_BASE_URL): one endpoint, one key, no routing across providers.
    agent.setApiKey(apiKey as string, baseURL);
    // A key this endpoint rejects: continue on OpenRouter Free with a configured OpenRouter key,
    // then on an installed local model. Free, so no spend is started without the user.
    // No model of this endpoint can serve the turn: continue on a free provider the user configured, as an
    // OpenRouter session does, then on OpenRouter Free. One OpenRouter Free chain serves both failures, so it
    // is tried once per session whichever reaches it first.
    const openRouterFree = credentialFallbackChain(openRouterFreeFallbackSources());
    agent.setCredentialFallback(thenFallback(openRouterFree, installedLocalModelFallback));
    agent.setProviderFallback(
      thenFallback(
        outsideFreeMode(credentialFallbackChain(freeProviderFallbackSources(configuredFreeProviders()))),
        openRouterFree,
      ),
    );
    return {
      models: [],
      catalog: [],
      modelId: agent.getModel(),
      selectModel: async () => ({ success: false, error: "Model selection is unavailable for this endpoint." }),
      policy,
    };
  }
  return routedSetup(agent, {
    requestedModel,
    policy,
    explicitModelSelection,
    ...(apiKey ? { openRouterKey: apiKey } : {}),
  });
}

function exitAfterRuntimeCleanup(code: number): void {
  // Delegated-run records are written asynchronously and hooks started without being awaited may still be running: both
  // get a bounded moment to finish, so a run that ended just before the exit is on record and no hook is cut off.
  void Promise.allSettled([releaseTrackedLocalRuntimes(), flushRuns(), awaitBackgroundHooks(1_500)]).finally(() =>
    process.exit(code),
  );
}

const exitCleanlyOnSigterm = () => {
  exitAfterRuntimeCleanup(0);
};

process.on("SIGTERM", exitCleanlyOnSigterm);
process.on("SIGINT", () => exitAfterRuntimeCleanup(130));

process.on("uncaughtException", (err) => {
  console.error("Fatal:", err.message);
  exitAfterRuntimeCleanup(1);
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
  exitAfterRuntimeCleanup(1);
});

/**
 * The account is required to use Shelra (owner, 2026-10-06). A headless run with no valid login stops here with what
 * to do; the terminal UI gets the status and shows its sign-in screen instead. A login that is about to expire, or
 * that is being trusted without the service, is said once on stderr.
 */
async function requireAccount(headless: boolean): Promise<AccountStatus> {
  const status = await checkAccount();
  if (status.state === "ok") {
    if (headless) {
      if (status.expiresInDays !== null) {
        process.stderr.write(
          `Your ShelraCode login ends in ${status.expiresInDays} day${status.expiresInDays === 1 ? "" : "s"}: run \`${CLI_NAME} login\` to renew it.\n`,
        );
      }
      if (status.offline) {
        process.stderr.write("The account service could not be reached; continuing on the last confirmed login.\n");
      }
    }
    return status;
  }
  if (headless) {
    process.stderr.write(`${describeBlocked(status, CLI_NAME)}\n`);
    process.exit(1);
  }
  return status;
}

/** Why the sign-in screen is up, in words for the person. */
function signInReason(status: Exclude<AccountStatus, { state: "ok" }>): string {
  switch (status.state) {
    case "signed-out":
      return "Sign in to your ShelraCode account to use Shelra. It takes a minute and opens your browser.";
    case "invalid":
      return `${status.reason} Sign in again to continue.`;
    case "offline-too-long":
      return `ShelraCode could not confirm your login since ${status.since.slice(0, 10)}. Connect to the internet and sign in again.`;
  }
}

async function startInteractive(
  apiKey: string | undefined,
  baseURL: string,
  model: string | undefined,
  maxToolRounds: number,
  sandboxMode: SandboxMode,
  sandboxSettings: SandboxSettings,
  session?: string,
  initialMessage?: string,
  preferLocal = false,
  modelPolicy: ModelPolicy = "free",
  budget: BudgetLimits = {},
  account: AccountStatus = { state: "signed-out" },
  modelPolicyFromFlag = false,
) {
  // Cloud Free is the normal product path. Local inference is initialized only
  // when the user explicitly selects --local.
  const agent = new Agent(preferLocal ? undefined : apiKey, preferLocal ? undefined : baseURL, model, maxToolRounds, {
    session,
    sandboxMode,
    sandboxSettings,
    budget,
  });
  const { createCliRenderer } = await import("@opentui/core");
  const { createRoot } = await import("@opentui/react");
  const { createElement } = await import("react");
  const { App } = await import("./ui/app");
  const { CloudStartupScreen, StartupScreen } = await import("./ui/startup");
  const { AccountLoginScreen } = await import("./ui/account-login");
  const { ConfigView } = await import("./ui/config/view");
  const savedCloudModel = !model ? savedProviderModel(agent.getModel()) : undefined;
  const requestedCloudModel = model || savedCloudModel;

  const renderer = await createCliRenderer({
    exitOnCtrlC: false,
    useMouse: true,
    // Lets terminals (Kitty, iTerm2, WezTerm, …) report Command as `super` on KeyEvent — needed for ⌘C in the TUI.
    useKittyKeyboard: {
      disambiguate: true,
      alternateKeys: true,
    },
  });

  /** Said after the terminal UI is gone: what signing out from `/config` or `/logout` did. */
  let farewell: string | undefined;
  const onExit = () => {
    startupAbort?.abort();
    installAbort?.abort();
    if (startupKeyHandler) {
      renderer.keyInput.off("keypress", startupKeyHandler);
      startupKeyHandler = undefined;
    }
    trackLocalRuntimes(undefined);
    void Promise.all([agent.cleanup(), disposeLocalRuntimes(startupDiscovery)]).finally(() => {
      renderer.destroy();
      if (farewell) console.log(farewell);
      process.exit(0);
    });
  };

  const root = createRoot(renderer);
  let rootMounted = false;
  const renderRoot = (node: unknown) => {
    // OpenTUI's createRoot.render creates a new reconciler container on each
    // call. Unmounting first keeps resize/mouse listeners bounded while the
    // startup state machine updates its progress screen.
    if (rootMounted) root.unmount();
    root.render(node as never);
    rootMounted = true;
  };
  let startupProgress: StartupProgress = { state: "booting", message: "Preparing your local coding environment" };
  let startupDiscovery: LocalRuntimeDiscovery = { runtimes: [], health: {}, models: [] };
  let startupHardware = inspectHardware();
  let startupRecommendation: ModelRecommendation | undefined;
  let installing = false;
  let initializing = false;
  let startupAbort: AbortController | null = null;
  let installAbort: AbortController | null = null;
  let initializeLocal: () => Promise<void>;
  let installRecommended: () => Promise<void>;
  let startupKeyHandler: ((key: KeyEvent) => void) | undefined;
  let currentApiKey = apiKey;
  const currentBaseURL = baseURL || OPENROUTER_BASE_URL;
  let configureRemoteApiKey: ((nextApiKey: string) => Promise<{ success: boolean; error?: string }>) | undefined;
  const renderStartup = (
    progress: StartupProgress,
    discovery?: LocalRuntimeDiscovery,
    recommendation?: ModelRecommendation,
  ) => {
    startupProgress = progress;
    if (discovery) startupDiscovery = discovery;
    if (recommendation !== undefined) startupRecommendation = recommendation;
    renderRoot(
      createElement(StartupScreen, {
        progress,
        hardware: startupHardware,
        discovery: startupDiscovery,
        recommendation: startupRecommendation,
        installing,
        onRetry: () => void initializeLocal(),
        // Enter always has a visible, controlled action: install the managed
        // runtime first when needed, then download the reviewed HF artifact.
        onInstall: startupRecommendation ? () => void installRecommended() : undefined,
        canInstall: startupDiscovery.runtimes.some((runtime) => typeof runtime.installModel === "function"),
        canBootstrapRuntime: Boolean(resolveRuntimeInstallPlan()),
        onExit,
      }),
    );
  };

  const renderCloudStartup = (progress: StartupProgress) => {
    renderRoot(
      createElement(CloudStartupScreen, {
        progress,
        onRetry: () => void initializeLocal(),
        onExit,
      }),
    );
  };

  const prepareLocalModel = async (modelId: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const candidate = startupDiscovery.models.find((item) => item.id === modelId);
      if (!candidate) return { success: false, error: "That local model is no longer available." };
      const runtime = startupDiscovery.runtimes.find((item) => item.id === candidate.runtimeId);
      if (!runtime) return { success: false, error: `Runtime ${candidate.runtimeId} is unavailable.` };
      if (runtime.prepareModel && !(await runtime.prepareModel(candidate.id))) {
        return { success: false, error: `The local runtime could not load ${candidate.name}.` };
      }
      const provider = runtime.provider(candidate);
      const probe = await probeLocalModel(provider, candidate);
      if (!probe.ok) return { success: false, error: probe.reason || "The selected model failed its health check." };
      agent.setProvider(provider, candidate.id);
      saveUserSettings({
        defaultModel: candidate.id,
        localRuntimeId: runtime.id,
        lastLocalHealthCheck: new Date().toISOString(),
      });
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  };

  const renderApp = (
    localModels: LocalModelCandidate[],
    cloudModels: ModelInfo[] = [],
    onSelectModel?: (modelId: string) => Promise<{ success: boolean; error?: string }>,
    remote?: RemoteModelSetup,
  ) => {
    // Free and Mixed apply where Shelra routes OpenRouter models itself; a paid tier shows as Mixed (it can spend).
    const setPolicy = remote?.setPolicy;
    const modes = setPolicy
      ? {
          modelMode: (remote.policy === "free" ? "free" : "mixed") as "free" | "mixed",
          onSetModelMode: (mode: "free" | "mixed") => setPolicy(mode === "free" ? "free" : "mixed"),
        }
      : {};
    if (startupKeyHandler) {
      renderer.keyInput.off("keypress", startupKeyHandler);
      startupKeyHandler = undefined;
    }
    renderRoot(
      createElement(App, {
        agent,
        startupConfig: {
          apiKey: currentApiKey,
          baseURL: currentBaseURL,
          model: agent.getModel(),
          localModels: [...(preferLocal ? localModels.map(toModelInfo) : []), ...cloudModels],
          ...(remote?.routing && remote.getModels
            ? {
                getModels: remote.getModels,
                subscribeModels: (listener: () => void) => remote.routing!.catalog.subscribe(listener),
              }
            : {}),
          onSelectLocalModel: onSelectModel ?? (preferLocal ? prepareLocalModel : undefined),
          onApiKey: !preferLocal ? configureRemoteApiKey : undefined,
          ...modes,
          configServices: () =>
            createConfigServices({
              live: {
                ...(setPolicy ? { setMode: (mode) => setPolicy(mode === "free" ? "free" : "mixed") } : {}),
                ...(remote?.getModels ? { models: remote.getModels } : {}),
                ...(remote?.routing
                  ? {
                      refreshCatalog: () =>
                        Promise.race([
                          remote.routing!.refresh(),
                          new Promise<void>((resolve) => setTimeout(resolve, 8_000)),
                        ]).then(() => undefined),
                      providersChanged: () =>
                        void remote.routing!.reload().catch((error) => recordSwallowedError("providers reload", error)),
                    }
                  : {}),
                signOut: async () => {
                  const result = await signOutAccount();
                  if (result.signedOut) farewell = `${result.message} Run \`${CLI_NAME}\` to sign in again.`;
                  return { ok: result.signedOut, message: result.message };
                },
              },
            }),
          onSignedOut: onExit,
          accountEmail: () => getStoredAccount()?.email ?? null,
          maxToolRounds,
          sandboxMode,
          sandboxSettings,
          version: packageJson.version,
        },
        initialMessage,
        onExit,
      }),
    );
  };

  configureRemoteApiKey = async (nextApiKey: string) => {
    try {
      const remote = await configureRemoteProvider(
        agent,
        nextApiKey,
        currentBaseURL,
        requestedCloudModel,
        // The mode the session runs under now: the user may have switched it since startup.
        sessionModelPolicy(),
        Boolean(model),
      );
      currentApiKey = nextApiKey;
      saveOpenRouterApiKey(nextApiKey);
      renderApp([], remote.models, remote.selectModel, remote);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  };

  installRecommended = async () => {
    if (installing || !startupRecommendation) return;
    installing = true;
    installAbort = new AbortController();
    try {
      const managedRuntime = startupDiscovery.runtimes.find((runtime) => runtime.id === "shelra-llama");
      const runtimeBinaryReady = managedRuntime
        ? !managedRuntime.hasRuntimeBinary || (await managedRuntime.hasRuntimeBinary())
        : false;
      const needsManagedRuntime = Boolean(resolveRuntimeInstallPlan()) && !runtimeBinaryReady;
      if (needsManagedRuntime) {
        renderStartup({
          state: "preparing-runtime",
          message: "Preparing Shelra local engine",
          detail: "Downloading the managed llama.cpp engine; no external runtime app is required.",
        });
        const runtimeResult = await installManagedRuntime({
          signal: installAbort.signal,
          onProgress: (progress) =>
            renderStartup({
              state: "preparing-runtime",
              message: progress.status,
              detail: progress.detail,
              percent: progress.percent,
              completed: progress.completed,
              total: progress.total,
              speedBytesPerSecond: progress.speedBytesPerSecond,
              etaSeconds: progress.etaSeconds,
              elapsedSeconds: progress.elapsedSeconds,
            }),
        });
        installAbort = null;
        installing = false;
        if (!runtimeResult.success) {
          renderStartup({
            state: "recoverable-error",
            message: "Local runtime installation needs attention",
            detail: runtimeResult.reason,
          });
          return;
        }

        // Package installers can take a moment to start the newly installed
        // runtime service. Re-scan briefly before asking the user to retry.
        for (let attempt = 0; attempt < 4; attempt += 1) {
          await initializeLocal();
          if (startupDiscovery.runtimes.some((runtime) => typeof runtime.installModel === "function")) break;
          if (startupProgress.state !== "onboarding") return;
          await new Promise((resolve) => setTimeout(resolve, 1_000));
        }
        const runtimeReady = startupDiscovery.runtimes.some((runtime) => typeof runtime.installModel === "function");
        if (!runtimeReady) {
          renderStartup({
            state: "recoverable-error",
            message: "The local runtime is not ready yet",
            detail: "ShelraCode prepared the engine but it is not ready yet. Press r to retry.",
          });
          return;
        }
        if (startupRecommendation) {
          await installRecommended();
        }
        return;
      }
      renderStartup({
        state: "downloading-model",
        message: `Installing ${startupRecommendation.name}`,
        model: startupRecommendation.id,
        percent: 0,
      });
      let lastDownloadRenderAt = 0;
      const result = await installLocalModel(
        startupDiscovery,
        startupRecommendation.id,
        startupHardware,
        (progress) => {
          const now = Date.now();
          if (progress.status === "downloading" && now - lastDownloadRenderAt < 250) return;
          lastDownloadRenderAt = now;
          const percent =
            progress.total && progress.completed !== undefined
              ? Math.round((progress.completed / progress.total) * 100)
              : undefined;
          const detail =
            progress.total && progress.completed !== undefined
              ? `${formatBytes(progress.completed)} / ${formatBytes(progress.total)}`
              : undefined;
          const message =
            progress.status === "downloading"
              ? `Downloading ${startupRecommendation!.name}`
              : progress.status === "verifying"
                ? `Verifying ${startupRecommendation!.name}`
                : progress.status === "complete"
                  ? `Installed ${startupRecommendation!.name}`
                  : progress.status || `Installing ${startupRecommendation!.name}`;
          renderStartup({
            state: "downloading-model",
            message,
            detail,
            model: startupRecommendation!.id,
            runtime: progress.runtime,
            percent,
            completed: progress.completed,
            total: progress.total,
            speedBytesPerSecond: progress.speedBytesPerSecond,
            etaSeconds: progress.etaSeconds,
          });
        },
        installAbort.signal,
        startupRecommendation.estimatedMemoryGb,
      );
      if (!result.success) {
        installAbort = null;
        installing = false;
        renderStartup({
          state: "recoverable-error",
          message: "Model installation needs attention",
          detail: result.reason,
        });
        return;
      }
      // Release the install guard before re-running startup. Otherwise the
      // startup orchestrator sees an active download and returns immediately.
      installAbort = null;
      installing = false;
      await initializeLocal();
    } catch (error) {
      installAbort = null;
      installing = false;
      renderStartup({
        state: "recoverable-error",
        message: "Model installation failed",
        detail: error instanceof Error ? error.message : String(error),
      });
    } finally {
      installAbort = null;
      installing = false;
    }
  };

  /** Signs in inside the terminal UI: opens the browser, accepts a pasted code, retries until it works or the person quits. */
  const signIn = (reason: string): Promise<void> =>
    new Promise((resolve) => {
      type View = Parameters<typeof AccountLoginScreen>[0];
      let view = { phase: "starting", reason } as Pick<View, "phase" | "reason" | "url" | "opened" | "error" | "email">;
      let attempt: AbortController | null = null;
      let pendingPaste: ((code: string | null) => void) | null = null;
      const show = (patch: Partial<typeof view>) => {
        view = { ...view, ...patch };
        renderRoot(createElement(AccountLoginScreen, { ...view, onSubmitCode, onRetry: () => void start(), onExit }));
      };
      const onSubmitCode = (code: string) => pendingPaste?.(code);
      const quiet = { ask: async () => null, say: () => {}, warn: () => {} };
      const start = async () => {
        attempt?.abort();
        const mine = new AbortController();
        attempt = mine;
        pendingPaste = null;
        show({ phase: "starting", error: undefined, url: undefined });
        try {
          const { loginWithBrowser } = await import("./account/commands");
          const signedIn = await loginWithBrowser({
            io: quiet,
            signal: mine.signal,
            readPasted: () =>
              new Promise<string | null>((done) => {
                pendingPaste = done;
              }),
            onEvent: (event) => {
              if (event.type === "url") show({ phase: "waiting", url: event.url, opened: event.opened });
              if (event.type === "received") show({ phase: "exchanging" });
            },
          });
          show({ phase: "signed-in", email: signedIn.email });
          setTimeout(resolve, 900);
        } catch (error) {
          if (mine.signal.aborted) return;
          show({ phase: "error", error: error instanceof Error ? error.message : String(error) });
        }
      };
      void start();
    });

  /**
   * The first-run setup (and the one after `/logout`): a person at the keyboard connects providers and picks the
   * defaults before the session starts. What they save is what the session below reads.
   */
  const runSetup = async () => {
    if (
      preferLocal ||
      !needsOnboarding({
        settings: loadUserSettings(),
        hasProvider: Boolean(currentApiKey) || anyProviderConfigured(),
        interactive: true,
      })
    ) {
      return;
    }
    // The startup screen's keys (r to retry, q to quit) must not read what is typed into the setup.
    if (startupKeyHandler) renderer.keyInput.off("keypress", startupKeyHandler);
    try {
      await new Promise<void>((resolve) => {
        renderRoot(
          createElement(ConfigView, {
            variant: "onboarding",
            services: createConfigServices(),
            onClose: () => resolve(),
          }),
        );
      });
    } finally {
      if (startupKeyHandler) renderer.keyInput.on("keypress", startupKeyHandler);
    }
    // A mode chosen in the setup applies now, unless this run was given one with --model-policy.
    if (!modelPolicyFromFlag) modelPolicy = parseModelPolicy(loadUserSettings().modelMode) ?? modelPolicy;
  };

  initializeLocal = async () => {
    if (initializing || installing) return;
    initializing = true;
    // Required before anything else, local models included: the person signs in, then the session starts.
    if (account.state !== "ok") {
      try {
        await signIn(signInReason(account));
        account = await checkAccount();
      } finally {
        initializing = false;
      }
      if (account.state !== "ok") return;
      initializing = true;
    }
    try {
      await runSetup();
    } catch (error) {
      recordSwallowedError("setup", error);
    }
    if (!preferLocal) {
      renderCloudStartup({
        state: "detecting-models",
        message: "Connecting to your model providers",
        detail:
          "Free mode picks the best free model from every provider you configured. Local inference remains available with --local.",
      });
      if (!currentApiKey && !anyProviderConfigured()) {
        renderApp([]);
        initializing = false;
        return;
      }
      try {
        const remote = await configureRemoteProvider(
          agent,
          currentApiKey,
          currentBaseURL,
          requestedCloudModel,
          modelPolicy,
          Boolean(model),
        );
        renderApp([], remote.models, remote.selectModel, remote);
      } catch (error) {
        renderCloudStartup({
          state: "recoverable-error",
          message: "Remote model setup needs attention",
          detail: error instanceof Error ? error.message : String(error),
        });
      } finally {
        initializing = false;
      }
      return;
    }
    try {
      startupAbort = new AbortController();
      const result: StartupResult = await runStartup({
        requestedModel: model || agent.getModel() || undefined,
        signal: startupAbort.signal,
        onProgress: (progress) => renderStartup(progress),
      });
      // Each startup pass builds fresh runtime adapters that may own a live
      // server; the previous pass must be released before its last reference
      // is dropped, otherwise every retry leaks a llama-server.
      const previousDiscovery = startupDiscovery;
      startupDiscovery = result.discovery;
      trackLocalRuntimes(startupDiscovery);
      if (previousDiscovery !== result.discovery) await disposeLocalRuntimes(previousDiscovery);
      startupHardware = result.hardware;
      startupRecommendation = result.recommendation;
      if (result.state === "ready" && result.provider && result.model) {
        agent.setProvider(result.provider, result.model.id);
        renderApp(result.discovery.models);
        return;
      }
      renderStartup(
        {
          state: result.state,
          message:
            result.state === "onboarding" ? "Let's prepare a local coding model" : "Local startup needs attention",
          detail: result.error,
        },
        result.discovery,
        result.recommendation,
      );
    } catch (error) {
      renderStartup({
        state: "recoverable-error",
        message: "Local startup failed",
        detail: error instanceof Error ? error.message : String(error),
      });
    } finally {
      startupAbort = null;
      initializing = false;
    }
  };

  const { resolveStartupKeyAction } = await import("./ui/startup-input");
  startupKeyHandler = (key: KeyEvent) => {
    const action = resolveStartupKeyAction(
      { name: key.name, sequence: key.sequence, ctrl: key.ctrl },
      startupProgress.state,
      Boolean(startupRecommendation),
    );
    if (action === "install" && !installing) void installRecommended();
    if (action === "retry" && !initializing && !installing) void initializeLocal();
    if (action === "exit") onExit();
  };
  renderer.keyInput.on("keypress", startupKeyHandler);

  if (preferLocal) {
    renderStartup(startupProgress);
  } else {
    renderCloudStartup({
      state: "booting",
      message: "Preparing Free mode",
      detail: "Cloud models are primary. No local model download is started.",
    });
  }
  void initializeLocal();
}

function toModelInfo(model: LocalModelCandidate): ModelInfo {
  return {
    id: model.id,
    name: model.name,
    contextWindow: model.contextWindow,
    inputPrice: 0,
    outputPrice: 0,
    reasoning: model.reasoning,
    description: `${model.runtimeKind} local model${model.quantization ? ` (${model.quantization})` : ""}`,
    supportsClientTools: model.tools,
    supportsMaxOutputTokens: true,
    capabilityConfidence: model.capabilityConfidence ?? "unknown",
    runtimeKind: model.runtimeKind,
    supportsVision: model.supportsVision,
  };
}

function formatBytes(value: number): string {
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(0)} MB`;
  return `${(value / 1024 ** 3).toFixed(1)} GB`;
}

/** A saved default that names one of the providers (`openrouter/…`, `groq/…`): a cloud model, not a local one. */
function savedProviderModel(modelId: string): string | undefined {
  if (!modelId) return undefined;
  const ref = parseModelRef(modelId, createDefaultRegistry().ids());
  return ref.legacy ? undefined : ref.canonical;
}

/** True when at least one provider is configured: a key, a saved credential, or an OmniRoute address. */
function anyProviderConfigured(): boolean {
  return createDefaultRegistry().configured(defaultResolveDeps()()).length > 0;
}

/** Explains what a `--remote` run is missing before any turn is attempted. */
function getRemoteConfigurationError(apiKey: string | undefined, baseURL: string): string | undefined {
  if (baseURL && !isOpenRouterBaseURL(baseURL)) {
    // The user's own endpoint: one URL and one key.
    return apiKey ? undefined : `Your endpoint ${baseURL} needs an API key. Pass --api-key or set ${API_KEY_ENV}.`;
  }
  if (apiKey || anyProviderConfigured()) return undefined;
  return `Cloud mode needs a model provider. Set one up with \`${CLI_NAME} auth <provider>\` or an environment variable:\n${createDefaultRegistry()
    .list()
    .map((definition) => `  ${definition.name}: ${definition.setupHint}`)
    .join("\n")}\nUse --local for local inference.`;
}

async function configureLocalProvider(
  agent: Agent,
  requestedModel?: string,
  activate = true,
  requireReady = false,
): Promise<{ models: LocalModelCandidate[]; dispose: () => Promise<void> }> {
  // `--remote` never uses a local runtime. Discovering one would start — and
  // immediately abandon — a local inference server.
  if (!activate) return { models: [], dispose: async () => undefined };
  if (requireReady) {
    const startup = await runStartup({ requestedModel: requestedModel || agent.getModel() || undefined });
    if (startup.state !== "ready" || !startup.provider || !startup.model) {
      await disposeLocalRuntimes(startup.discovery);
      throw new Error(startup.error || "No usable local model is available. Run `shelra` to start onboarding.");
    }
    agent.setProvider(startup.provider, startup.model.id);
    trackLocalRuntimes(startup.discovery);
    return {
      models: startup.discovery.models,
      dispose: async () => {
        trackLocalRuntimes(undefined);
        await disposeLocalRuntimes(startup.discovery);
      },
    };
  }
  try {
    const discovered = await discoverLocalRuntimes(undefined, AbortSignal.timeout(750));
    trackLocalRuntimes(discovered);
    if (activate) {
      const route = selectLocalRoute(discovered.models, {
        preferredModel: requestedModel,
        requiresTools: true,
        hardware: inspectHardware(),
      });
      const candidate = route.model;
      if (candidate) {
        const runtime = discovered.runtimes.find((item) => item.id === candidate.runtimeId);
        if (runtime) {
          agent.setProvider(runtime.provider(candidate), candidate.id);
          return {
            models: discovered.models.filter((model) => model.runtimeId === candidate.runtimeId),
            dispose: () => disposeLocalRuntimes(discovered),
          };
        }
      }
    }
    return { models: discovered.models, dispose: () => disposeLocalRuntimes(discovered) };
  } catch {
    return { models: [], dispose: async () => undefined };
  }
}

async function runHeadless(
  prompt: string,
  apiKey: string | undefined,
  baseURL: string,
  model: string | undefined,
  maxToolRounds: number,
  sandboxMode: SandboxMode,
  sandboxSettings: SandboxSettings,
  format: HeadlessOutputFormat,
  session?: string,
  preferLocal = false,
  modelPolicy: ModelPolicy = "free",
  budget: BudgetLimits = {},
  providerFlag?: string,
) {
  if (providerFlag) {
    const agent = new Agent(undefined, undefined, model, maxToolRounds, {
      session,
      sandboxMode,
      sandboxSettings,
      budget,
    });
    try {
      await configureProviderSession(agent, providerFlag, model, modelPolicy);
    } catch (error) {
      process.stderr.write(
        `ShelraCode could not configure ${providerFlag}: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
      await agent.cleanup();
      return;
    }
    await runHeadlessTurn(agent, prompt, format);
    return;
  }
  const agent = new Agent(preferLocal ? undefined : apiKey, preferLocal ? undefined : baseURL, model, maxToolRounds, {
    session,
    sandboxMode,
    sandboxSettings,
    budget,
  });
  const savedCloudModel = !model ? savedProviderModel(agent.getModel()) : undefined;
  const requestedCloudModel = model || savedCloudModel;
  let localSetup: { dispose: () => Promise<void> } | undefined;
  const remoteError = preferLocal ? undefined : getRemoteConfigurationError(apiKey, baseURL);
  if (remoteError) {
    process.stderr.write(`${remoteError}\n`);
    process.exitCode = 1;
    await agent.cleanup();
    return;
  }
  try {
    if (preferLocal) {
      localSetup = await configureLocalProvider(agent, model, true, true);
    } else {
      await configureRemoteProvider(agent, apiKey!, baseURL, requestedCloudModel, modelPolicy, Boolean(model));
    }
  } catch (error) {
    process.stderr.write(
      `${preferLocal ? "ShelraCode could not start a local model" : "ShelraCode could not configure the cloud provider"}: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
    await Promise.all([agent.cleanup(), localSetup?.dispose()]);
    return;
  }
  await runHeadlessTurn(agent, prompt, format, () => localSetup?.dispose() ?? Promise.resolve());
}

/** The prelude and one headless turn, then the agent's cleanup and whatever the setup started. */
async function runHeadlessTurn(
  agent: Agent,
  prompt: string,
  format: HeadlessOutputFormat,
  dispose: () => Promise<void> = async () => undefined,
): Promise<void> {
  const prelude = renderHeadlessPrelude(format, agent.getSessionId() || undefined, agent.getModelInfo());
  if (prelude.stdout) process.stdout.write(prelude.stdout);
  if (prelude.stderr) process.stderr.write(prelude.stderr);

  try {
    const { enhancedMessage } = processAtMentions(prompt, process.cwd());

    if (format === "json") {
      const { observer, consumeChunk, flush } = createHeadlessJsonlEmitter(agent.getSessionId() || undefined);
      for await (const chunk of agent.processMessage(enhancedMessage, observer)) {
        const writes = consumeChunk(chunk);
        if (writes.stdout) process.stdout.write(writes.stdout);
        if (writes.stderr) process.stderr.write(writes.stderr ?? "");
      }
      const tail = flush();
      if (tail.stdout) process.stdout.write(tail.stdout);
      if (tail.stderr) process.stderr.write(tail.stderr ?? "");
      return;
    }

    for await (const chunk of agent.processMessage(enhancedMessage)) {
      const writes = renderHeadlessChunk(chunk);
      if (writes.stdout) process.stdout.write(writes.stdout);
      if (writes.stderr) process.stderr.write(writes.stderr);
    }
  } finally {
    await Promise.all([agent.cleanup(), dispose()]);
  }
}

function renderObjectiveEvent(event: ObjectiveRuntimeEvent, format: HeadlessOutputFormat): void {
  if (format === "json") {
    process.stdout.write(`${JSON.stringify(objectiveEventPayload(event))}\n`);
    return;
  }
  process.stdout.write(formatObjectiveEvent(event));
}

function renderObjectiveError(format: HeadlessOutputFormat, code: string, message: string): void {
  if (format === "json") {
    process.stdout.write(`${JSON.stringify({ type: "error", code, message })}\n`);
    return;
  }
  process.stderr.write(`${message}\n`);
}

/**
 * Runs an objective through `AutonomyKernel` (`src/autonomy/*`) — a deliberately separate
 * engine from `Agent.processMessage()`. The `Agent` constructed below is only used to resolve
 * a provider/model; the actual work happens in `runObjective()`. See the architecture note at
 * the top of `src/autonomy/kernel.ts` for what this path does and does not share with
 * interactive chat (docs/architecture/14-AGENT-HARNESS-RECONSTRUCTION.md §14 Phase 0).
 */
async function runAutonomousHeadless(
  prompt: string,
  apiKey: string | undefined,
  baseURL: string,
  model: string | undefined,
  maxToolRounds: number,
  sandboxMode: SandboxMode,
  sandboxSettings: SandboxSettings,
  format: HeadlessOutputFormat,
  modelPolicy: ModelPolicy,
  budget: BudgetLimits,
) {
  if (sandboxMode !== "off") {
    renderObjectiveError(
      format,
      "autonomous_sandbox_unavailable",
      "--sandbox is not yet connected to the autonomous execution broker. Refusing to run with a false sandbox guarantee; omit --sandbox to use explicit host execution.",
    );
    process.exitCode = 1;
    return;
  }

  if (!apiKey) {
    renderObjectiveError(
      format,
      "openrouter_key_missing",
      "OpenRouter is required for --autonomous. Set OPENROUTER_API_KEY or use `shelra auth openrouter <key>`.",
    );
    process.exitCode = 1;
    return;
  }

  if (!isOpenRouterBaseURL(baseURL)) {
    renderObjectiveError(
      format,
      "autonomous_provider_unsupported",
      "--autonomous currently requires the OpenRouter model runtime.",
    );
    process.exitCode = 1;
    return;
  }

  const agent = new Agent(apiKey, baseURL, model, maxToolRounds, {
    persistSession: false,
    sandboxMode,
    sandboxSettings,
    budget,
  });
  const savedCloudModel = !model ? savedProviderModel(agent.getModel()) : undefined;
  const requestedCloudModel = model || savedCloudModel;
  try {
    const remote = await configureRemoteProvider(
      agent,
      apiKey,
      baseURL,
      requestedCloudModel,
      modelPolicy,
      Boolean(model),
    );
    // The kernel talks to OpenRouter directly: Auto Free means its best free model, or its router.
    const openRouterEntries = remote.catalog.filter((entry) => entry.provider === "openrouter");
    const intelligenceModel = isAutoFreeModel(remote.modelId)
      ? modelPolicy === "free"
        ? (rankedFreeModels(openRouterEntries)[0] ?? "openrouter/free")
        : "openrouter/auto"
      : remote.modelId;
    const intelligence = createOpenRouterIntelligenceProvider({
      apiKey,
      baseURL,
      entries: openRouterEntries,
      policy: modelPolicy,
      modelId: intelligenceModel,
      maxCostUsd: budget.maxTaskUsd ?? budget.maxSessionUsd ?? budget.maxDayUsd,
    });
    const objectiveBudget = budget.maxTaskUsd ?? budget.maxSessionUsd ?? budget.maxDayUsd;
    let verified = false;
    for await (const event of runObjective({
      workspace: process.cwd(),
      request: prompt,
      intelligence,
      maxCostUsd: objectiveBudget,
      maxRequestCostUsd: budget.maxRequestUsd,
    })) {
      renderObjectiveEvent(event, format);
      if (event.outcome) verified = event.outcome.verified;
    }
    if (!verified) process.exitCode = 1;
  } catch (error) {
    renderObjectiveError(
      format,
      "autonomous_runtime_failed",
      `Autonomous objective failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  } finally {
    await agent.cleanup();
  }
}

/**
 * Execute the configured benchmark suite through Shelra's autonomous runtime. The durable
 * run is created before manifest/provider validation so a bad configuration is historical
 * evidence (`invalid`/`failed`) instead of a missing run.
 */
async function runBenchCommand(options: {
  manifest?: string;
  suite?: string;
  agent?: string;
  model?: string;
  modelPolicy?: string;
  apiKey?: string;
  baseUrl?: string;
  maxCost?: string;
  maxRequestCost?: string;
  directory?: string;
  json?: boolean;
  /** Commander's `--no-clean-room` sets this to false. */
  cleanRoom?: boolean;
  /** Comma-separated harness subsystems to switch off (`--ablate`). */
  ablate?: string;
  /** How many times to run the suite (`--repeat`). */
  repeat?: string;
  /** Commander's `--no-history` sets this to false. */
  history?: boolean;
  /** The root `--max-tool-rounds`: each task's tool-round bound on the shelra product path. */
  maxToolRounds?: string;
  /** A free provider other than OpenRouter (`--provider groq|gemini|cloudflare`). */
  provider?: string;
}): Promise<void> {
  const manifestCandidate = options.manifest || ".shelra/bench/manifest.json";
  const agentName = ((options.agent || "shelra").trim() || "shelra").toLowerCase();
  const repeat = Number(options.repeat ?? "1");
  if (!Number.isInteger(repeat) || repeat < 1 || repeat > 20) {
    console.error("--repeat takes a whole number from 1 to 20.");
    process.exitCode = 1;
    return;
  }
  const maxToolRounds = Number(options.maxToolRounds ?? "400");
  if (!Number.isInteger(maxToolRounds) || maxToolRounds < 1) {
    console.error("--max-tool-rounds takes a whole number of at least 1.");
    process.exitCode = 1;
    return;
  }
  const { ablations, unknown: unknownAblations } = parseAblations(options.ablate ?? "");
  if (unknownAblations.length > 0 || (ablations.length > 0 && agentName !== "shelra")) {
    console.error(
      unknownAblations.length > 0
        ? `Unknown ablation: ${unknownAblations.join(", ")}. Known: ${ABLATIONS.join(", ")}.`
        : "--ablate applies to the shelra product path only.",
    );
    process.exitCode = 1;
    return;
  }
  const requestedModel = options.model ? normalizeModelId(options.model) : undefined;
  // A benchmark states its policy explicitly (never the mode saved from the terminal UI), and Free never runs a
  // paid model under test either.
  const modelPolicy: ModelPolicy = parseModelPolicy(options.modelPolicy) ?? "free";
  const effectiveModelPolicy = modelPolicy;
  const apiKey = options.apiKey?.trim() || getApiKey();
  const baseURL = options.baseUrl?.trim() || getBaseURL() || OPENROUTER_BASE_URL;
  const budget = resolveBudget(options as CliOptions);
  const repository = collectRepositorySnapshot(process.cwd());
  const environment = collectBenchmarkEnvironment();
  recoverInterruptedBenchmarkRuns();
  const commonInput = {
    agentName,
    agentVersion: packageJson.version,
    model: requestedModel ?? null,
    modelProvider: isOpenRouterBaseURL(baseURL) ? "OpenRouter" : "OpenAI-compatible",
    repositoryCommit: repository.commit,
    repositoryDirty: repository.dirty,
    repositoryDiffHash: repository.diffHash,
    shelraVersion: packageJson.version,
    environment,
    seed: null,
    agentConfig: {
      harness: agentName === "shelra-autonomy" ? "autonomy-runtime" : "agent-chat",
      modelPolicy,
      effectiveModelPolicy,
      strictModel: Boolean(requestedModel),
      requestedModel: requestedModel ?? null,
      maxCostUsd: budget.maxSessionUsd ?? null,
      maxRequestCostUsd: budget.maxRequestUsd ?? null,
      ablation: ablations.length > 0 ? ablations.join(",") : "none",
      // A reference agent's own CLI decides its turn limit.
      ...(agentName === "shelra" ? { maxToolRounds } : {}),
    },
  } as const;

  let manifest: BenchmarkManifest;
  try {
    manifest = loadBenchmarkManifest(process.cwd(), manifestCandidate);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const invalidRun = createBenchmarkRun({
      workspace: process.cwd(),
      benchmarkVersion: "unconfigured",
      suite: options.suite?.trim() || "unconfigured",
      ...commonInput,
      benchmarkConfig: { manifestPath: resolveBenchmarkPath(process.cwd(), manifestCandidate) },
      taskCount: 0,
    });
    const finalized = finalizeBenchmarkRun({
      runId: invalidRun.runId,
      status: "invalid",
      failureReason: message,
    });
    printBenchJsonOrText(options.json === true, {
      run: finalized,
      message: `Benchmark run #${finalized.runNumber} was not executed: ${message}`,
      type: "run_finished",
    });
    process.exitCode = 1;
    return;
  }

  const resolvedManifestPath =
    typeof manifest.config?.manifestPath === "string" ? manifest.config.manifestPath : manifestCandidate;

  if (options.suite?.trim()) {
    manifest = { ...manifest, suite: options.suite.trim() };
  }

  // The key is resolved and the database is open (recoverInterruptedBenchmarkRuns), so HOME can move.
  const cleanRoom = options.cleanRoom !== false ? enterBenchCleanRoom() : null;
  if (cleanRoom && !options.json) console.log(`Clean room: ${cleanRoom.root}`);
  // Repeats are ordinary runs that share a group id, so history can put them back together.
  const repeatGroup = repeat > 1 ? `repeat_${Date.now().toString(36)}` : null;
  const outcomes: RepeatTaskOutcome[][] = [];
  const runIds: string[] = [];
  try {
    for (let index = 1; index <= repeat; index += 1) {
      const runOutcomes: RepeatTaskOutcome[] = [];
      outcomes.push(runOutcomes);
      const summary = await runBenchmark({
        workspace: process.cwd(),
        ...(cleanRoom ? { taskRoot: cleanRoom.taskRoot } : {}),
        manifest,
        runInput: {
          ...commonInput,
          benchmarkConfig: {
            manifestPath: resolvedManifestPath,
            cleanRoom: cleanRoom !== null,
            ...(repeatGroup ? { repeat: { group: repeatGroup, index, of: repeat } } : {}),
          },
        },
        onRunCreated: (run) => {
          if (options.json) {
            printBenchJson({ type: "run_created", run });
          } else {
            console.log(`Benchmark run #${run.runNumber} created (${run.runId})`);
            console.log(`  Shelra agent · ${manifest.suite} · ${manifest.benchmarkVersion}`);
          }
        },
        onEvent: (event) => {
          if (options.json) {
            printBenchJson({ type: "event", event });
          } else if (event.type !== "run_created") {
            console.log(`  ${event.message}`);
          }
        },
        onTask: (task) => {
          runOutcomes.push({
            taskId: task.taskId,
            passed: task.status === "passed",
            falseCompletion: task.behavior.falseCompletion === true,
          });
          if (options.json) {
            printBenchJson({ type: "task_finished", task });
          } else {
            console.log(
              `  ${task.taskId}: ${task.status}${task.durationMs === null ? "" : ` · ${formatDuration(task.durationMs)}`}`,
            );
          }
        },
        createExecutor: async ({ run, signal, emit }) => {
          if (agentName === "claude-code" || agentName === "codex") {
            // A reference agent on the same workspaces and oracle. Its model is its own CLI's name,
            // passed through untouched; without one, that CLI's configured default runs.
            const model = options.model?.trim() || undefined;
            updateBenchmarkRunMetadata(run.runId, {
              model: `${agentName}/${model ?? "default"}`,
              modelProvider: agentName === "claude-code" ? "Claude Code CLI" : "OpenAI Codex CLI",
            });
            emit({
              type: "note",
              message: `Reference agent ${agentName} ready${model ? ` with ${model}` : ""}`,
              payload: { agent: agentName },
            });
            const realHome = cleanRoom?.realHome ?? null;
            return agentName === "claude-code"
              ? createClaudeCodeExecutor({
                  ...(model ? { model } : {}),
                  benchmarkRoot: process.cwd(),
                  scratchDir: `${cleanRoom?.root ?? `${process.cwd()}/.shelra`}/claude-code`,
                  realHome,
                })
              : createCodexExecutor({ ...(model ? { model } : {}), benchmarkRoot: process.cwd(), realHome });
          }
          if (agentName !== "shelra" && agentName !== "shelra-autonomy") {
            throw new Error(
              `Agent adapter "${agentName}" is not registered yet. This run was retained as failed evidence.`,
            );
          }
          const providerOption = options.provider?.trim().toLowerCase();
          if (providerOption) {
            // Another free provider, for measuring beyond OpenRouter's daily free quota. The model is
            // strict like any benchmark model: no fallback may replace the measured variable.
            if (!isFreeProviderId(providerOption)) {
              throw new Error(`Unknown provider "${providerOption}". Use one of: ${FREE_PROVIDER_IDS.join(", ")}.`);
            }
            if (agentName !== "shelra") throw new Error("--provider runs the product path, `--agent shelra`.");
            // Naming the provider for the run is the explicit choice of its key.
            declareFreePlanForSession(providerOption);
            const preset = FREE_PROVIDERS[providerOption];
            const configured = requireFreeProvider(providerOption);
            const modelId = options.model?.trim() || (preset.models[0] as string);
            updateBenchmarkRunMetadata(run.runId, { model: `${preset.id}/${modelId}`, modelProvider: preset.name });
            emit({
              type: "note",
              message: `Shelra runtime ready with ${preset.name} ${modelId} (${preset.plan})`,
              payload: { agent: agentName, provider: preset.id },
            });
            return createAgentBenchmarkExecutor({
              provider: createFreeProvider(configured, modelId),
              modelId,
              benchmarkRoot: process.cwd(),
              budget,
              signal,
              maxToolRounds,
              ...(ablations.length > 0 ? { agentOptions: { ablate: ablations } } : {}),
            });
          }
          if (!apiKey) {
            throw new Error(
              "OpenRouter API key is required for a Shelra Bench run. Configure OPENROUTER_API_KEY or use `shelra auth openrouter <key>`.",
            );
          }
          if (!isOpenRouterBaseURL(baseURL)) {
            throw new Error(
              "Shelra Bench currently requires the OpenRouter model runtime; the configured base URL is not OpenRouter.",
            );
          }

          const catalog = await fetchOpenRouterCatalog({ apiKey, baseURL });
          primeCatalog(catalog.entries);
          const route = routeCatalogModel(catalog.entries, {
            requestedModel: requestedModel ?? (catalog.entries.length === 0 ? "openrouter/free" : undefined),
            policy: effectiveModelPolicy,
            requiresTools: true,
          });
          updateBenchmarkRunMetadata(run.runId, {
            model: route.modelId,
            modelProvider: "OpenRouter",
          });
          emit({
            type: "note",
            message: `Shelra runtime ready with ${route.modelId}`,
            payload: { agent: agentName, modelPolicy: effectiveModelPolicy },
          });
          if (agentName === "shelra-autonomy") {
            const intelligence = createOpenRouterIntelligenceProvider({
              apiKey,
              baseURL,
              entries: catalog.entries,
              policy: effectiveModelPolicy,
              modelId: route.modelId,
              strictModel: Boolean(requestedModel),
              maxCostUsd: budget.maxSessionUsd,
            });
            return createShelraBenchmarkExecutor({
              intelligence,
              benchmarkRoot: process.cwd(),
              maxCostUsd: budget.maxSessionUsd,
              maxRequestCostUsd: budget.maxRequestUsd,
              signal,
            });
          }
          // The product path: the same `Agent.processMessage()` loop interactive and `--prompt`
          // sessions run. An explicit `--model` is strict — no server-side fallback may silently
          // substitute another model into a measurement.
          const provider = createOpenRouterProvider(apiKey, {
            modelId: route.modelId,
            entries: catalog.entries,
            baseURL,
            fallbackModels: requestedModel ? [] : route.candidates.map((entry) => entry.id).slice(0, 3),
            requireParameters: true,
            policy: effectiveModelPolicy,
            strictModel: Boolean(requestedModel),
            // Free variants are rate-limited upstream (429 "temporarily rate-limited, retry shortly");
            // the SDK's exponential backoff needs more attempts than the paid default to ride it out.
            ...(route.modelId.endsWith(":free") ? { maxRetries: 6 } : {}),
          });
          return createAgentBenchmarkExecutor({
            provider,
            modelId: route.modelId,
            benchmarkRoot: process.cwd(),
            budget,
            signal,
            maxToolRounds,
            ...(ablations.length > 0 ? { agentOptions: { ablate: ablations } } : {}),
          });
        },
      });
      printBenchJsonOrText(options.json === true, {
        run: summary,
        type: "run_finished",
        message: `Benchmark run #${summary.runNumber} ${summary.status}`,
      });
      runIds.push(summary.runId);
      if (summary.status !== "completed") process.exitCode = 1;
      if (summary.status === "cancelled" || summary.status === "interrupted") break;
    }
  } finally {
    cleanRoom?.leave();
  }

  if (repeat > 1) {
    const repeatSummary = summarizeRepeats(outcomes);
    if (options.json) printBenchJson({ type: "repeat_summary", summary: repeatSummary });
    else for (const line of formatRepeatSummary(repeatSummary)) console.log(line);
  }

  // Every run joins the versioned history of the repository it ran from, cleaned of personal data.
  if (options.history !== false && runIds.length > 0 && existsSync(resolveBenchmarkPath(process.cwd(), HISTORY_FILE))) {
    try {
      const merged = appendRunsToHistory({
        repositoryRoot: process.cwd(),
        databasePath: getDatabasePath(),
        source: "shelra-bench",
        runIds,
      });
      if (options.json) printBenchJson({ type: "history_updated", added: merged.added, runs: merged.runs });
      else console.log(`History: ${merged.added} run(s) added to ${HISTORY_FILE} (${merged.runs} in all)`);
    } catch (error) {
      console.error(`History not updated: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

const HISTORY_FILE = "bench/history/benchmark-history.json";

function printBenchJsonOrText(json: boolean, value: { type: string; message: string; run: unknown }): void {
  if (json) {
    printBenchJson(value);
    return;
  }
  console.log(value.message);
  const run = value.run as { runId?: string; overall?: number } | undefined;
  if (run?.runId) console.log(`  Stored as ${run.runId}`);
}

function printBenchJson(value: unknown): void {
  process.stdout.write(
    `${JSON.stringify(value, (_key, item) => (item instanceof Date ? item.toISOString() : item))}\n`,
  );
}

function formatDuration(value: number): string {
  const totalSeconds = Math.max(0, Math.round(value / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${String(seconds).padStart(2, "0")}s` : `${seconds}s`;
}

function changeDirectoryOrExit(directory: string | undefined) {
  if (!directory) {
    return;
  }

  try {
    process.chdir(directory);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Cannot change to directory ${directory}: ${msg}`);
    process.exit(1);
  }
}

type CliOptions = Record<string, string | boolean | undefined>;

function stringOption(value: string | boolean | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function collect(value: string, prev: string[]): string[] {
  return [...prev, value];
}

function resolveCliSandboxMode(value: string | boolean | undefined): SandboxMode | undefined {
  if (value === true) return "shuru";
  if (value === false) return "off";
  return undefined;
}

async function runBackgroundDelegation(jobPath: string, options: CliOptions) {
  let output = "";
  let agent: Agent | undefined;
  let localSetup: { dispose: () => Promise<void> } | undefined;

  try {
    const delegation = await loadDelegation(jobPath);
    const apiKey = stringOption(options.apiKey) || getApiKey();
    const baseURL = stringOption(options.baseUrl) || getBaseURL() || OPENROUTER_BASE_URL;
    const explicitModel = stringOption(options.model) || delegation.model;
    const model = explicitModel ? normalizeModelId(explicitModel) : undefined;
    const maxToolRounds =
      parseInt(stringOption(options.maxToolRounds) || String(delegation.maxToolRounds), 10) || delegation.maxToolRounds;
    const sandboxMode = resolveCliSandboxMode(options.sandbox) || delegation.sandboxMode || getCurrentSandboxMode();
    const sandboxSettings = mergeSandboxSettings(getCurrentSandboxSettings(), delegation.sandboxSettings);
    const preferLocal = wantsLocal(options);
    const modelPolicy = resolveModelPolicy(options.modelPolicy);
    const budget = resolveBudget(options);
    agent = new Agent(preferLocal ? undefined : apiKey, preferLocal ? undefined : baseURL, model, maxToolRounds, {
      persistSession: false,
      sandboxMode,
      sandboxSettings,
      budget,
    });
    const savedCloudModel = !model ? savedProviderModel(agent.getModel()) : undefined;
    const requestedCloudModel = model || savedCloudModel;
    const remoteError = preferLocal ? undefined : getRemoteConfigurationError(apiKey, baseURL);
    if (remoteError) throw new Error(remoteError);
    if (preferLocal) {
      localSetup = await configureLocalProvider(agent, model, true, true);
    } else {
      await configureRemoteProvider(agent, apiKey!, baseURL, requestedCloudModel, modelPolicy, Boolean(model));
    }
    const result = await agent.runTaskRequest({
      agent: delegation.agent,
      description: delegation.description,
      prompt: delegation.prompt,
    });

    output = (result.output || "").trim();

    if (!result.success) {
      await failDelegation(jobPath, result.output || result.error || "Background delegation failed.", output);
      return;
    }

    await completeDelegation(jobPath, output, result.task?.summary);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    try {
      await failDelegation(jobPath, msg, output);
    } catch {
      // Best effort — background tasks should fail silently if persistence is unavailable.
    }
    process.exit(1);
  } finally {
    await Promise.all([agent?.cleanup(), localSetup?.dispose()]);
  }
}

function resolveConfig(options: CliOptions) {
  const apiKey = stringOption(options.apiKey) || getApiKey();
  const baseURL = stringOption(options.baseUrl) || getBaseURL() || OPENROUTER_BASE_URL;
  const explicitModel = stringOption(options.model);
  const model = explicitModel ? normalizeModelId(explicitModel) : undefined;
  const maxToolRounds = parseInt(stringOption(options.maxToolRounds) || "400", 10) || 400;
  const sandboxMode = resolveCliSandboxMode(options.sandbox) || getCurrentSandboxMode();

  const cliOverrides: SandboxSettings = {};
  if (options.allowNet === true) cliOverrides.allowNet = true;
  const allowHostValue = options.allowHost;
  if (Array.isArray(allowHostValue) && allowHostValue.length > 0) {
    cliOverrides.allowedHosts = allowHostValue as string[];
    if (!cliOverrides.allowNet) cliOverrides.allowNet = true;
  }
  const portValue = options.port;
  if (Array.isArray(portValue) && portValue.length > 0) {
    cliOverrides.ports = portValue as string[];
  }
  const sandboxSettings = mergeSandboxSettings(getCurrentSandboxSettings(), cliOverrides);
  const modelPolicy = resolveModelPolicy(options.modelPolicy);
  const budget = resolveBudget(options);
  const providerOption = stringOption(options.provider)?.toLowerCase();
  const knownProviders = createDefaultRegistry().list();
  if (providerOption && !knownProviders.some((definition) => definition.id === providerOption)) {
    throw new Error(`Unknown provider "${providerOption}". Use one of: ${knownProviders.map((d) => d.id).join(", ")}.`);
  }
  const provider = providerOption || undefined;

  // A model named for another provider (`--provider`) is that provider's id, not a default for the next session.
  // A local model is saved now; a cloud model once routing accepts it (`configureRemoteProvider`), so a paid model
  // Free mode refused never becomes the default another agent starts from.
  if (typeof options.model === "string" && !provider) {
    if (wantsLocal(options)) saveUserSettings({ defaultModel: normalizeModelId(options.model) });
    else pendingDefaultModel = normalizeModelId(options.model);
  }

  return {
    provider,
    apiKey,
    baseURL,
    model,
    maxToolRounds,
    sandboxMode,
    sandboxSettings,
    // Cloud Free is the product default. Local inference is still available
    // as an explicit privacy/offline mode through --local.
    preferLocal: wantsLocal(options),
    modelPolicy,
    budget,
  };
}

let warnedLocalDisabled = false;

/** `--local`, unless local models are switched off (`SHELRA_LOCAL_MODELS`): then it is said once and cloud routing is used. */
function wantsLocal(options: CliOptions): boolean {
  if (options.local !== true || options.remote === true) return false;
  if (localModelsEnabled()) return true;
  if (!warnedLocalDisabled) {
    warnedLocalDisabled = true;
    console.error("Local models are disabled for now, so --local is ignored and cloud routing is used.");
  }
  return false;
}

function resolveBudget(options: CliOptions): BudgetLimits {
  const maxSessionUsd = parseBudgetUsd(stringOption(options.maxCost) ?? process.env[MAX_SESSION_COST_ENV]);
  const maxRequestUsd = parseBudgetUsd(stringOption(options.maxRequestCost) ?? process.env[MAX_REQUEST_COST_ENV]);
  return {
    ...(maxSessionUsd === undefined ? {} : { maxSessionUsd }),
    ...(maxRequestUsd === undefined ? {} : { maxRequestUsd }),
  };
}

function requireApiKey(apiKey: string | undefined): string {
  if (!apiKey) {
    console.error(
      `Error: provider credentials required. Set OPENROUTER_API_KEY (or ${API_KEY_ENV}), use --api-key, or run \`${CLI_NAME} auth openrouter <key>\``,
    );
    process.exit(1);
  }

  return apiKey;
}

function parseHeadlessOutputFormat(value: string): HeadlessOutputFormat {
  if (isHeadlessOutputFormat(value)) {
    return value;
  }

  throw new InvalidArgumentError(`Invalid headless format "${value}". Expected "text" or "json".`);
}

program
  .name(CLI_NAME)
  .description(`${PRODUCT_NAME} — cloud-first coding agent built with Bun and OpenTUI`)
  .version(packageJson.version)
  .argument("[message...]", "Initial message to send")
  .option("-k, --api-key <key>", "Optional remote provider API key")
  .option("-u, --base-url <url>", "API base URL")
  .option("-m, --model <model>", "Model to use")
  .option("--remote", "Use the configured cloud provider (OpenRouter by default)")
  .option("--local", "Use the managed local model instead of cloud routing (disabled for now; SHELRA_LOCAL_MODELS=on)")
  .option(
    "--provider <id>",
    `Run a headless prompt (-p) on one provider: ${createDefaultRegistry()
      .list()
      .map((definition) => definition.id)
      .join(", ")} (its models are provider/model; -m names one)`,
  )
  .option(
    "--model-policy <policy>",
    "Model mode: free (free models only, the default) or mixed (any model, paid or free; OpenRouter's auto router when none is picked). Also auto, economy, balanced, quality or max. Without it, the mode saved in the terminal UI",
  )
  .option("--max-cost <usd>", "Maximum cumulative session spend in USD (0 is strict free-only)")
  .option("--max-request-cost <usd>", "Maximum conservative spend for one model request in USD")
  .option("-d, --directory <dir>", "Working directory", process.cwd())
  .option("-p, --prompt <prompt>", "Run a single prompt headlessly")
  .option("--autonomous", "Run a coding objective through implementation, execution, verification and repair")
  .option("--verify", "Run the built-in verify flow headlessly")
  .option("--format <format>", "Headless output format: text or json", parseHeadlessOutputFormat, "text")
  .option("--sandbox", "Run agent shell commands inside a Shuru sandbox")
  .option("--no-sandbox", "Run agent shell commands directly on the host")
  .option("--allow-net", "Enable network access inside the Shuru sandbox")
  .option("--allow-host <pattern>", "Restrict sandbox network to specific hosts (repeatable)", collect, [])
  .option("--port <mapping>", "Forward a host port to sandbox guest (HOST:GUEST, repeatable)", collect, [])
  .option("-s, --session <id>", "Continue a saved session by id, or use 'latest'")
  .option("--background-task-file <path>", "Run a persisted background delegation")
  .option("--max-tool-rounds <n>", "Max tool execution rounds", "400")
  .option("--append-system-prompt <text>", "Add instructions after Shelra's own system prompt (it is kept whole)")
  .option("--append-system-prompt-file <path>", "Add the text of a file after Shelra's own system prompt")
  .option(
    "--system-prompt-file <path>",
    "Replace the opening role paragraph of the system prompt with a file's text; the operating rules and every check the host enforces stay",
  )
  .option("--profile <name>", "Use a named prompt profile from .shelra/prompts or ~/.shelra/prompts")
  .option("--update", `Update ${CLI_NAME} to the latest version and exit`)
  .action(async (message: string[], options) => {
    if (options.update) {
      console.log("Checking for updates...");
      const result = await runUpdate(packageJson.version);
      console.log(result.output);
      process.exit(result.success ? 0 : 1);
    }

    changeDirectoryOrExit(options.directory);

    // A custom system prompt (src/extend/system-prompt.ts): checked before anything starts, so a missing file is a
    // clear error at the command line and not a silent no-op in the middle of a session.
    {
      const flags = {
        ...(typeof options.appendSystemPrompt === "string" ? { append: options.appendSystemPrompt } : {}),
        ...(typeof options.appendSystemPromptFile === "string" ? { appendFile: options.appendSystemPromptFile } : {}),
        ...(typeof options.systemPromptFile === "string" ? { file: options.systemPromptFile } : {}),
        ...(typeof options.profile === "string" ? { profile: options.profile } : {}),
      };
      if (Object.keys(flags).length > 0) {
        setSessionPromptFlags(flags);
        const problems = resolveSystemPrompt(process.cwd()).problems;
        if (problems.length > 0) {
          for (const problem of problems) console.error(`System prompt: ${problem}`);
          process.exit(1);
        }
      }
    }

    // A run with no person at the keyboard stops here without a valid account; the terminal UI asks to sign in.
    const account = await requireAccount(
      Boolean(options.backgroundTaskFile || options.prompt || options.autonomous || options.verify),
    );

    if (options.backgroundTaskFile) {
      await runBackgroundDelegation(options.backgroundTaskFile, options);
      return;
    }

    const config = resolveConfig(options);
    const providerError = freeProviderCliError({
      provider: config.provider,
      prompt: Boolean(options.prompt),
      autonomous: options.autonomous === true,
      verify: options.verify === true,
    });
    if (providerError) {
      console.error(providerError);
      process.exit(1);
    }

    if (options.autonomous) {
      if (options.verify) {
        console.error("--autonomous and --verify are mutually exclusive.");
        process.exit(1);
      }
      const objectivePrompt = options.prompt || (message.length > 0 ? message.join(" ") : undefined);
      if (!objectivePrompt) {
        console.error('--autonomous requires --prompt "..." or an initial message.');
        process.exit(1);
      }
      await runAutonomousHeadless(
        objectivePrompt,
        config.apiKey,
        config.baseURL,
        config.model,
        config.maxToolRounds,
        config.sandboxMode,
        config.sandboxSettings,
        options.format,
        config.modelPolicy,
        config.budget,
      );
      return;
    }

    if (options.verify) {
      const verifyError = getVerifyCliError({
        hasPrompt: Boolean(options.prompt),
        hasMessageArgs: message.length > 0,
        sandboxSupported: isShuruSupported(),
      });
      if (verifyError) {
        console.error(verifyError);
        process.exit(1);
      }

      await runHeadless(
        buildVerifyPrompt(process.cwd()),
        config.apiKey,
        config.baseURL,
        config.model,
        config.maxToolRounds,
        config.sandboxMode,
        config.sandboxSettings,
        options.format,
        options.session,
        config.preferLocal,
        config.modelPolicy,
        config.budget,
      );
      return;
    }

    if (options.prompt) {
      await runHeadless(
        options.prompt,
        config.apiKey,
        config.baseURL,
        config.model,
        config.maxToolRounds,
        config.sandboxMode,
        config.sandboxSettings,
        options.format,
        options.session,
        config.preferLocal,
        config.modelPolicy,
        config.budget,
        config.provider,
      );
      return;
    }

    const initialMessage = message.length > 0 ? message.join(" ") : undefined;
    await startInteractive(
      config.apiKey,
      config.baseURL,
      config.model,
      config.maxToolRounds,
      config.sandboxMode,
      config.sandboxSettings,
      options.session,
      initialMessage,
      config.preferLocal,
      config.modelPolicy,
      config.budget,
      account,
      Boolean(options.modelPolicy),
    );
  });

registerMcpCommands(program);

program
  .command("setup")
  .description("Inspect hardware, discover local runtimes, and choose a local model")
  .option("--non-interactive", "Print onboarding diagnostics without prompting")
  .option("-m, --model <model>", "Prefer a discovered local model")
  .action(async (options) => {
    await runOnboarding({
      requestedModel: typeof options.model === "string" ? options.model : undefined,
      interactive: options.nonInteractive !== true,
    });
  });

program
  .command("bench")
  .description("Run Shelra Bench and persist an immutable historical benchmark run")
  .option("--manifest <path>", "Benchmark manifest path", ".shelra/bench/manifest.json")
  .option("--suite <suite>", "Override the suite label for this run")
  .option(
    "--agent <name>",
    "Agent to evaluate: shelra (product chat path), shelra-autonomy, or a reference agent on the same tasks and oracle: claude-code, codex",
    "shelra",
  )
  .option("-m, --model <model>", "Model under test; keep this fixed when measuring harness changes")
  .option("--model-policy <policy>", "Routing policy: free, mixed, auto, economy, balanced, quality or max", "free")
  .option("-k, --api-key <key>", "OpenRouter API key")
  .option("-u, --base-url <url>", "OpenRouter API base URL")
  .option("--max-cost <usd>", "Maximum cumulative spend for the benchmark run")
  .option("--max-request-cost <usd>", "Maximum spend for one model request")
  .option("-d, --directory <dir>", "Working directory", process.cwd())
  .option("--json", "Print newline-delimited machine-readable run events")
  .option(
    "--repeat <k>",
    "Run the suite k times and report pass@1 with a 95% confidence interval, pass^k and false completions",
    "1",
  )
  .option(
    "--ablate <list>",
    "Switch harness subsystems off to measure what each adds (comma-separated): memory, gate, contract, ledger, audit, verifier, plan, skills, context, subagents, web, research, smoke, diagnose, or bare",
  )
  .option(
    "--no-clean-room",
    "Run the tasks under .shelra/bench/runs with your own settings, memory and skills, as runs before 2026-09-23 did",
  )
  .option("--no-history", "Do not add the runs to bench/history/benchmark-history.json")
  .option(
    "--provider <id>",
    `Run Shelra on another free provider with its own key: ${FREE_PROVIDER_IDS.join(", ")} (the model stays fixed)`,
  )
  .action(async (_options, command) => {
    // Commander assigns options shared with the root command (for example --model and
    // --max-cost) to the root even when they appear after `bench`. Merge both scopes so
    // benchmark controls are never silently discarded.
    const options = command.optsWithGlobals();
    changeDirectoryOrExit(options.directory);
    await runBenchCommand(options);
  });

program
  .command("telegram-bridge")
  .description("Start the Telegram remote-control bridge without opening the TUI")
  .option("-k, --api-key <key>", "Optional remote provider API key")
  .option("-u, --base-url <url>", "API base URL")
  .option("-m, --model <model>", "Model to use")
  .option("-d, --directory <dir>", "Working directory", process.cwd())
  .option("--sandbox", "Run agent shell commands inside a Shuru sandbox")
  .option("--no-sandbox", "Run agent shell commands directly on the host")
  .option("--max-tool-rounds <n>", "Max tool execution rounds", "400")
  .option("--log-file <path>", "Bridge log file", "telegram-remote-bridge.log")
  .option("--pair-code-file <path>", "Pairing code file", "telegram-pair-code.txt")
  .action(async (options) => {
    changeDirectoryOrExit(options.directory);
    await requireAccount(true);
    const config = resolveConfig(options);

    process.off("SIGTERM", exitCleanlyOnSigterm);
    try {
      await runTelegramHeadlessBridge({
        apiKey: requireApiKey(config.apiKey),
        baseURL: config.baseURL,
        model: config.model,
        maxToolRounds: config.maxToolRounds,
        sandboxMode: config.sandboxMode,
        sandboxSettings: config.sandboxSettings,
        logFile: options.logFile,
        pairCodeFile: options.pairCodeFile,
      });
    } finally {
      process.on("SIGTERM", exitCleanlyOnSigterm);
    }
  });

async function listModels(refresh = false, json = false): Promise<void> {
  const runtime = createRoutingRuntime();
  let local: LocalRuntimeDiscovery | null = null;
  try {
    await runtime.catalog.loadCached();
    await runtime.catalog.refresh({ force: refresh });
    local = await discoverLocalRuntimes(undefined, AbortSignal.timeout(60_000)).catch(() => null);
    const entries = runtime.catalog.snapshot().entries;
    primeCatalog(entries);
    const statuses = runtime.catalog.status();
    if (json) {
      console.log(
        JSON.stringify({
          local: local?.models ?? [],
          // Kept for tools that read the OpenRouter catalog from here.
          openrouter: entries.filter((entry) => entry.provider === "openrouter"),
          providers: Object.fromEntries(
            runtime.registry.list().map((definition) => [
              definition.id,
              {
                status: statuses.find((row) => row.providerId === definition.id),
                models: entries.filter((entry) => entry.provider === definition.id),
              },
            ]),
          ),
        }),
      );
      return;
    }
    console.log(`\n${PRODUCT_NAME} model catalog:\n`);
    const text = formatModelCatalog(runtime.registry, entries, loadFreeAttestations());
    if (text.trim() === "") {
      console.log("  no cloud models available: run `shelra providers` to see what is configured and why\n");
    } else {
      console.log(text);
    }
    for (const row of statuses.filter((item) => item.status === "unavailable" || item.status === "stale")) {
      console.log(
        `  ${row.name}: ${row.status === "stale" ? "showing the last known list" : "not answering"}${row.error ? ` (${row.error})` : ""}`,
      );
    }
    if (local?.models.length) {
      console.log("\n  LOCAL (SECONDARY / --local):");
      for (const model of local.models) {
        console.log(`    ${model.id} - ${model.name} (${formatContext(model.contextWindow)} context, free)`);
      }
    } else {
      console.log("\n  LOCAL (SECONDARY): no managed model is ready yet");
    }
    console.log();
  } finally {
    runtime.dispose();
    await disposeLocalRuntimes(local ?? undefined);
  }
}

const modelsCommand = program
  .command("models")
  .description("List the models of every configured provider, and local ones")
  .action(async (options) => {
    await listModels(options.refresh === true, options.json === true);
  });

modelsCommand
  .option("--refresh", "Refresh every provider's catalog")
  .option("--json", "Print machine-readable catalog data")
  .command("list")
  .description("List the models of every configured provider, and local ones")
  .option("--refresh")
  .option("--json")
  .action(async (options) => {
    await listModels(options.refresh === true, options.json === true);
  });

modelsCommand
  .command("refresh")
  .description("Refresh every provider's model catalog")
  .action(async () => {
    await listModels(true);
  });

modelsCommand
  .command("use <model>")
  .description("Persist an explicit model selection (provider/model; used in Mixed mode, Free mode chooses by itself)")
  .action(async (model: string) => {
    const runtime = createRoutingRuntime();
    try {
      await runtime.catalog.loadCached();
      await runtime.catalog.refresh();
      const ref = parseModelRef(model, runtime.registry.ids());
      const definition = runtime.registry.get(ref.providerId);
      if (
        !definition ||
        !runtime.registry.configured(runtime.resolveDeps()).some((item) => item.definition.id === ref.providerId)
      ) {
        console.error(
          `${definition?.name ?? ref.providerId} is not configured: ${definition?.setupHint ?? "see `shelra providers`"}.`,
        );
        process.exitCode = 1;
        return;
      }
      const known = runtime.catalog.entriesOf(ref.providerId);
      if (known.length > 0 && !known.some((entry) => entry.id.toLowerCase() === ref.canonical.toLowerCase())) {
        console.error(
          `Model "${ref.canonical}" is not in the ${definition.name} catalog. Run \`shelra models\` to list them.`,
        );
        process.exitCode = 1;
        return;
      }
      saveUserSettings({ defaultModel: ref.canonical });
      console.log(
        `Saved ${ref.canonical} as the default model (explicit selection). Mixed mode runs it; Free mode keeps choosing the best free model by itself.`,
      );
    } finally {
      runtime.dispose();
    }
  });

const providersCommand = program
  .command("providers")
  .description("Which model providers Shelra can use, and which of their models Free mode may run")
  .option("--refresh", "Ask every provider for its models again")
  .option("--json", "Print machine-readable status")
  .action(async (options) => {
    const runtime = createRoutingRuntime();
    try {
      await runtime.catalog.loadCached();
      await runtime.catalog.refresh({ force: options.refresh === true });
      const rows = buildProviderRows(
        runtime.registry,
        runtime.catalog.status(),
        runtime.catalog.snapshot().entries,
        loadFreeAttestations(),
      );
      if (options.json === true) {
        console.log(JSON.stringify({ mode: sessionModelPolicy(), providers: rows }));
        return;
      }
      console.log(`\n${formatProviderTable(rows)}\n`);
      console.log(
        "Free mode runs only models Shelra can show are free: a provider's own price of zero, or a free plan on a key you declared has no billing.",
      );
      console.log();
    } finally {
      runtime.dispose();
    }
  });

providersCommand
  .command("allow-free <provider> [patterns...]")
  .description(
    "Declare what Shelra cannot see: that a provider's key has no billing, or (for a gateway such as OmniRoute) which models are free, by name or prefix like 'opencode-free/*'",
  )
  .action((provider: string, patterns: string[]) => {
    const result = allowFree(createDefaultRegistry(), provider, patterns);
    (result.ok ? console.log : console.error)(result.message);
    if (!result.ok) process.exitCode = 1;
  });

providersCommand
  .command("deny-free <provider>")
  .description("Withdraw a declaration made with allow-free")
  .action((provider: string) => {
    const result = denyFree(createDefaultRegistry(), provider);
    (result.ok ? console.log : console.error)(result.message);
    if (!result.ok) process.exitCode = 1;
  });

program
  .command("objectives [id]")
  .description("List autonomous objectives or inspect a persisted specification and plan")
  .option("--json", "Print machine-readable objective data")
  .action((id: string | undefined, options: { json?: boolean }) => {
    changeDirectoryOrExit(stringOption(program.opts<CliOptions>().directory));
    const objectives = loadObjectives(process.cwd());

    if (!id) {
      if (options.json === true) {
        console.log(
          JSON.stringify(
            objectives.map((objective) => ({
              id: objective.id,
              request: objective.request,
              phase: objective.phase,
              stopReason: objective.stopReason,
              createdAt: objective.createdAt,
              updatedAt: objective.updatedAt,
              runDir: objective.runDir,
            })),
            null,
            2,
          ),
        );
      } else {
        console.log(formatObjectiveList(objectives));
      }
      return;
    }

    const objective = findObjective(objectives, id);
    if (!objective) {
      console.error(`Objective "${id}" was not found or is not a unique id prefix in ${process.cwd()}.`);
      process.exitCode = 1;
      return;
    }
    console.log(options.json === true ? JSON.stringify(objective, null, 2) : formatObjective(objective));
  });

program
  .command("decisions [action] [id]")
  .description(
    "List the project's decisions (docs/decisions), show, approve or reject one by id, or check that the active ones hold",
  )
  .option("--changed", "check: only the decisions covering a file changed in the working tree")
  .option("--hook <agent>", "check: answer as that agent's stop hook (claude-code)")
  .action(async (action: string | undefined, id: string | undefined, options: { changed?: boolean; hook?: string }) => {
    const { decisionsWorkspace, runDecisionsCli } = await import("./ledger/cli");
    // Claude Code runs hooks with the project in CLAUDE_PROJECT_DIR and their input as JSON on stdin.
    const workspace = decisionsWorkspace({
      hook: options.hook,
      projectDir: process.env.CLAUDE_PROJECT_DIR,
      explicitDirectory:
        program.getOptionValueSource("directory") === "cli"
          ? stringOption(program.opts<CliOptions>().directory)
          : undefined,
      cwd: process.cwd(),
    });
    changeDirectoryOrExit(workspace);
    const result = await runDecisionsCli(workspace, action, id, {
      changed: options.changed,
      hook: options.hook,
      readHookInput: () => (process.stdin.isTTY ? Promise.resolve(undefined) : readAll(process.stdin)),
    });
    if (result.stream === "stdout") console.log(result.output);
    else console.error(result.output);
    process.exitCode = result.exitCode;
  });

program
  .command("memory [action] [argument]")
  .description(
    'What Shelra remembers about this project and you: list, show <entry>, why "<request>" (what that request would be given, and why), stats, skills (proposed from what worked), promote <slug>, decline <slug>, consolidate (what sleep does for memory: recurring failures become lessons, unused notes fade)',
  )
  .option("--all", "list: include entries that are no longer current (superseded or archived)")
  .option("--previous <request>", "why: the request before this one, for a follow-up")
  .option("--full", "why: print the memory section exactly as the model would get it")
  .action(
    async (
      action: string | undefined,
      argument: string | undefined,
      options: { all?: boolean; previous?: string; full?: boolean },
    ) => {
      const { runMemoryCommand } = await import("./memory/cli");
      const directory =
        program.getOptionValueSource("directory") === "cli"
          ? stringOption(program.opts<CliOptions>().directory)
          : undefined;
      const result = runMemoryCommand(directory ?? process.cwd(), action, argument, options);
      if (result.exitCode === 0) console.log(result.output);
      else console.error(result.output);
      process.exitCode = result.exitCode;
    },
  );

program
  .command("sessions")
  .description("List saved conversations in this folder, newest first; continue one with `shelra -s <id>`")
  .option("--all", "list the conversations of every folder")
  .option("-n, --limit <n>", "how many to list", "20")
  .action(async (options: { all?: boolean; limit?: string }) => {
    const { SessionStore } = await import("./storage/index");
    const store = new SessionStore(process.cwd());
    const limit = Math.max(1, Number.parseInt(options.limit ?? "20", 10) || 20);
    const sessions = store.listSessions({ all: options.all === true, limit });
    if (sessions.length === 0) {
      console.log(
        options.all
          ? "No saved conversations yet."
          : "No saved conversations in this folder yet (`--all` lists every folder).",
      );
      return;
    }
    const stamp = (date: Date) => {
      const pad = (value: number) => String(value).padStart(2, "0");
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    };
    console.log(
      `${options.all ? "Saved conversations" : `Saved conversations in ${store.getWorkspace().canonicalPath}`}, newest first. Continue one with: ${CLI_NAME} -s <id>   (the latest here: ${CLI_NAME} -s latest)\n`,
    );
    for (const session of sessions) {
      const label = session.title ?? session.firstRequest ?? "(no message yet)";
      const line = `  ${session.id}  ${stamp(session.updatedAt)}  ${String(session.messages).padStart(4)} msgs  ${label}`;
      console.log(line.length > 150 ? `${line.slice(0, 149)}…` : line);
      if (options.all) console.log(`                ${session.workspace}`);
    }
  });

program
  .command("import [id]")
  .description(
    "Bring the chats Claude Code and Codex saved into Shelra, to continue them with /resume or `shelra -s <id>`: this folder's by default, or one chat by its id (from any folder)",
  )
  .option("--all", "the chats of every folder")
  .option("--list", "list the chats without importing them")
  .option("--from <agent>", "only one agent's chats: claude-code or codex")
  .action(async (id: string | undefined, options: { all?: boolean; list?: boolean; from?: string }) => {
    const { importForeignChat, listForeignChats, SOURCE_NAMES } = await import("./import/index");
    const from = options.from?.trim().toLowerCase();
    if (from && from !== "claude-code" && from !== "codex") {
      console.error(`--from takes claude-code or codex, not "${options.from}".`);
      process.exitCode = 1;
      return;
    }
    const cwd = process.cwd();
    const sources = from ? [from as "claude-code" | "codex"] : undefined;
    const wanted = id?.trim().toLowerCase();
    // An id names a chat in any folder; without one, this folder's (or every folder's) are the ones meant.
    const listed = listForeignChats({
      cwd,
      all: options.all === true || Boolean(wanted),
      sources,
      includeImported: true,
      limit: wanted ? 100_000 : 500,
    });
    const chats = wanted ? listed.filter((chat) => chat.sourceId.toLowerCase().startsWith(wanted)) : listed;
    const stamp = (date: Date) => date.toISOString().slice(0, 10);
    const label = (chat: (typeof chats)[number]) => {
      const line = `${chat.title ?? chat.firstRequest ?? "(untitled)"}`;
      return line.length > 70 ? `${line.slice(0, 69)}…` : line;
    };
    if (chats.length === 0) {
      console.log(
        wanted
          ? `No Claude Code or Codex chat has an id starting with "${id}".`
          : options.all
            ? "No Claude Code or Codex chats were found on this machine."
            : "No Claude Code or Codex chats were found for this folder (`--all` looks in every folder).",
      );
      return;
    }
    if (wanted && chats.length > 1) {
      console.log(`"${id}" starts ${chats.length} chats' ids; give more of it:`);
      for (const chat of chats.slice(0, 20))
        console.log(`  ${chat.sourceId}  ${SOURCE_NAMES[chat.source]}  ${label(chat)}`);
      process.exitCode = 1;
      return;
    }
    if (options.list) {
      console.log(`Chats from Claude Code and Codex${options.all ? "" : ` in ${cwd}`}, newest first:\n`);
      for (const chat of chats) {
        const state = chat.importedAs ? `imported as ${chat.importedAs}` : "not imported";
        console.log(
          `  ${chat.sourceId}  ${stamp(chat.updatedAt)}  ${SOURCE_NAMES[chat.source].padEnd(11)}  ${label(chat)}`,
        );
        console.log(`      ${state}${options.all && chat.cwd ? ` · ${chat.cwd}` : ""}`);
      }
      console.log(
        `\nImport one: ${CLI_NAME} import <id>   all of these: ${CLI_NAME} import${options.all ? " --all" : ""}`,
      );
      return;
    }
    let imported = 0;
    let lastId: string | null = null;
    for (const chat of chats) {
      try {
        const result = await importForeignChat(chat, { fallbackCwd: cwd });
        lastId = result.sessionId;
        if (!result.created) {
          console.log(`  already imported  ${result.sessionId}  ${SOURCE_NAMES[chat.source]}  ${label(chat)}`);
          continue;
        }
        imported += 1;
        const kept =
          result.summarized > 0 ? ` (the model reads the latest ${result.messages - result.summarized} in full)` : "";
        console.log(
          `  imported  ${result.sessionId}  ${SOURCE_NAMES[chat.source]}  ${result.messages} msgs${kept}  ${label(chat)}`,
        );
        if (result.folder !== chat.cwd)
          console.log(`      its folder ${chat.cwd ?? "(unknown)"} is gone; it belongs to ${result.folder}`);
      } catch (error) {
        console.log(`  not imported  ${chat.sourceId}  ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    console.log(
      `\n${imported} chat${imported === 1 ? "" : "s"} imported. Continue one with /resume, or ${CLI_NAME} -s ${lastId ?? "<id>"} in its folder.`,
    );
  });

program
  .command("trace [session]")
  .description(
    "Show what a session did, turn by turn, from its local trace (~/.shelra/logs/sessions): the latest session by default",
  )
  .option("--list", "list the recorded sessions, newest first")
  .option("--follow", "keep printing new events as the session goes on")
  .option("--watch", "print every session's new events live, including sessions started later")
  .option("--full", "print whole fields instead of one line each")
  .option("--json", "print the raw events")
  .option("--last <n>", "print only the last n events")
  .action(
    async (
      session: string | undefined,
      options: { list?: boolean; follow?: boolean; watch?: boolean; full?: boolean; json?: boolean; last?: string },
    ) => {
      const { formatTraceEvent, listTraces, newTraceEvents, readTrace, traceDir, traceSettings } = await import(
        "./utils/session-trace"
      );
      if (options.watch) {
        const settings = traceSettings();
        if (!settings) {
          console.error("Tracing is off (SHELRA_TRACE=off).");
          process.exitCode = 1;
          return;
        }
        // Start from what is already recorded, then print what every session adds.
        const seen = new Map<string, number>();
        newTraceEvents(seen, settings.dir);
        console.log(`Watching ${settings.dir} (every session; ctrl+c stops)`);
        for (;;) {
          for (const event of newTraceEvents(seen, settings.dir)) {
            console.log(options.json ? JSON.stringify(event) : formatTraceEvent(event, options.full === true, true));
          }
          await new Promise((resolveWait) => setTimeout(resolveWait, 500));
        }
      }
      const traces = listTraces();
      if (options.list) {
        for (const trace of traces.slice(0, 30)) {
          const events = readTrace(trace.path);
          const first = events.find((event) => event.kind === "turn");
          const turns = events.filter((event) => event.kind === "turn").length;
          console.log(
            `${trace.updatedAt.toISOString().slice(0, 19).replace("T", " ")}  ${trace.session}  ${turns} turn(s)  ${String(first?.cwd ?? "")}`,
          );
        }
        if (traces.length === 0) console.log(`No traces in ${traceDir() ?? "(tracing is off: SHELRA_TRACE=off)"}.`);
        return;
      }
      const trace = session ? traces.find((entry) => entry.session.startsWith(session)) : traces[0];
      if (!trace) {
        console.error(
          session ? `No trace for session ${session}.` : `No traces in ${traceDir() ?? "(tracing is off)"}.`,
        );
        process.exitCode = 1;
        return;
      }
      const print = (events: ReturnType<typeof readTrace>) => {
        for (const event of events)
          console.log(options.json ? JSON.stringify(event) : formatTraceEvent(event, options.full === true));
      };
      let events = readTrace(trace.path);
      const last = options.last ? Number.parseInt(options.last, 10) : undefined;
      if (!options.json) console.log(`Session ${trace.session} · ${trace.path}`);
      print(last && last > 0 ? events.slice(-last) : events);
      if (!options.follow) return;
      let seen = events.length;
      for (;;) {
        await new Promise((resolveWait) => setTimeout(resolveWait, 500));
        events = readTrace(trace.path);
        if (events.length > seen) print(events.slice(seen));
        seen = events.length;
      }
    },
  );

const authCommand = program.command("auth").description("Manage provider credentials in ~/.shelra/auth.json");
authCommand
  .command("openrouter <apiKey>")
  .description("Store an OpenRouter API key securely")
  .action((apiKey: string) => {
    saveOpenRouterApiKey(apiKey);
    console.log("OpenRouter API key saved. Key material is never printed or logged.");
  });

// Free providers: a session continues on them when OpenRouter's free models cannot serve a turn, and a
// benchmark can run on them with `--provider`.
for (const id of ["groq", "gemini"] as const) {
  const preset = FREE_PROVIDERS[id];
  authCommand
    .command(`${id} <apiKey>`)
    .description(`Store a ${preset.name} API key securely (${preset.plan})`)
    .action((apiKey: string) => {
      saveProviderCredential(id, { apiKey });
      console.log(`${preset.name} API key saved. Key material is never printed or logged.`);
      if (preset.privacy) console.log(`Note: ${preset.privacy}.`);
    });
}
authCommand
  .command("cloudflare <apiToken> [accountId]")
  .description(
    `Store a Cloudflare Workers AI API token securely (${FREE_PROVIDERS.cloudflare.plan}); its account id is found from the token, or pass it as a second argument`,
  )
  .action(async (first: string, second: string | undefined) => {
    // The id used to come first (`cloudflare <accountId> <apiToken>`); an account id is 32 hex characters, so either order works.
    const isAccountId = (value: string | undefined) => /^[0-9a-f]{32}$/iu.test(value ?? "");
    const swapped = isAccountId(first) && second !== undefined && !isAccountId(second);
    const apiToken = swapped ? (second as string) : first;
    const accountId = swapped ? first : second;
    const result = await createProviderAdmin().connect(
      "cloudflare",
      { apiKey: apiToken, ...(accountId ? { accountId } : {}) },
      { keepIfUnreachable: true },
    );
    if (!result.ok) {
      console.error(
        result.needs
          ? `${result.error}\nRun again with the account id: ${CLI_NAME} auth cloudflare <apiToken> <accountId>`
          : result.error,
      );
      process.exitCode = 1;
      return;
    }
    console.log(result.warning ?? "Cloudflare Workers AI credentials saved. Key material is never printed or logged.");
  });
// OmniRoute is a gateway the user runs: Shelra stores where it listens and, if it asks for one, its endpoint key. It
// never installs or starts it.
authCommand
  .command("omniroute [apiKey]")
  .description(
    `Connect OmniRoute with its key (Shelra's own gateway is the default). For a gateway you run yourself, give its address too (--url, a default install listens at ${OMNIROUTE_DEFAULT_BASE_URL})`,
  )
  .option("--url <url>", "Where your own OmniRoute listens")
  .action((apiKey: string | undefined, options: { url?: string }) => {
    const baseUrl = options.url?.trim();
    if (!baseUrl && !apiKey) {
      console.error(
        `Give OmniRoute's key: ${CLI_NAME} auth omniroute <apiKey> (or, for a gateway you run yourself, --url ${OMNIROUTE_DEFAULT_BASE_URL} [apiKey])`,
      );
      process.exitCode = 1;
      return;
    }
    if (baseUrl) {
      if (!isValidOmniRouteBaseURL(baseUrl)) {
        console.error(`"${baseUrl}" is not an http(s) address.`);
        process.exitCode = 1;
        return;
      }
      saveUserSettings({ omniroute: { baseUrl: normalizeOmniRouteBaseURL(baseUrl) } });
      console.log(
        `OmniRoute address saved: ${normalizeOmniRouteBaseURL(baseUrl)}. Shelra does not install or start OmniRoute.`,
      );
    }
    if (apiKey) {
      saveProviderCredential("omniroute", { apiKey });
      console.log("OmniRoute endpoint key saved. Key material is never printed or logged.");
    }
    console.log(
      `Free mode uses nothing from OmniRoute until you name models you know are free: ${CLI_NAME} providers allow-free omniroute '<provider>/<model>*'`,
    );
  });
// A stored provider key is a fallback of every session: removing it is how a person opts out.
authCommand
  .command("remove <provider>")
  .description(
    `Remove a stored key: ${createDefaultRegistry()
      .list()
      .map((definition) => definition.id)
      .join(", ")}`,
  )
  .action((provider: string) => {
    const id = provider.trim().toLowerCase();
    const registry = createDefaultRegistry();
    const definition = registry.get(id);
    if (!definition) {
      console.error(
        `Unknown provider "${provider}". Use one of: ${registry
          .list()
          .map((item) => item.id)
          .join(", ")}.`,
      );
      process.exitCode = 1;
      return;
    }
    if (id === "openrouter") clearOpenRouterApiKey();
    else clearProviderCredential(id);
    if (id === "omniroute") saveUserSettings({ omniroute: undefined });
    const envNames =
      id === "openrouter"
        ? ["OPENROUTER_API_KEY", "KEY_OPENROUTER"]
        : id === "omniroute"
          ? [OMNIROUTE_BASE_URL_ENV, OMNIROUTE_API_KEY_ENV]
          : isFreeProviderId(id)
            ? [...FREE_PROVIDERS[id].keyEnv]
            : [];
    const stillSet = envNames.filter((name) => process.env[name]?.trim());
    console.log(`Removed the stored ${definition.name} ${id === "omniroute" ? "address and key" : "key"}.`);
    if (stillSet.length > 0) console.log(`${stillSet.join(", ")} is still set in the environment and still wins.`);
  });

// The ShelraCode account (backend/). Only these commands reach the account service; the agent never does.
program
  .command("login")
  .description(
    "Sign in to your ShelraCode account: opens your browser to approve this machine (--email: a code by email)",
  )
  .option("--email [email]", "Sign in with a code sent by email instead of the browser (works over SSH)")
  .option("--api-url <url>", "Account service URL (development only; needs --web-url)")
  .option("--web-url <url>", "Website with the sign-in page (development only)")
  .option("--name <name>", "Name for this machine's login (default: shelra on <hostname>)")
  .action(async (options: { apiUrl?: string; webUrl?: string; email?: string | boolean; name?: string }) => {
    const { runLogin } = await import("./account/commands");
    process.exitCode = await runLogin(options);
  });

program
  .command("whoami")
  .description("Show the ShelraCode account this machine is connected to")
  .action(async () => {
    const { runWhoami } = await import("./account/commands");
    process.exitCode = await runWhoami();
  });

program
  .command("logout")
  .description("Revoke this machine's account token and remove it")
  .action(async () => {
    const { runLogout } = await import("./account/commands");
    process.exitCode = await runLogout();
  });

program
  .command("update")
  .description(`Update ${CLI_NAME} to the latest release`)
  .action(async () => {
    console.log("Checking for updates...");
    const result = await runUpdate(packageJson.version);
    console.log(result.output);
    process.exit(result.success ? 0 : 1);
  });

program
  .command("uninstall")
  .description(`Remove a script-installed ${CLI_NAME} binary and optional data`)
  .option("--dry-run", "Show what would be removed without removing it")
  .option("--force", "Skip the confirmation prompt")
  .option("--keep-config", `Keep ~/.${CONFIG_DIR_NAME.slice(1)} config files`)
  .option("--keep-data", `Keep ~/.${CONFIG_DIR_NAME.slice(1)} data files`)
  .action(async (options) => {
    const result = await runScriptManagedUninstall({
      dryRun: options.dryRun === true,
      force: options.force === true,
      keepConfig: options.keepConfig === true,
      keepData: options.keepData === true,
    });
    console.log(result.output);
    process.exit(result.success ? 0 : 1);
  });

const walletCommand = program.command("wallet").description("Manage the local x402 wallet and payment settings");

walletCommand
  .command("init")
  .description("Generate a new wallet keypair and enable payments for the selected chain")
  .option("--chain <chain>", "Wallet chain: base or base-sepolia", "base-sepolia")
  .action(async (options) => {
    const { WalletManager } = await import("./wallet/manager");
    const selectedChain = options.chain === "base" ? "base" : "base-sepolia";
    const wallet = new WalletManager();
    const data = wallet.init(selectedChain);
    const current = loadPaymentSettings();
    savePaymentSettings({
      enabled: true,
      chain: data.chain,
      approval: current.approval,
    });

    console.log("\nWallet initialized.");
    console.log(`  Address: ${data.address}`);
    console.log(`  Chain:   ${data.chain}`);
    console.log(`  Created: ${data.createdAt}`);
    console.log("\nPayments have been enabled in ~/.shelra/user-settings.json.");
  });

walletCommand
  .command("balance")
  .description("Show the current wallet balance")
  .action(async () => {
    const { WalletManager } = await import("./wallet/manager");
    const wallet = new WalletManager();
    const balance = await wallet.getBalance();
    console.log(`\nAddress: ${balance.address}`);
    console.log(`Chain:   ${balance.chain}`);
    console.log(`${balance.nativeSymbol}:     ${balance.nativeBalance}`);
    console.log(`USDC:    ${balance.usdcBalance}\n`);
  });

walletCommand
  .command("history")
  .description("Show recent x402 payment attempts")
  .option("--limit <n>", "Number of records to show", "20")
  .action(async (options) => {
    const { PaymentHistory } = await import("./payments/history");
    const limit = Number.parseInt(options.limit, 10) || 20;
    const history = new PaymentHistory().list(limit);

    if (history.length === 0) {
      console.log("\nNo payment history yet.\n");
      return;
    }

    console.log();
    for (const row of history) {
      console.log(`${row.createdAt}  ${row.status}`);
      console.log(`  ${row.method} ${row.url}`);
      console.log(`  ${row.amount} ${row.asset} on ${row.network}`);
      if (row.txHash) console.log(`  tx: ${row.txHash}`);
      console.log();
    }
  });

program
  .command("daemon")
  .description("Start the schedule daemon to run scheduled tasks")
  .option("--background", "Detach and run in the background")
  .action(async (options) => {
    if (options.background) {
      const result = await startScheduleDaemon(process.cwd());
      console.log(
        result.alreadyRunning
          ? `Schedule daemon already running (pid: ${result.status.pid ?? "unknown"}).`
          : `Schedule daemon started in the background (pid: ${result.pid ?? "unknown"}).`,
      );
      return;
    }

    process.off("SIGTERM", exitCleanlyOnSigterm);
    const { SchedulerDaemon } = await import("./daemon/scheduler");
    const daemon = new SchedulerDaemon();
    await daemon.start();
  });

// Skills, agents, hooks, instructions and the custom system prompt: the same commands as the terminal UI's slash
// commands, over the same services the model's own tools use (src/extend/commands.ts).
async function runExtensionCli(name: string, args: string[], options: { yes?: boolean } = {}): Promise<void> {
  changeDirectoryOrExit(stringOption(program.opts<CliOptions>().directory));
  const context = { root: projectRootFor(process.cwd()), cwd: process.cwd() };
  // Approving a hook lets a command from a repository file run on this machine: show it and ask first.
  if (name === "hooks" && args[0] === "approve" && options.yes !== true) {
    console.log(describeHooks(process.cwd()));
    if (!process.stdin.isTTY) {
      console.error(
        "\nApproving needs a person: run it in a terminal, or pass --yes to say you have read the commands above.",
      );
      process.exitCode = 1;
      return;
    }
    const { createInterface } = await import("node:readline/promises");
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = (await rl.question("\nApprove the pending hooks listed above? [y/N] ")).trim().toLowerCase();
    rl.close();
    if (answer !== "y" && answer !== "yes") {
      console.log("Nothing approved.");
      return;
    }
  }
  const result = await runExtensionCommand(context, name, args);
  if (result.output) console.log(result.output);
  if (!result.ok) process.exitCode = 1;
}

for (const [name, description] of [
  ["skills", "List, inspect, validate, switch and import skills (SKILL.md folders)"],
  ["agents", "List and inspect the agents defined for this project, and their recent runs"],
  ["hooks", "List hooks, approve the ones a repository defines, test one, see what ran"],
  ["instructions", "Show the instructions in force (SHELRA.md, rules, AGENTS.md) and where each comes from"],
  ["doctor", "Check skills, agents, hooks and instructions for problems and missing dependencies"],
  ["prompt", "Show the custom system prompt in force"],
  ["extensions", "What other agents left in this project (compat), and import it: `extensions import --apply`"],
] as const) {
  program
    .command(`${name} [args...]`)
    .description(description)
    .allowUnknownOption(true)
    .option("--yes", "hooks approve: say you have read the commands")
    .action(async (args: string[], options: { yes?: boolean }) => {
      await runExtensionCli(name, splitCommand(args.join(" ")).length > 0 ? args : [], options);
    });
}

await program.parseAsync();

function formatContext(tokens: number): string {
  if (tokens >= 1_048_576) return `${Math.round(tokens / 1_048_576)}M`;
  return `${Math.round(tokens / 1024)}K`;
}
