import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "fs";
import { homedir } from "os";
import { join, parse, resolve } from "path";
import { SCRATCH_ROOT } from "../security/workspace-guard";
import { findGitRoot } from "../utils/git-root";
import { localDateStamp } from "./prompt-date";

/** A session's scratch folder is removed a week after it was last written, when a new one is made. */
const SCRATCH_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000;

const PROJECT_MARKERS = [
  "package.json",
  "deno.json",
  "pyproject.toml",
  "setup.py",
  "requirements.txt",
  "Cargo.toml",
  "go.mod",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "composer.json",
  "Gemfile",
  "mix.exs",
  "pubspec.yaml",
  "Package.swift",
  "CMakeLists.txt",
  "Makefile",
];
const PROJECT_FILE_EXTENSIONS = [".sln", ".csproj", ".fsproj", ".vcxproj"];

function samePath(a: string, b: string): boolean {
  const left = resolve(a);
  const right = resolve(b);
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}

/**
 * A working directory that is not a project: the home folder, a drive root, or a folder with no
 * repository and no project manifest (Desktop, Downloads). Helper files written there litter the
 * user's own folders: seen live 2026-09-22, a camera diagnosis left two scripts in the home folder.
 */
export function isOutsideProject(cwd: string): boolean {
  const dir = resolve(cwd);
  if (samePath(dir, homedir()) || samePath(dir, parse(dir).root)) return true;
  if (findGitRoot(dir)) return false;
  try {
    if (PROJECT_MARKERS.some((marker) => existsSync(join(dir, marker)))) return false;
    return !readdirSync(dir).some((name) => PROJECT_FILE_EXTENSIONS.some((extension) => name.endsWith(extension)));
  } catch {
    return false;
  }
}

function pruneOldScratch(keep: string): void {
  if (!existsSync(SCRATCH_ROOT)) return;
  const cutoff = Date.now() - SCRATCH_MAX_AGE_MS;
  for (const name of readdirSync(SCRATCH_ROOT)) {
    const folder = join(SCRATCH_ROOT, name);
    if (samePath(folder, keep)) continue;
    try {
      if (statSync(folder).mtimeMs < cutoff) rmSync(folder, { recursive: true, force: true });
    } catch {
      // In use or already gone.
    }
  }
}

/** The session's scratch folder under `SCRATCH_ROOT`, created now; older sessions' folders are pruned. */
export function sessionScratchDir(sessionId: string): string {
  const dir = join(SCRATCH_ROOT, sessionId.replace(/[^A-Za-z0-9_-]/gu, "") || "session");
  try {
    pruneOldScratch(dir);
    mkdirSync(dir, { recursive: true });
  } catch {
    // Scratch space is a convenience; a folder that cannot be made is never fatal.
  }
  return dir;
}

/** The prompt line that sends helper files to the scratch folder. */
export function scratchPromptLine(dir: string): string {
  return `This directory is not a project. Write helper scripts and scratch files for the task in ${dir} with write_file, not here, and run them by full path. Give the user the full path of any helper they should keep or run again.`;
}

let processDir: string | null = null;
/** How long a directory's project check is reused: the prompt is rebuilt for every turn and context estimate. */
const PROJECT_CHECK_TTL_MS = 10_000;
const projectChecks = new Map<string, { outside: boolean; at: number }>();

/**
 * The scratch-folder line for a system prompt, or "" inside a project. One folder serves the whole
 * process, named by date and process id, and is made the first time a prompt needs it.
 */
export function scratchLineFor(cwd: string): string {
  const now = Date.now();
  let check = projectChecks.get(cwd);
  if (!check || now - check.at >= PROJECT_CHECK_TTL_MS) {
    check = { outside: isOutsideProject(cwd), at: now };
    projectChecks.set(cwd, check);
  }
  if (!check.outside) return "";
  processDir ??= sessionScratchDir(`${localDateStamp()}-${process.pid}`);
  return scratchPromptLine(processDir);
}
