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

/** A request to check, fix, continue or test what exists, in English or Spanish. */
const DIAGNOSE_RE =
  /\b(?:verifica\w*|revisa\w*|comprueba\w*|prueba\w*|probar|teste\w*|arregl\w*|corrig\w*|repara\w*|depura\w*|funcion\w*|falla\w*|errores|error|continu\w*|sigue|seguimos|fix\w*|debug\w*|check|verify|test|tests|broken|failing|fails?|works?|working|continue)\b/iu;
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

/** Whether a request asks for the project's state to be checked before the work: not a greeting or an approval. */
export function wantsDiagnosis(request: string): boolean {
  const text = request.trim();
  return text.length > 0 && !isShortFollowUp(text) && DIAGNOSE_RE.test(text);
}

/**
 * The checks to run before the work: the project's tests, type check and lint, or, when it states none, its build.
 * Nothing when the project states no checks: a new project has nothing to diagnose.
 */
export function diagnosisChecks(workspace: string): DiscoveredCheck[] {
  const stated = discoverChecks(workspace);
  const checks = contractChecks(stated);
  return (checks.length > 0 ? checks : stated.filter((check) => check.kind === "build")).slice(0, MAX_CHECKS);
}

/** What the model reads as the result of the check the host ran before the work. */
export function diagnosisOutput(command: string, passed: boolean, output: string): string {
  const header = `[Shelra ran \`${command}\` before the task began, on the project as you found it]`;
  return passed ? `${header}\nIt passes.` : `${header}\nIt fails:\n${describeFailures(output)}`;
}
