#!/usr/bin/env bun
import { existsSync } from "node:fs";
import type { KeyEvent } from "@opentui/core";
import { InvalidArgumentError, program } from "commander";
import * as dotenv from "dotenv";
import packageJson from "../package.json" with { type: "json" };
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
import { inspectHardware } from "./hardware/profile";
import {
  createHeadlessJsonlEmitter,
  type HeadlessOutputFormat,
  isHeadlessOutputFormat,
  renderHeadlessChunk,
  renderHeadlessPrelude,
} from "./headless/output";
import { createOpenRouterIntelligenceProvider } from "./intelligence";
import { type BudgetLimits, parseBudgetUsd } from "./models/budget";
import { normalizeModelId, primeCatalog } from "./models/catalog";
import { installLocalModel } from "./models/manager";
import { fetchOpenRouterCatalog, isOpenRouterBaseURL } from "./models/openrouter";
import type { ModelRecommendation } from "./models/recommendation";
import {
  isGuaranteedFree,
  type ModelPolicy,
  modelAfterModeChange,
  parseModelPolicy,
  resolveCatalogModel,
  routeCatalogModel,
  startupModelRequest,
} from "./models/routing";
import type { CatalogEntry } from "./models/types";
import { catalogEntryToModelInfo } from "./models/types";
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
import {
  configuredFreeProviders,
  createFreeProvider,
  FREE_PROVIDER_IDS,
  FREE_PROVIDERS,
  type FreeProviderId,
  freeProviderCliError,
  freeProviderFallbackSources,
  isFreeProviderId,
  requireFreeProvider,
} from "./providers/free-providers";
import { createOpenRouterProvider } from "./providers/openrouter";
import { selectLocalRoute } from "./router/local-first";
import { installManagedRuntime, resolveRuntimeInstallPlan } from "./runtimes/bootstrap";
import { discoverLocalRuntimes, disposeLocalRuntimes } from "./runtimes/discovery";
import type { LocalModelCandidate, LocalRuntimeDiscovery } from "./runtimes/types";
import {
  clearOpenRouterApiKey,
  clearProviderCredential,
  saveOpenRouterApiKey,
  saveProviderCredential,
} from "./security/credentials";
import { runOnboarding } from "./setup/onboarding";
import { startInstalledLocalModel } from "./startup/local-fallback";
import { probeLocalModel, runStartup } from "./startup/orchestrator";
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
import { runScriptManagedUninstall } from "./utils/install-manager";
import {
  getApiKey,
  getBaseURL,
  getCurrentSandboxMode,
  getCurrentSandboxSettings,
  listOpenRouterApiKeys,
  loadPaymentSettings,
  loadUserSettings,
  mergeSandboxSettings,
  type SandboxMode,
  type SandboxSettings,
  savePaymentSettings,
  saveUserSettings,
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
  modelId: string;
  selectModel: (modelId: string) => Promise<{ success: boolean; error?: string }>;
  /** The session's model mode, and a way to switch it (Free runs free models only; Mixed any model). */
  policy: ModelPolicy;
  setPolicy?: (policy: ModelPolicy) => Promise<{ success: boolean; error?: string; modelId?: string }>;
}

