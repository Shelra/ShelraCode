/**
 * The Ledgerly year: twelve epochs of one project, January to December 2026, for the Year-in-a-Box evaluation
 * (docs/architecture/20-LONG-HORIZON-AUDIT.md §15). Each epoch is one user request in a fresh session, the tool calls a
 * scripted model makes for it (run through the real tools), and the reflection that model returns.
 *
 * The model is ideal on purpose: it plans, runs the checks, proposes decisions and returns the durable facts the
 * reflection prompt asks for. What a fresh session still lacks at the end is then the harness's limit, not the model's.
 */

export interface ScriptStep {
  tool: string;
  input: Record<string, unknown>;
}

export interface Epoch {
  id: number;
  /** Simulated date the epoch runs on (UTC noon). */
  date: string;
  /** What the user types. */
  user: string;
  /** The model id the session uses (a model switch is part of the year). */
  model: string;
  /** Tool calls per model round; rounds past the script answer with text only. */
  rounds: ScriptStep[][];
  /** The final text of the first round. */
  answer: string;
  /** What the reflection call returns: the durable facts an ideal model proposes. */
  reflection: Array<Record<string, unknown>>;
  /** The simulated user approves every decision proposed in this epoch. */
  approveDecisions?: boolean;
  /** The process is killed after this many tool results (a crash mid-turn). */
  crashAfterTools?: number;
  /** The simulated user's commit message after the epoch (none when the process crashed). */
  commit?: string;
  /** What this epoch tests, for the report. */
  tests: string;
}

const PACKAGE_JSON = `${JSON.stringify(
  { name: "ledgerly", private: true, type: "module", scripts: { test: "bun test" } },
  null,
  2,
)}\n`;

const MONEY_V1 = `/** Parses an amount such as "12.34" into integer cents. */
export function toCents(amount: string): number {
  const [whole, fraction = ""] = amount.trim().split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0").slice(0, 2));
}
`;

const MONEY_V2 = `/** Parses an amount into integer cents: "12.34", "1,234.56" or the European "1.234,56". */
export function toCents(amount: string): number {
  const text = amount.trim();
  const european = /,\\d{1,2}$/.test(text);
  const normalized = european ? text.replaceAll(".", "").replace(",", ".") : text.replaceAll(",", "");
  const [whole, fraction = ""] = normalized.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0").slice(0, 2));
}
`;

const MONEY_TEST_V1 = `import { expect, test } from "bun:test";
import { toCents } from "../src/money";

test("stores money as integer cents", () => {
  expect(toCents("12.34")).toBe(1234);
  expect(toCents("5")).toBe(500);
});
`;

const MONEY_TEST_EUROPEAN = `${MONEY_TEST_V1}
test("reads amounts written with a decimal comma", () => {
  expect(toCents("1.234,56")).toBe(123456);
});
`;

const STORE_JSON = `import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

export interface Expense {
  date: string;
  description: string;
  cents: number;
  currency: string;
  category?: string;
}

/** One JSON file per month under data/. */
export function saveMonth(dir: string, month: string, expenses: Expense[]): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(\`\${dir}/\${month}.json\`, JSON.stringify(expenses));
}

export function loadMonth(dir: string, month: string): Expense[] {
  const file = \`\${dir}/\${month}.json\`;
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : [];
}
`;

const README = `# Ledgerly

An offline expense tracker for freelancers who invoice in several currencies. Nothing leaves your machine.

## Storage

One JSON file per month under \`data/\`.
`;

const ARCHITECTURE = `# Architecture

- Money is stored as integer cents (\`src/money.ts\`).
- Storage: one JSON file per month under \`data/\` (\`src/store.ts\`). No database.
`;

const IMPORT_V1 = `import { toCents } from "./money";
import type { Expense } from "./store";

/** Parses a bank statement exported as comma-separated date,description,amount,currency with a header row. */
export function parseCsv(text: string): Expense[] {
  return text
    .trim()
    .split(/\\r?\\n/)
    .slice(1)
    .map((line) => {
      const [date, description, amount, currency] = line.split(",");
      return { date, description, cents: toCents(amount), currency };
    });
}
`;

