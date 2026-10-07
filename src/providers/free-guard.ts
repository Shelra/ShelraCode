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
 * provider, the OpenRouter adapter) and one of no known provider (a local model) pass. The user's own endpoint is guarded
 * separately (`guardUndeclaredEndpoint`): unpriced, so refused in Free mode unless it is on this machine or declared free.
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

/** Whether an endpoint is this machine's own server (a model served here costs nothing per request). */
export function isLoopbackEndpoint(endpoint: string): boolean {
  try {
    const host = new URL(endpoint).hostname.replace(/^\[|\]$/gu, "").toLowerCase();
    return host === "localhost" || host === "::1" || host === "0.0.0.0" || /^127(\.\d{1,3}){3}$/u.test(host);
  } catch {
    return false;
  }
}

/**
 * The user's own OpenAI-compatible endpoint (SHELRA_BASE_URL) has no catalog and no price Shelra can read, and unknown
 * cost is not free: in Free mode it is refused unless it is a server on this machine or the user declared it free with
 * `SHELRA_ENDPOINT_FREE=1`. Mixed mode uses it as before.
 */
export function guardUndeclaredEndpoint(
  adapter: ProviderAdapter,
  options: { endpoint: string; policy: () => ModelPolicy; env?: Record<string, string | undefined> },
): ProviderAdapter {
  const env = options.env ?? process.env;
  return guardWith(adapter, () => {
    if (options.policy() !== "free") return;
    if (isLoopbackEndpoint(options.endpoint) || /^(1|on|true|yes)$/iu.test(env.SHELRA_ENDPOINT_FREE?.trim() ?? ""))
      return;
    throw new FreeModeRefusalError(
      `Free mode uses free models only, and Shelra cannot see what ${new URL(options.endpoint).host} charges (unknown cost is not free). ` +
        "Set SHELRA_ENDPOINT_FREE=1 if this endpoint is free, switch to Mixed (ctrl+f), or use a provider Shelra can price (`shelra providers`).",
    );
  });
}

export function guardForFreePolicy(adapter: ProviderAdapter, options: FreeGuardOptions): ProviderAdapter {
  if (enforcesFreePolicy(adapter) || !options.billableProviderIds.has(adapter.id)) return adapter;

  return guardWith(adapter, () => {
    if (options.policy() !== "free") return;
    if (options.declaredFree().has(adapter.id)) return;
    throw new FreeModeRefusalError(
      `Free mode uses free models only, and ${adapter.id} has a free plan, not a price: a key on a billed account is charged past the quota. ` +
        `Run \`shelra providers allow-free ${adapter.id}\` if yours has no billing, or switch to Mixed (ctrl+f).`,
    );
  });
}

/** The adapter with `assertAllowed` run before every model call; it marks the result as enforcing Free mode itself. */
function guardWith(adapter: ProviderAdapter, assertAllowed: () => void): ProviderAdapter {
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
