import { execFileSync, spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { stopOrphansOf } from "./shell";

/** The node processes whose parent is `pid`, by the ids Windows reports. */
function childrenOf(pid: number): number[] {
  const out = execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `Get-CimInstance Win32_Process -Filter "ParentProcessId=${pid}" | ForEach-Object { $_.ProcessId }`,
    ],
    { encoding: "utf8", windowsHide: true },
  );
  return out
    .split(/\s+/u)
    .filter(Boolean)
    .map((id) => Number(id));
}

describe.skipIf(process.platform !== "win32")("stopping what a stopped shell left running (seen 2026-09-25)", () => {
  it("stops the child a shell started when only the shell was stopped", async () => {
    const startedAt = new Date();
    const shell = spawn("powershell.exe", ["-NoProfile", "-Command", 'node -e "setInterval(()=>{},1000)"'], {
      windowsHide: true,
      stdio: "ignore",
    });
    const shellPid = shell.pid as number;
    let orphans: number[] = [];
    for (let attempt = 0; attempt < 50 && orphans.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      orphans = childrenOf(shellPid);
    }
    expect(orphans.length).toBeGreaterThan(0);
    // Only the shell goes, as when taskkill listed the tree before the child existed.
    process.kill(shellPid);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(childrenOf(shellPid)).toEqual(orphans);

    await stopOrphansOf(shellPid, startedAt);

    expect(childrenOf(shellPid)).toEqual([]);
  }, 30_000);
});
