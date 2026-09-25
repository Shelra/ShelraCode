/**
 * A project's life, simulated (docs/architecture/18-MEMORY-V2.md §4.6): does memory behave like a person's? Deterministic,
 * no model, no disk. Over 240 days a store receives requests; each recall strengthens what it recalled, and a monthly
 * consolidation lets what nobody used fade. The same days are replayed without dynamics (every entry as strong as any
 * other, nothing fades) as the control.
 *
 *   bun run bench/memory/life.ts
 *
 * - habit first: requests that match a habit (needed every few days) and a never-used note equally well, share of them
 *   where the habit ranks first;
 * - kept: what matters (the user's rules, costly lessons, habits, the rarely needed) still in the store at the end;
 * - faded: never-used inference notes archived by the end (the store stays small and sharp);
 * - brought back: requests for a faded note that are offered it (forgetting without losing).
 */
import { hasFaded, withRecall } from "../../src/memory/dynamics";
import { buildMemoryContext, rankMemories } from "../../src/memory/retrieval";
import type { MemoryRecord, MemorySource, MemoryType } from "../../src/memory/types";

const DAY = 24 * 60 * 60_000;
const START = Date.parse("2026-01-05T09:00:00Z");
const DAYS = 240;

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

type Kind = "habit" | "rare" | "noise" | "rule" | "lesson";

interface Sim {
  record: MemoryRecord;
  kind: Kind;
  topic: string;
  archived: boolean;
}

function entry(slug: string, kind: Kind, topic: string, created: number): Sim {
  // A habit and a never-used note are the same kind of entry, word for word: only their history tells them apart.
  const source: MemorySource = kind === "rule" ? "human" : kind === "lesson" ? "observed" : "inference";
  const type: MemoryType = kind === "rule" ? "preference" : kind === "lesson" ? "failure" : "conventions";
  // A habit and a never-used note share their topic word: a request about the topic matches both equally.
  const hook = `${topic} notes for the ${topic} module`;
  return {
    kind,
    topic,
    archived: false,
    record: {
      slug,
      index: { title: `${topic} ${kind}`, file: `${slug}.md`, hook },
      entry: {
        frontmatter: {
          name: slug,
          description: hook,
          metadata: {
            type,
            source,
            confidence: 0.7,
            created: new Date(created).toISOString(),
            modified: new Date(created).toISOString(),
            ...(kind === "lesson" ? { importance: 0.8 } : {}),
            ...(kind === "rule" ? { tags: ["user-directive"] } : {}),
          },
        },
        body: `${hook}. Details about the ${topic} module that a later task in it needs.`,
      },
    },
  };
}

function run(dynamic: boolean) {
  const random = prng(7);
  const topics = Array.from({ length: 30 }, (_, index) => `mod${index}`);
  const sims: Sim[] = [];
  // Ten habits, each with a never-used note on the same topic; ten rarely needed entries; ten more notes; three rules;
  // three costly lessons nobody asks about again.
  topics.slice(0, 10).forEach((topic, index) => {
    // Named so that a tie goes to the note: without dynamics the habit has nothing to win it with.
    sims.push(entry(`zz-habit-${index}`, "habit", topic, START));
    sims.push(entry(`aa-note-${index}`, "noise", topic, START));
  });
  for (const [index, topic] of topics.slice(10, 20).entries()) sims.push(entry(`rare-${index}`, "rare", topic, START));
  for (const [index, topic] of topics.slice(20, 30).entries()) {
    sims.push(entry(`noise-x${index}`, "noise", topic, START));
  }
  for (const [index, topic] of ["rulea", "ruleb", "rulec"].entries()) {
    sims.push(entry(`rule-${index}`, "rule", topic, START));
  }
  for (const [index, topic] of ["crasha", "crashb", "crashc"].entries()) {
    sims.push(entry(`lesson-${index}`, "lesson", topic, START));
  }

  let habitFirst = 0;
  let habitAsked = 0;
  for (let day = 1; day <= DAYS; day += 1) {
    const now = START + day * DAY;
    const current = sims.filter((sim) => !sim.archived);
    // A habit is needed about every three days; a rare entry twice in the whole period.
    const needed = current.filter(
      (sim) =>
        (sim.kind === "habit" && random() < 0.33) ||
        (sim.kind === "rare" && (day === 60 + Number(sim.record.slug.slice(5)) || day === 150)),
    );
    for (const sim of needed) {
      const records = current.map((item) => item.record);
      const ranked = rankMemories(records, { text: `fix the ${sim.topic} module`, now }, "/nonexistent-workspace");
      if (sim.kind === "habit") {
        habitAsked += 1;
        if (ranked[0]?.record.slug === sim.record.slug) habitFirst += 1;
      }
      if (dynamic) {
        const meta = sim.record.entry.frontmatter.metadata;
        meta.recalls = withRecall(meta.recalls, new Date(now));
      }
    }
    // Monthly consolidation.
    if (dynamic && day % 30 === 0) {
      for (const sim of current) if (hasFaded(sim.record.entry.frontmatter.metadata, now)) sim.archived = true;
    }
  }
  const end = START + DAYS * DAY;
  const kept = (kind: Kind) => sims.filter((sim) => sim.kind === kind && !sim.archived).length;
  const total = (kind: Kind) => sims.filter((sim) => sim.kind === kind).length;
  const faded = sims.filter((sim) => sim.kind === "noise" && sim.archived);
  // Asking for what a faded note was about offers it back.
  let broughtBack = 0;
  for (const sim of faded) {
    const current = sims.filter((item) => !item.archived).map((item) => item.record);
    const context = buildMemoryContext(
      current,
      { text: `${sim.topic} notes for the ${sim.topic} module`, now: end },
      "/nonexistent-workspace",
      {
        archived: faded.map((item) => ({
          slug: item.record.slug,
          title: item.record.index.title,
          hook: item.record.index.hook,
        })),
      },
    );
    if (context.faded?.includes(sim.record.slug)) broughtBack += 1;
  }
  return {
    habitFirst: habitAsked > 0 ? habitFirst / habitAsked : 0,
    habitAsked,
    kept: {
      rules: `${kept("rule")}/${total("rule")}`,
      lessons: `${kept("lesson")}/${total("lesson")}`,
      habits: `${kept("habit")}/${total("habit")}`,
      rare: `${kept("rare")}/${total("rare")}`,
    },
    faded: `${faded.length}/${total("noise")}`,
    storeAtEnd: sims.filter((sim) => !sim.archived).length,
    storeAtStart: sims.length,
    broughtBack: faded.length > 0 ? `${broughtBack}/${faded.length}` : "—",
  };
}

const withDynamics = run(true);
const without = run(false);
const pct = (value: number) => `${Math.round(value * 100)}%`;
console.log(`A project's life: ${DAYS} days, ${withDynamics.storeAtStart} entries at the start`);
console.log(
  "| | habit first | rules kept | lessons kept | habits kept | rare kept | notes faded | store at end | faded brought back |",
);
console.log("|---|---|---|---|---|---|---|---|---|");
for (const [label, result] of [
  ["with dynamics", withDynamics],
  ["without (control)", without],
] as const) {
  console.log(
    `| ${label} | ${pct(result.habitFirst)} (${result.habitAsked}) | ${result.kept.rules} | ${result.kept.lessons} | ${result.kept.habits} | ${result.kept.rare} | ${result.faded} | ${result.storeAtEnd} | ${result.broughtBack} |`,
  );
}
