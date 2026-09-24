import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { type CheckKind, type DiscoveredCheck, discoverChecks } from "./discover";
import { isTestFile } from "./test-protection";

/**
 * The definition of done is fixed when a turn starts (audit doc 17, S10). The contract used to discover the
 * project's checks from the final workspace, so a turn that rewrote `"test": "bun test"` as `"test": "echo 1 pass"`
 * was judged by the check it had just written and reported verified. The host now records, when the turn starts,
 * each check's command and everything in the project that decides what that command runs:
 *
 * - the package scripts it calls, with their pre and post scripts and the scripts those call, in nested and
 *   workspace packages too;
 * - a Make or just recipe, with its prerequisites, variables and includes;
 * - the tooling files it executes and the files those load (`scripts/run-tests.js` and its helpers);
 * - the test runner's configuration (pytest, conftest.py, Jest, Vitest, Mocha, Bun) and the modules a
 *   `python -m` run could pick up from the folder instead of the installed ones;
 * - the settings that pick the shell or the package manager, and a `node_modules/.bin` shim with its target.
 *
 * The contract runs the turn-start commands in the turn-start folder, and the gate compares these definitions with
 * the workspace at the end. What cannot be seen from the project (a runner's internals under node_modules beyond its
 * entry file, a user-level ~/.npmrc) stays outside; doc 17 §6.14 lists it.
 */

/** One thing a check's command depends on, keyed so two readings of the same project can be compared part by part. */
export interface DefinitionPart {
  key: string;
  value: string;
  /** The project file the part was read from, relative to the workspace, with forward slashes. */
  file: string;
  /** Missing or broken when read (no such script, target or file; an unparsable package.json). */
  missing?: boolean;
}

export interface CheckDefinition extends DiscoveredCheck {
  parts: DefinitionPart[];
}

export interface CheckChange {
  kind: CheckKind;
  command: string;
  /** The project files whose part of the definition changed. */
  files: string[];
  description: string;
}

/** Reads a project file; a turn-start reader can serve recorded contents instead of the disk. */
export type Reader = (path: string) => string | null;

const diskReader: Reader = (path) => {
  try {
    return statSync(path).isFile() ? readFileSync(path, "utf8") : null;
  } catch {
    return null;
  }
};

/** The checks the contract runs (never a build) as the workspace defines them now. */
export function snapshotCheckDefinitions(workspace: string): CheckDefinition[] {
  return discoverChecks(workspace)
    .filter((check) => check.kind !== "build")
    .map((check) => ({ ...check, parts: definitionOf(workspace, check.command, { kind: check.kind }).parts }));
}

/** How each turn-start check's definition differs from the workspace now, once per check. */
export function changedCheckDefinitions(
  before: readonly CheckDefinition[],
  workspace: string,
  allowedKinds: ReadonlySet<CheckKind> = new Set(),
): CheckChange[] {
  const changes: CheckChange[] = [];
  for (const start of before) {
    if (allowedKinds.has(start.kind)) continue;
    const now = definitionOf(workspace, start.command, { kind: start.kind });
    const files = changedParts(start.parts, now.parts);
    if (files.length === 0) continue;
    const named =
      start.source.startsWith("package.json") || files.includes(start.source) ? "" : `, named in ${start.source}`;
    changes.push({
      kind: start.kind,
      command: start.command,
      files,
      description: `what \`${start.command}\` runs changed (${files.join(", ")}${named})`,
    });
  }
  return changes;
}

/**
 * Checks the project states now that it did not state when the turn started, or states differently: a new command
 * table row, a relabelled row, a script that now takes precedence. The contract of this turn ignores them (it runs the
 * turn-start commands); they must not become the next turn's definition of done unless a request allows it.
 */
export function addedCheckSources(
  before: readonly CheckDefinition[],
  workspace: string,
  allowedKinds: ReadonlySet<CheckKind> = new Set(),
): string[] {
  const added: string[] = [];
  for (const check of discoverChecks(workspace)) {
    if (check.kind === "build" || allowedKinds.has(check.kind)) continue;
    const start = before.find((item) => item.kind === check.kind);
    if (!start) added.push(`a new ${check.kind} check \`${check.command}\` (${check.source})`);
    else if (identity(start.command) !== identity(check.command)) {
      added.push(`the ${check.kind} check is now \`${check.command}\` (${check.source}), not \`${start.command}\``);
    }
  }
  return added;
}

/** The files that define package scripts, recipes and runner settings, as they were at a point in time. */
export interface RecordedFiles {
  files: Map<string, string | null>;
}

const ROOT_DEFINITION_FILES = [
  "package.json",
  "Makefile",
  "justfile",
  ".npmrc",
  ".yarnrc",
  ".yarnrc.yml",
  "pnpm-workspace.yaml",
  "bunfig.toml",
  "pytest.ini",
  "setup.cfg",
  "tox.ini",
  "pyproject.toml",
  "conftest.py",
];

export function recordDefinitionFiles(workspace: string): RecordedFiles {
  const files = new Map<string, string | null>();
  for (const name of ROOT_DEFINITION_FILES) files.set(name, diskReader(join(workspace, name)));
  for (const dir of workspacePackages(workspace, diskReader).slice(0, 200)) {
    const file = toProjectPath(workspace, join(dir, "package.json"));
    files.set(file, diskReader(join(dir, "package.json")));
  }
  return { files };
}

/**
 * Whether running `command` from `runDir` now runs something that differs from what it ran when the turn started:
 * a script, recipe or setting the recorded files show changed, or a tooling or configuration file the workspace
 * shows changed during the turn. Such a run proves only what the turn wrote into it.
 */
export function runsChangedDefinition(
  command: string,
  runDir: string,
  workspace: string,
  turnStart: RecordedFiles,
  changedThisTurn: ReadonlySet<string>,
): boolean {
  const recorded: Reader = (path) => {
    const key = toProjectPath(workspace, path);
    return turnStart.files.has(key) ? (turnStart.files.get(key) ?? null) : diskReader(path);
  };
  const then = definitionOf(workspace, command, { reader: recorded, dir: runDir });
  const now = definitionOf(workspace, command, { dir: runDir });
  if (changedParts(then.parts, now.parts).length > 0) return true;
  return now.parts.some((part) => !turnStart.files.has(part.file) && changedThisTurn.has(part.file));
}

