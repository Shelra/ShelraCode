import { ClaudeCliProvider, type ClaudeCliProviderOptions } from "./claude-cli";
import type { IntelligenceProvider } from "./types";

export {
  buildClaudeArgs,
  ClaudeCliProvider,
  type ClaudeCliProviderOptions,
  isTransientFailure,
  mapUsage,
  parseCliJson,
  resolveClaudeBinary,
  resolveModelForTier,
  scrubClaudeEnv,
} from "./claude-cli";
export { FakeIntelligenceProvider, type FakeIntelligenceReply, type FakeIntelligenceScript } from "./fake";
export {
  createOpenRouterIntelligenceProvider,
  type OpenRouterIntelligenceOptions,
  OpenRouterIntelligenceProvider,
} from "./openrouter";
export * from "./types";

/** Raised when no intelligence provider can serve requests on this machine. */
export class IntelligenceUnavailableError extends Error {
  readonly providerId: string;
  readonly detail: string;

  constructor(providerId: string, detail: string) {
    super(`Intelligence provider "${providerId}" is unavailable: ${detail}`);
    this.name = "IntelligenceUnavailableError";
    this.providerId = providerId;
    this.detail = detail;
  }
}

export interface ResolveIntelligenceOptions extends ClaudeCliProviderOptions {
  /** Pre-built provider, used by tests and by hosts that already resolved one. */
  provider?: IntelligenceProvider;
}

/**
 * Resolves the intelligence provider for the autonomy runtime.
 *
 * Availability is checked up front so an objective fails at the boundary with an actionable
 * message, rather than part-way through a plan with a cryptic subprocess error.
 */
export async function resolveIntelligenceProvider(
  options: ResolveIntelligenceOptions = {},
): Promise<IntelligenceProvider> {
  const { provider, ...providerOptions } = options;
  const resolved = provider ?? new ClaudeCliProvider(providerOptions);
  const availability = await resolved.checkAvailability();
  if (!availability.available) {
    throw new IntelligenceUnavailableError(resolved.id, availability.detail);
  }
  return resolved;
}
