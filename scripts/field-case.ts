/**
 * Field cases (bench/field/README.md): real problems people brought to Shelra.
 *
 *   bun run scripts/field-case.ts session <id>                 metrics of a saved session, as JSON
 *   bun run scripts/field-case.ts board [--write]              the scoreboard from bench/field/cases
 *   bun run scripts/field-case.ts rerun <case-id> [--model m]  the case's prompt again, headless
 *
 * The session database is opened read-only, and every text that leaves this script has the home
 * folder, the user name and the machine name removed: the repository is public.
 */
import { Database } from "bun:sqlite";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, hostname, tmpdir, userInfo } from "node:os";
import { join, resolve } from "node:path";
import { localDateStamp } from "../src/agent/prompt-date";
import { type FieldCase, type FieldRun, redact, renderScoreboard, summarizeTurns } from "../src/bench/field-cases";
import { getProductUserDir } from "../src/product/identity";

const root = resolve(import.meta.dir, "..");
const casesDir = join(root, "bench", "field", "cases");
const identity = { home: homedir(), user: userInfo().username, host: hostname() };
const clean = (text: string) => redact(text, identity);
const excerpt = (text: string, length = 240) => clean(text.replace(/\s+/gu, " ").trim()).slice(0, length);

function openSessions(): Database {
  return new Database(join(getProductUserDir(), "shelra.db"), { readonly: true });
}

function textOf(messageJson: string): string {
  const message = JSON.parse(messageJson) as { content?: unknown };
  if (typeof message.content === "string") return message.content;
  if (!Array.isArray(message.content)) return "";
  return message.content
    .flatMap((part: { type?: string; text?: string }) => (part.type === "text" && part.text ? [part.text] : []))
    .join("\n");
}

function sessionMetrics(id: string) {
  const db = openSessions();
  try {
    const session = db
      .query("select id, model, cwd_at_start as cwd, created_at as createdAt from sessions where id like ?")
      .get(`${id}%`) as { id: string; model: string; cwd: string; createdAt: string } | null;
    if (!session) throw new Error(`No saved session starts with ${id}.`);
    const messages = (
      db
        .query("select seq, role, message_json as json, created_at as createdAt from messages where session_id = ?")
        .all(session.id) as Array<{ seq: number; role: string; json: string; createdAt: string }>
    ).map((row) => ({ seq: row.seq, role: row.role, text: textOf(row.json), createdAt: row.createdAt }));
    const toolCalls = db
      .query("select message_seq as messageSeq from tool_calls where session_id = ?")
      .all(session.id) as Array<{ messageSeq: number }>;
    const usage = db
      .query(
        "select sum(input_tokens) as input, sum(output_tokens) as output, sum(cost_micros) as costMicros from usage_events where session_id = ?",
      )
      .get(session.id) as { input: number | null; output: number | null; costMicros: number | null };
    const turns = summarizeTurns(messages, toolCalls);
    return { session, turns, usage };
  } finally {
    db.close();
  }
}

function sessionCommand(id: string): void {
  const { session, turns, usage } = sessionMetrics(id);
  const first = turns[0];
  // Rounds are saved when they complete, so the first answer's time is real; the request's own
  // time is not saved, and the session's creation stands in for it.
  const seconds =
    first?.firstAnswerAt !== undefined
      ? Math.round((Date.parse(first.firstAnswerAt) - Date.parse(session.createdAt)) / 1_000)
      : undefined;
  const run: FieldRun = {
    date: localDateStamp(new Date(session.createdAt)),
    model: session.model,
    cost: (usage.costMicros ?? 0) > 0 ? "paid" : session.model.includes("/") ? "free" : "local",
    session: session.id,
    seconds,
    secondsApprox: true,
    toolCalls: first?.toolCallsBeforeFirstAnswer,
    gateLoops: first?.gateLoops,
    result: excerpt(first?.firstAnswer ?? ""),
  };
  const report = {
    prompt: clean(first?.prompt ?? ""),
    setting: clean(session.cwd),
    shelra: run,
    turns: turns.map((turn) => ({
      prompt: excerpt(turn.prompt, 120),
      toolCalls: turn.toolCalls,
      gateLoops: turn.gateLoops,
      firstAnswer: excerpt(turn.firstAnswer, 160),
    })),
    tokens: { input: usage.input ?? 0, output: usage.output ?? 0 },
  };
  console.log(JSON.stringify(report, null, 2));
}

