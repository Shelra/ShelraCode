import { testRender } from "@opentui/react/test-utils";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import type { Plan } from "../types/index";
import type { ActivityRowModel } from "./activity";
import type { TranscriptActivityItem, TranscriptSummaryItem } from "./observability";
import { dark } from "./theme";
import { LiveTurn, PlanBlock, ThoughtView, TranscriptActivityView, TurnSummaryLine } from "./transcript";

function row(overrides: Partial<ActivityRowModel> & Pick<ActivityRowModel, "verb" | "object">): ActivityRowModel {
  return {
    id: `${overrides.verb}:${overrides.object}`,
    group: "explore",
    tone: "neutral",
    lines: [],
    operation: "x",
    ...overrides,
  };
}

function item(group: TranscriptActivityItem["group"], rows: ActivityRowModel[]): TranscriptActivityItem {
  return { kind: "activity", id: "a", group, rows, at: 0 };
}

async function frameOf(node: ReactNode, height = 24): Promise<string> {
  const screen = await testRender(node, { width: 100, height });
  await screen.renderOnce();
  const frame = screen.captureCharFrame();
  screen.renderer.destroy();
  return frame;
}

describe("LiveTurn", () => {
  it("names the exact operation, its target and a running clock", async () => {
    const frame = await frameOf(
      <LiveTurn
        t={dark}
        phrase={{ verb: "Running tests", object: "bun test" }}
        elapsedMs={42_000}
        next="Rotate the token on refresh"
        reducedMotion
        width={90}
      />,
    );
    expect(frame).toContain("● Running tests bun test");
    expect(frame).toContain("42s");
    expect(frame).toContain("Next · Rotate the token on refresh");
  });

  it("shows the latest thought while thinking and a factual waiting note", async () => {
    const frame = await frameOf(
      <LiveTurn
        t={dark}
        phrase={{ verb: "Thinking", object: "" }}
        elapsedMs={5_000}
        thought="The boundary should be inclusive."
        note="No response yet. Free models can queue; esc stops the request."
        reducedMotion
        width={90}
      />,
    );
    expect(frame).toContain("Thinking");
    expect(frame).toContain("The boundary should be inclusive.");
    expect(frame).toContain("No response yet.");
  });

  it("turns red with the × marker when the live step failed", async () => {
    const frame = await frameOf(
      <LiveTurn
        t={dark}
        phrase={{ verb: "Running tests", object: "bun test" }}
        elapsedMs={1_000}
        failed
        reducedMotion
        width={90}
      />,
    );
    expect(frame).toContain("× Running tests");
  });
});

describe("TranscriptActivityView", () => {
  const explore = item("explore", [
    row({ verb: "Read", object: "src/a.ts" }),
    row({ verb: "Read", object: "src/b.ts" }),
    row({ verb: "Searched for", object: "hydrate" }),
  ]);

  it("folds reads and searches into one counted line by default", async () => {
    const frame = await frameOf(<TranscriptActivityView t={dark} item={explore} width={90} detailed={false} />);
    expect(frame).toContain("✓ Read 2 files · searched 1 pattern");
    expect(frame).not.toContain("src/a.ts");
  });

  it("lists every operation when details are on", async () => {
    const frame = await frameOf(<TranscriptActivityView t={dark} item={explore} width={90} detailed />);
    expect(frame).toContain("Read src/a.ts");
    expect(frame).toContain("Read src/b.ts");
    expect(frame).toContain("Searched for hydrate");
  });

  it("always shows the evidence of a failing check, with its numbers", async () => {
    const failing = item("verify", [
      row({
        group: "verify",
        tone: "danger",
        verb: "Tests failed",
        object: "bun test",
        meta: "3 pass · 2 fail · 1.3s",
        lines: ["isExpired > is true exactly at expiry", "refreshSession > rotates the token"],
      }),
    ]);
    const frame = await frameOf(<TranscriptActivityView t={dark} item={failing} width={90} detailed={false} />);
    expect(frame).toContain("× Tests failed bun test");
    expect(frame).toContain("3 pass · 2 fail · 1.3s");
    expect(frame).toContain("isExpired > is true exactly at expiry");
    expect(frame).toContain("refreshSession > rotates the token");
  });

  it("keeps each edit on its own row with the diffstat right-aligned", async () => {
    const edits = item("change", [
      row({ group: "change", tone: "success", verb: "Edited", object: "src/auth.ts", meta: "+1 -1" }),
      row({ group: "change", tone: "success", verb: "Created", object: "src/token.ts", meta: "+4" }),
    ]);
    const frame = await frameOf(<TranscriptActivityView t={dark} item={edits} width={90} detailed={false} />);
    expect(frame).toContain("✓ Edited src/auth.ts");
    expect(frame).toContain("+1 -1");
    expect(frame).toContain("✓ Created src/token.ts");
  });
});

