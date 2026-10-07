import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { invalidateSettingsCache } from "./settings";
import { invalidateSkills, selectSkills, skillIndex } from "./skills";

/**
 * How well the lexical selection picks the skill a request needs, and stays silent otherwise, on a realistic catalog
 * written the way people write skill descriptions (English and Spanish mixed). It measures; the thresholds are what the
 * product promises, and a change to the matching must not lower them.
 */
const SKILLS: Array<[string, string]> = [
  [
    "frontend-performance",
    "Diagnose UI freezes, slow rendering and layout thrashing in a frontend by measuring first. Use when the interface lags or scrolls badly.",
  ],
  [
    "database-migrations",
    "Plan, write and review SQL schema migrations and rollbacks for the database, including data backfills.",
  ],
  ["release-notes", "Write release notes and a changelog from merged pull requests when preparing a release."],
  ["code-review", "Review a pull request or a diff for correctness, security problems and style before merging."],
  ["api-design", "Design REST API endpoints, request and response shapes, error formats and versioning."],
  ["test-writing", "Write unit and integration tests for new or changed code, with fixtures and edge cases."],
  [
    "debugging-flaky-tests",
    "Find the cause of flaky or intermittent test failures: races, timing, shared state and order dependence.",
  ],
  ["docker-deploy", "Build container images and deploy the service with Docker and compose, including health checks."],
  [
    "security-audit",
    "Audit code and dependencies for vulnerabilities: injection, secrets, unsafe deserialization, outdated packages.",
  ],
  [
    "accesibilidad-web",
    "Revisar la accesibilidad de una interfaz web: etiquetas, contraste, navegación con teclado y lectores de pantalla.",
  ],
  ["optimizacion-sql", "Optimizar consultas SQL lentas: planes de ejecución, índices y reescritura de consultas."],
  [
    "git-history-cleanup",
    "Clean up git history: squash commits, rewrite messages, split a branch into reviewable pieces.",
  ],
  [
    "performance-profiling-backend",
    "Profile a backend service for CPU, memory and latency hot spots and report measured numbers.",
  ],
  [
    "documentation-writing",
    "Write and restructure project documentation: README, how-to guides and architecture notes.",
  ],
];

// [request, expected skill or null when no skill applies]
const CASES: Array<[string, string | null]> = [
  ["the interface lags when I scroll the long list", "frontend-performance"],
  ["la interfaz se congela y el renderizado va lento", "frontend-performance"],
  ["add a migration that adds a column to the users table and backfills it", "database-migrations"],
  ["necesito una migración de base de datos con rollback", "database-migrations"],
  ["prepare the release notes and changelog for version 2.3", "release-notes"],
  ["prepara las notas de la versión y el changelog", "release-notes"],
  ["review this pull request before we merge it", "code-review"],
  ["revisa este diff antes de fusionar, busca problemas de seguridad", "code-review"],
  ["design the REST endpoints for orders with error formats", "api-design"],
  ["write unit tests for the new parser with edge cases", "test-writing"],
  ["escribe pruebas unitarias para el nuevo módulo", "test-writing"],
  ["this test fails intermittently, I think it is a race condition", "debugging-flaky-tests"],
  ["el test falla de forma intermitente, a veces pasa y a veces no", "debugging-flaky-tests"],
  ["build the docker image and deploy the service with compose", "docker-deploy"],
  ["audit the dependencies for vulnerabilities and leaked secrets", "security-audit"],
  ["revisa la accesibilidad de la web: contraste y navegación con teclado", "accesibilidad-web"],
  ["optimiza esta consulta SQL lenta, revisa los índices", "optimizacion-sql"],
  ["squash these commits and rewrite the messages", "git-history-cleanup"],
  ["profile the backend: where is the CPU and memory going", "performance-profiling-backend"],
  ["restructure the README and write an architecture guide", "documentation-writing"],
  // No skill applies: silence is the right answer.
  ["rename this variable in the parser", null],
  ["what is the weather like today", null],
  ["hello", null],
  ["tell me a joke about cats", null],
  ["explain what a closure is in JavaScript", null],
  ["cuál es la capital de Francia", null],
  ["add a console log to this function", null],
  ["fix the typo on line 12", null],
  ["thanks, that works", null],
  ["muéstrame el contenido de package.json", null],
  ["what time is it", null],
  ["undo the last change", null],
  ["sí, hazlo", null],
  ["run it again", null],
  ["delete the unused import", null],
  ["cambia el color del botón a verde", null],
];

let scratch = "";
let project = "";
const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), "shelra-selection-"));
  project = join(scratch, "project");
  mkdirSync(join(project, ".git"), { recursive: true });
  mkdirSync(join(scratch, "home"), { recursive: true });
  process.env.HOME = join(scratch, "home");
  process.env.USERPROFILE = join(scratch, "home");
  for (const [name, description] of SKILLS) {
    const dir = join(project, ".shelra", "skills", name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\n# ${name}\nSteps.\n`);
  }
  invalidateSkills();
  invalidateSettingsCache();
});
afterAll(() => {
  process.env.HOME = saved.HOME;
  process.env.USERPROFILE = saved.USERPROFILE;
  rmSync(scratch, { recursive: true, force: true });
});

describe("skill selection on a realistic bilingual catalog", () => {
  it("picks the right skill first and stays silent when none applies", () => {
    const index = skillIndex(project);
    let relevant = 0;
    let found = 0;
    let silentCases = 0;
    let silentCorrect = 0;
    const misses: string[] = [];
    const falseAlarms: string[] = [];
    const wrongTop: string[] = [];
    for (const [request, expected] of CASES) {
      const picked = selectSkills(index, request, { limit: 3 });
      if (expected === null) {
        silentCases++;
        if (picked.length === 0) silentCorrect++;
        else falseAlarms.push(`${request} -> ${picked.map((match) => match.record.name).join(",")}`);
      } else {
        relevant++;
        if (picked.some((match) => match.record.name === expected)) found++;
        else
          misses.push(
            `${request} (wanted ${expected}, got ${picked.map((match) => match.record.name).join(",") || "nothing"})`,
          );
        if (picked.length > 0 && picked[0]?.record.name !== expected)
          wrongTop.push(`${request} -> ${picked[0]?.record.name}`);
      }
    }
    const recall = found / relevant;
    const silence = silentCorrect / silentCases;
    console.log(
      `selection: recall ${(recall * 100).toFixed(0)}% (${found}/${relevant}), silent on irrelevant ${(silence * 100).toFixed(0)}% (${silentCorrect}/${silentCases}), wrong first pick ${wrongTop.length}`,
    );
    if (misses.length) console.log(`misses:\n  ${misses.join("\n  ")}`);
    if (falseAlarms.length) console.log(`false alarms:\n  ${falseAlarms.join("\n  ")}`);
    expect(silence, falseAlarms.join(" | ")).toBe(1);
    expect(recall, misses.join(" | ")).toBeGreaterThanOrEqual(0.85);
    expect(wrongTop.length, wrongTop.join(" | ")).toBeLessThanOrEqual(1);
  });
});
