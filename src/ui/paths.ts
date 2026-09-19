import { homedir } from "node:os";

/**
 * A working directory that fits `max` cells: home becomes `~`, and when it is still too long the
 * middle is dropped so both the drive/root and the project folder stay readable. Long absolute
 * paths used to wrap mid-name and break the footer.
 */
export function compactCwd(cwd: string, max: number, home: string = homedir()): string {
  const separator = cwd.includes("\\") ? "\\" : "/";
  const normalizedHome = home.replace(/[\\/]+$/, "");
  const shown =
    normalizedHome && cwd.toLowerCase().startsWith(normalizedHome.toLowerCase())
      ? `~${cwd.slice(normalizedHome.length)}`
      : cwd;
  if (shown.length <= max) return shown;

  const parts = shown.split(/[\\/]/).filter(Boolean);
  const head = shown.startsWith("~") ? "~" : (parts.shift() ?? "");
  if (head === "~") parts.shift();
  let tail = "";
  while (parts.length > 0) {
    const next = parts.at(-1) as string;
    const candidate = tail ? `${next}${separator}${tail}` : next;
    if (`${head}${separator}…${separator}${candidate}`.length > max) break;
    tail = candidate;
    parts.pop();
  }
  if (!tail) {
    const last = shown.split(/[\\/]/).filter(Boolean).at(-1) ?? shown;
    return `…${separator}${last}`.slice(-max);
  }
  return `${head}${separator}…${separator}${tail}`;
}

/** The folder name people recognise a project by. */
export function projectName(cwd: string): string {
  return cwd.split(/[\\/]/).filter(Boolean).at(-1) ?? cwd;
}
