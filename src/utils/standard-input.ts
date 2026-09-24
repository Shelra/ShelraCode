import type { Readable } from "node:stream";

export interface ReadAllOptions {
  /** How long to wait for a first byte before deciding nothing is coming. */
  idleMs?: number;
  /** How long to wait for the end once bytes have arrived. */
  capMs?: number;
}

/**
 * Everything a stream sends, such as the JSON an agent's hook receives on stdin. A pipe that stays open
 * without sending anything (a terminal emulator that is not a TTY, a CI runner) yields an empty string
 * after `idleMs`; a slow writer gets `capMs` from its first byte to finish, so a read never hangs.
 */
export function readAll(stream: Readable, { idleMs = 2_000, capMs = 10_000 }: ReadAllOptions = {}): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let settled = false;
    let timer: ReturnType<typeof setTimeout>;
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stream.removeListener("data", onData);
      stream.removeListener("end", done);
      stream.removeListener("error", done);
      stream.pause();
      resolve(Buffer.concat(chunks).toString("utf8"));
    };
    const onData = (chunk: Buffer | string) => {
      if (chunks.length === 0) {
        clearTimeout(timer);
        timer = setTimeout(done, capMs);
      }
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    };
    timer = setTimeout(done, idleMs);
    stream.on("data", onData);
    stream.once("end", done);
    stream.once("error", done);
  });
}
