/**
 * Benchmark-owned oracle for the polyglot suite (scripts/build-polyglot-suite.ts).
 *
 * Runs the exercise's tests in the graded workspace after restoring every test file from the
 * pristine fixture, so a solution that edited or deleted the tests is graded against the real
 * ones. Exit code is the test runner's exit code.
 *
 *   bun run bench/oracles/polyglot.ts <language> <exercise>   (cwd = the workspace)
 */

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

interface ExerciseFixtureMeta {
  solution: string[];
  test: string[];
  testCommand: string;
}

const [language, exercise] = process.argv.slice(2);
if (!language || !exercise) {
  console.error("usage: bun run bench/oracles/polyglot.ts <language> <exercise>");
  process.exit(2);
}

const workspace = resolve(process.env.SHELRA_BENCH_WORKSPACE ?? process.cwd());
const benchmarkRoot = resolve(process.env.SHELRA_BENCH_ROOT ?? join(import.meta.dir, "..", ".."));
const fixture = join(benchmarkRoot, "bench", "fixtures", "polyglot", language, exercise);
const metaFile = join(fixture, ".polyglot.json");
if (!existsSync(metaFile)) {
  console.error(`Fixture metadata missing: ${metaFile}. Run scripts/build-polyglot-suite.ts first.`);
  process.exit(2);
}
const meta = JSON.parse(readFileSync(metaFile, "utf8")) as ExerciseFixtureMeta;

for (const testFile of meta.test) {
  const target = join(workspace, testFile);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(join(fixture, testFile), target);
}
for (const solutionFile of meta.solution) {
  if (!existsSync(join(workspace, solutionFile))) {
    console.error(`Solution file missing from the workspace: ${solutionFile}`);
    process.exit(1);
  }
}

const outcome = spawnSync(meta.testCommand, { cwd: workspace, shell: true, stdio: "inherit" });
process.exit(outcome.status ?? 1);
