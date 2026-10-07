import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { describeRun, finishRun, flushRuns, listRuns, newRunId, startRun } from "./runs";

let scratch = "";
const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, runs: process.env.SHELRA_AGENT_RUNS };

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "shelra-runs-"));
  mkdirSync(join(scratch, "home"), { recursive: true });
  process.env.HOME = join(scratch, "home");
  process.env.USERPROFILE = join(scratch, "home");
  process.env.SHELRA_AGENT_RUNS = "on";
});
afterEach(async () => {
  await flushRuns();
  process.env.HOME = saved.HOME;
  process.env.USERPROFILE = saved.USERPROFILE;
  if (saved.runs === undefined) delete process.env.SHELRA_AGENT_RUNS;
  else process.env.SHELRA_AGENT_RUNS = saved.runs;
  rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

const base = (id: string) => ({
  id,
  parentSession: "session-1",
  agent: "writer",
  definition: null,
  description: "Write the report",
  prompt: "Write it.",
  skills: [],
  tools: [],
  readOnly: false,
  model: "shelra/free",
  limits: { maxSteps: 120, timeoutMinutes: null },
});

describe("agent run records", () => {
  it("records a run from start to finish, with what it changed", async () => {
    const root = join(scratch, "project");
    const id = newRunId("writer");
    const run = startRun(root, base(id));
    await flushRuns();
    expect((await listRuns(root))[0]).toMatchObject({ id, status: "running" });
    finishRun(root, run, {
      status: "completed",
      filesChanged: ["a.ts", "a.ts", "b.ts"],
      evidence: ["bun test passed"],
      result: "done",
    });
    await flushRuns();
    const [record] = await listRuns(root);
    expect(record).toMatchObject({
      status: "completed",
      filesChanged: ["a.ts", "b.ts"],
      evidence: ["bun test passed"],
      resultExcerpt: "done",
    });
    expect(record?.durationMs).toBeGreaterThanOrEqual(0);
    expect(describeRun(record as never)).toContain("shelra/free");
  });

  it("masks secrets in the prompt, the result, the error and the evidence before writing the record", async () => {
    const root = join(scratch, "project");
    const key = `sk-or-v1-${"0123456789abcdef".repeat(4)}`;
    const run = startRun(root, { ...base(newRunId("writer")), prompt: `Deploy with OPENROUTER_API_KEY=${key}` });
    finishRun(root, run, {
      status: "failed",
      result: `used ${key}`,
      error: `rejected ${key}`,
      evidence: [`curl -H 'Authorization: Bearer ${key}' x`],
    });
    await flushRuns();
    const [record] = await listRuns(root);
    expect(JSON.stringify(record)).not.toContain(key);
    expect(JSON.stringify(record)).not.toContain("0123456789abcdef0123456789abcdef");
  });

  it("reads a run whose process is gone as interrupted, and says its files were already changed", async () => {
    const root = join(scratch, "project");
    const id = newRunId("writer");
    const run = startRun(root, base(id));
    await flushRuns();
    // The process that started it died before it finished: rewrite the record as another, dead process left it.
    const { readdirSync } = await import("node:fs");
    const dir = join(scratch, "home", ".shelra", "agent-runs");
    const folder = join(dir, readdirSync(dir)[0] as string);
    writeFileSync(
      join(folder, `${id}.json`),
      JSON.stringify({ ...run, pid: 2147483000, filesChanged: ["half-done.ts"] }),
    );
    const [record] = await listRuns(root);
    expect(record?.status).toBe("interrupted");
    const line = describeRun(record as never);
    expect(line).toContain("interrupted");
    expect(line).toContain("half-done.ts");
    expect(line).toMatch(/do not redo/u);
  });

  it("keeps projects apart, newest first, and writes nothing when recording is off", async () => {
    const a = join(scratch, "a");
    const b = join(scratch, "b");
    finishRun(a, startRun(a, base(newRunId("x"))), { status: "completed" });
    await flushRuns();
    await new Promise((resolve) => setTimeout(resolve, 5));
    finishRun(a, startRun(a, base(newRunId("y"))), { status: "failed", error: "boom" });
    await flushRuns();
    expect((await listRuns(a)).map((run) => run.agent)).toEqual(["writer", "writer"]);
    expect((await listRuns(a))[0]?.status).toBe("failed");
    expect(await listRuns(b)).toEqual([]);
    process.env.SHELRA_AGENT_RUNS = "off";
    startRun(b, base(newRunId("z")));
    await flushRuns();
    expect(await listRuns(b)).toEqual([]);
  });
});
