import { execFile } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import { contractChecks } from "../contract/contract";
import { discoverChecks } from "../contract/discover";
import { IGNORED_DIRS, listWorkspaceFiles } from "../contract/workspace-files";
import { isContinuationRequest } from "../memory/terms";
import { recordSwallowedError } from "../utils/diagnostics";
import { compileProjectStructure, type ProjectStructure, projectStructureContext } from "./project-model";
import type { ContextPacket, TurnClassification } from "./types";

const MAX_CONTEXT_CHARS = 8_000;
/** Uncommitted changes listed by name; the rest are counted. */
const MAX_CHANGED_FILES = 12;
const MAX_NAMED_FILES = 12;
/** Path-like words examined in one request. */
const MAX_NAME_CANDIDATES = 8;
/** Files listed for a bare name such as `index.ts`; the rest are counted. */
const MAX_MATCHES_PER_NAME = 5;
/**
 * A project this small gets its whole file list: one line per file costs less than the rounds a model spends
 * finding its tests and manifest (F4 of the execution plan, 2026-09-24: without it a free model searched for
 * test files in nearly every task of the core suite, and used 55% more tokens).
 */
const SMALL_PROJECT_FILES = 40;
/** Test files listed for the files a request names in a larger project. */
const MAX_NAMED_TESTS = 8;
const MAX_COMMIT_LINE_CHARS = 100;
const GIT_TIMEOUT_MS = 3_000;

const MUTATION_RE =
  /\b(add|create|edit|fix|update|change|modify|refactor|remove|delete|write|implement|replace|migrate|implementa|agrega|agregar|crea|crear|corrige|corregir|actualiza|actualizar|cambia|cambiar|modifica|modificar|elimina|eliminar|escribe|escribir)\b/i;
const REPOSITORY_RE =
  /(?:\b(repo(?:sitory)?|repository|codebase|project|workspace|file|files|folder|directory|src|test|function|class|module|package|review|inspect|analy[sz]e|explore|read|list|proyecto|proyectos|repositorio|repositorios|c[oó]digo|c[oó]digos|carpeta|carpetas|directorio|directorios|archivo|archivos|fichero|ficheros|prueba|pruebas|funci[oó]n|clase|m[oó]dulo|paquete|revisa|revisar|revisi[oó]n|inspecciona|inspeccionar|analiza|analizar|examina|examinar|explora|explorar|lee|leer|lista|listar|muestra|mostrar|entiende|entender|estructura|estado)\b|[\\/]src[\\/]|\.(?:ts|tsx|js|jsx|py|go|rs|json)\b)/i;

/**
 * Informational only. Nothing here may restrict the model — the host once used this to strip
 * tools from "conversational" prompts, which turned most real requests ("make the tests pass",
 * "git status", "why does the login page crash?") into tool-less chat turns.
 */
export function classifyTurn(prompt: string): TurnClassification {
  const hasMutation = MUTATION_RE.test(prompt);
  const hasRepositorySignal = REPOSITORY_RE.test(prompt);
  if (hasMutation && hasRepositorySignal) {
    return { kind: "coding", reason: "mutation request with repository scope" };
  }
  if (hasMutation) {
    return { kind: "coding", reason: "mutation verb detected" };
  }
  if (hasRepositorySignal) {
    return { kind: "repository", reason: "repository evidence requested" };
  }
  // "Continue", "where we left off": the work so far is the context such a request needs (doc 21 §5.7).
  if (isContinuationRequest(prompt)) {
    return { kind: "repository", reason: "continuation of the project's work" };
  }
  return { kind: "conversation", reason: "no repository or mutation signal" };
}

/**
 * A read-only git command in the workspace: null when git is missing or did not finish in time. It runs beside the
 * event loop, not on it: the turn used to start with several of these in a row, and the terminal could not redraw,
 * take a key or cancel for the quarter of a second or more they took (measured 2026-10-06).
 */