const IMPORT_TEST_V1 = `import { expect, test } from "bun:test";
import { parseCsv } from "../src/import";

test("imports a comma-separated bank statement", () => {
  const rows = parseCsv("date,description,amount,currency\\n2026-02-01,Coffee,3.50,EUR");
  expect(rows).toEqual([{ date: "2026-02-01", description: "Coffee", cents: 350, currency: "EUR" }]);
});
`;

const REPORT_MONTHLY = `import type { Expense } from "./store";

/** Totals a month's expenses per category. */
export function monthlyReport(expenses: Expense[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const expense of expenses) {
    const key = expense.category ?? "uncategorized";
    totals[key] = (totals[key] ?? 0) + expense.cents;
  }
  return totals;
}
`;

const REPORT_MONTHLY_TEST = `import { expect, test } from "bun:test";
import { monthlyReport } from "../src/report-monthly";

test("totals a month per category", () => {
  expect(monthlyReport([{ date: "2026-02-01", description: "Coffee", cents: 350, currency: "EUR", category: "food" }])).toEqual({ food: 350 });
});
`;

const STORE_SQLITE = `import { Database } from "bun:sqlite";

export interface Expense {
  date: string;
  description: string;
  cents: number;
  currency: string;
  category?: string;
}

/** The ledger database: data/ledger.db through bun:sqlite. */
export function openLedger(path = "data/ledger.db"): Database {
  const db = new Database(path);
  db.run("create table if not exists expenses (date text, description text, cents integer, currency text, category text)");
  return db;
}

export function addExpense(db: Database, expense: Expense): void {
  db.run("insert into expenses values (?, ?, ?, ?, ?)", [
    expense.date,
    expense.description,
    expense.cents,
    expense.currency,
    expense.category ?? null,
  ]);
}
`;

const STORE_SQLITE_TEST = `import { expect, test } from "bun:test";
import { addExpense, openLedger } from "../src/store";

test("stores an expense in SQLite", () => {
  const db = openLedger(":memory:");
  addExpense(db, { date: "2026-03-01", description: "Train", cents: 1200, currency: "EUR" });
  expect(db.query("select count(*) as n from expenses").get()).toEqual({ n: 1 });
});
`;

const TAX_SUMMARY = `import type { Expense } from "./store";

/** Yearly totals per currency, for the tax return. */
export function taxSummary(expenses: Expense[], year: string): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const expense of expenses) {
    if (!expense.date.startsWith(year)) continue;
    totals[expense.currency] = (totals[expense.currency] ?? 0) + expense.cents;
  }
  return totals;
}
`;

const TAX_SUMMARY_TEST = `import { expect, test } from "bun:test";
import { taxSummary } from "../src/tax-summary";

test("totals a year per currency", () => {
  const rows = [
    { date: "2026-02-01", description: "Coffee", cents: 350, currency: "EUR" },
    { date: "2025-12-31", description: "Old", cents: 999, currency: "EUR" },
    { date: "2026-03-01", description: "Hosting", cents: 2000, currency: "USD" },
  ];
  expect(taxSummary(rows, "2026")).toEqual({ EUR: 350, USD: 2000 });
});
`;

const STORE_DUCKDB = `export interface Expense {
  date: string;
  description: string;
  cents: number;
  currency: string;
  category?: string;
}

/** Ledger storage on DuckDB (data/ledger.duckdb). The engine is injected, so tests run without the native module. */
export const LEDGER_FILE = "data/ledger.duckdb";

export interface LedgerDb {
  insert(expense: Expense): void;
  all(): Expense[];
}

export function memoryLedger(): LedgerDb {
  const rows: Expense[] = [];
  return { insert: (expense) => void rows.push(expense), all: () => [...rows] };
}
`;

