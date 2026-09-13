import { describe, expect, it } from "vitest";
import type { RuntimeEvent } from "./kernel";
import {
  describeCheck,
  findObjective,
  formatObjectiveEvent,
  formatPlan,
  formatSpecification,
  objectiveEventPayload,
} from "./presentation";
import type { ExecutableSpecification, Task } from "./types";

const specification: ExecutableSpecification = {
  goal: "Create a visible proof file",
  requirements: ["Create proof.txt with the required content."],
  acceptance: [
    {
      id: "AC1",
      description: "proof.txt exists",
      required: true,
      check: { kind: "file_exists", path: "proof.txt" },
    },
  ],
};

const plan: Task[] = [
  {
    id: "T1",
    description: "Write the proof file",
    satisfies: ["AC1"],
    status: "pending",
    attempts: 0,
  },
];

describe("autonomous objective presentation", () => {
  it("renders the goal, requirements, executable checks, and task-to-criterion mapping", () => {
    const renderedSpecification = formatSpecification(specification);
    const renderedPlan = formatPlan(plan);

    expect(renderedSpecification).toContain("[SPECIFICATION]");
    expect(renderedSpecification).toContain("Goal: Create a visible proof file");
    expect(renderedSpecification).toContain("R1. Create proof.txt");
    expect(renderedSpecification).toContain("[MUST] AC1: proof.txt exists");
    expect(renderedSpecification).toContain("check: file exists: proof.txt");
    expect(renderedPlan).toContain("[PLAN] 1 ordered task(s)");
    expect(renderedPlan).toContain("[ ] T1: Write the proof file");
    expect(renderedPlan).toContain("satisfies: AC1");
  });

  it("keeps specification and plan events structured in JSON output", () => {
    const specificationEvent: RuntimeEvent = {
      type: "specification",
      message: "Specification ready",
      specification,
    };
    const planEvent: RuntimeEvent = { type: "plan", message: "Plan ready", plan };

    expect(objectiveEventPayload(specificationEvent)).toMatchObject({
      type: "specification",
      specification: { goal: specification.goal, requirements: specification.requirements },
    });
    expect(objectiveEventPayload(planEvent)).toMatchObject({
      type: "plan",
      plan: [{ id: "T1", satisfies: ["AC1"], status: "pending" }],
    });
    expect(formatObjectiveEvent(planEvent)).toContain("Write the proof file");
  });

  it("describes behavioral checks without exposing provider-specific schemas", () => {
    expect(
      describeCheck({
        kind: "dom",
        assertion: { description: "clock advances", selector: "#clock", waitForChangeMs: 1_500 },
      }),
    ).toBe("selector #clock changes within 1500ms");
  });

  it("resolves latest, exact ids, and only unambiguous prefixes", () => {
    const objectives = [{ id: "abcdef" }, { id: "abc123" }, { id: "other" }];

    expect(findObjective(objectives, "latest")?.id).toBe("abcdef");
    expect(findObjective(objectives, "other")?.id).toBe("other");
    expect(findObjective(objectives, "abc1")?.id).toBe("abc123");
    expect(findObjective(objectives, "abc")).toBeUndefined();
  });
});
