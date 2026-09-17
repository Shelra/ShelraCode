import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type {
  BenchmarkAcceptanceResult,
  BenchmarkArtifactRef,
  BenchmarkEvent,
  BenchmarkRunDetails,
  BenchmarkRunSummary,
  BenchmarkTaskResult,
} from "../src/bench/types";
import {
  compareBenchmarkRuns,
  getBenchmarkBaseline,
  getBenchmarkRunDetails,
  listBenchmarkLeaderboard,
  listBenchmarkRuns,
  listBenchmarkVersions,
  recoverInterruptedBenchmarkRuns,
} from "../src/storage/benchmarks";
import { ensureWorkspace } from "../src/storage/workspaces";

const projectRoot = resolve(import.meta.dir, "..");
const dashboardPath = resolve(projectRoot, "bench", "dashboard.html");
const configuredPort = Number(process.env.SHELRA_BENCH_DASHBOARD_PORT ?? "4173");
const port = Number.isInteger(configuredPort) && configuredPort > 0 ? configuredPort : 4173;
const workspace = ensureWorkspace(projectRoot);

const AGENT_REGISTRY = [
  {
    id: "shelra",
    name: "Shelra",
    kind: "subject",
    description: "Harness under improvement",
    sourceUrl: null,
    aliases: ["shelra", "shelracode"],
  },
  {
    id: "claude-code",
    name: "Claude Code",
    kind: "calibration",
    description: "Agentic terminal coding assistant",
    sourceUrl: "https://code.claude.com/docs/en/how-claude-code-works",
    aliases: ["claude", "claude code", "claude-code"],
  },
  {
    id: "codex",
    name: "OpenAI Codex",
    kind: "calibration",
    description: "Open-source terminal coding agent",
    sourceUrl: "https://github.com/openai/codex",
    aliases: ["codex", "openai codex", "codex cli"],
  },
  {
    id: "opencode",
    name: "OpenCode",
    kind: "calibration",
    description: "Open-source agent for terminal, desktop, and IDE",
    sourceUrl: "https://opencode.ai/en/docs",
    aliases: ["opencode", "open code"],
  },
  {
    id: "goose",
    name: "Goose",
    kind: "calibration",
    description: "Extensible open-source agent for code and workflows",
    sourceUrl: "https://goose-docs.ai/",
    aliases: ["goose"],
  },
  {
    id: "aider",
    name: "Aider",
    kind: "calibration",
    description: "Terminal pair-programming agent",
    sourceUrl: "https://aider.chat/",
    aliases: ["aider"],
  },
  {
    id: "cline",
    name: "Cline",
    kind: "calibration",
    description: "Open-source agent for IDE, terminal, and desktop",
    sourceUrl: "https://github.com/Cline/Cline",
    aliases: ["cline"],
  },
  {
    id: "roo-code",
    name: "Roo Code",
    kind: "calibration",
    description: "Model-agnostic VS Code coding agent",
    sourceUrl: "https://roocodeinc.github.io/Roo-Code/",
    aliases: ["roo", "roo code", "roo-code"],
  },
  {
    id: "gemini-cli",
    name: "Gemini CLI",
    kind: "calibration",
    description: "Open-source terminal agent with tools and MCP",
    sourceUrl: "https://docs.cloud.google.com/gemini/docs/codeassist/gemini-cli",
    aliases: ["gemini", "gemini cli", "gemini-cli"],
  },
] as const;

type PublicRun = {
  runId: string;
  runNumber: number;
  status: BenchmarkRunSummary["status"];
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  benchmarkVersion: string;
  suite: string;
  agentName: string;
  leaderboardEligible: boolean;
  agentVersion: string | null;
  model: string | null;
  modelProvider: string | null;
  modelVersion: string | null;
  configurationFingerprint: string;
  repositoryCommit: string | null;
  repositoryDirty: boolean;
  shelraVersion: string | null;
  taskCount: number;
  completedTaskCount: number;
  resolvedTaskCount: number;
  resolvedRate: number | null;
  scores: BenchmarkRunSummary["scores"];
  tokens: BenchmarkRunSummary["tokens"];
  cost: BenchmarkRunSummary["cost"];
  durationMs: number | null;
  failureType: BenchmarkRunSummary["failureType"];
};

