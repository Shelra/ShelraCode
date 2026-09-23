import type { ProviderAdapter } from "./types";

/**
 * A rejected API key fails the same way for every model and every retry, so a turn that hits one
 * continues on a fallback the user already has instead of ending: another key they configured, or
 * a local model that is already installed. Nothing is downloaded or installed to make one.
 */
export interface CredentialFallback {
  provider: ProviderAdapter;
  modelId: string;
  /** Where it comes from, for the switch notice. Never the key itself. */
  label: string;
  /** Releases what the fallback started, such as a local inference server. */
  dispose?: () => Promise<void>;
}

export interface CredentialFallbackRequest {
  /** The model the rejected provider was serving; a fallback on the same service keeps it. */
  modelId: string;
  signal: AbortSignal;
}

/** One possible fallback; null when it is not available (not configured, not installed, not starting). */
export type CredentialFallbackSource = (request: CredentialFallbackRequest) => Promise<CredentialFallback | null>;

/**
 * The sources in order, each tried at most once per session: when a fallback's key is rejected
 * too, the next call moves on to the next source. A source that is unavailable or throws is skipped.
 */
export function credentialFallbackChain(sources: readonly CredentialFallbackSource[]): CredentialFallbackSource {
  const remaining = [...sources];
  return async (request) => {
    while (remaining.length > 0 && !request.signal.aborted) {
      const source = remaining.shift();
      try {
        const fallback = await source?.(request);
        if (fallback) return fallback;
      } catch {
        // An unavailable fallback is skipped; the next one is tried.
      }
    }
    return null;
  };
}
