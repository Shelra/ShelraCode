/**
 * Offline memory retrieval benchmark (docs/architecture/18-MEMORY-V2.md §6, layer 2). Deterministic, no model, no
 * network: it builds each project's store from `dataset.json` (gold entries written blind to the ranking code),
 * pads it with seeded distractor entries to 100, 1,000 and 5,000 entries, runs every gold-labelled query through
 * the same `buildMemoryContext` a turn uses, and reports what reached the model.
 *
 *   bun run bench/memory/run.ts --label before-m2
 *   bun run bench/memory/run.ts --label after-m2 --sizes 0,100,1000,5000
 *   bun run bench/memory/run.ts --label before-m2 --impl src/memory/<old copy>.ts   (any module with the same API)
 *   --split dev|test   runs half the queries: tune thresholds on dev only, report test as held out
 *   --pre-m3-store     builds superseded pairs as the store did before M3 (no "Replaces" line on the newer entry)
 *
 * Metrics, per store size, overall and by query kind and language:
 * - recall: share of gold entries whose body reached the model; recallSeen also counts a gold entry listed by title;
 * - precision: share of expanded knowledge entries (rules excluded) that were gold or acceptable;
 * - mrr: 1 / rank of the first gold entry in the full ranking;
 * - noise: knowledge entries expanded for requests memory cannot help with (lower is better);
 * - forbidden: queries where a superseded fact or another project's look-alike was shown as current;
 * - ruleRecall: share of the project's and the user's standing rules shown in full; ruleSeen counts a listed hook;
 * - chars: size of the memory section; latencyMs: median and p95 time to build it.
 */
import { mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { replacesNote } from "../../src/memory/store";
import type { MemoryRecord, MemorySource, MemoryType } from "../../src/memory/types";

interface DatasetEntry {
  slug: string;
  type: MemoryType;
  source: MemorySource;
  confidence: number;
  title: string;
  hook: string;
  description: string;
  body: string;
  tags?: string[];
  relatedFiles?: string[];
  modified: string;
  status?: "active" | "superseded";
  supersededBy?: string;
}

interface DatasetQuery {
  id: string;
  project: string;
  language: "en" | "es";
  kind: string;
  text: string;
  previous?: string;
  paths?: string[];
  gold: string[];
  acceptable?: string[];
  forbidden?: string[];
}

interface Dataset {
  projects: Array<{ id: string; description: string; entries: DatasetEntry[] }>;
  user: { entries: DatasetEntry[] };
  queries: DatasetQuery[];
}

const HERE = dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/u, "$1"));
const NOW = Date.parse("2026-09-25T12:00:00Z");
/** Files older than every entry, so a related file is never "changed after the entry was confirmed". */
const OLD_FILE_TIME = new Date("2026-01-01T00:00:00Z");

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

/** mulberry32: a small seeded PRNG, so every run builds the same distractors. */
function prng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function record(entry: DatasetEntry, origin?: "user"): MemoryRecord {
  const metadata: Record<string, unknown> = {
    type: entry.type,
    modified: entry.modified,
    created: entry.modified,
    source: entry.source,
    confidence: entry.confidence,
    lastConfirmed: entry.modified,
    ...(entry.relatedFiles?.length ? { relatedFiles: entry.relatedFiles } : {}),
    ...(entry.tags?.length ? { tags: entry.tags } : {}),
    ...(entry.status === "superseded" ? { status: "superseded", supersededBy: entry.supersededBy } : {}),
  };
  return {
    slug: entry.slug,
    index: { title: entry.title, file: `${entry.slug}.md`, hook: entry.hook },
    entry: {
      frontmatter: {
        name: entry.slug,
        description: entry.description,
        metadata: metadata as MemoryRecord["entry"]["frontmatter"]["metadata"],
      },
      body: entry.body,
    },
    ...(origin ? { origin } : {}),
  };
}

