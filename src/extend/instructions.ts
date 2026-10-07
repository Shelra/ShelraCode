/**
 * Persistent instructions: SHELRA.md and the rules around it, rebuilt from their files every time a prompt is built
 * (never from a summary, so a restart, a recovery or a compaction cannot lose or distort them).
 *
 * Sources, general to specific (a later one refines an earlier one; none can remove a control the harness enforces):
 *   1. user          ~/.shelra/SHELRA.md  (and the older ~/.shelra/AGENTS.md)
 *   2. user rules    ~/.shelra/rules/*.md
 *   3. project chain, git root down to the working folder, in each folder:
 *        AGENTS.md (or AGENTS.override.md in its place), CLAUDE.md only when the folder has neither of the others,
 *        then SHELRA.md (aliases Shelra.md / shelra.md are the same file, loaded once)
 *   4. project rules .shelra/rules/*.md and .claude/rules/*.md (read-only compat)
 *   5. local         .shelra/SHELRA.local.md (the person's own, kept out of git)
 *   6. conditional   rules whose `paths:` globs match the files the request is about
 *
 * `@path/to/file.md` pulls in another text file: depth-limited, size-limited, cycle-safe, never outside the project (or
 * the user folder for user files), and a file already loaded is not loaded again.
 */
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { containsSecret, looksInjectionShaped } from "../memory/gate";
import { getProductUserDir } from "../product/identity";
import { findGitRoot } from "../utils/git-root";
import { listOf, parseFrontmatter } from "./frontmatter";
import { readAllLayers } from "./settings";
import { contentHash, writeDefinition } from "./store";

export type InstructionKind = "user" | "user-rule" | "project" | "project-rule" | "local" | "compat" | "import";

export interface InstructionSource {
  kind: InstructionKind;
  path: string;
  scope: "user" | "project";
  hash: string;
  bytes: number;
  /** Position in the loaded order, from 1. */
  order: number;
  /** Globs a conditional rule applies to; empty for an unconditional source. */
  paths: string[];
  /** False for a conditional rule whose paths the request is not about. */
  applied: boolean;
  /** Why this source is here, in a line: what loaded it. */
  why: string;
  /** The file that imported it, for `import`. */
  importedBy?: string;
}

export interface InstructionDiagnostic {
  severity: "info" | "warning" | "error";
  message: string;
  path?: string;
}

export interface InstructionSet {
  /** The text that goes into the prompt, or null when there is none. */
  text: string | null;
  sources: InstructionSource[];
  diagnostics: InstructionDiagnostic[];
  /** A short version label of the effective text: it changes when any applied source changes. */
  hash: string;
  truncated: boolean;
  root: string;
}

const MAX_IMPORT_DEPTH = 4;
const MAX_FILE_BYTES = 64 * 1024;
const MAX_TOTAL_CHARS = 120_000;
const IMPORTABLE = /\.(md|markdown|mdx|txt|rst)$/iu;

function realOrResolved(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    return resolve(path);
  }
}

