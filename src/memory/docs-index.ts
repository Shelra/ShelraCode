/**
 * Document knowledge (docs/architecture/21-PROJECT-MEMORY-V2.md §5.4): which documents the project has, what each is
 * about, and whether it may be out of date. Memory never copies a document: it points to the source and says why it
 * matters, and the model reads the source when it needs it. The repository stays the authority.
 *
 * The index is built from the files git knows (tracked or not ignored), incrementally (a document whose size and
 * modified time did not change is not read again), and capped. Two signals say a document may be stale, both
 * mechanical:
 * - it still states a term the project dropped: a decision the ledger superseded, or a memory entry a newer one
 *   replaced, said "JSON files" or "SQLite", the document says it and never the term that replaced it, and it was not
 *   edited since the replacement;
 * - it names, in backticks, two or more repository paths that no longer exist, a third or more of those it names (a
 *   refactor moved them; agent instruction files rot this way).
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Decision } from "../ledger/types";
import { recordSwallowedError } from "../utils/diagnostics";
import { memoryDir } from "./store";
import { rawTerms, searchTerms } from "./terms";
import type { MemoryEntry, MemoryRecord, MemoryScope } from "./types";

export type DocKind = "instructions" | "readme" | "spec" | "guide" | "history" | "changelog";

export interface DocEntry {
  path: string;
  title: string;
  /** The first paragraph, clipped: what the document is about. */
  summary: string;
  headings: string[];
  bytes: number;
  mtimeMs: number;
  kind: DocKind;
  /** Repository paths the document names in backticks that do not exist (up to five). */
  missingPaths: string[];
  /** How many repository paths it names in backticks, and how many of them are gone. */
  namedPaths?: number;
  missingCount?: number;
}

export interface DocIndex {
  version: 1;
  builtAt: string;
  entries: DocEntry[];
}

const INDEX_FILE = "docs.json";
const MAX_DOCS = 300;
const MAX_DEPTH = 5;
const READ_BYTES = 64 * 1024;
const SUMMARY_CHARS = 220;
/** A process reuses its index this long before it looks at the files again. */
const REFRESH_MS = 30_000;
const GIT_TIMEOUT_MS = 3_000;
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".shelra",
  "dist",
  "build",
  "out",
  "coverage",
  "vendor",
  "third_party",
  ".next",
  "target",
  "decisions",
]);
const DOC_DIRS = new Set(["docs", "doc", "adr", "adrs", "specs", "spec", "rfcs"]);
/** Instruction files the prompt already carries. */
const LOADED_INSTRUCTIONS = new Set(["agents.md", "agents.override.md"]);
/** Instruction files written for other agents: pointed to, never loaded. */
const OTHER_AGENT_INSTRUCTIONS = new Set(["claude.md", "gemini.md", "copilot-instructions.md"]);

export function docsIndexPath(scope: MemoryScope): string {
  return join(memoryDir(scope), INDEX_FILE);
}

export function readDocIndex(scope: MemoryScope): DocIndex {
  const path = docsIndexPath(scope);
  if (!existsSync(path)) return { version: 1, builtAt: "", entries: [] };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as DocIndex;
    return { version: 1, builtAt: parsed.builtAt ?? "", entries: Array.isArray(parsed.entries) ? parsed.entries : [] };
  } catch (error) {
    recordSwallowedError("memory.docs.read", error);
    return { version: 1, builtAt: "", entries: [] };
  }
}

/** Markdown at the root, in `.github/`, and in the usual documentation folders: where a project keeps its documents. */
function inDocumentPlaces(path: string): boolean {
  const parts = path.split("/");
  if (!/\.mdx?$/iu.test(parts.at(-1) ?? "")) return false;
  if (parts.length === 1) return true;
  if (parts.length - 1 > MAX_DEPTH) return false;
  const dirs = parts.slice(0, -1).map((part) => part.toLowerCase());
  if (dirs[0] === ".github") return dirs.length === 1;
  if (!DOC_DIRS.has(dirs[0] ?? "")) return false;
  return !dirs.some((dir) => SKIP_DIRS.has(dir) || dir.startsWith("."));
}

