import { APICallError } from "@ai-sdk/provider";

/**
 * A provider's free allowance used up: when it comes back, as the provider reports it. A session in Free mode never
 * moves to a provider that could bill (owner, 2026-09-24), so a turn that runs out of free requests ends "Limited" and
 * says when to try again. Reset times, from each provider's documentation (checked 2026-09-24):
 * - OpenRouter: free models allow 50 requests a day (1,000 with $10 of credits bought), counted per UTC day; its
 *   429 carries `X-RateLimit-Reset`. https://openrouter.ai/docs/api-reference/limits
 * - Groq: `retry-after` (seconds) on a 429; `x-ratelimit-reset-requests` is the requests-per-day reset.
 *   https://console.groq.com/docs/rate-limits
 * - Gemini: requests-per-day quotas reset at midnight Pacific time; a 429 is `RESOURCE_EXHAUSTED`.
 *   https://ai.google.dev/gemini-api/docs/rate-limits
 * - Cloudflare Workers AI: 10,000 neurons a day on the free plan, reset at 00:00 UTC.
 *   https://developers.cloudflare.com/workers-ai/platform/pricing/
 */
export interface ProviderLimit {
  /** The provider's id ("openrouter", "groq", "gemini", "cloudflare"). */
  provider: string;
  /** Its name, for the note. */
  name: string;
  /** When the allowance comes back; null when neither the provider nor its documentation says. */
  resetsAt: Date | null;
  /** True when the time comes from the documented schedule, not from the provider's reply. */
  estimated: boolean;
}

const NAMES: Record<string, string> = {
  openrouter: "OpenRouter's free models",
  groq: "Groq",
  gemini: "Gemini",
  cloudflare: "Cloudflare Workers AI",
};

/** A daily or quota wording, as opposed to a per-minute burst a retry gets past. */
const DAILY_RE =
  /per[- ]day|daily|free-models-per-day|requests per day|\bRPD\b|quota|RESOURCE_EXHAUSTED|neurons|allocation|used up/i;
const RATE_LIMIT_RE = /\b429\b|rate[- ]?limit|too many requests|quota|RESOURCE_EXHAUSTED|free-models-per-day/i;
/** A reset further away than this is a limit to wait out, not a burst to retry. */
const LONG_WAIT_MS = 10 * 60 * 1_000;

/** The provider error itself, out of the SDK's retry wrapper and `cause` chain. */
function innermost(error: unknown): unknown {
  let current = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth += 1) {
    const next = (current as { lastError?: unknown }).lastError ?? (current as { cause?: unknown }).cause;
    if (!next || next === current) break;
    if (APICallError.isInstance(current)) break;
    current = next;
  }
  return current;
}

function headerValue(headers: Record<string, string> | undefined, name: string): string | undefined {
  if (!headers) return undefined;
  const key = Object.keys(headers).find((header) => header.toLowerCase() === name);
  return key ? headers[key] : undefined;
}

/** "2m59.56s", "1h2m", "7.66s", "30" (seconds) → milliseconds. */
export function parseDuration(value: string): number | null {
  const text = value.trim();
  if (/^\d+(?:\.\d+)?$/u.test(text)) return Number(text) * 1_000;
  const match = /^(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)m(?!s))?(?:(\d+(?:\.\d+)?)s)?(?:(\d+(?:\.\d+)?)ms)?$/u.exec(
    text,
  );
  if (!match || !match.slice(1).some(Boolean)) return null;
  const [, hours, minutes, seconds, millis] = match;
  return (
    Number(hours ?? 0) * 3_600_000 + Number(minutes ?? 0) * 60_000 + Number(seconds ?? 0) * 1_000 + Number(millis ?? 0)
  );
}

/** An `X-RateLimit-Reset` value: epoch milliseconds or seconds, or seconds from now. */
function resetFromEpochOrSeconds(value: string, now: Date): Date | null {
  const number = Number(value.trim());
  if (!Number.isFinite(number) || number <= 0) return null;
  if (number > 1e12) return new Date(number);
  if (number > 1e9) return new Date(number * 1_000);
  return new Date(now.getTime() + number * 1_000);
}

/** The next midnight in a time zone (Gemini counts days in Pacific time). */
function nextMidnight(now: Date, timeZone: string): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  // Some engines write midnight as hour 24.
  const elapsed = ((get("hour") % 24) * 3_600 + get("minute") * 60 + get("second")) * 1_000;
  return new Date(now.getTime() - (now.getTime() % 1_000) - elapsed + 24 * 3_600_000);
}

function nextUtcMidnight(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}

/** The documented reset for a provider's daily allowance, or null when its documentation gives none. */
function documentedReset(provider: string, now: Date): Date | null {
  if (provider === "openrouter" || provider === "cloudflare") return nextUtcMidnight(now);
  if (provider === "gemini") return nextMidnight(now, "America/Los_Angeles");
  return null;
}

/**
 * The provider's allowance, used up, as `error` shows it; null when the error is anything else (a key, a missing
 * model, a server fault) or a short burst limit a retry gets past.
 */
export function limitFromError(provider: string, error: unknown, now = new Date()): ProviderLimit | null {
  const inner = innermost(error);
  const status = APICallError.isInstance(inner) ? inner.statusCode : undefined;
  const headers = APICallError.isInstance(inner) ? inner.responseHeaders : undefined;
  const body = APICallError.isInstance(inner) ? (inner.responseBody ?? "") : "";
  const message = inner instanceof Error ? inner.message : String(inner ?? "");
  const text = `${message}\n${body}`;
  if (status !== 429 && !RATE_LIMIT_RE.test(text)) return null;

  // What the provider says, most specific first.
  let resetsAt: Date | null = null;
  const bodyReset = /"X-RateLimit-Reset"\s*:\s*"?(\d+)/iu.exec(body)?.[1];
  const reset = headerValue(headers, "x-ratelimit-reset") ?? bodyReset;
  if (reset) resetsAt = resetFromEpochOrSeconds(reset, now);
  const dailyReset = headerValue(headers, "x-ratelimit-reset-requests");
  if (!resetsAt && dailyReset) {
    const ms = parseDuration(dailyReset);
    if (ms !== null) resetsAt = new Date(now.getTime() + ms);
  }
  const retryAfter = headerValue(headers, "retry-after");
  if (!resetsAt && retryAfter) {
    const ms = parseDuration(retryAfter);
    if (ms !== null) resetsAt = new Date(now.getTime() + ms);
  }

  const daily = DAILY_RE.test(text);
  const longWait = resetsAt !== null && resetsAt.getTime() - now.getTime() >= LONG_WAIT_MS;
  if (!daily && !longWait) return null;
  const estimated = resetsAt === null;
  return {
    provider,
    name: NAMES[provider] ?? provider,
    resetsAt: resetsAt ?? documentedReset(provider, now),
    estimated,
  };
}

/** "Sep 25, 8:00 PM", in the machine's time zone. */
export function formatReset(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

/** "8:00 PM" today, "Sep 25, 8:00 PM" another day: short enough for the footer. */
export function formatResetShort(date: Date, now = new Date()): string {
  const sameDay = date.toDateString() === now.toDateString();
  return sameDay
    ? new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(date)
    : formatReset(date);
}

/** The sentence a turn ends with when a provider's allowance is used up. */
export function describeLimit(limit: ProviderLimit): string {
  const when = limit.resetsAt
    ? `it resets ${limit.estimated ? "around" : "at"} ${formatReset(limit.resetsAt)}`
    : "the provider did not say when it resets";
  return `${limit.name} reached the limit of the free plan; ${when}.`;
}
