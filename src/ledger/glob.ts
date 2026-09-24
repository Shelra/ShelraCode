/**
 * Workspace-relative glob matching for a decision's scope: `**` crosses folders, `*` and `?` stay inside one
 * path segment, `{a,b}` is either alternative, and a pattern without wildcards matches that file or everything
 * under that folder.
 */

function escapeRegExp(text: string): string {
  return text.replace(/[.+^${}()|[\]\\]/gu, "\\$&");
}

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

/** How many `**` one pattern may hold: each one is a backtracking point against a deep path. */
export const MAX_GLOBSTARS = 3;

/**
 * A run of globstars (star-star-slash repeated) means what one globstar means, but compiled naively it
 * backtracks exponentially against a deep path (a 12-fold pattern took over a minute); runs of stars
 * collapse before anything is compiled.
 */
export function normalizeGlob(pattern: string): string {
  return pattern
    .replaceAll("\\", "/")
    .replace(/^\.\//u, "")
    .replace(/\/+$/u, "")
    .replace(/\*{3,}/gu, "**")
    .replace(/(?:\*\*\/)+\*\*/gu, "**")
    .replace(/(?:\*\*\/)+/gu, "**/");
}

/** Why a scope glob cannot be compiled safely, or null when it can. */
export function globProblem(pattern: string): string | null {
  const normalized = normalizeGlob(pattern);
  const globstars = normalized.match(/\*\*/gu)?.length ?? 0;
  if (globstars > MAX_GLOBSTARS) return `${pattern} holds more than ${MAX_GLOBSTARS} "**"`;
  return null;
}

export function globToRegExp(pattern: string): RegExp {
  const normalized = normalizeGlob(pattern);
  const alternatives = balancedBraces(normalized);
  let source = "";
  let depth = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index] as string;
    if (char === "*" && normalized[index + 1] === "*") {
      const slash = normalized[index + 2] === "/";
      source += slash ? "(?:.*/)?" : ".*";
      index += slash ? 2 : 1;
    } else if (char === "*") {
      source += "[^/]*";
    } else if (char === "?") {
      source += "[^/]";
    } else if (alternatives && char === "{") {
      depth += 1;
      source += "(?:";
    } else if (alternatives && char === "}") {
      depth -= 1;
      source += ")";
    } else if (alternatives && char === "," && depth > 0) {
      source += "|";
    } else {
      source += escapeRegExp(char);
    }
  }
  return new RegExp(`^${source}${/[*?]/u.test(normalized) ? "" : "(?:/.*)?"}$`, "u");
}

/** Whether a workspace-relative path falls under any of the globs; an empty scope covers everything. */
export function inScope(path: string, scope: readonly string[]): boolean {
  if (scope.length === 0) return true;
  const normalized = path.replaceAll("\\", "/").replace(/^\.\//u, "");
  return scope.some((pattern) => globToRegExp(pattern).test(normalized));
}
