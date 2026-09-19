/**
 * Presentation model for "what is the agent doing right now, and what did it do".
 *
 * Everything here is derived from real runtime facts (tool calls, tool results, host status
 * stages, streamed reasoning). Nothing is invented: a phrase never claims more than the call it
 * was built from, and result summaries only report numbers that were parsed from real output.
 */
import type { FileDiff, ToolCall, ToolResult } from "../types/index";

/** Semantic state of one activity line. The renderer maps each to a theme role and a glyph. */
export type ActivityTone = "active" | "success" | "danger" | "warning" | "neutral";

/** Groups consecutive operations that read as one thought ("Read 3 files"). */
export type ActivityGroup =
  | "explore"
  | "research"
  | "change"
  | "command"
  | "verify"
  | "plan"
  | "agent"
  | "memory"
  /** Something the agent pulled into its context mid-turn: a skill, recalled memories. */
  | "load";

export interface ActivityPhrase {
  /** Present-tense verb phrase: "Reading", "Searching for", "Running tests". */
  verb: string;
  /** The real target of the call: a path, a pattern, a command. Empty when unknown. */
  object: string;
}

export interface CommandSummary {
  /** One line a human wants first: "4 pass · 2 fail", "no type errors", "exit 1". */
  headline: string;
  tone: ActivityTone;
  /** Failing test names or error lines, most relevant first. */
  failures: string[];
  kind: "test" | "typecheck" | "lint" | "build" | "install" | "generic";
}

export interface ActivityRowModel {
  id: string;
  group: ActivityGroup;
  tone: ActivityTone;
  /** Past-tense verb: "Read", "Edited", "Ran". */
  verb: string;
  object: string;
  /** Right-aligned fact: duration, diffstat, or result headline. */
  meta?: string;
  /** Extra lines shown only in detail mode (or always for failures). */
  lines: string[];
  diff?: FileDiff;
  /** Last lines of a command's output, kept for detail mode. */
  tail?: string[];
  operation: string;
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: matching ANSI escape sequences is the point
const ANSI = /\u001B\[[0-9;?]*[ -/]*[@-~]/g;
const MAX_OBJECT = 72;

function stripAnsi(value: string): string {
  return value.replace(ANSI, "");
}

export function truncateText(value: string, max: number): string {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, Math.max(1, max - 1))}…`;
}

/** Keeps the tail of a path: the file name is what the eye looks for. */
export function shortenPath(value: string, max = MAX_OBJECT): string {
  const normalized = value.replace(/\\/g, "/");
  if (normalized.length <= max) return normalized;
  const parts = normalized.split("/");
  let tail = parts.pop() ?? normalized;
  while (parts.length > 0 && tail.length + (parts.at(-1)?.length ?? 0) + 2 < max - 2) {
    tail = `${parts.pop()}/${tail}`;
  }
  return `…/${tail}`.slice(-max);
}

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Models stream `function.arguments` token by token, so mid-stream JSON is usually incomplete. */
function streamingArg(raw: string, key: string): string {
  const match = raw.match(new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)`));
  if (!match) return "";
  try {
    return JSON.parse(`"${match[1]}"`);
  } catch {
    return match[1] ?? "";
  }
}

function arg(toolCall: ToolCall, key: string): string {
  const value = parseArgs(toolCall.function.arguments)[key];
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  return streamingArg(toolCall.function.arguments, key).trim();
}

