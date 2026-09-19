const GOOGLE_SEARCH_ENDPOINT = "https://www.googleapis.com/customsearch/v1";
const GOOGLE_HTML_ENDPOINT = "https://www.google.com/search";
const DUCKDUCKGO_HTML_ENDPOINT = "https://html.duckduckgo.com/html/";
const TAVILY_SEARCH_ENDPOINT = "https://api.tavily.com/search";
const EXA_SEARCH_ENDPOINT = "https://api.exa.ai/search";
const BRAVE_SEARCH_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";
const SEARCH_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_RESULTS = 5;

type FetchLike = typeof fetch;

export interface WebSearchSource {
  title: string;
  url: string;
  snippet?: string;
}

export interface WebSearchResult {
  success: boolean;
  query: string;
  provider: "tavily" | "google-api" | "google" | "duckduckgo" | "exa" | "searxng" | "brave" | "unavailable";
  sources: WebSearchSource[];
  output: string;
  error?: string;
}

export interface WebSearchOptions {
  signal?: AbortSignal;
  maxResults?: number;
  fetchImpl?: FetchLike;
  googleApiKey?: string;
  googleSearchEngineId?: string;
  tavilyApiKey?: string;
  exaApiKey?: string;
  searxngBaseUrl?: string;
  braveApiKey?: string;
}

export interface WebPageResult {
  success: boolean;
  url: string;
  title?: string;
  text: string;
  contentType?: string;
  error?: string;
}

export interface WebPageOptions {
  signal?: AbortSignal;
  maxChars?: number;
  fetchImpl?: FetchLike;
}

async function fetchPublicPage(initialUrl: URL, options: WebPageOptions): Promise<{ response: Response; url: URL }> {
  let url = initialUrl;
  for (let redirectCount = 0; redirectCount <= 3; redirectCount += 1) {
    if (isBlockedWebHost(url.hostname)) throw new Error("Private and local network URLs are not allowed.");
    const response = await (options.fetchImpl ?? fetch)(url, {
      headers: {
        Accept: "text/html,application/xhtml+xml,text/plain,application/json",
        "User-Agent": "Mozilla/5.0 (compatible; ShelraCode/1.1; +https://shelra.dev)",
      },
      redirect: "manual",
      signal: requestSignal(options.signal),
    });
    if (response.status < 300 || response.status >= 400) return { response, url };
    const location = response.headers.get("location");
    if (!location) throw new Error(`Page returned HTTP ${response.status} without a redirect location.`);
    url = new URL(location, url);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("Only HTTP and HTTPS redirects are allowed.");
    }
  }
  throw new Error("Page redirected too many times.");
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function requestSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(SEARCH_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function decodeHtml(value: string): string {
  return value
    .replace(/&#(\d+);/gu, (_match, decimal: string) => {
      const codePoint = Number(decimal);
      return Number.isSafeInteger(codePoint) ? String.fromCodePoint(codePoint) : "";
    })
    .replace(/&#x([\da-f]+);/giu, (_match, hexadecimal: string) => {
      const codePoint = Number.parseInt(hexadecimal, 16);
      return Number.isSafeInteger(codePoint) ? String.fromCodePoint(codePoint) : "";
    })
    .replace(/&nbsp;/giu, " ")
    .replace(/&quot;/giu, '"')
    .replace(/&apos;/giu, "'")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&amp;/giu, "&");
}

function htmlToText(value: string): string {
  return decodeHtml(
    value
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, " ")
      .replace(/<[^>]+>/gu, " "),
  )
    .replace(/\s+/gu, " ")
    .trim();
}

