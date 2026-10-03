/**
 * Project memory evaluations (docs/architecture/21-PROJECT-MEMORY-V2.md): the brief's named tests, each a few scripted
 * sessions through the real `Agent.processMessage` in fresh processes (`session.ts`), scored on what reached the
 * model's first request of the session that needs the memory. Deterministic; no network, no model quota.
 *
 *   bun run bench/long-horizon/memory-evals.ts                 # every eval → results/memory-evals-<label>.json
 *   bun run bench/long-horizon/memory-evals.ts --label before  # name the run
 *   bun run bench/long-horizon/memory-evals.ts cold-start-project-recall stale-document-detection
 *
 * The scripted model is ideal for whichever memory prompt the agent asks (the reflection of memory v1 or the memory
 * commit of v2), so a difference between runs is the harness's.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { redactPaths } from "./redact";
import { requestText, type ScriptStep, type SessionSpec, spawnSession } from "./session";

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const labelIndex = argv.indexOf("--label");
const label = labelIndex >= 0 ? (argv[labelIndex + 1] ?? "run") : "run";
const wanted = argv.filter((arg, index) => !arg.startsWith("--") && argv[index - 1] !== "--label");

interface Check {
  id: string;
  label: string;
  /** Every pattern must appear in the request. */
  all?: RegExp[];
  /** The request must not contain any of these (a forbidden fact). */
  none?: RegExp[];
  /** A custom test over the request text. */
  test?: (text: string) => boolean;
}

interface EvalResult {
  id: string;
  question: string;
  checks: Array<{ id: string; label: string; passed: boolean }>;
  passed: boolean;
  score: string;
  notes?: string;
  firstRequestChars?: number;
}

function judge(text: string, checks: Check[]): Array<{ id: string; label: string; passed: boolean }> {
  return checks.map((check) => ({
    id: check.id,
    label: check.label,
    passed:
      (check.all ?? []).every((pattern) => pattern.test(text)) &&
      !(check.none ?? []).some((pattern) => pattern.test(text)) &&
      (check.test ? check.test(text) : true),
  }));
}

function result(id: string, question: string, text: string, checks: Check[], notes?: string): EvalResult {
  const judged = judge(text, checks);
  const passedCount = judged.filter((check) => check.passed).length;
  return {
    id,
    question,
    checks: judged,
    passed: passedCount === judged.length,
    score: `${passedCount}/${judged.length}`,
    firstRequestChars: text.length,
    ...(notes ? { notes } : {}),
  };
}

/** A scratch root with a scratch HOME and one git project in it. */
function project(name: string, files: Record<string, string>): { root: string; workspace: string } {
  const root = mkdtempSync(join(tmpdir(), `shelra-memeval-${name}-`));
  const home = join(root, "home");
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, ".gitconfig"), "[user]\n\tname = Eval Owner\n\temail = owner@eval.invalid\n");
  addProject(root, name, files);
  return { root, workspace: name };
}

function addProject(root: string, name: string, files: Record<string, string>): void {
  const dir = join(root, name);
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), content);
  }
  const env = { ...process.env, HOME: join(root, "home"), USERPROFILE: join(root, "home") };
  spawnSync("git", ["init", "-q", "-b", "main"], { cwd: dir, env });
  spawnSync("git", ["add", "-A"], { cwd: dir, env });
  spawnSync("git", ["commit", "-q", "-m", "Start"], { cwd: dir, env });
}

function commitAll(root: string, workspace: string, message: string): void {
  const env = { ...process.env, HOME: join(root, "home"), USERPROFILE: join(root, "home") };
  spawnSync("git", ["add", "-A"], { cwd: join(root, workspace), env });
  spawnSync("git", ["commit", "-q", "-m", message], { cwd: join(root, workspace), env });
}

let captureCounter = 0;
/** Runs one session and returns the text of its first model request. */
async function session(
  root: string,
  workspace: string,
  spec: Partial<SessionSpec> & { user: string; date: string },
): Promise<string> {
  captureCounter += 1;
  const full: SessionSpec = {
    root,
    workspace,
    model: "eval-model",
    rounds: [],
    answer: "Done.",
    reflection: [],
    captureFile: join(root, `capture-${captureCounter}.json`),
    ...spec,
  };
  const { exit, result } = await spawnSession(full);
  if (exit !== "ok" && full.crashAfterTools === undefined) throw new Error(`session failed: ${exit}`);
  return requestText(result?.captures[0]);
}

