import { execFile } from "node:child_process";

/**
 * Process-tree memory accounting for spawned commands.
 *
 * A wall-clock timeout is not enough to protect the host from a command that allocates
 * without bound: on 2026-09-17 a benchmark oracle executing agent-written code grew past
 * 22 GB in under a minute, the machine ran out of memory, and the parent that would have
 * enforced the timeout died first. The runtime therefore also watches the resident size of
 * the whole tree a command spawned and kills it when it crosses a ceiling.
 */

export interface ProcessRow {
  pid: number;
  ppid: number;
  rssMb: number;
}

const isWindows = process.platform === "win32";

function run(file: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => {
      if (error) reject(error);
      else resolve(String(stdout));
    });
  });
}

/** Snapshot of every process the OS reports: pid, parent pid, resident set in MB. */
export async function readProcessTable(): Promise<ProcessRow[]> {
  if (isWindows) {
    const json = await run("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,WorkingSetSize | ConvertTo-Json -Compress",
    ]);
    const parsed = JSON.parse(json.trim() || "[]") as
      | Array<{ ProcessId: number; ParentProcessId: number; WorkingSetSize: number }>
      | { ProcessId: number; ParentProcessId: number; WorkingSetSize: number };
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    return rows.map((row) => ({
      pid: Number(row.ProcessId),
      ppid: Number(row.ParentProcessId),
      rssMb: Number(row.WorkingSetSize ?? 0) / (1024 * 1024),
    }));
  }
  const text = await run("ps", ["-A", "-o", "pid=,ppid=,rss="]);
  return text
    .split("\n")
    .map((line) => line.trim().split(/\s+/u))
    .filter((parts) => parts.length >= 3)
    .map(([pid, ppid, rssKb]) => ({ pid: Number(pid), ppid: Number(ppid), rssMb: Number(rssKb) / 1024 }));
}

/** Resident memory of `rootPid` plus every descendant, in MB. Pure; testable with a fake table. */
export function sumProcessTreeMb(table: readonly ProcessRow[], rootPid: number): number {
  const children = new Map<number, ProcessRow[]>();
  for (const row of table) {
    const siblings = children.get(row.ppid) ?? [];
    siblings.push(row);
    children.set(row.ppid, siblings);
  }
  const byPid = new Map(table.map((row) => [row.pid, row]));
  const seen = new Set<number>();
  const stack = [rootPid];
  let total = 0;
  while (stack.length > 0) {
    const pid = stack.pop() as number;
    if (seen.has(pid)) continue;
    seen.add(pid);
    total += byPid.get(pid)?.rssMb ?? 0;
    for (const child of children.get(pid) ?? []) stack.push(child.pid);
  }
  return total;
}

/** Best-effort tree measurement; a failing OS query reads as zero rather than as a kill. */
export async function measureProcessTreeMb(rootPid: number): Promise<number> {
  try {
    return sumProcessTreeMb(await readProcessTable(), rootPid);
  } catch {
    return 0;
  }
}
