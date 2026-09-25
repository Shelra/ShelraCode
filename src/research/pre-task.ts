import { isShortFollowUp } from "../contract/check-definitions";
import { looksInjectionShaped } from "../memory/gate";
import { searchTerms } from "../memory/terms";
import { searchWeb, type WebSearchOptions, type WebSearchResult, type WebSearchSource } from "./web";

/**
 * Research before the work (owner, 2026-09-25: "before planning or working, search Google for context that backs the
 * plan and the actions; the model gets more information about the objective"). Before the first model round of a work
 * turn, the host runs one web search on the request and hands the model the results the way its own `search_web`
 * call would, as a tool result.
 *
 * It reverses the 2026-09-17 removal of a forced search (doc 14 §23.2) with that removal's two failures designed out:
 * the old search ran before every prompt, "hello" included, and pasted untrusted snippets into the system prompt,
 * where a live prompt injection had been caught. Now a greeting, an approval or a question about memory is not
 * researched, and the results are data in a tool result, JSON-encoded, saying what they are and where they came from,
 * with any result that reads like an instruction withheld: Anthropic's guidance for untrusted content
 * (platform.claude.com, "Mitigate jailbreaks and prompt injections", checked 2026-09-25).
 */

/** The whole search, every provider in the chain included, gets at most this long; the turn never waits longer. */
export const RESEARCH_TIMEOUT_MS = 10_000;
const MAX_RESULTS = 5;
const SNIPPET_CHARS = 300;
const QUERY_WORDS = 32;

/** A request about Shelra's own memory is answered from memory, not from the web. */
const ABOUT_MEMORY_RE = /\b(?:memoria|memory|memories|recu[eé]rdame|remind me|remember)\b/iu;
/** A question about memory is short ("¿Qué tienes en la memoria?"); a longer request that mentions memory is work. */
const MEMORY_QUESTION_WORDS = 12;
/**
 * A request that asks for a search gets one, whatever else it mentions. Seen live 2026-09-25: "…si necesitas contexto
 * realiza una búsqueda profunda en google, documentación… puedes consultar la memoria" was not researched, because it
 * mentioned memory, and the model went straight to editing.
 */
const ASKS_FOR_SEARCH_RE =
  /\b(?:busca|buscar|b[uú]squeda|investiga|investigar|googl\w*|documentaci[oó]n|search|research|look\s+up)\b/iu;

/** `SHELRA_RESEARCH=off` turns the search before the work off. */
export function researchEnabled(): boolean {
  return (process.env.SHELRA_RESEARCH ?? "").trim().toLowerCase() !== "off";
}

/** Whether a request is work worth researching: not a greeting, an approval, or a question about memory. */
export function wantsResearch(request: string): boolean {
  const text = request.trim();
  if (!text || isShortFollowUp(text)) return false;
  if (ASKS_FOR_SEARCH_RE.test(text)) return true;
  if (ABOUT_MEMORY_RE.test(text) && text.split(/\s+/u).length <= MEMORY_QUESTION_WORDS) return false;
  return searchTerms(text).length >= 3;
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
