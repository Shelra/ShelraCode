/**
 * Measures what the legacy skills catalog, instruction loader and hook lookup cost per call, with a fixture of
 * N skills (default 500). Run: `bun run scripts/perf/extensions-baseline.ts` (SHELRA_PERF_SKILLS=<n>).
 * HOME/USERPROFILE point at a scratch folder, so nothing of the person's own settings is read or written.
 * The numbers printed are measurements on this machine, not estimates.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

const skillCount = Number(process.env.SHELRA_PERF_SKILLS ?? 500);
const scratch = mkdtempSync(join(tmpdir(), "shelra-perf-ext-"));
const home = join(scratch, "home");
const project = join(scratch, "project");
mkdirSync(home, { recursive: true });
mkdirSync(join(project, ".git"), { recursive: true });
process.env.HOME = home;
process.env.USERPROFILE = home;
process.env.SHELRA_DIAGNOSTICS_LOG = "off";
process.env.SHELRA_TRACE = "off";

const skillsRoot = join(project, ".agents", "skills");
for (let i = 0; i < skillCount; i++) {
  const name = `fixture-skill-${String(i).padStart(4, "0")}`;
  const dir = join(skillsRoot, name);
  mkdirSync(dir, { recursive: true });
  const body = `# ${name}\n\n${"Step one: do the thing carefully.\n".repeat(60)}`;
  writeFileSync(
    join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: Fixture skill number ${i} for topic-${i % 37} work, used by the performance benchmark only.\n---\n\n${body}`,
  );
}

function time<T>(label: string, runs: number, fn: () => T): { label: string; ms: number; last: T } {
  fn();
  const start = performance.now();
  let last = fn();
  for (let i = 1; i < runs; i++) last = fn();
  const ms = (performance.now() - start) / runs;
  console.log(`${label.padEnd(58)} ${ms.toFixed(3)} ms/call`);
  return { label, ms, last };
}

const { discoverSkills, formatSkillsForPrompt } = await import("../../src/utils/skills");
const { loadCustomInstructions } = await import("../../src/utils/instructions");
const { loadHooksConfig } = await import("../../src/hooks/config");

console.log(`fixture: ${skillCount} skills in ${skillsRoot}`);
time("legacy discoverSkills (sync scan of every skill)", 10, () => discoverSkills(project));
const catalog = time("legacy discoverSkills + formatSkillsForPrompt", 10, () =>
  formatSkillsForPrompt(discoverSkills(project)),
);
console.log(`legacy catalog injected into EVERY system prompt: ${(catalog.last ?? "").length} characters`);
time("legacy loadCustomInstructions (AGENTS.md chain)", 200, () => loadCustomInstructions(project));
time("legacy loadHooksConfig (sync user-settings read per tool call)", 500, () => loadHooksConfig());

// What replaced them (src/extend/): an index built once from the first bytes of each SKILL.md and cached, a bounded
// catalog, instructions rebuilt from their files, hooks resolved by file signature.
const { skillIndex, formatSkillCatalog, refreshSkillIndex, invalidateSkills, selectSkills } = await import(
  "../../src/extend/skills"
);
const { loadInstructionSet } = await import("../../src/extend/instructions");
const { resolveHooks } = await import("../../src/hooks/config");
const { buildSystemPrompt } = await import("../../src/agent/prompts");

console.log("--- after (src/extend)");
invalidateSkills();
const coldStart = performance.now();
const index = skillIndex(project);
console.log(
  `${"extend skillIndex, cold (first build, once per session)".padEnd(58)} ${(performance.now() - coldStart).toFixed(3)} ms`,
);
const request = "the UI freezes and rendering is slow";
const bounded = time("extend skillIndex (cached) + formatSkillCatalog", 200, () =>
  formatSkillCatalog(skillIndex(project), request),
);
console.log(
  `extend catalog injected into the system prompt: ${(bounded.last ?? "").length} characters (legacy: ${(catalog.last ?? "").length})`,
);
time("extend selectSkills (inverted index)", 200, () => selectSkills(index, request));
const refreshStart = performance.now();
const refreshed = await refreshSkillIndex(project);
console.log(
  `${"extend refreshSkillIndex (once per turn, async stats)".padEnd(58)} ${(performance.now() - refreshStart).toFixed(3)} ms (rebuilt: ${refreshed})`,
);
time("extend loadInstructionSet (SHELRA.md chain + rules)", 200, () => loadInstructionSet(project));
time("extend resolveHooks (signature-cached, per tool call)", 500, () => resolveHooks(project));
const prompt = time("buildSystemPrompt end to end (catalog + instructions + agents)", 20, () =>
  buildSystemPrompt(
    project,
    "agent",
    "off",
    undefined,
    undefined,
    undefined,
    { text: "", expanded: [], listed: [] },
    undefined,
    { root: project, request },
  ),
);
console.log(`system prompt size with ${skillCount} skills installed: ${(prompt.last ?? "").length} characters`);

rmSync(scratch, { recursive: true, force: true });