// Distractors: plausible learned facts about other parts of a codebase, sharing the everyday vocabulary of coding
// requests (test, build, error, config, deploy) so they compete for rank the way a large real store would.
const MODULES = [
  "billing",
  "invoices",
  "search",
  "notifications",
  "cart",
  "inventory",
  "reports",
  "exports",
  "onboarding",
  "analytics",
  "images",
  "uploads",
  "webhooks",
  "emails",
  "cache",
  "queue",
  "scheduler",
  "metrics",
  "logging",
  "i18n",
  "pagination",
  "feature-flags",
  "sitemap",
  "admin",
  "audit-log",
  "rate-limiter",
  "thumbnails",
  "coupons",
  "shipping",
  "taxes",
  "favorites",
  "comments",
  "ratings",
  "newsletter",
  "sso",
  "backups",
  "migrations",
  "cron",
  "geo",
  "pdf",
  "csv-import",
  "charts",
  "tooltips",
  "modals",
  "forms",
  "wizard",
  "calendar",
  "timezones",
  "currency",
];
const ASPECTS = [
  ["caches", "results for 5 minutes in"],
  ["retries", "three times with backoff in"],
  ["validates", "its input with zod in"],
  ["logs", "every failure to"],
  ["reads", "its settings from"],
  ["batches", "writes of 500 rows in"],
  ["streams", "large payloads from"],
  ["locks", "the row before updating it in"],
];
const KINDS: MemoryType[] = [
  "architecture",
  "debugging",
  "build",
  "testing",
  "conventions",
  "known-problems",
  "important-codepaths",
  "decisions",
  "procedure",
  "failure",
];
const FAILURES = [
  "TypeError: Cannot read properties of undefined (reading 'id')",
  "ECONNREFUSED 127.0.0.1:6379",
  "Error: timeout of 5000ms exceeded",
  "SyntaxError: Unexpected token '<' in JSON at position 0",
  "ENOENT: no such file or directory",
  "RangeError: Invalid time value",
  "403 Forbidden from the storage bucket",
];
const COMMANDS = [
  "bun test",
  "bun run build",
  "npm run lint",
  "pytest -q",
  "make seed",
  "docker compose up -d",
  "bunx tsc",
];

function distractors(project: string, count: number, random: () => number, files: string[]): MemoryRecord[] {
  const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)] as T;
  const out: MemoryRecord[] = [];
  for (let index = 0; index < count; index += 1) {
    const module = pick(MODULES);
    const [verb, rest] = pick(ASPECTS) as [string, string];
    const type = pick(KINDS);
    const file = pick(files);
    const failure = pick(FAILURES);
    const command = pick(COMMANDS);
    const variant = Math.floor(random() * 4);
    const hook =
      variant === 0
        ? `the ${module} module ${verb} ${rest} ${file}`
        : variant === 1
          ? `${command} fails in ${module} with ${failure.split(":")[0]} unless the fixture is seeded`
          : variant === 2
            ? `${module} changes need a follow-up in ${file}`
            : `${module}: decided to keep the handler in ${file} instead of splitting it`;
    const body = [
      variant === 1 ? `\`${command}\` fails with \`${failure}\` when the ${module} fixture is missing.` : `${hook}.`,
      `Seen while working on ${module} (${type}).`,
      variant === 1 ? `Run \`make seed-${module}\` first, then \`${command}\`.` : `See \`${file}\`.`,
    ].join("\n");
    const month = 3 + Math.floor(random() * 6);
    const day = 1 + Math.floor(random() * 27);
    out.push(
      record({
        slug: `${project}-noise-${index}`,
        type,
        source: random() < 0.7 ? "inference" : "observed",
        confidence: 0.55 + random() * 0.4,
        title: `${module} ${type}`.slice(0, 60),
        hook,
        description: hook,
        body,
        tags: [module],
        relatedFiles: random() < 0.6 ? [file] : undefined,
        modified: `2026-0${month}-${String(day).padStart(2, "0")}T10:00:00.000Z`,
      }),
    );
  }
  return out;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function p95(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0;
}

interface QueryResult {
  id: string;
  kind: string;
  language: string;
  recall: number | null;
  recallSeen: number | null;
  precision: number | null;
  mrr: number | null;
  noise: number | null;
  forbidden: boolean;
  ruleRecall: number | null;
  ruleSeen: number | null;
  chars: number;
  ms: number;
  missed: string[];
  /** Knowledge entries shown in full, in order: what the model was given beyond the rules. */
  shown: string[];
}

function average(values: Array<number | null>): number | null {
  const present = values.filter((value): value is number => value !== null);
  return present.length === 0 ? null : present.reduce((sum, value) => sum + value, 0) / present.length;
}

function summarize(results: QueryResult[]) {
  return {
    queries: results.length,
    recall: average(results.map((result) => result.recall)),
    recallSeen: average(results.map((result) => result.recallSeen)),
    precision: average(results.map((result) => result.precision)),
    mrr: average(results.map((result) => result.mrr)),
    noise: average(results.map((result) => result.noise)),
    forbidden: results.filter((result) => result.forbidden).length,
    ruleRecall: average(results.map((result) => result.ruleRecall)),
    ruleSeen: average(results.map((result) => result.ruleSeen)),
    chars: median(results.map((result) => result.chars)),
    latencyMs: { median: median(results.map((result) => result.ms)), p95: p95(results.map((result) => result.ms)) },
  };
}

