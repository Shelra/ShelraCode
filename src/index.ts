#!/usr/bin/env bun
import type { KeyEvent } from "@opentui/core";
import { InvalidArgumentError, program } from "commander";
import * as dotenv from "dotenv";
import packageJson from "../package.json" with { type: "json" };
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
import { collectBenchmarkEnvironment, collectRepositorySnapshot, resolveBenchmarkPath } from "./bench/environment";
import { loadBenchmarkManifest } from "./bench/manifest";
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
import { type ModelPolicy, routeCatalogModel, startupModelRequest } from "./models/routing";
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
import { createOpenRouterProvider } from "./providers/openrouter";
import { selectLocalRoute } from "./router/local-first";
import { installManagedRuntime, resolveRuntimeInstallPlan } from "./runtimes/bootstrap";
import { discoverLocalRuntimes, disposeLocalRuntimes } from "./runtimes/discovery";
import type { LocalModelCandidate, LocalRuntimeDiscovery } from "./runtimes/types";
import { saveOpenRouterApiKey } from "./security/credentials";
import { runOnboarding } from "./setup/onboarding";
import { probeLocalModel, runStartup } from "./startup/orchestrator";
import type { StartupProgress, StartupResult } from "./startup/types";
import {
  createBenchmarkRun,
  finalizeBenchmarkRun,
  recoverInterruptedBenchmarkRuns,
  updateBenchmarkRunMetadata,
} from "./storage/benchmarks";
import { runTelegramHeadlessBridge } from "./telegram/headless-bridge";
import { startScheduleDaemon } from "./tools/schedule";
import type { ModelInfo } from "./types/index";
import { processAtMentions } from "./utils/at-mentions.js";
import { runScriptManagedUninstall } from "./utils/install-manager";
import {
  getApiKey,
  getBaseURL,
  getCurrentSandboxMode,
  getCurrentSandboxSettings,
  loadPaymentSettings,
  mergeSandboxSettings,
  type SandboxMode,
  type SandboxSettings,
  savePaymentSettings,
  saveUserSettings,
} from "./utils/settings";
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
    return {
      models: [],
      catalog: [],
      modelId: agent.getModel(),
      selectModel: async () => ({ success: false, error: "Model selection is unavailable for this endpoint." }),
    };
  }

  const catalog = await fetchOpenRouterCatalog({ apiKey, baseURL });
  const canUseFreeRouterWithoutCatalog =
    policy === "free" && (!explicitModelSelection || requestedModel === "openrouter/free");
  if (catalog.entries.length === 0 && !canUseFreeRouterWithoutCatalog) {
    throw new Error(catalog.error ?? "OpenRouter returned no usable models. Try again with network access.");
  }
  primeCatalog(catalog.entries);

  const selectModel = async (modelId: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const route = routeCatalogModel(catalog.entries, {
        requestedModel: modelId,
        policy,
        // Choosing a concrete model in the picker is an explicit opt-in, including a paid model.
        allowPaid: true,
        requiresTools: true,
      });
      const provider = createOpenRouterProvider(apiKey, {
        modelId: route.modelId,
        entries: catalog.entries,
        baseURL,
        // OpenRouter currently accepts at most three model ids in its
        // server-side fallback array.
        fallbackModels: route.candidates.map((entry) => entry.id).slice(0, 3),
        requireParameters: true,
        policy,
      });
      agent.setProvider(provider, route.modelId);
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
    // A persisted model is a preference, not a fresh spending approval. Only
    // a model supplied in this invocation may override strict Free policy.
    allowPaid: explicitModelSelection,
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
  return {
    models: catalog.entries.map(catalogEntryToModelInfo),
    catalog: catalog.entries,
    modelId: route.modelId,
    selectModel,
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
  ) => {
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
      renderApp([], remote.models, remote.selectModel);
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
        renderApp([], remote.models, remote.selectModel);
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
) {
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
    await Promise.all([agent.cleanup(), localSetup?.dispose()]);
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
}): Promise<void> {
  const manifestCandidate = options.manifest || ".shelra/bench/manifest.json";
  const agentName = ((options.agent || "shelra").trim() || "shelra").toLowerCase();
  const requestedModel = options.model ? normalizeModelId(options.model) : undefined;
  const rawPolicy = (options.modelPolicy || "free").trim().toLowerCase();
  const supportedPolicies: ModelPolicy[] = ["free", "auto", "economy", "balanced", "quality", "max", "custom"];
  const modelPolicy: ModelPolicy = supportedPolicies.includes(rawPolicy as ModelPolicy)
    ? (rawPolicy as ModelPolicy)
    : "free";
  const effectiveModelPolicy = requestedModel && modelPolicy === "free" ? "custom" : modelPolicy;
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

  const summary = await runBenchmark({
    workspace: process.cwd(),
    manifest,
    runInput: {
      ...commonInput,
      benchmarkConfig: { manifestPath: resolvedManifestPath },
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
      if (options.json) {
        printBenchJson({ type: "task_finished", task });
      } else {
        console.log(
          `  ${task.taskId}: ${task.status}${task.durationMs === null ? "" : ` · ${formatDuration(task.durationMs)}`}`,
        );
      }
    },
    createExecutor: async ({ run, signal, emit }) => {
      if (agentName !== "shelra" && agentName !== "shelra-autonomy") {
        throw new Error(
          `Agent adapter "${agentName}" is not registered yet. This run was retained as failed evidence.`,
        );
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
        allowPaid: Boolean(requestedModel),
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
      });
    },
  });

  printBenchJsonOrText(options.json === true, {
    run: summary,
    type: "run_finished",
    message: `Benchmark run #${summary.runNumber} ${summary.status}`,
  });
  if (summary.status !== "completed") process.exitCode = 1;
}

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
    const rawPolicy = stringOption(options.modelPolicy)?.toLowerCase() || "free";
    const modelPolicy: ModelPolicy = ["free", "auto", "economy", "balanced", "quality", "max", "custom"].includes(
      rawPolicy,
    )
      ? (rawPolicy as ModelPolicy)
      : "free";
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
  const rawPolicy = stringOption(options.modelPolicy)?.toLowerCase() || "free";
  const modelPolicy: ModelPolicy = ["free", "auto", "economy", "balanced", "quality", "max", "custom"].includes(
    rawPolicy,
  )
    ? (rawPolicy as ModelPolicy)
    : "free";
  const budget = resolveBudget(options);

  if (typeof options.model === "string") saveUserSettings({ defaultModel: normalizeModelId(options.model) });

  return {
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
  .option("--model-policy <policy>", "OpenRouter routing policy: free, auto, economy, balanced, quality or max", "free")
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
      const verifyError = getVerifyCliError({ hasPrompt: Boolean(options.prompt), hasMessageArgs: message.length > 0 });
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
  .option("--agent <name>", "Agent adapter to evaluate: shelra (product chat path) or shelra-autonomy", "shelra")
  .option("-m, --model <model>", "Model under test; keep this fixed when measuring harness changes")
  .option("--model-policy <policy>", "Routing policy: free, auto, economy, balanced, quality, max or custom", "free")
  .option("-k, --api-key <key>", "OpenRouter API key")
  .option("-u, --base-url <url>", "OpenRouter API base URL")
  .option("--max-cost <usd>", "Maximum cumulative spend for the benchmark run")
  .option("--max-request-cost <usd>", "Maximum spend for one model request")
  .option("-d, --directory <dir>", "Working directory", process.cwd())
  .option("--json", "Print newline-delimited machine-readable run events")
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
      allowPaid: true,
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

const authCommand = program.command("auth").description("Manage provider credentials in ~/.shelra/auth.json");
authCommand
  .command("openrouter <apiKey>")
  .description("Store an OpenRouter API key securely")
  .action((apiKey: string) => {
    saveOpenRouterApiKey(apiKey);
    console.log("OpenRouter API key saved. Key material is never printed or logged.");
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
