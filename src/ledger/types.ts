/**
 * The decision ledger: the commitments a project made, recorded with the user's approval, versioned in git
 * with the code they govern, and enforced when a change touches what they cover (the 2026-09-18 objective:
 * "the agent that does not lose the project's thread").
 *
 * Only explicit commitments enter it: an ADR, a rule from AGENTS.md or a contributing guide, a rule the user
 * states, or a decision the agent recorded. The agent proposes; nothing becomes a commitment without the
 * user's yes. A decision with a `check` is enforced (the host runs the command on the final code whenever a
 * change touches its `scope`); one without is context the agent reads before it works.
 */

export type DecisionStatus = "proposed" | "active" | "superseded";

/** Where the commitment was stated. */
export type DecisionSource = "user" | "agent" | "adr" | "instructions";

export const DECISION_SOURCES: readonly DecisionSource[] = ["user", "agent", "adr", "instructions"];

export interface Decision {
  /** "D-0001": stable, never reused. */
  id: string;
  title: string;
  status: DecisionStatus;
  source: DecisionSource;
  /** The commitment, stated as a rule rather than a list of cases. */
  rule: string;
  /** Why it was decided. */
  why?: string;
  /** Where it is written down: an ADR path, a quote of the user, an AGENTS.md section. */
  evidence?: string;
  /** Workspace-relative globs of the files it governs; empty means the whole project. */
  scope: string[];
  /** A command that exits 0 while the commitment holds; without one the decision is context only. */
  check?: string;
  /** ISO date the agent or the user proposed it. */
  proposed: string;
  /** ISO date the user approved it. */
  approved?: string;
  /** The decision this one replaces. */
  supersedes?: string;
  /** The decision that replaced this one. */
  supersededBy?: string;
  /** Workspace-relative path of its file. */
  file: string;
}

export interface DecisionProposal {
  title: string;
  rule: string;
  why?: string;
  evidence?: string;
  scope?: string[];
  check?: string;
  source: DecisionSource;
  supersedes?: string;
}