async function run(): Promise<void> {
  const implPath = join(HERE, "..", "..", arg("impl") ?? "src/memory/retrieval.ts");
  const { buildMemoryContext, rankMemories } = (await import(implPath)) as typeof import("../../src/memory/retrieval");
  const dataset = JSON.parse(readFileSync(join(HERE, "dataset.json"), "utf8")) as Dataset;
  const sizes = (arg("sizes") ?? "0,100,1000,5000").split(",").map(Number);
  const label = arg("label") ?? "run";
  const split = arg("split");
  /** Retrieval options to try, as JSON (`--options '{"relativeCutoff":0.5}'`): tune on the dev split only. */
  const options = JSON.parse(arg("options") ?? "{}") as Record<string, number>;
  // A fixed split by query position: dev = odd positions, test = even.
  const queries = dataset.queries.filter((_, index) =>
    split === "dev" ? index % 2 === 0 : split === "test" ? index % 2 === 1 : true,
  );
  const userRecords = dataset.user.entries.map((entry) => record(entry, "user"));
  const isRule = (candidate: MemoryRecord) =>
    candidate.entry.frontmatter.metadata.source === "human" &&
    candidate.entry.frontmatter.metadata.type === "preference" &&
    (candidate.entry.frontmatter.metadata as { status?: string }).status !== "superseded";

  // One workspace per project holding every related file, dated before every entry.
  const workspaces = new Map<string, string>();
  const noiseFiles = Array.from({ length: 120 }, (_, index) => `src/modules/m${index}/index.ts`);
  for (const project of dataset.projects) {
    const workspace = mkdtempSync(join(tmpdir(), `shelra-memory-bench-${project.id}-`));
    for (const file of [...project.entries.flatMap((entry) => entry.relatedFiles ?? []), ...noiseFiles]) {
      const full = join(workspace, file);
      // A related "file" ending in a slash is a folder (a migrations directory).
      if (/[\\/]$/u.test(file)) mkdirSync(full, { recursive: true });
      else {
        mkdirSync(dirname(full), { recursive: true });
        writeFileSync(full, "");
      }
      utimesSync(full, OLD_FILE_TIME, OLD_FILE_TIME);
    }
    workspaces.set(project.id, workspace);
  }

  const report: Record<string, unknown> = {
    label,
    at: new Date(NOW).toISOString(),
    split: split ?? "all",
    queries: queries.length,
    sizes: {},
  };
  for (const size of sizes) {
    const results: QueryResult[] = [];
    const stores = new Map<string, MemoryRecord[]>();
    for (const [index, project] of dataset.projects.entries()) {
      // As the store does since M3: the newer entry of a superseded pair says what it replaced, and until when.
      // `--pre-m3-store` leaves that out, as the store did before.
      const replaced = new Map(
        project.entries
          .filter((entry) => entry.status === "superseded" && entry.supersededBy)
          .map((entry) => [entry.supersededBy as string, entry]),
      );
      const gold = project.entries.map((entry) => {
        const old = replaced.get(entry.slug);
        return record(
          old && !process.argv.includes("--pre-m3-store")
            ? { ...entry, body: `${entry.body.trimEnd()}\n\n${replacesNote(old.hook, entry.modified)}` }
            : entry,
        );
      });
      const padding = Math.max(0, size - gold.length);
      stores.set(project.id, [...gold, ...distractors(project.id, padding, prng(1_000 + index), noiseFiles)]);
    }
    for (const query of queries) {
      const projectRecords = stores.get(query.project) ?? [];
      const records = [...projectRecords, ...userRecords];
      const workspace = workspaces.get(query.project) as string;
      const retrievalQuery = { text: query.text, paths: query.paths, now: NOW, previous: query.previous };
      const started = performance.now();
      const context = buildMemoryContext(records, retrievalQuery, workspace, options);
      const ms = performance.now() - started;
      const shownInFull = new Set([...context.expanded, ...((context as { rules?: string[] }).rules ?? [])]);
      const listed = new Set(context.listed);
      const bySlug = new Map(records.map((candidate) => [candidate.slug, candidate]));
      const knowledge = [...shownInFull].filter((slug) => {
        const candidate = bySlug.get(slug);
        return candidate !== undefined && !isRule(candidate);
      });
      const wanted = new Set([...query.gold, ...(query.acceptable ?? [])]);
      const ranking = rankMemories(records, retrievalQuery, workspace)
        .filter((item) => !isRule(item.record))
        .map((item) => item.record.slug);
      const firstGold = ranking.findIndex((slug) => query.gold.includes(slug));
      const rules = records.filter(isRule).map((candidate) => candidate.slug);
      const hasGold = query.gold.length > 0;
      results.push({
        id: query.id,
        kind: query.kind,
        language: query.language,
        recall: hasGold ? query.gold.filter((slug) => shownInFull.has(slug)).length / query.gold.length : null,
        recallSeen: hasGold
          ? query.gold.filter((slug) => shownInFull.has(slug) || listed.has(slug)).length / query.gold.length
          : null,
        precision: knowledge.length > 0 ? knowledge.filter((slug) => wanted.has(slug)).length / knowledge.length : null,
        mrr: hasGold ? (firstGold >= 0 ? 1 / (firstGold + 1) : 0) : null,
        noise: query.kind === "irrelevant" ? knowledge.length : null,
        forbidden: (query.forbidden ?? []).some((slug) => shownInFull.has(slug) || listed.has(slug)),
        ruleRecall: rules.length > 0 ? rules.filter((slug) => shownInFull.has(slug)).length / rules.length : null,
        ruleSeen:
          rules.length > 0
            ? rules.filter((slug) => shownInFull.has(slug) || listed.has(slug)).length / rules.length
            : null,
        chars: context.text.length,
        ms,
        missed: query.gold.filter((slug) => !shownInFull.has(slug)),
        shown: knowledge,
      });
    }
    const group = (key: "kind" | "language") =>
      Object.fromEntries(
        [...new Set(results.map((result) => result[key]))]
          .sort()
          .map((value) => [value, summarize(results.filter((result) => result[key] === value))]),
      );
    (report.sizes as Record<string, unknown>)[String(size)] = {
      storeEntries: Object.fromEntries([...stores].map(([id, records]) => [id, records.length])),
      overall: summarize(results),
      byKind: group("kind"),
      byLanguage: group("language"),
      misses: results
        .filter((result) => result.missed.length > 0)
        .map((result) => ({ id: result.id, missed: result.missed })),
      ...(size === sizes.at(-1)
        ? { perQuery: results.map((result) => ({ id: result.id, shown: result.shown, missed: result.missed })) }
        : {}),
    };
  }

  const out = join(HERE, "results", `${label}.json`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);

  const pct = (value: number | null) => (value === null ? "—" : `${Math.round(value * 100)}%`);
  const num = (value: number | null) => (value === null ? "—" : value.toFixed(2));
  console.log(`memory benchmark: ${label} (${queries.length} queries${split ? `, ${split} split` : ""}) → ${out}`);
  console.log(
    "| entries/project | recall | seen | precision | MRR | noise | forbidden | rules | rules seen | chars | ms p50/p95 |",
  );
  console.log("|---|---|---|---|---|---|---|---|---|---|---|");
  for (const size of sizes) {
    const entry = (report.sizes as Record<string, { overall: ReturnType<typeof summarize> }>)[String(size)];
    const o = entry?.overall;
    if (!o) continue;
    console.log(
      `| ${size === 0 ? "gold only" : size} | ${pct(o.recall)} | ${pct(o.recallSeen)} | ${pct(o.precision)} | ${num(o.mrr)} | ${num(o.noise)} | ${o.forbidden} | ${pct(o.ruleRecall)} | ${pct(o.ruleSeen)} | ${o.chars} | ${o.latencyMs.median.toFixed(1)}/${o.latencyMs.p95.toFixed(1)} |`,
    );
  }
  const largest = (report.sizes as Record<string, { byKind: Record<string, ReturnType<typeof summarize>> }>)[
    String(sizes.at(-1))
  ];
  if (largest) {
    console.log(`\nby kind at ${sizes.at(-1)} entries/project:`);
    for (const [kind, o] of Object.entries(largest.byKind)) {
      console.log(
        `  ${kind.padEnd(15)} n=${String(o.queries).padStart(3)} recall ${pct(o.recall)} seen ${pct(o.recallSeen)} MRR ${num(o.mrr)} forbidden ${o.forbidden}`,
      );
    }
  }
}

await run();
