/**
 * Test protection (audit doc 15, Phase 1.5): the tests a project had before a turn are part of what "done"
 * means, not something to weaken until they pass. Editing, special-casing or deleting them is how an agent
 * games a check, so a turn that changed existing tests is held back unless the request asks for it.
 */

/** Test files, by the conventions of the common runners (Jest, Vitest, Bun, pytest, Go, RSpec). */
const TEST_FILE_RE =
  /(?:^|\/)(?:__tests__|tests?|spec)\/|\.(?:test|spec)\.[cm]?[jt]sx?$|(?:^|\/)test_[^/]*\.py$|_test\.(?:py|go)$|_spec\.rb$/u;

export function isTestFile(path: string): boolean {
  return TEST_FILE_RE.test(path.replace(/\\/gu, "/"));
}

/** "Do not modify tests", "never touch the tests", "no modifiques las pruebas". */
const FORBIDS_TEST_EDITS = [
  /\b(?:do not|don't|dont|never|without)\s+(?:\w+\s+){0,3}?(?:modify(?:ing)?|chang(?:e|ing)|edit(?:ing)?|touch(?:ing)?|rewrit(?:e|ing)|updat(?:e|ing)|delet(?:e|ing)|remov(?:e|ing))\b[^.\n]{0,30}\b(?:tests?|specs?)\b/iu,
  /\bno\s+(?:\w+\s+){0,2}?(?:modifiques|cambies|toques|edites|borres|elimines|modificar|cambiar|tocar|editar|borrar|eliminar)\b[^.\n]{0,30}\b(?:tests?|pruebas?)\b/iu,
];

/** "Update the tests", "fix the failing test", "the test is wrong", "corrige las pruebas". */
const ASKS_FOR_TEST_EDITS = [
  /\b(?:update|fix|change|modify|rewrite|edit|adjust|correct|replace|remove|delete)\b[^.\n]{0,40}\b(?:tests?|specs?)\b/iu,
  /\b(?:tests?|specs?)\b[^.\n]{0,40}\b(?:is|are)\s+(?:wrong|outdated|broken|incorrect|obsolete)\b/iu,
  /\b(?:actualiza|arregla|cambia|modifica|corrige|edita|elimina|borra|reescribe)\w*\b[^.\n]{0,40}\b(?:tests?|pruebas?)\b/iu,
];

/** Whether the request itself asks for changes to existing tests; an explicit prohibition always wins. */
export function requestAllowsTestEdits(request: string): boolean {
  if (FORBIDS_TEST_EDITS.some((pattern) => pattern.test(request))) return false;
  return ASKS_FOR_TEST_EDITS.some((pattern) => pattern.test(request));
}

/**
 * A top-level line that brings a module in: `import … from`, `export … from`, `const x = require(…)`, the closing line
 * of a multi-line import, Python's `import x` and `from x import y`. Indented lines are code, not imports.
 */
const IMPORT_LINE_RE =
  /^(?:import\b|export\s[^=]*\bfrom\s+['"]|(?:const|let|var)\s[^=]+=\s*require\(\s*['"]|\}\s*from\s+['"]|from\s+[\w.]+\s+import\b)/u;

function lines(text: string): string[] {
  return text.replace(/^﻿/u, "").split(/\r?\n/u);
}

function isImportLine(line: string): boolean {
  return IMPORT_LINE_RE.test(line);
}

/** The lines that carry meaning: trimmed, blank lines and imports left out. */
function bodyOf(text: string): string[] {
  return lines(text)
    .filter((line) => !isImportLine(line))
    .map((line) => line.trim())
    .filter(Boolean);
}

function isSubsequence(short: readonly string[], long: readonly string[]): boolean {
  let index = 0;
  for (const line of long) if (index < short.length && line === short[index]) index += 1;
  return index === short.length;
}

const SCRIPT_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"];

/** The files a removed import line could have named, relative to the workspace; none for a package or another language. */
export function importCandidates(line: string, testPath: string): string[] {
  const folder = testPath.replace(/\\/gu, "/").split("/").slice(0, -1).join("/");
  const join = (base: string, relative: string) => {
    const parts = base ? base.split("/") : [];
    for (const part of relative.split("/")) {
      if (part === "" || part === ".") continue;
      if (part === "..") {
        if (parts.length === 0) return null;
        parts.pop();
      } else parts.push(part);
    }
    return parts.join("/");
  };
  const script = /(?:from\s+|require\(\s*|^import\s+)['"](\.{1,2}\/[^'"]+)['"]/u.exec(line.trim())?.[1];
  if (script) {
    const base = join(folder, script);
    if (base === null) return [];
    const stem = base.replace(/\.(?:js|jsx|mjs|cjs)$/u, "");
    return [
      base,
      ...SCRIPT_EXTENSIONS.map((extension) => `${stem}${extension}`),
      ...SCRIPT_EXTENSIONS.map((extension) => `${base}/index${extension}`),
    ];
  }
  const python = /^(?:from\s+(\.*[\w.]*)\s+import\b|import\s+([\w.]+))/u.exec(line.trim());
  const module = python?.[1] ?? python?.[2];
  if (!module) return [];
  const dots = /^\.*/u.exec(module)?.[0].length ?? 0;
  const dotted = module.slice(dots).replaceAll(".", "/");
  const roots = dots > 0 ? [join(folder, "../".repeat(dots - 1)) ?? ""] : ["", "src"];
  return roots.flatMap((root) =>
    dotted
      ? [`${root ? `${root}/` : ""}${dotted}.py`, `${root ? `${root}/` : ""}${dotted}/__init__.py`]
      : [`${root ? `${root}/` : ""}__init__.py`],
  );
}

/**
 * The original of an existing test the turn changed, to run on the final code, when the change can only have added
 * to it: every line it had is still there in order (new cases, new assertions), and an import it lost points at a
 * module that is no longer there (the module moved, so the import had to follow). The original's imports are then
 * the new ones. Null when the change removed or rewrote a line that is not an import: only the request can allow that.
 */
export function originalTestToRun(
  before: string,
  after: string,
  testPath: string,
  exists: (relativePath: string) => boolean,
): { original: string; movedImports: string[] } | { refused: string } {
  if (!isSubsequence(bodyOf(before), bodyOf(after))) return { refused: "it removed or rewrote a line of the test" };
  const afterImports = lines(after).filter(isImportLine);
  const kept = new Set(afterImports.map((line) => line.trim()));
  const removed = lines(before)
    .filter(isImportLine)
    .filter((line) => !kept.has(line.trim()));
  for (const line of removed) {
    const candidates = importCandidates(line, testPath);
    if (candidates.length === 0)
      return { refused: `it changed an import that is not a moved file (\`${line.trim()}\`)` };
    if (candidates.some(exists)) {
      return { refused: `it re-pointed an import whose module is still there (\`${line.trim()}\`)` };
    }
  }
  if (removed.length === 0) return { original: before, movedImports: [] };
  const eol = before.includes("\r\n") ? "\r\n" : "\n";
  return {
    original: [...afterImports, ...lines(before).filter((line) => !isImportLine(line))].join(eol),
    movedImports: removed.map((line) => line.trim()),
  };
}