/** The files git lists under `root` (tracked, or untracked and not ignored); null when git cannot say. */
function gitListed(root: string): string[] | null {
  const result = spawnSync(
    "git",
    ["--no-optional-locks", "ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "*.md", "*.mdx"],
    {
      cwd: root,
      encoding: "utf8",
      timeout: GIT_TIMEOUT_MS,
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    },
  );
  if (result.error || result.status !== 0) return null;
  return [...new Set((result.stdout ?? "").split("\0").filter(Boolean))];
}

/** Without git: the same places, walked. */
function walked(root: string): string[] {
  const found: string[] = [];
  const visit = (dir: string, rel: string, depth: number) => {
    if (depth > MAX_DEPTH || found.length >= MAX_DOCS * 2) return;
    for (const name of safeList(dir)) {
      const full = join(dir, name);
      const path = rel ? `${rel}/${name}` : name;
      let stat: ReturnType<typeof statSync>;
      try {
        stat = statSync(full);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        if (!SKIP_DIRS.has(name.toLowerCase()) && (!name.startsWith(".") || name === ".github"))
          visit(full, path, depth + 1);
      } else if (inDocumentPlaces(path)) {
        found.push(path);
      }
    }
  };
  for (const name of safeList(root)) {
    const full = join(root, name);
    if (inDocumentPlaces(name) && isFile(full)) found.push(name);
    else if ((DOC_DIRS.has(name.toLowerCase()) || name === ".github") && !isFile(full)) visit(full, name, 1);
  }
  return found;
}

/** The documents to index, shallowest first. */
function candidates(root: string): string[] {
  const listed = (gitListed(root) ?? walked(root)).map((path) => path.replaceAll("\\", "/")).filter(inDocumentPlaces);
  return [...new Set(listed)]
    .sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b))
    .slice(0, MAX_DOCS);
}

