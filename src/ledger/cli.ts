import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { destructiveCommandReason } from "../security/destructive";
import { BashTool } from "../tools/bash";
import { inScope } from "./glob";
import { activeDecisions, approveDecision, findDecision, LEDGER_DIR, listDecisions, rejectDecision } from "./store";
import type { Decision } from "./types";

/**
 * `shelra decisions`: the ledger from the command line, for proposals that were made where nobody could be
 * asked (a headless run, a benchmark), for reading what the project decided, and for checking that the
 * decisions still hold whichever agent or person changed the code.
 */

export const DECISIONS_ACTIONS = ["list", "show", "approve", "reject", "check"] as const;

function line(decision: Decision): string {
  const check = decision.check ? `  check: ${decision.check}` : "";
  const scope = decision.scope.length > 0 ? `  covers: ${decision.scope.join(", ")}` : "";
  return `  ${decision.id}  ${decision.title}${scope}${check}`;
}

export function runDecisionsCommand(
  workspace: string,
  action = "list",
  id?: string,
): { exitCode: number; output: string } {
  const verb = action.toLowerCase();
  if (verb === "list") {
    const decisions = listDecisions(workspace);
    if (decisions.length === 0) {
      return { exitCode: 0, output: `No decisions recorded in ${LEDGER_DIR} yet.` };
    }
    const sections: string[] = [];
    for (const [status, heading] of [
      ["proposed", "Waiting for your approval"],
      ["active", "Active"],
      ["superseded", "Superseded"],
    ] as const) {
      const group = decisions.filter((decision) => decision.status === status);
      if (group.length > 0) sections.push(`${heading}:\n${group.map(line).join("\n")}`);
    }
    return { exitCode: 0, output: sections.join("\n\n") };
  }
  if (!(DECISIONS_ACTIONS as readonly string[]).includes(verb)) {
    return { exitCode: 1, output: `Unknown action "${action}". Use one of: ${DECISIONS_ACTIONS.join(", ")}.` };
  }
  if (verb === "check") return { exitCode: 1, output: "Checks run asynchronously: call checkDecisions()." };
  if (!id) return { exitCode: 1, output: `shelra decisions ${verb} needs a decision id, such as D-0001.` };
  if (verb === "show") {
    const decision = findDecision(workspace, id);
    if (!decision) return { exitCode: 1, output: `No decision ${id} in ${LEDGER_DIR}.` };
    // The file as written, not as the ledger would format it.
    const text = readFileSync(join(workspace, decision.file), "utf8").replaceAll("\r\n", "\n").trimEnd();
    return { exitCode: 0, output: `${decision.file}\n\n${text}` };
  }
  const result = verb === "approve" ? approveDecision(workspace, id) : rejectDecision(workspace, id);
  if (!result.ok) return { exitCode: 1, output: result.reason };
  return verb === "approve"
    ? { exitCode: 0, output: `Approved ${result.decision.id}: ${result.decision.title}. It is an active decision now.` }
    : { exitCode: 0, output: `Rejected ${result.decision.id}: ${result.decision.title}. The proposal was removed.` };
}

export interface CheckDecisionsOptions {
  /** Only the decisions whose scope covers a file changed in the working tree against HEAD, as before a commit. */
  changed?: boolean;
  /**
   * Answer as a Claude Code Stop hook: when a decision does not hold, exit 2 with the guidance on stderr, which
   * Claude Code feeds back to Claude so it keeps working; never twice in a row (`stop_hook_active`).
   */
  hook?: "claude-code";
  /** The hook's JSON input, which Claude Code sends on stdin. */
  hookInput?: string;
  timeoutMs?: number;
}

export interface CheckDecisionsResult {
  exitCode: number;
  output: string;
  /** Where the output goes: stderr carries a hook's guidance and every failure. */
  stream: "stdout" | "stderr";
}

/**
 * What a check said about its decision. A check that could not run (its script or tool is missing, it
 * timed out) or was not run (it would do damage) vouches for nothing, and is never reported as a broken rule.
 */
type Outcome = "holds" | "broken" | "could not run" | "not run";

interface Judged {
  decision: Decision;
  outcome: Outcome;
  detail: string;
}

