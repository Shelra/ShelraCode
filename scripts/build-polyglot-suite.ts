/**
 * Build a Shelra Bench suite from the public aider "polyglot" task set (Exercism practice
 * exercises curated by Aider-AI, MIT-licensed code, CC-BY-SA instructions), pinned to one
 * upstream commit so every run measures the same tasks.
 *
 * Why generated instead of committed: the fixtures are third-party text and code, ~80 small
 * directories per language pair, and they are fully reproducible from the pinned commit. The
 * generated fixtures, the JavaScript test dependencies, and the manifest all live in gitignored
 * paths; only this script and the oracle are versioned.
 *
 * Protocol note (bench/README.md): aider's own harness gives the model two attempts with test
 * output fed back between them and reports "pass rate 2". Shelra's agent runs the tests itself
 * inside one session, so its number is a single-session pass rate on the same task set, not a
 * leaderboard-comparable score.
 *
 *   bun run scripts/build-polyglot-suite.ts --languages javascript,python --sample 16
 *   bun run src/index.ts bench --manifest bench/suites/polyglot-js-py-sample16-v0.1.json --json
 */

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const UPSTREAM_URL = "https://github.com/Aider-AI/polyglot-benchmark";
const UPSTREAM_COMMIT = "7e0611e77b54e2dea774cdc0aa00cf9f7ed6144f";
const SUITE_VERSION = "0.1.0";

interface LanguageSpec {
  /** Directory name in the upstream repository. */
  dir: string;
  /** Command the agent is told to run, and the visible acceptance criterion. Runs in the workspace. */
  testCommand: (testFiles: string[]) => string;
  /** Test files arrive with most cases skipped upstream; the benchmark enables all of them. */
  enableSkippedTests?: (source: string) => string;
}