function normalizeResultUrl(rawValue: string, baseUrl: string): string | undefined {
  const raw = decodeHtml(rawValue);
  try {
    const parsed = new URL(raw, baseUrl);
    if (parsed.hostname.endsWith("google.com") && parsed.pathname === "/url") {
      const target = parsed.searchParams.get("q") || parsed.searchParams.get("url");
      return target ? normalizeResultUrl(target, baseUrl) : undefined;
    }
    if (parsed.hostname.endsWith("duckduckgo.com") && parsed.pathname === "/l/") {
      const target = parsed.searchParams.get("uddg");
      return target ? normalizeResultUrl(target, baseUrl) : undefined;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
    if (parsed.hostname.endsWith("google.com") || parsed.hostname.endsWith("googleapis.com")) return undefined;
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function isBlockedWebHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/u, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    return true;
  }

  const ipv4 = host.split(".").map((part) => Number(part));
  if (ipv4.length === 4 && ipv4.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
    const [first, second] = ipv4;
    return (
      first === 0 ||
      first === 10 ||
      first === 127 ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168)
    );
  }

  if (host.includes(":")) {
    return (
      host === "::" ||
      host === "::1" ||
      host.startsWith("fe8") ||
      host.startsWith("fe9") ||
      host.startsWith("fea") ||
      host.startsWith("feb") ||
      host.startsWith("fc") ||
      host.startsWith("fd")
    );
  }
  return false;
}

function deduplicateSources(sources: WebSearchSource[], maxResults: number): WebSearchSource[] {
  const seen = new Set<string>();
  return sources
    .filter((source) => {
      if (seen.has(source.url)) return false;
      seen.add(source.url);
      return true;
    })
    .slice(0, maxResults);
}

function formatSources(sources: WebSearchSource[]): string {
  if (sources.length === 0) return "No web sources were found.";
  return sources
    .map(
      (source, index) =>
        `${index + 1}. ${source.title}\n   URL: ${source.url}${source.snippet ? `\n   ${source.snippet}` : ""}`,
    )
    .join("\n");
}

function result(
  query: string,
  provider: WebSearchResult["provider"],
  sources: WebSearchSource[],
  error?: string,
): WebSearchResult {
  return {
    success: sources.length > 0,
    query,
    provider,
    sources,
    output: formatSources(sources),
    ...(error ? { error } : {}),
  };
}

async function googleApiSearch(query: string, apiKey: string, engineId: string, options: WebSearchOptions) {
  const url = new URL(GOOGLE_SEARCH_ENDPOINT);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("cx", engineId);
  url.searchParams.set("q", query);
  url.searchParams.set("num", String(Math.min(options.maxResults ?? DEFAULT_MAX_RESULTS, 10)));
  const response = await (options.fetchImpl ?? fetch)(url, {
    headers: { Accept: "application/json", "User-Agent": "ShelraCode/1.1" },
    signal: requestSignal(options.signal),
  });
  if (!response.ok) throw new Error(`Google Custom Search returned HTTP ${response.status}`);
  const root = record(await response.json());
  const items = Array.isArray(root?.items) ? root.items : [];
  const sources = items.flatMap((item) => {
    const entry = record(item);
    const link = text(entry?.link);
    const title = text(entry?.title);
    if (!link || !title) return [];
    return [{ title, url: link, ...(text(entry?.snippet) ? { snippet: text(entry?.snippet) } : {}) }];
  });
  return deduplicateSources(sources, options.maxResults ?? DEFAULT_MAX_RESULTS);
}

/**
 * Tavily: https://api.tavily.com/search. Verified against Tavily's own current API reference
 * (2026-09-13) — real free tier (1,000 credits/mo, no card) rather than an HTML scrape, so this
 * is the preferred provider whenever a key is configured. See
 * docs/architecture/14-AGENT-HARNESS-RECONSTRUCTION.md §9 for the provider comparison this order
 * is based on.
 */
async function tavilySearch(query: string, apiKey: string, options: WebSearchOptions): Promise<WebSearchSource[]> {
  const response = await (options.fetchImpl ?? fetch)(TAVILY_SEARCH_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query,
      max_results: Math.min(options.maxResults ?? DEFAULT_MAX_RESULTS, 20),
    }),
    signal: requestSignal(options.signal),
  });
  if (!response.ok) throw new Error(`Tavily search returned HTTP ${response.status}`);
  const root = record(await response.json());
  const items = Array.isArray(root?.results) ? root.results : [];
  const sources = items.flatMap((item) => {
    const entry = record(item);
    const url = text(entry?.url);
    const title = text(entry?.title);
    if (!url || !title) return [];
    return [{ title, url, ...(text(entry?.content) ? { snippet: text(entry?.content)?.slice(0, 400) } : {}) }];
  });
  return deduplicateSources(sources, options.maxResults ?? DEFAULT_MAX_RESULTS);
}

