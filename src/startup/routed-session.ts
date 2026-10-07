import { normalizeModelId, primeCatalog } from "../models/catalog";
import { capabilityScore, type ModelPolicy } from "../models/routing";
import { catalogEntryToModelInfo } from "../models/types";
import { type CredentialFallbackSource, credentialFallbackChain } from "../providers/credential-fallback";
import { outsideFreeMode } from "../providers/free-providers";
import type { RoutingEvent } from "../providers/routing-provider";
import type { ProviderAdapter } from "../providers/types";
import { classifyFreeEligibility, isRouterEntry } from "../routing/eligibility";
import { AUTO_FREE_MODEL_ID } from "../routing/model-ref";
import { createRoutingRuntime, type RoutingRuntime } from "../routing/runtime";
import type { ModelInfo } from "../types/index";
import { MODEL_POLICY_ENV } from "../utils/settings";

/**
 * A session on every provider the user configured. The routing provider is installed once; Free mode asks it for the
 * best free route of any provider per request, Mixed runs the model the user picked on the provider that model names.
 * What the user can do while it runs (pick a model, switch mode) is here, so the terminal UI, a headless run and a
 * delegated task configure a session the same way.
 */

/** The parts of the agent a session needs; the real `Agent` satisfies it. */
export interface RoutedAgent {
  setProvider(provider: ProviderAdapter, modelId?: string): void;
  getModel(): string;
  setCredentialFallback(source: CredentialFallbackSource | null): void;
  setProviderFallback(source: CredentialFallbackSource | null): void;
}

export interface RoutedSessionInput {
  /** A model asked for with `-m`, or the one saved from an earlier session. */
  requestedModel?: string;
  policy: ModelPolicy;
  /** True when the model came from `-m` or `--provider`: it is used as asked or the session does not start. */
  explicitModelSelection: boolean;
  /** An OpenRouter key given for this run. */
  openRouterKey?: string;
  /** Where a rejected key ends up when the user has a local model installed. */
  localFallback?: CredentialFallbackSource | null;
  /** The model the user picked and saved for Mixed mode. */
  pickedModel: () => string | undefined;
  /** The provider Mixed mode starts on when no model was picked (`/config`). Free mode never reads it. */
  defaultProvider?: () => string | undefined;
  /** For tests: the routing machinery to use instead of the product's. */
  createRuntime?: () => RoutingRuntime;
  saveMode: (policy: ModelPolicy) => void;
  /** Called with the canonical id once the session accepted an explicit model. */
  onExplicitModelAccepted?: (modelId: string) => void;
  onEvent?: (event: RoutingEvent) => void;
}

