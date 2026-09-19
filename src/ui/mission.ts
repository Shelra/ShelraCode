import type { Plan } from "../types/index";
import type { ChangeSummary, CheckSummary } from "./observability";

/**
 * The views that open on demand, at full width, over the log. Nothing announces them: the log
 * carries the plan, the loads and a one-line summary of each turn, and a view opens only when the
 * user asks for it with a command or its key. A view with nothing to show does not open.
 */
export type MissionView = "plan" | "changes" | "checks" | "context";

/** `log` is the conversation itself. */
export type MissionTab = "log" | MissionView;

export const MISSION_VIEWS: readonly { id: MissionView; label: string; key: string; command: string }[] = [
  { id: "plan", label: "Plan", key: "2", command: "plan" },
  { id: "changes", label: "Changes", key: "3", command: "diff" },
  { id: "checks", label: "Checks", key: "4", command: "checks" },
  { id: "context", label: "Context", key: "5", command: "context" },
];

export interface MissionAvailabilityInput {
  plan: Plan | null;
  changes: readonly ChangeSummary[];
  checks: readonly CheckSummary[];
  /** The plan published acceptance criteria that the checks view lists. */
  hasCriteria: boolean;
}

/** Which views have something to show. The context view always does: the window, the memory, the model. */
export function missionAvailability(input: MissionAvailabilityInput): Record<MissionView, boolean> {
  return {
    plan: input.plan !== null && input.plan.steps.length > 0,
    changes: input.changes.length > 0,
    checks: input.checks.length > 0 || input.hasCriteria,
    context: true,
  };
}

/** The one line shown instead of opening a view that has nothing to show. */
export function emptyViewNotice(view: MissionView): string {
  switch (view) {
    case "plan":
      return "Nothing yet: no plan. Shelra writes one for multi-step work.";
    case "changes":
      return "Nothing yet: no files changed in this session.";
    case "checks":
      return "Nothing yet: no tests, types or lint have run.";
    case "context":
      return "Nothing yet.";
  }
}

/** Alt+1 returns to the log; Alt+2 … Alt+5 open the views in order. */
export function missionTabForKey(name: string | undefined): MissionTab | null {
  if (name === "1") return "log";
  return MISSION_VIEWS.find((view) => view.key === name)?.id ?? null;
}

/** The view a slash command opens, when the command is one of theirs. */
export function missionViewForCommand(command: string): MissionView | null {
  return MISSION_VIEWS.find((view) => view.command === command)?.id ?? null;
}
