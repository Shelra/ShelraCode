import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { BrowserObservation, CommandOutcome, DomAssertion, HttpProbe } from "../exec/types";
import type { IntelligenceProvider } from "../intelligence/types";
import { resolveWorkspacePath } from "../security/workspace-guard";
import { scanWorkspace } from "./context";
import { JUDGE_SCHEMA, SYSTEM_JUDGE } from "./prompts";
import type { AcceptanceCriterion, CriterionResult, VerificationReport, ViewportName } from "./types";
import { verificationPassed } from "./types";

/**
 * The verification engine.
 *
 * The runtime — not the model — decides whether an objective is complete, and it decides by
 * running these checks against the software that actually exists. A model claiming success
 * is an input to this process, never a substitute for it.
 *
 * Browser-backed criteria are batched: every DOM, console and overflow criterion for a given
 * viewport is answered from a single page load, because loading the page once per assertion
 * would make verification slower than the implementation it verifies.
 */

export const VIEWPORTS: Record<ViewportName, { width: number; height: number }> = {
  mobile: { width: 375, height: 667 },
  desktop: { width: 1440, height: 900 },
};

/**
 * Capabilities the evaluator needs. Injecting them keeps this module pure enough to test
 * without a browser, a shell or a network.
 */
export interface AcceptanceDeps {
  runCommand(
    command: string,
    options: { cwd: string; timeoutMs?: number; signal?: AbortSignal; env?: Record<string, string> },
  ): Promise<CommandOutcome>;
  probeHttp(url: string): Promise<HttpProbe>;
  observePage(
    url: string,
    options: { viewport: { width: number; height: number }; assertions: DomAssertion[]; screenshotPath?: string },
  ): Promise<BrowserObservation>;
  intelligence?: IntelligenceProvider;
  /** Where to write screenshots taken during verification. */
  artifactPath?(name: string): string;
}

export interface AcceptanceContext {
  workspace: string;
  /** Repository root used to resolve benchmark-owned external oracle commands. */
  benchmarkRoot?: string;
  /** Base URL of the running app, when one is running. Absent means browser/http checks are blocked. */
  appUrl?: string;
  attempt: number;
  signal?: AbortSignal;
}

function result(
  criterion: AcceptanceCriterion,
  passed: boolean,
  detail: string,
  startedAt: number,
  modelJudged = false,
): CriterionResult {
  return {
    id: criterion.id,
    description: criterion.description,
    passed,
    detail,
    kind: criterion.check.kind,
    modelJudged,
    checkedAt: startedAt,
    durationMs: Date.now() - startedAt,
  };
}

function matchesPattern(content: string, pattern: string, ignoreCase?: boolean): boolean {
  const flags = ignoreCase ? "iu" : "u";
  try {
    return new RegExp(pattern, flags).test(content);
  } catch {
    // A non-regex pattern is a perfectly reasonable thing for the model to emit.
    return ignoreCase ? content.toLowerCase().includes(pattern.toLowerCase()) : content.includes(pattern);
  }
}

function acceptancePath(filePath: string, workspace: string): { path?: string; error?: string } {
  try {
    return { path: resolveWorkspacePath(filePath, workspace).path };
  } catch (error) {
    return { error: String(error) };
  }
}

