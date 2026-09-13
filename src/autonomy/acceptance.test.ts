import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type AcceptanceDeps, evaluateAcceptance } from "./acceptance";
import type { AcceptanceCriterion } from "./types";

const workspaces: string[] = [];

const deps: AcceptanceDeps = {
  runCommand: async () => ({
    command: "",
    cwd: "",
    state: "completed",
    exitCode: 0,
    stdout: "",
    stderr: "",
    durationMs: 0,
    timedOut: false,
    truncated: false,
  }),
  probeHttp: async () => ({ url: "", ok: true, status: 200, durationMs: 0 }),
  observePage: async () => ({
    ok: true,
    status: 200,
    url: "http://127.0.0.1:3000",
    title: "",
    bodyText: "",
    consoleErrors: [],
    pageErrors: [],
    failedRequests: [],
    externalRequests: [],
    assertions: [],
    screenshotPath: undefined,
  }),
};

function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), "shelra-acceptance-"));
  workspaces.push(root);
  return root;
}

afterEach(() => {
  for (const root of workspaces.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("acceptance workspace paths", () => {
  it("checks model-emitted absolute paths inside the workspace", async () => {
    const root = workspace();
    const file = join(root, "index.html");
    writeFileSync(file, "<!doctype html><title>Clock</title>", "utf8");

    const criteria: AcceptanceCriterion[] = [
      {
        id: "html_exists",
        description: "HTML exists",
        required: true,
        check: { kind: "file_exists", path: file },
      },
      {
        id: "html_contains",
        description: "HTML contains the title",
        required: true,
        check: { kind: "file_contains", path: file, pattern: "Clock" },
      },
    ];

    const report = await evaluateAcceptance(criteria, { workspace: root, attempt: 1 }, deps);

    expect(report.passed).toBe(true);
    expect(report.results.every((criterion) => criterion.passed)).toBe(true);
  });

  it("rejects absolute paths outside the workspace", async () => {
    const root = workspace();
    const outside = join(root, "..", "outside.html");

    const report = await evaluateAcceptance(
      [
        {
          id: "outside",
          description: "Outside path is not accepted",
          required: true,
          check: { kind: "file_exists", path: outside },
        },
      ],
      { workspace: root, attempt: 1 },
      deps,
    );

    expect(report.passed).toBe(false);
    expect(report.results[0]?.detail).toContain("outside the workspace");
  });

  it("does not treat a workspace directory as a required file and detects source URLs", async () => {
    const root = workspace();
    writeFileSync(join(root, "script.js"), "fetch('https://example.test/api')", "utf8");

    const report = await evaluateAcceptance(
      [
        {
          id: "root_is_file",
          description: "The workspace path is a file",
          required: true,
          check: { kind: "file_exists", path: root },
        },
        {
          id: "no_urls",
          description: "Source has no external URLs",
          required: true,
          check: { kind: "no_external_urls", paths: ["script.js"] },
        },
      ],
      { workspace: root, attempt: 1 },
      deps,
    );

    expect(report.passed).toBe(false);
    expect(report.results.find((criterion) => criterion.id === "root_is_file")?.passed).toBe(false);
    expect(report.results.find((criterion) => criterion.id === "no_urls")?.detail).toContain("script.js");
  });
});
