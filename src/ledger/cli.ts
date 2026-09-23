import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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
  /** Only the decisions whose scope covers a file changed in the working tree, as the task contract does. */
  changed?: boolean;
  /**
   * Answer as a Claude Code Stop hook: when a decision is broken, exit 2 with the guidance on stderr, which
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

const CHECK_TIMEOUT_MS = 10 * 60_000;
const OUTPUT_TAIL = 1_500;

/** Workspace-relative files changed against HEAD, new files included; null outside a git repository. */
function changedFiles(workspace: string): string[] | null {
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: workspace, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      .split("\0")
      .filter(Boolean);
  try {
    return [
      ...git("diff", "--name-only", "--relative", "-z", "HEAD"),
      ...git("ls-files", "--others", "--exclude-standard", "-z"),
    ];
  } catch {
    return null;
  }
}

function tail(text: string): string {
  const trimmed = text.replace(/^STDERR: /gmu, "").trim();
  return trimmed.length > OUTPUT_TAIL ? `…${trimmed.slice(-OUTPUT_TAIL)}` : trimmed;
}

/**
 * `shelra decisions check`: runs the check of every active decision (or, with `changed`, of those covering a
 * changed file) the way the agent runs its own commands, and fails when one is broken. For CI, a git hook,
 * or another agent's stop hook: the ledger holds whoever changed the code.
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
    if (files === null) scopeNote = " (not a git repository, so every decision with a check)";
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
  const broken: Array<{ decision: Decision; detail: string }> = [];
  for (const decision of governing) {
    const command = decision.check as string;
    const startedAt = Date.now();
    const result = await bash.execute(command, options.timeoutMs ?? CHECK_TIMEOUT_MS);
    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    if (result.success) {
      lines.push(`${decision.id} ${decision.title}: holds (\`${command}\`, ${seconds} s)`);
    } else {
      const detail = tail(result.error ?? result.output ?? "");
      broken.push({ decision, detail });
      lines.push(
        `${decision.id} ${decision.title}: BROKEN (\`${command}\`)`,
        ...detail.split("\n").map((row) => `  ${row}`),
      );
    }
  }
  const held = governing.length - broken.length;
  lines.push(
    "",
    `Checked ${governing.length} decision${governing.length === 1 ? "" : "s"}${scopeNote}: ${held} ${held === 1 ? "holds" : "hold"}, ${broken.length} broken.` +
      (unchecked > 0 ? ` ${unchecked} active decision${unchecked === 1 ? " has" : "s have"} no check.` : ""),
  );
  if (broken.length === 0) return { exitCode: 0, output: lines.join("\n"), stream: "stdout" };

  if (options.hook === "claude-code") {
    // Claude Code already continued once because of a stop hook: report, but do not hold it in a loop.
    if (hookInput.stop_hook_active === true) return { exitCode: 0, output: lines.join("\n"), stream: "stdout" };
    const guidance = [
      "The change breaks a decision this project recorded with the user's approval:",
      ...broken.flatMap(({ decision, detail }) => [
        `- ${decision.id} ${decision.title} (${decision.file}): ${decision.rule}`,
        `  Its check \`${decision.check}\` fails:`,
        ...detail.split("\n").map((row) => `    ${row}`),
      ]),
      "Restore what the decision requires. If the decision itself should change, stop and say so to the user instead of working around it.",
    ];
    return { exitCode: 2, output: guidance.join("\n"), stream: "stderr" };
  }
  return { exitCode: 1, output: lines.join("\n"), stream: "stderr" };
}
