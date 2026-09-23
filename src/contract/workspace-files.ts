import { type Dirent, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/** Folders that hold dependencies, build output or tool state, never the project's own files. */
export const IGNORED_DIRS: ReadonlySet<string> = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".nuxt",
  ".svelte-kit",
  "out",
  "target",
  "vendor",
  "__pycache__",
  ".venv",
  "venv",
  ".shelra",
  ".cache",
  "coverage",
  ".turbo",
]);

export interface RepoFile {
  /** Relative to the workspace root, with forward slashes. */
  path: string;
  size: number;
}

/**
 * A bounded recursive listing of a workspace's own files: hidden and ignored folders are skipped, and
 * depth and count caps keep it fast on a large repository.
 */
export function listWorkspaceFiles(
  root: string,
  maxFiles = 400,
  maxDepth = 6,
): { files: RepoFile[]; truncated: boolean } {
  const files: RepoFile[] = [];
  let truncated = false;

  const walk = (dir: string, depth: number): void => {
    if (depth > maxDepth || files.length >= maxFiles) return;
    let entries: Dirent<string>[];
    try {
      // Bun's Node declarations choose the Buffer overload for ReturnType<typeof readdirSync>
      // even though an explicitly UTF-8 directory read returns string-named Dirents.
      entries = readdirSync(dir, { withFileTypes: true, encoding: "utf8" }) as Dirent<string>[];
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= maxFiles) {
        truncated = true;
        return;
      }
      if (entry.name.startsWith(".") && entry.name !== ".env.example") {
        if (entry.isDirectory()) continue;
      }
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        walk(full, depth + 1);
      } else if (entry.isFile()) {
        try {
          const st = statSync(full);
          files.push({ path: relative(root, full).split(sep).join("/"), size: st.size });
        } catch {
          // Unreadable entry; skip.
        }
      }
    }
  };

  walk(root, 0);
  return { files, truncated };
}
