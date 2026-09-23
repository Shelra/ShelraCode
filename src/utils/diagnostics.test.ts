import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { recordSwallowedError, swallowedErrorLogPath } from "./diagnostics";

let dir: string;
const previous = process.env.SHELRA_DIAGNOSTICS_LOG;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "shelra-diagnostics-"));
});

afterEach(() => {
  if (previous === undefined) delete process.env.SHELRA_DIAGNOSTICS_LOG;
  else process.env.SHELRA_DIAGNOSTICS_LOG = previous;
  rmSync(dir, { recursive: true, force: true });
});

function entries(path: string): Array<Record<string, unknown>> {
  return readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("swallowed-error log", () => {
  it("appends what a resilience catch swallowed, with where it came from", () => {
    const log = join(dir, "logs", "swallowed.jsonl");
    process.env.SHELRA_DIAGNOSTICS_LOG = log;

    recordSwallowedError("test.append", new Error("database is locked"));
    recordSwallowedError("test.append", "a plain string");

    const [first, second] = entries(log);
    expect(first).toMatchObject({ area: "test.append", error: "Error: database is locked" });
    expect(first?.at).toEqual(expect.arrayContaining([expect.stringContaining("diagnostics.test.ts")]));
    expect(second).toMatchObject({ area: "test.append", error: "a plain string" });
    expect(second).not.toHaveProperty("at");
  });

  it("records at most twenty entries per area in one process", () => {
    const log = join(dir, "swallowed.jsonl");
    process.env.SHELRA_DIAGNOSTICS_LOG = log;

    for (let i = 0; i < 30; i += 1) recordSwallowedError("test.cap", new Error(`failure ${i}`));
    recordSwallowedError("test.cap-other", new Error("another area"));

    const recorded = entries(log);
    expect(recorded.filter((entry) => entry.area === "test.cap")).toHaveLength(20);
    expect(recorded.find((entry) => entry.area === "test.cap" && entry.note)).toMatchObject({
      error: "Error: failure 19",
    });
    expect(recorded.at(-1)).toMatchObject({ area: "test.cap-other" });
  });

  it("rotates a log over 1 MB and keeps one previous file", () => {
    const log = join(dir, "swallowed.jsonl");
    process.env.SHELRA_DIAGNOSTICS_LOG = log;
    writeFileSync(log, `${"x".repeat(1_000_001)}\n`);

    recordSwallowedError("test.rotate", new Error("after rotation"));

    expect(readFileSync(`${log}.1`, "utf8").length).toBeGreaterThan(1_000_000);
    expect(entries(log)).toEqual([expect.objectContaining({ area: "test.rotate" })]);
  });

  it("writes nothing when switched off and never throws when it cannot write", () => {
    process.env.SHELRA_DIAGNOSTICS_LOG = "off";
    expect(swallowedErrorLogPath()).toBeNull();
    recordSwallowedError("test.off", new Error("ignored"));

    // A folder where the log file should be: the write fails, and the caller never sees it.
    const blocked = join(dir, "blocked");
    mkdirSync(blocked);
    process.env.SHELRA_DIAGNOSTICS_LOG = blocked;
    expect(() => recordSwallowedError("test.blocked", new Error("unwritable"))).not.toThrow();
  });

  it("defaults to the per-user logs folder", () => {
    delete process.env.SHELRA_DIAGNOSTICS_LOG;
    expect(swallowedErrorLogPath()?.replaceAll("\\", "/")).toMatch(/\/\.shelra\/logs\/swallowed-errors\.jsonl$/u);
  });
});
