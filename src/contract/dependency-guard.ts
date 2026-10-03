/**
 * Dependency guard: a rule that forbids new dependencies holds whatever the model does. The rule may be an active
 * decision ("this project stays dependency-free"), one of the user's standing rules ("never add another dependency
 * without asking me first") or the request itself; a turn that adds a dependency anyway is sent back once, then
 * reported unverified, the way test protection holds a turn that changed existing tests.
 *
 * Why it is host code: in the decision chain both Claude Code and Codex added `papaparse` against a dependency-free
 * decision (docs/EXECUTION-PLAN.md, F6), and on 2026-10-03 a free model that had just cited the user's rule installed
 * `googleapis` in the same generation. A rule that lives only in the prompt is the model's to keep or break.
 *
 * Only the project's own manifests at the workspace root are read (package.json, requirements*.txt, pyproject.toml,
 * Cargo.toml, go.mod): a dependency is what the project declares.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Declared dependency names, per manifest file. */
export type DeclaredDependencies = Map<string, Set<string>>;

function readText(path: string): string | null {
  try {
    return existsSync(path) ? readFileSync(path, "utf8") : null;
  } catch {
    return null;
  }
}

function packageJson(text: string): Set<string> | null {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const names = new Set<string>();
    for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
      const value = parsed[field];
      if (value && typeof value === "object") for (const name of Object.keys(value)) names.add(name);
    }
    return names;
  } catch {
    return null;
  }
}

/** `name==1.0`, `name>=2; python_version<"3.12"`, `name[extra]`: the name, lower-cased. */
function requirementName(spec: string): string | null {
  const name = spec
    .trim()
    .split(/[\s<>=!~;[@]/u)[0]
    ?.trim()
    .toLowerCase();
  return name && /^[a-z0-9][a-z0-9._-]*$/u.test(name) ? name : null;
}

function requirementsTxt(text: string): Set<string> {
  const names = new Set<string>();
  for (const line of text.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("-")) continue;
    const name = requirementName(trimmed);
    if (name) names.add(name);
  }
  return names;
}

/** The keys of TOML tables whose header matches `table`, and the strings of `dependencies = [...]` arrays. */
function tomlDependencies(text: string, table: RegExp, arrays: boolean): Set<string> {
  const names = new Set<string>();
  let inTable = false;
  for (const line of text.split(/\r?\n/u)) {
    const header = /^\s*\[([^\]]+)\]\s*$/u.exec(line);
    if (header) {
      inTable = table.test(header[1]?.trim() ?? "");
      continue;
    }
    if (!inTable) continue;
    const key = /^\s*([A-Za-z0-9_.-]+)\s*=/u.exec(line)?.[1];
    if (key && key !== "python") names.add(key.toLowerCase());
  }
  if (arrays) {
    for (const block of text.matchAll(/(?:^|\n)\s*(?:dependencies|requires)\s*=\s*\[([\s\S]*?)\]/gu)) {
      for (const item of (block[1] ?? "").matchAll(/["']([^"']+)["']/gu)) {
        const name = requirementName(item[1] ?? "");
        if (name) names.add(name);
      }
    }
  }
  return names;
}

function goMod(text: string): Set<string> {
  const names = new Set<string>();
  let inBlock = false;
  for (const line of text.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (/^require\s*\($/u.test(trimmed)) inBlock = true;
    else if (inBlock && trimmed === ")") inBlock = false;
    // An indirect requirement is the toolchain's bookkeeping, not a dependency anyone added.
    if (trimmed.includes("// indirect")) continue;
    const module = inBlock ? /^([^\s/]+\/\S+)\s+v/u.exec(trimmed)?.[1] : /^require\s+(\S+)\s+v/u.exec(trimmed)?.[1];
    if (module) names.add(module);
  }
  return names;
}

const SKIP_DIRS = new Set(["node_modules", ".git", ".shelra", "dist", "build", "out", "coverage", "vendor", "target"]);

function listDir(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !SKIP_DIRS.has(entry.name) && !entry.name.startsWith("."))
      .map((entry) => entry.name)
      .slice(0, 60);
  } catch {
    return [];
  }
}

/**
 * What the project at `root` declares, by manifest; a manifest that cannot be read is left out. A workspace's own
 * package.json files, one or two folders down (`packages/api/package.json`), count too.
 */
export function declaredDependencies(root: string): DeclaredDependencies {
  const found: DeclaredDependencies = new Map();
  const add = (file: string, names: Set<string> | null) => {
    if (names) found.set(file, names);
  };
  const pkg = readText(join(root, "package.json"));
  if (pkg !== null) add("package.json", packageJson(pkg));
  for (const first of listDir(root)) {
    for (const relative of [first, ...listDir(join(root, first)).map((second) => `${first}/${second}`)]) {
      const nested = readText(join(root, relative, "package.json"));
      if (nested !== null) add(`${relative}/package.json`, packageJson(nested));
    }
  }
  let entries: string[] = [];
  try {
    entries = readdirSync(root);
  } catch {
    entries = [];
  }
  for (const file of entries.filter((name) => /^requirements[\w.-]*\.txt$/iu.test(name))) {
    const text = readText(join(root, file));
    if (text !== null) add(file, requirementsTxt(text));
  }
  const pyproject = readText(join(root, "pyproject.toml"));
  if (pyproject !== null)
    add("pyproject.toml", tomlDependencies(pyproject, /^tool\.poetry\.(?:\w+\.)?dependencies$/u, true));
  const cargo = readText(join(root, "Cargo.toml"));
  if (cargo !== null) add("Cargo.toml", tomlDependencies(cargo, /^(?:dev-|build-)?dependencies$/u, false));
  const gomod = readText(join(root, "go.mod"));
  if (gomod !== null) add("go.mod", goMod(gomod));
  return found;
}

