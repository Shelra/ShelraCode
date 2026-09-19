import { describe, expect, it } from "vitest";
import type { Plan } from "../types/index";
import {
  emptyViewNotice,
  MISSION_VIEWS,
  missionAvailability,
  missionTabForKey,
  missionViewForCommand,
} from "./mission";

const plan: Plan = {
  title: "Fix",
  summary: "Fix it",
  steps: [{ title: "Step 1", description: "", status: "pending" }],
};

const none = { plan: null, changes: [], checks: [], hasCriteria: false };

describe("missionAvailability", () => {
  it("offers only the context view when nothing has happened", () => {
    expect(missionAvailability(none)).toEqual({ plan: false, changes: false, checks: false, context: true });
  });

  it("opens the plan view only for a plan that has steps", () => {
    expect(missionAvailability({ ...none, plan }).plan).toBe(true);
    expect(missionAvailability({ ...none, plan: { ...plan, steps: [] } }).plan).toBe(false);
  });

  it("opens the changes view once a file changed", () => {
    const changes = [{ path: "a.ts", additions: 1, removals: 0, kind: "modified" as const }];
    expect(missionAvailability({ ...none, changes }).changes).toBe(true);
  });

  it("opens the checks view for a check that ran or for published criteria", () => {
    const checks = [{ command: "bun test", label: "tests", tone: "success" as const, meta: "" }];
    expect(missionAvailability({ ...none, checks }).checks).toBe(true);
    expect(missionAvailability({ ...none, hasCriteria: true }).checks).toBe(true);
  });
});

describe("emptyViewNotice", () => {
  it("says so in one line for every view", () => {
    for (const view of MISSION_VIEWS) {
      const notice = emptyViewNotice(view.id);
      expect(notice.startsWith("Nothing yet")).toBe(true);
      expect(notice).not.toContain("\n");
    }
  });
});

describe("keys and commands", () => {
  it("maps alt+1 to the log and alt+2 to alt+5 to the views in order", () => {
    expect(["1", "2", "3", "4", "5"].map(missionTabForKey)).toEqual(["log", "plan", "changes", "checks", "context"]);
    expect(missionTabForKey("6")).toBeNull();
    expect(missionTabForKey(undefined)).toBeNull();
  });

  it("maps /plan, /diff, /checks and /context to their views", () => {
    expect(["plan", "diff", "checks", "context"].map(missionViewForCommand)).toEqual([
      "plan",
      "changes",
      "checks",
      "context",
    ]);
    expect(missionViewForCommand("memory")).toBeNull();
  });
});
