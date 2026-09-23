/** One structured log line. */
export interface LogLine {
  event: string;
  at: string;
  [field: string]: unknown;
}

export type LogSink = (line: LogLine) => void;

let sink: LogSink = (line) => console.log(JSON.stringify(line));

/** Sends log lines somewhere else (tests capture them); returns the previous sink. */
export function setLogSink(next: LogSink): LogSink {
  const previous = sink;
  sink = next;
  return previous;
}

/** Records an event and its fields as one line, so support can trace what happened. */
export function log(event: string, fields: Record<string, unknown> = {}): void {
  sink({ event, at: new Date().toISOString(), ...fields });
}