const LANGUAGES: Record<string, LanguageSpec> = {
  javascript: {
    dir: "javascript",
    testCommand: () => "npm test",
    enableSkippedTests: (source) =>
      source
        .replace(/\bxtest\(/gu, "test(")
        .replace(/\bxit\(/gu, "it(")
        .replace(/\bxdescribe\(/gu, "describe("),
  },
  python: {
    dir: "python",
    testCommand: (testFiles) => `python -m pytest -o markers=task -q ${testFiles.join(" ")}`,
  },
};

interface ExerciseConfig {
  files: { solution: string[]; test: string[]; example?: string[] };
  blurb?: string;
}

interface ExerciseFixtureMeta {
  language: string;
  exercise: string;
  solution: string[];
  test: string[];
  testCommand: string;
  upstreamCommit: string;
}

interface Args {
  languages: string[];
  sample: number | null;
  out: string | null;
  root: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { languages: ["javascript", "python"], sample: null, out: null, root: resolve(".") };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === "--languages" && value) {
      args.languages = value.split(",").map((entry) => entry.trim());
      index += 1;
    } else if (flag === "--sample" && value) {
      args.sample = Number.parseInt(value, 10);
      index += 1;
    } else if (flag === "--out" && value) {
      args.out = value;
      index += 1;
    } else if (flag === "--root" && value) {
      args.root = resolve(value);
      index += 1;
    }
  }
  for (const language of args.languages) {
    if (!LANGUAGES[language]) throw new Error(`Unsupported language: ${language}`);
  }
  return args;
}

function run(command: string, cwd: string): void {
  const outcome = spawnSync(command, { cwd, shell: true, stdio: "inherit" });
  if (outcome.status !== 0) throw new Error(`Command failed (${outcome.status}): ${command}`);
}

function ensureUpstream(root: string): string {
  const upstream = join(root, ".shelra", "bench", "polyglot-upstream");
  if (!existsSync(join(upstream, ".git"))) {
    mkdirSync(upstream, { recursive: true });
    run("git init -q", upstream);
    run(`git remote add origin ${UPSTREAM_URL}`, upstream);
  }
  const head = spawnSync("git rev-parse HEAD", { cwd: upstream, shell: true, encoding: "utf8" });
  if (head.stdout.trim() !== UPSTREAM_COMMIT) {
    run(`git fetch -q --depth 1 origin ${UPSTREAM_COMMIT}`, upstream);
    run("git checkout -q FETCH_HEAD", upstream);
  }
  return upstream;
}

function ensureJavaScriptDependencies(root: string, upstream: string): void {
  const shared = join(root, ".shelra", "bench");
  if (existsSync(join(shared, "node_modules", "jest"))) return;
  // One exercise's package.json declares the jest/babel toolchain every exercise uses. Installed
  // once at an ancestor of every benchmark workspace: Node resolves modules and npm resolves
  // `node_modules/.bin` by walking up from the workspace, so `npm test` works without a per-task
  // install and without copying node_modules into fixtures.
  const practice = join(upstream, "javascript", "exercises", "practice");
  const first = readdirSync(practice).sort()[0];
  if (!first) throw new Error("No JavaScript exercises found upstream");
  const pkg = JSON.parse(readFileSync(join(practice, first, "package.json"), "utf8")) as {
    devDependencies: Record<string, string>;
  };
  mkdirSync(shared, { recursive: true });
  writeFileSync(
    join(shared, "package.json"),
    `${JSON.stringify({ name: "shelra-bench-shared", private: true, devDependencies: pkg.devDependencies }, null, 2)}\n`,
  );
  run("npm install --no-audit --no-fund --loglevel=error", shared);
}

function listExercises(upstream: string, language: string): string[] {
  const practice = join(upstream, LANGUAGES[language].dir, "exercises", "practice");
  return readdirSync(practice, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/** Deterministic, evenly spaced sample so a partial run still spans the alphabet. */
function sample<T>(items: T[], count: number): T[] {
  if (count >= items.length) return items;
  const picked: T[] = [];
  for (let index = 0; index < count; index += 1) {
    picked.push(items[Math.floor((index * items.length) / count)]);
  }
  return picked;
}

function readDoc(dir: string, name: string): string {
  const file = join(dir, ".docs", name);
  return existsSync(file) ? readFileSync(file, "utf8").trim() : "";
}

function buildPrompt(exerciseDir: string, meta: ExerciseFixtureMeta): string {
  const docs = ["introduction.md", "instructions.md", "instructions.append.md"]
    .map((name) => readDoc(exerciseDir, name))
    .filter(Boolean)
    .join("\n\n");
  return [
    docs,
    "####",
    `Use the above instructions to modify the supplied files: ${meta.solution.join(", ")}. Don't change the names of existing functions or classes, as they may be referenced from other code like unit tests, etc. Only use standard libraries, don't suggest installing any packages.`,
    `The tests live in ${meta.test.join(", ")}; do not modify them. Run \`${meta.testCommand}\` before completing.`,
  ].join("\n\n");
}

function buildFixture(upstream: string, root: string, language: string, exercise: string): ExerciseFixtureMeta {
  const spec = LANGUAGES[language];
  const source = join(upstream, spec.dir, "exercises", "practice", exercise);
  const config = JSON.parse(readFileSync(join(source, ".meta", "config.json"), "utf8")) as ExerciseConfig;
  const fixture = join(root, "bench", "fixtures", "polyglot", language, exercise);
  rmSync(fixture, { recursive: true, force: true });
  cpSync(source, fixture, {
    recursive: true,
    filter: (path) => {
      const name = basename(path);
      // `.meta` holds the reference solution; it must never reach a workspace.
      return name !== ".meta" && name !== "node_modules";
    },
  });
  if (spec.enableSkippedTests) {
    for (const testFile of config.files.test) {
      const file = join(fixture, testFile);
      writeFileSync(file, spec.enableSkippedTests(readFileSync(file, "utf8")));
    }
  }
  const meta: ExerciseFixtureMeta = {
    language,
    exercise,
    solution: config.files.solution,
    test: config.files.test,
    testCommand: spec.testCommand(config.files.test),
    upstreamCommit: UPSTREAM_COMMIT,
  };
  writeFileSync(join(fixture, ".polyglot.json"), `${JSON.stringify(meta, null, 2)}\n`);
  return meta;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const upstream = ensureUpstream(args.root);
  if (args.languages.includes("javascript")) ensureJavaScriptDependencies(args.root, upstream);

  const tasks: Array<Record<string, unknown>> = [];
  for (const language of args.languages) {
    const all = listExercises(upstream, language);
    const perLanguage = args.sample === null ? all.length : Math.ceil(args.sample / args.languages.length);
    for (const exercise of sample(all, perLanguage)) {
      const meta = buildFixture(upstream, args.root, language, exercise);
      const fixtureDir = join(args.root, "bench", "fixtures", "polyglot", language, exercise);
      tasks.push({
        id: `${language}-${exercise}`,
        category: "coding",
        difficulty: "exercism",
        workspaceTemplate: `bench/fixtures/polyglot/${language}/${exercise}`,
        prompt: buildPrompt(fixtureDir, meta),
        acceptanceCriteria: [
          {
            id: "AC-ORACLE",
            description: `The pristine ${language} tests for ${exercise} pass against the submitted solution files.`,
            check: {
              kind: "command_succeeds",
              command: `bun run {{benchmarkRoot}}/bench/oracles/polyglot.ts ${language} ${exercise}`,
              timeoutMs: 300_000,
            },
          },
          {
            id: "AC-TESTS",
            description: "The exercise's visible tests pass in the workspace.",
            check: { kind: "command_succeeds", command: meta.testCommand, timeoutMs: 300_000 },
          },
        ],
        metadata: { language, exercise, upstreamCommit: UPSTREAM_COMMIT },
      });
    }
  }

  const label = args.sample === null ? "" : `-sample${args.sample}`;
  const languagesLabel = args.languages.map((language) => (language === "javascript" ? "js" : "py")).join("-");
  const out =
    args.out ??
    `bench/suites/polyglot-${languagesLabel}${label}-v${SUITE_VERSION.split(".").slice(0, 2).join(".")}.json`;
  const manifest = {
    benchmarkVersion: SUITE_VERSION,
    suite: `polyglot-${languagesLabel}${label}`,
    oracleMode: "benchmark-owned",
    seed: `polyglot-${UPSTREAM_COMMIT.slice(0, 12)}`,
    config: {
      purpose: "Measure Shelra's product path on a public task set: the aider polyglot Exercism exercises.",
      subject: "agent_harness",
      modelRole: "controlled_variable",
      workspaceMode: "fresh_template_copy",
      oracle: "external_deterministic_oracle",
      leaderboardEligible: false,
      minimumTaskCount: tasks.length,
      note: `Generated from ${UPSTREAM_URL} at ${UPSTREAM_COMMIT}. Single-session protocol: the agent runs the tests itself; not comparable with aider's two-attempt "pass rate 2".`,
    },
    scorePolicy: {
      id: "polyglot-provisional",
      version: "1",
      weights: { coding: 0.45, intent: 0.35, verification: 0.2 },
      requiredDimensions: ["coding", "intent", "verification"],
      correctnessFloor: 70,
      note: "Same provisional policy as shelra-agent-core: correctness dominates, efficiency never compensates.",
    },
    tasks,
  };
  mkdirSync(join(args.root, "bench", "suites"), { recursive: true });
  writeFileSync(join(args.root, out), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(
    `Wrote ${out} with ${tasks.length} tasks (${args.languages.join(", ")}) from ${UPSTREAM_COMMIT.slice(0, 12)}.`,
  );
}

main();
