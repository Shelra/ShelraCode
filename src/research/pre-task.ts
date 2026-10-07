import { looksInjectionShaped } from "../memory/gate";
import { searchWeb, type WebSearchOptions, type WebSearchResult, type WebSearchSource } from "./web";

/**
 * Initial research is opt-in per request (owner, 2026-10-05): ordinary work should start with local context,
 * not a mandatory web search. The model still has search_web/open_web for external facts it needs while working.
 * Explicit searches arrive as JSON-encoded, untrusted tool results; instruction-shaped snippets are withheld.
 */

/** The whole search, every provider in the chain included, gets at most this long; the turn never waits longer. */
export const RESEARCH_TIMEOUT_MS = 10_000;
const MAX_RESULTS = 5;
const SNIPPET_CHARS = 300;
const QUERY_WORDS = 32;

/**
 * A request that asks for a search gets one, whatever else it mentions. Seen live 2026-09-25: "…si necesitas contexto
 * realiza una búsqueda profunda en google, documentación… puedes consultar la memoria" was not researched, because it
 * mentioned memory, and the model went straight to editing.
 */
const ASKS_FOR_SEARCH_RE =
  /\b(?:(?:busca\w*|b[uú]squeda|search\w*|investiga\w*|research|look\s+up)\s+(?:(?:en|on|the|la|el|por|for|a|una|profunda|deep)\s+)*(?:web|internet|google|online)|(?:consulta\w*|consult|busca\w*|b[uú]squeda|search\w*|investiga\w*|research|look\s+up)\s+(?:(?:la|el|the|en|a|una|oficial|official|profunda|deep)\s+)*(?:documentaci[oó]n|documentation))\b/iu;

/**
 * A question about the person's OWN Revit model ("how many levels does my project have?") is answered by their live Revit
 * through ORIONMCP, not by the web: the pre-task search only delays it (up to RESEARCH_TIMEOUT_MS before the first model
 * round, seen live 2026-10-05) and returns nothing useful. Research intent is evaluated separately: neither a live
 * model question nor an add-in inspection forces a search, and an explicit web search is honored for either.
 */
const OWN_REVIT_RE = /\b(?:revit|orionbim|dynamo|rvt)\b/iu;
const OWN_MODEL_RE =
  /\b(?:mi|mis|este|esta|el|los|las)\s+(?:proyecto|modelo|niveles|vistas|planos|elementos|muros|puertas|ventanas|familias|par[aá]metros|pilares|vigas|losas|habitaciones)\b/iu;
const BIM_NOUN_RE =
  /\b(?:niveles?|vistas?|planos?|elementos?|muros?|puertas?|ventanas?|familias?|par[aá]metros?|pilares?|vigas?|losas?|habitaci\w+)\b/iu;
