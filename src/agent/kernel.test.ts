import { describe, expect, it } from "vitest";
import { AgentKernel } from "./kernel";

describe("host agent kernel", () => {
  it("does not allow a model-shaped completion to pass without host proof", () => {
    const kernel = new AgentKernel("edit src/app.ts");
    kernel.setScope(["src/app.ts"]);
    kernel.recordMutation("src/app.ts");
    expect(kernel.evaluateCompletion({ verificationPassed: false, reviewPassed: false })).toBe(false);
    expect(kernel.snapshot().phase).toBe("blocked");
  });

  it("completes only after scoped mutation, verification and review", () => {
    const kernel = new AgentKernel("edit src/app.ts");
    kernel.setScope(["src/app.ts"]);
    kernel.recordMutation("src/app.ts");
    expect(
      kernel.evaluateCompletion({ verificationPassed: true, reviewPassed: true, requiredPaths: ["src/app.ts"] }),
    ).toBe(true);
    expect(kernel.snapshot().phase).toBe("complete");
  });

  it("restores a persisted host snapshot without sharing mutable arrays", () => {
    const restored = AgentKernel.fromSnapshot({
      taskId: "task-restore",
      objective: "resume work",
      phase: "review",
      scope: ["src/app.ts"],
      mutations: ["src/app.ts"],
      observations: ["edit complete"],
      verificationDetails: "host verification pending",
      attemptCount: 1,
      verificationPassed: false,
      reviewPassed: false,
    });

    const snapshot = restored.snapshot();
    snapshot.scope.push("README.md");

    expect(restored.snapshot()).toMatchObject({
      taskId: "task-restore",
      objective: "resume work",
      phase: "review",
      scope: ["src/app.ts"],
    });
  });
});
