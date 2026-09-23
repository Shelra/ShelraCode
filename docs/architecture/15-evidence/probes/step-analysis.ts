// Where do a benchmark run's model steps go? Per task: tool calls by name, test runs, repeated reads,
// model requests, tokens and host nudges, from the session database of the run's HOME.
// Usage: bun step-analysis.ts <shelra.db> <suite label>
import { Database } from "bun:sqlite";

const [dbPath, suite] = process.argv.slice(2);
const db = new Database(dbPath as string, { readonly: true });
const run = db
  .query("select id from benchmark_runs where benchmark_suite = ? order by created_at desc limit 1")
  .get(suite) as { id: string } | undefined;
if (!run) throw new Error(`no run labelled ${suite}`);
const sessions = db
  .query("select id, cwd_at_start as cwd, created_at from sessions where cwd_at_start like ? order by created_at")
  .all(`%${run.id}%`) as Array<{ id: string; cwd: string; created_at: string }>;

const TEST_RE = /\b(?:bun|npm|pnpm|yarn)\s+(?:run\s+)?test\b|\bbun\s+test\b|\bvitest\b|\bjest\b|\bpytest\b/u;
const totals: Record<string, number> = {};
const rows: string[] = [];
for (const session of sessions) {
  const task =
    session.cwd
      .replaceAll("\\", "/")
      .split("/")
      .pop()
      ?.replace(/-[0-9a-f]{8}$/u, "") ?? session.id;
  const calls = db.query("select tool_name, args_json from tool_calls where session_id = ?").all(session.id) as Array<{
    tool_name: string;
    args_json: string;
  }>;
  const byTool: Record<string, number> = {};
  const reads = new Map<string, number>();
  let testRuns = 0;
  for (const call of calls) {
    byTool[call.tool_name] = (byTool[call.tool_name] ?? 0) + 1;
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(call.args_json) as Record<string, unknown>;
    } catch {
      // unreadable arguments
    }
    if (call.tool_name === "read_file" && typeof args.path === "string") {
      reads.set(args.path, (reads.get(args.path) ?? 0) + 1);
    }
    if (call.tool_name === "bash" && typeof args.command === "string" && TEST_RE.test(args.command)) testRuns += 1;
  }
  const usage = db
    .query(
      "select source, count(*) as n, sum(total_tokens) as tokens from usage_events where session_id = ? group by source",
    )
    .all(session.id) as Array<{ source: string; n: number; tokens: number | null }>;
  const requests = usage.reduce((sum, row) => sum + row.n, 0);
  const tokens = usage.reduce((sum, row) => sum + (row.tokens ?? 0), 0);
  const messages = db.query("select role, message_json from messages where session_id = ?").all(session.id) as Array<{
    role: string;
    message_json: string;
  }>;
  const hostTurns = messages.filter((message) => message.role === "user").slice(1);
  const nudges = hostTurns.filter((message) => /Completion blocked/iu.test(message.message_json)).length;
  const audits = hostTurns.filter((message) => /audit the request requirement/iu.test(message.message_json)).length;
  const interruptions = hostTurns.filter((message) =>
    /connection to the model was interrupted|no response within the time limit/iu.test(message.message_json),
  ).length;
  const repeatedReads = [...reads.values()].reduce((sum, n) => sum + Math.max(0, n - 1), 0);
  const tools = Object.entries(byTool)
    .sort((a, b) => b[1] - a[1])
    .map(([name, n]) => `${name}:${n}`)
    .join(" ");
  rows.push(
    `| ${task} | ${calls.length} | ${requests} | ${testRuns} | ${reads.size}/${repeatedReads} | ${nudges} | ${audits} | ${interruptions} | ${Math.round(tokens / 1000)}k | ${tools} |`,
  );
  for (const [key, value] of Object.entries({
    calls: calls.length,
    requests,
    testRuns,
    reads: [...reads.values()].reduce((a, b) => a + b, 0),
    repeatedReads,
    nudges,
    audits,
    interruptions,
    tokens,
  }))
    totals[key] = (totals[key] ?? 0) + value;
  for (const row of usage) totals[`requests:${row.source}`] = (totals[`requests:${row.source}`] ?? 0) + row.n;
}
console.log(`## ${suite} (${sessions.length} tasks)`);
console.log(
  "| Task | Tool calls | Model requests | Test runs | Files read / repeated reads | Gate nudges | Requirement audits | Provider interruptions | Tokens | Tools |",
);
console.log("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
for (const row of rows) console.log(row);
console.log("totals:", JSON.stringify(totals));