/**
 * Exa: https://api.exa.ai/search. Verified against Exa's own current API reference
 * (2026-09-13). Exa's "better for technical/developer content" reputation is a community
 * claim, not documented by Exa itself — treated here as an alternative/fallback, not a
 * specialized technical-docs router.
 */
async function exaSearch(query: string, apiKey: string, options: WebSearchOptions): Promise<WebSearchSource[]> {
  const response = await (options.fetchImpl ?? fetch)(EXA_SEARCH_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({
      query,
      numResults: Math.min(options.maxResults ?? DEFAULT_MAX_RESULTS, 20),
    }),
    signal: requestSignal(options.signal),
  });
  if (!response.ok) throw new Error(`Exa search returned HTTP ${response.status}`);
  const root = record(await response.json());
  const items = Array.isArray(root?.results) ? root.results : [];
  const sources = items.flatMap((item) => {
    const entry = record(item);
    const url = text(entry?.url);
    const title = text(entry?.title);
    if (!url || !title) return [];
    return [{ title, url, ...(text(entry?.text) ? { snippet: text(entry?.text)?.slice(0, 400) } : {}) }];
  });
  return deduplicateSources(sources, options.maxResults ?? DEFAULT_MAX_RESULTS);
}

/**
 * SearXNG: calls a user-configured, already-running instance (self-hosted or a trusted public
 * one) over its JSON API. SearXNG's source is AGPL-3.0, but that only matters if its code were
 * vendored into this repo; calling an external instance over HTTP carries no such obligation.
 * Never bundle SearXNG's source here. The exact result-item schema below (title/url/content)
 * matches SearXNG's long-stable, widely-documented format but was not independently verified
 * against a live instance — treat as best-effort and forgiving of missing fields.
 */
async function searxngSearch(query: string, baseUrl: string, options: WebSearchOptions): Promise<WebSearchSource[]> {
  const url = new URL("/search", baseUrl);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  const response = await (options.fetchImpl ?? fetch)(url, {
    headers: { Accept: "application/json" },
    signal: requestSignal(options.signal),
  });
  if (!response.ok) throw new Error(`SearXNG search returned HTTP ${response.status}`);
  const root = record(await response.json());
  const items = Array.isArray(root?.results) ? root.results : [];
  const sources = items.flatMap((item) => {
    const entry = record(item);
    const url2 = text(entry?.url);
    const title = text(entry?.title);
    if (!url2 || !title) return [];
    return [{ title, url: url2, ...(text(entry?.content) ? { snippet: text(entry?.content)?.slice(0, 400) } : {}) }];
  });
  return deduplicateSources(sources, options.maxResults ?? DEFAULT_MAX_RESULTS);
}

/**
 * Brave Search API. Deprioritized: Brave now requires a card even on its free tier (confirmed
 * 2026-09-13, contradicting the common assumption it's card-free), so it is only used when a
 * user has explicitly configured a key, never as a default.
 */
async function braveSearch(query: string, apiKey: string, options: WebSearchOptions): Promise<WebSearchSource[]> {
  const url = new URL(BRAVE_SEARCH_ENDPOINT);
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(Math.min(options.maxResults ?? DEFAULT_MAX_RESULTS, 20)));
  const response = await (options.fetchImpl ?? fetch)(url, {
    headers: { Accept: "application/json", "X-Subscription-Token": apiKey },
    signal: requestSignal(options.signal),
  });
  if (!response.ok) throw new Error(`Brave search returned HTTP ${response.status}`);
  const root = record(await response.json());
  const web = record(root?.web);
  const items = Array.isArray(web?.results) ? web.results : [];
  const sources = items.flatMap((item) => {
    const entry = record(item);
    const url2 = text(entry?.url);
    const title = text(entry?.title);
    if (!url2 || !title) return [];
    return [
      { title, url: url2, ...(text(entry?.description) ? { snippet: text(entry?.description)?.slice(0, 400) } : {}) },
    ];
  });
  return deduplicateSources(sources, options.maxResults ?? DEFAULT_MAX_RESULTS);
}

