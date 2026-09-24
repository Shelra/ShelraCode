/**
 * Workspace-relative glob matching for a decision's scope: `**` crosses folders, `*` and `?` stay inside one
 * path segment, `{a,b}` is either alternative, and a pattern without wildcards matches that file or everything
 * under that folder.
 *
 * Matching walks the path once per pattern token, keeping the set of positions reached, so its cost is the
 * pattern's length times the path's. A regular expression backtracks instead: `*a*a…*x` against a long name took
 * minutes (review round 3, 2026-09-24), and a scope comes from a committed file that nobody vetted, while every
 * turn that changes a file matches it synchronously.
 */

/** Every `{` closes, and no `}` comes first: only then are braces alternatives rather than characters. */
function balancedBraces(pattern: string): boolean {
  let depth = 0;
  for (const char of pattern) {
    if (char === "{") depth += 1;
    else if (char === "}") depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0;
}

/** How many `**` a proposed pattern may hold: past three, a scope says nothing a simpler one would not. */
export const MAX_GLOBSTARS = 3;
/** How many brace alternatives one pattern may expand to; past it the scope covers every path. */
const MAX_ALTERNATIVES = 256;
/** How long a pattern may be; past it the scope covers every path rather than risk the expansion's depth. */
const MAX_PATTERN_LENGTH = 1_024;
/** Marks where a brace group was, so the stars on either side of it never fuse into a globstar. */
const BRACE_EDGE = "\u0000";

/** Separators, a leading `./`, a trailing slash and runs of globstars normalized to their plain meaning. */
export function normalizeGlob(pattern: string): string {
  return pattern
    .replaceAll("\\", "/")
    .replace(/^\.\//u, "")
    .replace(/\/+$/u, "")
    .replace(/\*{3,}/gu, "**")
    .replace(/(?:\*\*\/)+\*\*/gu, "**")
    .replace(/(?:\*\*\/)+/gu, "**/");
}

/** Why a proposed scope glob is not a readable rule, or null when it is. */
export function globProblem(pattern: string): string | null {
  const normalized = normalizeGlob(pattern);
  if (normalized.length > MAX_PATTERN_LENGTH) return `a scope glob is longer than ${MAX_PATTERN_LENGTH} characters`;
  const globstars = normalized.match(/\*\*/gu)?.length ?? 0;
  if (globstars > MAX_GLOBSTARS) return `${pattern} holds more than ${MAX_GLOBSTARS} "**"`;
  return null;
}

/** The pattern with each `{a,b}` group replaced by each alternative, nested groups too; null past the limit. */
function expandBraces(pattern: string): string[] | null {
  const open = pattern.indexOf("{");
  if (open < 0) return [pattern];
  let depth = 0;
  let close = -1;
  const commas: number[] = [];
  for (let index = open; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        close = index;
        break;
      }
    } else if (char === "," && depth === 1) commas.push(index);
  }
  const expanded: string[] = [];
  let from = open + 1;
  for (const end of [...commas, close]) {
    const rest = expandBraces(
      `${pattern.slice(0, open)}${BRACE_EDGE}${pattern.slice(from, end)}${BRACE_EDGE}${pattern.slice(close + 1)}`,
    );
    if (!rest) return null;
    expanded.push(...rest);
    if (expanded.length > MAX_ALTERNATIVES) return null;
    from = end + 1;
  }
  return expanded;
}

type Token = { kind: "char"; char: string } | { kind: "any-char" | "star" | "globstar" | "globstar-slash" };

function tokenize(pattern: string): Token[] {
  const tokens: Token[] = [];
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index] as string;
    if (char === BRACE_EDGE) continue;
    if (char === "*" && pattern[index + 1] === "*") {
      const slash = pattern[index + 2] === "/";
      tokens.push({ kind: slash ? "globstar-slash" : "globstar" });
      index += slash ? 2 : 1;
    } else if (char === "*") tokens.push({ kind: "star" });
    else if (char === "?") tokens.push({ kind: "any-char" });
    else tokens.push({ kind: "char", char });
  }
  return tokens;
}

/** One alternative against the path: `reached[i]` says the tokens so far can consume exactly `path[0..i)`. */
function matchTokens(tokens: readonly Token[], path: string, folderSuffix: boolean): boolean {
  const length = path.length;
  let reached = new Uint8Array(length + 1);
  reached[0] = 1;
  for (const token of tokens) {
    const next = new Uint8Array(length + 1);
    if (token.kind === "char" || token.kind === "any-char") {
      for (let index = 0; index < length; index += 1) {
        const fits = token.kind === "char" ? path[index] === token.char : path[index] !== "/";
        if (reached[index] && fits) next[index + 1] = 1;
      }
    } else if (token.kind === "star") {
      // Any run of characters inside the current segment.
      let open = false;
      for (let index = 0; index <= length; index += 1) {
        if (reached[index]) open = true;
        if (open) next[index] = 1;
        if (path[index] === "/") open = false;
      }
    } else if (token.kind === "globstar") {
      // Any run of characters, across segments.
      let open = false;
      for (let index = 0; index <= length; index += 1) {
        if (reached[index]) open = true;
        if (open) next[index] = 1;
      }
    } else {
      // `**/`: nothing, or any run of whole segments ending in a slash.
      let open = false;
      for (let index = 0; index <= length; index += 1) {
        if (reached[index]) {
          next[index] = 1;
          open = true;
        }
        if (open && path[index] === "/") next[index + 1] = 1;
      }
    }
    reached = next;
  }
  if (reached[length]) return true;
  // A pattern without wildcards also covers everything under the folder it names.
  if (folderSuffix)
    for (let index = 0; index < length; index += 1) if (reached[index] && path[index] === "/") return true;
  return false;
}

/** Whether one scope glob covers a workspace-relative path (already written with forward slashes). */
export function globMatches(pattern: string, path: string): boolean {
  const normalized = normalizeGlob(pattern);
  // A pattern too long, or with too many alternatives, to try: over-cover rather than let a decision miss
  // the change (or a committed file stall the turn).
  if (normalized.length > MAX_PATTERN_LENGTH) return true;
  const folderSuffix = !/[*?]/u.test(normalized);
  const alternatives = balancedBraces(normalized) ? expandBraces(normalized) : [normalized];
  if (!alternatives) return true;
  return alternatives.some((alternative) => matchTokens(tokenize(alternative), path, folderSuffix));
}

/**
 * Whether paths differing only in case name the same file, as on Windows and macOS: a scope `src/**` covers
 * `Src/index.ts` there, which is how a model may spell a path it writes (review round 3, 2026-09-24).
 */
const FOLDS_CASE = process.platform === "win32" || process.platform === "darwin";

/** A workspace-relative path as the filesystem compares it: forward slashes, no `./`, case folded where it folds. */
export function foldPath(path: string, foldCase = FOLDS_CASE): string {
  const normalized = path.replaceAll("\\", "/").replace(/^\.\//u, "");
  return foldCase ? normalized.toLowerCase() : normalized;
}

/** Whether a workspace-relative path falls under any of the globs; an empty scope covers everything. */
export function inScope(path: string, scope: readonly string[], foldCase = FOLDS_CASE): boolean {
  if (scope.length === 0) return true;
  const normalized = foldPath(path, foldCase);
  return scope.some((pattern) => globMatches(foldCase ? pattern.toLowerCase() : pattern, normalized));
}
