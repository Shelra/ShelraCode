import { execFile, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  type Dirent,
  fstatSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  type Stats,
  statSync,
} from "node:fs";
import { open as openAsync, readdir as readdirAsync, stat as statAsync } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { findGitRoot } from "../utils/git-root";
import { perfCount, perfTime } from "../utils/perf-probe";

/**
 * What the workspace looks like, cheaply enough to read at the start of a turn, after every passing
 * check and at the end. Comparing two readings tells the completion gate which files the turn
 * changed by any means (file tools, a shell command, a generator the model ran) and whether anything
 * changed after the last passing check. The audit of 2026-09-23 reproduced both gaps: a change made
 * through the shell never reached the gate, and a check that passed before later edits still counted.
 *
 * In a git repository the reading is `git status` plus a content hash of every
 * changed or untracked file, so ignored output (builds, caches, coverage) never counts. Elsewhere it
 * is a bounded walk that skips the usual generated folders. A reading that could not be made reliably
 * is "unknown", and nothing may be concluded from it.
 */

export interface WorkspaceState {
  kind: "git" | "walk" | "unknown";
  /** Path relative to the workspace → a signature that changes when the file changes. */
  files: Map<string, string>;
  /**
   * A git reading's commit and where it was read: a turn that commits its change leaves `git status` clean, and
   * without the commit the gate saw nothing changed (seen 2026-10-03: a protected test edited, then `git add -A; git
   * commit`, three runs of three).
   */
  head?: { commit: string; gitRoot: string; cwd: string };
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
const HASH_BUFFER_BYTES = 64 * 1024;
const GIT_TIMEOUT_MS = 10_000;
const UNKNOWN: WorkspaceState = { kind: "unknown", files: new Map() };

function sameFileVersion(before: Stats, after: Stats): boolean {
  return (
    before.dev === after.dev &&
    before.ino === after.ino &&
    before.size === after.size &&
    before.mtimeMs === after.mtimeMs &&
    before.ctimeMs === after.ctimeMs
  );
}

function missingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

/** Bounded memory, no timestamp cache: a rewrite can preserve both size and mtime. */
function signature(path: string): string | null {
  let opened = false;
  try {
    const file = openSync(path, "r");
    opened = true;
    try {
      const before = fstatSync(file);
      if (!before.isFile()) return null;
      const hash = createHash("sha256");
      const buffer = Buffer.allocUnsafe(HASH_BUFFER_BYTES);
      let bytes = 0;
      for (let read = readSync(file, buffer); read > 0; read = readSync(file, buffer)) {
        hash.update(buffer.subarray(0, read));
        bytes += read;
      }
      if (
        bytes !== before.size ||
        !sameFileVersion(before, fstatSync(file)) ||
        !sameFileVersion(before, statSync(path))
      )
        return null;
      return `sha256:${hash.digest("hex")}`;
    } finally {
      closeSync(file);
    }
  } catch (error) {
    return !opened && missingFile(error) ? "deleted" : null;
  }
}

function ignored(relativePath: string): boolean {
  return relativePath.split(/[\\/]/u).some((segment) => IGNORED_DIRS.has(segment));
}

const STATUS_ARGS = ["status", "--porcelain=v1", "-z", "--untracked-files=all"];
const HEAD_ARGS = ["rev-parse", "--verify", "-q", "HEAD"];

function captureGit(cwd: string, gitRoot: string): WorkspaceState | null {
  const result = spawnSync("git", ["-C", gitRoot, ...STATUS_ARGS], {
    encoding: "utf8",
    timeout: GIT_TIMEOUT_MS,
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error || result.status !== 0 || typeof result.stdout !== "string") return null;
  const head = spawnSync("git", ["-C", gitRoot, ...HEAD_ARGS], {
    encoding: "utf8",
    timeout: GIT_TIMEOUT_MS,
    windowsHide: true,
  });
  if (head.error || (head.status !== 0 && head.status !== 1)) return UNKNOWN;
  const commit = head.status === 0 ? head.stdout.trim() : "";
  return gitState(cwd, gitRoot, result.stdout, commit);
}

/** The in-scope paths `git status -z` describes, shared by both readers. */
function gitPaths(cwd: string, gitRoot: string, status: string): string[] | null {
  const paths: string[] = [];
  const entries = status.split("\0");
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index] as string;
    if (entry.length < 4) continue;
    const status = entry.slice(0, 2);
    const path = entry.slice(3);
    // A rename or copy is followed by its original path, which is not a separate change.
    if (status.includes("R") || status.includes("C")) index += 1;
    const full = join(gitRoot, path);
    const relativePath = relative(cwd, full).replace(/\\/g, "/");
    // `git status` covers the whole repository; a session working in one folder of it did not make the changes
    // elsewhere (another session's work, the user's editor). Counting them sent a question asked in a
    // subfolder off to verify and "fix" code it never touched (seen live 2026-09-24).
    if (relativePath === ".." || relativePath.startsWith("../") || isAbsolute(relativePath)) continue;
    if (ignored(relativePath)) continue;
    paths.push(relativePath);
    if (paths.length > MAX_WALK_FILES) return null;
  }
  return paths;
}