/** A copy of a Year-in-a-Box state after the given epoch (the year's own script builds it). */
function yearState(after: number): string {
  const run = spawnSync(process.execPath, ["run", join(HERE, "year-in-a-box.ts"), "--stop-after", String(after)], {
    encoding: "utf8",
  });
  const match = /scratch root (\S.+)$/mu.exec(run.stdout ?? "");
  if (!match?.[1]) throw new Error(`year state failed: ${run.stderr?.slice(-400)}`);
  return match[1].trim();
}

const write = (path: string, content: string): ScriptStep => ({ tool: "write_file", input: { path, content } });
const bash = (command: string): ScriptStep => ({ tool: "bash", input: { command } });

/** A line that adopts an engine the year replaced ("Use SQLite instead of JSON files"), not one that drops it. */
const ADOPTS_REPLACED =
  /\buse\s+(?:sqlite|json\s+files?)\b|\b(?:stored?|storage)\s+(?:is|in|uses?)\s+(?:sqlite|json)\b/iu;

/** Standing-rule lines that state a superseded engine as current. */
function supersededAsCurrent(text: string): boolean {
  const start = text.indexOf("Standing rules");
  if (start < 0) return false;
  const block = text.slice(start).split("\n\n")[0] ?? "";
  return block.split("\n").some((line) => line.startsWith("- ") && ADOPTS_REPLACED.test(line));
}

