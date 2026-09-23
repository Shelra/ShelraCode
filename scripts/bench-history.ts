/**
 * Benchmark history (bench/history/README.md): every benchmark run and field case in one versioned
 * JSON file, so growth, regressions and comparisons with other agents stay on record.
 *
 *   bun run scripts/bench-history.ts import --db <shelra.db> [--db <other.db>] [--source <label>]
 *   bun run scripts/bench-history.ts summary
 *
 * `import` opens each session database read-only and merges its benchmark runs, and the field cases
 * from bench/field/cases, into bench/history/benchmark-history.json by run id (src/bench/history.ts).
 * `shelra bench` does the same for its own runs when it finishes.
 */
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { appendRunsToHistory, loadHistory } from "../src/bench/history";

const root = resolve(import.meta.dir, "..");
// A benchmark run under a scratch home still records paths under the real one; redact both.
const extraHomes = [process.env.SHELRA_REDACT_HOME, process.env.AUDIT_REAL_USERPROFILE];

function importCommand(args: string[]): void {
  const dbs: string[] = [];
  let source = "shelra-db";
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--db" && args[index + 1]) dbs.push(args[++index] as string);
    else if (args[index] === "--source" && args[index + 1]) source = args[++index] as string;
  }
  if (dbs.length === 0) dbs.push(join(homedir(), ".shelra", "shelra.db"));
  let added = 0;
  let replaced = 0;
  let result: ReturnType<typeof appendRunsToHistory> | null = null;
  for (const databasePath of dbs) {
    result = appendRunsToHistory({ repositoryRoot: root, databasePath, source, extraHomes });
    added += result.added;
    replaced += result.replaced;
  }
  if (result) {
    console.log(
      `${basename(result.historyPath)}: ${result.runs} runs (${added} new, ${replaced} updated), ${result.fieldCases} field cases`,
    );
  }
}

function summaryCommand(): void {
  const history = loadHistory(join(root, "bench", "history", "benchmark-history.json"));
  for (const run of history.runs) {
    const config = run.agent.config as { ablation?: string } | null;
    const ablation = config?.ablation && config.ablation !== "none" ? ` [${config.ablation}]` : "";
    console.log(
      [
        run.createdAt.slice(0, 16),
        `${run.agent.name}${ablation}`.padEnd(22),
        (run.model ?? "?").padEnd(52),
        run.suite.padEnd(34),
        `${run.tasks.resolved}/${run.tasks.total}`.padEnd(6),
        run.status,
      ].join("  "),
    );
  }
}

const [command, ...rest] = process.argv.slice(2);
if (command === "import") importCommand(rest);
else if (command === "summary") summaryCommand();
else {
  console.error("Usage: bun run scripts/bench-history.ts import [--db <path>]... [--source <label>] | summary");
  process.exitCode = 1;
}
