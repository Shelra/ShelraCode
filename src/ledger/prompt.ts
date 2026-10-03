import { searchTerms } from "../memory/terms";
import { LEDGER_DIR } from "./store";
import type { Decision } from "./types";

const MAX_LISTED = 30;
const MAX_RULE_CHARS = 240;
const MAX_WHY_CHARS = 220;
/** How many of the decisions most relevant to the request show why they were taken. */
const MAX_WITH_WHY = 3;
/** How many replaced decisions are named, newest first, so the model does not follow one. */
const MAX_REPLACED = 5;

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/gu, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function idNumber(decision: Decision): number {
  return Number(/\d+/u.exec(decision.id)?.[0] ?? 0);
}

export interface DecisionsPromptOptions {
  /** The turn's request: the decisions it is about come first and say why they were taken. */
  request?: string;
}

/**
 * The system prompt section of the decisions. The model sees the commitments in force before it works, the ones the
 * request is about first, with their reasons, and newest before oldest past them (doc 20, TEST P4: the 30 lowest ids
 * were listed and the newest dropped); then the decisions that were replaced, so an obsolete one is not followed. The
 * host, not this text, enforces the ones with a check (phase 3), so a model that ignores it still cannot report a
 * violating change as done.
 */
export function formatDecisionsForPrompt(decisions: readonly Decision[], options: DecisionsPromptOptions = {}): string {
  const active = decisions.filter((decision) => decision.status === "active");
  const replaced = decisions
    .filter((decision) => decision.status === "superseded" && decision.supersededBy)
    .sort((a, b) => idNumber(b) - idNumber(a))
    .slice(0, MAX_REPLACED);
  if (active.length === 0 && replaced.length === 0) return "";
  const wanted = new Set(searchTerms(options.request ?? ""));
  const relevance = (decision: Decision) => {
    if (wanted.size === 0) return 0;
    const own = new Set(searchTerms(`${decision.title} ${decision.rule} ${decision.scope.join(" ")}`));
    return [...wanted].filter((term) => own.has(term)).length;
  };
  const ranked = active
    .map((decision) => ({ decision, score: relevance(decision) }))
    .sort((a, b) => b.score - a.score || idNumber(b.decision) - idNumber(a.decision));
  const listed = ranked.slice(0, MAX_LISTED);
  const withWhy = new Set(
    listed
      .filter((item) => item.score > 0 && item.decision.why)
      .slice(0, MAX_WITH_WHY)
      .map((item) => item.decision.id),
  );
  const lines = [
    `DECISIONS: commitments this project recorded with the user's approval (${LEDGER_DIR}). Follow them. When a task would break one, do not work around it: say so, and propose a superseding decision with propose_decision.`,
    ...listed.map(({ decision }) => {
      const scope = decision.scope.length > 0 ? ` Covers ${decision.scope.join(", ")}.` : "";
      const check = decision.check ? ` Checked by \`${decision.check}\`.` : "";
      const why = withWhy.has(decision.id) && decision.why ? ` Why: ${clip(decision.why, MAX_WHY_CHARS)}` : "";
      return `- ${decision.id} ${decision.title}: ${clip(decision.rule, MAX_RULE_CHARS)}${scope}${check}${why}`;
    }),
  ];
  if (active.length > listed.length) {
    lines.push(`- … and ${active.length - listed.length} more in ${LEDGER_DIR}.`);
  }
  if (replaced.length > 0) {
    lines.push(
      `No longer in force (replaced; do not follow them, their files in ${LEDGER_DIR} say why they changed): ${replaced
        .map((decision) => `${decision.id} "${clip(decision.title, 80)}" → replaced by ${decision.supersededBy}`)
        .join("; ")}.`,
    );
  }
  return lines.join("\n");
}
