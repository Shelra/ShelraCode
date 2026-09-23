import { spawnSync } from "node:child_process";
import { type Dirent, readdirSync, statSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { findGitRoot } from "../utils/git-root";

/**
 * What the workspace looks like, cheaply enough to read at the start of a turn, after every passing
 * check and at the end. Comparing two readings tells the completion gate which files the turn
 * changed by any means (file tools, a shell command, a generator the model ran) and whether anything
 * changed after the last passing check. The audit of 2026-09-23 reproduced both gaps: a change made
 * through the shell never reached the gate, and a check that passed before later edits still counted.
 *
 * In a git repository the reading is `git status` plus the size and modification time of every
 * changed or untracked file, so ignored output (builds, caches, coverage) never counts. Elsewhere it
 * is a bounded walk that skips the usual generated folders. A reading that could not be made reliably
 * is "unknown", and nothing may be concluded from it.
 */

export interface WorkspaceState {
  kind: "git" | "walk" | "unknown";
  /** Path relative to the workspace → a signature that changes when the file changes. */
  files: Map<string, string>;
}

/** Generated output, dependencies and Shelra's own state: never the user's change. */
const IGNORED_DIRS = new Set([
  ".git",
  ".shelra",
  "node_modules",
  "dist",
  "build",
  "out",
  "coverage",
  ".next",
  ".turbo",
  ".cache",
  ".nyc_output",
  ".parcel-cache",
  ".svelte-kit",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  ".venv",
  "venv",
  "target",
]);
const MAX_WALK_FILES = 20_000;
const GIT_TIMEOUT_MS = 10_000;
const UNKNOWN: WorkspaceState = { kind: "unknown", files: new Map() };

function signature(path: string): string {
  try {
    const stat = statSync(path);
    return `${stat.size}:${Math.round(stat.mtimeMs)}`;
  } catch {
    return "deleted";
  }
}

function ignored(relativePath: string): boolean {
  return relativePath.split(/[\\/]/u).some((segment) => IGNORED_DIRS.has(segment));
}

function captureGit(cwd: string, gitRoot: string): WorkspaceState | null {
  const result = spawnSync("git", ["-C", gitRoot, "status", "--porcelain=v1", "-z", "--untracked-files=all"], {
    encoding: "utf8",
    timeout: GIT_TIMEOUT_MS,
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error || result.status !== 0 || typeof result.stdout !== "string") return null;
  const files = new Map<string, string>();
  const entries = result.stdout.split("\0");
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index] as string;
    if (entry.length < 4) continue;
    const status = entry.slice(0, 2);
    const path = entry.slice(3);
    // A rename or copy is followed by its original path, which is not a separate change.
    if (status.includes("R") || status.includes("C")) index += 1;
    const full = join(gitRoot, path);
    const relativePath = relative(cwd, full).replace(/\\/g, "/");
    if (ignored(relativePath)) continue;
    files.set(relativePath, signature(full));
  }
  return { kind: "git", files };
}

function captureWalk(cwd: string): WorkspaceState {
  const files = new Map<string, string>();
  const pending = [cwd];
  while (pending.length > 0) {
    const directory = pending.pop() as string;
    let entries: Dirent[];
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      const full = join(directory, entry.name);
      if (entry.isDirectory()) {
        pending.push(full);
      } else if (entry.isFile()) {
        files.set(relative(cwd, full).replace(/\\/g, "/"), signature(full));
        if (files.size > MAX_WALK_FILES) return UNKNOWN;
      }
    }
  }
  return { kind: "walk", files };
}

/** Reads the workspace. Never throws: a failure reads as "unknown". */
export function captureWorkspaceState(cwd: string): WorkspaceState {
  try {
    const gitRoot = findGitRoot(cwd);
    if (gitRoot) {
      const state = captureGit(cwd, gitRoot);
      if (state) return state;
    }
    return captureWalk(cwd);
  } catch {
    return UNKNOWN;
  }
}

/**
 * Files that differ between two readings, or `null` when the readings cannot be compared (either is
 * unknown, or they were read differently).
 */
export function changedPaths(before: WorkspaceState, after: WorkspaceState): string[] | null {
  if (before.kind === "unknown" || after.kind === "unknown" || before.kind !== after.kind) return null;
  const changed = new Set<string>();
  for (const [path, value] of after.files) if (before.files.get(path) !== value) changed.add(path);
  for (const path of before.files.keys()) if (!after.files.has(path)) changed.add(path);
  return [...changed].sort();
}

/**
 * Whether `path` (relative to `cwd`) existed when `start` was read. A walk lists every file; git status lists
 * only what differed from the last commit, so an unlisted file existed if git tracks it.
 */
export function existedAt(start: WorkspaceState, cwd: string, path: string): boolean {
  const signatureAtStart = start.files.get(path);
  if (signatureAtStart !== undefined) return signatureAtStart !== "deleted";
  if (start.kind !== "git") return false;
  const result = spawnSync("git", ["-C", cwd, "ls-files", "--error-unmatch", "--", path], {
    encoding: "utf8",
    timeout: GIT_TIMEOUT_MS,
    windowsHide: true,
  });
  return !result.error && result.status === 0;
}

/** One list of changed files from two sources, relative to the workspace, without duplicates. */
export function mergeChangedFiles(cwd: string, ...lists: ReadonlyArray<readonly string[]>): string[] {
  const merged = new Map<string, string>();
  for (const list of lists) {
    for (const path of list) {
      const relativePath = (isAbsolute(path) ? relative(cwd, path) : path).replace(/\\/g, "/").replace(/^\.\//u, "");
      const key = relativePath.toLowerCase();
      if (!merged.has(key)) merged.set(key, relativePath);
    }
  }
  return [...merged.values()];
}
