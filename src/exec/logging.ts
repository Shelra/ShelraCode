/**
 * Bounded in-memory capture plus full-fidelity log files.
 *
 * Everything a command or process emits is written to disk so the evidence survives, while
 * only a clipped head+tail is kept in memory: model context is the scarce resource, disk is not.
 */

import { createReadStream, createWriteStream, existsSync, mkdirSync, type WriteStream } from "node:fs";
import { stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/** Per-stream in-memory budget for a one-shot command. */
export const DEFAULT_CAPTURE_CHARS = 16_000;

const TAIL_READ_BYTES = 256 * 1024;

let execLogRoot: string | null = null;

/**
 * Points every subsequent exec log at the objective's run directory.
 * Called once by the runtime when it opens a run; tests and ad-hoc use fall back to a temp dir.
 */
export function setExecLogRoot(dir: string): void {
  execLogRoot = dir;
}

export function getExecLogRoot(): string {
  if (execLogRoot) return execLogRoot;
  return path.join(os.tmpdir(), "shelra-exec", String(process.pid));
}

let logCounter = 0;

function sanitizeLabel(label: string): string {
  const cleaned = label
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return cleaned || "run";
}

/** Allocates a unique log-file path inside `dir` (defaults to the current exec log root). */
export function allocateLogPath(label: string, dir?: string): string {
  const root = dir ?? getExecLogRoot();
  mkdirSync(root, { recursive: true });
  logCounter += 1;
  const stamp = `${Date.now().toString(36)}-${logCounter.toString(36)}`;
  return path.join(root, `${sanitizeLabel(label)}-${stamp}.log`);
}

/**
 * Keeps the first and last slice of a stream without ever holding the middle.
 *
 * When the total stays under the limit, head+tail reconstructs the original exactly.
 */
export class BoundedCapture {
  private head = "";
  private tail = "";
  private total = 0;
  private readonly headLimit: number;
  private readonly tailLimit: number;

  constructor(private readonly limit: number = DEFAULT_CAPTURE_CHARS) {
    this.headLimit = Math.max(1, Math.floor(limit * 0.4));
    this.tailLimit = Math.max(1, limit - this.headLimit);
  }

  append(chunk: string): void {
    if (!chunk) return;
    this.total += chunk.length;
    let rest = chunk;
    const headRoom = this.headLimit - this.head.length;
    if (headRoom > 0) {
      this.head += rest.slice(0, headRoom);
      rest = rest.slice(headRoom);
    }
    if (!rest) return;
    this.tail = (this.tail + rest).slice(-this.tailLimit);
  }

  get truncated(): boolean {
    return this.total > this.limit;
  }

  get length(): number {
    return this.total;
  }

  /** The clipped text, with an explicit marker where content was dropped. */
  text(): string {
    if (!this.truncated) return this.head + this.tail;
    const omitted = this.total - this.head.length - this.tail.length;
    return `${this.head}\n…[${omitted} characters omitted — full output in the log file]…\n${this.tail}`;
  }

  /** The last `chars` characters seen, used for failure reasons and readiness matching. */
  tailText(chars = this.tailLimit): string {
    const combined = this.truncated ? this.tail : this.head + this.tail;
    return combined.slice(-chars);
  }
}

/** A log file that both stdout and stderr stream into, tagged where the stream changes. */
export class RunLog {
  private stream: WriteStream | null;
  private lastTag: string | null = null;
  private closed = false;

  constructor(readonly filePath: string) {
    mkdirSync(path.dirname(filePath), { recursive: true });
    this.stream = createWriteStream(filePath, { flags: "a" });
    // A broken log must never take the run down with it.
    this.stream.on("error", () => {
      this.stream = null;
    });
  }

  header(lines: string[]): void {
    this.writeRaw(`${lines.join("\n")}\n`);
  }

  write(tag: "stdout" | "stderr", chunk: string): void {
    if (!chunk) return;
    if (this.lastTag !== tag) {
      this.writeRaw(`${this.lastTag === null ? "" : "\n"}--- ${tag} ---\n`);
      this.lastTag = tag;
    }
    this.writeRaw(chunk);
  }

  private writeRaw(text: string): void {
    if (this.closed || !this.stream) return;
    try {
      this.stream.write(text);
    } catch {
      this.stream = null;
    }
  }

  async close(footer?: string): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const stream = this.stream;
    if (!stream) return;
    if (footer) {
      try {
        stream.write(`\n${footer}\n`);
      } catch {
        /* ignore */
      }
    }
    await new Promise<void>((resolve) => {
      stream.end(() => resolve());
      stream.on("error", () => resolve());
    });
  }
}

/** Reads the last `lines` lines of a log file without loading the whole thing. */
export async function tailFile(filePath: string, lines = 50): Promise<string> {
  if (!existsSync(filePath)) return "";
  let size = 0;
  try {
    size = (await stat(filePath)).size;
  } catch {
    return "";
  }
  const start = Math.max(0, size - TAIL_READ_BYTES);
  const content = await new Promise<string>((resolve) => {
    const chunks: Buffer[] = [];
    const stream = createReadStream(filePath, { start });
    stream.on("data", (chunk: Buffer | string) => {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    });
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    stream.on("error", () => resolve(""));
  });
  const split = content.split("\n");
  return split.slice(-lines).join("\n").trimEnd();
}
