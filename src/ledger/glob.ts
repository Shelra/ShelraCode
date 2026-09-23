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

export function globToRegExp(pattern: string): RegExp {
  const normalized = pattern.replaceAll("\\", "/").replace(/^\.\//u, "").replace(/\/+$/u, "");
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
