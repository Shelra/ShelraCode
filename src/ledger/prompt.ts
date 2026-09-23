import { LEDGER_DIR } from "./store";
import type { Decision } from "./types";

const MAX_LISTED = 30;
const MAX_RULE_CHARS = 240;

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/gu, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/**
 * The system prompt section of the active decisions. The model sees every commitment before it works; the
 * host, not this text, enforces the ones with a check (phase 3), so a model that ignores it still cannot
 * report a violating change as done.
 */
export function formatDecisionsForPrompt(decisions: readonly Decision[]): string {
  if (decisions.length === 0) return "";
  const listed = decisions.slice(0, MAX_LISTED);
  const lines = [
    `DECISIONS: commitments this project recorded with the user's approval (${LEDGER_DIR}). Follow them. When a task would break one, do not work around it: say so, and propose a superseding decision with propose_decision.`,
    ...listed.map((decision) => {
      const scope = decision.scope.length > 0 ? ` Covers ${decision.scope.join(", ")}.` : "";
      const check = decision.check ? ` Checked by \`${decision.check}\`.` : "";
      return `- ${decision.id} ${decision.title}: ${clip(decision.rule, MAX_RULE_CHARS)}${scope}${check}`;
    }),
  ];
  if (decisions.length > listed.length) {
    lines.push(`- … and ${decisions.length - listed.length} more in ${LEDGER_DIR}.`);
  }
  return lines.join("\n");
}
