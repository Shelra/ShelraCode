/**
 * Structured failures (audit doc 15, Phase 2.1): what failed, where and why, read from the output of the
 * common test runners and the TypeScript compiler, so a repair round gets test names, messages and
 * locations instead of a generic "it failed". Output nothing here recognizes falls back to its last lines.
 */

export interface CheckFailure {
  /** The failing test or diagnostic code, when the output names one. */
  name?: string;
  /** file:line, when the output gives one. */
  location?: string;
  message: string;
}

const MAX_FAILURES = 12;
const MAX_MESSAGE = 240;

function clip(text: string): string {
  const oneLine = text.replace(/\s+/gu, " ").trim();
  return oneLine.length > MAX_MESSAGE ? `${oneLine.slice(0, MAX_MESSAGE - 1)}…` : oneLine;
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape codes are what this strips
const ANSI_RE = /\u001b\[[0-9;]*[A-Za-z]/gu;

/** The failures an output names, most specific parser first; empty when none is recognized. */
export function parseFailures(output: string): CheckFailure[] {
  const text = output.replace(ANSI_RE, "").replace(/\r\n?/gu, "\n");
  for (const parse of [typescriptErrors, pytestFailures, bunFailures, vitestFailures, jestFailures]) {
    const failures = parse(text);
    if (failures.length > 0) return failures.slice(0, MAX_FAILURES);
  }
  return [];
}

/** `src/a.ts(12,5): error TS2322: …` or `src/a.ts:12:5 - error TS2322: …` */
function typescriptErrors(text: string): CheckFailure[] {
  const failures: CheckFailure[] = [];
  const pattern = /^(.+?)(?:\((\d+),(\d+)\)|:(\d+):(\d+))\s*[:-]\s*error\s+(TS\d+):\s*(.+)$/gmu;
  for (const match of text.matchAll(pattern)) {
    const [, file, line1, col1, line2, col2, code, message] = match;
    failures.push({
      name: code,
      location: `${file?.trim()}:${line1 ?? line2}:${col1 ?? col2}`,
      message: clip(message ?? ""),
    });
  }
  return failures;
}

/** `FAILED tests/test_x.py::test_name - AssertionError: …` (pytest's short summary). */
function pytestFailures(text: string): CheckFailure[] {
  const failures: CheckFailure[] = [];
  for (const match of text.matchAll(/^FAILED\s+(\S+?)::(\S+)(?:\s+-\s+(.+))?$/gmu)) {
    failures.push({ name: match[2], location: match[1], message: clip(match[3] ?? "failed") });
  }
  return failures;
}

/**
 * Bun: `(fail) suite > name [0.12ms]`, with the error printed above it and a location line such as
 * `at <anonymous> (src/slug.test.ts:12:5)` or `src/slug.test.ts:12:5`.
 */
function bunFailures(text: string): CheckFailure[] {
  const lines = text.split("\n");
  const failures: CheckFailure[] = [];
  let block: string[] = [];
  for (const line of lines) {
    const fail = /^\s*\(fail\)\s+(.+?)(?:\s+\[[\d.]+m?s\])?\s*$/u.exec(line);
    if (fail) {
      // `error: expect(received).toBe(expected)`, then `Expected: …` and `Received: …`.
      const message = block
        .filter((item) => /^\s*(?:error:|Expected:|Received:|\w*Error\b)/u.test(item))
        .map((item) => item.trim())
        .join(" ");
      const location = block
        .map((item) => /((?:[A-Za-z]:)?[^\s():]+\.[cm]?[jt]sx?:\d+(?::\d+)?)/u.exec(item)?.[1])
        .find(Boolean);
      failures.push({
        name: fail[1]?.trim(),
        ...(location ? { location } : {}),
        message: clip(
          message ||
            block
              .filter((item) => item.trim())
              .slice(-2)
              .join(" ") ||
            "failed",
        ),
      });
      block = [];
      continue;
    }
    if (/^\s*\(pass\)/u.test(line)) {
      block = [];
      continue;
    }
    block.push(line);
    if (block.length > 40) block.shift();
  }
  return failures;
}

/** Vitest: ` FAIL  src/x.test.ts > suite > name` followed by the error and a `❯ src/x.test.ts:12:5` line. */
function vitestFailures(text: string): CheckFailure[] {
  const failures: CheckFailure[] = [];
  const lines = text.split("\n");
  lines.forEach((line, index) => {
    const fail = /^\s*FAIL\s+(\S+\.[cm]?[jt]sx?)\s+>\s+(.+)$/u.exec(line);
    if (!fail) return;
    const rest = lines.slice(index + 1, index + 30);
    const message = rest.find((item) => /\b(?:AssertionError|Error|expected)\b/u.test(item));
    const location = rest.map((item) => /❯\s+(\S+:\d+:\d+)/u.exec(item)?.[1]).find(Boolean);
    failures.push({
      name: fail[2]?.trim(),
      location: location ?? fail[1],
      message: clip(message ?? "failed"),
    });
  });
  return failures;
}

/** Jest: `● suite › name` headers, each followed by its error. */
function jestFailures(text: string): CheckFailure[] {
  const failures: CheckFailure[] = [];
  const lines = text.split("\n");
  lines.forEach((line, index) => {
    const header = /^\s*●\s+(.+›.+)$/u.exec(line);
    if (!header) return;
    const rest = lines.slice(index + 1, index + 25);
    const message = rest.find((item) => item.trim() && !/^\s*$/u.test(item));
    const location = rest.map((item) => /\(([^()]+\.[cm]?[jt]sx?:\d+:\d+)\)/u.exec(item)?.[1]).find(Boolean);
    failures.push({
      name: header[1]?.trim(),
      ...(location ? { location } : {}),
      message: clip(message ?? "failed"),
    });
  });
  return failures;
}

/** Lines for a repair request: each failure on one line, or the output's last lines when none parsed. */
export function describeFailures(output: string, tailLines = 12): string {
  const failures = parseFailures(output);
  if (failures.length === 0) {
    const tail = output
      .replace(ANSI_RE, "")
      .split(/\r?\n/u)
      .filter((line) => line.trim())
      .slice(-tailLines)
      .join("\n");
    return tail || "(no output)";
  }
  return failures
    .map((failure) =>
      [failure.name, failure.location ? `(${failure.location})` : "", failure.message ? `— ${failure.message}` : ""]
        .filter(Boolean)
        .join(" "),
    )
    .map((line) => `  • ${line}`)
    .join("\n");
}

/**
 * A stable identity for a set of failures, so the repair loop can tell "the same failures again" from
 * progress. Numbers, paths and timings are normalized away.
 */
export function failureSignature(output: string): string {
  const failures = parseFailures(output);
  const items =
    failures.length > 0
      ? failures.map((failure) => `${failure.name ?? ""}|${failure.message}`)
      : output
          .split(/\r?\n/u)
          .filter((line) => line.trim())
          .slice(-6);
  return items
    .map((item) =>
      item
        .toLowerCase()
        .replace(/\d+(?:\.\d+)?/gu, "#")
        .replace(/[a-z]:\\\S*/gu, "<path>")
        .replace(/\/\S*\//gu, "<path>/"),
    )
    .sort()
    .join("\n");
}