const CHECK_TIMEOUT_MS = 10 * 60_000;
const OUTPUT_TAIL = 1_500;
const GIT_TIMEOUT_MS = 3_000;
/** A failure of the environment rather than of the code: the command, its script or its runtime is missing. */
const ENVIRONMENT_FAILURE_RE = /timed out|not recognized|not found|ENOENT|no such file|cannot find|command not found/iu;

/**
 * Workspace-relative files changed in the working tree: against HEAD, or every tracked file in a repository
 * with no commit yet, new files included either way. Null outside a git repository.
 */
function changedFiles(workspace: string): string[] | null {
  const git = (...args: string[]) =>
    execFileSync("git", ["--no-optional-locks", ...args], {
      cwd: workspace,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: GIT_TIMEOUT_MS,
      windowsHide: true,
    })
      .split("\0")
      .filter(Boolean);
  const attempt = (run: () => string[]): string[] | null => {
    try {
      return run();
    } catch {
      return null;
    }
  };
  const untracked = attempt(() => git("ls-files", "--others", "--exclude-standard", "-z"));
  if (untracked === null) return null;
  const changed =
    attempt(() => git("diff", "--name-only", "--relative", "-z", "HEAD")) ??
    attempt(() => git("ls-files", "--cached", "-z")) ??
    [];
  return [...new Set([...changed, ...untracked])];
}

