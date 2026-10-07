/**
 * How long the synchronous work at the start of a turn blocks the event loop, on a project with a realistic
 * amount of memory: every millisecond here is a millisecond the terminal cannot redraw, type or cancel.
 *
 *   bun run scripts/perf/turn-setup.ts            (SHELRA_PERF_ENTRIES=250 SHELRA_PERF_EPISODES=400)
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const scratch = mkdtempSync(join(tmpdir(), "shelra-turn-setup-"));
const home = join(scratch, "home");
const project = join(scratch, "project");
mkdirSync(home, { recursive: true });
mkdirSync(project, { recursive: true });
process.env.HOME = home;
process.env.USERPROFILE = home;
process.env.SHELRA_TRACE = "off";

const { projectMemoryScope, writeMemoryEntry } = await import("../../src/memory/store");
const { appendEpisode } = await import("../../src/memory/episodes");
const { memoryContextFor, buildSystemPrompt } = await import("../../src/agent/prompts");
const { discoverSkills } = await import("../../src/utils/skills");
const store = await import("../../src/memory/store");
const episodesModule = await import("../../src/memory/episodes");
const retrieval = await import("../../src/memory/retrieval");
const docsIndex = await import("../../src/memory/docs-index");

const ENTRIES = Number(process.env.SHELRA_PERF_ENTRIES ?? 250);
const EPISODES = Number(process.env.SHELRA_PERF_EPISODES ?? 400);
const DOCS = Number(process.env.SHELRA_PERF_DOCS ?? 60);

const scope = projectMemoryScope(project);
const types = ["architecture", "testing", "conventions", "failure", "debugging", "preference"] as const;
for (let i = 0; i < ENTRIES; i += 1) {
  const result = writeMemoryEntry(scope, {
    slug: `entry-${i}`,
    title: `Entry ${i} about module ${i % 17}`,
    hook: `What to know about the ${["parser", "router", "cache", "auth", "queue", "billing"][i % 6]} number ${i}`,
    type: types[i % types.length] as (typeof types)[number],
    description: `Notes ${i}`,
    body: `The module ${i % 17} handles request ${i}. ${"It validates the input, calls the service and records the result. ".repeat(12)}`,
    source: i % 5 === 0 ? "human" : "inference",
    confidence: 0.8,
    relatedFiles: [`src/module-${i % 17}.ts`],
  });
  if (!result.ok) {
    console.error(`memory index full after ${i} entries (${result.reason}); continuing with what fits`);
    break;
  }
}
for (let i = 0; i < EPISODES; i += 1) {
  appendEpisode(scope, {
    at: new Date(Date.now() - (EPISODES - i) * 600_000).toISOString(),
    session: `s${i % 20}`,
    outcome: i % 7 === 0 ? "failed" : "verified",
    request: `Fix the ${["parser", "router", "cache", "auth", "queue"][i % 5]} bug number ${i} in module ${i % 17}`,
    summary: `Changed src/module-${i % 17}.ts and ran the tests. ${"Details of what happened. ".repeat(6)}`,
    files: [`src/module-${i % 17}.ts`, `tests/module-${i % 17}.test.ts`],
    failures: i % 7 === 0 ? [{ command: "bun test", error: "expected 1 received 2", fixedBy: "bun test" }] : [],
    toolCalls: 12,
  } as Parameters<typeof appendEpisode>[1]);
}
mkdirSync(join(project, "docs"), { recursive: true });
for (let i = 0; i < DOCS; i += 1) {
  writeFileSync(
    join(project, "docs", `doc-${i}.md`),
    `# Document ${i}\n\n${"The parser and the router talk to the cache. ".repeat(80)}\n`,
  );
}
writeFileSync(join(project, "README.md"), `# Project\n\n${"A service that does things. ".repeat(30)}\n`);
writeFileSync(join(project, "package.json"), JSON.stringify({ name: "p", scripts: { test: "bun test" } }));
for (let i = 0; i < 12; i += 1) {
  const dir = join(project, ".agents", "skills", `skill-${i}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "SKILL.md"),
    `---\nname: skill-${i}\ndescription: Does thing ${i} for the project.\n---\n\nSteps.\n`,
  );
}

function timed<T>(fn: () => T): { ms: number; value: T } {
  const started = performance.now();
  const value = fn();
  return { ms: performance.now() - started, value };
}

const request = "Fix the parser bug where the cache returns stale data for module 5";
const rows: Record<string, number[]> = { memoryContextFor: [], discoverSkills: [], buildSystemPrompt: [] };
for (let run = 0; run < 6; run += 1) {
  rows.memoryContextFor?.push(timed(() => memoryContextFor(project, request)).ms);
  rows.discoverSkills?.push(timed(() => discoverSkills(project)).ms);
  rows.buildSystemPrompt?.push(timed(() => buildSystemPrompt(project, "agent", "off")).ms);
}
const summary = Object.fromEntries(
  Object.entries(rows).map(([name, values]) => [
    name,
    {
      first: Math.round(values[0] ?? 0),
      median: Math.round([...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0),
      max: Math.round(Math.max(...values)),
    },
  ]),
);
// Where memoryContextFor spends its time, one call at a time.
{
  const parts: Record<string, number> = {};
  const t = (name: string, fn: () => unknown) => {
    const started = performance.now();
    fn();
    parts[name] = Math.round((performance.now() - started) * 10) / 10;
  };
  let projectRecords: ReturnType<typeof store.listMemoryRecords> = [];
  for (let warm = 0; warm < 2; warm += 1) {
    t("listMemoryRecords", () => {
      projectRecords = store.listMemoryRecords(scope);
    });
    t("listUserMemoryRecords", () => store.listUserMemoryRecords());
    t("listArchivedEntries", () => store.listArchivedEntries(scope));
    t("readEpisodes(400)", () => episodesModule.readEpisodes(scope, 400));
    t("readPlanEpisodes", () => episodesModule.readPlanEpisodes(scope));
    t("buildMemoryContext", () =>
      retrieval.buildMemoryContext([...projectRecords], { text: request, paths: [] }, project, { archived: [] }),
    );
    t("refreshDocIndex", () => docsIndex.refreshDocIndex(scope, project));
  }
  console.log(JSON.stringify({ partsMsSecondCall: parts }, null, 2));
}
console.log(JSON.stringify({ entries: ENTRIES, episodes: EPISODES, docs: DOCS, blockedMs: summary }, null, 2));
try {
  rmSync(scratch, { recursive: true, force: true });
} catch {
  /* the store can still be open on Windows */
}
