import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { recordSwallowedError } from "../utils/diagnostics";

/** The store has a synchronous API. Bound contention instead of waiting forever on another session. */
const MAX_WAIT_MS = 1_000;
const held = new Set<string>();
const sleepWord = new Int32Array(new SharedArrayBuffer(4));

function firstWaiter(directory: string): string | undefined {
  for (const name of readdirSync(directory).sort()) {
    const match = /^(\d+)-(\d+)-[a-f0-9-]+$/u.exec(name);
    if (!match) continue;
    const pid = Number(match[2]);
    try {
      process.kill(pid, 0);
      return name;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") return name;
      // A ticket name is unique and never reused; a dead owner's ticket cannot become a new owner's ticket.
      try {
        unlinkSync(join(directory, name));
      } catch (removeError) {
        if ((removeError as NodeJS.ErrnoException).code !== "ENOENT") throw removeError;
      }
    }
  }
  return undefined;
}

function abandoned(file: string): string | null {
  let contents: string;
  try {
    contents = readFileSync(file, "utf8");
  } catch {
    return null;
  }
  try {
    const owner = JSON.parse(contents) as { pid?: unknown };
    if (typeof owner.pid !== "number" || owner.pid <= 0) return null;
    try {
      process.kill(owner.pid, 0);
      return null;
    } catch (error) {
      // Access denied is not evidence that the other session died.
      return (error as NodeJS.ErrnoException).code === "ESRCH" ? contents : null;
    }
  } catch {
    // A process can die between creating the file and recording its PID. Do not steal a new incomplete lock.
    try {
      return Date.now() - statSync(file).mtimeMs > 30_000 ? contents : null;
    } catch {
      return null;
    }
  }
}

function reclaimAbandoned(file: string): boolean {
  // Only one contender may inspect and remove a dead owner's lock. Without this, two waiters that saw the
  // old PID could both unlink, and the second could remove the first waiter's newly acquired live lock.
  const reaper = `${file}.reap`;
  let fd: number;
  try {
    fd = openSync(reaper, "wx", 0o600);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EEXIST" || (process.platform === "win32" && code === "EPERM")) return false;
    throw error;
  }
  try {
    const previous = abandoned(file);
    if (previous === null) return false;
    try {
      // The former writer can release and exit while kill(pid, 0) runs, with another writer acquiring
      // meanwhile. The reaper mutex serializes reapers, not writers: never unlink a different owner.
      if (readFileSync(file, "utf8") !== previous) return false;
      unlinkSync(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
    return true;
  } finally {
    closeSync(fd);
    unlinkSync(reaper);
  }
}

/** Serialize read/modify/write mutations across processes; readers continue to see atomic file replacements. */
export function withMemoryLock<T>(directory: string, operation: () => T): T {
  const dir = resolve(directory);
  const file = join(dir, ".write-lock");
  if (held.has(file)) return operation();
  mkdirSync(dir, { recursive: true });
  const waiters = join(dir, ".write-waiters");
  mkdirSync(waiters, { recursive: true });
  const ticket = `${Date.now()}-${process.pid}-${randomUUID()}`;
  const ticketPath = join(waiters, ticket);
  writeFileSync(ticketPath, "", { flag: "wx", mode: 0o600 });
  const owner = JSON.stringify({ pid: process.pid, token: randomUUID() });
  const deadline = performance.now() + MAX_WAIT_MS;
  try {
    while (true) {
      // A writer must not immediately reacquire ahead of existing waiters. Otherwise a fast writer's
      // whole batch can starve another session until its bounded wait rejects an otherwise valid write.
      if (firstWaiter(waiters) !== ticket) {
        if (performance.now() >= deadline)
          throw new Error("Project memory is busy in another session; this write was not saved.");
        Atomics.wait(sleepWord, 0, 0, 5);
        continue;
      }
      let fd: number;
      try {
        fd = openSync(file, "wx", 0o600);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        // Windows may report a lock file awaiting deletion as EPERM rather than EEXIST.
        if (code !== "EEXIST" && !(process.platform === "win32" && code === "EPERM")) throw error;
        if (reclaimAbandoned(file)) continue;
        if (performance.now() >= deadline)
          throw new Error("Project memory is busy in another session; this write was not saved.");
        Atomics.wait(sleepWord, 0, 0, 5);
        continue;
      }
      try {
        writeFileSync(fd, owner, "utf8");
      } finally {
        closeSync(fd);
      }
      held.add(file);
      try {
        return operation();
      } finally {
        held.delete(file);
        if (existsSync(file) && readFileSync(file, "utf8") === owner) unlinkSync(file);
      }
    }
  } finally {
    try {
      unlinkSync(ticketPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") recordSwallowedError("memory.lock-ticket-cleanup", error);
    }
  }
}
