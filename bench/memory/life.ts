/**
 * A project's life, simulated (docs/architecture/18-MEMORY-V2.md §4.6): does memory behave like a person's? Deterministic,
 * no model, no disk, and faithful to what the product does (review round 3 found an earlier version that handed each
 * recall to the entry the simulation knew was needed, which the product cannot know):
 *
 * - every request goes through the same buildMemoryContext a turn uses; being shown is exposure only;
 * - the agent can use what it needed only when it was shown (in full, or as a pointer it can memory_read); using it
 *   means running the command the entry names, and the entries that name a command that passed are strengthened by
 *   the same rule the store applies (namedCommands, as in reconfirmByPassingCommands);
 * - once a month, consolidation archives what faded (hasFaded, as in consolidateMemory).
 *
 * The control replays the same days with no strengthening and no fading.
 *
 *   bun run bench/memory/life.ts
 *
 * habit first: requests where a habit (needed every few days) and a look-alike note (the same index line, never
 * used) both match, share where the habit ranks above the note. kept: what matters still in the store at the end.
 * faded: notes archived. brought back: requests about a faded note that are offered it.
 */
import { hasFaded, withRecall } from "../../src/memory/dynamics";
import { buildMemoryContext } from "../../src/memory/retrieval";
import { namedCommands } from "../../src/memory/store";
import type { MemoryRecord, MemorySource, MemoryType } from "../../src/memory/types";

const DAY = 24 * 60 * 60_000;
const START = Date.parse("2026-01-05T09:00:00Z");
const DAYS = 240;
const WORKSPACE = "/nonexistent-workspace";

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
  const source: MemorySource = kind === "rule" ? "human" : kind === "lesson" ? "observed" : "inference";
  const type: MemoryType = kind === "rule" ? "preference" : kind === "lesson" ? "failure" : "conventions";
  // A habit and its look-alike note have the same index line: a request about the topic matches both alike. Only a
  // procedure names a command, which a turn that needs it runs.
  const hook = `${topic} notes for the ${topic} module`;
  const body =
    kind === "noise"
      ? `Notes on the ${topic} module layout, written while exploring it once.`
      : `Before changing the ${topic} module run \`make ${topic}-setup\`; it seeds what its tests read.`;
  return {
    kind,
    topic,
    archived: false,
    record: {
      slug,
      index: { title: `${topic} ${kind === "noise" ? "notes" : "procedure"}`, file: `${slug}.md`, hook },
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
        body,
      },
    },
  };
}

function run(dynamic: boolean) {
  const random = prng(7);
  const topics = Array.from({ length: 30 }, (_, index) => `mod${index}`);
  const sims: Sim[] = [];
  // Ten habits, each with a look-alike note named so that a tie goes to the note; ten rarely needed procedures;
  // ten more notes; three rules; three costly lessons nobody asks about again.
  for (const [index, topic] of topics.slice(0, 10).entries()) {
    sims.push(entry(`zz-habit-${index}`, "habit", topic, START));
    sims.push(entry(`aa-note-${index}`, "noise", topic, START));
  }
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
  let usedWhenShown = 0;
  let needs = 0;
  for (let day = 1; day <= DAYS; day += 1) {
    const now = START + day * DAY;
    // A habit is needed about every three days; a rare procedure twice in the whole period.
    const needed = sims.filter(
      (sim) =>
        !sim.archived &&
        ((sim.kind === "habit" && random() < 0.33) ||
          (sim.kind === "rare" && (day === 60 + Number(sim.record.slug.slice(5)) || day === 150))),
    );
    for (const sim of needed) {
      needs += 1;
      const current = sims.filter((item) => !item.archived);
      const context = buildMemoryContext(
        current.map((item) => item.record),
        { text: `fix the ${sim.topic} module`, now },
        WORKSPACE,
      );
      const shown = [...context.expanded, ...context.listed];
      if (sim.kind === "habit") {
        const twin = current.find((item) => item.kind === "noise" && item.topic === sim.topic);
        const habitAt = shown.indexOf(sim.record.slug);
        const twinAt = twin ? shown.indexOf(twin.record.slug) : -1;
        habitAsked += 1;
        if (habitAt >= 0 && (twinAt < 0 || habitAt < twinAt)) habitFirst += 1;
      }
      // The agent used the procedure it needed if memory showed it; the command it ran passed.
      if (!shown.includes(sim.record.slug)) continue;
      usedWhenShown += 1;
      if (!dynamic) continue;
      const ran = namedCommands(sim.record.entry.body)[0];
      for (const item of current) {
        if (ran && namedCommands(`${item.record.index.hook}\n${item.record.entry.body}`).includes(ran)) {
          const meta = item.record.entry.frontmatter.metadata;
          meta.recalls = withRecall(meta.recalls, new Date(now));
        }
      }
    }
    if (dynamic && day % 30 === 0) {
      for (const sim of sims) {
        if (!sim.archived && hasFaded(sim.record.entry.frontmatter.metadata, now)) sim.archived = true;
      }
    }
  }
  const end = START + DAYS * DAY;
  const kept = (kind: Kind) => sims.filter((sim) => sim.kind === kind && !sim.archived).length;
  const total = (kind: Kind) => sims.filter((sim) => sim.kind === kind).length;
  const faded = sims.filter((sim) => sim.archived);
  let broughtBack = 0;
  for (const sim of faded) {
    const context = buildMemoryContext(
      sims.filter((item) => !item.archived).map((item) => item.record),
      { text: `${sim.topic} notes for the ${sim.topic} module`, now: end },
      WORKSPACE,
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
    usedWhenShown: needs > 0 ? usedWhenShown / needs : 0,
    kept: {
      rules: `${kept("rule")}/${total("rule")}`,
      lessons: `${kept("lesson")}/${total("lesson")}`,
      habits: `${kept("habit")}/${total("habit")}`,
      rare: `${kept("rare")}/${total("rare")}`,
    },
    faded: `${faded.filter((sim) => sim.kind === "noise").length}/${total("noise")}`,
    fadedOther: faded.filter((sim) => sim.kind !== "noise").length,
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
  "| | habit first | needed and shown | rules kept | lessons kept | habits kept | rare kept | notes faded | other faded | store at end | faded brought back |",
);
console.log("|---|---|---|---|---|---|---|---|---|---|---|");
for (const [label, result] of [
  ["with dynamics", withDynamics],
  ["without (control)", without],
] as const) {
  console.log(
    `| ${label} | ${pct(result.habitFirst)} (${result.habitAsked}) | ${pct(result.usedWhenShown)} | ${result.kept.rules} | ${result.kept.lessons} | ${result.kept.habits} | ${result.kept.rare} | ${result.faded} | ${result.fadedOther} | ${result.storeAtEnd} | ${result.broughtBack} |`,
  );
}
