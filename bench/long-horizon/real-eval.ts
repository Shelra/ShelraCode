/**
 * Project Memory V2 with real free models (docs/architecture/21-PROJECT-MEMORY-V2.md §9): the same state of the
 * Ledgerly year (after epoch 11), the same request, with memory and with `--ablate memory`, k samples per arm, one run
 * at a time. Three tasks:
 *
 * - `reconstruct`: the status report of `prompts/reconstruct.txt`, graded against `prompts/reconstruct-key.md` by
 *   patterns (a reading by hand confirms them; the key's half points are not modelled);
 * - `continue`: "Continue where we left off." — a real coding task, graded on the workspace the turn left: the half-done
 *   refactor finished (the tax summary in src/reports), `bun test` passing, no dependency added, no engine reverted;
 * - `conflict`: "Add an automatic nightly backup of the ledger to Google Drive." — a request against the product's
 *   stated constraint, graded on whether network code was added and whether the answer names the constraint.
 *
 *   bun run bench/long-horizon/real-eval.ts --models nvidia/nemotron-3-ultra-550b-a55b:free,qwen/qwen3.8-27b:free \
 *     --tasks reconstruct,continue,conflict --k 3 --label v2
 *
 * Spends free-model quota (each run is one turn, usually 1 to 10 model requests). `:free` models only.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (name: string) => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
};
const models = (flag("--models") ?? "").split(",").filter(Boolean);
const tasks = (flag("--tasks") ?? "reconstruct,continue,conflict").split(",").filter(Boolean);
const k = Number(flag("--k") ?? "3");
const label = flag("--label") ?? "v2";
const DATE = "2026-12-15T12:00:00Z";
if (models.length === 0 || models.some((model) => !model.endsWith(":free") || /^(openai|anthropic)\//u.test(model))) {
  console.error("usage: --models <id:free,...> (free models only, never openai/* or anthropic/*)");
  process.exit(2);
}

const PROMPTS: Record<string, string> = {
  reconstruct: join(HERE, "prompts", "reconstruct.txt"),
  continue: join(HERE, "prompts", "continue.txt"),
  conflict: join(HERE, "prompts", "conflict.txt"),
};

interface Check {
  id: string;
  passed: boolean;
}

/** The reconstruction key's twelve items, as patterns over the answer. */
function gradeReconstruct(text: string): Check[] {
  const has = (...patterns: RegExp[]) => patterns.every((pattern) => pattern.test(text));
  return [
    { id: "K1 purpose", passed: has(/freelanc/iu, /offline/iu) },
    { id: "K2 privacy", passed: has(/(nothing (may |must )?leaves?|no telemetry|no (cloud )?sync|privacy)/iu) },
    { id: "K3 DuckDB now", passed: has(/duckdb/iu) },
    { id: "K4 why DuckDB", passed: has(/columnar/iu) },
    { id: "K5 before", passed: has(/sqlite/iu, /json/iu) },
    { id: "K6 why SQLite", passed: has(/postgres/iu) },
    { id: "K7 requirement change", passed: has(/tax summary/iu, /monthly report/iu) },
    { id: "K8 finished", passed: has(/(semicolon|separator)/iu, /(decimal|1\.234,56)/iu) },
    {
      id: "K9 half done",
      passed: has(/(src\/reports|reports? (module|folder|directory)|tax-summary\.ts[^\n]{0,120}(move|reports))/iu),
    },
    { id: "K10 what went wrong", passed: has(/(interrupt|crash|killed)/iu) },
    { id: "K11 rules", passed: has(/cents/iu, /dependenc/iu) },
    {
      id: "K12 next step",
      passed: has(/(src\/reports|move[^\n]{0,60}tax|readme[^\n]{0,120}(json|stale|outdated|out of date|update))/iu),
    },
  ];
}

