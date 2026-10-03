import { homedir, tmpdir } from "node:os";

/**
 * Results are committed to a public repository, so no local path may appear in them. A path can show up written with
 * forward slashes, single backslashes, or the doubled and quadrupled backslashes of JSON nested in JSON (a tool call's
 * arguments inside a result file), so each separator matches any run of slashes and backslashes.
 */
function pathPattern(path: string, suffix = ""): RegExp {
  const segments = path.split(/[\\/]+/u).filter(Boolean);
  const escaped = segments.map((segment) => segment.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"));
  return new RegExp(escaped.join("[\\\\/]+") + suffix, "giu");
}

/**
 * Replaces each named folder (most specific first), any scratch folder an evaluation made under the temporary
 * directory, and the home folder with a placeholder.
 */
export function redactPaths(text: string, folders: Record<string, string> = {}): string {
  let out = text;
  const entries = Object.entries(folders).sort(([, a], [, b]) => b.length - a.length);
  for (const [placeholder, folder] of entries) out = out.replace(pathPattern(folder), placeholder);
  out = out.replace(pathPattern(tmpdir(), "[\\\\/]+shelra-[A-Za-z0-9-]+"), "<root>");
  return (
    out
      .replace(pathPattern(homedir()), "~")
      // A table cut at its column width can leave a partial name ("…\Temp\she").
      .replace(/~[\\/]+AppData[\\/]+Local[\\/]+Temp[\\/]+[A-Za-z0-9-]*/giu, "<root>")
  );
}
