/**
 * Executable checks: the host-owned vocabulary for "is this done". A model may propose a check; only
 * running it decides. The live turn, the benchmark and the retiring autonomy runtime share these types
 * and one evaluator (evaluate.ts), so what counts as verified never differs between them (audit doc 15,
 * Phase 1.1).
 *
 * `judge` is the deliberate escape hatch for genuinely semantic requirements. It is the only variant a
 * model answers, and it is recorded as such, so evidence stays honest about what a machine verified
 * and what a model judged.
 */
export type CheckSpec =
  | { kind: "file_exists"; path: string }
  | { kind: "files_exist"; paths: string[] }
  | { kind: "file_contains"; path: string; pattern: string; ignoreCase?: boolean }
  | { kind: "no_external_urls"; paths?: string[] }
  | { kind: "command_succeeds"; command: string; timeoutMs?: number; expectExitCode?: number }
  | { kind: "http_ok"; path: string; expectStatus?: number }
  | { kind: "dom"; assertion: DomCheck; viewport?: ViewportName }
  | { kind: "no_console_errors" }
  | { kind: "no_external_requests" }
  | { kind: "no_horizontal_overflow"; viewport: ViewportName; tolerancePx?: number }
  | { kind: "judge"; question: string };

export type ViewportName = "mobile" | "desktop";

export interface DomCheck {
  description: string;
  selector?: string;
  minCount?: number;
  textContains?: string;
  expression?: string;
  /** Require the selected element's text to change during the observation window. */
  waitForChangeMs?: number;
}

export interface AcceptanceCriterion {
  id: string;
  description: string;
  check: CheckSpec;
  /** Non-required criteria are reported but do not block completion. */
  required: boolean;
}

export interface CriterionResult {
  id: string;
  description: string;
  passed: boolean;
  /** Human- and model-readable reason. For failures this is the primary repair input. */
  detail: string;
  kind: CheckSpec["kind"];
  /** True when a model decided this rather than a deterministic check. */
  modelJudged: boolean;
  checkedAt: number;
  durationMs: number;
}

export interface VerificationReport {
  attempt: number;
  passed: boolean;
  results: CriterionResult[];
  startedAt: number;
  durationMs: number;
  /** Criteria that could not be evaluated at all (e.g. app never started). */
  blocked: string[];
}

export function verificationPassed(report: VerificationReport, criteria: AcceptanceCriterion[]): boolean {
  const requiredIds = new Set(criteria.filter((c) => c.required).map((c) => c.id));
  if (report.blocked.some((id) => requiredIds.has(id))) return false;
  const byId = new Map(report.results.map((r) => [r.id, r]));
  for (const id of requiredIds) {
    const result = byId.get(id);
    if (!result || !result.passed) return false;
  }
  return true;
}