function numberArg(toolCall: ToolCall, key: string): number | undefined {
  const value = parseArgs(toolCall.function.arguments)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

type CommandKind = CommandSummary["kind"];

const SEGMENT_SPLIT = /&&|\|\||;|\||\n/;
const RUNNER_PREFIX = /^(?:(?:[A-Z_][A-Z0-9_]*=\S*\s+)+|(?:time|sudo|env)\s+)+/;

/**
 * Matched against the start of each shell segment, so a word in an argument ("Get-ChildItem tests",
 * "cat tests/a.test.ts") never turns a listing or a read into a test run.
 */
const KIND_PATTERNS: ReadonlyArray<readonly [CommandKind, RegExp]> = [
  ["test", /^(?:(?:npx|bunx)\s+)?(?:vitest|jest|pytest|mocha|phpunit|rspec|playwright\s+test)\b/],
  ["test", /^(?:bun|npm|pnpm|yarn|deno)\s+(?:run\s+)?(?:[\w-]+:)?test[\w:-]*(?:\s|$)/],
  ["test", /^(?:cargo|go|dotnet|swift|zig)\s+test\b/],
  ["test", /^(?:mvn|gradle|\.\/gradlew|\.\\gradlew)\b.*\btest\b/],
  ["test", /^python\d?(?:\.\d+)?\s+-m\s+(?:pytest|unittest)\b/],
  ["test", /^make\s+test\b/],
  ["typecheck", /^(?:(?:npx|bunx)\s+)?(?:tsc|mypy|pyright)\b/],
  ["typecheck", /^(?:bun|npm|pnpm|yarn)\s+(?:run\s+)?typecheck\b/],
  ["lint", /^(?:(?:npx|bunx)\s+)?(?:biome|eslint|prettier|ruff|oxlint)\b/],
  ["lint", /^(?:bun|npm|pnpm|yarn)\s+(?:run\s+)?lint\b/],
  ["lint", /^cargo\s+clippy\b/],
  ["build", /^(?:bun|npm|pnpm|yarn)\s+(?:run\s+)?build\b/],
  ["build", /^(?:cargo|go|dotnet)\s+build\b/],
  ["install", /^(?:bun|npm|pnpm|yarn)\s+(?:install|add|i|ci)\b/],
  ["install", /^pip\d?\s+install\b/],
  ["install", /^(?:cargo\s+(?:add|install)|poetry\s+(?:add|install))\b/],
];

const KIND_PRIORITY: readonly CommandKind[] = ["test", "typecheck", "lint", "build", "install"];

export function classifyCommand(command: string): CommandKind {
  const found = new Set<CommandKind>();
  for (const raw of command.split(SEGMENT_SPLIT)) {
    const segment = raw.trim().replace(RUNNER_PREFIX, "");
    for (const [kind, pattern] of KIND_PATTERNS) {
      if (pattern.test(segment)) found.add(kind);
    }
  }
  return KIND_PRIORITY.find((kind) => found.has(kind)) ?? "generic";
}

/** Checks that prove a change (tests, types, lint, build) - the host treats these as verification. */
export function isVerificationCommand(command: string): boolean {
  const kind = classifyCommand(command);
  return kind === "test" || kind === "typecheck" || kind === "lint" || kind === "build";
}

const COMMAND_VERBS: Record<CommandKind, string> = {
  test: "Running tests",
  typecheck: "Checking types",
  lint: "Linting",
  build: "Building",
  install: "Installing dependencies",
  generic: "Running",
};

/** A skill is loaded when its SKILL.md is read; the folder name is the skill's name. */
export function skillNameFromPath(path: string): string | null {
  const match = path.replace(/\\/g, "/").match(/(?:^|\/)([^/]+)\/SKILL\.md$/i);
  return match?.[1] ?? null;
}

/** Present-tense phrase for a call that is starting or streaming its arguments. */
export function describeToolCall(toolCall: ToolCall): ActivityPhrase {
  const name = toolCall.function.name;
  switch (name) {
    case "read_file": {
      const skill = skillNameFromPath(arg(toolCall, "path"));
      if (skill) return { verb: "Loading skill", object: skill };
      const path = shortenPath(arg(toolCall, "path"));
      const start = numberArg(toolCall, "start_line");
      const end = numberArg(toolCall, "end_line");
      const range = start !== undefined ? ` · lines ${start}${end !== undefined ? `–${end}` : "+"}` : "";
      return { verb: "Reading", object: `${path}${range}`.trim() };
    }
    case "grep":
      return { verb: "Searching for", object: truncateText(arg(toolCall, "pattern"), MAX_OBJECT) };
    case "lsp": {
      const operation = arg(toolCall, "operation") || "symbols";
      return { verb: `Inspecting ${operation} in`, object: shortenPath(arg(toolCall, "filePath")) };
    }
    case "write_file":
      return { verb: "Writing", object: shortenPath(arg(toolCall, "path")) };
    case "edit_file":
      return { verb: "Editing", object: shortenPath(arg(toolCall, "path")) };
    case "delete_file":
      return { verb: "Deleting", object: shortenPath(arg(toolCall, "path")) };
    case "bash": {
      const command = arg(toolCall, "command");
      if (parseArgs(toolCall.function.arguments).background === true) {
        return { verb: "Starting background process", object: truncateText(command, MAX_OBJECT) };
      }
      return { verb: COMMAND_VERBS[classifyCommand(command)], object: truncateText(command, MAX_OBJECT) };
    }
    case "search_web":
      return { verb: "Searching the web for", object: truncateText(arg(toolCall, "query"), MAX_OBJECT) };
    case "search_x":
      return { verb: "Searching X for", object: truncateText(arg(toolCall, "query"), MAX_OBJECT) };
    case "open_web":
      return { verb: "Reading", object: truncateText(arg(toolCall, "url"), MAX_OBJECT) };
    case "generate_plan":
      return { verb: "Planning", object: truncateText(arg(toolCall, "title"), MAX_OBJECT) };
    case "update_plan_step":
      return { verb: "Updating the plan", object: "" };
    case "task": {
      const agent = arg(toolCall, "agent");
      return {
        verb: agent ? `Delegating to ${agent}` : "Delegating",
        object: truncateText(arg(toolCall, "description"), MAX_OBJECT),
      };
    }
    case "delegate":
      return { verb: "Starting background agent", object: truncateText(arg(toolCall, "description"), MAX_OBJECT) };
    case "delegation_read":
    case "delegation_list":
      return { verb: "Checking background agents", object: "" };
    case "process_logs":
      return { verb: "Reading process logs", object: arg(toolCall, "id") };
    case "process_stop":
      return { verb: "Stopping process", object: arg(toolCall, "id") };
    case "process_list":
      return { verb: "Listing processes", object: "" };
    case "memory_write":
      return {
        verb: "Saving project memory",
        object: truncateText(arg(toolCall, "title") || arg(toolCall, "slug"), 60),
      };
    case "memory_read":
    case "memory_list":
      return { verb: "Checking project memory", object: truncateText(arg(toolCall, "slug"), 60) };
    case "memory_delete":
      return { verb: "Removing project memory", object: truncateText(arg(toolCall, "slug"), 60) };
    case "generate_image":
    case "generate_video":
      return {
        verb: name === "generate_image" ? "Generating image" : "Generating video",
        object: truncateText(arg(toolCall, "prompt"), 60),
      };
    default:
      return { verb: `Using ${name.replace(/_/g, " ")}`, object: "" };
  }
}

export function phraseText(phrase: ActivityPhrase): string {
  return phrase.object ? `${phrase.verb} ${phrase.object}` : phrase.verb;
}

/** Host status stages arrive with human text already; only vague stages are rewritten. */
export function describeStatusStage(stage: string, detail: string): ActivityPhrase {
  const text = detail.trim();
  switch (stage) {
    case "hooks":
      return { verb: "Preparing the session", object: "" };
    case "notifications":
      return { verb: "Checking background activity", object: "" };
    case "mcp":
      return { verb: "Connecting MCP tools", object: "" };
    case "model": {
      const match = text.match(/^Waiting for\s+(.+)$/i);
      return match
        ? { verb: "Waiting for", object: match[1] ?? "" }
        : { verb: text || "Waiting for the model", object: "" };
    }
    default:
      return { verb: text || "Working", object: "" };
  }
}

/** "+3 -1" for edits, "+12" for new files. */
export function diffStat(diff: Pick<FileDiff, "additions" | "removals" | "isNew">): string {
  if (diff.isNew || diff.removals === 0) return `+${diff.additions}`;
  return `+${diff.additions} -${diff.removals}`;
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "";
  if (ms < 1000) return `${Math.max(1, Math.round(ms))}ms`;
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

/**
 * The most recent thought, one line. Providers emit reasoning as markdown ("**Checking the
 * boundary**\n..."), so emphasis markers are stripped and only the tail of the stream is kept.
 */
export function reasoningPreview(text: string, max = 110): string {
  const cleaned = text
    .replace(/[*_`#>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "";
  const sentences = cleaned.split(/(?<=[.!?])\s+/).filter(Boolean);
  const latest = (sentences.at(-1) ?? cleaned).trim();
  return latest.length <= max ? latest : `…${latest.slice(-(max - 1)).trimStart()}`;
}

function firstNumber(text: string, pattern: RegExp): number | undefined {
  const match = text.match(pattern);
  return match?.[1] !== undefined ? Number(match[1]) : undefined;
}

/** One pattern per runner: bun, vitest, jest, pytest, cargo, go. Capture group 1 is the test name. */
const FAILURE_PATTERNS: readonly RegExp[] = [
  /^\(fail\)\s+(.+)$/,
  /^(?:FAIL|×|✗|✕)\s+(.+?)(?:\s+\d+ms)?$/,
  /^●\s+(.+)$/,
  /^FAILED\s+(\S+)/,
  /^test\s+(.+?)\s+\.\.\.\s+FAILED$/,
  /^--- FAIL:\s+(\S+)/,
];

function testFailures(text: string): string[] {
  const names: string[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("●") && /Console|Test suite failed/i.test(trimmed)) continue;
    for (const pattern of FAILURE_PATTERNS) {
      const name = trimmed
        .match(pattern)?.[1]
        ?.replace(/\s*\[[\d.]+m?s\]\s*$/, "")
        .trim();
      if (name === undefined) continue;
      if (name && !names.includes(name)) names.push(name);
      break;
    }
  }
  return names.slice(0, 4);
}

function summarizeTests(text: string, success: boolean): CommandSummary | null {
  const failed =
    firstNumber(text, /(\d+)\s+fail(?:ed|ures?)?\b/i) ??
    firstNumber(text, /Tests:\s+(\d+)\s+failed/i) ??
    firstNumber(text, /(\d+)\s+failed/i);
  const passed =
    firstNumber(text, /(\d+)\s+pass(?:ed)?\b/i) ??
    firstNumber(text, /Tests:\s+.*?(\d+)\s+passed/i) ??
    firstNumber(text, /test result: \w+\. (\d+) passed/i);
  if (failed === undefined && passed === undefined) return null;
  const parts: string[] = [];
  if (passed !== undefined) parts.push(`${passed} pass`);
  if (failed !== undefined && (failed > 0 || passed === undefined)) parts.push(`${failed} fail`);
  const anyFailed = (failed ?? 0) > 0 || !success;
  return {
    headline: parts.join(" · ") || (success ? "passed" : "failed"),
    tone: anyFailed ? "danger" : "success",
    failures: anyFailed ? testFailures(text) : [],
    kind: "test",
  };
}

function summarizeTypecheck(text: string, success: boolean): CommandSummary {
  const count = firstNumber(text, /Found (\d+) errors?/i) ?? (text.match(/error TS\d+/g)?.length || undefined);
  if (count) {
    const lines = text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => /error TS\d+/.test(line))
      .slice(0, 4)
      .map((line) => truncateText(line, 110));
    return {
      headline: `${count} type error${count === 1 ? "" : "s"}`,
      tone: "danger",
      failures: lines,
      kind: "typecheck",
    };
  }
  return {
    headline: success ? "no type errors" : "failed",
    tone: success ? "success" : "danger",
    failures: [],
    kind: "typecheck",
  };
}

function summarizeLint(text: string, success: boolean): CommandSummary {
  const problems =
    firstNumber(text, /Found (\d+) errors?/i) ??
    firstNumber(text, /✖\s+(\d+)\s+problems?/i) ??
    firstNumber(text, /(\d+) errors?/i);
  const checked = firstNumber(text, /Checked (\d+) files?/i);
  if (problems) {
    return { headline: `${problems} problem${problems === 1 ? "" : "s"}`, tone: "danger", failures: [], kind: "lint" };
  }
  return {
    headline: success ? (checked ? `${checked} files clean` : "clean") : "failed",
    tone: success ? "success" : "danger",
    failures: [],
    kind: "lint",
  };
}

/** The last `count` non-empty output lines, trimmed to a readable width. */
export function outputTail(rawOutput: string, count = 8): string[] {
  return stripAnsi(rawOutput)
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() && !/^(STDERR|STDOUT):?$/i.test(line.trim()))
    .slice(-count)
    .map((line) => (line.length > 160 ? `${line.slice(0, 159)}…` : line));
}

function lastUsefulLine(text: string): string {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !/^(STDERR|STDOUT):?$/i.test(line));
  return lines.at(-1) ?? "";
}

/**
 * Reduces a command's raw output to the fact a reader wants first. Falls back to the exit state
 * when the output is not a recognised runner, and never reports a pass for a failed command.
 */
export function summarizeCommandResult(command: string, rawOutput: string, success: boolean): CommandSummary {
  const text = stripAnsi(rawOutput).replace(/\r/g, "");
  const kind = classifyCommand(command);
  let summary: CommandSummary | null = null;
  try {
    if (kind === "test") summary = summarizeTests(text, success);
    else if (kind === "typecheck") summary = summarizeTypecheck(text, success);
    else if (kind === "lint") summary = summarizeLint(text, success);
  } catch {
    summary = null;
  }
  if (summary) return summary;

  if (success) {
    const tail = truncateText(lastUsefulLine(text), 80);
    const quiet = /^Command executed successfully/i.test(tail);
    return { headline: quiet || !tail ? "ok" : tail, tone: "success", failures: [], kind };
  }
  const exit = firstNumber(text, /exit(?:ed with)? code:?\s*(\d+)/i);
  const tail = truncateText(lastUsefulLine(text), 100);
  return {
    headline: exit !== undefined ? `exit ${exit}` : "failed",
    tone: "danger",
    failures: tail ? [tail] : [],
    kind,
  };
}

function groupFor(name: string, command: string, path: string): ActivityGroup {
  switch (name) {
    case "read_file":
      return skillNameFromPath(path) ? "load" : "explore";
    case "grep":
    case "lsp":
      return "explore";
    case "search_web":
    case "search_x":
    case "open_web":
      return "research";
    case "write_file":
    case "edit_file":
    case "delete_file":
      return "change";
    case "bash":
      return isVerificationCommand(command) ? "verify" : "command";
    case "generate_plan":
      return "plan";
    case "task":
    case "delegate":
      return "agent";
    default:
      return name.startsWith("memory_") ? "memory" : "command";
  }
}

/** Past-tense, evidence-carrying row for a finished tool call. Null for calls with no user value. */
export function describeToolResult(
  toolCall: ToolCall,
  result: ToolResult,
  options: { id?: string; durationMs?: number } = {},
): ActivityRowModel | null {
  const name = toolCall.function.name;
  if (name === "update_plan_step") return null;
  const id = options.id ?? toolCall.id;
  const command = name === "bash" ? arg(toolCall, "command") : "";
  const duration = options.durationMs !== undefined ? formatDuration(options.durationMs) : undefined;
  const failedText = truncateText(result.error || result.output || "failed", 140);
  const path = name === "read_file" ? arg(toolCall, "path") : "";
  const base = { id, group: groupFor(name, command, path), operation: name, lines: [] as string[] };

  switch (name) {
    case "read_file": {
      const skill = skillNameFromPath(path);
      if (skill) {
        return {
          ...base,
          tone: result.success ? "neutral" : "danger",
          verb: result.success ? "Loaded" : "Could not load",
          object: `skill ${skill}`,
          lines: result.success ? [] : [failedText],
        };
      }
      const phrase = describeToolCall(toolCall);
      return {
        ...base,
        tone: result.success ? "neutral" : "danger",
        verb: "Read",
        object: phrase.object,
        meta: duration,
        lines: result.success ? [] : [failedText],
      };
    }
    case "grep":
    case "lsp": {
      const phrase = describeToolCall(toolCall);
      const verb = name === "grep" ? "Searched for" : "Inspected";
      const object = name === "grep" ? phrase.object : `${arg(toolCall, "operation") || "symbols"} in ${phrase.object}`;
      return {
        ...base,
        tone: result.success ? "neutral" : "danger",
        verb,
        object,
        meta: duration,
        lines: result.success ? [] : [failedText],
      };
    }
    case "search_web":
    case "search_x":
    case "open_web": {
      const phrase = describeToolCall(toolCall);
      const verb = name === "open_web" ? "Read" : "Searched the web for";
      return {
        ...base,
        tone: result.success ? "neutral" : "danger",
        verb,
        object: phrase.object,
        meta: duration,
        lines: result.success ? [] : [failedText],
      };
    }
    case "write_file":
    case "edit_file":
    case "delete_file": {
      const path = shortenPath(result.diff?.filePath || arg(toolCall, "path"));
      const verb =
        name === "delete_file"
          ? "Deleted"
          : name === "write_file" && result.diff?.isNew !== false
            ? "Created"
            : "Edited";
      const verbFinal = name === "write_file" && result.diff && !result.diff.isNew ? "Rewrote" : verb;
      return {
        ...base,
        tone: result.success ? "success" : "danger",
        verb: result.success
          ? verbFinal
          : `Could not ${name === "delete_file" ? "delete" : name === "write_file" ? "write" : "edit"}`,
        object: path,
        meta: result.success && result.diff ? diffStat(result.diff) : duration,
        lines: result.success ? [] : [failedText],
        diff: result.success ? result.diff : undefined,
      };
    }
    case "bash": {
      if (result.backgroundProcess) {
        return {
          ...base,
          group: "command",
          tone: "neutral",
          verb: "Started",
          object: truncateText(command, MAX_OBJECT),
          meta: `process ${result.backgroundProcess.id}`,
          lines: [],
        };
      }
      const summary = summarizeCommandResult(
        command,
        result.success ? (result.output ?? "") : `${result.error ?? ""}\n${result.output ?? ""}`,
        result.success,
      );
      const metaParts = [summary.headline, duration].filter(Boolean);
      return {
        ...base,
        tone: summary.tone,
        verb: summary.kind === "generic" ? "Ran" : verbForKind(summary.kind, summary.tone),
        object: truncateText(command, MAX_OBJECT),
        meta: metaParts.join(" · "),
        lines: summary.failures,
        tail: outputTail(
          result.success
            ? (result.output ?? "")
            : `${result.error ?? ""}
${result.output ?? ""}`,
        ),
      };
    }
    case "generate_plan": {
      const steps = result.plan?.steps.length ?? 0;
      return {
        ...base,
        tone: result.success ? "neutral" : "danger",
        verb: result.success ? "Planned" : "Could not plan",
        object: result.plan?.title ? truncateText(result.plan.title, 60) : "",
        meta: steps > 0 ? `${steps} step${steps === 1 ? "" : "s"}` : undefined,
        lines: result.success ? [] : [failedText],
      };
    }
    case "task":
    case "delegate": {
      const agent = result.task?.agent || result.delegation?.agent || arg(toolCall, "agent") || "agent";
      const description = result.task?.description || result.delegation?.description || arg(toolCall, "description");
      const running = name === "delegate" && result.delegation?.status === "running";
      return {
        ...base,
        tone: result.success ? "neutral" : "danger",
        verb: result.success ? (running ? "Started background agent" : `${agent} finished`) : `${agent} failed`,
        object: truncateText(description, 60),
        meta: duration,
        lines: result.success ? (result.task?.summary ? [truncateText(result.task.summary, 140)] : []) : [failedText],
      };
    }
    default:
      return null;
  }
}

function verbForKind(kind: CommandSummary["kind"], tone: ActivityTone): string {
  const ok = tone !== "danger";
  switch (kind) {
    case "test":
      return ok ? "Tests passed" : "Tests failed";
    case "typecheck":
      return ok ? "Types checked" : "Type check failed";
    case "lint":
      return ok ? "Lint passed" : "Lint failed";
    case "build":
      return ok ? "Built" : "Build failed";
    case "install":
      return ok ? "Installed" : "Install failed";
    default:
      return "Ran";
  }
}

/** A collapsed line for a run of same-group rows: "Read 3 files · searched 1 pattern". */
export function summarizeGroup(rows: readonly ActivityRowModel[]): { title: string; tone: ActivityTone } {
  const group = rows[0]?.group ?? "command";
  const failed = rows.filter((row) => row.tone === "danger").length;
  const tone: ActivityTone = failed > 0 ? "danger" : group === "change" || group === "verify" ? "success" : "neutral";
  const count = (verb: string) => rows.filter((row) => row.verb === verb).length;
  const plural = (n: number, singular: string, pluralForm = `${singular}s`) =>
    `${n} ${n === 1 ? singular : pluralForm}`;

  switch (group) {
    case "explore": {
      const reads = count("Read");
      const searches = rows.length - reads;
      const parts = [
        reads > 0 ? `Read ${plural(reads, "file")}` : "",
        searches > 0 ? `${reads > 0 ? "searched" : "Searched"} ${plural(searches, "pattern")}` : "",
      ].filter(Boolean);
      return { title: parts.join(" · ") || "Explored", tone };
    }
    case "research":
      return { title: `Researched ${plural(rows.length, "source")}`, tone };
    case "change": {
      const files = new Set(rows.map((row) => row.object)).size;
      const deleted = count("Deleted");
      const created = count("Created");
      if (deleted > 0 && deleted === rows.length) return { title: `Deleted ${plural(deleted, "file")}`, tone };
      if (created > 0 && created === rows.length) return { title: `Created ${plural(files, "file")}`, tone };
      return { title: `Changed ${plural(files, "file")}`, tone };
    }
    case "verify":
    case "command": {
      const only = rows.length === 1 ? rows[0] : undefined;
      if (only)
        return { title: only.verb === "Ran" ? `Ran ${only.object}` : `${only.verb} · ${only.object}`, tone: only.tone };
      return { title: `Ran ${plural(rows.length, "command")}`, tone };
    }
    case "plan":
      return { title: rows[0]?.object ? `Planned · ${rows[0].object}` : "Planned", tone };
    case "agent":
      return { title: rows[0] ? `${rows[0].verb}${rows[0].object ? ` · ${rows[0].object}` : ""}` : "Agent", tone };
    case "memory":
      return { title: "Updated project memory", tone };
    case "load": {
      const skills = rows.filter((row) => row.verb === "Loaded").map((row) => row.object.replace(/^skill /, ""));
      const parts = [
        skills.length > 0 ? `Loaded ${skills.length === 1 ? "skill" : "skills"} ${skills.join(", ")}` : "",
        ...rows.filter((row) => row.verb !== "Loaded").map((row) => `${row.verb} ${row.object}`.trim()),
      ].filter(Boolean);
      return { title: parts.join(" · ") || "Loaded", tone };
    }
  }
}

export interface ErrorExplanation {
  title: string;
  /** What the user can do next; never blame, always an action. */
  hint: string;
}

/** Turns a provider or runtime failure into a title and a next step. Matches on the message only. */
export function explainError(message: string): ErrorExplanation {
  if (/\b429\b|rate.?limit|too many requests|quota/i.test(message)) {
    return {
      title: "Rate limited",
      hint: "Free models queue under load. Retry in a moment, or choose another model with /models.",
    };
  }
  if (/\b40[13]\b|unauthori[sz]ed|invalid api key|forbidden|api key/i.test(message)) {
    return { title: "Authentication failed", hint: "Check your API key, then retry." };
  }
  if (/timed? ?out|timeout|ETIMEDOUT|no response|stalled|idle/i.test(message)) {
    return { title: "The model timed out", hint: "Retry with ↑ then enter, or choose a faster model with /models." };
  }
  if (/ECONN|ENOTFOUND|EAI_AGAIN|fetch failed|network|offline/i.test(message)) {
    return { title: "Can't reach the provider", hint: "Check your connection, then retry with ↑ then enter." };
  }
  if (/context (?:length|window)|too long|maximum context|token limit/i.test(message)) {
    return { title: "The context is full", hint: "Start a fresh session with /new, or ask for a smaller step." };
  }
  return { title: "Request failed", hint: "Retry with ↑ then enter." };
}
