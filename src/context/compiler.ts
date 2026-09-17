import { type Dirent, existsSync, readdirSync, readFileSync, realpathSync, statSync } from "fs";
import { basename, isAbsolute, join, relative, sep } from "path";
import type { ContextPacket, TurnClassification } from "./types";

const MAX_FILES = 256;
const MAX_WALK_DEPTH = 32;
const MAX_MANIFEST_CHARS = 1_500;
const MAX_CONTEXT_CHARS = 8_000;
const IGNORED = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".shelra",
  ".grok",
  // The local Shelra checkout is migration evidence, not part of the target
  // workspace. Scanning it first can consume MAX_FILES before package.json
  // and src/ are even considered.
  "ShelraCode",
]);

const MUTATION_RE =
  /\b(add|create|edit|fix|update|change|modify|refactor|remove|delete|write|implement|replace|migrate|implementa|agrega|agregar|crea|crear|corrige|corregir|actualiza|actualizar|cambia|cambiar|modifica|modificar|elimina|eliminar|escribe|escribir)\b/i;
const REPOSITORY_RE =
  /(?:\b(repo(?:sitory)?|repository|codebase|project|workspace|file|files|folder|directory|src|test|function|class|module|package|review|inspect|analy[sz]e|explore|read|list|proyecto|proyectos|repositorio|repositorios|c[oó]digo|c[oó]digos|carpeta|carpetas|directorio|directorios|archivo|archivos|fichero|ficheros|prueba|pruebas|funci[oó]n|clase|m[oó]dulo|paquete|revisa|revisar|revisi[oó]n|inspecciona|inspeccionar|analiza|analizar|examina|examinar|explora|explorar|lee|leer|lista|listar|muestra|mostrar|entiende|entender|estructura|estado)\b|[\\/]src[\\/]|\.(?:ts|tsx|js|jsx|py|go|rs|json)\b)/i;

/** Manifests worth a bounded excerpt: they orient the model on runtime, scripts, and dependencies. */
const MANIFEST_EVIDENCE = ["package.json", "pyproject.toml", "Cargo.toml", "go.mod", "pom.xml", "build.gradle"];
/** Files listed as relevant paths without excerpts; project instructions are injected separately. */
const MANIFEST_PATHS = ["package.json", "README.md", "AGENTS.md", "CLAUDE.md", ...MANIFEST_EVIDENCE];

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
  return { kind: "conversation", reason: "no repository or mutation signal" };
}