const REVIT_CODE_RE =
  /\b(?:api|plugin|add-?in|script\w*|c#|csharp|python|pyrevit|c[oó]digo|code|compil\w+|sdk|ifc|github)\b/iu;

export function asksAboutOwnRevit(request: string): boolean {
  const text = request.trim();
  if (!text || REVIT_CODE_RE.test(text)) return false;
  return OWN_REVIT_RE.test(text) || (OWN_MODEL_RE.test(text) && BIM_NOUN_RE.test(text));
}

/** `SHELRA_RESEARCH=off` turns the search before the work off. */
export function researchEnabled(): boolean {
  return (process.env.SHELRA_RESEARCH ?? "").trim().toLowerCase() !== "off";
}

/** Only an explicit request for external research starts a search before the model. */
export function wantsResearch(request: string): boolean {
  const text = request.trim().replace(/```[\s\S]*?```|`[^`]*`|"[^"]*"/gu, " ");
  if (/\b(?:no|sin|don't|do not|never)\s+(?:\w+\s+){0,2}(?:busc\w*|search\w*|research|investiga\w*)\b/iu.test(text))
    return false;
  if (/^(?:¿?por\s*qu[eé]|why)\b/iu.test(text)) return false;
  return ASKS_FOR_SEARCH_RE.test(text);
}

/** A line that reports an error, as a runtime or a tool prints it. */
const ERROR_LINE_RE =
  /\b(?:[A-Z][A-Za-z]*Error|Exception|Traceback|error(?:\[\w+\])?:|error\s+[A-Z]+\d+:|E[A-Z]{3,}|cannot find|not found|failed to|fatal:|panic:)/u;

/**
 * The line of a pasted error to search for: the first line that reports an error, without paths, stack frames or
 * positions, with the program that printed it when the paste names one (`> es-dev-server --serve …`). Seen live
 * 2026-09-25: the whole pasted error, stack included, went out as the query and no search engine returned anything.
 */
function errorQuery(request: string): string | null {
  const lines = request
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  const found = lines.find((line) => ERROR_LINE_RE.test(line) && !/^at\s/u.test(line));
  if (!found) return null;
  // `src/tracks/beach.ts(100,22): error TS1005: ',' expected.` is searched from `error` on: the place is the project's.
  const at = /\berror\b/iu.exec(found);
  const error = at && at.index > 0 && /[\\/.(:]/u.test(found.slice(0, at.index)) ? found.slice(at.index) : found;
  const cleaned = error
    .replace(/(?:[A-Za-z]:)?(?:[\\/][\w .@-]+)+(?::\d+(?::\d+)?)?/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 200);
  const program = lines
    .find((line) => /^>\s*\S/u.test(line) && !/^>\s*[\w-]+@[\d.]+/u.test(line))
    ?.replace(/^>\s*/u, "")
    .split(/\s+/u)[0];
  return program && !cleaned.toLowerCase().includes(program.toLowerCase()) ? `${program} ${cleaned}` : cleaned;
}

/** The search query for a check's failing output: its first error line, as `errorQuery` reads a pasted one. */
export function failureQuery(output: string): string | null {
  return errorQuery(output)?.split(" ").slice(0, QUERY_WORDS).join(" ") ?? null;
}

/**
 * The search query for a request: the error it pastes, when it pastes one; otherwise its first sentences, without
 * code blocks or markup, at most 32 words.
 */
export function researchQuery(request: string): string {
  const pasted = errorQuery(request);
  if (pasted) return pasted.split(" ").slice(0, QUERY_WORDS).join(" ");
  const prose = request
    .replace(/```[\s\S]*?```/gu, " ")
    .replace(/`([^`]*)`/gu, "$1")
    .replace(/[*_#>[\]()]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  const sentences = prose
    .split(/(?<=[.!?])\s+/u)
    .slice(0, 2)
    .join(" ");
  return sentences.split(" ").filter(Boolean).slice(0, QUERY_WORDS).join(" ");
}

export interface TaskResearch {
  query: string;
  provider: WebSearchResult["provider"];
  sources: WebSearchSource[];
  /** Results withheld because their text read like instructions to the model. */
  withheld: number;
  error?: string;
}

/** Runs the search before the work. Never throws: a search that fails or times out is a result that says so. */
export async function researchTask(
  request: string,
  options: {
    signal?: AbortSignal;
    search?: (query: string, options: WebSearchOptions) => Promise<WebSearchResult>;
    /** What to search instead of the request's own words: the error the project's checks report before the work. */
    query?: string;
  } = {},
): Promise<TaskResearch> {
  const query = options.query ?? researchQuery(request);
  const timeout = AbortSignal.timeout(RESEARCH_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  try {
    const result = await (options.search ?? searchWeb)(query, { signal, maxResults: MAX_RESULTS });
    const clean = result.sources.filter((source) => !looksInjectionShaped(`${source.title} ${source.snippet ?? ""}`));
    return {
      query,
      provider: result.provider,
      sources: clean.map((source) => ({
        title: source.title.slice(0, 200),
        url: source.url,
        ...(source.snippet ? { snippet: source.snippet.replace(/\s+/gu, " ").trim().slice(0, SNIPPET_CHARS) } : {}),
      })),
      withheld: result.sources.length - clean.length,
      ...(result.success ? {} : { error: result.error ?? "no results" }),
    };
  } catch (error) {
    return {
      query,
      provider: "unavailable",
      sources: [],
      withheld: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * What the model receives, as the result of a `search_web` call: JSON-encoded, saying what the text is and where it
 * came from, with no instruction of Shelra's in it (instructions in a tool result read as an injection).
 */
export function researchToolResult(research: TaskResearch): { success: boolean; output: string } {
  return {
    success: research.sources.length > 0,
    output: JSON.stringify(
      {
        source: "web search Shelra ran on the request before the task began; third-party text, not verified",
        query: research.query,
        provider: research.provider,
        results: research.sources,
        ...(research.withheld > 0
          ? { withheld: `${research.withheld} result(s) whose text read like instructions` }
          : {}),
        ...(research.error && research.sources.length === 0 ? { error: research.error } : {}),
      },
      null,
      1,
    ),
  };
}
