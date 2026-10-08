import { isShortFollowUp } from "../contract/check-definitions";
import { contractChecks } from "../contract/contract";
import { type DiscoveredCheck, discoverChecks } from "../contract/discover";
import { describeFailures } from "../contract/failures";

/**
 * The project's state, observed by the host before the model's first round (owner, 2026-09-25: "le pedí buscar
 * contexto y analizar pero empezó a editar sin tener lo solicitado… hacer sin tener contexto suficiente es gastar
 * recursos"). Seen live that day: asked to check that a racing game worked and fix what was needed, a model went
 * straight back to re-indenting the methods it had re-indented for two hours, without running the build that failed
 * on a misplaced brace. When a request asks to check, fix, continue or test a project that states its checks, the
 * host runs them on the code as the turn found it and hands the model the results first, the way its own run would
 * read; the web search before the work then looks up the error they report.
 */

/**
 * What makes a request ask for the project's checks before any work (owner, 2026-10-07: "sin saber ni analizar" the
 * host ran `bun run test` first, for a request that only asked to review a section). Only words that say something
 * is broken, or ask to repair it, or ask to run the checks, count. Everyday words that merely appear in requests
 * about features (review, test, works, function, error, check, continue) do not: they started minutes of test runs
 * nobody asked for, the same kind of mistake as a keyword classifier that took over a whole request.
 */
const FIX_WORDS = String.raw`arregl\w*|corrig\w*|repar\w*|depur\w*|soluciona\w*|fix\w*|debug\w*|troubleshoot\w*`;
const BROKEN_WORDS = String.raw`broken|failing|crash\w*|falla\w*|rot[oa]s?|no\s+(?:funciona\w*|compila\w*|pasa\w*|arranca\w*|abre|anda)|(?:does(?:n't|\s+not)|do(?:n't|\s+not)|is(?:n't|\s+not)|are(?:n't|\s+not))\s+(?:work\w*|compil\w*|build\w*|run\w*|pass\w*|start\w*)|not\s+working|(?:tests?|build|checks?|lint)\s+(?:fails?|failed|break\w*)`;
const RUN_WORDS = String.raw`(?:run|execute|corre|corr[ae]r|ejecuta\w*|lanza\w*)\s+(?:\S+\s+){0,4}(?:the\s+|los\s+|las\s+|all\s+|todos\s+)?(?:tests?|pruebas|checks?|lint|typecheck|build|compilaci\w*)`;
const DIAGNOSE_RE = new RegExp(
  String.raw`(?<![\p{L}\p{N}])(?:${FIX_WORDS}|${BROKEN_WORDS}|${RUN_WORDS})(?![\p{L}\p{N}])`,
  "iu",
);
/** How long the whole diagnosis may take; a check still running then is reported as not finished. */
export const DIAGNOSIS_TIMEOUT_MS = 90_000;
/** At most this many checks run before the work. */
const MAX_CHECKS = 3;

/**
 * Whether a tool call is one the host made before the work (this diagnosis, the web search), not the model's: a
 * benchmark that counted them credited the model with a check it never ran.
 */
export function isHostCall(id: string): boolean {
  return id.startsWith("diagnosis-") || id.startsWith("research-");
}

/**
 * Why a request asks for the project's state to be checked before the work: the words of the request that say so
 * (shown to the person, so a check never starts without a reason), or null for a greeting, an approval, new work or a
 * request that only reviews, explains or improves something.
 */
export function diagnosisReason(request: string): string | null {
  const text = request.trim();
  if (text.length === 0 || isShortFollowUp(text)) return null;
  const found = DIAGNOSE_RE.exec(text);
  return found ? found[0].replace(/\s+/gu, " ").slice(0, 40) : null;
}

/** Whether a request asks for the project's state to be checked before the work. */
export function wantsDiagnosis(request: string): boolean {
  return diagnosisReason(request) !== null;
}

/** Cheap checks first: a type check or lint answers in seconds, a whole test suite can take minutes. */
const CHEAPEST_FIRST: Record<string, number> = { typecheck: 0, lint: 1, build: 2, test: 3 };

/**
 * The checks to run before the work: the project's tests, type check and lint, or, when it states none, its build.
 * Nothing when the project states no checks: a new project has nothing to diagnose.
 */
export function diagnosisChecks(workspace: string): DiscoveredCheck[] {
  const stated = discoverChecks(workspace);
  const checks = contractChecks(stated);
  const chosen = checks.length > 0 ? checks : stated.filter((check) => check.kind === "build");
  return [...chosen].sort((a, b) => (CHEAPEST_FIRST[a.kind] ?? 9) - (CHEAPEST_FIRST[b.kind] ?? 9)).slice(0, MAX_CHECKS);
}

/** What the model reads as the result of the check the host ran before the work. */
export function diagnosisOutput(command: string, passed: boolean, output: string): string {
  const header = `[Shelra ran \`${command}\` before the task began, on the project as you found it]`;
  return passed ? `${header}\nIt passes.` : `${header}\nIt fails:\n${describeFailures(output)}`;
}
