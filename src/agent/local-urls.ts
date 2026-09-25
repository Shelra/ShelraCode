import { observePage } from "../exec/browser";
import type { BrowserObservation } from "../exec/types";

/**
 * The local URLs an answer tells the user to open, requested by the host when the turn ends. Seen live 2026-09-25: a
 * model started a dev server, opened the browser and answered "The game is now running and accessible at
 * http://localhost:8080/public/index.html"; the page answered 500 Internal Server Error, the game did not even
 * compile, and nothing in the turn had requested the page. The user: "nothing works, it is not verifying, it gives
 * false positives". A claim about a local page is checked the way the project's checks are: by the host, on the final
 * state, whatever the model says. A page that answers is also opened in a headless browser (`observePage`), because a
 * page can answer 200 and show nothing: an uncaught error, a module that 404s.
 */

const LOCAL_URL_RE = /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d{1,5})?(?:\/[^\s"'`<>)\]]*)?/giu;
/** At most this many URLs are requested per turn. */
const MAX_URLS = 3;
const CHECK_TIMEOUT_MS = 5_000;
/** How long the headless browser may take to load one page. */
const BROWSER_TIMEOUT_MS = 20_000;
/** Findings listed per kind, so one broken page cannot flood the note. */
const MAX_FINDINGS = 3;

/** The local URLs a text names, in order, without trailing punctuation; 0.0.0.0 is requested as localhost. */
export function localUrlsIn(text: string): string[] {
  const urls = [...text.matchAll(LOCAL_URL_RE)].map((match) =>
    match[0].replace(/[.,;:!?]+$/u, "").replace("//0.0.0.0", "//localhost"),
  );
  return [...new Set(urls)].slice(0, MAX_URLS);
}

export interface UrlCheck {
  url: string;
  /** The HTTP status, or null when nothing answered. */
  status: number | null;
  detail: string;
  /** What went wrong on the page in a headless browser: uncaught errors, console errors, requests that failed. */
  problems: string[];
  /** The browser could not be used (not installed, timed out); the HTTP status is all that was observed. */
  browserNote?: string;
}

/** Whether a check found the page answering and loading without an error. */
export function answered(check: UrlCheck): boolean {
  return check.status !== null && check.status < 400 && check.problems.length === 0;
}

type Observe = (url: string) => Promise<BrowserObservation>;

const observeHeadless: Observe = (url) =>
  observePage(url, { viewport: { width: 1280, height: 720 }, assertions: [], timeoutMs: BROWSER_TIMEOUT_MS });

/**
 * What a page load showed that means the page does not work. Only the app's own requests count: a missing favicon, or
 * a third-party script or font that fails to load, says nothing about the app (a console line about a failed load
 * repeats a request already counted).
 */
export function pageProblems(observation: BrowserObservation): string[] {
  const clip = (text: string) => text.replace(/\s+/gu, " ").trim().slice(0, 200);
  let origin = "";
  try {
    origin = new URL(observation.url).origin;
  } catch {
    // Every request then counts.
  }
  const own = (entry: string) => {
    const url = entry.match(/https?:\/\/\S+/u)?.[0] ?? "";
    return !/\/favicon\.ico(?:[?#:]|$)/u.test(url) && (!origin || !url || url.startsWith(origin));
  };
  return [
    ...observation.pageErrors.slice(0, MAX_FINDINGS).map((error) => `uncaught error: ${clip(error)}`),
    ...observation.consoleErrors
      .filter((error) => !/^Failed to load resource\b/u.test(error))
      .slice(0, MAX_FINDINGS)
      .map((error) => `console error: ${clip(error)}`),
    ...(observation.badResponses ?? [])
      .filter(own)
      .slice(0, MAX_FINDINGS)
      .map((response) => `request answered ${clip(response)}`),
    ...observation.failedRequests
      .filter(own)
      .slice(0, MAX_FINDINGS)
      .map((request) => `request failed: ${clip(request)}`),
  ];
}

/**
 * Requests each URL once and, when it answers, loads it in a headless browser. Never throws: a URL nothing answers,
 * or a browser that cannot start, is a result that says so.
 */
export async function checkLocalUrls(
  urls: readonly string[],
  options: { fetchImpl?: typeof fetch; signal?: AbortSignal; timeoutMs?: number; observe?: Observe | null } = {},
): Promise<UrlCheck[]> {
  const fetcher = options.fetchImpl ?? fetch;
  const observe = options.observe === undefined ? observeHeadless : options.observe;
  const checks: UrlCheck[] = [];
  for (const url of urls) {
    const timeout = AbortSignal.timeout(options.timeoutMs ?? CHECK_TIMEOUT_MS);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    let check: UrlCheck;
    try {
      const response = await fetcher(url, { method: "GET", redirect: "follow", signal });
      const html = /text\/html/iu.test(response.headers.get("content-type") ?? "");
      await response.body?.cancel().catch(() => undefined);
      check = {
        url,
        status: response.status,
        detail: `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`,
        problems: [],
      };
      // Only a page that answers is worth a browser; a JSON endpoint or a file is judged by its status.
      if (observe && response.status < 400 && html && !options.signal?.aborted) {
        const observation = await observe(url);
        if (observation.error && observation.pageErrors.length === 0 && observation.consoleErrors.length === 0) {
          check.browserNote = `not opened in a browser: ${observation.error.replace(/\s+/gu, " ").slice(0, 160)}`;
        }
        check.problems = pageProblems(observation);
      }
    } catch (error) {
      const code = (error as { cause?: { code?: string } })?.cause?.code ?? (error as { code?: string })?.code;
      const reason =
        code === "ECONNREFUSED" || code === "ConnectionRefused"
          ? "connection refused"
          : timeout.aborted
            ? `no answer in ${Math.round((options.timeoutMs ?? CHECK_TIMEOUT_MS) / 1_000)} s`
            : error instanceof Error
              ? error.message
              : String(error);
      check = { url, status: null, detail: `nothing answered (${reason})`, problems: [] };
    }
    checks.push(check);
  }
  return checks;
}

function describeOne(check: UrlCheck): string {
  const parts = [check.detail];
  if (check.problems.length > 0) parts.push(`in a headless browser: ${check.problems.join("; ")}`);
  else if (check.status !== null && check.status < 400 && !check.browserNote)
    parts.push("loaded in a headless browser with no error");
  if (check.browserNote) parts.push(check.browserNote);
  return `${check.url} → ${parts.join(", ")}`;
}

/** The note the user sees: what each URL the answer names did when the host requested it. */
export function describeUrlChecks(checks: readonly UrlCheck[]): string {
  return `[Shelra requested the local ${checks.length === 1 ? "page" : "pages"} the answer names when the turn ended: ${checks
    .map(describeOne)
    .join("; ")}]`;
}

/**
 * The verdict of a turn whose answer names a local page that does not work: not verified, whatever checks passed
 * (`checksPassed`, as "`npm test` passed"), since the page is what the user will open.
 */
export function failedPagesVerdict(failed: readonly UrlCheck[], checksPassed: string | null): string {
  const pages = failed.length === 1 ? "page the answer names does" : "pages the answer names do";
  return `[Not verified — ${checksPassed ? `${checksPassed}, but ` : ""}the local ${pages} not work: ${failed
    .map(describeOne)
    .join("; ")}]`;
}

/** What the model hears, once, when a page it set up and named does not work. */
export function urlRepairRequest(failed: readonly UrlCheck[]): string {
  return [
    "Your answer says local pages work. Shelra opened them when the turn was about to end:",
    ...failed.map((check) => `- ${describeOne(check)}`),
    "They do not work. Find the cause (the server's own output: process_logs; a build or type check of the code), fix it, and open the page again; if it cannot work yet, tell the user plainly that it does not work and why. Do not say it works unless it loads without errors.",
  ].join("\n");
}
