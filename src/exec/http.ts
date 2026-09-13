import type { HttpProbe } from "./types";

export interface ProbeHttpOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  maxBodyChars?: number;
}

function combineSignals(
  signal: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const onAbort = (): void => controller.abort(signal?.reason);
  signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error(`HTTP probe timed out after ${timeoutMs}ms`)), timeoutMs);
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    },
  };
}

/** Bounded GET probe used by readiness checks and acceptance verification. */
export async function probeHttp(url: string, options: ProbeHttpOptions = {}): Promise<HttpProbe> {
  const startedAt = Date.now();
  const timeoutMs = options.timeoutMs ?? 10_000;
  const maxBodyChars = options.maxBodyChars ?? 2_000;
  const base: HttpProbe = { url, ok: false, durationMs: 0 };
  let parsed: URL;
  try {
    parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("Only HTTP(S) URLs can be probed");
  } catch (error) {
    return {
      ...base,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const combined = combineSignals(options.signal, timeoutMs);
  try {
    const response = await fetch(parsed, { signal: combined.signal, redirect: "follow" });
    const body = await response.text();
    const contentType = response.headers.get("content-type") ?? undefined;
    return {
      url,
      ok: response.ok,
      status: response.status,
      durationMs: Date.now() - startedAt,
      ...(body ? { bodySnippet: body.slice(0, maxBodyChars) } : {}),
      ...(contentType ? { contentType } : {}),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ...base, durationMs: Date.now() - startedAt, error: message };
  } finally {
    combined.dispose();
  }
}
