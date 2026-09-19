import { resolve } from "node:path";
import { observePage } from "../exec/browser";
import { runCommand } from "../exec/command";
import { applyFileEdit, applyFileWrite, deleteFile as removeFile } from "../exec/files";
import { probeHttp } from "../exec/http";
import { setExecLogRoot } from "../exec/logging";
import { ProcessManager } from "../exec/process";
import { isStaticServer, startStaticServer, stopStaticServer } from "../exec/static-server";
import { resolveIntelligenceProvider } from "../intelligence";
import type { IntelligenceProvider } from "../intelligence/types";
import { buildResearchQuery, formatResearchForPrompt, searchWeb, type WebSearchResult } from "../research/web";
import { upsertObjectiveIndex } from "../storage/objectives";
import { ensureWorkspace } from "../storage/workspaces";
import { objectiveRunDir } from "./journal";
import { AutonomyKernel, type KernelDeps, type RuntimeEvent } from "./kernel";
import type { AcceptanceCriterion, Objective } from "./types";

/**
 * Composition root for the autonomy runtime.
 *
 * The kernel is deliberately free of imports from the execution layer; everything it can do
 * to the world arrives as `KernelDeps`. This is the one place those wires are joined, which
 * is what makes the kernel testable with fakes and keeps the intelligence provider swappable.
 */

export interface RunObjectiveOptions {
  workspace: string;
  request: string;
  signal?: AbortSignal;
  maxCostUsd?: number;
  maxRequestCostUsd?: number;
  maxRepairAttempts?: number;
  /** Immutable benchmark-owned checks; these replace model-derived criteria when supplied. */
  acceptanceCriteria?: AcceptanceCriterion[];
  /** Repository root used to resolve benchmark-owned external oracle commands. */
  benchmarkRoot?: string;
  /** Override the provider, primarily for tests and benchmarks. */
  intelligence?: IntelligenceProvider;
  /** Injected research for tests; production runs perform host-side research first. */
  research?: WebSearchResult;
}

/**
 * Indexes an objective's durable state into the shared SQLite store so it is queryable
 * across runs and sessions without loading its file journal — see
 * `docs/architecture/14-AGENT-HARNESS-RECONSTRUCTION.md` §5-6. `--autonomous` runs are not
 * currently associated with a chat session, so `sessionId` is honestly null here; this is
 * the same table `src/agent/agent.ts` writes chat-turn objectives into, which is what makes
 * the two kernels' state cross-referenceable.
 */
function indexObjective(objective: Objective): void {
  try {
    const workspace = ensureWorkspace(objective.workspace);
    upsertObjectiveIndex({
      id: objective.id,
      sessionId: null,
      workspaceId: workspace.id,
      request: objective.request,
      phase: objective.phase,
      stopReason: objective.stopReason ?? null,
      blocker: objective.blocker ?? null,
      runDir: objective.runDir,
    });
  } catch {
    // Indexing must never take down a run; the file journal remains authoritative.
  }
}

export function createKernelDeps(intelligence: IntelligenceProvider, processes: ProcessManager): KernelDeps {
  return {
    onObjectiveChange: indexObjective,
    intelligence,
    runCommand: (command, options) =>
      runCommand({
        command,
        cwd: options.cwd,
        timeoutMs: options.timeoutMs,
        signal: options.signal,
        env: options.env,
      }),
    writeFile: (workspace, path, content) => applyFileWrite(workspace, path, content),
    editFile: (workspace, path, oldText, newText) => applyFileEdit(workspace, path, oldText, newText),
    deleteFile: (workspace, path) => removeFile(workspace, path),
    startProcess: (options) => processes.start(options),
    stopProcess: async (id) => {
      // A served static directory and a spawned dev server are both "the app" to the kernel.
      if (isStaticServer(id)) {
        await stopStaticServer(id);
        return;
      }
      await processes.stop(id);
    },
    probeHttp: (url) => probeHttp(url),
    observePage: (url, options) => observePage(url, options),
    serveStatic: (dir) => startStaticServer(dir),
  };
}

/**
 * Run one objective to a stop condition.
 *
 * Yields plain-language progress events; the final event carries the outcome, including the
 * verification report and the intelligence ledger.
 */
export async function* runObjective(options: RunObjectiveOptions): AsyncGenerator<RuntimeEvent, void, void> {
  const workspace = resolve(options.workspace);
  const intelligence = options.intelligence ?? (await resolveIntelligenceProvider());

  let research = options.research;
  if (!research) {
    yield { type: "detail", message: "Researching current documentation and technical references" };
    const query = buildResearchQuery(options.request);
    try {
      research = await searchWeb(query, { signal: options.signal, maxResults: 5 });
    } catch (error) {
      research = {
        success: false,
        query,
        provider: "unavailable",
        sources: [],
        output: "",
        error: error instanceof Error ? error.message : String(error),
      };
    }
    yield {
      type: "detail",
      message: research.success
        ? `Research complete via ${research.provider} (${research.sources.length} source(s))`
        : `Research unavailable; continuing with repository evidence${research.error ? `: ${research.error}` : "."}`,
    };
  }

  const availability = await intelligence.checkAvailability();
  if (!availability.available) {
    yield {
      type: "complete",
      phase: "stopped",
      message: `Intelligence provider unavailable: ${availability.detail}`,
    };
    return;
  }

  const processes = new ProcessManager();
  const deps = createKernelDeps(intelligence, processes);
  const kernel = new AutonomyKernel(deps, {
    workspace,
    request: options.request,
    signal: options.signal,
    maxCostUsd: options.maxCostUsd,
    maxRequestCostUsd: options.maxRequestCostUsd,
    maxRepairAttempts: options.maxRepairAttempts,
    acceptanceCriteria: options.acceptanceCriteria,
    benchmarkRoot: options.benchmarkRoot,
    researchContext: formatResearchForPrompt(research),
  });

  // Keep command logs and screenshots next to the objective's journal.
  setExecLogRoot(objectiveRunDir(workspace, kernel.getObjective().id));

  try {
    yield* kernel.run();
  } finally {
    await processes.stopAll().catch(() => {});
  }
}

export type { RuntimeEvent } from "./kernel";
export type { ObjectiveOutcome } from "./types";