/**
 * Whether the turn's own file edits made a change, rather than another session, the user's editor or a merge: for
 * each file, the definition read from the content before the turn first wrote it is compared with the definition
 * now. `beforeTurnWrite` gives that content (null: the file did not exist) or undefined when the file tools never
 * wrote the file.
 */
export function changeMadeByTurn(
  change: CheckChange,
  workspace: string,
  beforeTurnWrite: (file: string) => string | null | undefined,
): boolean {
  return change.files.some((file) => {
    const previous = beforeTurnWrite(file);
    if (previous === undefined) return false;
    const reader: Reader = (path) => (toProjectPath(workspace, path) === file ? previous : diskReader(path));
    const kind = change.kind;
    const then = definitionOf(workspace, change.command, { reader, kind });
    const now = definitionOf(workspace, change.command, { kind });
    return changedParts(then.parts, now.parts).includes(file);
  });
}

/** The kind of check a command is, when it names one: a stated check, or a package script named like one. */
export function checkKindOf(command: string, workspace: string): CheckKind | null {
  const text = normalize(command);
  const stated = discoverChecks(workspace).find(
    (check) =>
      identity(check.command) === identity(text) || (check.runs !== undefined && normalize(check.runs) === text),
  );
  if (stated) return stated.kind;
  const script = scriptOf(text);
  return script ? kindOfName(script) : null;
}

function kindOfName(name: string): CheckKind | null {
  if (/^(?:test|tests|unit|e2e|integration|spec)(?::|$)|^test[-:]/iu.test(name)) return "test";
  if (/^(?:lint|eslint|biome|check:lint)(?::|$)/iu.test(name)) return "lint";
  if (/^(?:typecheck|type-check|types|check-types|tsc)(?::|$)/iu.test(name)) return "typecheck";
  if (/^build(?::|$)/iu.test(name)) return "build";
  return null;
}

/**
 * The files whose parts differ, ignoring what cannot weaken a check: a purely additive change to a script or recipe,
 * and a check that was missing when the turn started and is now defined by a recognised runner (the turn repaired
 * it). Creating a configuration file, a module that shadows an installed one, or a tooling file a check names is a
 * change.
 */
function changedParts(before: readonly DefinitionPart[], after: readonly DefinitionPart[]): string[] {
  const now = new Map(after.map((part) => [part.key, part]));
  const files = new Set<string>();
  for (const part of before) {
    const current = now.get(part.key);
    if (part.missing) {
      if (!current || current.missing || current.value === part.value) continue;
      if (isScriptish(part.key) && isRecognisedRunner(current.value)) continue;
      files.add(part.file);
      continue;
    }
    if (current?.value === part.value) continue;
    if (current && isScriptish(part.key) && addsOnly(part.value, current.value)) continue;
    if (current && dependencyUpdated(part.value, current.value)) continue;
    files.add(part.file);
  }
  return [...files].sort();
}

function isScriptish(key: string): boolean {
  return key.startsWith("script:") || key.startsWith("recipe:");
}

const OTHER_OPERATORS_RE = /\|\||;|\||(?<![&>])&(?!&)/gu;

/**
 * Additive: every step the check ran it still runs first, in order, and any new step comes after them. A new first
 * step (`exit 0 && bun test`, `cd elsewhere && bun test`) is not additive, nor is a new `||`, `;`, pipe or background
 * `&`. One narrowing is allowed: an old step may exclude a file that a new step then runs (`vitest run --exclude
 * src/a.test.ts && bun test src/a.test.ts`, this repository's own convention for Bun-only suites).
 */
function addsOnly(before: string, after: string): boolean {
  const operators = (text: string) => text.match(OTHER_OPERATORS_RE)?.length ?? 0;
  if (operators(after) > operators(before)) return false;
  const oldSteps = before.split("&&").map((step) => normalize(step));
  const newSteps = after.split("&&").map((step) => normalize(step));
  if (newSteps.length < oldSteps.length) return false;
  const appended = newSteps.slice(oldSteps.length);
  return oldSteps.every(
    (step, index) => newSteps[index] === step || excludesOnlyWhatAppendedRun(step, newSteps[index] ?? "", appended),
  );
}

const EXCLUDE_RE = /\s--exclude(?:=|\s+)("[^"]+"|'[^']+'|\S+)/gu;

