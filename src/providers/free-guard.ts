import type { ModelPolicy } from "../models/routing";
import { FreeModeRefusalError } from "./routing-provider";
import type {
  ProviderAdapter,
  ProviderStream,
  ProviderStreamRequest,
  ProviderStructuredRequest,
  ProviderStructuredResult,
  ProviderTextRequest,
  ProviderTextResult,
} from "./types";

/**
 * The last line of the Free-mode guarantee, for any adapter that did not come through the routing provider. The agent
 * installs every provider through `Agent.setProvider`, which wraps it here, so an adapter built by a path nobody
 * thought of (a fallback, a sub-agent's, a benchmark's) is still checked at the moment it is called.
 *
 * It refuses an adapter of a provider that can bill an account (`billableProviderIds`) when the session is in Free mode
 * and the user has not declared that provider's key free. An adapter that enforces Free mode itself (the routing
 * provider, the OpenRouter adapter) and one of no known provider (a local model, the user's own endpoint) pass.
 */

export interface FreeGuardOptions {
  /** The session's model mode, read at every call. */
  policy: () => ModelPolicy;
  /** Providers whose key the user declared has no billing. */
  declaredFree: () => ReadonlySet<string>;
  /** Provider ids that can bill an account. */
  billableProviderIds: ReadonlySet<string>;
}

export function enforcesFreePolicy(adapter: ProviderAdapter): boolean {
  return (adapter as { enforcesFreePolicy?: boolean }).enforcesFreePolicy === true;
}

export function guardForFreePolicy(adapter: ProviderAdapter, options: FreeGuardOptions): ProviderAdapter {
  if (enforcesFreePolicy(adapter) || !options.billableProviderIds.has(adapter.id)) return adapter;

  const assertAllowed = (): void => {
    if (options.policy() !== "free") return;
    if (options.declaredFree().has(adapter.id)) return;
    throw new FreeModeRefusalError(
      `Free mode uses free models only, and ${adapter.id} has a free plan, not a price: a key on a billed account is charged past the quota. ` +
        `Run \`shelra providers allow-free ${adapter.id}\` if yours has no billing, or switch to Mixed (ctrl+f).`,
    );
  };

  const guarded: ProviderAdapter = {
    id: adapter.id,
    ...(adapter.defaultModelId ? { defaultModelId: adapter.defaultModelId } : {}),
    ...(adapter.supportsBatch === undefined ? {} : { supportsBatch: adapter.supportsBatch }),
    resolveModelRuntime: (modelId, runtimeOptions) => adapter.resolveModelRuntime(modelId, runtimeOptions),
    stream(request: ProviderStreamRequest): ProviderStream {
      try {
        assertAllowed();
      } catch (error) {
        const failed = Promise.reject(error);
        failed.catch(() => undefined);
        return { events: (async function* () {})(), response: failed };
      }
      return adapter.stream(request);
    },
    generateText(request: ProviderTextRequest): Promise<ProviderTextResult> {
      try {
        assertAllowed();
      } catch (error) {
        return Promise.reject(error);
      }
      return adapter.generateText(request);
    },
    ...(adapter.generateStructured
      ? {
          generateStructured: (request: ProviderStructuredRequest): Promise<ProviderStructuredResult> => {
            try {
              assertAllowed();
            } catch (error) {
              return Promise.reject(error);
            }
            return (adapter.generateStructured as NonNullable<ProviderAdapter["generateStructured"]>)(request);
          },
        }
      : {}),
    getToolContext: () => adapter.getToolContext(),
    ...(adapter.routingNotes ? { routingNotes: () => adapter.routingNotes?.() ?? [] } : {}),
    ...(adapter.fallbackModelIds
      ? { fallbackModelIds: (modelId: string) => adapter.fallbackModelIds?.(modelId) ?? [] }
      : {}),
  };
  Object.defineProperty(guarded, "enforcesFreePolicy", { value: true, enumerable: false });
  return guarded;
}
