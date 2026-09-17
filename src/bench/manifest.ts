import { readFileSync } from "node:fs";
import type { CheckSpec, DomCheck } from "../autonomy/types";
import { resolveBenchmarkPath, sanitizeJsonObject } from "./environment";
import { normalizeBenchmarkScore } from "./scoring";
import type {
  BenchmarkAcceptanceCriterion,
  BenchmarkDimension,
  BenchmarkJson,
  BenchmarkJsonObject,
  BenchmarkManifest,
  BenchmarkScorePolicy,
  BenchmarkTaskCategory,
  BenchmarkTaskDefinition,
} from "./types";

export const DEFAULT_BENCHMARK_MANIFEST = ".shelra/bench/manifest.json";

const TASK_CATEGORIES: readonly BenchmarkTaskCategory[] = [
  "coding",
  "agentic",
  "intent",
  "verification",
  "research",
  "memory",
  "repair",
  "efficiency",
];

export function loadBenchmarkManifest(cwd: string, candidate = DEFAULT_BENCHMARK_MANIFEST): BenchmarkManifest {
  const manifestPath = resolveBenchmarkPath(cwd, candidate);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(manifestPath, "utf8")) as unknown;
  } catch (error) {
    throw new Error(
      `Could not read benchmark manifest ${manifestPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const manifest = parseManifest(parsed);
  return {
    ...manifest,
    config: {
      ...(manifest.config ?? {}),
      manifestPath,
    },
  };
}

export function parseManifest(value: unknown): BenchmarkManifest {
  if (!isRecord(value)) throw new Error("Benchmark manifest must be a JSON object.");

  const benchmarkVersion = requiredString(value.benchmarkVersion, "benchmarkVersion");
  const suite = requiredString(value.suite, "suite");
  if (!Array.isArray(value.tasks)) throw new Error("Benchmark manifest tasks must be an array.");

  const ids = new Set<string>();
  const tasks = value.tasks.map((task, index) => {
    const parsedTask = parseTask(task, index);
    if (ids.has(parsedTask.id)) throw new Error(`Benchmark manifest contains duplicate task id "${parsedTask.id}".`);
    ids.add(parsedTask.id);
    return parsedTask;
  });

  const scorePolicy = value.scorePolicy === undefined ? undefined : parseScorePolicy(value.scorePolicy);
  const oracleMode = value.oracleMode === undefined ? undefined : parseOracleMode(value.oracleMode);
  if (oracleMode === "benchmark-owned") {
    for (const task of tasks) {
      if (!task.acceptanceCriteria || task.acceptanceCriteria.length === 0) {
        throw new Error(`Benchmark task "${task.id}" must define acceptanceCriteria in benchmark-owned mode.`);
      }
      if (task.acceptanceCriteria.some((criterion) => !criterion.check)) {
        throw new Error(`Benchmark task "${task.id}" has an acceptance criterion without a deterministic check.`);
      }
    }
  }
  const seed = typeof value.seed === "string" || typeof value.seed === "number" ? value.seed : undefined;
  if (value.config !== undefined && !isRecord(value.config)) throw new Error("config must be an object.");
  const config = value.config === undefined ? undefined : sanitizeJsonObject(value.config);

  return {
    benchmarkVersion,
    suite,
    ...(oracleMode ? { oracleMode } : {}),
    tasks,
    ...(scorePolicy ? { scorePolicy } : {}),
    ...(seed === undefined ? {} : { seed }),
    ...(config ? { config } : {}),
  };
}

function parseTask(value: unknown, index: number): BenchmarkTaskDefinition {
  if (!isRecord(value)) throw new Error(`Benchmark task ${index + 1} must be an object.`);
  const category = requiredString(value.category, `tasks[${index}].category`);
  if (!TASK_CATEGORIES.includes(category as BenchmarkTaskCategory)) {
    throw new Error(`Benchmark task ${index + 1} has unsupported category "${category}".`);
  }

  const task: BenchmarkTaskDefinition = {
    id: requiredString(value.id, `tasks[${index}].id`),
    category: category as BenchmarkTaskCategory,
    difficulty: requiredString(value.difficulty, `tasks[${index}].difficulty`),
    prompt: requiredString(value.prompt, `tasks[${index}].prompt`),
  };
  if (value.acceptanceCriteria !== undefined) {
    if (!Array.isArray(value.acceptanceCriteria)) {
      throw new Error(`tasks[${index}].acceptanceCriteria must be an array.`);
    }
    const criterionIds = new Set<string>();
    task.acceptanceCriteria = value.acceptanceCriteria.map((criterion, criterionIndex) => {
      if (!isRecord(criterion)) {
        throw new Error(`tasks[${index}].acceptanceCriteria[${criterionIndex}] must be an object.`);
      }
      const parsedCriterion: BenchmarkAcceptanceCriterion = {
        id: requiredString(criterion.id, `tasks[${index}].acceptanceCriteria[${criterionIndex}].id`),
        description: requiredString(
          criterion.description,
          `tasks[${index}].acceptanceCriteria[${criterionIndex}].description`,
        ),
        ...(criterion.required === false ? { required: false } : {}),
      };
      if (criterion.check !== undefined) {
        parsedCriterion.check = parseCheckSpec(
          criterion.check,
          `tasks[${index}].acceptanceCriteria[${criterionIndex}].check`,
        );
      }
      if (criterionIds.has(parsedCriterion.id)) {
        throw new Error(
          `Benchmark task ${task.id} contains duplicate acceptance criterion id "${parsedCriterion.id}".`,
        );
      }
      criterionIds.add(parsedCriterion.id);
      return parsedCriterion;
    });
  }
  if (typeof value.workspaceTemplate === "string") task.workspaceTemplate = value.workspaceTemplate.trim();
  if (typeof value.workspace === "string") task.workspace = value.workspace;
  if (typeof value.workspaceFrom === "string") task.workspaceFrom = value.workspaceFrom.trim();
  if (value.memoryPolicy !== undefined) {
    if (value.memoryPolicy !== "keep" && value.memoryPolicy !== "wipe") {
      throw new Error(`tasks[${index}].memoryPolicy must be "keep" or "wipe".`);
    }
    task.memoryPolicy = value.memoryPolicy;
  }
  if (task.workspaceFrom && task.workspaceTemplate) {
    throw new Error(`tasks[${index}] cannot set both workspaceTemplate and workspaceFrom.`);
  }
  if (typeof value.researchRequired === "boolean") task.researchRequired = value.researchRequired;
  if (typeof value.memoryRequired === "boolean") task.memoryRequired = value.memoryRequired;
  if (typeof value.repairExpected === "boolean") task.repairExpected = value.repairExpected;
  if (isRecord(value.metadata)) task.metadata = sanitizeJsonObject(value.metadata);
  return task;
}

function parseOracleMode(value: unknown): "benchmark-owned" | "agent-derived" {
  if (value === "benchmark-owned" || value === "agent-derived") return value;
  throw new Error('oracleMode must be "benchmark-owned" or "agent-derived".');
}

function parseCheckSpec(value: unknown, field: string): CheckSpec {
  if (!isRecord(value)) throw new Error(`${field} must be an object.`);
  const kind = requiredString(value.kind, `${field}.kind`);
  switch (kind) {
    case "file_exists":
      return { kind, path: requiredString(value.path, `${field}.path`) };
    case "files_exist":
      return { kind, paths: requiredStringArray(value.paths, `${field}.paths`) };
    case "file_contains":
      return {
        kind,
        path: requiredString(value.path, `${field}.path`),
        pattern: requiredString(value.pattern, `${field}.pattern`),
        ...(value.ignoreCase === true ? { ignoreCase: true } : {}),
      };
    case "no_external_urls":
      return {
        kind,
        ...(value.paths === undefined ? {} : { paths: requiredStringArray(value.paths, `${field}.paths`) }),
      };
    case "command_succeeds":
      return {
        kind,
        command: requiredString(value.command, `${field}.command`),
        ...(optionalPositiveInteger(value.timeoutMs, `${field}.timeoutMs`) === undefined
          ? {}
          : { timeoutMs: optionalPositiveInteger(value.timeoutMs, `${field}.timeoutMs`) }),
        ...(typeof value.expectExitCode === "number" && Number.isInteger(value.expectExitCode)
          ? { expectExitCode: value.expectExitCode }
          : {}),
      };
    case "http_ok":
      return {
        kind,
        path: typeof value.path === "string" ? value.path : "/",
        ...(typeof value.expectStatus === "number" && Number.isInteger(value.expectStatus)
          ? { expectStatus: value.expectStatus }
          : {}),
      };
    case "dom":
      return {
        kind,
        assertion: parseDomCheck(value.assertion, `${field}.assertion`),
        ...(value.viewport === "mobile" || value.viewport === "desktop" ? { viewport: value.viewport } : {}),
      };
    case "no_console_errors":
      return { kind };
    case "no_external_requests":
      return { kind };
    case "no_horizontal_overflow":
      if (value.viewport !== "mobile" && value.viewport !== "desktop") {
        throw new Error(`${field}.viewport must be "mobile" or "desktop".`);
      }
      return {
        kind,
        viewport: value.viewport,
        ...(typeof value.tolerancePx === "number" && Number.isFinite(value.tolerancePx)
          ? { tolerancePx: value.tolerancePx }
          : {}),
      };
    case "judge":
      return { kind, question: requiredString(value.question, `${field}.question`) };
    default:
      throw new Error(`${field}.kind has unsupported value "${kind}".`);
  }
}

function parseDomCheck(value: unknown, field: string): DomCheck {
  if (!isRecord(value)) throw new Error(`${field} must be an object.`);
  const assertion: DomCheck = { description: requiredString(value.description, `${field}.description`) };
  if (typeof value.selector === "string") assertion.selector = value.selector;
  if (typeof value.minCount === "number" && Number.isInteger(value.minCount) && value.minCount >= 0) {
    assertion.minCount = value.minCount;
  }
  if (typeof value.textContains === "string") assertion.textContains = value.textContains;
  if (typeof value.expression === "string") assertion.expression = value.expression;
  if (optionalPositiveInteger(value.waitForChangeMs, `${field}.waitForChangeMs`) !== undefined) {
    assertion.waitForChangeMs = optionalPositiveInteger(value.waitForChangeMs, `${field}.waitForChangeMs`);
  }
  return assertion;
}

function requiredStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error(`${field} must be a non-empty array of strings.`);
  }
  return value.map((item) => (item as string).trim());
}

function optionalPositiveInteger(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive integer.`);
  }
  return value;
}