function safeList(dir: string): string[] {
  try {
    return readdirSync(dir).sort();
  } catch {
    return [];
  }
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

const HISTORY_PATH = /(^|\/)(history|archive|archived|old|deprecated|legacy|attic)(\/|$)/iu;
const HISTORY_TEXT =
  /\b(historical( record)?|kept for history|history only|this (document|page) is (superseded|obsolete|deprecated)|no longer (current|maintained|accurate)|status:\s*(superseded|obsolete|archived|deprecated))\b/iu;

function kindOf(path: string, head: string): DocKind {
  const name = path.split("/").pop()?.toLowerCase() ?? "";
  if (LOADED_INSTRUCTIONS.has(name) || OTHER_AGENT_INSTRUCTIONS.has(name)) return "instructions";
  if (HISTORY_PATH.test(path) || HISTORY_TEXT.test(head)) return "history";
  if (/^readme/iu.test(name)) return "readme";
  if (/^(changelog|changes|history)\b/iu.test(name)) return "changelog";
  if (/(^|\/)(specs?|rfcs?|adrs?)\//iu.test(path) || /\b(spec|specification|rfc|adr)\b/iu.test(name)) return "spec";
  return "guide";
}

/** At most this many named paths are checked per document. */
const MAX_NAMED_PATHS = 300;

/** The repository paths the document names in backticks, and those of them that do not exist. */
function namedPathsIn(root: string, text: string): { named: number; missing: string[] } {
  const named = new Set<string>();
  const missing: string[] = [];
  for (const match of text.matchAll(/`((?:\.\/)?(?:[\w@.-]+\/)+[\w.-]+\.[a-z0-9]{1,6})`/giu)) {
    const path = (match[1] ?? "").replace(/^\.\//u, "");
    if (!path || named.has(path) || /^(https?|www)\b/iu.test(path) || path.includes("..") || path.startsWith("~"))
      continue;
    const first = path.split("/")[0] ?? "";
    // Only a path into a top-level folder this repository has: anything else may name another project.
    if (!first || first.includes(".") || !existsSync(join(root, first))) continue;
    named.add(path);
    if (!existsSync(join(root, path))) missing.push(path);
    if (named.size >= MAX_NAMED_PATHS) break;
  }
  return { named: named.size, missing };
}

function parseDoc(root: string, path: string, stat: { size: number; mtimeMs: number }): DocEntry {
  const raw = readFileSync(join(root, path), "utf8").slice(0, READ_BYTES);
  const text = raw.replace(/^---[\s\S]*?\n---\s*\n/u, "");
  const lines = text.split(/\r?\n/u);
  const headings = lines
    .filter((line) => /^#{1,3}\s+\S/u.test(line))
    .map((line) => line.replace(/^#+\s*/u, "").trim())
    .slice(0, 14);
  const title = headings[0] ?? path.split("/").pop() ?? path;
  let summary = "";
  for (const block of text.split(/\r?\n\s*\r?\n/u)) {
    const flat = block.replace(/\s+/gu, " ").trim();
    if (!flat || /^(#|```|\||<!--|<|!\[|\[!\[)/u.test(flat)) continue;
    summary = flat.length > SUMMARY_CHARS ? `${flat.slice(0, SUMMARY_CHARS - 1)}…` : flat;
    break;
  }
  const paths = namedPathsIn(root, text);
  return {
    path,
    title,
    summary,
    headings,
    bytes: stat.size,
    mtimeMs: stat.mtimeMs,
    kind: kindOf(path, text.slice(0, 800)),
    missingPaths: paths.missing.slice(0, 5),
    namedPaths: paths.named,
    missingCount: paths.missing.length,
  };
}

const cache = new Map<string, { at: number; index: DocIndex }>();

/**
 * The index, rebuilt from the files when this process has not looked for a while; a document whose size and time did
 * not change is reused, not read. It is saved next to the memory only when the project already has one: a question in
 * a new folder creates nothing.
 */
export function refreshDocIndex(scope: MemoryScope, root: string, options: { force?: boolean } = {}): DocIndex {
  const cached = cache.get(root);
  if (!options.force && cached && Date.now() - cached.at < REFRESH_MS) return cached.index;
  const previous = new Map((cached?.index ?? readDocIndex(scope)).entries.map((entry) => [entry.path, entry]));
  const entries: DocEntry[] = [];
  for (const path of candidates(root)) {
    try {
      const stat = statSync(join(root, path));
      if (!stat.isFile()) continue;
      const known = previous.get(path);
      entries.push(
        known && known.bytes === stat.size && known.mtimeMs === stat.mtimeMs
          ? known
          : parseDoc(root, path, { size: stat.size, mtimeMs: stat.mtimeMs }),
      );
    } catch (error) {
      recordSwallowedError("memory.docs.parse", error);
    }
  }
  const index: DocIndex = { version: 1, builtAt: new Date().toISOString(), entries };
  cache.set(root, { at: Date.now(), index });
  try {
    if (existsSync(memoryDir(scope))) {
      const path = docsIndexPath(scope);
      writeFileSync(`${path}.tmp`, JSON.stringify(index), "utf8");
      renameSync(`${path}.tmp`, path);
    }
  } catch (error) {
    recordSwallowedError("memory.docs.write", error);
  }
  return index;
}

/** A term the project stopped using: what a replaced record said, what replaced it, and when. */
export interface Replacement {
  /** Words only the replaced record used, minus every word the project's current records still use. */
  dropped: string[];
  /** Words only the replacing record uses. */
  adopted: string[];
  /** ISO time the old value stopped being current. */
  until: string;
  /** What replaced it, for the prompt. */
  now: string;
}

const STALE_STOPWORDS = new Set(
  "use uses used using instead with from into that this then than also only each every always never must should the and for are was were will have has not our we through under over file files".split(
    " ",
  ),
);

/** Words compared by their first four letters: "storage" and "store" are one word here, "sqlite" and "duckdb" two. */
function stemOf(word: string): string {
  return word.slice(0, 4);
}

/** The words of a text by stem, paths split into their parts: "data/YYYY-MM.json" says "json". */
function words(text: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const term of rawTerms(text.replace(/[./_\\:-]+/gu, " "))) {
    if (term.length < 4 || STALE_STOPWORDS.has(term) || found.has(stemOf(term))) continue;
    found.set(stemOf(term), term);
  }
  return found;
}

const REPLACES_NOTE = /Replaces: (.+?) \(true until (\d{4}-\d{2}-\d{2})\)\./gu;

/**
 * What the project replaced, from the ledger (a superseded decision, against the decision now at the end of its chain)
 * and from memory (the "Replaces: … (true until …)" notes of a current entry and of the entries it replaced, back
 * along `supersedes`, so JSON → SQLite → DuckDB still knows JSON). A word counts as dropped only when no current record
 * says it any more, so "storage" in "Storage uses SQLite" is not one.
 */
export function replacementsFrom(
  records: readonly MemoryRecord[],
  decisions: readonly Decision[],
  readReplaced: (slug: string) => MemoryEntry | null = () => null,
): Replacement[] {
  const byId = new Map(decisions.map((decision) => [decision.id, decision]));
  const current = new Set<string>();
  for (const record of records) {
    for (const stem of words(`${record.index.title} ${record.index.hook}`).keys()) current.add(stem);
  }
  for (const decision of decisions) {
    if (decision.status !== "active") continue;
    for (const stem of words(`${decision.title} ${decision.rule}`).keys()) current.add(stem);
  }
  const pairs: Array<{ oldText: string; newText: string; until: string }> = [];
  for (const decision of decisions) {
    if (decision.status !== "superseded" || !decision.supersededBy) continue;
    const direct = byId.get(decision.supersededBy);
    let head = direct;
    for (let hops = 0; head?.status === "superseded" && head.supersededBy && hops < 20; hops++) {
      head = byId.get(head.supersededBy);
    }
    const until = direct?.approved ?? direct?.proposed;
    if (!head || head.status !== "active" || !until) continue;
    pairs.push({ oldText: decision.title, newText: head.title, until });
  }
  for (const record of records) {
    let entry: MemoryEntry | null = record.entry;
    const seen = new Set([record.slug]);
    while (entry) {
      for (const match of entry.body.matchAll(REPLACES_NOTE)) {
        pairs.push({ oldText: match[1] ?? "", newText: record.index.title, until: match[2] ?? "" });
      }
      const older: string | undefined = entry.frontmatter.metadata.supersedes;
      if (!older || seen.has(older) || seen.size > 20) break;
      seen.add(older);
      entry = readReplaced(older);
    }
  }
  const replacements: Replacement[] = [];
  for (const pair of pairs) {
    const before = words(pair.oldText);
    const after = words(pair.newText);
    const dropped = [...before].filter(([stem]) => !after.has(stem) && !current.has(stem)).map(([, word]) => word);
    const adopted = [...after].filter(([stem]) => !before.has(stem)).map(([, word]) => word);
    if (dropped.length > 0 && adopted.length > 0) {
      replacements.push({ dropped, adopted, until: pair.until, now: pair.newText.slice(0, 80) });
    }
  }
  // Oldest first: a document that still says "JSON" is stale since JSON was dropped, not since the next change.
  return replacements.sort((a, b) => a.until.slice(0, 10).localeCompare(b.until.slice(0, 10)));
}

/** Why a document may be stale, or null: a term the project dropped that it still states, or paths that are gone. */
export function staleness(entry: DocEntry, root: string, replacements: readonly Replacement[]): string | null {
  if (entry.kind === "history" || entry.kind === "changelog") return null;
  if (replacements.length > 0) {
    let text = "";
    try {
      text = readFileSync(join(root, entry.path), "utf8").slice(0, READ_BYTES);
    } catch {
      text = "";
    }
    const said = words(text);
    for (const replacement of replacements) {
      const until = Date.parse(replacement.until);
      if (Number.isFinite(until) && entry.mtimeMs > until + 24 * 60 * 60 * 1000) continue;
      const still = replacement.dropped.filter((word) => said.has(stemOf(word)));
      if (still.length > 0 && !replacement.adopted.some((word) => said.has(stemOf(word)))) {
        return `still says "${still.slice(0, 2).join(", ")}", replaced on ${replacement.until.slice(0, 10)} (now: ${replacement.now})`;
      }
    }
  }
  // Two gone paths, and at least a third of those it names: a log that names hundreds of current files and a few
  // removed ones is a record of what happened, not a stale description.
  const missing = entry.missingCount ?? entry.missingPaths.length;
  const named = entry.namedPaths ?? missing;
  if (missing >= 2 && missing * 3 >= named) {
    return `names paths that no longer exist (${entry.missingPaths.slice(0, 3).join(", ")})`;
  }
  return null;
}

export interface RankedDoc {
  entry: DocEntry;
  score: number;
  stale: string | null;
  matched: string[];
}

/** The documents a request is about, best first. The README and instruction files have lines of their own. */
export function rankDocs(
  index: DocIndex,
  request: string,
  root: string,
  replacements: readonly Replacement[],
  options: { max?: number } = {},
): RankedDoc[] {
  const max = options.max ?? 3;
  const wanted = new Set(searchTerms(request));
  const ranked: RankedDoc[] = [];
  for (const entry of index.entries) {
    if (entry.kind === "instructions" || entry.path.toLowerCase() === "readme.md") continue;
    const terms = new Set(searchTerms(`${entry.path} ${entry.title} ${entry.headings.join(" ")} ${entry.summary}`));
    const matched = [...wanted].filter((term) => terms.has(term));
    const score = matched.length - (entry.kind === "history" ? 1 : 0);
    if (score <= 0) continue;
    ranked.push({ entry, score, stale: null, matched });
  }
  const best = ranked.sort((a, b) => b.score - a.score || a.entry.path.localeCompare(b.entry.path)).slice(0, max);
  for (const item of best) item.stale = staleness(item.entry, root, replacements);
  return best;
}

/** One document as a prompt line. */
export function describeDoc(item: RankedDoc): string {
  const { entry } = item;
  const about = entry.summary ? ` — ${entry.summary}` : "";
  const kind = entry.kind === "history" ? " (history)" : "";
  const stale = item.stale ? ` [may be stale: ${item.stale}]` : "";
  return `- ${entry.path}: ${entry.title}${kind}${about}${stale}`;
}

/**
 * The documents section of a turn's context: what the project says it is (the root README's first paragraph), up to
 * three documents the request is about, each flagged when it may be stale, and a pointer to an instruction file written
 * for another agent. Nothing when the project has none of them.
 */
export function documentLines(
  index: DocIndex,
  request: string,
  root: string,
  replacements: readonly Replacement[],
): string[] {
  const lines: string[] = [];
  const readme = index.entries.find((entry) => entry.path.toLowerCase() === "readme.md");
  if (readme?.summary) {
    lines.push(describeDoc({ entry: readme, score: 0, stale: staleness(readme, root, replacements), matched: [] }));
  }
  for (const item of rankDocs(index, request, root, replacements)) lines.push(describeDoc(item));
  for (const entry of index.entries) {
    const name = entry.path.split("/").pop()?.toLowerCase() ?? "";
    if (!OTHER_AGENT_INSTRUCTIONS.has(name) || (entry.path.includes("/") && !entry.path.startsWith(".github/")))
      continue;
    lines.push(`- ${entry.path}: instructions written for another agent; AGENTS.md wins where they differ.`);
  }
  return lines;
}
