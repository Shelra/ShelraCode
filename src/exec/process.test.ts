import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), kill: vi.fn().mockResolvedValue(undefined) }));
vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));
vi.mock("./shell", () => ({
  buildShellInvocation: () => ({ file: "fixture", args: [] }),
  spawnOptions: () => ({}),
  createShellErrorFilter: () => ({ push: (text: string) => text }),
  killProcessTree: mocks.kill,
}));
vi.mock("./logging", () => ({
  allocateLogPath: () => "fixture.log",
  DEFAULT_CAPTURE_CHARS: 100,
  BoundedCapture: class {
    private value = "";
    append(text: string) {
      this.value += text;
    }
    text() {
      return this.value;
    }
  },
  RunLog: class {
    header() {}
    write() {}
    async close() {}
  },
}));

import { ProcessManager } from "./process";

afterEach(() => vi.clearAllMocks());
describe("process ownership across simultaneous sessions", () => {
  it.each([1, 3, 5])("stopping one of %i managers stops only its own process", async (count) => {
    let nextPid = 9000;
    mocks.spawn.mockImplementation(() => {
      const child = Object.assign(new EventEmitter(), {
        pid: nextPid++,
        stdout: new PassThrough(),
        stderr: new PassThrough(),
      });
      queueMicrotask(() => child.stdout.write("ready"));
      return child;
    });
    const managers = Array.from({ length: count }, () => new ProcessManager());
    const processes = await Promise.all(
      managers.map((manager) => manager.start({ command: "fixture", cwd: ".", readyPattern: /ready/u })),
    );
    await managers[0]!.stopAll();
    const killed = mocks.kill.mock.calls.map((call) => call[0]);
    await Promise.all(managers.map((manager) => manager.stopAll()));
    expect(killed).toEqual([processes[0]!.pid]);
  });
});
