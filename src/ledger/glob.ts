/**
 * Workspace-relative glob matching for a decision's scope: `**` crosses folders, `*` and `?` stay inside one
 * path segment, and a pattern without wildcards matches that file or everything under that folder.
 */

function escapeRegExp(text: string): string {
  return text.replace(/[.+^${}()|[\]\\]/gu, "\\$&");
}

export function globToRegExp(pattern: string): RegExp {
  const normalized = pattern.replaceAll("\\", "/").replace(/^\.\//u, "").replace(/\/+$/u, "");
  if (!/[*?]/u.test(normalized)) {
    return new RegExp(`^${escapeRegExp(normalized)}(?:/.*)?$`, "u");
  }
  let source = "";
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
    } else {
      source += escapeRegExp(char);
    }
  }
  return new RegExp(`^${source}$`, "u");
}

/** Whether a workspace-relative path falls under any of the globs; an empty scope covers everything. */
export function inScope(path: string, scope: readonly string[]): boolean {
  if (scope.length === 0) return true;
  const normalized = path.replaceAll("\\", "/").replace(/^\.\//u, "");
  return scope.some((pattern) => globToRegExp(pattern).test(normalized));
}