function git(root: string, args: readonly string[]): Promise<{ ok: boolean; stdout: string } | null> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["--no-optional-locks", ...args],
      {
        cwd: root,
        encoding: "utf8",
        timeout: GIT_TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: 4 * 1024 * 1024,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      },
      (error, stdout) => {
        // A command that ran and exited non-zero is an answer ("not a repository"); one that never ran is not.
        const code = (error as { code?: unknown } | null)?.code;
        if (error && typeof code !== "number") return resolve(null);
        resolve({ ok: !error, stdout: typeof stdout === "string" ? stdout : "" });
      },
    );
  });
}

function clip(text: string, maxChars: number): string {
  return text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text;
}

/** Branch, uncommitted changes with their size, and the last commits, limited to this workspace. */
async function gitSummary(root: string): Promise<{ text: string | null; truncated: boolean }> {
  const status = await git(root, [
    "-c",
    "color.status=false",
    "-c",
    "core.quotepath=off",
    "status",
    "--short",
    "--branch",
    "--",
    ".",
  ]);
  if (!status) return { text: null, truncated: false };
  if (!status.ok) return { text: "Git: this workspace is not in a git repository.", truncated: false };
  const [branch = "", ...changes] = status.stdout.split(/\r?\n/u).filter((line) => line.trim() !== "");
  const lines = [`Git branch: ${branch.replace(/^##\s*/u, "")}`];
  if (changes.length === 0) {
    lines.push("Uncommitted changes: none.");
  } else {
    // The size of the change and the last commits do not depend on each other.
    const [stat, log] = await Promise.all([
      git(root, ["diff", "--shortstat", "--no-ext-diff", "--no-textconv", "HEAD", "--", "."]),
      git(root, ["log", "--oneline", "--no-decorate", "--no-color", "--no-show-signature", "-3"]),
    ]);
    const size = stat?.ok && stat.stdout.trim() ? ` (${stat.stdout.trim()})` : "";
    lines.push(`Uncommitted changes${size}:`, ...changes.slice(0, MAX_CHANGED_FILES).map((line) => `  ${line}`));
    if (changes.length > MAX_CHANGED_FILES) lines.push(`  … and ${changes.length - MAX_CHANGED_FILES} more`);
    return finishGitSummary(lines, log, changes.length);
  }
  const log = await git(root, ["log", "--oneline", "--no-decorate", "--no-color", "--no-show-signature", "-3"]);
  return finishGitSummary(lines, log, changes.length);
}

function finishGitSummary(
  lines: string[],
  log: { ok: boolean; stdout: string } | null,
  changeCount: number,
): { text: string | null; truncated: boolean } {
  const commits = log?.ok ? log.stdout.split(/\r?\n/u).filter((line) => line.trim() !== "") : [];
  if (commits.length > 0)
    lines.push("Recent commits:", ...commits.map((line) => `  ${clip(line, MAX_COMMIT_LINE_CHARS)}`));
  return { text: lines.join("\n"), truncated: changeCount > MAX_CHANGED_FILES };
}

