import { testRender } from "@opentui/react/test-utils";
import { describe, expect, it } from "vitest";
import type { PlanQuestion } from "../types/index";
import { initialPlanQuestionsState, PlanQuestionsPanel } from "./plan";
import { dark } from "./theme";

const QUESTIONS: PlanQuestion[] = [
  {
    id: "scope",
    question: "Which package?",
    type: "select",
    options: [
      { id: "api", label: "api" },
      { id: "web", label: "web" },
    ],
  },
  { id: "notes", question: "Anything else?", type: "text" },
];

describe("PlanQuestionsPanel", () => {
  it("names each key and what it does", async () => {
    const screen = await testRender(
      <PlanQuestionsPanel t={dark} questions={QUESTIONS} state={initialPlanQuestionsState()} />,
      { width: 80, height: 16 },
    );
    await screen.renderOnce();
    const frame = screen.captureCharFrame();
    screen.renderer.destroy();
    expect(frame).toContain("tab next question");
    expect(frame).toContain("up/down select");
    expect(frame).not.toContain("tab tab");
  });
});