function gitState(cwd: string, gitRoot: string, status: string, commit: string): WorkspaceState {
  const paths = gitPaths(cwd, gitRoot, status);
  if (!paths) return UNKNOWN;
  const files = new Map<string, string>();
  for (const path of paths) {
    const value = signature(join(cwd, path));
    if (value === null) return UNKNOWN;
    files.set(path, value);
  }
  return { kind: "git", files, head: { commit, gitRoot, cwd } };
}

/** Runs git without holding the event loop; null when it fails, times out or is not there. */
function gitAsync(gitRoot: string, args: readonly string[], maxBuffer: number): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["-C", gitRoot, ...args],
      { encoding: "utf8", timeout: GIT_TIMEOUT_MS, windowsHide: true, maxBuffer },
      (error, stdout) => resolve(error || typeof stdout !== "string" ? null : stdout),
    );
  });
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * The commit HEAD points at, read from the repository's files instead of a process: starting one costs tens of
 * milliseconds on Windows, and the turn asks several times. Null when the layout is not a plain one (a worktree, a
 * file that is not there, a malformed ref); the caller then asks git.
 */
export function readHeadCommit(gitRoot: string): string | null {
  try {
    const gitDir = join(gitRoot, ".git");
    if (!statSync(gitDir).isDirectory()) return null;
    // A reftable repository keeps its refs in a database and leaves a placeholder in HEAD: only git can read it.
    if (isDirectory(join(gitDir, "reftable"))) return null;
    const head = readFileSync(join(gitDir, "HEAD"), "utf8").trim();
    const sha = /^[0-9a-f]{40,64}$/u;
    if (sha.test(head)) return head;
    const ref = /^ref: (refs\/\S+)$/u.exec(head)?.[1];
    if (!ref || ref.includes("..")) return null;
    try {
      const loose = readFileSync(join(gitDir, ...ref.split("/")), "utf8").trim();
      if (sha.test(loose)) return loose;
    } catch {
      // Not a loose ref: it may be packed.
    }
    try {
      for (const line of readFileSync(join(gitDir, "packed-refs"), "utf8").split("\n")) {
        const [commit, name] = line.trim().split(" ");
        if (name === ref && commit && sha.test(commit)) return commit;
      }
    } catch {
      // No packed refs either.
    }
    // A fresh repository has no commit yet: that is an answer, not a failure to read.
    return "";
  } catch {
    return null;
  }
}

async function captureGitAsync(cwd: string, gitRoot: string): Promise<WorkspaceState | null> {
  const fastHead = readHeadCommit(gitRoot);
  // The status and, when the files did not say, the commit: asked together, the wait is the slower one.
  const [status, head] = await Promise.all([
    gitAsync(gitRoot, STATUS_ARGS, 64 * 1024 * 1024),
    fastHead === null ? gitAsync(gitRoot, HEAD_ARGS, 1024 * 1024) : Promise.resolve(fastHead),
  ]);
  if (status === null || head === null) return null;
  const paths = gitPaths(cwd, gitRoot, status);
  if (!paths) return UNKNOWN;
  const files = new Map<string, string>();
  for (const path of paths) {
    const value = await signatureAsync(join(cwd, path));
    if (value === null) return UNKNOWN;
    files.set(path, value);
  }
  return { kind: "git", files, head: { commit: head.trim(), gitRoot, cwd } };
}

/** Files under the workspace that commits between two readings changed (added, edited, deleted or renamed). */
function committedBetween(before: WorkspaceState, after: WorkspaceState): string[] | null {
  const from = before.head;
  const to = after.head;
  if (!from || !to || from.gitRoot !== to.gitRoot || from.cwd !== to.cwd) return null;
  if (from.commit === to.commit) return [];
  if (!to.commit) return null;
  const args = from.commit
    ? ["diff", "--name-only", "-z", "--no-renames", from.commit, to.commit]
    : ["ls-tree", "-r", "--name-only", "-z", to.commit];
  const result = spawnSync("git", ["-C", to.gitRoot, ...args], {
    encoding: "utf8",
    timeout: GIT_TIMEOUT_MS,
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || result.status !== 0 || typeof result.stdout !== "string") return null;
  const paths: string[] = [];
  for (const path of result.stdout.split("\0").filter(Boolean)) {
    const relativePath = relative(to.cwd, join(to.gitRoot, path)).replace(/\\/g, "/");
    if (relativePath === ".." || relativePath.startsWith("../") || isAbsolute(relativePath)) continue;
    if (!ignored(relativePath)) paths.push(relativePath);
  }
  return paths;
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
      return UNKNOWN;
    }
    for (const entry of entries) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      const full = join(directory, entry.name);
      if (entry.isDirectory()) {
        pending.push(full);
      } else if (entry.isFile()) {
        const value = signature(full);
        if (value === null || value === "deleted") return UNKNOWN;
        files.set(relative(cwd, full).replace(/\\/g, "/"), value);
        if (files.size > MAX_WALK_FILES) return UNKNOWN;
      }
    }
  }
  return { kind: "walk", files };
}