function parseScorePolicy(value: unknown): BenchmarkScorePolicy {
  if (!isRecord(value)) throw new Error("scorePolicy must be an object.");
  const id = requiredString(value.id, "scorePolicy.id");
  const version = requiredString(value.version, "scorePolicy.version");
  if (!isRecord(value.weights)) throw new Error("scorePolicy.weights must be an object.");

  const weights: Partial<Record<BenchmarkDimension, number>> = {};
  for (const [dimension, rawWeight] of Object.entries(value.weights)) {
    if (!isBenchmarkDimension(dimension)) throw new Error(`scorePolicy has unknown dimension "${dimension}".`);
    if (typeof rawWeight !== "number" || !Number.isFinite(rawWeight) || rawWeight < 0) {
      throw new Error(`scorePolicy weight for "${dimension}" must be a non-negative number.`);
    }
    weights[dimension] = rawWeight;
  }

  const policy: BenchmarkScorePolicy = { id, version, weights };
  if (Array.isArray(value.requiredDimensions)) {
    policy.requiredDimensions = value.requiredDimensions.map((dimension, index) => {
      if (typeof dimension !== "string" || !isBenchmarkDimension(dimension)) {
        throw new Error(`scorePolicy.requiredDimensions[${index}] is not a benchmark dimension.`);
      }
      return dimension;
    });
  }
  if (value.correctnessFloor !== undefined) {
    const floor = normalizeBenchmarkScore(value.correctnessFloor);
    if (floor === undefined) throw new Error("scorePolicy.correctnessFloor must be a finite number.");
    policy.correctnessFloor = floor;
  }
  if (typeof value.note === "string") policy.note = value.note;
  return policy;
}

function isBenchmarkDimension(value: string): value is BenchmarkDimension {
  return ["overall", ...TASK_CATEGORIES].includes(value as BenchmarkDimension);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${field} must be a non-empty string.`);
  return value.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function manifestSummary(manifest: BenchmarkManifest): BenchmarkJsonObject {
  return {
    ...(manifest.config ?? {}),
    benchmarkVersion: manifest.benchmarkVersion,
    suite: manifest.suite,
    ...(manifest.oracleMode ? { oracleMode: manifest.oracleMode } : {}),
    taskCount: manifest.tasks.length,
    taskDefinitions: manifest.tasks as unknown as BenchmarkJson[],
    ...(manifest.seed === undefined ? {} : { seed: manifest.seed }),
    ...(manifest.scorePolicy ? { scorePolicy: manifest.scorePolicy as unknown as BenchmarkJsonObject } : {}),
  };
}