function publicRun(run: BenchmarkRunSummary): PublicRun {
  return {
    runId: run.runId,
    runNumber: run.runNumber,
    status: run.status,
    createdAt: run.createdAt.toISOString(),
    startedAt: run.startedAt?.toISOString() ?? null,
    finishedAt: run.finishedAt?.toISOString() ?? null,
    benchmarkVersion: run.benchmarkVersion,
    suite: run.suite,
    agentName: run.agentName,
    leaderboardEligible: run.leaderboardEligible,
    agentVersion: run.agentVersion,
    model: run.model,
    modelProvider: run.modelProvider,
    modelVersion: run.modelVersion,
    configurationFingerprint: run.configurationFingerprint,
    repositoryCommit: run.repositoryCommit,
    repositoryDirty: run.repositoryDirty,
    shelraVersion: run.shelraVersion,
    taskCount: run.taskCount,
    completedTaskCount: run.completedTaskCount,
    resolvedTaskCount: run.resolvedTaskCount,
    resolvedRate: run.resolvedRate,
    scores: run.scores,
    tokens: run.tokens,
    cost: run.cost,
    durationMs: run.durationMs,
    failureType: run.failureType,
  };
}

function publicAcceptance(result: BenchmarkAcceptanceResult) {
  return {
    id: result.id,
    description: result.description,
    status: result.status,
    detail: result.detail ?? null,
    required: result.required ?? null,
    evidenceCount: result.evidence?.length ?? 0,
  };
}

function publicArtifact(artifact: BenchmarkArtifactRef) {
  return {
    kind: artifact.kind,
    label: artifact.label ?? null,
    sha256: artifact.sha256 ?? null,
    bytes: artifact.bytes ?? null,
  };
}

function publicTask(task: BenchmarkTaskResult) {
  return {
    taskId: task.taskId,
    category: task.category,
    difficulty: task.difficulty,
    status: task.status,
    startedAt: task.startedAt?.toISOString() ?? null,
    finishedAt: task.finishedAt?.toISOString() ?? null,
    durationMs: task.durationMs,
    llmDurationMs: task.llmDurationMs,
    toolDurationMs: task.toolDurationMs,
    verificationDurationMs: task.verificationDurationMs,
    repairDurationMs: task.repairDurationMs,
    scores: task.scores,
    tokens: task.tokens,
    cost: task.cost,
    behavior: task.behavior,
    acceptance: task.acceptance.map(publicAcceptance),
    failureType: task.failureType,
    evidence: task.evidence.map(publicArtifact),
  };
}

function publicEvent(event: BenchmarkEvent) {
  return {
    sequence: event.sequence,
    type: event.type,
    at: event.at.toISOString(),
    taskId: event.taskId,
    message: event.message,
  };
}

function publicDetails(details: BenchmarkRunDetails) {
  return {
    run: publicRun(details),
    tasks: details.tasks.map(publicTask),
    events: details.events.map(publicEvent),
    artifacts: details.artifacts.map(publicArtifact),
  };
}

function matchesAgent(agentName: string, aliases: readonly string[]): boolean {
  const normalized = agentName.trim().toLowerCase();
  return aliases.includes(normalized);
}

function latestCompletedEligible(runs: readonly BenchmarkRunSummary[]): BenchmarkRunSummary | null {
  return (
    runs.find(
      (run) => run.status === "completed" && run.leaderboardEligible && typeof run.scores.overall === "number",
    ) ?? null
  );
}

function toVersion(version: { benchmarkVersion: string; suite: string; runCount: number; latestAt: Date }) {
  return {
    benchmarkVersion: version.benchmarkVersion,
    suite: version.suite,
    runCount: version.runCount,
    latestAt: version.latestAt.toISOString(),
  };
}

