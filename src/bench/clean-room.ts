import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface BenchCleanRoom {
  /** The scratch folder holding everything below; kept after the run so its workspaces can be inspected. */
  root: string;
  /** Where the runner creates each task workspace, one git repository per task. */
  taskRoot: string;
  /** The HOME the run uses while it lasts. */
  home: string;
  /** HOME and USERPROFILE as they were before the run, for adapters that need the user's own logins. */
  realHome: { HOME?: string; USERPROFILE?: string };
  /** Puts HOME, USERPROFILE and the user-wide memory root back. */
  leave: () => void;
}

/**
 * A clean room for one `shelra bench` invocation (audit doc 15, §15.3 rule 2). Task workspaces live in
 * a scratch folder outside every repository, and HOME moves to a scratch home, so the settings, memory,
 * skills, instructions, hooks and MCP servers of the person running the benchmark never reach a task.
 *
 * Enter it after the API key is resolved and the benchmark database is open, since both are found
 * through HOME; the open database keeps its handle. The scratch home gets a git identity, so a task
 * that commits does not stall on a missing one.
 */
export function enterBenchCleanRoom(base: string = tmpdir()): BenchCleanRoom {
  const root = mkdtempSync(join(base, "shelra-bench-"));
  const taskRoot = join(root, "tasks");
  const home = join(root, "home");
  mkdirSync(taskRoot, { recursive: true });
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, ".gitconfig"), "[user]\n\tname = Shelra Bench\n\temail = bench@shelra.invalid\n");

  const realHome = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  // The user-wide memory store can be named apart from HOME; the run must not read it either.
  const realMemoryRoot = process.env.SHELRA_USER_MEMORY_ROOT;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.SHELRA_USER_MEMORY_ROOT = home;
  let left = false;
  return {
    root,
    taskRoot,
    home,
    realHome,
    leave: () => {
      if (left) return;
      left = true;
      const saved = { ...realHome, SHELRA_USER_MEMORY_ROOT: realMemoryRoot };
      for (const key of ["HOME", "USERPROFILE", "SHELRA_USER_MEMORY_ROOT"] as const) {
        const value = saved[key];
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    },
  };
}