function loadCases(): FieldCase[] {
  return readdirSync(casesDir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => JSON.parse(readFileSync(join(casesDir, name), "utf8")) as FieldCase);
}

function boardCommand(write: boolean): void {
  const board = renderScoreboard(loadCases());
  if (write) {
    writeFileSync(join(root, "bench", "field", "SCOREBOARD.md"), board.replace(/\n/gu, "\r\n"));
    console.log("Wrote bench/field/SCOREBOARD.md");
  } else {
    process.stdout.write(board);
  }
}

/** The harness commit, marked `-dirty` when tracked files have changes it does not hold. */
function currentCommit(): string | undefined {
  const result = spawnSync("git", ["-C", root, "rev-parse", "--short", "HEAD"], { encoding: "utf8" });
  if (result.status !== 0) return undefined;
  const changes = spawnSync("git", ["-C", root, "status", "--porcelain", "--untracked-files=no"], { encoding: "utf8" });
  return `${result.stdout.trim()}${changes.stdout.trim() ? "-dirty" : ""}`;
}

function rerunCommand(caseId: string, model: string | undefined): void {
  const item = loadCases().find((candidate) => candidate.id === caseId || candidate.id.startsWith(`${caseId}-`));
  if (!item) throw new Error(`No field case ${caseId} in bench/field/cases.`);
  const chosen = model ?? item.shelra.model;
  // Taken before the run: a commit made while it runs is not the harness it used.
  const commit = currentCommit();
  // Never the user's own folders: the prompt runs in a fresh temporary folder.
  const workspace = mkdtempSync(join(tmpdir(), `shelra-field-${item.id}-`));
  if (item.workspace?.repository === "self") {
    // A clone at the case's commit, never the working copy, and with no remote to push back to.
    for (const args of [
      ["clone", "--quiet", "--no-checkout", root, workspace],
      ["-C", workspace, "checkout", "--quiet", item.workspace.commit],
      ["-C", workspace, "remote", "remove", "origin"],
    ]) {
      const step = spawnSync("git", args, { encoding: "utf8" });
      if (step.status !== 0) throw new Error(`Could not prepare the workspace: git ${args[0]}: ${step.stderr.trim()}`);
    }
  }
  const cli = spawnSync(
    "bun",
    ["run", join(root, "src", "index.ts"), "-d", workspace, "--model", chosen, "--format", "json", "-p", item.prompt],
    { cwd: workspace, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const events = cli.stdout
    .split("\n")
    .filter((line) => line.trim().startsWith("{"))
    .map((line) => JSON.parse(line) as { type: string; timestamp?: number; text?: string; sessionID?: string });
  const times = events.map((event) => event.timestamp).filter((time): time is number => typeof time === "number");
  const texts = events.filter((event) => event.type === "text" && event.text);
  const sessionId = events.find((event) => event.sessionID)?.sessionID;
  const turn = sessionId ? sessionMetrics(sessionId).turns[0] : undefined;
  const run: FieldRun = {
    date: localDateStamp(),
    commit,
    model: chosen,
    cost: chosen.endsWith(":free") || chosen === "openrouter/free" ? "free" : chosen.includes("/") ? "paid" : "local",
    session: sessionId,
    seconds: times.length > 1 ? Math.round((Math.max(...times) - Math.min(...times)) / 1_000) : undefined,
    toolCalls: events.filter((event) => event.type === "tool_use").length,
    gateLoops: turn?.gateLoops,
    result: excerpt(texts.at(-1)?.text ?? `no answer (exit ${cli.status})`),
  };
  console.log(JSON.stringify(run, null, 2));
  console.error(`Judge the answer, set "solved", and add the run to ${item.id}.json under "reruns".`);
}

const [command, ...rest] = process.argv.slice(2);
const option = (name: string) => {
  const index = rest.indexOf(name);
  return index >= 0 ? rest[index + 1] : undefined;
};

try {
  if (command === "session" && rest[0]) sessionCommand(rest[0]);
  else if (command === "board") boardCommand(rest.includes("--write"));
  else if (command === "rerun" && rest[0]) rerunCommand(rest[0], option("--model"));
  else {
    console.error(
      "Usage: bun run scripts/field-case.ts session <id> | board [--write] | rerun <case-id> [--model <id>]",
    );
    process.exitCode = 2;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