function parseGoogleHtml(html: string, maxResults: number): WebSearchSource[] {
  const sources: WebSearchSource[] = [];
  const anchorPattern = /<a\b[^>]*\bhref\s*=\s*(?:"([^"]+)"|'([^']+)')[^>]*>([\s\S]{0,6000}?)<\/a>/giu;
  for (const match of html.matchAll(anchorPattern)) {
    const href = match[1] || match[2];
    const inner = match[3] || "";
    const heading = inner.match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/iu);
    if (!href || !heading) continue;
    const url = normalizeResultUrl(href, GOOGLE_HTML_ENDPOINT);
    const title = htmlToText(heading[1]);
    if (!url || !title) continue;
    sources.push({ title, url });
    if (sources.length >= maxResults * 2) break;
  }
  return deduplicateSources(sources, maxResults);
}

function parseDuckDuckGoHtml(html: string, maxResults: number): WebSearchSource[] {
  const sources: WebSearchSource[] = [];
  const anchorPattern =
    /<a\b[^>]*class\s*=\s*(["'])[^"']*result__a[^"']*\1[^>]*href\s*=\s*(?:"([^"]+)"|'([^']+)')[^>]*>([\s\S]*?)<\/a>/giu;
  for (const match of html.matchAll(anchorPattern)) {
    const href = match[2] || match[3];
    const url = href ? normalizeResultUrl(href, DUCKDUCKGO_HTML_ENDPOINT) : undefined;
    const title = match[4] ? htmlToText(match[4]) : "";
    if (!url || !title) continue;
    sources.push({ title, url });
    if (sources.length >= maxResults) break;
  }
  return deduplicateSources(sources, maxResults);
}

async function htmlSearch(
  query: string,
  endpoint: string,
  parser: (html: string, maxResults: number) => WebSearchSource[],
  provider: "google" | "duckduckgo",
  options: WebSearchOptions,
): Promise<WebSearchResult> {
  const url = new URL(endpoint);
  url.searchParams.set("q", query);
  url.searchParams.set("num", String(Math.min(options.maxResults ?? DEFAULT_MAX_RESULTS, 10)));
  url.searchParams.set("hl", "en");
  const response = await (options.fetchImpl ?? fetch)(url, {
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "User-Agent": "Mozilla/5.0 (compatible; ShelraCode/1.1; +https://shelra.dev)",
    },
    signal: requestSignal(options.signal),
  });
  if (!response.ok) throw new Error(`${provider} search returned HTTP ${response.status}`);
  const sources = parser(await response.text(), options.maxResults ?? DEFAULT_MAX_RESULTS);
  return result(query, provider, sources);
}

/**
 * Provider chain (docs/architecture/14-AGENT-HARNESS-RECONSTRUCTION.md §9): Tavily first when
 * configured (a real free-tier API, no card, no HTML scraping), then the existing Google/
 * DuckDuckGo path unchanged for zero-config and legacy-key users, then Exa/SearXNG/Brave as
 * further optional fallbacks in that order — Brave last because it now requires a card even
 * on its free tier. Google's Custom Search JSON API is closed to new signups and sunsetting
 * 2027-01-01 (confirmed 2026-09-13); it remains supported only for users who already have a key.
 */