async function signatureAsync(path: string): Promise<string | null> {
  let opened = false;
  try {
    const file = await openAsync(path, "r");
    opened = true;
    try {
      const before = await file.stat();
      if (!before.isFile()) return null;
      const hash = createHash("sha256");
      const buffer = Buffer.allocUnsafe(HASH_BUFFER_BYTES);
      let bytes = 0;
      for (let read = await file.read(buffer); read.bytesRead > 0; read = await file.read(buffer)) {
        hash.update(buffer.subarray(0, read.bytesRead));
        bytes += read.bytesRead;
      }
      if (
        bytes !== before.size ||
        !sameFileVersion(before, await file.stat()) ||
        !sameFileVersion(before, await statAsync(path))
      )
        return null;
      return `sha256:${hash.digest("hex")}`;
    } finally {
      await file.close();
    }
  } catch (error) {
    return !opened && missingFile(error) ? "deleted" : null;
  }
}

/** The same bounded walk without holding the event loop: a big folder used to freeze the terminal while it was read. */
async function captureWalkAsync(cwd: string): Promise<WorkspaceState> {
  const files = new Map<string, string>();
  const pending = [cwd];
  while (pending.length > 0) {
    const directory = pending.pop() as string;
    let entries: Dirent[];
    try {
      entries = await readdirAsync(directory, { withFileTypes: true });
    } catch {
      return UNKNOWN;
    }
    for (const entry of entries) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      const full = join(directory, entry.name);
      if (entry.isDirectory()) {
        pending.push(full);
      } else if (entry.isFile()) {
        const value = await signatureAsync(full);
        if (value === null || value === "deleted") return UNKNOWN;
        files.set(relative(cwd, full).replace(/\\/g, "/"), value);
        if (files.size > MAX_WALK_FILES) return UNKNOWN;
      }
    }
  }
  return { kind: "walk", files };
}

/**
 * Reads the workspace without holding the event loop. `git status` takes tens to hundreds of milliseconds and
 * the turn reads the workspace several times, so the blocking reading froze the terminal for about a fifth of a
 * second per turn even on a six-file project (measured 2026-10-06, 76 ms per reading). Never throws.
 */
export async function captureWorkspaceStateAsync(cwd: string): Promise<WorkspaceState> {
  try {
    const gitRoot = findGitRoot(cwd);
    if (gitRoot) {
      return (await captureGitAsync(cwd, gitRoot)) ?? UNKNOWN;
    }
    return await captureWalkAsync(cwd);
  } catch {
    return UNKNOWN;
  } finally {
    perfCount("captureWorkspaceStateAsync");
  }
}

/** Reads the workspace. Never throws: a failure reads as "unknown". */
export function captureWorkspaceState(cwd: string): WorkspaceState {
  return perfTime("captureWorkspaceState", () => readWorkspaceState(cwd));
}

function readWorkspaceState(cwd: string): WorkspaceState {
  try {
    const gitRoot = findGitRoot(cwd);
    if (gitRoot) {
      return captureGit(cwd, gitRoot) ?? UNKNOWN;
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
  // What the turn committed: clean in `git status`, changed all the same.
  if (before.kind === "git") {
    const committed = committedBetween(before, after);
    if (committed === null) return null;
    for (const path of committed) changed.add(path);
  }
  return [...changed].sort();
}

/**
 * Whether `path` (relative to `cwd`) existed when `start` was read. A walk lists every file; git status lists
 * only what differed from the last commit, so an unlisted file existed if that commit has it (not the current
 * index: a test the turn created and committed did not exist before it).
 */
export function existedAt(start: WorkspaceState, cwd: string, path: string): boolean {
  const signatureAtStart = start.files.get(path);
  if (signatureAtStart !== undefined) return signatureAtStart !== "deleted";
  if (start.kind !== "git") return false;
  if (start.head) {
    const inRepo = relative(start.head.gitRoot, join(cwd, path)).replace(/\\/g, "/");
    const found = spawnSync("git", ["-C", start.head.gitRoot, "cat-file", "-e", `${start.head.commit}:${inRepo}`], {
      timeout: GIT_TIMEOUT_MS,
      windowsHide: true,
    });
    return !found.error && found.status === 0;
  }
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