const STORE_DUCKDB_TEST = `import { expect, test } from "bun:test";
import { memoryLedger } from "../src/store";

test("keeps expenses in the ledger", () => {
  const db = memoryLedger();
  db.insert({ date: "2026-07-01", description: "Laptop", cents: 99900, currency: "EUR" });
  expect(db.all()).toHaveLength(1);
});
`;

const MONEY_TEST_V2 = MONEY_TEST_EUROPEAN.replace('"../src/money"', '"../src/domain/money"');
const IMPORT_V3 = IMPORT_V1.replace('"./money"', '"./domain/money"').replace('"./store"', '"./storage/store"');
const TAX_SUMMARY_V2 = TAX_SUMMARY.replace('"./store"', '"./storage/store"');
const STORE_DUCKDB_TEST_V2 = STORE_DUCKDB_TEST.replace('"../src/store"', '"../src/storage/store"');
const IMPORTER_CSV = IMPORT_V1.replace('"./money"', '"../domain/money"').replace('"./store"', '"../storage/store"');
const IMPORT_TEST_V3 = IMPORT_TEST_V1.replace('"../src/import"', '"../src/importers/csv"');
const IMPORTER_CSV_V2 = IMPORTER_CSV.replace(
  'const [date, description, amount, currency] = line.split(",");',
  'const separator = text.split(/\\r?\\n/)[0]?.includes(";") ? ";" : ",";\n      const [date, description, amount, currency] = line.split(separator);',
);
const IMPORT_TEST_V4 = `${IMPORT_TEST_V3}
test("imports a semicolon-separated bank statement", () => {
  const rows = parseCsv("date;description;amount;currency\\n2026-11-01;Books;12.00;EUR");
  expect(rows[0]?.cents).toBe(1200);
});
`;

const write = (path: string, content: string): ScriptStep => ({ tool: "write_file", input: { path, content } });
const remove = (path: string): ScriptStep => ({ tool: "delete_file", input: { path } });
const runTests: ScriptStep = { tool: "bash", input: { command: "bun test" } };

export const LEDGERLY_FIXTURE: Record<string, string> = {
  "package.json": PACKAGE_JSON,
  ".gitignore": "node_modules/\ndata/\n",
};