function excludesOnlyWhatAppendedRun(step: string, candidate: string, appended: readonly string[]): boolean {
  const unquote = (path: string) => path.replace(/^["']|["']$/gu, "");
  const already = new Set([...step.matchAll(EXCLUDE_RE)].map((match) => unquote(match[1] as string)));
  const added: string[] = [];
  const stripped = candidate.replace(EXCLUDE_RE, (match, path: string) => {
    if (already.has(unquote(path))) return match;
    added.push(unquote(path));
    return "";
  });
  if (added.length === 0 || normalize(stripped) !== step) return false;
  return added.every((path) =>
    appended.some((next) => isRunnerInvocation(next) && words(next).some((word) => unquote(word) === path)),
  );
}

/** Test, type and lint runners whose exit code is the verdict. */
const RUNNER_PROGRAMS = new Set([
  "vitest",
  "jest",
  "mocha",
  "ava",
  "tap",
  "pytest",
  "py.test",
  "tsc",
  "eslint",
  "biome",
  "ruff",
  "mypy",
  "pyright",
  "oxlint",
  "playwright",
  "cypress",
]);

function isRunnerInvocation(step: string): boolean {
  const argv = words(step).filter((word) => !/^[A-Za-z_]\w*=/u.test(word));
  let [program, next, third] = argv;
  if (program === "npx" || program === "bunx" || program === "pnpx") [program, next, third] = argv.slice(1);
  if ((program === "pnpm" && next === "exec") || (program === "yarn" && next === "dlx"))
    [program, next, third] = argv.slice(2);
  if (!program) return false;
  const base = program.replace(/\.(?:cmd|exe)$/iu, "");
  if (RUNNER_PROGRAMS.has(base)) return true;
  if (base === "bun" || base === "deno") return next === "test";
  if (base === "node") return next === "--test";
  if (base === "go") return next === "test" || next === "vet";
  if (base === "cargo") return next === "test" || next === "clippy" || next === "check";
  if (base === "python" || base === "python3" || base === "py") {
    return next === "-m" && ["pytest", "unittest", "mypy", "ruff"].includes(third ?? "");
  }
  return false;
}

/** A definition made only of runner steps joined by `&&`: what a repaired check may be. */
function isRecognisedRunner(body: string): boolean {
  if ((body.match(OTHER_OPERATORS_RE)?.length ?? 0) > 0) return false;
  const steps = body.split("&&").map((step) => normalize(step));
  return steps.length > 0 && steps.every((step) => isRunnerInvocation(step));
}

/* ── What the request allows ─────────────────────────────────────────────── */

const RUNNERS: ReadonlyArray<[RegExp, CheckKind]> = [
  [
    /\b(?:jest|vitest|mocha|jasmine|ava|pytest|unittest|bun test|node --test|playwright|cypress|npm test|pnpm test|yarn test)\b/iu,
    "test",
  ],
  [/\b(?:eslint|biome|oxlint|ruff|prettier|stylelint|flake8|pylint)\b/iu, "lint"],
  [/\b(?:tsc|typescript|mypy|pyright)\b/iu, "typecheck"],
];
const RUNNER_NAME =
  "(?:jest|vitest|mocha|jasmine|ava|pytest|unittest|bun test|node --test|playwright|cypress|eslint|biome|oxlint|ruff|prettier|stylelint|flake8|pylint|tsc|typescript|mypy|pyright)";
const KIND_WORDS: ReadonlyArray<[RegExp, CheckKind]> = [
  [/\b(?:tests?|testing|unit|e2e|integration|pruebas?)\b/iu, "test"],
  [/\b(?:lint(?:er|ing|s)?)\b/iu, "lint"],
  [/\b(?:type-?check(?:ing|er)?|type check|types|tipos)\b/iu, "typecheck"],
];
/** A verb acting on a check's script, command, runner or configuration: "update the test script". */
const CHECK_OBJECT_RE =
  /\b(?:change|update|modify|edit|rewrite|replace|adjust|set|configure|fix|rename|remove|delete|add|extend|make)\s+(?:(?:the|our|a|an|its|this|that|every|each)\s+)?(?:(?:npm|pnpm|yarn|bun|package\.json)\s+)?(?:(tests?|testing|unit|e2e|integration|lint(?:ing)?|type-?check(?:ing)?|type check|types)\s+)?(?:scripts?|commands?|runner|config(?:uration)?|setup|step|target|task)\b/iu;
const CHECK_OBJECT_ES_RE =
  /\b(?:cambia|actualiza|modifica|edita|arregla|configura|reemplaza|añade|agrega|corrige|reescribe)\w*\s+(?:(?:el|los|la|las|un|una)\s+)?(?:scripts?|comandos?|configuraci[oó]n|runner|paso)\s+(?:de|del|para)\s+(?:la\s+|las\s+|los\s+|el\s+)?(tests?|pruebas|lint|tipos|typecheck)\b/iu;
const MIGRATE_RE = new RegExp(
  `\\b(?:migrate|switch|move|moving|port|convert|replace|swap)\\b[^.]{0,60}?\\b${RUNNER_NAME}\\b[^.]{0,30}?\\b(?:to|with|for|by|into)\\b[^.]{0,20}?\\b${RUNNER_NAME}\\b|\\b${RUNNER_NAME}\\b[^.]{0,20}?\\b(?:instead of|in favou?r of|rather than)\\b[^.]{0,20}?\\b${RUNNER_NAME}\\b|\\b(?:migrate|switch|move|port|convert)\\b[^.]{0,40}?\\b(?:to|onto)\\s+${RUNNER_NAME}\\b|\\b(?:drop|replace)\\s+${RUNNER_NAME}\\b|\\b(?:reemplaza|cambia|migra|pasa)\\w*\\b[^.]{0,60}?\\b(?:por|a)\\s+${RUNNER_NAME}\\b|\\busa\\w*\\s+${RUNNER_NAME}\\s+en\\s+(?:vez|lugar)\\s+de\\b`,
  "iu",
);
const ADOPT_RE = new RegExp(
  `\\b(?:set ?up|configure|install|add|adopt|introduce|upgrade|bump|update|configura|instala|añade|agrega|actualiza)\\s+(?:\\w+\\s+){0,2}?${RUNNER_NAME}\\b`,
  "iu",
);
const MAKE_RUN_RE = /\b(?:make|haz que)\s+(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(test|lint|typecheck)\b/iu;
/**
 * Accepting a check change already made ("keep the check changes", "keep the new test script", "acepta los cambios de
 * los checks"): the phrase a `[Not verified]` note about a changed check tells the user to write.
 */
const ACCEPT_RE =
  /\b(?:keep|accept|approve)\s+(?:the\s+|these\s+|those\s+)?(?:(?:new|changed|updated|current)\s+(?:(?:tests?|lint|type-?check|types)\s+)?(?:checks?|scripts?|commands?|config(?:uration)?)|(?:(?:tests?|lint|type-?check|types)\s+)?(?:checks?|scripts?|commands?|config(?:uration)?)\s+changes?)\b/iu;
const ACCEPT_ES_RE =
  /\b(?:mant[eé]n|conserva|acepta)\w*\s+(?:los\s+|el\s+|la\s+|las\s+)?(?:cambios?|nuevos?|nuevas?)\s+(?:de\s+|del\s+|en\s+)?(?:los\s+|las\s+|el\s+|la\s+)?(?:checks?|scripts?|comandos?|configuraci[oó]n)\b/iu;
const PROHIBITION_RE =
  /\b(?:do not|don't|dont|never|without|not allowed to|must not|mustn't|may not|cannot|can't|should not|shouldn't|no need to)\b[^.]{0,50}?\b(?:chang|modif|edit|touch|updat|rewrit|delet|remov|alter|weaken|disabl|replac)\w*|\b(?:leave|keep)\b[^.]{0,40}\b(?:alone|untouched|unchanged|as (?:it is|is))\b|\boff[- ]limits\b|\b(?:no|sin|nunca|jamás)\s+(?:\w+\s+){0,2}?(?:cambi|modifi|toqu|toc|edit|borr|elimin|reemplac)\w*|\bdeja\b[^.]{0,40}\b(?:igual|como est[aá])\b/iu;
const CHECK_THING_RE =
  /\b(?:scripts?|package\.json|makefile|justfile|checks?|commands?|runner|config(?:uration)?|comandos?|configuraci[oó]n)\b/iu;
/** Bringing other work in: its changes to the checks come with it. "Open a pull request" is not one. */
const EXTERNAL_CHANGE_RE =
  /\bgit\s+(?:merge|pull|rebase|cherry-pick)\b|\bmerge\s+(?:the\s+)?(?:\S+\s+)?branch\b|\bmerge\s+(?:origin|upstream)\/|\bmerge\s+(?:main|master|develop)\b|\brebase\s+(?:on|onto)\b|\bpull\s+(?:the\s+latest\s+)?(?:changes\s+)?from\s+(?:origin|upstream|main|master)\b/iu;

function kindsNamed(sentence: string): Set<CheckKind> {
  const kinds = new Set<CheckKind>();
  for (const [pattern, kind] of [...RUNNERS, ...KIND_WORDS]) if (pattern.test(sentence)) kinds.add(kind);
  return kinds;
}

/**
 * The kinds a prohibition clause protects, or null when it protects no check: "don't change the lint script" names
 * lint, "leave the scripts alone" names every kind, and "do not modify the tests" is about test files, which the
 * contract already protects, not about what a check runs.
 */
function forbiddenBy(clause: string): Set<CheckKind> | "all" | null {
  if (CHECK_THING_RE.test(clause)) {
    const named = kindsNamed(clause);
    return named.size > 0 ? named : "all";
  }
  const named = kindsNamed(clause.replace(/\b(?:tests?|pruebas?)\b/giu, ""));
  return named.size > 0 ? named : null;
}

/**
 * The kinds of check the request asks to change. A sentence counts when its verb acts on a check's script, command,
 * runner or configuration ("update the test script", "migrate from jest to vitest", "upgrade ESLint", "make npm test
 * also run the integration tests"), not when a check word and an object word merely share it. A prohibition
 * ("don't change the lint script", "you are not allowed to touch package.json") takes away the kinds its clause
 * names, or every kind when it names a check but no kind; what comes before it in the sentence can still allow.
 * Merging other work in allows the changes it brings.
 */
export function checkEditsAllowedBy(request: string): Set<CheckKind> {
  const text = request.replace(/[‘’′`]/gu, "'");
  const allowed = new Set<CheckKind>();
  const forbidden = new Set<CheckKind>();
  let forbidsAll = false;
  if (EXTERNAL_CHANGE_RE.test(text)) for (const kind of ["test", "lint", "typecheck"] as const) allowed.add(kind);
  for (const whole of text.split(/(?<=[.!?])\s+|\n+/u)) {
    // A prohibition covers its clause to the end of the sentence.
    const prohibition = PROHIBITION_RE.exec(whole);
    const protectedKinds = prohibition ? forbiddenBy(whole.slice(prohibition.index)) : null;
    if (protectedKinds === "all") forbidsAll = true;
    else for (const kind of protectedKinds ?? []) forbidden.add(kind);
    const sentence = prohibition && protectedKinds ? whole.slice(0, prohibition.index) : whole;
    const object = CHECK_OBJECT_RE.exec(sentence) ?? CHECK_OBJECT_ES_RE.exec(sentence);
    if (object) {
      const inObject = object[1] ? kindsNamed(object[1]) : new Set<CheckKind>();
      for (const kind of inObject.size > 0 ? inObject : kindsNamed(sentence)) allowed.add(kind);
    }
    if (MIGRATE_RE.test(sentence) || ADOPT_RE.test(sentence)) {
      for (const [pattern, kind] of RUNNERS) if (pattern.test(sentence)) allowed.add(kind);
    }
    const make = MAKE_RUN_RE.exec(sentence)?.[1]?.toLowerCase();
    if (make === "test" || make === "lint" || make === "typecheck") allowed.add(make);
    const accept = ACCEPT_RE.exec(sentence) ?? ACCEPT_ES_RE.exec(sentence);
    if (accept) {
      const named = kindsNamed(sentence);
      for (const kind of named.size > 0 ? named : (["test", "lint", "typecheck"] as const)) allowed.add(kind);
    }
  }
  if (forbidsAll) return new Set();
  for (const kind of forbidden) allowed.delete(kind);
  return allowed;
}

/** "yes, go ahead", "dale", "ok gracias, continúa": an answer that carries what the request before it allowed. */
export function isShortFollowUp(request: string): boolean {
  const text = request.trim().toLowerCase();
  if (text.split(/\s+/u).filter(Boolean).length > 8) return false;
  return /^(?:yes|yep|yeah|ok|okay|sure|go ahead|do it|proceed|continue|approved?|sounds good|please do|s[ií]|dale|vale|adelante|hazlo|procede|contin[uú]a|de acuerdo|perfecto|listo|correcto)\b/u.test(
    text,
  );
}

/* ── Reading what a command runs ──────────────────────────────────────────── */

function normalize(command: string): string {
  return command.trim().replace(/\s+/gu, " ");
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/");
}

function toProjectPath(workspace: string, path: string): string {
  return normalizePath(relative(workspace, path)) || ".";
}

function hash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

/** What a command is, whatever package manager runs it: `npm run test` and `bun run test` are the same script. */
function identity(command: string): string {
  const script = scriptOf(normalize(command));
  return script ? `package script ${script}` : normalize(command);
}

/** The package script a command runs: `bun run test`, `npm test`, `yarn lint`, `pnpm run typecheck`. */
function scriptOf(text: string): string | null {
  const run = /^(?:npm|pnpm|bun|yarn)\s+run\s+([\w:.-]+)$/u.exec(text)?.[1];
  if (run) return run;
  if (/^npm\s+(?:test|t)$/u.test(text)) return "test";
  return /^(?:yarn|pnpm)\s+([\w:.-]+)$/u.exec(text)?.[1] ?? null;
}

/** Splits a shell command into its simple commands, keeping quoted text whole and dropping grouping brackets. */
function segments(command: string): string[] {
  const out: string[] = [];
  let current = "";
  let quote: string | null = null;
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index] as string;
    if (quote) {
      current += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    const two = command.slice(index, index + 2);
    if (two === "&&" || two === "||") {
      out.push(current);
      current = "";
      index += 1;
      continue;
    }
    if (char === ";" || char === "|" || char === "&" || char === "\n") {
      out.push(current);
      current = "";
      continue;
    }
    // A subshell or group runs the same commands: `(cd a && npm test)`, `{ npm test; }`.
    if (char === "(" || char === ")" || char === "{" || char === "}") {
      current += " ";
      continue;
    }
    current += char;
  }
  out.push(current);
  return out.map((segment) => segment.trim()).filter(Boolean);
}

function words(segment: string): string[] {
  return [...segment.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/gu)].map((match) => match[1] ?? match[2] ?? match[3] ?? "");
}

interface Resolution {
  parts: DefinitionPart[];
}

interface ResolveContext {
  workspace: string;
  reader: Reader;
  out: Resolution;
  seen: Set<string>;
}

/** Everything in the project that decides what `command` runs. */
export function definitionOf(
  workspace: string,
  command: string,
  options: { reader?: Reader; dir?: string; kind?: CheckKind } = {},
): Resolution {
  const context: ResolveContext = {
    workspace,
    reader: options.reader ?? diskReader,
    out: { parts: [] },
    seen: new Set(),
  };
  resolveCommand(context, options.dir ?? workspace, command, 0);
  if (options.kind === "test" || looksLikeTestRun(command)) addTestRunnerConfig(context);
  const unique = new Map(context.out.parts.map((part) => [part.key, part]));
  return { parts: [...unique.values()].sort((a, b) => a.key.localeCompare(b.key)) };
}

function looksLikeTestRun(command: string): boolean {
  return /\b(?:test|pytest|vitest|jest|mocha)\b/iu.test(command);
}

function push(context: ResolveContext, part: DefinitionPart): void {
  context.out.parts.push(part);
}

const MANAGERS = new Set(["npm", "pnpm", "yarn", "bun"]);
const DIR_FLAGS = new Set(["--prefix", "-C", "--dir", "--cwd"]);
const WORKSPACE_FLAGS_RE = /^(?:--filter|-F|-r|--recursive|--workspaces?|-ws|--workspace|-w)(?:=|$)/u;
/** Flags that take a value, so the value is not mistaken for the script name. */
const VALUE_FLAGS = new Set(["--filter", "-F", "--workspace", "-w", "--prefix", "-C", "--dir", "--cwd", "--loglevel"]);

function resolveCommand(context: ResolveContext, dir: string, command: string, depth: number): void {
  if (depth > 6) return;
  let here = dir;
  for (const segment of segments(command)) {
    const argv = words(segment);
    // Leading VAR=value assignments do not change which program runs.
    while (argv.length > 0 && /^[A-Za-z_]\w*=/u.test(argv[0] as string)) argv.shift();
    const program = argv[0];
    if (!program) continue;
    if ((program === "cd" || program === "pushd") && argv[1]) {
      here = resolve(here, argv[1]);
      continue;
    }
    const base = program.replace(/\.(?:cmd|exe|ps1)$/iu, "");
    if (MANAGERS.has(base)) {
      resolveManager(context, here, base, argv.slice(1), depth);
    } else if (base === "npx" || base === "bunx" || base === "pnpx") {
      addBinary(context, here, argv[1]);
      addFiles(context, here, argv.slice(2));
    } else if (base === "make" || base === "just") {
      resolveTask(context, here, base, argv.slice(1), depth);
    } else if (base === "npm-run-all" || base === "run-s" || base === "run-p") {
      for (const name of argv.slice(1).filter((word) => !word.startsWith("-"))) {
        for (const script of matchingScripts(context, here, name)) resolveScript(context, here, script, depth, false);
      }
    } else if (base === "concurrently") {
      for (const word of argv.slice(1).filter((w) => !w.startsWith("-"))) {
        const npm = /^npm:(.+)$/u.exec(word)?.[1];
        if (npm) {
          for (const script of matchingScripts(context, here, npm)) resolveScript(context, here, script, depth, false);
        } else resolveCommand(context, here, word, depth + 1);
      }
    } else {
      addBinary(context, here, program);
      if ((base === "python" || base === "python3" || base === "py") && argv[1] === "-m" && argv[2]) {
        addShadows(context, here, argv[2]);
      }
      if (base === "pytest" || base === "py.test") addShadows(context, here, "pytest");
      addFiles(context, here, /^\.{0,2}\//u.test(program) ? [program, ...argv.slice(1)] : argv.slice(1));
    }
  }
}

function resolveManager(context: ResolveContext, dir: string, manager: string, args: string[], depth: number): void {
  let here = dir;
  let everyPackage = false;
  let ifPresent = false;
  const rest: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const word = args[index] as string;
    if (DIR_FLAGS.has(word) && args[index + 1]) {
      here = resolve(dir, args[index + 1] as string);
      index += 1;
      continue;
    }
    const inline = /^(--prefix|--dir|--cwd)=(.+)$/u.exec(word);
    if (inline?.[2]) {
      here = resolve(dir, inline[2]);
      continue;
    }
    if (word === "--if-present") {
      ifPresent = true;
      continue;
    }
    if (WORKSPACE_FLAGS_RE.test(word)) {
      everyPackage = true;
      if (VALUE_FLAGS.has(word) && args[index + 1] && !args[index + 1]?.startsWith("-")) index += 1;
      continue;
    }
    if (manager === "yarn" && word === "workspaces" && args[index + 1] === "run") {
      everyPackage = true;
      index += 1;
      continue;
    }
    if (manager === "yarn" && word === "workspace" && args[index + 1]) {
      everyPackage = true;
      index += 1;
      continue;
    }
    if (VALUE_FLAGS.has(word) && args[index + 1]) {
      index += 1;
      continue;
    }
    rest.push(word);
  }
  addManagerConfig(context, here);
  const positional = rest.filter((word) => !word.startsWith("-"));
  const verb = positional[0];
  const packages = everyPackage ? workspacePackages(here, context.reader) : [here];
  if (everyPackage && hasScriptsNamed(context, here, verb, positional)) packages.unshift(here);
  let script: string | undefined;
  if (verb === "run" || verb === "run-script") script = positional[1];
  else if (manager === "npm" && (verb === "test" || verb === "t")) script = "test";
  else if (verb && !(manager === "bun" && verb === "test")) {
    // `yarn unit`, `pnpm test:unit`, `bun lint`: a bare word runs a script when a package has one by that name.
    if (packages.some((packageDir) => hasScript(context, packageDir, verb))) script = verb;
  }
  if (manager === "bun" && !script) {
    // `bun test <files>` and `bun <file>` run files, not package scripts.
    addBinary(context, here, "bun");
    addFiles(context, here, verb === "test" ? positional.slice(1) : positional);
    return;
  }
  if (!script) return;
  for (const packageDir of packages) {
    // In a fan-out, a package without the script is simply skipped by the manager.
    resolveScript(context, packageDir, script, depth, ifPresent || everyPackage);
  }
}

function hasScriptsNamed(
  context: ResolveContext,
  dir: string,
  verb: string | undefined,
  positional: string[],
): boolean {
  const name = verb === "run" || verb === "run-script" ? positional[1] : verb;
  return name !== undefined && hasScript(context, dir, name);
}

function hasScript(context: ResolveContext, dir: string, name: string): boolean {
  const scripts = scriptsOf(dir, context.reader);
  return scripts !== null && typeof scripts[name] === "string";
}

/** JSON as npm and bun read it: a byte-order mark (Windows PowerShell 5.1 writes one) changes nothing. */
function parseJson(text: string): unknown {
  return JSON.parse(text.replace(/^\uFEFF/u, ""));
}

function scriptsOf(dir: string, reader: Reader): Record<string, unknown> | null {
  const text = reader(join(dir, "package.json"));
  if (text === null) return null;
  try {
    return (parseJson(text) as { scripts?: Record<string, unknown> }).scripts ?? {};
  } catch {
    return null;
  }
}

function matchingScripts(context: ResolveContext, dir: string, pattern: string): string[] {
  if (!pattern.includes("*")) return [pattern];
  const scripts = scriptsOf(dir, context.reader) ?? {};
  const regex = new RegExp(
    `^${pattern
      .split("**")
      .map((piece) =>
        piece
          .split("*")
          .map((text) => text.replace(/[.+?^${}()|[\]\\]/gu, "\\$&"))
          .join("[^:]*"),
      )
      .join(".*")}$`,
    "u",
  );
  return Object.keys(scripts).filter((name) => regex.test(name));
}

function resolveScript(context: ResolveContext, dir: string, name: string, depth: number, optional: boolean): void {
  const file = toProjectPath(context.workspace, join(dir, "package.json"));
  const id = `${file}#${name}`;
  if (context.seen.has(id)) return;
  context.seen.add(id);
  const text = context.reader(join(dir, "package.json"));
  const scripts = text === null ? null : scriptsOf(dir, context.reader);
  if (text === null || scripts === null || typeof scripts[name] !== "string") {
    const value =
      text === null ? "(no package.json)" : scripts === null ? "(package.json does not parse)" : "(no such script)";
    // A script the manager skips when absent (`--if-present`, a workspace fan-out) is part of nothing to protect,
    // and is not missing either: defining it later is a change like any other.
    push(context, {
      key: `script:${id}`,
      value: optional ? "(absent)" : value,
      file,
      ...(optional ? {} : { missing: true }),
    });
    return;
  }
  for (const entry of [`pre${name}`, name, `post${name}`]) {
    const body = scripts[entry];
    const key = `script:${file}#${entry}`;
    if (typeof body !== "string") {
      if (entry !== name) push(context, { key, value: "(none)", file });
      continue;
    }
    push(context, { key, value: body, file });
    resolveCommand(context, dir, body, depth + 1);
  }
  // Which package manager runs the scripts, and with which shell.
  const packageManager = (() => {
    try {
      return String((parseJson(text) as { packageManager?: unknown }).packageManager ?? "");
    } catch {
      return "";
    }
  })();
  push(context, { key: `config:${file}#packageManager`, value: packageManager, file });
}

/** Packages listed by the package.json `workspaces` field or pnpm-workspace.yaml, following `*` and `**` globs. */
function workspacePackages(dir: string, reader: Reader): string[] {
  const globs: string[] = [];
  const text = reader(join(dir, "package.json"));
  try {
    const field = text ? (parseJson(text) as { workspaces?: unknown }).workspaces : undefined;
    const list = Array.isArray(field) ? field : (field as { packages?: unknown } | undefined)?.packages;
    if (Array.isArray(list)) globs.push(...list.filter((item): item is string => typeof item === "string"));
  } catch {
    // An unparsable package.json has no workspaces to follow.
  }
  const pnpm = reader(join(dir, "pnpm-workspace.yaml"));
  if (pnpm)
    for (const match of pnpm.matchAll(/^\s*-\s*['"]?([^'"\n!]+)['"]?\s*$/gmu)) if (match[1]) globs.push(match[1]);
  const dirs = new Set<string>();
  const walk = (base: string, levels: number) => {
    let names: string[] = [];
    try {
      names = readdirSync(base);
    } catch {
      return;
    }
    for (const name of names) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      const candidate = join(base, name);
      if (existsSync(join(candidate, "package.json"))) dirs.add(candidate);
      if (levels > 1) walk(candidate, levels - 1);
    }
  };
  for (const glob of globs) {
    const deep = glob.includes("**");
    const clean = glob.replace(/\/\*\*?(?:\/\*)?$/u, "").replace(/\/$/u, "");
    if (!glob.includes("*")) dirs.add(resolve(dir, clean));
    else walk(resolve(dir, clean), deep ? 4 : 1);
  }
  return [...dirs].sort().slice(0, 200);
}

function resolveTask(context: ResolveContext, dir: string, runner: string, args: string[], depth: number): void {
  let here = dir;
  const targets: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const word = args[index] as string;
    if ((word === "-C" || word === "--directory" || word === "--working-directory") && args[index + 1]) {
      here = resolve(dir, args[index + 1] as string);
      index += 1;
    } else if (!word.startsWith("-") && !word.includes("=")) targets.push(word);
  }
  const fileName = runner === "make" ? "Makefile" : "justfile";
  for (const target of targets.length > 0 ? targets : ["(default)"]) {
    resolveRecipe(context, here, fileName, target, depth);
  }
}

function resolveRecipe(context: ResolveContext, dir: string, fileName: string, target: string, depth: number): void {
  const file = toProjectPath(context.workspace, join(dir, fileName));
  const id = `${file}#${target}`;
  if (context.seen.has(id) || depth > 6) return;
  context.seen.add(id);
  const text = context.reader(join(dir, fileName));
  if (text === null) {
    push(context, { key: `recipe:${id}`, value: "(no such file)", file, missing: true });
    return;
  }
  const lines = text.split(/\r?\n/u);
  const escaped = target.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const start =
    target === "(default)"
      ? lines.findIndex((line) => /^[A-Za-z][\w-]*\s*:(?!=)/u.test(line))
      : lines.findIndex((line) => new RegExp(`^${escaped}\\s*:(?!=)`, "u").test(line));
  if (start < 0) {
    push(context, { key: `recipe:${id}`, value: "(no such target)", file, missing: true });
    return;
  }
  const header = lines[start] ?? "";
  const recipe: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (!/^[\t ]/u.test(line) && line.trim() !== "") break;
    if (line.trim() !== "") recipe.push(line.trim());
  }
  push(context, { key: `recipe:${id}`, value: [header.trim(), ...recipe].join("\n"), file });
  // Included makefiles and the variables the recipe uses (`$(PYTEST)`, `${PYTEST}`, `{{pytest}}` in a justfile),
  // including `override`, `export` and target-specific assignments.
  const includes = lines.filter((line) => /^\s*-?include\s+/u.test(line));
  push(context, { key: `recipe:${file}$include`, value: includes.join("\n"), file });
  for (const variable of new Set(
    [...recipe.join("\n").matchAll(/\$[({]([A-Za-z_]\w*)[)}]|\{\{\s*([A-Za-z_]\w*)\s*\}\}/gu)].map(
      (match) => (match[1] ?? match[2]) as string,
    ),
  )) {
    const assignment = new RegExp(
      `^(?:[^\\t#:]*:\\s*)?(?:override\\s+|export\\s+)*${variable}\\s*(?::=|::=|\\?=|\\+=|!=|=)`,
      "u",
    );
    const definition = lines.filter((line) => assignment.test(line.trimStart()));
    push(context, { key: `recipe:${file}$${variable}`, value: definition.join("\n") || "(undefined)", file });
  }
  // Prerequisites run first, so they are part of the check too.
  const prerequisites = header
    .replace(/^[^:]*:(?!=)/u, "")
    .split(/\s+/u)
    .filter((name) => /^[A-Za-z][\w-]*$/u.test(name));
  for (const name of prerequisites) resolveRecipe(context, dir, fileName, name, depth + 1);
  for (const line of recipe) resolveCommand(context, dir, line.replace(/^[@-]+/u, ""), depth + 1);
}

/** Settings that decide which shell or package manager runs a package script. */
function addManagerConfig(context: ResolveContext, dir: string): void {
  const configs: Array<[string, RegExp]> = [
    [".npmrc", /^\s*(?:script-shell|shell|node-options|ignore-scripts)\s*=.*$/gmu],
    [".yarnrc", /^\s*(?:script-shell|shell|yarn-path)\b.*$/gmu],
    [".yarnrc.yml", /^\s*(?:scriptShell|shell|yarnPath)\s*:.*$/gmu],
    ["pnpm-workspace.yaml", /^\s*(?:scriptShell|shellEmulator|script-shell|shell-emulator)\s*:.*$/gmu],
  ];
  for (const place of new Set([context.workspace, dir])) {
    for (const [name, pattern] of configs) {
      const text = context.reader(join(place, name));
      const lines = text?.match(pattern)?.join("\n").trim() ?? "";
      const file = toProjectPath(context.workspace, join(place, name));
      push(context, { key: `config:${file}`, value: lines, file });
    }
  }
}

/** A section of an INI or TOML file, as text: `[tool:pytest]`, `[tool.pytest.ini_options]`, `[test]`. */
function section(text: string | null, header: RegExp): string {
  if (!text) return "(absent)";
  const lines = text.split(/\r?\n/u);
  const out: string[] = [];
  let inside = false;
  for (const line of lines) {
    if (/^\s*\[/u.test(line)) inside = header.test(line.trim());
    if (inside) out.push(line.trim());
  }
  return out.join("\n");
}

/** What a test runner reads before it decides which tests run and how: part of every test check. */
function addTestRunnerConfig(context: ResolveContext): void {
  const root = context.workspace;
  const read = (name: string) => context.reader(join(root, name));
  const put = (key: string, file: string, value: string) => push(context, { key: `config:${key}`, value, file });
  put(
    "pytest.ini",
    "pytest.ini",
    (() => {
      const text = read("pytest.ini");
      return text === null ? "(absent)" : hash(text);
    })(),
  );
  put("setup.cfg#pytest", "setup.cfg", section(read("setup.cfg"), /^\[tool:pytest\]/u));
  put("tox.ini#pytest", "tox.ini", section(read("tox.ini"), /^\[pytest\]/u));
  put("pyproject.toml#pytest", "pyproject.toml", section(read("pyproject.toml"), /^\[tool\.(?:pytest|coverage)/u));
  put("bunfig.toml#test", "bunfig.toml", section(read("bunfig.toml"), /^\[test\]/u));
  // pytest runs every conftest.py on the way to a test before the test, and one can decide every outcome
  // (`pytest_pyfunc_call` returning True). A new one anywhere, or a changed one outside test folders, is a change.
  const conftests = findFiles(root, "conftest.py", 4, 50);
  put("conftest.py#set", "conftest.py", conftests.join("\n"));
  for (const file of conftests) {
    const text = context.reader(join(root, file));
    put(file, file, text === null ? "(absent)" : hash(text));
  }
  for (const base of ["jest.config", "vitest.config", "vitest.workspace", ".mocharc", "playwright.config"]) {
    for (const extension of [".js", ".ts", ".mjs", ".cjs", ".mts", ".cts", ".json", ".yml", ".yaml"]) {
      const name = `${base}${extension}`;
      const text = read(name);
      // Only files that exist, plus the one canonical name per runner, so creating a config is seen.
      if (text !== null || extension === ".ts" || (base === ".mocharc" && extension === ".json")) {
        put(name, name, text === null ? "(absent)" : hash(text));
      }
    }
  }
}

/** Files with this name in the project, skipping dependencies, environments and hidden folders; bounded. */
function findFiles(root: string, name: string, levels: number, limit: number): string[] {
  const found: string[] = [];
  const walk = (dir: string, left: number) => {
    if (found.length >= limit) return;
    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry === name) found.push(toProjectPath(root, join(dir, entry)));
      if (
        left <= 0 ||
        entry.startsWith(".") ||
        ["node_modules", "venv", "__pycache__", "dist", "build"].includes(entry)
      ) {
        continue;
      }
      try {
        if (statSync(join(dir, entry)).isDirectory()) walk(join(dir, entry), left - 1);
      } catch {
        // Unreadable entries are skipped.
      }
    }
  };
  walk(root, levels);
  return found.sort().slice(0, limit);
}

/**
 * A project-local executable the command's program resolves to (`node_modules/.bin/vitest` and its target), in the
 * folder and the workspace root. Only the shim and the file it launches are covered, not the whole runner package.
 */
function addBinary(context: ResolveContext, dir: string, program: string | undefined): void {
  if (!program || program.includes("/") || program.includes("\\")) return;
  for (const place of new Set([dir, context.workspace])) {
    for (const suffix of ["", ".cmd", ".ps1", ".exe", ".bunx"]) {
      const path = join(place, "node_modules", ".bin", `${program}${suffix}`);
      const text = suffix === ".exe" ? binaryHash(path) : context.reader(path);
      if (text === null) continue;
      const file = toProjectPath(context.workspace, path);
      const target = suffix === ".exe" ? null : shimTarget(path, text);
      const label = target ? installedPackage(target, context.reader) : "";
      push(context, { key: `file:${file}`, value: `${label}${suffix === ".exe" ? text : hash(text)}`, file });
      if (target) {
        const targetText = context.reader(target);
        if (targetText !== null) {
          const targetFile = toProjectPath(context.workspace, target);
          push(context, { key: `file:${targetFile}`, value: `${label}${hash(targetText)}`, file: targetFile });
        }
      }
    }
  }
}

/**
 * `pkg:vitest@3.2.4|` for a file inside an installed package: a shim or entry file whose package version changed was
 * updated with its dependency, which is not a change to the check (see `changedParts`).
 */
function installedPackage(path: string, reader: Reader): string {
  let dir = dirname(path);
  while (!/[\\/]node_modules$/u.test(dir) && dirname(dir) !== dir) {
    const text = reader(join(dir, "package.json"));
    if (text !== null) {
      try {
        const manifest = parseJson(text) as { name?: unknown; version?: unknown };
        if (typeof manifest.name === "string" && typeof manifest.version === "string") {
          return `pkg:${manifest.name}@${manifest.version}|`;
        }
      } catch {
        return "";
      }
    }
    dir = dirname(dir);
  }
  return "";
}

/** Both values carry an installed package's version, and it changed: a dependency update, not a changed check. */
function dependencyUpdated(before: string, after: string): boolean {
  const version = (value: string) => /^pkg:([^|]+)\|/u.exec(value)?.[1];
  const then = version(before);
  const now = version(after);
  return then !== undefined && now !== undefined && then !== now;
}

function binaryHash(path: string): string | null {
  try {
    return statSync(path).isFile() ? createHash("sha256").update(readFileSync(path)).digest("hex").slice(0, 16) : null;
  } catch {
    return null;
  }
}

/** The file a shim launches: a symlink's target, or the `%dp0%\..\pkg\bin\x` path in an npm `.cmd` shim. */
function shimTarget(path: string, text: string): string | null {
  try {
    const real = realpathSync(path);
    if (normalizePath(real) !== normalizePath(path)) return real;
  } catch {
    // Not a link.
  }
  const cmd = /%~?dp0%?\\?\.\.[\\/]([^"\s]+)/u.exec(text)?.[1];
  if (cmd) return resolve(dirname(path), "..", cmd.replaceAll("\\", "/"));
  const sh = /\$basedir\/\.\.\/([^"\s]+)/u.exec(text)?.[1];
  return sh ? resolve(dirname(path), "..", sh) : null;
}

/** Modules a `python -m` run could import from the folder instead of the installed package. */
function addShadows(context: ResolveContext, dir: string, module: string): void {
  const top = module.split(".")[0] ?? module;
  const names = top === "pytest" ? ["pytest", "_pytest", "pluggy", "iniconfig", "py"] : [top];
  for (const name of names) {
    for (const candidate of [`${name}.py`, `${name}.pyc`, join(name, "__init__.py")]) {
      const path = join(dir, candidate);
      const file = toProjectPath(context.workspace, path);
      const text = context.reader(path);
      push(context, { key: `file:${file}`, value: text === null ? "(absent)" : hash(text), file });
    }
  }
}

/**
 * Tooling a check executes (`node scripts/run-tests.js`, `sh ./test.sh`, `./ci/check.ps1`) and the files those load:
 * the check runs their content. The code under test is not part of the definition (a check such as `bun run
 * src/cli.ts --selftest` would otherwise count every change to the program), and tests are test protection's to
 * guard. A tooling file a check names that does not exist is missing: creating it is a change.
 */
const TOOLING_FILE_RE =
  /(?:^|\/)(?:scripts?|tools?|bin|ci|\.github|\.husky)\/|(?:^|\/)[^/]*(?:test|check|lint|verify|ci)[^/]*$|\.(?:sh|bash|ps1|bat|cmd)$/iu;

function addFiles(context: ResolveContext, dir: string, args: string[], depth = 0): void {
  for (const arg of args) {
    if (!arg || arg.startsWith("-") || arg.includes("=") || arg.includes("*") || /^[a-z]+:/iu.test(arg)) continue;
    if (!/[/\\.]/u.test(arg)) continue;
    const path = resolve(dir, arg);
    const file = toProjectPath(context.workspace, path);
    if (file.startsWith("..") || file.includes("node_modules/")) continue;
    if (isTestFile(file) || !TOOLING_FILE_RE.test(file)) continue;
    addToolingFile(context, path, file, depth);
  }
}

function addToolingFile(context: ResolveContext, path: string, file: string, depth: number): void {
  const key = `file:${file}`;
  if (context.seen.has(key)) return;
  context.seen.add(key);
  const text = context.reader(path);
  if (text === null) {
    push(context, { key, value: "(absent)", file, missing: true });
    return;
  }
  push(context, { key, value: hash(text), file });
  if (depth >= 2) return;
  // What the tooling file loads from the project: relative requires, imports and sourced shell files.
  const loaded = [
    ...text.matchAll(/\brequire\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/gu),
    ...text.matchAll(/\bfrom\s+['"](\.{1,2}\/[^'"]+)['"]/gu),
    ...text.matchAll(/\bimport\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/gu),
    ...text.matchAll(/^\s*(?:source|\.)\s+(\.{0,2}\/?[^\s;]+)/gmu),
  ].map((match) => match[1] as string);
  for (const specifier of loaded) {
    const base = resolve(dirname(path), specifier);
    const candidates = [base, `${base}.js`, `${base}.mjs`, `${base}.cjs`, `${base}.ts`, join(base, "index.js")];
    const found = candidates.find((candidate) => context.reader(candidate) !== null);
    if (!found) continue;
    const loadedFile = toProjectPath(context.workspace, found);
    if (loadedFile.startsWith("..") || loadedFile.includes("node_modules/") || isTestFile(loadedFile)) continue;
    addToolingFile(context, found, loadedFile, depth + 1);
  }
}
