import { readFileSync } from "node:fs";
import { join } from "node:path";
import { approveDecision, findDecision, LEDGER_DIR, listDecisions, rejectDecision } from "./store";
import type { Decision } from "./types";

/**
 * `shelra decisions`: the ledger from the command line, for proposals that were made where nobody could be
 * asked (a headless run, a benchmark) and for reading what the project decided.
 */

export const DECISIONS_ACTIONS = ["list", "show", "approve", "reject"] as const;

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
