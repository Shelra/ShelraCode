import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withMemoryLock } from "./lock";

let scratch: string | undefined;
afterEach(() => {
  vi.restoreAllMocks();
  if (scratch) rmSync(scratch, { recursive: true, force: true });
  scratch = undefined;
});
describe("memory mutation lock", () => {
  it("releases on failure and permits nested operations", () => {
    scratch = mkdtempSync(join(tmpdir(), "shelra-lock-"));
    const dir = scratch;
    expect(() =>
      withMemoryLock(dir, () => {
        throw new Error("write failed");
      }),
    ).toThrow("write failed");
    expect(existsSync(join(dir, ".write-lock"))).toBe(false);
    expect(withMemoryLock(dir, () => withMemoryLock(dir, () => 42))).toBe(42);
  });
  it("recovers a lock whose owning process has exited", () => {
    scratch = mkdtempSync(join(tmpdir(), "shelra-lock-"));
    const owner = spawnSync(process.versions.bun ? process.execPath : "bun", ["-e", "console.log(process.pid)"], {
      encoding: "utf8",
      timeout: 10_000,
      windowsHide: true,
    });
    expect(owner.status).toBe(0);
    writeFileSync(
      join(scratch, ".write-lock"),
      JSON.stringify({ pid: Number(owner.stdout.trim()), token: "dead-owner" }),
      "utf8",
    );
    expect(withMemoryLock(scratch, () => "saved")).toBe("saved");
    expect(existsSync(join(scratch, ".write-lock"))).toBe(false);
  });
  it("refuses a live owner's lock within its bound", () => {
    scratch = mkdtempSync(join(tmpdir(), "shelra-lock-"));
    writeFileSync(join(scratch, ".write-lock"), JSON.stringify({ pid: process.pid, token: "another-owner" }), "utf8");
    const start = Date.now();
    expect(() => withMemoryLock(scratch as string, () => "must not run")).toThrow("this write was not saved");
    expect(Date.now() - start).toBeLessThan(2_000);
  });
  it("gives up within a short bound when the caller can skip the write", () => {
    scratch = mkdtempSync(join(tmpdir(), "shelra-lock-"));
    writeFileSync(join(scratch, ".write-lock"), JSON.stringify({ pid: process.pid, token: "another-owner" }), "utf8");
    const start = performance.now();
    expect(() => withMemoryLock(scratch as string, () => "must not run", 50)).toThrow("this write was not saved");
    expect(performance.now() - start).toBeLessThan(400);
  });
  it("keeps its wait bound when the wall clock stops advancing", () => {
    scratch = mkdtempSync(join(tmpdir(), "shelra-lock-"));
    writeFileSync(join(scratch, ".write-lock"), JSON.stringify({ pid: process.pid, token: "live-owner" }), "utf8");
    const worker = join(scratch, "clock-worker.ts");
    const modulePath = join(process.cwd(), "src", "memory", "lock.ts");
    writeFileSync(
      worker,
      `import {withMemoryLock} from ${JSON.stringify(modulePath)};
Date.now = () => 1000;
try { withMemoryLock(${JSON.stringify(scratch)}, () => "must not run"); process.exit(2); }
catch (error) { console.log(String(error)); }
`,
      "utf8",
    );
    // The parent process, unlike the blocked worker, can enforce the laboratory bound.
    const result = spawnSync(process.versions.bun ? process.execPath : "bun", [worker], {
      encoding: "utf8",
      timeout: 2_500,
      killSignal: "SIGKILL",
      windowsHide: true,
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("this write was not saved");
  });
  it("does not remove a new owner's lock when the previous process exits during its liveness check", () => {
    scratch = mkdtempSync(join(tmpdir(), "shelra-lock-"));
    const lock = join(scratch, ".write-lock");
    const previousPid = 987654321;
    const newOwner = JSON.stringify({ pid: process.pid, token: "new-owner" });
    writeFileSync(lock, JSON.stringify({ pid: previousPid, token: "previous-owner" }), "utf8");
    const kill = process.kill.bind(process);
    vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
      if (pid === previousPid) {
        // The old writer releases, a new writer acquires, then the old process exits before kill(pid, 0).
        writeFileSync(lock, newOwner, "utf8");
        throw Object.assign(new Error("previous owner exited"), { code: "ESRCH" });
      }
      return kill(pid, signal);
    });
    expect(() => withMemoryLock(scratch as string, () => "must not run")).toThrow("this write was not saved");
    expect(readFileSync(lock, "utf8")).toBe(newOwner);
  });
});