function isInsideRoot(realRoot: string, candidate: string): boolean {
  const rel = relative(realRoot, candidate);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/**
 * Depth-limited, cycle-safe directory walk. Real paths of visited directories
 * are remembered and symlinked directories are only followed when they resolve
 * back inside the workspace, so a `link -> .` cycle terminates instead of
 * recursing until the stack overflows.
 */
function walkDir(
  root: string,
  realRoot: string,
  current: string,
  paths: string[],
  visited: Set<string>,
  depth: number,
): void {
  if (paths.length >= MAX_FILES || depth > MAX_WALK_DEPTH) return;
  let realCurrent: string;
  try {
    realCurrent = realpathSync(current);
  } catch {
    return;
  }
  if (visited.has(realCurrent)) return;
  visited.add(realCurrent);

  let entries: Dirent[];
  try {
    entries = readdirSync(current, { withFileTypes: true });
  } catch {
    return;
  }
  const orderedEntries = [...entries].sort(
    (a, b) => Number(a.isDirectory()) - Number(b.isDirectory()) || a.name.localeCompare(b.name),
  );
  for (const entry of orderedEntries) {
    if (paths.length >= MAX_FILES) return;
    if (IGNORED.has(entry.name)) continue;
    const absolute = join(current, entry.name);
    if (entry.isDirectory()) {
      walkDir(root, realRoot, absolute, paths, visited, depth + 1);
      continue;
    }
    if (entry.isFile()) {
      paths.push(relative(root, absolute).replaceAll("\\", "/"));
      continue;
    }
    if (!entry.isSymbolicLink()) continue;
    let realLinked: string;
    let linkedIsDirectory: boolean;
    try {
      realLinked = realpathSync(absolute);
      linkedIsDirectory = statSync(absolute).isDirectory();
    } catch {
      continue;
    }
    if (!linkedIsDirectory) {
      paths.push(relative(root, absolute).replaceAll("\\", "/"));
      continue;
    }
    if (isInsideRoot(realRoot, realLinked) && !visited.has(realLinked)) {
      walkDir(root, realRoot, absolute, paths, visited, depth + 1);
    }
  }
}

function walk(root: string, current: string, paths: string[]): void {
  let realRoot: string;
  try {
    realRoot = realpathSync(root);
  } catch {
    realRoot = root;
  }
  walkDir(root, realRoot, current, paths, new Set<string>(), 0);
}

function readBounded(path: string, maxChars: number): string | null {
  if (!existsSync(path)) return null;
  try {
    const text = readFileSync(path, "utf8");
    return text.length > maxChars ? `${text.slice(0, maxChars)}\n[truncated]` : text;
  } catch {
    return null;
  }
}

function objectiveTerms(prompt: string): string[] {
  return prompt
    .toLowerCase()
    .split(/[^a-z0-9_.-]+/i)
    .filter((term) => term.length >= 3)
    .slice(0, 24);
}

/**
 * Bounded orientation for a repository-related turn: which paths look relevant to the request
 * and a short excerpt of the project manifest. Project instructions (AGENTS.md, CLAUDE.md) are
 * merged into the system prompt separately, and README content is left for the model to read
 * on demand, so nothing here is injected twice.
 */
export function compileContextPacket(root: string, prompt: string, maxChars = MAX_CONTEXT_CHARS): ContextPacket {
  const classification = classifyTurn(prompt);
  if (classification.kind === "conversation") {
    return { classification, promptAppendix: "", files: [], truncated: false };
  }

  const allFiles: string[] = [];
  walk(root, root, allFiles);
  const terms = objectiveTerms(prompt);
  const ranked = allFiles
    .map((path) => ({
      path,
      score: terms.reduce((score, term) => score + (path.toLowerCase().includes(term) ? 2 : 0), 0),
    }))
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  const files = ranked
    .filter((entry) => entry.score > 0)
    .slice(0, 24)
    .map((entry) => entry.path);
  const manifestPaths = MANIFEST_PATHS.filter((path) => allFiles.includes(path));
  const selected = [...new Set([...manifestPaths, ...files])];

  const sections: string[] = [
    "HOST-COMPILED REPOSITORY CONTEXT:",
    `Turn classification: ${classification.kind} (${classification.reason}).`,
    `Workspace root: ${root}`,
    "The host selected bounded evidence; read files on demand instead of requesting the entire repository.",
    selected.length > 0
      ? `Relevant paths:\n${selected.map((path) => `- ${path}`).join("\n")}`
      : "No matching repository paths were found yet.",
  ];
  const manifest = MANIFEST_EVIDENCE.find((path) => allFiles.includes(path));
  if (manifest) {
    const content = readBounded(join(root, manifest), MAX_MANIFEST_CHARS);
    if (content) sections.push(`Evidence: ${manifest}\n${content}`);
  }
  const appendix = sections.join("\n\n");
  return {
    classification,
    promptAppendix:
      appendix.length > maxChars ? `${appendix.slice(0, maxChars)}\n[context truncated by host]` : appendix,
    files: selected,
    truncated: appendix.length > maxChars || allFiles.length >= MAX_FILES,
  };
}

export function formatContextForDebug(packet: ContextPacket): string {
  return JSON.stringify(
    {
      classification: packet.classification,
      files: packet.files,
      truncated: packet.truncated,
      characters: packet.promptAppendix.length,
    },
    null,
    2,
  );
}

export function pathLabel(path: string): string {
  return basename(path);
}
