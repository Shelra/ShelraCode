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

/**
 * The lines that carry meaning, blank lines and imports left out. Python keeps its indentation, which decides what a
 * line belongs to: asserts moved under an inserted `if False:` are rewritten lines, not kept ones (review 2026-10-03).
 */
function bodyOf(text: string, keepIndent: boolean): string[] {
  return lines(text)
    .filter((line) => !isImportLine(line))
    .map((line) => (keepIndent ? line.trimEnd() : line.trim()))
    .filter((line) => line.trim() !== "");
}

/**
 * `long` line by line, each marked kept (matched, in order, against `short`) or added; null when `short` is not in it
 * in order.
 */
function alignLines(short: readonly string[], long: readonly string[]): Array<{ line: string; kept: boolean }> | null {
  const aligned: Array<{ line: string; kept: boolean }> = [];
  let index = 0;
  for (const line of long) {
    const kept = index < short.length && line === short[index];
    if (kept) index += 1;
    aligned.push({ line, kept });
  }
  return index === short.length ? aligned : null;
}

/** `.only` silences every other test, the kept ones included, wherever it is added. */
const ONLY_RE = /\.only\s*\(|\bfdescribe\s*\(|\bfit\s*\(/u;
/** A marker that skips the test or block right after it: harmful when that block is one the test already had. */
const SKIP_MARKER_RE =
  /\.(?:skip|todo)\s*\(|\b(?:xit|xdescribe|xtest|xcontext)\s*\(|@pytest\.mark\.(?:skip|skipif|xfail)\b|@unittest\.(?:skip|expectedFailure)\b/u;
/** A line that stops what follows it from running or asserting: an early return, a comment or string opened, a dead branch, a skip call. */
const CUTS_FLOW_RE =
  /^(?:return\b|\/\*|"""|'''|if\s*\(?\s*(?:false|False|0|None)\s*\)?\s*[:{]?\s*$)|\bpytest\.skip\(|\bt\.Skip(?:Now|f)?\(|\bself\.skipTest\(|\bthis\.skip\(/u;
/** The start of a declaration, test or block of its own: code after a cut-off helper that the cut does not reach. */
const OPENS_BLOCK_RE =
  /^(?:(?:export\s+)?(?:async\s+)?(?:function|class|def|func)\b|(?:export\s+)?(?:const|let|var)\s+\w+\s*=|@|(?:test|it|describe|suite|context|beforeEach|afterEach|beforeAll|afterAll)(?:\.\w+)?\s*\(|[})\]]+[;,)]*$)/u;

/**
 * The first added line that can stop a test the file already had from asserting anything (review 2026-10-03): an
 * `.only` anywhere; a skip marker right before a kept line; a cut (an early return, an opened comment or string, a dead
 * branch, a skip call) whose next kept line is a statement it would stop, not the start of a block of its own. A new
 * helper's `return` or a new test's own skip is left alone.
 */
function disablingLine(aligned: ReadonlyArray<{ line: string; kept: boolean }>): string | null {
  for (const [index, { line, kept }] of aligned.entries()) {
    if (kept) continue;
    const text = line.trim();
    if (ONLY_RE.test(text)) return text;
    if (SKIP_MARKER_RE.test(text) && aligned[index + 1]?.kept) return text;
    if (CUTS_FLOW_RE.test(text)) {
      const next = aligned.slice(index + 1).find((entry) => entry.kept);
      if (next && !OPENS_BLOCK_RE.test(next.line.trim())) return text;
    }
  }
  return null;
}

/** An import line with its module left out, so a moved module's new import pairs with its old one. */
function bindingOf(line: string): string {
  return line
    .trim()
    .replace(/;$/u, "")
    .replace(/(['"])[^'"]+\1/u, "<>")
    .replace(/^from\s+[\w.]+\s+import\b/u, "from <> import")
    .replace(/^import\s+[\w.]+(\s+as\s+\w+)?;?$/u, "import <>$1");
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
 * to it: every line it had is still there in order (new cases, new assertions), no added line can skip or cut short
 * what was kept, and an import it re-pointed followed a module of the project that existed when the turn began and is
 * gone now (it moved). The original is the old text with only those import lines re-pointed. Refused otherwise: only
 * the request can allow that change.
 */
export function originalTestToRun(
  before: string,
  after: string,
  testPath: string,
  exists: (relativePath: string) => boolean,
  existedBefore: (relativePath: string) => boolean,
): { original: string; movedImports: string[] } | { refused: string } {
  const python = testPath.endsWith(".py");
  const aligned = alignLines(bodyOf(before, python), bodyOf(after, python));
  if (aligned === null) return { refused: "it removed or rewrote a line of the test" };
  const disabling = disablingLine(aligned);
  if (disabling) return { refused: `it added a line that can skip or cut short a test (\`${disabling}\`)` };
  const beforeImports = new Set(
    lines(before)
      .filter(isImportLine)
      .map((line) => line.trim()),
  );
  const newImports = lines(after)
    .filter(isImportLine)
    .filter((line) => !beforeImports.has(line.trim()));
  const kept = new Set(
    lines(after)
      .filter(isImportLine)
      .map((line) => line.trim()),
  );
  const removed = lines(before)
    .filter(isImportLine)
    .filter((line) => !kept.has(line.trim()));
  if (removed.length === 0) return { original: before, movedImports: [] };
  const replacement = new Map<string, string>();
  const used = new Set<string>();
  for (const line of removed) {
    const candidates = importCandidates(line, testPath);
    if (candidates.length === 0 || !candidates.some(existedBefore)) {
      return { refused: `it changed an import that is not a moved file of the project (\`${line.trim()}\`)` };
    }
    if (candidates.some(exists)) {
      return { refused: `it re-pointed an import whose module is still there (\`${line.trim()}\`)` };
    }
    const paired = newImports.find((candidate) => !used.has(candidate) && bindingOf(candidate) === bindingOf(line));
    if (!paired)
      return { refused: `it dropped an import without importing the same names from elsewhere (\`${line.trim()}\`)` };
    used.add(paired);
    replacement.set(line, paired);
  }
  const eol = before.includes("\r\n") ? "\r\n" : "\n";
  return {
    original: lines(before)
      .map((line) => replacement.get(line) ?? line)
      .join(eol),
    movedImports: removed.map((line) => line.trim()),
  };
}

/** "Remove the monthly report", "we no longer want X", "drop", "elimina", "ya no queremos". */
const REMOVES_CODE_RE =
  /\b(?:remove|delete|drop|get rid of|rip out|no longer (?:want|need|support))\b|(?:^|[\s¿¡])(?:elimin\w*|quit[ae]\w*|borr[ae]\w*|suprim\w*|ya no (?:queremos|necesitamos|soportamos))/iu;

/**
 * Whether a test the turn deleted went with the code it tested: the request asks to remove something, and every module
 * the test imported from the project is gone too (doc 21, the deterministic year: the monthly report the user dropped
 * in May took its test with it, and the turn was held for deleting a test). A test whose code is still there, or one
 * that imported nothing from the project, is not.
 */
export function deletedWithItsCode(
  request: string,
  before: string,
  testPath: string,
  exists: (relativePath: string) => boolean,
  existedBefore: (relativePath: string) => boolean,
): boolean {
  if (!REMOVES_CODE_RE.test(request)) return false;
  // Only imports of the project's own files count: `import os` names no file of the project, then or now.
  const ownModules = lines(before)
    .filter(isImportLine)
    .map((line) => importCandidates(line, testPath))
    .filter((candidates) => candidates.some(existedBefore));
  return ownModules.length > 0 && ownModules.every((candidates) => !candidates.some(exists));
}
