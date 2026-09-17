import { describe, expect, it } from "vitest";
import { runCommand } from "./command";
import { readProcessTable, sumProcessTreeMb } from "./memory";

describe("process tree memory accounting", () => {
  it("sums the root and every descendant, ignoring unrelated processes and cycles", () => {
    const table = [
      { pid: 1, ppid: 0, rssMb: 5 },
      { pid: 10, ppid: 1, rssMb: 6 },
      { pid: 11, ppid: 10, rssMb: 700 },
      { pid: 12, ppid: 11, rssMb: 300 },
      { pid: 20, ppid: 1, rssMb: 999 },
      // A recycled pid can make a stale row point at its own descendant; must not loop forever.
      { pid: 10, ppid: 12, rssMb: 6 },
    ];
    expect(sumProcessTreeMb(table, 10)).toBe(1006);
    expect(sumProcessTreeMb(table, 20)).toBe(999);
    expect(sumProcessTreeMb(table, 404)).toBe(0);
  });

  it("reads a real process table that contains this process", async () => {
    const table = await readProcessTable();
    const self = table.find((row) => row.pid === process.pid);
    expect(self).toBeDefined();
    expect(self?.rssMb ?? 0).toBeGreaterThan(1);
  });

  it("kills a command whose process tree exceeds the memory ceiling", async () => {
    // Allocates ~50 MB every 100 ms and would run forever; the ceiling must end it, not the clock.
    const script =
      "const a=[];setInterval(()=>{a.push(new Uint8Array(50*1024*1024).fill(1));},100);setTimeout(()=>{},60000)";
    const outcome = await runCommand({
      command: `bun -e "${script}"`,
      timeoutMs: 45_000,
      maxMemoryMb: 400,
      memoryPollMs: 500,
      log: false,
    });
    expect(outcome.state).toBe("killed");
    expect(outcome.stderr).toContain("memory ceiling");
    expect(outcome.durationMs).toBeLessThan(40_000);
  }, 50_000);
});
