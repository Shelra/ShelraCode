import { recordSwallowedError } from "../utils/diagnostics";

/** What a search returned, already trimmed to the matches that can be shown (see `ripgrep-output.ts`). */
export interface RipgrepRun {
  code: number;
  stdout: string;
  total: number;
  stderr: string;
}

/** The part of the Web Worker API used here (Bun provides it; the project's type libraries do not declare it). */
interface WorkerLike {
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: { error?: unknown }) => void) | null;
  postMessage(message: unknown): void;
  terminate(): void;
  unref?(): void;
}
const WorkerConstructor = (globalThis as { Worker?: new (url: string) => WorkerLike }).Worker;

interface Pending {
  resolve(run: RipgrepRun | null): void;
}

/**
 * Where the worker module may be, relative to this one: next to it in the source tree, in a bundle that put it beside
 * the entry, or under `tools/` in a bundle that kept the source layout. The first that starts is used.
 */
const WORKER_CANDIDATES = ["./grep-worker.ts", "./grep-worker.js", "./tools/grep-worker.js", "./tools/grep-worker.ts"];
const START_TIMEOUT_MS = 4_000;
/** After a worker that would not start, searches run in-process for this long before another attempt. */
const RETRY_AFTER_MS = 5 * 60_000;
/** A search that has not answered by now is wedged (a pathological pattern, a network drive): the worker is replaced. */
const SEARCH_TIMEOUT_MS = 120_000;

let current: WorkerLike | null = null;
let starting: Promise<WorkerLike | null> | null = null;
let failedAt = 0;
let nextId = 1;
const pending = new Map<number, Pending>();

/** `SHELRA_GREP_TIMEOUT_MS` overrides the limit (tests, very slow disks). */
function searchTimeoutMs(): number {
  const value = Number(process.env.SHELRA_GREP_TIMEOUT_MS);
  return Number.isFinite(value) && value > 0 ? value : SEARCH_TIMEOUT_MS;
}

function settleAll(run: RipgrepRun | null): void {
  for (const entry of pending.values()) entry.resolve(run);
  pending.clear();
}

function drop(worker: WorkerLike): void {
  if (current === worker) current = null;
  try {
    worker.terminate();
  } catch {
    // Already gone.
  }
  // Searches waiting on it are answered by the caller's in-process fallback.
  settleAll(null);
}

function tryCandidate(relative: string): Promise<WorkerLike | null> {
  return new Promise((resolve) => {
    let worker: WorkerLike;
    try {
      if (!WorkerConstructor) return resolve(null);
      worker = new WorkerConstructor(new URL(relative, import.meta.url).href);
    } catch {
      resolve(null);
      return;
    }
    const timer = setTimeout(() => finish(null), START_TIMEOUT_MS);
    const finish = (started: WorkerLike | null) => {
      clearTimeout(timer);
      if (!started) {
        try {
          worker.terminate();
        } catch {
          // Never started.
        }
      }
      resolve(started);
    };
    worker.onerror = () => finish(null);
    worker.onmessage = (event) => {
      if ((event.data as { ready?: boolean })?.ready) finish(worker);
    };
  });
}

async function startWorker(): Promise<WorkerLike | null> {
  if (!WorkerConstructor) return null;
  for (const candidate of WORKER_CANDIDATES) {
    const worker = await tryCandidate(candidate);
    if (!worker) continue;
    worker.onerror = (event) => {
      recordSwallowedError("grep.worker", event.error ?? new Error("grep worker failed"));
      drop(worker);
    };
    worker.onmessage = (event) => {
      const data = event.data as { id?: number; error?: string } & Partial<RipgrepRun>;
      if (data.id === undefined) return;
      const entry = pending.get(data.id);
      if (!entry) return;
      pending.delete(data.id);
      if (data.error !== undefined) {
        recordSwallowedError("grep.worker", new Error(data.error));
        entry.resolve(null);
        return;
      }
      entry.resolve({
        code: data.code ?? 1,
        stdout: data.stdout ?? "",
        total: data.total ?? 0,
        stderr: data.stderr ?? "",
      });
    };
    // A search in flight must not keep the program from exiting.
    worker.unref?.();
    return worker;
  }
  return null;
}

async function ensureWorker(): Promise<WorkerLike | null> {
  if (current) return current;
  if (failedAt && Date.now() - failedAt < RETRY_AFTER_MS) return null;
  starting ??= startWorker().then((worker) => {
    starting = null;
    if (worker) current = worker;
    else failedAt = Date.now();
    return worker;
  });
  return starting;
}

/**
 * Runs ripgrep on a worker thread so the terminal keeps redrawing, typing and cancelling during the search. Null when
 * no worker can be had or it failed: the caller then searches in-process, as before (a missing resource never ends
 * the turn).
 */
export async function ripgrepOffThread(
  args: string[],
  env: Record<string, string>,
  cwd: string,
): Promise<RipgrepRun | null> {
  const worker = await ensureWorker();
  if (!worker) return null;
  return new Promise<RipgrepRun | null>((resolve) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      if (!pending.delete(id)) return;
      recordSwallowedError("grep.worker", new Error(`a search did not answer in ${SEARCH_TIMEOUT_MS / 1000}s`));
      resolve({
        code: 124,
        stdout: "",
        total: 0,
        stderr: `The search did not finish in ${SEARCH_TIMEOUT_MS / 1000}s and was stopped: narrow the path or the pattern.`,
      });
      // The worker may be stuck inside this search: replace it rather than queue the next ones behind it.
      drop(worker);
    }, searchTimeoutMs());
    timer.unref?.();
    pending.set(id, {
      resolve: (run) => {
        clearTimeout(timer);
        resolve(run);
      },
    });
    try {
      worker.postMessage({ id, args, env, cwd });
    } catch (error) {
      clearTimeout(timer);
      pending.delete(id);
      recordSwallowedError("grep.worker", error);
      resolve(null);
    }
  });
}

/** Stops the worker, if one is running. */
export function stopRipgrepWorker(): void {
  if (current) drop(current);
}