function isRegularFile(filePath: string): boolean {
  try {
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function needsBrowser(criterion: AcceptanceCriterion): ViewportName | null {
  switch (criterion.check.kind) {
    case "dom":
      return criterion.check.viewport ?? "desktop";
    case "no_horizontal_overflow":
      return criterion.check.viewport;
    case "no_console_errors":
      return "desktop";
    case "no_external_requests":
      return "desktop";
    default:
      return null;
  }
}

/**
 * Resolve host-owned oracle placeholders without putting the target workspace's absolute path
 * into the manifest. The replacement is shell-quoted because commands are intentionally
 * executed through the platform's normal shell.
 */
function resolveBenchmarkCommand(command: string, context: AcceptanceContext): string {
  const replaceRoot = (input: string, name: "benchmarkRoot" | "workspace", root: string): string => {
    const token = new RegExp(`\\{\\{${name}\\}\\}([^\\s"']*)`, "gu");
    return input.replace(token, (_match, suffix: string) => shellQuote(join(root, suffix.replace(/^[/\\]+/u, ""))));
  };
  let resolved = command;
  if (context.benchmarkRoot) resolved = replaceRoot(resolved, "benchmarkRoot", context.benchmarkRoot);
  resolved = replaceRoot(resolved, "workspace", context.workspace);
  return resolved;
}

function shellQuote(value: string): string {
  if (process.platform === "win32") return `'${value.replace(/'/gu, "''")}'`;
  return `'${value.replace(/'/gu, "'\\''")}'`;
}

export async function evaluateAcceptance(
  criteria: AcceptanceCriterion[],
  context: AcceptanceContext,
  deps: AcceptanceDeps,
): Promise<VerificationReport> {
  const startedAt = Date.now();
  const results: CriterionResult[] = [];
  const blocked: string[] = [];

  // Group browser-backed criteria so each viewport costs exactly one page load.
  const browserGroups = new Map<ViewportName, AcceptanceCriterion[]>();
  const others: AcceptanceCriterion[] = [];
  for (const criterion of criteria) {
    const viewport = needsBrowser(criterion);
    if (viewport) {
      const group = browserGroups.get(viewport) ?? [];
      group.push(criterion);
      browserGroups.set(viewport, group);
    } else {
      others.push(criterion);
    }
  }

  for (const criterion of others) {
    if (context.signal?.aborted) break;
    const t0 = Date.now();
    const check = criterion.check;

    switch (check.kind) {
      case "file_exists": {
        const resolved = acceptancePath(check.path, context.workspace);
        if (!resolved.path) {
          results.push(result(criterion, false, `invalid workspace path ${check.path}: ${resolved.error}`, t0));
          break;
        }
        const exists = existsSync(resolved.path) && isRegularFile(resolved.path);
        results.push(result(criterion, exists, exists ? `${check.path} exists` : `${check.path} is missing`, t0));
        break;
      }
      case "files_exist": {
        const missing: string[] = [];
        for (const path of check.paths) {
          const resolved = acceptancePath(path, context.workspace);
          if (!resolved.path || !existsSync(resolved.path) || !isRegularFile(resolved.path)) missing.push(path);
        }
        results.push(
          result(
            criterion,
            missing.length === 0,
            missing.length === 0
              ? `${check.paths.length} required files exist`
              : `missing files: ${missing.join(", ")}`,
            t0,
          ),
        );
        break;
      }
      case "file_contains": {
        const resolved = acceptancePath(check.path, context.workspace);
        if (!resolved.path) {
          results.push(result(criterion, false, `invalid workspace path ${check.path}: ${resolved.error}`, t0));
          break;
        }
        const full = resolved.path;
        if (!existsSync(full)) {
          results.push(result(criterion, false, `${check.path} is missing`, t0));
          break;
        }
        let content = "";
        try {
          content = readFileSync(full, "utf8");
        } catch (err) {
          results.push(result(criterion, false, `could not read ${check.path}: ${String(err)}`, t0));
          break;
        }
        const hit = matchesPattern(content, check.pattern, check.ignoreCase);
        results.push(
          result(
            criterion,
            hit,
            hit ? `${check.path} matches ${check.pattern}` : `${check.path} does not contain ${check.pattern}`,
            t0,
          ),
        );
        break;
      }
      case "no_external_urls": {
        const paths = check.paths ?? scanWorkspace(context.workspace).files.map((file) => file.path);
        const matches: string[] = [];
        for (const path of paths) {
          const resolved = acceptancePath(path, context.workspace);
          if (!resolved.path || !existsSync(resolved.path)) continue;
          let content = "";
          try {
            content = readFileSync(resolved.path, "utf8");
          } catch {
            continue;
          }
          if (/https?:\/\//iu.test(content)) matches.push(path);
        }
        results.push(
          result(
            criterion,
            matches.length === 0,
            matches.length === 0
              ? "no HTTP(S) URLs found in workspace files"
              : `HTTP(S) URLs found in: ${matches.join(", ")}`,
            t0,
          ),
        );
        break;
      }
      case "command_succeeds": {
        const command = resolveBenchmarkCommand(check.command, context);
        const outcome = await deps.runCommand(command, {
          cwd: context.workspace,
          timeoutMs: check.timeoutMs ?? 180_000,
          signal: context.signal,
          env: {
            SHELRA_BENCH_WORKSPACE: context.workspace,
            ...(context.benchmarkRoot ? { SHELRA_BENCH_ROOT: context.benchmarkRoot } : {}),
          },
        });
        const expected = check.expectExitCode ?? 0;
        const ok = outcome.state === "completed" && outcome.exitCode === expected;
        const detail = ok
          ? `\`${check.command}\` exited ${outcome.exitCode}`
          : `\`${check.command}\` exited ${outcome.exitCode ?? "none"} (${outcome.state}). ` +
            `stderr: ${outcome.stderr.trim().slice(-800) || "(empty)"}` +
            (outcome.stderr.trim() ? "" : ` stdout: ${outcome.stdout.trim().slice(-800) || "(empty)"}`);
        results.push(result(criterion, ok, detail, t0));
        break;
      }
      case "http_ok": {
        if (!context.appUrl) {
          blocked.push(criterion.id);
          results.push(result(criterion, false, "application is not running, so the route could not be checked", t0));
          break;
        }
        const url = new URL(check.path || "/", context.appUrl).toString();
        const probe = await deps.probeHttp(url);
        const expected = check.expectStatus;
        const ok = expected ? probe.status === expected : probe.ok;
        results.push(
          result(
            criterion,
            ok,
            ok
              ? `GET ${url} -> ${probe.status}`
              : `GET ${url} -> ${probe.status ?? "no response"} ${probe.error ?? ""}`.trim(),
            t0,
          ),
        );
        break;
      }
      case "judge": {
        if (!deps.intelligence) {
          blocked.push(criterion.id);
          results.push(
            result(criterion, false, "no intelligence provider available to judge this criterion", t0, true),
          );
          break;
        }
        // Judged criteria see only evidence the runtime actually gathered.
        const evidence = await gatherJudgeEvidence(context, deps);
        const response = await deps.intelligence.complete<{ passed: boolean; reason: string }>({
          role: "judge",
          system: SYSTEM_JUDGE,
          prompt:
            `CRITERION: ${check.question}\n\n` +
            `EVIDENCE COLLECTED FROM THE RUNNING SOFTWARE:\n${evidence}\n\n` +
            "Does the evidence satisfy the criterion?",
          schema: JUDGE_SCHEMA,
          tier: "fast",
          signal: context.signal,
        });
        if (!response.ok || !response.data) {
          blocked.push(criterion.id);
          results.push(result(criterion, false, `judgement unavailable: ${response.error ?? "no answer"}`, t0, true));
          break;
        }
        results.push(result(criterion, response.data.passed, response.data.reason, t0, true));
        break;
      }
      default:
        break;
    }
  }

  for (const [viewport, group] of browserGroups) {
    if (context.signal?.aborted) break;
    const t0 = Date.now();

    if (!context.appUrl) {
      for (const criterion of group) {
        blocked.push(criterion.id);
        results.push(result(criterion, false, "application is not running, so the page could not be inspected", t0));
      }
      continue;
    }

    const domCriteria = group.filter((c) => c.check.kind === "dom");
    const assertions: DomAssertion[] = domCriteria.map((c) => {
      const check = c.check as Extract<AcceptanceCriterion["check"], { kind: "dom" }>;
      return {
        id: c.id,
        description: check.assertion.description,
        selector: check.assertion.selector,
        minCount: check.assertion.minCount,
        textContains: check.assertion.textContains,
        expression: check.assertion.expression,
        waitForChangeMs: check.assertion.waitForChangeMs,
      };
    });

    const screenshotPath = deps.artifactPath?.(`verify-${viewport}-attempt${context.attempt}.png`);
    const observation = await deps.observePage(context.appUrl, {
      viewport: VIEWPORTS[viewport],
      assertions,
      screenshotPath,
    });

    if (!observation.ok && observation.error) {
      for (const criterion of group) {
        blocked.push(criterion.id);
        results.push(result(criterion, false, `browser check unavailable: ${observation.error}`, t0));
      }
      continue;
    }

    const byId = new Map(observation.assertions.map((a) => [a.id, a]));
    for (const criterion of group) {
      const check = criterion.check;
      if (check.kind === "dom") {
        const assertion = byId.get(criterion.id);
        results.push(
          assertion
            ? result(criterion, assertion.passed, assertion.detail, t0)
            : result(criterion, false, "assertion did not run", t0),
        );
      } else if (check.kind === "no_console_errors") {
        const errors = [...observation.pageErrors, ...observation.consoleErrors];
        results.push(
          result(
            criterion,
            errors.length === 0,
            errors.length === 0
              ? "no console or page errors"
              : `${errors.length} error(s): ${errors.slice(0, 5).join(" | ")}`,
            t0,
          ),
        );
      } else if (check.kind === "no_external_requests") {
        const external = observation.externalRequests;
        if (external === undefined) {
          blocked.push(criterion.id);
          results.push(result(criterion, false, "browser observer did not collect external request evidence", t0));
        } else {
          results.push(
            result(
              criterion,
              external.length === 0,
              external.length === 0
                ? "no external HTTP(S) requests"
                : `external requests: ${external.slice(0, 5).join(" | ")}`,
              t0,
            ),
          );
        }
      } else if (check.kind === "no_horizontal_overflow") {
        const overflow = observation.horizontalOverflowPx ?? 0;
        const tolerance = check.tolerancePx ?? 4;
        const ok = overflow <= tolerance;
        results.push(
          result(
            criterion,
            ok,
            ok
              ? `no horizontal overflow at ${viewport} (${overflow}px)`
              : `content overflows horizontally by ${overflow}px at ${viewport} (${VIEWPORTS[viewport].width}px wide)`,
            t0,
          ),
        );
      }
    }
  }

  const report: VerificationReport = {
    attempt: context.attempt,
    passed: false,
    results,
    startedAt,
    durationMs: Date.now() - startedAt,
    blocked,
  };
  report.passed = verificationPassed(report, criteria);
  return report;
}

async function gatherJudgeEvidence(context: AcceptanceContext, deps: AcceptanceDeps): Promise<string> {
  if (!context.appUrl) return "The application is not running; no runtime evidence is available.";
  try {
    const observation = await deps.observePage(context.appUrl, {
      viewport: VIEWPORTS.desktop,
      assertions: [],
    });
    const parts = [
      `URL: ${observation.url}`,
      `status: ${observation.status ?? "unknown"}`,
      `title: ${observation.title ?? "(none)"}`,
    ];
    if (observation.consoleErrors.length)
      parts.push(`console errors: ${observation.consoleErrors.slice(0, 5).join(" | ")}`);
    return parts.join("\n");
  } catch (err) {
    return `Evidence collection failed: ${String(err)}`;
  }
}

/** Failing required criteria, which is exactly the repair loop's input. */
export function failingRequired(report: VerificationReport, criteria: AcceptanceCriterion[]): CriterionResult[] {
  const required = new Set(criteria.filter((c) => c.required).map((c) => c.id));
  return report.results.filter((r) => required.has(r.id) && !r.passed);
}

/**
 * A stable identity for a failure state, used to detect that the runtime is going in circles.
 * Built from criterion ids plus a normalized form of the observed detail, so cosmetic
 * differences (timings, ports, absolute paths) do not disguise a repeat of the same failure.
 */
export function failureFingerprint(failures: CriterionResult[]): string {
  return failures
    .map((f) => {
      const normalized = f.detail
        .toLowerCase()
        .replace(/\d+/gu, "#")
        .replace(/[a-z]:\\[^\s]*/gu, "<path>")
        .replace(/\/[^\s]*\//gu, "<path>")
        .slice(0, 160);
      return `${f.id}:${normalized}`;
    })
    .sort()
    .join("|");
}