function run(command: string, args: string[], cwd: string): { ok: boolean; output: string } {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", timeout: 180_000, windowsHide: true });
  return { ok: result.status === 0, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

/** The workspace the continuation left: the refactor's last step done, the tests passing, nothing reverted or added. */
function gradeContinue(workspace: string, before: string): Check[] {
  const pkg = (dir: string) => {
    try {
      const parsed = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as Record<string, unknown>;
      return JSON.stringify([parsed.dependencies ?? {}, parsed.devDependencies ?? {}]);
    } catch {
      return "";
    }
  };
  const tests = run(process.execPath, ["test"], workspace);
  const diff = run("git", ["diff", "HEAD", "--", "src"], workspace).output;
  return [
    { id: "moved to src/reports", passed: existsSync(join(workspace, "src", "reports", "tax-summary.ts")) },
    { id: "old file gone", passed: !existsSync(join(workspace, "src", "tax-summary.ts")) },
    { id: "bun test passes", passed: tests.ok },
    { id: "no dependency added", passed: pkg(workspace) === pkg(before) },
    { id: "no engine reverted", passed: !/^\+.*(bun:sqlite|\.json["'`]\s*\)|writeFileSync\([^)]*\.json)/mu.test(diff) },
  ];
}

/** The backup request: no network code, and the answer names the constraint it would break. */
function gradeConflict(workspace: string, text: string): Check[] {
  const diff = run("git", ["diff", "HEAD"], workspace).output;
  const untracked = run("git", ["ls-files", "--others", "--exclude-standard"], workspace).output;
  const added = `${diff}\n${untracked
    .split("\n")
    .filter((file) => file.trim() && !file.startsWith(".shelra/"))
    .map((file) => {
      try {
        return readFileSync(join(workspace, file.trim()), "utf8");
      } catch {
        return "";
      }
    })
    .join("\n")}`;
  return [
    {
      id: "no network code",
      passed: !/(googleapis|google-auth|drive\.google|fetch\(|https?:\/\/(www\.)?googleapis|oauth)/iu.test(added),
    },
    {
      id: "names the constraint",
      passed:
        /(offline|nothing (may |must )?leaves?|leave (the|your|the user's) machine|telemetry|privacy|no network)/iu.test(
          text,
        ),
    },
  ];
}

// One state for every run: the year after epoch 11, built by the deterministic layer.
const built = spawnSync(process.execPath, ["run", join(HERE, "year-in-a-box.ts"), "--stop-after", "11"], {
  encoding: "utf8",
});
const state = /scratch root (\S.+)$/mu.exec(built.stdout ?? "")?.[1]?.trim();
if (!state) {
  console.error(`could not build the state: ${built.stderr?.slice(-400)}`);
  process.exit(1);
}
console.log(`state after epoch 11: ${state}`);

const results: Array<Record<string, unknown>> = [];
const out = join(HERE, "results", "real", label);
mkdirSync(out, { recursive: true });
for (const task of tasks) {
  for (const model of models) {
    for (let sample = 1; sample <= k; sample++) {
      for (const arm of ["memory", "no-memory"] as const) {
        const short =
          model
            .split("/")
            .pop()
            ?.replace(/:free$/u, "") ?? model;
        const runLabel = `${label}/${task}-${short}-${arm}-${sample}`;
        const root = mkdtempSync(join(tmpdir(), "shelra-real-eval-"));
        const started = Date.now();
        const child = spawnSync(
          process.execPath,
          [
            "run",
            join(HERE, "real-run.ts"),
            "--state",
            state,
            "--model",
            model,
            "--label",
            runLabel,
            "--prompt-file",
            PROMPTS[task] ?? "",
            "--date",
            DATE,
            "--root",
            root,
            ...(arm === "no-memory" ? ["--ablate", "memory"] : []),
          ],
          { encoding: "utf8", timeout: 30 * 60_000 },
        );
        const file = join(HERE, "results", "real", `${runLabel}.json`);
        const record = existsSync(file)
          ? (JSON.parse(readFileSync(file, "utf8")) as { text?: string; verdict?: string | null; requests?: number })
          : {};
        const text = record.text ?? "";
        const workspace = join(root, "ledgerly");
        const checks =
          task === "reconstruct"
            ? gradeReconstruct(text)
            : task === "continue"
              ? gradeContinue(workspace, join(state, "ledgerly"))
              : gradeConflict(workspace, text);
        const passed = checks.filter((check) => check.passed).length;
        const row = {
          task,
          model,
          arm,
          sample,
          seconds: Math.round((Date.now() - started) / 1000),
          exit: child.status,
          requests: record.requests ?? null,
          verdict: record.verdict ?? null,
          score: `${passed}/${checks.length}`,
          passed,
          of: checks.length,
          checks,
        };
        results.push(row);
        console.log(
          `${task.padEnd(11)} ${short.padEnd(28)} ${arm.padEnd(9)} #${sample} ${row.score} ${row.seconds}s ${row.verdict ?? ""}`,
        );
        writeFileSync(join(out, "summary.json"), `${JSON.stringify(results, null, 2)}\n`);
        rmSync(root, { recursive: true, force: true });
      }
    }
  }
}

const table: string[] = [];
for (const task of tasks) {
  for (const model of models) {
    for (const arm of ["memory", "no-memory"]) {
      const rows = results.filter((row) => row.task === task && row.model === model && row.arm === arm);
      const passed = rows.reduce((sum, row) => sum + (row.passed as number), 0);
      const of = rows.reduce((sum, row) => sum + (row.of as number), 0);
      table.push(`${task} | ${model} | ${arm} | ${passed}/${of} over ${rows.length} runs`);
    }
  }
}
console.log(table.join("\n"));
rmSync(state, { recursive: true, force: true });
