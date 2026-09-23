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