export const EPOCHS: Epoch[] = [
  {
    id: 1,
    date: "2026-01-05T12:00:00Z",
    model: "yib-model-a",
    tests: "original intent, a constraint stated in prose, a standing rule, the first architecture",
    user: "We're starting Ledgerly: an offline expense tracker for freelancers who invoice in several currencies. Nothing may leave the user's machine: no cloud sync and no telemetry. Set up the project with Bun and TypeScript, store expenses in monthly JSON files to start simple, and add a README and docs/ARCHITECTURE.md. Always store money as integer cents.",
    rounds: [
      [
        {
          tool: "generate_plan",
          input: {
            title: "Ledgerly foundation",
            goal: "An offline expense tracker for freelancers who invoice in several currencies; nothing leaves the user's machine",
            requirements: [
              "Bun + TypeScript project",
              "Money as integer cents",
              "Monthly JSON storage",
              "README and docs/ARCHITECTURE.md",
            ],
            acceptanceCriteria: [
              { id: "AC1", description: "Money is parsed into integer cents", verification: "bun test" },
              { id: "AC2", description: "Expenses saved per month as JSON under data/", verification: "bun test" },
            ],
            steps: ["Write src/money.ts and its test", "Write src/store.ts", "Write README and architecture notes"],
          },
        },
        write("src/money.ts", MONEY_V1),
        write("test/money.test.ts", MONEY_TEST_V1),
        write("src/store.ts", STORE_JSON),
        write("README.md", README),
        write("docs/ARCHITECTURE.md", ARCHITECTURE),
        runTests,
      ],
    ],
    answer:
      "Ledgerly is set up: money as integer cents, monthly JSON storage, README and architecture notes. bun test passes.",
    reflection: [
      {
        type: "architecture",
        slug: "product-purpose",
        title: "Ledgerly: an offline expense tracker for freelancers",
        hook: "An offline expense tracker for freelancers who invoice in several currencies",
        description: "What the product is for, as the user stated it",
        body: "Ledgerly tracks a freelancer's expenses in several currencies, offline.",
        confidence: 0.9,
        tags: ["purpose"],
        quote: "an offline expense tracker for freelancers who invoice in several currencies",
      },
      {
        type: "architecture",
        slug: "storage-json-files",
        title: "Storage is one JSON file per month under data/",
        hook: "src/store.ts saves data/YYYY-MM.json; no database yet",
        description: "Where the ledger is stored",
        body: "saveMonth/loadMonth in src/store.ts write data/YYYY-MM.json. Chosen to start simple; no database.",
        confidence: 0.8,
        relatedFiles: ["src/store.ts"],
        tags: ["storage", "json"],
      },
      {
        type: "conventions",
        slug: "offline-only",
        title: "Nothing leaves the user's machine",
        hook: "No cloud sync, no telemetry, no network calls: a privacy requirement of the product",
        description: "Product constraint stated by the user",
        body: "Ledgerly must work fully offline. Never add sync, telemetry or any network call.",
        confidence: 0.9,
        tags: ["privacy", "offline", "network"],
        // The user's own words, which the host finds in the request (doc 21, Phase D).
        quote: "Nothing may leave the user's machine: no cloud sync and no telemetry.",
      },
    ],
    commit: "Set up Ledgerly with cents and monthly JSON storage",
  },
  {
    id: 2,
    date: "2026-02-03T12:00:00Z",
    model: "yib-model-a",
    tests: "a feature that is later revisited (CSV import) and one that is later removed (monthly report)",
    user: "Add CSV import of bank statements (comma-separated: date, description, amount, currency) and a monthly report that totals expenses per category.",
    rounds: [
      [
        write("src/import.ts", IMPORT_V1),
        write("test/import.test.ts", IMPORT_TEST_V1),
        write("src/report-monthly.ts", REPORT_MONTHLY),
        write("test/report-monthly.test.ts", REPORT_MONTHLY_TEST),
        runTests,
      ],
    ],
    answer:
      "CSV import (src/import.ts) and the monthly report (src/report-monthly.ts) are in, with tests. bun test passes.",
    reflection: [
      {
        type: "important-codepaths",
        slug: "csv-import",
        title: "Bank CSV import is parseCsv in src/import.ts",
        hook: "Expects comma-separated date,description,amount,currency with a header row",
        description: "Where bank statements are parsed",
        body: "parseCsv(text) in src/import.ts; test/import.test.ts covers it.",
        confidence: 0.85,
        relatedFiles: ["src/import.ts", "test/import.test.ts"],
        tags: ["csv", "import", "bank"],
      },
    ],
    commit: "Add CSV import and the monthly report",
  },
  {
    id: 3,
    date: "2026-03-02T12:00:00Z",
    model: "yib-model-a",
    tests: "an architectural decision with rationale and rejected alternatives (TEST F's source)",
    user: "Reports need real queries now. Use SQLite instead of JSON files for storage, with bun:sqlite. Record this as a decision: JSON files had to be loaded whole for every report, and Postgres is out because it needs a server and breaks offline use.",
    approveDecisions: true,
    rounds: [
      [
        {
          tool: "propose_decision",
          input: {
            title: "Storage uses SQLite through bun:sqlite",
            rule: "All ledger data is stored in a SQLite database (data/ledger.db) through bun:sqlite; no JSON data files.",
            why: "Reports need filtering and grouping; JSON files had to be loaded whole. Rejected: keeping JSON files; Postgres (needs a server, breaks offline use).",
            evidence: "The user's request of 2026-03-02",
            scope: ["src/store.ts"],
          },
        },
        write("src/store.ts", STORE_SQLITE),
        write("test/store.test.ts", STORE_SQLITE_TEST),
        runTests,
      ],
    ],
    answer:
      "Storage moved to SQLite (data/ledger.db) and recorded as decision D-0001 with your approval. bun test passes.",
    reflection: [
      {
        type: "architecture",
        slug: "storage-sqlite",
        title: "Storage is SQLite through bun:sqlite",
        hook: "src/store.ts opens data/ledger.db with table expenses",
        description: "Where the ledger is stored",
        body: "openLedger/addExpense in src/store.ts; tests use ':memory:'.",
        confidence: 0.9,
        relatedFiles: ["src/store.ts"],
        tags: ["storage", "sqlite"],
        supersedes: "storage-json-files",
      },
    ],
    commit: "Store the ledger in SQLite",
  },
  {
    id: 4,
    date: "2026-05-04T12:00:00Z",
    model: "yib-model-a",
    tests: "changing intent: drop A, build B, preserve C",
    user: "We no longer want the monthly report. Replace it with a yearly tax summary per currency, but keep the CSV import exactly as it is.",
    rounds: [
      [
        {
          tool: "generate_plan",
          input: {
            title: "Yearly tax summary replaces the monthly report",
            goal: "A yearly tax summary per currency instead of the monthly report; the CSV import unchanged",
            requirements: [
              "Remove the monthly report",
              "Add a yearly tax summary per currency",
              "Do not change the CSV import",
            ],
            acceptanceCriteria: [
              { id: "AC1", description: "taxSummary totals a year per currency", verification: "bun test" },
              {
                id: "AC2",
                description: "The monthly report is gone",
                verification: "src/report-monthly.ts does not exist",
              },
            ],
            steps: ["Delete the monthly report and its test", "Write src/tax-summary.ts and its test"],
          },
        },
        remove("src/report-monthly.ts"),
        remove("test/report-monthly.test.ts"),
        write("src/tax-summary.ts", TAX_SUMMARY),
        write("test/tax-summary.test.ts", TAX_SUMMARY_TEST),
        runTests,
      ],
    ],
    answer:
      "The monthly report is removed; src/tax-summary.ts totals a year per currency. The CSV import is untouched. bun test passes.",
    reflection: [
      {
        type: "important-codepaths",
        slug: "tax-summary",
        title: "Yearly tax summary per currency in src/tax-summary.ts",
        hook: "Replaced the monthly report, removed in May at the user's request; the CSV import stays unchanged",
        description: "The report the product offers",
        body: "taxSummary(expenses, year) in src/tax-summary.ts. The monthly report was removed on purpose.",
        confidence: 0.9,
        relatedFiles: ["src/tax-summary.ts"],
        tags: ["report", "tax"],
      },
    ],
    commit: "Replace the monthly report with a yearly tax summary",
  },
  {
    id: 5,
    date: "2026-06-01T12:00:00Z",
    model: "yib-model-a",
    tests: "a bug, a failing check, the fix: a failure lesson",
    user: "Imports from my Spanish bank are wrong: amounts like 1.234,56 come out as 1.234.",
    rounds: [[write("test/money.test.ts", MONEY_TEST_EUROPEAN), runTests, write("src/money.ts", MONEY_V2), runTests]],
    answer: "toCents now reads the European format 1.234,56; a test covers it. bun test passes.",
    reflection: [
      {
        type: "known-problems",
        slug: "decimal-comma-amounts",
        title: "Bank CSVs may write amounts as 1.234,56",
        hook: "toCents accepts both 1,234.56 and the European 1.234,56; test/money.test.ts covers the Spanish bank format",
        description: "A trap in bank exports",
        body: "Spanish banks export 1.234,56. src/money.ts normalizes before splitting.",
        confidence: 0.9,
        relatedFiles: ["src/money.ts", "test/money.test.ts"],
        tags: ["csv", "amount", "decimal", "comma"],
      },
    ],
    commit: "Read amounts written with a decimal comma",
  },
  {
    id: 6,
    date: "2026-07-06T12:00:00Z",
    model: "yib-model-a",
    tests: "a decision superseded; a new standing rule",
    user: "We're dropping SQLite: the tax summary over ten years of data needs columnar queries. Use DuckDB instead of SQLite. Never add another dependency without asking me first.",
    approveDecisions: true,
    rounds: [
      [
        {
          tool: "propose_decision",
          input: {
            title: "Storage uses DuckDB",
            rule: "All ledger data is stored in DuckDB (data/ledger.duckdb); the engine is injected so tests run without it.",
            why: "The tax summary over ten years of data needs columnar queries; SQLite was too slow for them.",
            evidence: "The user's request of 2026-07-06",
            scope: ["src/store.ts"],
            supersedes: "D-0001",
          },
        },
        write("src/store.ts", STORE_DUCKDB),
        write("test/store.test.ts", STORE_DUCKDB_TEST),
        runTests,
      ],
    ],
    answer: "Storage is DuckDB now (decision D-0002, replacing D-0001). bun test passes.",
    reflection: [
      {
        type: "architecture",
        slug: "storage-duckdb",
        title: "Storage is DuckDB (data/ledger.duckdb)",
        hook: "src/store.ts; the engine is injected, tests use memoryLedger()",
        description: "Where the ledger is stored",
        body: "LEDGER_FILE = data/ledger.duckdb; memoryLedger() for tests.",
        confidence: 0.9,
        relatedFiles: ["src/store.ts"],
        tags: ["storage", "duckdb"],
        supersedes: "storage-sqlite",
      },
    ],
    commit: "Move storage to DuckDB",
  },
  {
    id: 7,
    date: "2026-08-03T12:00:00Z",
    model: "yib-model-a",
    tests: "a multi-step refactor left half done on purpose: a plan with 2 of 4 steps complete",
    user: "Refactor the code into modules: src/domain, src/storage, src/importers and src/reports. Go step by step and keep the tests green.",
    rounds: [
      [
        {
          tool: "generate_plan",
          input: {
            title: "Module layout refactor",
            goal: "Code organized in src/domain, src/storage, src/importers and src/reports with green tests",
            requirements: ["Move money to src/domain", "Move storage to src/storage", "Move importers", "Move reports"],
            acceptanceCriteria: [
              { id: "AC1", description: "All tests pass after each move", verification: "bun test" },
            ],
            steps: [
              "Move src/money.ts to src/domain/money.ts",
              "Move src/store.ts to src/storage/store.ts",
              "Move src/import.ts to src/importers/csv.ts",
              "Move src/tax-summary.ts to src/reports/tax-summary.ts",
            ],
          },
        },
        { tool: "update_plan_step", input: { index: 1, status: "working" } },
        write("src/domain/money.ts", MONEY_V2),
        remove("src/money.ts"),
        write("test/money.test.ts", MONEY_TEST_V2),
        write("src/import.ts", IMPORT_V3),
        runTests,
        { tool: "update_plan_step", input: { index: 1, status: "complete", evidence: "bun test passes" } },
        { tool: "update_plan_step", input: { index: 2, status: "working" } },
        write("src/storage/store.ts", STORE_DUCKDB),
        remove("src/store.ts"),
        write("test/store.test.ts", STORE_DUCKDB_TEST_V2),
        write("src/tax-summary.ts", TAX_SUMMARY_V2),
        runTests,
        { tool: "update_plan_step", input: { index: 2, status: "complete", evidence: "bun test passes" } },
      ],
    ],
    answer:
      "Steps 1 and 2 are done (src/domain, src/storage) and bun test passes. Steps 3 (importers) and 4 (reports) remain for the next session.",
    reflection: [
      {
        type: "conventions",
        slug: "module-layout",
        title: "Code is organized in src/domain, src/storage, src/importers and src/reports",
        hook: "Domain types, storage, importers and reports each live in their own folder under src/",
        description: "The module layout the user asked for",
        body: "New code goes in src/domain, src/storage, src/importers or src/reports; nothing new at the src/ root.",
        confidence: 0.85,
        relatedFiles: ["src/domain/money.ts", "src/storage/store.ts"],
        tags: ["layout", "refactor", "modules"],
      },
    ],
    commit: "Move money and storage into modules",
  },
  {
    id: 8,
    date: "2026-09-07T12:00:00Z",
    model: "yib-model-a",
    tests: "a crash mid-turn: the process is killed after it wrote a file",
    user: "Continue the refactor.",
    crashAfterTools: 1,
    rounds: [
      [
        write("src/importers/csv.ts", IMPORTER_CSV),
        remove("src/import.ts"),
        write("test/import.test.ts", IMPORT_TEST_V3),
        runTests,
      ],
    ],
    answer: "(never reached: the process is killed)",
    reflection: [],
  },
  {
    id: 9,
    date: "2026-10-20T12:00:00Z",
    model: "yib-model-b",
    tests: "resume after six weeks and a crash, on another model: does the session know what was in progress?",
    user: "Continue where we left off.",
    rounds: [[remove("src/import.ts"), write("test/import.test.ts", IMPORT_TEST_V3), runTests]],
    answer: "The importer now lives in src/importers/csv.ts and bun test passes.",
    reflection: [
      {
        type: "conventions",
        slug: "module-layout",
        title: "Code is organized in src/domain, src/storage, src/importers and src/reports",
        hook: "Domain types, storage, importers and reports each live in their own folder under src/",
        description: "The module layout the user asked for",
        body: "New code goes in src/domain, src/storage, src/importers or src/reports; nothing new at the src/ root.",
        confidence: 0.85,
        relatedFiles: ["src/domain/money.ts", "src/storage/store.ts", "src/importers/csv.ts"],
        tags: ["layout", "refactor", "modules"],
      },
    ],
    commit: "Move the CSV importer into src/importers",
  },
  {
    id: 10,
    date: "2026-11-03T12:00:00Z",
    model: "yib-model-b",
    tests: "an old feature revisited: does the CSV knowledge and the decimal-comma lesson come back?",
    user: "CSV files from my new bank use semicolons as separators and the import breaks.",
    rounds: [[write("test/import.test.ts", IMPORT_TEST_V4), write("src/importers/csv.ts", IMPORTER_CSV_V2), runTests]],
    answer: "parseCsv detects ';' or ',' from the header. bun test passes.",
    reflection: [
      {
        type: "known-problems",
        slug: "csv-separator",
        title: "Bank CSVs use ',' or ';' as the separator",
        hook: "parseCsv in src/importers/csv.ts detects the separator from the header row",
        description: "A trap in bank exports",
        body: "New bank exports use ';'. Detection reads the header line.",
        confidence: 0.9,
        relatedFiles: ["src/importers/csv.ts"],
        tags: ["csv", "separator", "semicolon"],
      },
    ],
    commit: "Detect the CSV separator",
  },
  {
    id: 11,
    date: "2026-11-24T12:00:00Z",
    model: "yib-model-b",
    tests: "TEST F: months-old rationale, with stale docs that still say JSON",
    user: "Why did we choose our current storage engine, and what did we use before it?",
    rounds: [[]],
    answer: "(scripted answer; the evaluation reads what the model was given)",
    reflection: [],
  },
  {
    id: 12,
    date: "2026-12-15T12:00:00Z",
    model: "yib-model-b",
    tests: "the brief's December request: continue, keep valid decisions, ignore superseded ones, take the next step",
    user: "Continue the work we started in January. Keep every decision that is still valid, ignore the ones that were superseded, work out where the project is now, and implement the next correct step.",
    rounds: [[{ tool: "memory_list", input: {} }]],
    answer: "(scripted answer; the evaluation reads what the model was given)",
    reflection: [],
  },
];