export interface RoutedSessionResult {
  runtime: RoutingRuntime;
  /** The session's model, `shelra/free` for Auto Free. */
  modelId: string;
  /** Every model the providers list, Auto Free first. Read it again after the catalog changes. */
  models: () => ModelInfo[];
  policy: ModelPolicy;
  selectModel: (modelId: string) => Promise<{ success: boolean; error?: string }>;
  setPolicy: (next: ModelPolicy) => Promise<{ success: boolean; error?: string; modelId?: string }>;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** What to do when no provider is configured at all. */
export function noProviderMessage(runtime: Pick<RoutingRuntime, "registry">): string {
  const hints = runtime.registry
    .list()
    .map((definition) => `  ${definition.name}: ${definition.setupHint}`)
    .join("\n");
  return `No model provider is configured. Set up at least one:\n${hints}`;
}

/** Every model the providers list, Auto Free first, each marked with what Free mode can prove about it. */
export function catalogModelInfos(runtime: Pick<RoutingRuntime, "provider" | "catalog" | "attestations">): ModelInfo[] {
  const info = runtime.provider.resolveModelRuntime(AUTO_FREE_MODEL_ID).modelInfo;
  const auto: ModelInfo | undefined = info ? { ...info, freeStatus: "free" } : undefined;
  const attestations = runtime.attestations();
  const listed = runtime.catalog.snapshot().entries.map((entry): ModelInfo => {
    const verdict = classifyFreeEligibility(entry, attestations);
    const freeStatus: NonNullable<ModelInfo["freeStatus"]> = verdict.eligible
      ? "free"
      : isRouterEntry(entry)
        ? "router"
        : verdict.level === "free-tier"
          ? "free-plan"
          : verdict.level === "unknown"
            ? "unproven"
            : "paid";
    return { ...catalogEntryToModelInfo(entry), freeStatus };
  });
  return auto ? [auto, ...listed] : listed;
}

export async function configureRoutedSession(
  agent: RoutedAgent,
  input: RoutedSessionInput,
): Promise<RoutedSessionResult> {
  // Every agent and child process of this session reads the mode from here (`sessionModelPolicy`).
  process.env[MODEL_POLICY_ENV] = input.policy;
  const runtime =
    input.createRuntime?.() ??
    createRoutingRuntime({
      ...(input.openRouterKey ? { openRouterKey: input.openRouterKey } : {}),
      ...(input.onEvent ? { onEvent: input.onEvent } : {}),
    });
  if (runtime.registry.configured(runtime.resolveDeps()).length === 0) {
    runtime.dispose();
    throw new Error(noProviderMessage(runtime));
  }
  await runtime.start();

  const models = (): ModelInfo[] => catalogModelInfos(runtime);
  // The legacy lookup the agent and the terminal UI read (`getModelInfo`) follows the catalog as it refreshes.
  const prime = () => primeCatalog(models());
  prime();
  runtime.catalog.subscribe(prime);

  /**
   * Where Mixed starts when no model was picked: the default provider's router, or its most capable model; else the
   * first configured provider's router; else Auto Free, which needs nothing.
   */
  const mixedDefault = (): string => {
    const configured = runtime.registry.configured(runtime.resolveDeps());
    const preferred = input.defaultProvider?.();
    const chosen = preferred ? configured.find((item) => item.definition.id === preferred)?.definition : undefined;
    if (chosen?.mixedDefaultModelId) return chosen.mixedDefaultModelId;
    if (chosen) {
      const best = [...runtime.catalog.entriesOf(chosen.id)]
        .filter((entry) => entry.capabilities.tools)
        .sort((a, b) => capabilityScore(b) - capabilityScore(a) || a.id.localeCompare(b.id))[0];
      if (best) return best.id;
    }
    for (const { definition } of configured) {
      if (definition.mixedDefaultModelId) return definition.mixedDefaultModelId;
    }
    return AUTO_FREE_MODEL_ID;
  };

  const requested = input.requestedModel ? normalizeModelId(input.requestedModel) : undefined;
  let initial = AUTO_FREE_MODEL_ID;
  if (input.explicitModelSelection && requested) {
    // The model was asked for by name: it is used as asked, or the session says why it cannot be.
    initial = (await runtime.provider.checkSelectable(requested)).canonical;
  } else if (input.policy !== "free") {
    // A saved pick still applies in Mixed; Free is automatic and ignores it.
    initial = mixedDefault();
    if (requested) {
      try {
        initial = (await runtime.provider.checkSelectable(requested)).canonical;
      } catch {
        // The saved model's provider is not configured now: the default stands.
      }
    }
  }
  agent.setProvider(runtime.provider, initial);
  if (input.explicitModelSelection && requested) input.onExplicitModelAccepted?.(initial);

  // A rejected key ends on an installed local model, if there is one. Other keys of the same provider are the routing
  // provider's own business.
  agent.setCredentialFallback(input.localFallback ?? null);
  // In Mixed, a model that cannot be served continues on Auto Free: free routes, no spend nobody agreed to. In Free
  // the router has already tried every route, so there is nothing further to move to.
  agent.setProviderFallback(
    outsideFreeMode(
      credentialFallbackChain([
        async () => ({
          provider: runtime.provider,
          modelId: AUTO_FREE_MODEL_ID,
          label: "Auto Free routing (the free models of your providers)",
        }),
      ]),
    ),
  );

  const selectModel = async (modelId: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const { canonical } = await runtime.provider.checkSelectable(modelId);
      agent.setProvider(runtime.provider, canonical);
      return { success: true };
    } catch (error) {
      return { success: false, error: describeError(error) };
    }
  };

  // Switching the mode starts from the model a restart in that mode would: Mixed runs the model the user picked, or
  // the provider's router when none was; Free keeps a model proven free and otherwise returns to Auto Free. A switch
  // that fails in any way keeps the mode and the model as they were, so the session never runs a paid model while it
  // says Free, and it never throws into the terminal UI.
  const setPolicy = async (next: ModelPolicy) => {
    const previous = (process.env[MODEL_POLICY_ENV] as ModelPolicy | undefined) ?? input.policy;
    const current = agent.getModel();
    try {
      process.env[MODEL_POLICY_ENV] = next;
      let target = AUTO_FREE_MODEL_ID;
      if (next === "free") {
        try {
          target = (await runtime.provider.checkSelectable(current)).canonical;
        } catch {
          target = AUTO_FREE_MODEL_ID;
        }
      } else {
        target = mixedDefault();
        const picked = input.pickedModel();
        if (picked) {
          try {
            target = (await runtime.provider.checkSelectable(picked)).canonical;
          } catch {
            // The picked model's provider is gone: the default stands.
          }
        } else if (current && current !== AUTO_FREE_MODEL_ID) {
          target = current;
        }
      }
      agent.setProvider(runtime.provider, target);
      input.saveMode(next);
      return { success: true, modelId: target };
    } catch (error) {
      process.env[MODEL_POLICY_ENV] = previous;
      return { success: false, error: describeError(error), modelId: current };
    }
  };

  return { runtime, modelId: initial, models, policy: input.policy, selectModel, setPolicy };
}