function inside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** Glob to RegExp: `**` any depth, `*` within a segment, `?` one character, `{a,b}` alternatives. */
export function globToRegExp(glob: string): RegExp {
  let source = "";
  const text = glob.replace(/\\/gu, "/").replace(/^\.\//u, "");
  for (let i = 0; i < text.length; i++) {
    const char = text[i] as string;
    if (char === "*") {
      if (text[i + 1] === "*") {
        const slash = text[i + 2] === "/";
        source += slash ? "(?:.*/)?" : ".*";
        i += slash ? 2 : 1;
      } else source += "[^/]*";
    } else if (char === "?") source += "[^/]";
    else if (char === "{") {
      const end = text.indexOf("}", i);
      if (end < 0) source += "\\{";
      else {
        source += `(?:${text
          .slice(i + 1, end)
          .split(",")
          .map((part) => part.replace(/[.+^$()|[\]\\]/gu, "\\$&").replace(/\*/gu, "[^/]*"))
          .join("|")})`;
        i = end;
      }
    } else if (/[.+^$()|[\]\\]/u.test(char)) source += `\\${char}`;
    else source += char;
  }
  return new RegExp(`^${source}$`, process.platform === "win32" ? "iu" : "u");
}

export function matchesAnyGlob(globs: readonly string[], relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/gu, "/").replace(/^\.\//u, "");
  return globs.some((glob) => globToRegExp(glob).test(normalized));
}

function readTextFile(path: string): { text: string; bytes: number } | null {
  try {
    const stat = statSync(path);
    if (!stat.isFile()) return null;
    if (stat.size > MAX_FILE_BYTES) return { text: "", bytes: stat.size };
    return { text: readFileSync(path, "utf8"), bytes: stat.size };
  } catch {
    return null;
  }
}

interface Collector {
  root: string;
  userDir: string;
  parts: Array<{ source: InstructionSource; text: string }>;
  diagnostics: InstructionDiagnostic[];
  loaded: Set<string>;
  requestPaths: string[];
}

function pushDiagnostic(
  collector: Collector,
  severity: InstructionDiagnostic["severity"],
  message: string,
  path?: string,
): void {
  collector.diagnostics.push({ severity, message, ...(path ? { path } : {}) });
}

/** Replaces `@file` import lines, appending inline imports after the text; imports are bounded and never loop. */
function expandImports(text: string, file: string, depth: number, collector: Collector, scopeRoot: string): string {
  const lines = text.split(/\r?\n/u);
  const appended: string[] = [];
  let fenced = false;
  const out: string[] = [];
  for (const line of lines) {
    if (/^\s*(```|~~~)/u.test(line)) {
      fenced = !fenced;
      out.push(line);
      continue;
    }
    if (fenced) {
      out.push(line);
      continue;
    }
    const withoutCode = line.replace(/`[^`]*`/gu, "");
    const tokens = [...withoutCode.matchAll(/(?:^|\s)@([^\s`<>()"']+)/gu)].map((match) => match[1] as string);
    const candidates = tokens.filter((token) => IMPORTABLE.test(token));
    if (candidates.length === 0) {
      out.push(line);
      continue;
    }
    const wholeLine = candidates.length === 1 && line.trim() === `@${candidates[0]}`;
    let replacement: string | null = null;
    let duplicate = false;
    for (const token of candidates) {
      const resolved = isAbsolute(token) ? token : resolve(dirname(file), token);
      const real = realOrResolved(resolved);
      if (!existsSync(resolved)) {
        pushDiagnostic(collector, "warning", `import @${token} was not found`, file);
        continue;
      }
      if (!inside(scopeRoot, real)) {
        pushDiagnostic(
          collector,
          "error",
          `import @${token} points outside ${scopeRoot === collector.userDir ? "the user folder" : "the project"} and was not loaded`,
          file,
        );
        continue;
      }
      if (depth >= MAX_IMPORT_DEPTH) {
        pushDiagnostic(
          collector,
          "warning",
          `import @${token} is more than ${MAX_IMPORT_DEPTH} levels deep and was not loaded`,
          file,
        );
        continue;
      }
      if (collector.loaded.has(real)) {
        pushDiagnostic(collector, "info", `import @${token} was already loaded and is not loaded twice`, file);
        duplicate = true;
        continue;
      }
      const read = readTextFile(real);
      if (!read) continue;
      if (read.bytes > MAX_FILE_BYTES) {
        pushDiagnostic(
          collector,
          "warning",
          `import @${token} is ${read.bytes} bytes; the limit is ${MAX_FILE_BYTES}`,
          file,
        );
        continue;
      }
      collector.loaded.add(real);
      const body = expandImports(read.text, real, depth + 1, collector, scopeRoot).trim();
      collector.parts.push({
        source: {
          kind: "import",
          path: real,
          scope: scopeRoot === collector.userDir ? "user" : "project",
          hash: contentHash(read.text),
          bytes: read.bytes,
          order: 0,
          paths: [],
          applied: true,
          why: `imported with @${token}`,
          importedBy: file,
        },
        text: "",
      });
      const joined = body;
      if (wholeLine) replacement = joined;
      else appended.push(joined);
    }
    if (wholeLine && replacement !== null) out.push(replacement);
    else if (wholeLine && duplicate) continue;
    else out.push(line);
  }
  const base = out.join("\n").trim();
  return [base, ...appended].filter(Boolean).join("\n\n");
}

function addFile(
  collector: Collector,
  path: string,
  kind: InstructionKind,
  scope: "user" | "project",
  why: string,
  options: { conditional?: string[]; strip?: boolean } = {},
): void {
  const real = realOrResolved(path);
  if (collector.loaded.has(real)) {
    pushDiagnostic(collector, "info", `${path} is the same file as one already loaded; it is loaded once`, path);
    return;
  }
  const read = readTextFile(path);
  if (!read) return;
  if (read.bytes > MAX_FILE_BYTES) {
    pushDiagnostic(
      collector,
      "warning",
      `${path} is ${read.bytes} bytes; the limit is ${MAX_FILE_BYTES}, so it was not loaded`,
      path,
    );
    return;
  }
  let body = read.text;
  let paths: string[] = [];
  if (options.strip || kind === "user-rule" || kind === "project-rule") {
    const parsed = parseFrontmatter(read.text);
    if (parsed.hasFrontmatter) {
      body = parsed.body;
      paths = listOf(parsed.data.paths ?? parsed.data.globs);
    }
  }
  if (!body.trim()) return;
  collector.loaded.add(real);
  const scopeRoot = scope === "user" ? collector.userDir : collector.root;
  const applied = paths.length === 0 || collector.requestPaths.some((candidate) => matchesAnyGlob(paths, candidate));
  const expanded = applied ? expandImports(body, real, 0, collector, scopeRoot) : body.trim();
  collector.parts.push({
    source: { kind, path, scope, hash: contentHash(read.text), bytes: read.bytes, order: 0, paths, applied, why },
    text: applied ? expanded : "",
  });
}

/** Directory entries matching a name case-insensitively, canonical spelling first, for the SHELRA.md aliases. */
function aliasesIn(dir: string, canonical: string): { chosen: string | null; ignored: string[] } {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return { chosen: null, ignored: [] };
  }
  const matches = entries
    .filter((entry) => entry.toLowerCase() === canonical.toLowerCase())
    .sort((a, b) => (a === canonical ? -1 : b === canonical ? 1 : a.localeCompare(b)));
  if (matches.length === 0) return { chosen: null, ignored: [] };
  const first = matches[0] as string;
  const firstReal = realOrResolved(join(dir, first));
  const ignored = matches.slice(1).filter((entry) => realOrResolved(join(dir, entry)) !== firstReal);
  return { chosen: join(dir, first), ignored: ignored.map((entry) => join(dir, entry)) };
}

function ruleFiles(dir: string): string[] {
  try {
    if (!existsSync(dir)) return [];
    const files: string[] = [];
    const walk = (current: string, depth: number) => {
      if (depth > 3) return;
      for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.name.startsWith(".")) continue;
        const full = join(current, entry.name);
        if (entry.isDirectory()) walk(full, depth + 1);
        else if (entry.isFile() && entry.name.endsWith(".md")) files.push(full);
      }
    };
    walk(dir, 0);
    return files.slice(0, 200);
  } catch {
    return [];
  }
}

/** File names or paths mentioned in a request: what a path-scoped rule is matched against. */
export function pathsMentionedIn(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(
    /(?:^|[\s"'`([])((?:\.{1,2}\/|\/)?(?:[\w@.-]+\/)*[\w@.-]+\.[A-Za-z0-9]{1,8})(?=$|[\s"'`)\],.;:!?])/gu,
  )) {
    const token = (match[1] as string).replace(/^\.\//u, "");
    // `name@host.tld` is an address, not a file.
    if (!token.includes("/") && /.@[^/]+\.[A-Za-z]{2,}$/u.test(token)) continue;
    found.add(token);
  }
  return [...found].slice(0, 50);
}

export interface LoadInstructionOptions {
  /** Files the request is about (for path-scoped rules): mentioned in the request, or touched in the session. */
  paths?: string[];
}

export function loadInstructionSet(cwd: string, options: LoadInstructionOptions = {}): InstructionSet {
  const canonicalCwd = realOrResolved(cwd);
  const root = findGitRoot(canonicalCwd) ?? canonicalCwd;
  const userDir = getProductUserDir();
  const layers = readAllLayers(root);
  const excludes = new Set<string>(
    [layers.local, layers.user]
      .flatMap((layer) => (Array.isArray(layer.data.instructionExcludes) ? layer.data.instructionExcludes : []))
      .map((entry) => entry.replace(/\\/gu, "/").toLowerCase()),
  );
  const relativePaths = (options.paths ?? []).map((path) => {
    const absolute = isAbsolute(path) ? path : resolve(root, path);
    return relative(root, absolute).split(sep).join("/");
  });
  const collector: Collector = {
    root,
    userDir,
    parts: [],
    diagnostics: [],
    loaded: new Set(),
    requestPaths: relativePaths,
  };
  const excluded = (path: string): boolean => {
    const rel = relative(root, path).split(sep).join("/").toLowerCase();
    return (
      excludes.has(rel) ||
      excludes.has(basename(path).toLowerCase()) ||
      excludes.has(path.replace(/\\/gu, "/").toLowerCase())
    );
  };
  const add = (
    path: string,
    kind: InstructionKind,
    scope: "user" | "project",
    why: string,
    opts: { strip?: boolean } = {},
  ) => {
    if (excluded(path)) {
      pushDiagnostic(collector, "info", `${path} is excluded by instructionExcludes`, path);
      return;
    }
    addFile(collector, path, kind, scope, why, opts);
  };

  // 1. user
  const userShelra = aliasesIn(userDir, "SHELRA.md");
  const legacyGlobal = join(userDir, "AGENTS.md");
  if (existsSync(legacyGlobal)) add(legacyGlobal, "user", "user", "your user-wide AGENTS.md");
  if (userShelra.chosen) add(userShelra.chosen, "user", "user", "your user-wide SHELRA.md");
  // 2. user rules
  for (const file of ruleFiles(join(userDir, "rules")))
    add(file, "user-rule", "user", "a user-wide rule", { strip: true });

  // 3. the project chain, root to the working folder
  const rel = relative(root, canonicalCwd);
  const segments = rel === "" || rel.startsWith("..") ? [] : rel.split(sep).filter(Boolean);
  const chain = [root];
  let acc = root;
  for (const segment of segments) {
    acc = join(acc, segment);
    chain.push(acc);
  }
  for (const dir of chain) {
    const where = dir === root ? "the project root" : `the folder ${relative(root, dir).split(sep).join("/")}`;
    const override = join(dir, "AGENTS.override.md");
    const agents = join(dir, "AGENTS.md");
    const shelra = aliasesIn(dir, "SHELRA.md");
    for (const ignored of shelra.ignored)
      pushDiagnostic(
        collector,
        "warning",
        `${ignored} has the same name as ${shelra.chosen} apart from case; only ${shelra.chosen} is loaded. Keep one file`,
        ignored,
      );
    if (existsSync(override)) {
      add(override, "project", "project", `AGENTS.override.md in ${where} (replaces its AGENTS.md)`);
      if (existsSync(agents))
        pushDiagnostic(collector, "info", `${agents} is hidden by AGENTS.override.md in the same folder`, agents);
    } else if (existsSync(agents)) add(agents, "project", "project", `AGENTS.md in ${where}`);
    const hasOwn = existsSync(override) || existsSync(agents) || shelra.chosen !== null;
    const claude = join(dir, "CLAUDE.md");
    if (!hasOwn && existsSync(claude))
      add(
        claude,
        "compat",
        "project",
        `CLAUDE.md in ${where} (read as a fallback: the folder has no SHELRA.md or AGENTS.md)`,
      );
    else if (hasOwn && existsSync(claude))
      pushDiagnostic(
        collector,
        "info",
        `${claude} is written for another agent and is not loaded while ${shelra.chosen ? "SHELRA.md" : "AGENTS.md"} exists in the folder; \`@CLAUDE.md\` in SHELRA.md imports it`,
        claude,
      );
    if (shelra.chosen) add(shelra.chosen, "project", "project", `SHELRA.md in ${where}`);
  }
  // 4. project rules
  for (const file of ruleFiles(join(root, ".shelra", "rules")))
    add(file, "project-rule", "project", "a project rule (.shelra/rules)", { strip: true });
  for (const file of ruleFiles(join(root, ".claude", "rules")))
    add(file, "project-rule", "project", "a rule read from .claude/rules (compat)", { strip: true });
  // 5. local
  const local = join(root, ".shelra", "SHELRA.local.md");
  if (existsSync(local)) add(local, "local", "project", "your local preferences (not in git)", { strip: false });

  const applied = collector.parts.filter((part) => part.source.applied && part.text.trim());
  let truncated = false;
  let budget = MAX_TOTAL_CHARS;
  const kept: typeof applied = [];
  // When the total is over the budget, conditional rules go first, then the oldest (most general) sources.
  const ordered = [...applied];
  let total = ordered.reduce((sum, part) => sum + part.text.length + 2, 0);
  if (total > budget) {
    truncated = true;
    for (const part of [...ordered].sort(
      (a, b) =>
        Number(b.source.paths.length > 0) - Number(a.source.paths.length > 0) || a.source.order - b.source.order,
    )) {
      if (total <= budget) break;
      const index = ordered.indexOf(part);
      if (index >= 0) {
        total -= part.text.length + 2;
        ordered.splice(index, 1);
        pushDiagnostic(
          collector,
          "warning",
          `${part.source.path} was left out: the instructions exceed ${MAX_TOTAL_CHARS} characters`,
          part.source.path,
        );
      }
    }
  }
  budget = 0;
  for (const part of ordered) kept.push(part);
  let order = 0;
  const sources = collector.parts.map((part) => {
    order += 1;
    return { ...part.source, order };
  });
  for (const source of sources) {
    if (source.applied && !kept.some((part) => part.source.path === source.path && part.source.kind === source.kind))
      source.applied = source.kind === "import" ? source.applied : false;
  }
  const text = kept.length > 0 ? kept.map((part) => part.text.trim()).join("\n\n") : null;
  for (const part of collector.parts) {
    if (part.source.applied && containsSecret(part.text))
      pushDiagnostic(
        collector,
        "warning",
        `${part.source.path} contains what looks like a secret; remove it (instructions are sent to the model)`,
        part.source.path,
      );
  }
  return {
    text,
    sources,
    diagnostics: collector.diagnostics,
    hash: text ? contentHash(text) : "none",
    truncated,
    root,
  };
}

/** Human-readable account of what is active and where each part comes from (`/instructions`, the `extensions` tool). */
export function explainInstructions(set: InstructionSet): string {
  if (set.sources.length === 0) {
    return [
      "No instruction files are active.",
      `Create SHELRA.md in ${set.root} (shared with the team), .shelra/SHELRA.local.md (yours, not in git) or ~/.shelra/SHELRA.md (all projects).`,
    ].join("\n");
  }
  const lines = [`Active instructions (version ${set.hash}${set.truncated ? ", truncated" : ""}):`];
  for (const source of set.sources) {
    const state = source.applied ? "active" : "not active (its paths do not match this request)";
    lines.push(
      `${String(source.order).padStart(2)}. ${source.path}  [${source.kind}, ${source.scope}, ${source.bytes} bytes, ${source.hash}] — ${source.why}; ${state}${source.paths.length ? `; applies to ${source.paths.join(", ")}` : ""}`,
    );
  }
  if (set.diagnostics.length > 0) {
    lines.push("", "Diagnostics:");
    for (const diagnostic of set.diagnostics) lines.push(`- ${diagnostic.severity}: ${diagnostic.message}`);
  }
  lines.push(
    "",
    "Later sources refine earlier ones. Instructions guide behavior; they never grant permissions or switch off the harness's checks.",
  );
  return lines.join("\n");
}

// --- Writing ----------------------------------------------------------------------------------------------------

export type InstructionTarget = "project" | "local" | "user" | { rule: string; scope?: "project" | "user" };

export interface UpdateInstructionsInput {
  target: InstructionTarget;
  /** The section heading to add or replace (without #); omit with `replace_file`. */
  section?: string;
  content: string;
  mode: "append_section" | "replace_section" | "replace_file";
  /** For a new rule: the globs it applies to. */
  paths?: string[];
  expectedHash?: string;
}

export type UpdateInstructionsOutcome =
  | {
      ok: true;
      path: string;
      created: boolean;
      changed: boolean;
      hash: string;
      previousHash: string | null;
      snapshot: string | null;
      verified: boolean;
      effectiveVersion: string;
      appliesFrom: string;
      gitignore?: string;
    }
  | { ok: false; reason: string; conflict?: boolean; currentHash?: string | null };

function targetPath(root: string, target: InstructionTarget): { path: string; scopeDir: string; name: string } {
  if (target === "user")
    return { path: join(getProductUserDir(), "SHELRA.md"), scopeDir: getProductUserDir(), name: "SHELRA" };
  if (target === "local")
    return { path: join(root, ".shelra", "SHELRA.local.md"), scopeDir: join(root, ".shelra"), name: "SHELRA.local" };
  if (target === "project") {
    const existing = aliasesIn(root, "SHELRA.md").chosen;
    return { path: existing ?? join(root, "SHELRA.md"), scopeDir: join(root, ".shelra"), name: "SHELRA" };
  }
  const base = target.scope === "user" ? getProductUserDir() : join(root, ".shelra");
  const safe = target.rule.replace(/[^A-Za-z0-9._-]/gu, "-").replace(/\.md$/iu, "");
  return { path: join(base, "rules", `${safe}.md`), scopeDir: base, name: `rule-${safe}` };
}

function replaceSection(
  text: string,
  heading: string,
  content: string,
  mode: "append_section" | "replace_section",
): string {
  const lines = text.split("\n");
  const wanted = heading.trim().toLowerCase();
  const start = lines.findIndex(
    (line) =>
      /^#{1,6}\s+/u.test(line) &&
      line
        .replace(/^#{1,6}\s+/u, "")
        .trim()
        .toLowerCase() === wanted,
  );
  const block = `## ${heading.trim()}\n\n${content.trim()}\n`;
  if (start < 0) return `${text.replace(/\s+$/u, "")}${text.trim() ? "\n\n" : ""}${block}`;
  const level = (lines[start]?.match(/^#+/u)?.[0] ?? "##").length;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const match = /^(#{1,6})\s+/u.exec(lines[i] as string);
    if (match && (match[1] as string).length <= level) {
      end = i;
      break;
    }
  }
  if (mode === "append_section") {
    const existing = lines.slice(start, end).join("\n").replace(/\s+$/u, "");
    return [...lines.slice(0, start), `${existing}\n\n${content.trim()}\n`, ...lines.slice(end)].join("\n");
  }
  return [...lines.slice(0, start), block, ...lines.slice(end)].join("\n");
}

/** Adds a line to the project's .gitignore (only in a git project, only when it is not there). Never throws. */
export function ensureGitignored(root: string, entry: string): string | undefined {
  try {
    const gitignore = join(root, ".gitignore");
    const current = existsSync(gitignore) ? readFileSync(gitignore, "utf8") : "";
    if (current.split(/\r?\n/u).some((line) => line.trim() === entry)) return undefined;
    const hadGit = existsSync(join(root, ".git"));
    if (!hadGit) return undefined;
    const result = writeDefinition({
      path: gitignore,
      content: `${current.replace(/\s+$/u, "")}${current ? "\n" : ""}${entry}\n`,
      kind: "instructions",
      name: "gitignore",
      scopeDir: join(root, ".shelra"),
    });
    return result.ok ? `added ${entry} to .gitignore` : undefined;
  } catch {
    return undefined;
  }
}

/** Edits one instruction file safely, then re-reads the effective set to confirm the text really is in force. */
export function updateInstructions(cwd: string, input: UpdateInstructionsInput): UpdateInstructionsOutcome {
  const root = findGitRoot(realOrResolved(cwd)) ?? realOrResolved(cwd);
  if (containsSecret(input.content))
    return {
      ok: false,
      reason: "the text contains what looks like a secret; instructions are sent to the model, so it was not written",
    };
  if (looksInjectionShaped(input.content))
    return {
      ok: false,
      reason:
        "the text reads like an attempt to override the harness's rules; instructions can guide behavior but not switch off checks",
    };
  if (input.content.length > MAX_FILE_BYTES)
    return { ok: false, reason: `the text is longer than ${MAX_FILE_BYTES} characters` };
  if (input.mode !== "replace_file" && !input.section?.trim())
    return { ok: false, reason: "a section heading is required unless the whole file is replaced" };
  const { path, scopeDir, name } = targetPath(root, input.target);
  const current = existsSync(path) ? readFileSync(path, "utf8") : "";
  let next: string;
  if (input.mode === "replace_file") next = `${input.content.trim()}\n`;
  else next = replaceSection(current, input.section as string, input.content, input.mode);
  if (typeof input.target === "object" && !current && input.paths && input.paths.length > 0)
    next = `---\npaths:\n${input.paths.map((glob) => `  - "${glob}"`).join("\n")}\n---\n\n${next}`;
  const written = writeDefinition({
    path,
    content: next,
    kind: typeof input.target === "object" ? "rule" : "instructions",
    name,
    scopeDir,
    ...(input.expectedHash ? { expectedHash: input.expectedHash } : {}),
  });
  if (!written.ok)
    return { ok: false, reason: written.reason, conflict: written.conflict, currentHash: written.currentHash };
  const gitignore = input.target === "local" ? ensureGitignored(root, ".shelra/SHELRA.local.md") : undefined;
  // Verified means a fresh load, from the files, now contains the text.
  const fresh = loadInstructionSet(cwd, { paths: input.paths ?? [] });
  const marker = input.content.trim().split("\n")[0]?.trim() ?? "";
  const verified = fresh.text !== null && (marker === "" || fresh.text.includes(marker));
  return {
    ok: true,
    path,
    created: written.created,
    changed: written.changed,
    hash: written.hash,
    previousHash: written.previousHash,
    snapshot: written.snapshot,
    verified,
    effectiveVersion: fresh.hash,
    appliesFrom:
      "the next turn (the current turn's prompt was already built); a sub-agent launched afterwards reads it too; the file is read again on every new session",
    ...(gitignore ? { gitignore } : {}),
  };
}
