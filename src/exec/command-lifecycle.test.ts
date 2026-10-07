import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), kill: vi.fn(async () => {}), killSync: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));
vi.mock("./shell", () => ({
  buildShellInvocation: () => ({ file: "fake-shell", args: [] }),
  spawnOptions: () => ({}),
  createShellErrorFilter: () => ({ push: (text: string) => text, flush: () => "" }),
  killProcessTree: mocks.kill,
  killProcessTreeSync: mocks.killSync,
}));

import { runCommand } from "./command";

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("command cancellation when the process tree does not close", () => {
  it.skipIf(process.platform !== "win32")(
    "forgets a Windows PID after exit even when descendants keep the pipes open",
    async () => {
      vi.resetModules();
      let sweep: (() => void) | undefined;
      const originalOnce = process.once.bind(process);
      vi.spyOn(process, "once").mockImplementation((event, listener) => {
        if (event === "exit") {
          sweep = listener as () => void;
          return process;
        }
        return originalOnce(event, listener);
      });
      const { runCommand: isolatedRun } = await import("./command");
      const child = Object.assign(new EventEmitter(), {
        pid: 4322,
        stdout: new PassThrough(),
        stderr: new PassThrough(),
      });
      mocks.spawn.mockReturnValue(child);
      const pending = isolatedRun({ command: "parent exits but pipes remain", log: false, maxMemoryMb: 0 });
      child.emit("exit", 0);
      expect(sweep).toBeDefined();
      sweep?.();
      child.emit("close", 0);
      await pending;
      // The exited PID may already belong to an unrelated process when the app finally exits.
      expect(mocks.killSync).not.toHaveBeenCalledWith(4322);
    },
  );
  it("settles within the kill grace and keeps cancellation distinct from timeout", async () => {
    vi.useFakeTimers();
    const child = Object.assign(new EventEmitter(), {
      pid: 4321,
      stdout: new PassThrough(),
      stderr: new PassThrough(),
    });
    mocks.spawn.mockReturnValue(child);
    const controller = new AbortController();
    let settled = false;
    const result = runCommand({
      command: "hung",
      timeoutMs: 60_000,
      log: false,
      maxMemoryMb: 0,
      signal: controller.signal,
    }).then((outcome) => {
      settled = true;
      return outcome;
    });
    controller.abort();
    await vi.advanceTimersByTimeAsync(5_001);
    const settledAfterGrace = settled;
    // Release the pre-fix implementation too; the test itself must not leave an unresolved run.
    child.emit("close", null);
    const outcome = await result;
    expect(settledAfterGrace).toBe(true);
    expect(outcome.state).toBe("killed");
    expect(outcome.timedOut).toBe(false);
    expect(child.stdout.destroyed).toBe(true);
    expect(child.stderr.destroyed).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