export async function searchWeb(queryValue: string, options: WebSearchOptions = {}): Promise<WebSearchResult> {
  const query = queryValue.replace(/\s+/gu, " ").trim().slice(0, 500);
  const maxResults = Math.max(1, Math.min(options.maxResults ?? DEFAULT_MAX_RESULTS, 10));
  const normalizedOptions = { ...options, maxResults };
  if (!query) return result(query, "unavailable", [], "A search query is required.");

  const tavilyApiKey = options.tavilyApiKey || process.env.TAVILY_API_KEY;
  const googleApiKey =
    options.googleApiKey || process.env.SHELRA_GOOGLE_SEARCH_API_KEY || process.env.GOOGLE_SEARCH_API_KEY;
  const googleSearchEngineId =
    options.googleSearchEngineId || process.env.SHELRA_GOOGLE_SEARCH_ENGINE_ID || process.env.GOOGLE_SEARCH_ENGINE_ID;
  const exaApiKey = options.exaApiKey || process.env.EXA_API_KEY;
  const searxngBaseUrl = options.searxngBaseUrl || process.env.SEARXNG_BASE_URL;
  const braveApiKey = options.braveApiKey || process.env.BRAVE_SEARCH_API_KEY;
  let lastError = "No search provider returned results.";

  if (tavilyApiKey) {
    try {
      const sources = await tavilySearch(query, tavilyApiKey, normalizedOptions);
      if (sources.length > 0) return result(query, "tavily", sources);
      lastError = "Tavily returned no results.";
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  if (googleApiKey && googleSearchEngineId) {
    try {
      const sources = await googleApiSearch(query, googleApiKey, googleSearchEngineId, normalizedOptions);
      if (sources.length > 0) return result(query, "google-api", sources);
      lastError = "Google Custom Search returned no results.";
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  try {
    const google = await htmlSearch(query, GOOGLE_HTML_ENDPOINT, parseGoogleHtml, "google", normalizedOptions);
    if (google.success) return google;
    lastError = "Google returned no parseable results.";
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
  }

  try {
    const fallback = await htmlSearch(
      query,
      DUCKDUCKGO_HTML_ENDPOINT,
      parseDuckDuckGoHtml,
      "duckduckgo",
      normalizedOptions,
    );
    if (fallback.success) return fallback;
    lastError = "DuckDuckGo returned no parseable results.";
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
  }

  if (exaApiKey) {
    try {
      const sources = await exaSearch(query, exaApiKey, normalizedOptions);
      if (sources.length > 0) return result(query, "exa", sources);
      lastError = "Exa returned no results.";
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  if (searxngBaseUrl) {
    try {
      const sources = await searxngSearch(query, searxngBaseUrl, normalizedOptions);
      if (sources.length > 0) return result(query, "searxng", sources);
      lastError = "SearXNG returned no results.";
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  if (braveApiKey) {
    try {
      const sources = await braveSearch(query, braveApiKey, normalizedOptions);
      if (sources.length > 0) return result(query, "brave", sources);
      lastError = "Brave returned no results.";
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  return result(query, "unavailable", [], lastError);
}

/** Fetches a bounded public documentation page after the agent selects a source. */
export async function openWebPage(urlValue: string, options: WebPageOptions = {}): Promise<WebPageResult> {
  let url: URL;
  try {
    url = new URL(urlValue);
  } catch {
    return { success: false, url: urlValue, text: "", error: "URL is invalid." };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { success: false, url: url.toString(), text: "", error: "Only HTTP and HTTPS URLs are allowed." };
  }
  if (isBlockedWebHost(url.hostname)) {
    return { success: false, url: url.toString(), text: "", error: "Private and local network URLs are not allowed." };
  }

  try {
    const fetched = await fetchPublicPage(url, options);
    const response = fetched.response;
    if (!response.ok) throw new Error(`Page returned HTTP ${response.status}`);
    const contentType = response.headers.get("content-type") || undefined;
    const raw = await response.text();
    const titleMatch = raw.match(/<title\b[^>]*>([\s\S]*?)<\/title>/iu);
    const pageText = contentType?.includes("html") ? htmlToText(raw) : raw.replace(/\s+/gu, " ").trim();
    const maxChars = Math.max(500, options.maxChars ?? 12_000);
    return {
      success: true,
      url: fetched.url.toString(),
      ...(titleMatch?.[1] ? { title: htmlToText(titleMatch[1]) } : {}),
      text: pageText.slice(0, maxChars),
      ...(contentType ? { contentType } : {}),
    };
  } catch (error) {
    return {
      success: false,
      url: url.toString(),
      text: "",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function buildResearchQuery(prompt: string): string {
  const compact = prompt
    .replace(/[\r\n]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 420);
  return `${compact} official documentation technical reference`;
}

export function formatResearchForPrompt(research: WebSearchResult): string {
  if (!research.success) {
    return `Web research attempted for: ${research.query}\nNo web sources were available: ${research.error || "unknown error"}. Continue with local documentation and state this limitation if relevant.`;
  }
  return [
    "WEB RESEARCH (UNTRUSTED LEADS — VERIFY BEFORE RELYING ON THEM):",
    `Query: ${research.query}`,
    `Provider: ${research.provider}`,
    research.output,
    "Use open_web on the most relevant official documentation page when an external fact affects implementation.",
  ].join("\n");
}
