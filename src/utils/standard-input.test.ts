import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { readAll } from "./standard-input";

describe("readAll", () => {
  it("returns what a stream sent once it ends", async () => {
    const stream = new PassThrough();
    const reading = readAll(stream, { idleMs: 500, capMs: 2_000 });
    stream.write('{"stop_hook_active":');
    stream.end("false}");
    expect(await reading).toBe('{"stop_hook_active":false}');
  });

  it("gives up on a pipe that stays silent, and waits for a slow writer that has started", async () => {
    const silent = new PassThrough();
    const started = Date.now();
    expect(await readAll(silent, { idleMs: 50, capMs: 2_000 })).toBe("");
    expect(Date.now() - started).toBeLessThan(1_000);

    const slow = new PassThrough();
    const reading = readAll(slow, { idleMs: 50, capMs: 2_000 });
    slow.write("first ");
    await new Promise((resolve) => setTimeout(resolve, 120));
    slow.write("second");
    await new Promise((resolve) => setTimeout(resolve, 120));
    slow.end();
    expect(await reading).toBe("first second");
  });

  it("stops waiting for the end after the cap, keeping what arrived", async () => {
    const endless = new PassThrough();
    const reading = readAll(endless, { idleMs: 50, capMs: 150 });
    endless.write("partial");
    expect(await reading).toBe("partial");
  });
});