describe("ThoughtView", () => {
  const thought = {
    kind: "thought" as const,
    id: "t",
    durationMs: 8_000,
    text: "Compare the boundary with the test.",
    steps: 2,
  };

  it("is one collapsed line by default and reveals the reasoning on request", async () => {
    const collapsed = await frameOf(<ThoughtView t={dark} item={thought} width={90} detailed={false} />);
    expect(collapsed).toContain("Thought for 8s · 2 steps");
    expect(collapsed).not.toContain("Compare the boundary");
    const expanded = await frameOf(<ThoughtView t={dark} item={thought} width={90} detailed />);
    expect(expanded).toContain("Compare the boundary with the test.");
  });
});

const planOf = (statuses: Array<"pending" | "working" | "complete" | "failed">): Plan => ({
  title: "Fix",
  summary: "Fix it",
  steps: statuses.map((status, index) => ({ title: `Step ${index + 1}`, description: `Do ${index + 1}`, status })),
});

describe("PlanBlock", () => {
  it("shows the steps around the active one while the plan is unfinished", async () => {
    const frame = await frameOf(
      <PlanBlock t={dark} plan={planOf(["complete", "complete", "working", "pending"])} width={90} detailed={false} />,
    );
    expect(frame).toContain("[ PLAN 2/4 ]");
    expect(frame).toContain("✓ Step 1");
    expect(frame).toContain("● Step 3");
    expect(frame).toContain("· Step 4");
    expect(frame).not.toContain("Do 3");
  });

  it("folds to one line when every step is done", async () => {
    const frame = await frameOf(
      <PlanBlock
        t={dark}
        plan={planOf(["complete", "complete", "complete", "complete"])}
        width={90}
        detailed={false}
      />,
    );
    expect(frame).toContain("✓ Plan 4/4");
    expect(frame).not.toContain("[ PLAN");
    expect(frame).not.toContain("Step 1");
  });

  it("keeps a long plan to five rows around the active step", async () => {
    const statuses = Array.from({ length: 12 }, (_, index) =>
      index < 5 ? ("complete" as const) : index === 5 ? ("working" as const) : ("pending" as const),
    );
    const frame = await frameOf(<PlanBlock t={dark} plan={planOf(statuses)} width={90} detailed={false} />);
    expect(frame.match(/Step \d/g)).toHaveLength(5);
    expect(frame).toContain("● Step 6");
    expect(frame).toContain("earlier");
    expect(frame).toContain("more");
  });

  it("shows every step and the active one's description in detail mode, even when finished", async () => {
    const frame = await frameOf(
      <PlanBlock t={dark} plan={planOf(["complete", "working", "pending"])} width={90} detailed />,
    );
    expect(frame.match(/Step \d/g)).toHaveLength(3);
    expect(frame).toContain("Do 2");
  });

  it("marks a failed step so it cannot pass for progress", async () => {
    const frame = await frameOf(
      <PlanBlock t={dark} plan={planOf(["complete", "failed", "pending"])} width={90} detailed={false} />,
    );
    expect(frame).toContain("× Step 2");
  });
});

describe("TurnSummaryLine", () => {
  const item: TranscriptSummaryItem = {
    kind: "summary",
    id: "s",
    changes: [
      { path: "src/auth.ts", additions: 4, removals: 1, kind: "modified" },
      { path: "src/token.ts", additions: 2, removals: 0, kind: "added" },
    ],
    checks: [{ command: "bun test", label: "tests", tone: "success", meta: "5 pass" }],
    durationMs: 42_000,
  };

  it("says what the turn did in one line", async () => {
    const frame = await frameOf(<TurnSummaryLine t={dark} item={item} />);
    expect(frame).toContain("─ 2 files +6 -1 · tests ✓ · 42s");
    expect(frame.split(String.fromCharCode(10)).filter((line) => line.includes("─ 2 files"))).toHaveLength(1);
  });

  it("shows a failing check as a failure", async () => {
    const frame = await frameOf(
      <TurnSummaryLine
        t={dark}
        item={{ ...item, checks: [{ command: "bun test", label: "tests", tone: "danger", meta: "3 pass · 2 fail" }] }}
      />,
    );
    expect(frame).toContain("tests × 2 failed");
  });
});

describe("loads and the live plan in the history", () => {
  const load = item("load", [
    row({ group: "load", verb: "Recalled", object: "2 memories" }),
    row({ group: "load", verb: "Loaded", object: "skill terminal-ui" }),
  ]);

  it("folds what was loaded into one quiet line", async () => {
    const frame = await frameOf(<TranscriptActivityView t={dark} item={load} width={90} detailed={false} />);
    expect(frame).toContain("· Loaded skill terminal-ui · Recalled 2 memories");
  });

  it("draws the newest plan as a checklist and older ones as a line", async () => {
    const planRow = item("plan", [row({ group: "plan", verb: "Planned", object: "Fix", meta: "3 steps" })]);
    const live = await frameOf(
      <TranscriptActivityView
        t={dark}
        item={planRow}
        width={90}
        detailed={false}
        livePlan={planOf(["complete", "working", "pending"])}
      />,
    );
    expect(live).toContain("[ PLAN 1/3 ]");
    const old = await frameOf(<TranscriptActivityView t={dark} item={planRow} width={90} detailed={false} />);
    expect(old).toContain("Planned");
    expect(old).not.toContain("[ PLAN");
  });
});
