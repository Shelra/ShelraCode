/**
 * ripgrep, run off the main thread. The `ripgrep` package is WebAssembly with a WASI shim over synchronous file
 * calls: `await ripgrep(...)` holds the event loop until the search is over (0.3 s on a 3,000-file project, about a
 * second when it finds 180,000 lines, longer on a big repository), so the terminal froze at every grep. Here it
 * freezes only this thread. Loaded by `grep.ts`; it must stay a module of its own so the build can ship it.
 */
import { ripgrep } from "ripgrep";
import { trimRipgrepOutput } from "./ripgrep-output";

declare const self: {
  onmessage: ((event: { data: unknown }) => void) | null;
  postMessage(message: unknown): void;
};

interface Job {
  id: number;
  args: string[];
  env: Record<string, string>;
  cwd: string;
}

self.onmessage = async (event) => {
  const job = event.data as Job;
  try {
    const result = await ripgrep(job.args, { buffer: true, env: job.env, preopens: { ".": job.cwd } });
    const trimmed = trimRipgrepOutput((result.stdout as string | undefined) ?? "");
    self.postMessage({
      id: job.id,
      code: result.code ?? 1,
      stdout: trimmed.stdout,
      total: trimmed.total,
      stderr: (result.stderr as string | undefined) ?? "",
    });
  } catch (error) {
    self.postMessage({ id: job.id, error: error instanceof Error ? error.message : String(error) });
  }
};

self.postMessage({ ready: true });
