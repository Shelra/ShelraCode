import { expect, test } from "bun:test";
import { executeWorkflow } from "./workflow";

test("runs a simple dependency chain", async () => {
  const outcome = await executeWorkflow([{ id: "a" }, { id: "b", dependsOn: ["a"] }], {
    a: async () => 1,
    b: async () => 2,
  });
  expect(outcome.results.b?.status).toBe("succeeded");
});