const evals: Record<string, () => Promise<EvalResult>> = {
  async "cold-start-project-recall"() {
    const state = yearState(11);
    const question =
      "What is this project, what is its objective, which stack and architecture does it use, what did we complete recently, what are we building now, which decisions should I know, what should I not do, and what is the next unfinished objective?";
    const text = await session(state, "ledgerly", {
      user: question,
      date: "2026-12-15T12:00:00Z",
      model: "yib-model-b",
    });
    rmSync(state, { recursive: true, force: true });
    return result("cold-start-project-recall", question, text, [
      { id: "purpose", label: "offline expense tracker for freelancers", all: [/freelancer/iu, /offline/iu] },
      {
        id: "privacy",
        label: "nothing leaves the machine",
        all: [/(nothing (may )?leaves?|no telemetry|no network)/iu],
      },
      { id: "cents", label: "rule: integer cents", all: [/integer cents/iu] },
      { id: "deps", label: "rule: no dependency without asking", all: [/dependency/iu] },
      { id: "architecture", label: "active storage DuckDB", all: [/duckdb/iu] },
      { id: "rationale", label: "why DuckDB", all: [/columnar/iu] },
      { id: "scope", label: "tax summary replaced the monthly report", all: [/tax summary/iu, /monthly report/iu] },
      { id: "recent", label: "recent work: CSV separator", all: [/semicolon|separator/iu] },
      {
        id: "unfinished",
        label: "unfinished: the reports module",
        all: [/src\/reports|reports module|tax summary[^\n]{0,80}reports/iu],
      },
      {
        id: "failure",
        label: "known failure: decimal-comma amounts",
        all: [/1\.234,56|decimal comma|decimal-comma/iu],
      },
      {
        id: "obsolete",
        label: "SQLite named as obsolete",
        all: [
          /sqlite[^\n]{0,120}(superseded|replaced|obsolete|no longer|until|retired)|(superseded|replaced|obsolete|retired)[^\n]{0,120}sqlite/iu,
        ],
      },
      {
        id: "no-superseded-rule",
        label: "no superseded rule shown as current",
        test: (value) => !supersededAsCurrent(value),
      },
    ]);
  },

  async "cross-session-continuation"() {
    const state = yearState(8);
    const text = await session(state, "ledgerly", {
      user: "Continue.",
      date: "2026-10-20T12:00:00Z",
      model: "yib-model-b",
    });
    rmSync(state, { recursive: true, force: true });
    return result("cross-session-continuation", "Continue. (after the September crash)", text, [
      { id: "modules", label: "the refactor's target modules", all: [/src\/reports/iu] },
      {
        id: "progress",
        label: "what is done and what remains",
        all: [/(remain|pending|not started|to do)/iu, /src\/(domain|storage)/iu],
      },
      { id: "interrupted", label: "the interrupted turn", all: [/interrupted/iu] },
      { id: "half-done", label: "the half-moved importer", all: [/src\/importers\/csv\.ts/iu] },
      { id: "no-new-here", label: "no 'treat it as new' note", none: [/treat it as new here/iu] },
      { id: "repo-context", label: "repository context present", all: [/Git branch:|Recent commits:/u] },
    ]);
  },

  async "superseded-decision"() {
    const state = yearState(11);
    const text = await session(state, "ledgerly", {
      user: "Add a function that saves an expense to the ledger storage.",
      date: "2026-12-15T12:00:00Z",
      model: "yib-model-b",
    });
    rmSync(state, { recursive: true, force: true });
    return result("superseded-decision", "Add a function that saves an expense to the ledger storage.", text, [
      { id: "active", label: "DuckDB is the storage", all: [/duckdb/iu] },
      {
        id: "not-current",
        label: "SQLite never shown as a current rule",
        test: (value) => !supersededAsCurrent(value),
      },
    ]);
  },

  async "user-correction-retention"() {
    const files = {
      "package.json": JSON.stringify({ name: "invoices", type: "module", scripts: { test: "bun test" } }),
      "src/report.ts":
        "export interface Line { client: string; month: string; cents: number }\nexport function report(lines: Line[]): Record<string, number> {\n  return {};\n}\n",
      "test/report.test.ts":
        "import { expect, test } from 'bun:test';\nimport { report } from '../src/report';\ntest('empty', () => expect(report([])).toEqual({}));\n",
    };
    const { root, workspace } = project("invoices", files);
    const byMonth =
      "export interface Line { client: string; month: string; cents: number }\nexport function report(lines: Line[]): Record<string, number> {\n  const totals: Record<string, number> = {};\n  for (const line of lines) totals[line.month] = (totals[line.month] ?? 0) + line.cents;\n  return totals;\n}\n";
    const byClient = byMonth.replaceAll("line.month", "line.client");
    await session(root, workspace, {
      user: "Make the report total the invoice lines.",
      date: "2026-03-02T12:00:00Z",
      rounds: [[write("src/report.ts", byMonth), bash("bun test")]],
      answer: "The report totals the lines per month.",
    });
    commitAll(root, workspace, "Total the report");
    const correction = "That's not what I meant: the report must group the totals by client, never by month. Fix it.";
    await session(root, workspace, {
      user: correction,
      date: "2026-03-03T12:00:00Z",
      rounds: [[write("src/report.ts", byClient), bash("bun test")]],
      answer: "The report now totals per client.",
      reflection: [
        {
          type: "conventions",
          slug: "report-groups-by-client",
          title: "The report groups totals by client, never by month",
          hook: "report() in src/report.ts totals invoice lines per client; the user corrected a per-month version",
          description: "User correction about the report",
          body: "Totals are keyed by client. The user rejected grouping by month.",
          confidence: 0.9,
          relatedFiles: ["src/report.ts"],
          tags: ["report", "client", "correction"],
          quote: "the report must group the totals by client, never by month",
        },
      ],
    });
    commitAll(root, workspace, "Group the report by client");
    const text = await session(root, workspace, {
      user: "Add a grand total line to the report.",
      date: "2026-04-10T12:00:00Z",
    });
    rmSync(root, { recursive: true, force: true });
    return result(
      "user-correction-retention",
      "Add a grand total line to the report. (a month after the correction)",
      text,
      [{ id: "correction", label: "the correction: group by client", all: [/by client/iu] }],
    );
  },

  async "project-isolation"() {
    const files = {
      "package.json": JSON.stringify({ name: "alpha", type: "module", scripts: { test: "bun test" } }),
      "src/index.ts": "export const ok = true;\n",
    };
    const { root } = project("alpha", files);
    addProject(root, "beta", { ...files, "package.json": JSON.stringify({ name: "beta", type: "module" }) });
    await session(root, "alpha", {
      user: "We use DuckDB for storage. Note how this project stores data.",
      date: "2026-03-02T12:00:00Z",
      rounds: [
        [
          {
            tool: "memory_write",
            input: {
              slug: "storage-engine",
              title: "Storage is DuckDB",
              hook: "The ledger lives in data/ledger.duckdb",
              type: "architecture",
              description: "storage",
              body: "DuckDB file data/ledger.duckdb.",
              scope: "user",
            },
          },
        ],
      ],
    });
    const text = await session(root, "beta", {
      user: "Where does this project store its data?",
      date: "2026-03-03T12:00:00Z",
    });
    rmSync(root, { recursive: true, force: true });
    return result("project-isolation", "Project B asks where data is stored, after project A recorded DuckDB", text, [
      { id: "no-leak", label: "no fact of project A in project B", none: [/duckdb/iu] },
    ]);
  },

  async "documentation-retrieval"() {
    const files: Record<string, string> = {
      "package.json": JSON.stringify({ name: "apiclient", type: "module", scripts: { test: "bun test" } }),
      "README.md": "# apiclient\n\nA small HTTP client for the billing API.\n",
      "docs/SECURITY.md":
        "# Security rules\n\nAPI tokens must never be written to logs. Redact the Authorization header before a request is logged.\n",
      "docs/RELEASING.md": "# Releasing\n\nTag the commit and publish with bun publish.\n",
      "src/client.ts":
        "export async function get(url: string, token: string): Promise<Response> {\n  return fetch(url, { headers: { Authorization: `Bearer ${token}` } });\n}\n",
    };
    for (let index = 0; index < 45; index++)
      files[`src/endpoints/endpoint-${index}.ts`] = `export const path${index} = "/v1/${index}";\n`;
    const { root, workspace } = project("apiclient", files);
    // One earlier session, so the project has been worked on before.
    await session(root, workspace, {
      user: "Add a timeout option to the HTTP client.",
      date: "2026-03-02T12:00:00Z",
      rounds: [[write("src/client.ts", `${files["src/client.ts"]}export const DEFAULT_TIMEOUT_MS = 10_000;\n`)]],
    });
    commitAll(root, workspace, "Add a timeout");
    const text = await session(root, workspace, {
      user: "Add request logging to the HTTP client.",
      date: "2026-03-10T12:00:00Z",
    });
    rmSync(root, { recursive: true, force: true });
    return result(
      "documentation-retrieval",
      "Add request logging to the HTTP client. (the rule lives only in docs/SECURITY.md)",
      text,
      [
        {
          id: "points-to-doc",
          label: "points to docs/SECURITY.md and what it is about",
          test: (value) =>
            value
              .split("\n")
              .some(
                (line) =>
                  /SECURITY\.md/u.test(line) &&
                  /(token|authorization|log|security)/iu.test(line.replace(/SECURITY\.md/gu, "")),
              ),
        },
      ],
    );
  },

  async "stale-document-detection"() {
    const state = yearState(11);
    const text = await session(state, "ledgerly", {
      user: "Explain how the storage layer works, then bring the README up to date.",
      date: "2026-12-15T12:00:00Z",
      model: "yib-model-b",
    });
    rmSync(state, { recursive: true, force: true });
    return result(
      "stale-document-detection",
      "Explain the storage layer and update the README (the README still says JSON)",
      text,
      [
        {
          id: "flags-readme",
          label: "README flagged as possibly stale or contradicting the active decision",
          test: (value) =>
            value
              .split("\n")
              .some(
                (line) =>
                  /README\.md|ARCHITECTURE\.md/u.test(line) &&
                  /(stale|outdated|contradict|may be out of date|older than)/iu.test(line),
              ),
        },
      ],
    );
  },

  async "successful-procedure-learning"() {
    const files = {
      "package.json": JSON.stringify({
        name: "schemas",
        type: "module",
        scripts: { test: "bun test", gen: "bun run scripts/gen.ts" },
      }),
      "schema/user.json": JSON.stringify({ fields: ["id", "name"] }),
      "scripts/gen.ts":
        "import { readFileSync, writeFileSync } from 'node:fs';\nconst { fields } = JSON.parse(readFileSync('schema/user.json', 'utf8'));\nwriteFileSync('src/generated.ts', `export const USER_FIELDS = ${JSON.stringify(fields)} as const;\\n`);\n",
      "src/generated.ts": 'export const USER_FIELDS = ["id","name"] as const;\n',
      "test/user.test.ts":
        "import { expect, test } from 'bun:test';\nimport { readFileSync } from 'node:fs';\nimport { USER_FIELDS } from '../src/generated';\ntest('generated fields match the schema', () => expect([...USER_FIELDS]).toEqual(JSON.parse(readFileSync('schema/user.json', 'utf8')).fields));\n",
    };
    const { root, workspace } = project("schemas", files);
    await session(root, workspace, {
      user: "Add a phone field to the user schema.",
      date: "2026-03-02T12:00:00Z",
      rounds: [
        [
          write("schema/user.json", JSON.stringify({ fields: ["id", "name", "phone"] })),
          bash("bun test"),
          bash("bun run gen"),
          bash("bun test"),
        ],
      ],
      answer: "Added phone; regenerated src/generated.ts with bun run gen; tests pass.",
      reflection: [
        {
          type: "procedure",
          slug: "regenerate-after-schema-change",
          title: "After changing schema/*.json run bun run gen",
          hook: "src/generated.ts is generated from schema/user.json by bun run gen; tests compare them",
          description: "How to change the schema",
          body: "Edit schema/user.json, run `bun run gen`, then `bun test`.",
          confidence: 0.9,
          relatedFiles: ["schema/user.json", "scripts/gen.ts"],
          tags: ["schema", "codegen"],
        },
      ],
    });
    commitAll(root, workspace, "Add phone");
    const text = await session(root, workspace, {
      user: "Add an address field to the user schema.",
      date: "2026-03-20T12:00:00Z",
    });
    rmSync(root, { recursive: true, force: true });
    return result(
      "successful-procedure-learning",
      "Add an address field to the user schema. (after a session that found the codegen step)",
      text,
      [{ id: "procedure", label: "the codegen step is recalled", all: [/bun run gen/u] }],
    );
  },

  async "failed-approach-retention"() {
    const files = {
      "package.json": JSON.stringify({ name: "dues", type: "module", scripts: { test: "bun test" } }),
      "src/due.ts":
        "export function dueDate(days: number): string {\n  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);\n}\n",
      "test/due.test.ts":
        "import { expect, test } from 'bun:test';\nimport { dueDate } from '../src/due';\ntest('a date', () => expect(dueDate(0)).toMatch(/\\d{4}-\\d{2}-\\d{2}/));\n",
    };
    const { root, workspace } = project("dues", files);
    const injected =
      "export function dueDate(days: number, now: () => number = Date.now): string {\n  return new Date(now() + days * 86_400_000).toISOString().slice(0, 10);\n}\n";
    await session(root, workspace, {
      user: "Make dueDate testable without depending on the real clock.",
      date: "2026-03-02T12:00:00Z",
      rounds: [[write("src/due.ts", injected), bash("bun test")]],
      answer:
        "Overriding Date.now in tests leaked into other tests, so dueDate now takes an injected clock. bun test passes.",
      reflection: [
        {
          type: "failure",
          slug: "do-not-override-date-now",
          title: "Do not override Date.now in tests; inject a clock",
          hook: "Overriding Date.now leaked between tests; dueDate takes a now() parameter instead",
          description: "A failed approach and what worked",
          body: "Overriding Date.now globally leaked into other tests. Pass a clock function instead.",
          confidence: 0.85,
          relatedFiles: ["src/due.ts"],
          tags: ["clock", "time", "tests"],
        },
      ],
    });
    commitAll(root, workspace, "Inject the clock");
    const text = await session(root, workspace, {
      user: "Add a function that says whether an invoice is overdue, with tests.",
      date: "2026-03-20T12:00:00Z",
    });
    rmSync(root, { recursive: true, force: true });
    return result(
      "failed-approach-retention",
      "A related clock-dependent task, after a session where overriding Date.now failed",
      text,
      [
        {
          id: "lesson",
          label: "the failed approach and its fix are recalled",
          all: [/(inject\w* (a )?clock|Date\.now)/iu],
        },
      ],
    );
  },

  async "memory-consolidation"() {
    const files = {
      "package.json": JSON.stringify({ name: "routes", type: "module" }),
      "src/routes/health.ts": "export default () => 'ok';\n",
    };
    const { root, workspace } = project("routes", files);
    const variants = [
      "API routes live in src/routes and export a default handler",
      "Each API route is a file in src/routes with a default export",
      "Routes go in src/routes; every route file default-exports its handler",
      "New endpoints are added as default-exported handlers under src/routes",
      "The project defines HTTP routes as src/routes files exporting a default function",
    ];
    for (const [index, statement] of variants.entries()) {
      await session(root, workspace, {
        user: `Add the ${["users", "orders", "invoices", "clients", "reports"][index]} route.`,
        date: `2026-03-${String(2 + index).padStart(2, "0")}T12:00:00Z`,
        rounds: [[write(`src/routes/r${index}.ts`, "export default () => 'ok';\n")]],
        reflection: [
          {
            type: "conventions",
            slug: `route-convention-${index}`,
            title: statement,
            hook: statement,
            description: "Route convention",
            body: `${statement}.`,
            confidence: 0.8,
            relatedFiles: ["src/routes/health.ts"],
            tags: ["routes", "api"],
          },
        ],
      });
    }
    const text = await session(root, workspace, { user: "Add the payments route.", date: "2026-03-20T12:00:00Z" });
    const count = (text.match(/src\/routes/giu) ?? []).length;
    rmSync(root, { recursive: true, force: true });
    return result(
      "memory-consolidation",
      "Five sessions each learn the same route convention in other words; how many copies reach the sixth?",
      text,
      [
        { id: "known", label: "the convention is known", all: [/src\/routes/iu] },
        {
          id: "one-copy",
          label: "at most two statements of it reach the request",
          test: (value) => (value.match(/default[- ]export|export(s|ing)? (a )?default/giu) ?? []).length <= 2,
        },
      ],
      `src/routes mentions: ${count}`,
    );
  },

  async "memory-noise-resistance"() {
    const state = yearState(11);
    const text = await session(state, "ledgerly", {
      user: "Write a haiku about autumn for the README footer.",
      date: "2026-12-15T12:00:00Z",
      model: "yib-model-b",
    });
    rmSync(state, { recursive: true, force: true });
    const expanded = (text.match(/^### /gmu) ?? []).length;
    return result(
      "memory-noise-resistance",
      "An unrelated request: how much project knowledge is expanded?",
      text,
      [{ id: "few-expanded", label: "no more than one knowledge entry expanded", test: () => expanded <= 1 }],
      `expanded entries: ${expanded}`,
    );
  },
};

const results: EvalResult[] = [];
for (const [id, run] of Object.entries(evals)) {
  if (wanted.length > 0 && !wanted.includes(id)) continue;
  const started = Date.now();
  try {
    const outcome = await run();
    results.push(outcome);
    console.log(
      `${outcome.passed ? "PASS" : "FAIL"} ${id} ${outcome.score} (${((Date.now() - started) / 1000).toFixed(1)}s)${outcome.notes ? ` — ${outcome.notes}` : ""}`,
    );
    for (const check of outcome.checks.filter((item) => !item.passed)) console.log(`     missing: ${check.label}`);
  } catch (error) {
    console.log(`ERROR ${id}: ${error instanceof Error ? error.message : String(error)}`);
    results.push({ id, question: "(failed to run)", checks: [], passed: false, score: "0/0", notes: String(error) });
  }
}
const passed = results.filter((item) => item.passed).length;
console.log(`${passed}/${results.length} evals passed`);
mkdirSync(join(HERE, "results"), { recursive: true });
writeFileSync(
  join(HERE, "results", `memory-evals-${label}.json`),
  `${redactPaths(JSON.stringify({ label, passed, total: results.length, results }, null, 2))}\n`,
);
process.exit(0);
