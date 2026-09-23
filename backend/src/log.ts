/*
 * One JSON object per line: stdout for information, stderr for errors. That is what a host's log viewer
 * indexes and what a person searches by request id. Never log credentials, tokens or request bodies.
 */
export type LogEntry = { level: "info" | "warn" | "error"; msg: string } & Record<string, unknown>;
export type Logger = (entry: LogEntry) => void;

export const jsonLogger: Logger = (entry) => {
  const line = JSON.stringify({ time: new Date().toISOString(), ...entry });
  if (entry.level === "error") console.error(line);
  else console.log(line);
};

// A connection error can quote the connection string; its password must not reach the log.
const redact = (text: string) => text.replace(/(postgres(?:ql)?:\/\/[^:/@\s]+:)[^@\s]+@/gi, "$1***@");

/** The parts of an error worth logging, so a failed request can be diagnosed from its log line alone. */
export function describeError(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { message: redact(String(error)) };
  const details = error as Error & { code?: unknown; errno?: unknown; detail?: unknown };
  return {
    name: error.name,
    message: redact(error.message),
    ...(details.code !== undefined ? { code: details.code } : {}),
    ...(details.errno !== undefined ? { errno: details.errno } : {}),
    ...(typeof details.detail === "string" ? { detail: redact(details.detail) } : {}),
    ...(error.stack ? { stack: redact(error.stack) } : {}),
  };
}