function buildDashboard(limit: number, offset: number) {
  recoverInterruptedBenchmarkRuns(workspace.id);
  const rows = listBenchmarkRuns({ workspaceId: workspace.id, limit, offset });
  const allRows = offset === 0 ? rows : listBenchmarkRuns({ workspaceId: workspace.id, limit: 500 });
  const latest = latestCompletedEligible(allRows);
  const eligible = allRows.filter(
    (run) => run.status === "completed" && run.leaderboardEligible && typeof run.scores.overall === "number",
  );
  const best = eligible.reduce<BenchmarkRunSummary | null>(
    (current, run) => (!current || (run.scores.overall ?? -1) > (current.scores.overall ?? -1) ? run : current),
    null,
  );
  const baseline = latest
    ? getBenchmarkBaseline({
        workspaceId: workspace.id,
        suite: latest.suite,
        benchmarkVersion: latest.benchmarkVersion,
        agentName: latest.agentName,
        model: latest.model,
        modelProvider: latest.modelProvider,
        modelVersion: latest.modelVersion,
      })
    : null;
  const versions = listBenchmarkVersions(workspace.id).map(toVersion);
  const leaderboard = listBenchmarkLeaderboard({ workspaceId: workspace.id, limit: 100 }).map((entry) => ({
    ...publicRun(entry),
    runCount: entry.runCount,
  }));

  const agents = AGENT_REGISTRY.map((agent) => {
    const measured = allRows.filter((run) => matchesAgent(run.agentName, agent.aliases));
    const eligibleRuns = measured.filter(
      (run) => run.status === "completed" && run.leaderboardEligible && typeof run.scores.overall === "number",
    );
    const latestRun = measured[0] ?? null;
    const bestRun = eligibleRuns.reduce<BenchmarkRunSummary | null>(
      (current, run) => (!current || (run.scores.overall ?? -1) > (current.scores.overall ?? -1) ? run : current),
      null,
    );
    return {
      id: agent.id,
      name: agent.name,
      kind: agent.kind,
      description: agent.description,
      sourceUrl: agent.sourceUrl,
      measuredRunCount: measured.length,
      eligibleRunCount: eligibleRuns.length,
      latestRun: latestRun ? publicRun(latestRun) : null,
      bestRun: bestRun ? publicRun(bestRun) : null,
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    workspace: {
      name: workspace.displayName,
      scope: "current git workspace",
    },
    source: "local SQLite benchmark history",
    realDataOnly: true,
    page: { limit, offset, hasMore: rows.length === limit },
    summary: {
      totalRuns: versions.reduce((sum, version) => sum + version.runCount, 0),
      eligibleRuns: eligible.length,
      latest: latest ? publicRun(latest) : null,
      best: best ? publicRun(best) : null,
      baseline: baseline ? publicRun(baseline) : null,
    },
    versions,
    runs: rows.map(publicRun),
    leaderboard,
    agents,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === "/api/bench/dashboard") {
    const requestedLimit = Number(url.searchParams.get("limit") ?? "500");
    const requestedOffset = Number(url.searchParams.get("offset") ?? "0");
    const limit = Number.isInteger(requestedLimit) ? Math.max(1, Math.min(500, requestedLimit)) : 500;
    const offset = Number.isInteger(requestedOffset) ? Math.max(0, requestedOffset) : 0;
    return json(buildDashboard(limit, offset));
  }

  if (path.startsWith("/api/bench/runs/")) {
    const reference = decodeURIComponent(path.slice("/api/bench/runs/".length));
    const details = getBenchmarkRunDetails(reference);
    if (!details || details.workspaceId !== workspace.id) {
      return json({ error: "Benchmark run not found in the current workspace." }, 404);
    }
    return json(publicDetails(details));
  }

  if (path === "/api/bench/compare") {
    const ids = (url.searchParams.get("ids") ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean)
      .slice(0, 4);
    if (ids.length < 2) return json({ error: "Select at least two real benchmark runs." }, 400);
    try {
      const comparison = compareBenchmarkRuns(ids);
      if (comparison.runs.some((run) => run.workspaceId !== workspace.id)) {
        return json({ error: "Benchmark runs not found in the current workspace." }, 404);
      }
      return json({
        ...comparison,
        runs: comparison.runs.map(publicRun),
      });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  }

  if (path === "/" || path === "/index.html") {
    const html = await readFile(dashboardPath, "utf8");
    return new Response(html, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  }

  return new Response("Not found", { status: 404 });
}

const server = Bun.serve({
  port,
  fetch: handle,
});

console.log(`Shelra Bench dashboard: http://127.0.0.1:${server.port}`);
console.log(`Workspace: ${workspace.displayName}`);
console.log("Source: local SQLite benchmark history");

process.on("SIGINT", () => {
  server.stop();
  process.exit(0);
});