/** The session's model mode: the flag when one is given, else the mode saved from the terminal UI, else Free. */
function resolveModelPolicy(flag: unknown): ModelPolicy {
  const explicit = parseModelPolicy(typeof flag === "string" ? flag : undefined);
  if (explicit) return explicit;
  return parseModelPolicy(loadUserSettings().modelMode) ?? "free";
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
 * A session on a free provider the user chose (`--provider`): its default model unless one is named.
 * When it cannot serve a turn, the other configured free providers take over, then OpenRouter Free.
 */
function configureFreeProviderSession(agent: Agent, id: FreeProviderId, model: string | undefined): void {
  const preset = FREE_PROVIDERS[id];
  const configured = requireFreeProvider(id);
  const modelId = model?.trim() || (preset.models[0] as string);
  agent.setProvider(createFreeProvider(configured, modelId), modelId);
  const others = configuredFreeProviders().filter((provider) => provider.preset.id !== id);
  // One chain for both failures, so each provider is tried once per session whichever way it is reached;
  // a rejected key ends on an installed local model only once that chain is spent.
  const next = credentialFallbackChain([...freeProviderFallbackSources(others), ...openRouterFreeFallbackSources()]);
  agent.setProviderFallback(next);
  agent.setCredentialFallback(thenFallback(next, installedLocalModelFallback));
}

async function configureRemoteProvider(
  agent: Agent,
  apiKey: string,
  baseURL: string,
  requestedModel: string | undefined,
  policy: ModelPolicy,
  explicitModelSelection = false,
): Promise<RemoteModelSetup> {
  if (!isOpenRouterBaseURL(baseURL)) {
    agent.setApiKey(apiKey, baseURL);
    // A key this endpoint rejects: continue on OpenRouter Free with a configured OpenRouter key,
    // then on an installed local model. Free, so no spend is started without the user.
    // No model of this endpoint can serve the turn: continue on a free provider the user configured, as an
    // OpenRouter session does, then on OpenRouter Free. One OpenRouter Free chain serves both failures, so it
    // is tried once per session whichever reaches it first.
    const openRouterFree = credentialFallbackChain(openRouterFreeFallbackSources());
    agent.setCredentialFallback(thenFallback(openRouterFree, installedLocalModelFallback));
    agent.setProviderFallback(
      thenFallback(credentialFallbackChain(freeProviderFallbackSources(configuredFreeProviders())), openRouterFree),
    );
    return {
      models: [],
      catalog: [],
      modelId: agent.getModel(),
      selectModel: async () => ({ success: false, error: "Model selection is unavailable for this endpoint." }),
      policy,
    };
  }

  const catalog = await fetchOpenRouterCatalog({ apiKey, baseURL });
  // The mode can change during the session (ctrl+f or /mode in the terminal UI); every route reads it here.
  let activePolicy = policy;
  const canUseFreeRouterWithoutCatalog =
    policy === "free" && (!explicitModelSelection || requestedModel === "openrouter/free");
  if (catalog.entries.length === 0 && !canUseFreeRouterWithoutCatalog) {
    throw new Error(catalog.error ?? "OpenRouter returned no usable models. Try again with network access.");
  }
  primeCatalog(catalog.entries);
  // The key the session runs on; a rejected key's fallback replaces it, and the model picker follows.
  let activeApiKey = apiKey;
  // The model the session chose on OpenRouter (at startup or in the picker), paid or not.
  let chosenModelId = "";

  const selectModel = async (modelId: string): Promise<{ success: boolean; error?: string }> => {
    try {
      // A model picked in the picker runs in Mixed mode whatever it costs; Free mode refuses a paid one.
      const route = routeCatalogModel(catalog.entries, {
        requestedModel: modelId,
        policy: activePolicy,
        requiresTools: true,
      });
      const provider = createOpenRouterProvider(activeApiKey, {
        modelId: route.modelId,
        entries: catalog.entries,
        baseURL,
        // OpenRouter currently accepts at most three model ids in its
        // server-side fallback array.
        fallbackModels: route.candidates.map((entry) => entry.id).slice(0, 3),
        requireParameters: true,
        policy: activePolicy,
      });
      agent.setProvider(provider, route.modelId);
      chosenModelId = route.modelId;
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  };

  // An explicit model or a still-free saved preference wins. Otherwise the free policy picks the most
  // capable free model, with the free router as the last fallback (see startupModelRequest).
  const effectiveRequestedModel = startupModelRequest(catalog.entries, {
    requestedModel,
    policy,
    explicitModelSelection,
  });
  const route = routeCatalogModel(catalog.entries, {
    // The free router is a real OpenRouter model endpoint and remains usable
    // when catalog discovery is temporarily unavailable. A stale paid saved
    // preference is ignored under strict Free policy; it is never a spending
    // approval and must not block the cloud-first startup.
    requestedModel: effectiveRequestedModel,
    policy,
    requiresTools: true,
  });
  const provider = createOpenRouterProvider(apiKey, {
    modelId: route.modelId,
    entries: catalog.entries,
    baseURL,
    fallbackModels: route.candidates.map((entry) => entry.id).slice(0, 3),
    requireParameters: true,
    policy,
  });
  agent.setProvider(provider, route.modelId);
  chosenModelId = route.modelId;
  // Another key keeps the model it is handed only when the session chose that model or it is free here: an
  // id handed over from elsewhere (a model another provider was serving) can name a paid model on
  // OpenRouter, which nobody approved. Otherwise the session's own choice, or the free router under the free
  // policy.
  const fallbackModel = (modelId: string): string => {
    const entry = resolveCatalogModel(catalog.entries, modelId);
    if (modelId === chosenModelId || modelId === "openrouter/free" || (entry && isGuaranteedFree(entry)))
      return modelId;
    return activePolicy === "free" && !explicitModelSelection ? "openrouter/free" : chosenModelId;
  };
  // A key OpenRouter rejects: continue with another OpenRouter key the user configured (a stale
  // environment variable next to a newer saved key), on the same model and policy, then on an
  // installed local model.
  agent.setCredentialFallback(
    credentialFallbackChain([
      ...listOpenRouterApiKeys()
        .filter((entry) => entry.key !== apiKey)
        .map(
          ({ key, source }): CredentialFallbackSource =>
            async (request) => {
              activeApiKey = key;
              const modelId = fallbackModel(request.modelId);
              return {
                provider: createOpenRouterProvider(key, {
                  modelId,
                  entries: catalog.entries,
                  baseURL,
                  fallbackModels: route.candidates.map((entry) => entry.id).slice(0, 3),
                  requireParameters: true,
                  policy: activePolicy,
                }),
                modelId,
                label: `the OpenRouter key from ${source}`,
              };
            },
        ),
      installedLocalModelFallback,
    ]),
  );
  // No OpenRouter model can serve the turn (the day's free quota spent, none answering): continue on
  // another free provider the user configured (Groq, Gemini, Cloudflare), whose notice states its plan.
  agent.setProviderFallback(credentialFallbackChain(freeProviderFallbackSources(configuredFreeProviders())));
  // Switching the mode: Mixed keeps the current model (nothing is spent until the user picks a paid one or the
  // turn falls back to the auto router); Free leaves a paid model for the best free one. The choice is saved.
  const setPolicy = async (next: ModelPolicy): Promise<{ success: boolean; error?: string; modelId?: string }> => {
    activePolicy = next;
    saveUserSettings({ modelMode: next === "free" ? "free" : "mixed" });
    const result = await selectModel(modelAfterModeChange(catalog.entries, chosenModelId, next));
    return { ...result, modelId: chosenModelId };
  };
  return {
    models: catalog.entries.map(catalogEntryToModelInfo),
    catalog: catalog.entries,
    modelId: route.modelId,
    selectModel,
    policy,
    setPolicy,
  };
}

function exitAfterRuntimeCleanup(code: number): void {
  void releaseTrackedLocalRuntimes().finally(() => process.exit(code));
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
  const savedCloudModel = !model && agent.getModel().startsWith("openrouter/") ? agent.getModel() : undefined;
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
          onSelectLocalModel: onSelectModel ?? (preferLocal ? prepareLocalModel : undefined),
          onApiKey: !preferLocal ? configureRemoteApiKey : undefined,
          ...modes,
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
        modelPolicy,
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

  initializeLocal = async () => {
    if (initializing || installing) return;
    initializing = true;
    if (!preferLocal) {
      renderCloudStartup({
        state: "detecting-models",
        message: "Connecting to OpenRouter",
        detail: "The primary route is Free cloud models. Local inference remains available with --local.",
      });
      if (!currentApiKey) {
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
      message: "Preparing OpenRouter Free mode",
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

/** Explains what a `--remote` run is missing before any turn is attempted. */
function getRemoteConfigurationError(apiKey: string | undefined, baseURL: string): string | undefined {
  if (!apiKey) {
    return `Cloud mode needs an OpenRouter API key. Set OPENROUTER_API_KEY, run \`${CLI_NAME} auth openrouter <key>\`, or pass --api-key. Use --local for local inference.`;
  }
  if (!baseURL) {
    return `Cloud mode needs a provider URL. Set SHELRA_BASE_URL or pass --base-url.`;
  }
  return undefined;
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
  freeProvider?: FreeProviderId,
) {
  if (freeProvider) {
    const agent = new Agent(undefined, undefined, model, maxToolRounds, {
      session,
      sandboxMode,
      sandboxSettings,
      budget,
    });
    try {
      configureFreeProviderSession(agent, freeProvider, model);
    } catch (error) {
      process.stderr.write(
        `ShelraCode could not configure ${FREE_PROVIDERS[freeProvider].name}: ${error instanceof Error ? error.message : String(error)}\n`,
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
  const savedCloudModel = !model && agent.getModel().startsWith("openrouter/") ? agent.getModel() : undefined;
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
  const savedCloudModel = !model && agent.getModel().startsWith("openrouter/") ? agent.getModel() : undefined;
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
    const intelligence = createOpenRouterIntelligenceProvider({
      apiKey,
      baseURL,
      entries: remote.catalog,
      policy: modelPolicy,
      modelId: remote.modelId,
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
    const preferLocal = options.local === true && options.remote !== true;
    const modelPolicy = resolveModelPolicy(options.modelPolicy);
    const budget = resolveBudget(options);
    agent = new Agent(preferLocal ? undefined : apiKey, preferLocal ? undefined : baseURL, model, maxToolRounds, {
      persistSession: false,
      sandboxMode,
      sandboxSettings,
      budget,
    });
    const savedCloudModel = !model && agent.getModel().startsWith("openrouter/") ? agent.getModel() : undefined;
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
  if (providerOption && !isFreeProviderId(providerOption)) {
    throw new Error(`Unknown provider "${providerOption}". Use one of: ${FREE_PROVIDER_IDS.join(", ")}.`);
  }
  const freeProvider = providerOption && isFreeProviderId(providerOption) ? providerOption : undefined;

  // A model named for another provider (`--provider`) is that provider's id, not a default for the next session.
  if (typeof options.model === "string" && !freeProvider) {
    saveUserSettings({ defaultModel: normalizeModelId(options.model) });
  }

  return {
    freeProvider,
    apiKey,
    baseURL,
    model,
    maxToolRounds,
    sandboxMode,
    sandboxSettings,
    // Cloud Free is the product default. Local inference is still available
    // as an explicit privacy/offline mode through --local.
    preferLocal: options.local === true && options.remote !== true,
    modelPolicy,
    budget,
  };
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
  .option("--local", "Use the managed local model instead of cloud routing")
  .option(
    "--provider <id>",
    `Run a headless prompt (-p) on another free provider with its own key: ${FREE_PROVIDER_IDS.join(", ")}`,
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
  .option("--update", `Update ${CLI_NAME} to the latest version and exit`)
  .action(async (message: string[], options) => {
    if (options.update) {
      console.log("Checking for updates...");
      const result = await runUpdate(packageJson.version);
      console.log(result.output);
      process.exit(result.success ? 0 : 1);
    }

    changeDirectoryOrExit(options.directory);

    if (options.backgroundTaskFile) {
      await runBackgroundDelegation(options.backgroundTaskFile, options);
      return;
    }

    const config = resolveConfig(options);
    const providerError = freeProviderCliError({
      provider: config.freeProvider,
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
        config.freeProvider,
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
    );
  });

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
    "Switch harness subsystems off to measure what each adds (comma-separated): memory, gate, contract, audit, plan, skills, context, subagents, web, or bare",
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
  const remote = await fetchOpenRouterCatalog({
    apiKey: getApiKey(),
    baseURL: getBaseURL() || undefined,
    ...(refresh ? { ttlMs: 0 } : {}),
  });
  const local = await discoverLocalRuntimes(undefined, AbortSignal.timeout(60_000)).catch(() => null);
  primeCatalog(remote.entries);
  try {
    if (json) {
      console.log(
        JSON.stringify({
          local: local?.models ?? [],
          openrouter: remote.entries,
          source: remote.source,
          error: remote.error,
        }),
      );
      return;
    }
    console.log(`\n${PRODUCT_NAME} model catalog:\n`);
    console.log("  OPENROUTER (PRIMARY / FREE DEFAULT):");
    if (remote.entries.length === 0) {
      console.log(`    no cloud metadata available${remote.error ? ` (${remote.error})` : ""}`);
    } else {
      const displayEntries = [...remote.entries].sort(
        (a, b) => Number(b.cost.free) - Number(a.cost.free) || a.name.localeCompare(b.name),
      );
      for (const entry of displayEntries.slice(0, 100)) {
        const keyState = entry.state.kind === "cloud" && !entry.state.apiKeyConfigured ? ", needs API key" : "";
        const price =
          entry.cost.pricingKnown === false
            ? "price unknown; not Free-policy eligible"
            : entry.cost.free
              ? "free"
              : `$${(entry.cost.prompt * 1_000_000).toFixed(2)}/M input`;
        const capabilities = [
          entry.capabilities.tools ? "tools" : undefined,
          entry.capabilities.reasoning ? "reasoning" : undefined,
          entry.capabilities.vision ? "vision" : undefined,
        ]
          .filter(Boolean)
          .join(", ");
        console.log(
          `    ${entry.id} - ${entry.name} (${price}, ${formatContext(entry.contextWindow)} context${capabilities ? `, ${capabilities}` : ""}${keyState})`,
        );
      }
      if (displayEntries.length > 100)
        console.log(`    ... and ${displayEntries.length - 100} more; use --json for the full catalog`);
      console.log(`    catalog source: ${remote.source}`);
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
    await disposeLocalRuntimes(local ?? undefined);
  }
}

const modelsCommand = program
  .command("models")
  .description("List discovered local and OpenRouter models")
  .action(async (options) => {
    await listModels(options.refresh === true, options.json === true);
  });

modelsCommand
  .option("--refresh", "Refresh the OpenRouter catalog")
  .option("--json", "Print machine-readable catalog data")
  .command("list")
  .description("List discovered local and OpenRouter models")
  .option("--refresh")
  .option("--json")
  .action(async (options) => {
    await listModels(options.refresh === true, options.json === true);
  });

modelsCommand
  .command("refresh")
  .description("Refresh the OpenRouter model catalog")
  .action(async () => {
    await listModels(true);
  });

modelsCommand
  .command("use <model>")
  .description("Persist an explicit model selection")
  .action(async (model: string) => {
    const remote = await fetchOpenRouterCatalog({ apiKey: getApiKey(), baseURL: getBaseURL() || undefined, ttlMs: 0 });
    const route = routeCatalogModel(remote.entries, {
      requestedModel: model,
      requiresTools: true,
      policy: "custom",
    });
    saveUserSettings({ defaultModel: route.modelId });
    console.log(`Saved ${route.modelId} as the default model (explicit selection).`);
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
  .command("cloudflare <accountId> <apiToken>")
  .description(`Store a Cloudflare Workers AI account id and API token securely (${FREE_PROVIDERS.cloudflare.plan})`)
  .action((accountId: string, apiToken: string) => {
    saveProviderCredential("cloudflare", { apiKey: apiToken, accountId });
    console.log("Cloudflare Workers AI credentials saved. Key material is never printed or logged.");
  });
// A stored free provider is a fallback of every session: removing its key is how a person opts out.
authCommand
  .command("remove <provider>")
  .description(`Remove a stored key: openrouter, ${FREE_PROVIDER_IDS.join(", ")}`)
  .action((provider: string) => {
    const id = provider.trim().toLowerCase();
    if (id === "openrouter") clearOpenRouterApiKey();
    else if (isFreeProviderId(id)) clearProviderCredential(id);
    else {
      console.error(`Unknown provider "${provider}". Use openrouter or one of: ${FREE_PROVIDER_IDS.join(", ")}.`);
      process.exitCode = 1;
      return;
    }
    const name = id === "openrouter" ? "OpenRouter" : FREE_PROVIDERS[id as FreeProviderId].name;
    const envNames =
      id === "openrouter" ? ["OPENROUTER_API_KEY", "KEY_OPENROUTER"] : FREE_PROVIDERS[id as FreeProviderId].keyEnv;
    const stillSet = envNames.filter((name) => process.env[name]?.trim());
    console.log(`Removed the stored ${name} key.`);
    if (stillSet.length > 0) console.log(`${stillSet.join(", ")} is still set in the environment and still wins.`);
  });

// The ShelraCode account (backend/). Only these commands reach the account service; the agent never does.
program
  .command("login")
  .description("Connect this machine to your ShelraCode account with a code sent by email")
  .requiredOption(
    "--api-url <url>",
    "Account service URL (no public service is deployed yet; a local backend/ listens on http://localhost:3001)",
  )
  .option("--email <email>", "Account email (asked when omitted)")
  .option("--name <name>", "Name for this machine's token (default: shelra on <hostname>)")
  .action(async (options: { apiUrl: string; email?: string; name?: string }) => {
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

await program.parseAsync();

function formatContext(tokens: number): string {
  if (tokens >= 1_048_576) return `${Math.round(tokens / 1_048_576)}M`;
  return `${Math.round(tokens / 1024)}K`;
}
