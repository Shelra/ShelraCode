import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runDecisionsCommand } from "./cli";
import { approveDecision, listDecisions, proposeDecision } from "./store";

let workspace: string;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "shelra-ledger-cli-"));
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

const propose = (title: string) =>
  proposeDecision(workspace, {
    title,
    rule: `${title}, always.`,
    scope: ["src/**"],
    check: "bun test",
    source: "agent",
  });

describe("shelra decisions", () => {
  it("lists what waits for approval apart from what is active", () => {
    expect(runDecisionsCommand(workspace).output).toBe("No decisions recorded in docs/decisions yet.");
    propose("Money is integer cents");
    propose("Dates are UTC");
    approveDecision(workspace, "D-0001");

    const { exitCode, output } = runDecisionsCommand(workspace, "list");
    expect(exitCode).toBe(0);
    expect(output).toBe(
      [
        "Waiting for your approval:",
        "  D-0002  Dates are UTC  covers: src/**  check: bun test",
        "",
        "Active:",
        "  D-0001  Money is integer cents  covers: src/**  check: bun test",
      ].join("\n"),
    );
  });

  it("approves, rejects and shows by id, and says why when it cannot", () => {
    propose("Money is integer cents");
    propose("Dates are UTC");

    expect(runDecisionsCommand(workspace, "approve", "d-0001")).toMatchObject({
      exitCode: 0,
      output: expect.stringContaining("Approved D-0001"),
    });
    expect(runDecisionsCommand(workspace, "reject", "D-0002")).toMatchObject({ exitCode: 0 });
    expect(listDecisions(workspace).map((decision) => `${decision.id} ${decision.status}`)).toEqual(["D-0001 active"]);
    expect(runDecisionsCommand(workspace, "show", "D-0001").output).toContain("Money is integer cents, always.");

    expect(runDecisionsCommand(workspace, "approve", "D-0001")).toMatchObject({ exitCode: 1 });
    expect(runDecisionsCommand(workspace, "show", "D-0009")).toMatchObject({ exitCode: 1 });
    expect(runDecisionsCommand(workspace, "approve")).toMatchObject({ exitCode: 1 });
    expect(runDecisionsCommand(workspace, "delete", "D-0001")).toMatchObject({
      exitCode: 1,
      output: expect.stringContaining("list, show, approve, reject"),
    });
  });
});
