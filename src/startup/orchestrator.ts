import { detectHardware, inspectHardware } from "../hardware/profile";
import { recommendBootstrapModel } from "../models/recommendation";
import type { ProviderAdapter } from "../providers/types";
import { selectLocalRoute } from "../router/local-first";
import { discoverLocalRuntimes } from "../runtimes/discovery";
import type { LocalModelCandidate, LocalRuntimeAdapter, LocalRuntimeDiscovery } from "../runtimes/types";
import { saveUserSettings } from "../utils/settings";
import type { StartupOptions, StartupProgress, StartupResult, StartupState } from "./types";

function emit(
  options: StartupOptions,
  state: StartupState,
  message: string,
  extra: Omit<StartupProgress, "state" | "message"> = {},
): void {
  options.onProgress?.({ state, message, ...extra });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function emptyDiscovery(): LocalRuntimeDiscovery {
  return { runtimes: [], health: {}, models: [] };
}

export async function probeLocalModel(
  provider: ProviderAdapter,
  model: LocalModelCandidate,
  signal?: AbortSignal,
): Promise<{ ok: boolean; reason?: string }> {
  // CUDA runtimes can spend 15-25 seconds loading kernels and warming a
  // small model on the first request. A readiness probe must not misclassify
  // that cold start as a broken model; subsequent prompts use the warmed
  // server and remain responsive.
  const probeSignal = signal ?? AbortSignal.timeout(60_000);
  try {
    const result = await provider.generateText({
      modelId: model.id,
      system: "Reply with the single word READY.",
      prompt: "READY",
      maxOutputTokens: 8,
      temperature: 0,
      signal: probeSignal,
    });
    return result.text.trim().length > 0
      ? { ok: true }
      : { ok: false, reason: "The model returned an empty response." };
  } catch (error) {
    return { ok: false, reason: errorMessage(error) };
  }
}

function findRuntime(discovery: LocalRuntimeDiscovery, model: LocalModelCandidate): LocalRuntimeAdapter | undefined {
  return discovery.runtimes.find((runtime) => runtime.id === model.runtimeId);
}

/**
 * Runs the local-first startup state machine. It deliberately returns a
 * recoverable state when no local model is available; callers can keep the
 * same renderer alive and offer onboarding/retry instead of opening a remote
 * API-key dialog.
 */
export async function runStartup(options: StartupOptions = {}): Promise<StartupResult> {
  emit(options, "booting", "Preparing your local coding environment");

  let hardware = options.hardware ?? inspectHardware();
  let discovery = options.discovery ?? emptyDiscovery();
  try {
    emit(options, "detecting-runtime", "Detecting local AI runtimes");
    const discoveryPromise = options.discovery
      ? Promise.resolve(options.discovery)
      : // A managed model may need several seconds to load into RAM before its
        // loopback health endpoint turns green. Discovery itself is concurrent,
        // but the readiness budget must not expire after the 1.5s endpoint probe
        // used by legacy external runtimes.
        discoverLocalRuntimes(undefined, options.signal ?? AbortSignal.timeout(60_000));
    emit(options, "detecting-hardware", "Inspecting your hardware");
    const hardwarePromise = options.hardware ? Promise.resolve(options.hardware) : detectHardware();
    [discovery, hardware] = await Promise.all([discoveryPromise, hardwarePromise]);
    emit(options, "detecting-models", "Checking available local models", {
      detail: `${discovery.models.length} model${discovery.models.length === 1 ? "" : "s"} found`,
    });
  } catch (error) {
    emit(options, "recoverable-error", "Unable to inspect the local AI environment", { detail: errorMessage(error) });
    return {
      state: "recoverable-error",
      hardware,
      discovery,
      route: { kind: "unavailable", reasons: [errorMessage(error)] },
      error: errorMessage(error),
      healthChecked: false,
    };
  }

  emit(options, "recommending-model", "Choosing the best local model for this computer");
  const route = selectLocalRoute(discovery.models, {
    preferredModel: options.requestedModel,
    requiresTools: true,
    hardware,
  });
  const model = route.model;
  if (!model) {
    const recommendation = recommendBootstrapModel(hardware);
    emit(options, "onboarding", "No ready local model found", {
      detail:
        discovery.runtimes.length > 0
          ? "A local runtime is available. ShelraCode needs a coding model before chat can start."
          : "Install or start a supported local runtime to continue.",
    });
    return { state: "onboarding", hardware, discovery, route, recommendation, healthChecked: false };
  }

  const runtime = findRuntime(discovery, model);
  if (!runtime) {
    const error = `Runtime ${model.runtimeId} is no longer available for ${model.id}.`;
    emit(options, "recoverable-error", "The selected model needs a runtime that is unavailable", {
      detail: error,
      model: model.id,
    });
    return { state: "recoverable-error", hardware, discovery, route, model, error, healthChecked: false };
  }

  if (runtime.prepareModel && !(await runtime.prepareModel(model.id, options.signal))) {
    const error = `The local runtime could not prepare ${model.name}.`;
    emit(options, "recoverable-error", "The local model is not ready", {
      detail: error,
      model: model.id,
      runtime: runtime.id,
    });
    return { state: "recoverable-error", hardware, discovery, route, model, error, healthChecked: false };
  }
  // The health re-check must name the model that was just prepared: a runtime
  // asked without an id can legitimately be serving a different installed model.
  const runtimeHealth = runtime.prepareModel
    ? await runtime.health(options.signal, model.id)
    : discovery.health[runtime.id];
  if (runtimeHealth && !runtimeHealth.healthy) {
    const error = runtimeHealth.reason || `${runtime.id} did not respond.`;
    emit(options, "recoverable-error", "The local runtime is not ready", {
      detail: error,
      model: model.id,
      runtime: runtime.id,
    });
    return { state: "recoverable-error", hardware, discovery, route, model, error, healthChecked: false };
  }

  emit(options, "validating-model", "Validating the selected local model", { model: model.id, runtime: runtime.id });
  let activeModel = model;
  let activeRuntime = runtime;
  let activeProvider = runtime.provider(model);
  emit(options, "preparing-runtime", "Preparing the local runtime", { model: model.id, runtime: runtime.id });
  emit(options, "loading-model", `Loading ${model.name}`, { model: model.id, runtime: runtime.id });

  const shouldProbe = options.healthCheck !== false;
  if (shouldProbe) {
    emit(options, "health-check", "Running a local inference health check", {
      model: activeModel.id,
      runtime: activeRuntime.id,
    });
    let probe = await probeLocalModel(activeProvider, activeModel, options.signal);
    if (!probe.ok) {
      const fallback = /out.?of.?memory|oom|memory|load|resource/i.test(probe.reason || "")
        ? selectLocalRoute(
            discovery.models.filter(
              (candidate) =>
                candidate.id !== model.id &&
                (model.parameters === undefined ||
                  candidate.parameters === undefined ||
                  candidate.parameters <= model.parameters),
            ),
            {
              requiresTools: true,
              hardware,
            },
          ).model
        : undefined;
      const primaryFailure = probe.reason || "The model failed its readiness check.";
      let fallbackAttempted = false;
      if (fallback) {
        const fallbackRuntime = findRuntime(discovery, fallback);
        const fallbackHealth = fallbackRuntime ? discovery.health[fallbackRuntime.id] : undefined;
        // A runtime that loads models on demand is eligible even when discovery
        // saw no server running; it is started by `prepareModel` below.
        const fallbackServiceable =
          !fallbackHealth || fallbackHealth.healthy || typeof fallbackRuntime?.prepareModel === "function";
        if (fallbackRuntime && fallbackServiceable) {
          emit(options, "loading-model", `Trying a smaller local model: ${fallback.name}`, {
            model: fallback.id,
            runtime: fallbackRuntime.id,
          });
          // Preparing the fallback stops the primary server, so the primary
          // provider is dead from here on whatever the outcome.
          fallbackAttempted = true;
          const fallbackPrepared =
            !fallbackRuntime.prepareModel || (await fallbackRuntime.prepareModel(fallback.id, options.signal));
          if (fallbackPrepared) {
            const fallbackProvider = fallbackRuntime.provider(fallback);
            probe = await probeLocalModel(fallbackProvider, fallback, options.signal);
            if (probe.ok) {
              activeModel = fallback;
              activeRuntime = fallbackRuntime;
              activeProvider = fallbackProvider;
            }
          }
        }
      }
      if (probe.ok) {
        // The fallback model passed its health check; continue to ready.
      } else {
        const error = fallbackAttempted
          ? `${primaryFailure} The smaller local model ${fallback?.name ?? ""} also failed: ${probe.reason || "readiness check failed"}.`.replace(
              /\s+/gu,
              " ",
            )
          : primaryFailure;
        emit(options, "recoverable-error", "The local model could not be loaded", {
          detail: error,
          model: activeModel.id,
          runtime: activeRuntime.id,
        });
        // No provider is returned: nothing here is backed by a confirmed-live
        // server, and a stale provider would point at a closed loopback port.
        return {
          state: "recoverable-error",
          hardware,
          discovery,
          route,
          model: activeModel,
          error,
          healthChecked: false,
        };
      }
    }
  }

  activeModel = {
    ...activeModel,
    loaded: true,
    capabilityConfidence: activeModel.capabilityConfidence === "unknown" ? "probed" : activeModel.capabilityConfidence,
  };
  if (options.persistSelection !== false) {
    saveUserSettings({
      defaultModel: activeModel.id,
      localRuntimeId: activeRuntime.id,
      lastLocalHealthCheck: new Date().toISOString(),
    });
  }
  emit(options, "ready", "Local model ready", { model: activeModel.id, runtime: activeRuntime.id, percent: 100 });
  return {
    state: "ready",
    hardware,
    discovery,
    route,
    model: activeModel,
    provider: activeProvider,
    healthChecked: shouldProbe,
  };
}