function tail(text: string): string {
  const trimmed = text.replace(/^STDERR: /gmu, "").trim();
  return trimmed.length > OUTPUT_TAIL ? `…${trimmed.slice(-OUTPUT_TAIL)}` : trimmed;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * `shelra decisions check`: runs the check of every active decision (or, with `changed`, of those covering a
 * changed file) the way the agent runs its own commands, with the same refusal of a check that would do
 * damage (a decision file is data, whoever committed it), and fails unless every check held. For CI, a git
 * hook, or another agent's stop hook: the ledger holds whoever changed the code.
 */
export async function checkDecisions(
  workspace: string,
  options: CheckDecisionsOptions = {},
): Promise<CheckDecisionsResult> {
  let hookInput: { stop_hook_active?: unknown } = {};
  if (options.hook && options.hookInput?.trim()) {
    try {
      hookInput = JSON.parse(options.hookInput) as { stop_hook_active?: unknown };
    } catch {
      // Not JSON: judge the workspace all the same.
    }
  }
  const active = activeDecisions(workspace);
  const unchecked = active.filter((decision) => !decision.check).length;
  let governing = active.filter((decision) => decision.check);
  let scopeNote = "";
  if (options.changed) {
    const files = changedFiles(workspace);
    if (files === null) scopeNote = " (outside a git repository, so every decision with a check)";
    else governing = governing.filter((decision) => files.some((file) => inScope(file, decision.scope)));
  }
  if (governing.length === 0) {
    const reason = options.changed
      ? "No active decision with a check covers the changed files."
      : `No active decision in ${LEDGER_DIR} has a check.`;
    return { exitCode: 0, output: reason, stream: "stdout" };
  }

  const bash = new BashTool(workspace);
  const lines: string[] = [];
  const judged: Judged[] = [];
  for (const decision of governing) {
    const command = decision.check as string;
    const danger = destructiveCommandReason(command, workspace);
    if (danger) {
      judged.push({ decision, outcome: "not run", detail: `the check ${danger}` });
      lines.push(`${decision.id} ${decision.title}: NOT RUN (\`${command}\` ${danger})`);
      continue;
    }
    const startedAt = Date.now();
    const result = await bash.execute(command, options.timeoutMs ?? CHECK_TIMEOUT_MS);
    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    if (result.success) {
      judged.push({ decision, outcome: "holds", detail: "" });
      lines.push(`${decision.id} ${decision.title}: holds (\`${command}\`, ${seconds} s)`);
      continue;
    }
    const detail = tail(result.error ?? result.output ?? "");
    const outcome: Outcome = ENVIRONMENT_FAILURE_RE.test(detail) ? "could not run" : "broken";
    judged.push({ decision, outcome, detail });
    lines.push(
      `${decision.id} ${decision.title}: ${outcome === "broken" ? "BROKEN" : "COULD NOT RUN"} (\`${command}\`)`,
      ...detail.split("\n").map((row) => `  ${row}`),
    );
  }
  const count = (outcome: Outcome) => judged.filter((item) => item.outcome === outcome).length;
  const parts = [
    `${count("holds")} ${count("holds") === 1 ? "holds" : "hold"}`,
    `${count("broken")} broken`,
    ...(count("could not run") > 0 ? [`${count("could not run")} could not run`] : []),
    ...(count("not run") > 0 ? [`${count("not run")} not run`] : []),
  ];
  lines.push(
    "",
    `Checked ${plural(governing.length, "decision")}${scopeNote}: ${parts.join(", ")}.` +
      (unchecked > 0 ? ` ${plural(unchecked, "active decision")} ${unchecked === 1 ? "has" : "have"} no check.` : ""),
  );
  if (judged.every((item) => item.outcome === "holds"))
    return { exitCode: 0, output: lines.join("\n"), stream: "stdout" };

  if (options.hook === "claude-code") {
    // Claude Code already continued once because of a stop hook: report, but do not hold it in a loop.
    if (hookInput.stop_hook_active === true) return { exitCode: 0, output: lines.join("\n"), stream: "stdout" };
    const item = ({ decision, detail }: Judged, verb: string) => [
      `- ${decision.id} ${decision.title} (${decision.file}): ${decision.rule}`,
      `  Its check \`${decision.check}\` ${verb}:`,
      ...detail.split("\n").map((row) => `    ${row}`),
    ];
    const guidance: string[] = [];
    const broken = judged.filter((entry) => entry.outcome === "broken");
    if (broken.length > 0) {
      guidance.push(
        "The change breaks a decision this project recorded with the user's approval:",
        ...broken.flatMap((entry) => item(entry, "fails")),
        "Restore what the decision requires. If the decision itself should change, stop and say so to the user instead of working around it.",
      );
    }
    const unrunnable = judged.filter((entry) => entry.outcome === "could not run");
    if (unrunnable.length > 0) {
      guidance.push(
        "The check of a decision this project recorded could not run, so nothing vouches for the code:",
        ...unrunnable.flatMap((entry) => item(entry, "could not run")),
        "Make the check runnable (its script, its command, the tool it needs), or tell the user what is missing.",
      );
    }
    const refused = judged.filter((entry) => entry.outcome === "not run");
    if (refused.length > 0) {
      guidance.push(
        "The check of a decision this project recorded would do damage and was not run:",
        ...refused.flatMap((entry) => item(entry, "was refused because")),
        "Tell the user: the decision needs a check that only reads and tests.",
      );
    }
    return { exitCode: 2, output: guidance.join("\n"), stream: "stderr" };
  }
  return { exitCode: 1, output: lines.join("\n"), stream: "stderr" };
}

export interface DecisionsCliOptions {
  changed?: boolean;
  hook?: string;
  /** Reads the hook's input when a hook is answered; absent when nothing is piped. */
  readHookInput?: () => Promise<string | undefined>;
}

/** The `shelra decisions` command: every action, with its options checked, and where its output goes. */
export async function runDecisionsCli(
  workspace: string,
  action = "list",
  id?: string,
  options: DecisionsCliOptions = {},
): Promise<CheckDecisionsResult> {
  const verb = action.toLowerCase();
  if (verb !== "check" && (options.changed || options.hook !== undefined)) {
    return { exitCode: 1, output: "--changed and --hook go with `shelra decisions check`.", stream: "stderr" };
  }
  if (verb === "check") {
    if (options.hook !== undefined && options.hook !== "claude-code") {
      return { exitCode: 1, output: `Unknown hook "${options.hook}". Use --hook claude-code.`, stream: "stderr" };
    }
    const hook = options.hook === "claude-code" ? "claude-code" : undefined;
    const hookInput = hook ? await options.readHookInput?.() : undefined;
    return checkDecisions(workspace, { changed: options.changed === true, hook, hookInput });
  }
  const result = runDecisionsCommand(workspace, verb, id);
  return { ...result, stream: result.exitCode === 0 ? "stdout" : "stderr" };
}