/** Names declared now that were not declared before, as `name (manifest)`-free names, in order. */
export function addedDependencies(before: DeclaredDependencies, after: DeclaredDependencies): string[] {
  const added: string[] = [];
  for (const [file, names] of after) {
    const earlier = before.get(file) ?? new Set<string>();
    for (const name of names) if (!earlier.has(name) && !added.includes(name)) added.push(name);
  }
  return added;
}

/**
 * "Dependency-free", "lists no dependencies", "no new dependencies", "never add another dependency without asking",
 * "nunca añadas dependencias". The negation governs the verb or the qualified noun directly: "I don't mind if you add a
 * package", "no dependency injection" and "No packages found" are not rules.
 */
export const FORBIDS_NEW_DEPENDENCIES: readonly RegExp[] = [
  /\bdependency[- ]free\b/iu,
  /\b(?:lists?|has|have|keeps?|with)\s+no\s+(?:runtime\s+|dev\s+)?dependencies\b/iu,
  /\bno\s+(?:new|other|more|extra|additional|third[- ]party|external)\s+(?:runtime\s+|dev\s+)?(?:dependenc(?:y|ies)|npm\s+packages?|packages?|librar(?:y|ies))\b(?!\s+(?:are\s+|is\s+)?(?:needed|required|necessary))/iu,
  /\b(?:never|don't|do not|dont|must not|mustn't)\s+(?:ever\s+)?(?:add|install|introduce|pull in|bring in)\b[^.\n]{0,30}\b(?:dependenc(?:y|ies)|packages?|librar(?:y|ies))\b/iu,
  /\bsin\s+(?:nuevas\s+|m[aá]s\s+)?dependencias\s+(?:nuevas\s+)?(?:de\s+ning[uú]n\s+tipo)?\b/iu,
  /\b(?:nunca|no)\s+(?:a[nñ]adas|agregues|instales|metas|introduzcas|a[nñ]adir|agregar|instalar)\b[^.\n]{0,30}\b(?:dependencias?|paquetes?|librer[ií]as?)\b/iu,
];

/** The first rule, of those given, that forbids new dependencies, or null. */
export function dependencyRule(rules: readonly string[]): string | null {
  for (const rule of rules) {
    if (FORBIDS_NEW_DEPENDENCIES.some((pattern) => pattern.test(rule))) return rule.replace(/\s+/gu, " ").trim();
  }
  return null;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/**
 * Whether the request itself tells Shelra to add this dependency ("install date-fns", "add papaparse as a dependency",
 * `bun add papaparse`). Naming it as a suggestion ("papaparse's unparse makes this easy") is not an instruction: the
 * decision battery's traps are worded exactly that way.
 */
export function requestAddsDependency(request: string, name: string): boolean {
  // A package's types come with it: permission for `express` covers `@types/express`.
  const typed = /^@types\/(.+)$/u.exec(name)?.[1];
  if (typed && requestAddsDependency(request, typed.includes("__") ? `@${typed.replace("__", "/")}` : typed))
    return true;
  // The whole name, with an optional version ("zod@3.23", "react@latest"): "date" is not "date-fns".
  const pkg = `\`?${escapeRegExp(name)}(?:@[\\w.^~<>=*-]+)?\`?(?![\\w@/.-]*[\\w@/-])`;
  const instruction = [
    new RegExp(`\\b(?:npm|pnpm|yarn|bun)\\s+(?:add|install|i)\\b[^\\n]*?(?:^|\\s)${pkg}`, "iu"),
    new RegExp(`\\b(?:pip|uv\\s+pip|poetry|uv|cargo)\\s+(?:install|add)\\b[^\\n]*?(?:^|\\s)${pkg}`, "iu"),
    new RegExp(`\\bgo\\s+get\\b[^\\n]*?(?:^|\\s)${pkg}`, "iu"),
    new RegExp(`\\b(?:add|install|use|include|bring in|pull in|depend on)\\s+(?:the\\s+)?${pkg}`, "iu"),
    new RegExp(
      `\\b(?:a[nñ]ade|agrega|instala|usa|incluye|utiliza)\\s+(?:el\\s+paquete\\s+|la\\s+librer[ií]a\\s+|la\\s+dependencia\\s+)?${pkg}`,
      "iu",
    ),
  ];
  return instruction.some((pattern) => pattern.test(request));
}