/** Words of the request that look like paths: a separator or a file extension, and no URL or glob syntax. */
function pathCandidates(prompt: string): string[] {
  const candidates = new Set<string>();
  for (const word of prompt.split(/[\s"'`()<>{},;]+/u)) {
    const candidate = word
      .replace(/^[*@]+/u, "")
      .replace(/[.,:;!?*]+$/u, "")
      .replace(/:\d+(?::\d+)?$/u, "");
    if (!candidate || candidate === "." || candidate === ".." || candidate.length > 200) continue;
    if (candidate.includes("://") || /[*?[\]]/u.test(candidate)) continue;
    if (!/[\\/]/u.test(candidate) && !/\.[A-Za-z][A-Za-z0-9]{0,7}$/u.test(candidate)) continue;
    candidates.add(candidate);
    if (candidates.size >= MAX_NAME_CANDIDATES) break;
  }
  return [...candidates];
}

/** The workspace-relative form of a path the request names, or null when it points outside the workspace. */
function insideWorkspace(root: string, candidate: string): string | null {
  const rel = relative(root, resolve(root, candidate));
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;
  return rel.split(sep).join("/");
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Folders that are never a project's own source at any depth: dependencies, caches and tool state, which a
 * project without a .gitignore leaves for git to list (git has no built-in rule for them).
 */
const TOOL_STATE_DIRS: ReadonlySet<string> = new Set([
  "node_modules",
  ".git",
  "__pycache__",
  ".venv",
  "venv",
  ".shelra",
  ".cache",
  ".turbo",
  ".next",
  ".nuxt",
  ".svelte-kit",
]);

/** The project's own files: from git (tracked and unignored), or a bounded walk outside a repository. */
async function projectFiles(root: string): Promise<{ files: string[]; complete: boolean }> {
  const listed = await git(root, ["ls-files", "--cached", "--others", "--exclude-standard", "-z"]);
  if (listed?.ok) {
    // Tool state and dependencies are never the project's own files. Folders named like build output (build,
    // dist, target, vendor) are left out only at the root: a tracked `src/commands/build/` is source.
    const files = listed.stdout.split("\0").filter((file) => {
      if (!file) return false;
      const parts = file.split("/");
      return !IGNORED_DIRS.has(parts[0] ?? "") && !parts.some((part) => TOOL_STATE_DIRS.has(part));
    });
    return { files: [...new Set(files)].sort(), complete: true };
  }
  const walked = listWorkspaceFiles(root);
  return { files: walked.files.map((file) => file.path).sort(), complete: !walked.truncated };
}

const TEST_FILE_RE =
  /(?:^|\/)(?:__tests__|tests?|spec)\/|\.(?:test|spec)\.[cm]?[jt]sx?$|(?:^|\/)test_[^/]*\.py$|_test\.(?:py|go)$/u;

/** Test files whose name starts with a named file's base name (`queue.ts` → `queue.test.ts`, `test_queue.py`). */
function testsOf(named: readonly string[], files: readonly string[]): string[] {
  const stems = named
    .filter((path) => !path.endsWith("/"))
    .map((path) =>
      basename(path)
        .replace(/\.[^.]+$/u, "")
        .toLowerCase(),
    )
    .filter((stem) => stem.length > 0);
  if (stems.length === 0) return [];
  return files.filter((file) => {
    if (!TEST_FILE_RE.test(file) || named.includes(file)) return false;
    const name = basename(file)
      .toLowerCase()
      .replace(/^test_/u, "");
    return stems.some((stem) => name.startsWith(`${stem}.`) || name.startsWith(`${stem}_`));
  });
}

/** Workspace files with one of these names, from git (tracked and unignored) or a bounded walk elsewhere. */
async function filesNamed(root: string, names: readonly string[]): Promise<Map<string, string[]>> {
  const listed = await git(root, [
    "ls-files",
    "--cached",
    "--others",
    "--exclude-standard",
    "-z",
    "--",
    ...names.map((name) => `:(glob)**/${name}`),
  ]);
  const paths = listed?.ok
    ? listed.stdout.split("\0").filter(Boolean)
    : listWorkspaceFiles(root).files.map((file) => file.path);
  const byName = new Map<string, string[]>(names.map((name) => [name, []]));
  for (const path of [...new Set(paths)].sort()) byName.get(basename(path))?.push(path);
  return byName;
}

/**
 * The files and folders the request names, resolved inside the workspace: a path as written, a bare
 * name at the workspace root, or else every file with that name. Nothing the request does not name.
 */
async function namedFiles(
  root: string,
  prompt: string,
): Promise<{ lines: string[]; files: string[]; truncated: boolean }> {
  const lines: string[] = [];
  const files: string[] = [];
  const bareNames: string[] = [];
  for (const candidate of pathCandidates(prompt)) {
    const rel = insideWorkspace(root, candidate);
    if (!rel || !existsSync(resolve(root, rel))) {
      if (!/[\\/]/u.test(candidate)) bareNames.push(candidate);
      continue;
    }
    const shown = isDirectory(resolve(root, rel)) ? `${rel}/` : rel;
    lines.push(`- ${shown}`);
    files.push(shown);
  }
  let truncated = false;
  if (bareNames.length > 0) {
    for (const [name, matches] of await filesNamed(root, bareNames)) {
      if (matches.length === 0) continue;
      const shown = matches.slice(0, MAX_MATCHES_PER_NAME);
      const more = matches.length - shown.length;
      truncated ||= more > 0;
      lines.push(
        matches.length === 1
          ? `- ${shown[0]}`
          : `- ${name}: ${shown.join(", ")}${more > 0 ? ` (and ${more} more with this name)` : ""}`,
      );
      files.push(...shown);
    }
  }
  const unique = [...new Set(files)];
  return {
    lines,
    files: unique.slice(0, MAX_NAMED_FILES),
    truncated: truncated || unique.length > MAX_NAMED_FILES,
  };
}

/**
 * What a model cannot cheaply discover for itself (audit doc 15, Phase 3.1): the checks the project
 * states, the git state, and the files the request names. A project of at most 40 files also gets its
 * whole file list, and a larger one the tests of the files the request names: without either, F4 of the
 * execution plan measured a free model searching for the tests in nearly every task and spending 55%
 * more tokens. A generated overview of a large repository stays out, where it was noise and reading
 * files on demand beat an injected map. Project instructions (the AGENTS.md chain; CLAUDE.md is read only for
 * its command table, by check discovery) reach the system prompt separately.
 */
export async function compileContextPacket(
  root: string,
  prompt: string,
  maxChars = MAX_CONTEXT_CHARS,
): Promise<ContextPacket> {
  const classification = classifyTurn(prompt);
  if (classification.kind === "conversation") {
    return { classification, promptAppendix: "", files: [], truncated: false };
  }

  const checks = contractChecks(discoverChecks(root));
  // Three independent readings of the repository, asked together.
  const [repository, named, project] = await Promise.all([
    gitSummary(root),
    namedFiles(root, prompt),
    projectFiles(root),
  ]);
  let structure: ProjectStructure;
  try {
    structure = await compileProjectStructure(root, project, named.files);
  } catch (error) {
    recordSwallowedError("context.project-structure", error);
    structure = {
      status: "partial",
      coverage: { inventoryComplete: project.complete, manifestsDiscovered: 0, manifestsRead: 0, limit: 256 },
      packages: [],
      dependencies: [],
      owners: named.files.map((file) => ({ file, reason: "Project package structure could not be observed." })),
      warnings: [`Project package structure unavailable: ${String(error)}`],
    };
  }
  const packageContext = projectStructureContext(structure);
  // Root-only projects already receive their description and check table. Add package detail for nested scope.
  const includePackageContext =
    structure.packages.some((pkg) => pkg.manifest !== "package.json") || structure.status === "partial";
  const sections: string[] = [
    "HOST-COMPILED REPOSITORY CONTEXT (read by Shelra at the start of this turn):",
    `Workspace root: ${root}`,
    ...(!project.complete
      ? [
          "Project file inventory is incomplete (bounded exploration or a filesystem/Git read failed). A missing file or test in this packet is not evidence of absence. Continue with targeted grep, directory searches and read_file before drawing conclusions.",
        ]
      : []),
    checks.length > 0
      ? `Checks this project states:\n${checks.map((check) => `- ${check.kind}: \`${check.command}\` (${check.source})`).join("\n")}`
      : "The project states no test, type-check or lint command.",
  ];
  if (repository.text) sections.push(repository.text);
  if (named.lines.length > 0) sections.push(`Files the request names:\n${named.lines.join("\n")}`);
  if (includePackageContext) sections.push(packageContext.text);
  if (project.complete && project.files.length > 0 && project.files.length <= SMALL_PROJECT_FILES) {
    sections.push(
      `Files in this project (${project.files.length}):\n${project.files.map((file) => `- ${file}`).join("\n")}`,
    );
  } else {
    const tests = testsOf(named.files, project.files).slice(0, MAX_NAMED_TESTS);
    if (tests.length > 0)
      sections.push(`Tests of the files the request names:\n${tests.map((file) => `- ${file}`).join("\n")}`);
  }
  const appendix = sections.join("\n\n");
  return {
    classification,
    promptAppendix:
      appendix.length > maxChars ? `${appendix.slice(0, maxChars)}\n[context truncated by host]` : appendix,
    files: named.files,
    truncated:
      appendix.length > maxChars ||
      repository.truncated ||
      named.truncated ||
      !project.complete ||
      structure.status === "partial" ||
      (includePackageContext && packageContext.truncated),
    project: structure,
  };
}
