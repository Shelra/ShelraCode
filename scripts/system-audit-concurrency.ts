/** Separate real Agent instances, deterministic providers: isolation and a pending provider at 1/3/5. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "shelra-agent-concurrency-"));
process.env.SHELRA_USER_MEMORY_ROOT = join(root, "user");
process.env.SHELRA_TRACE = "off";
process.env.SHELRA_DIAGNOSTICS_LOG = "off";
const { Agent } = await import("../src/agent/agent");
const { FakeProvider } = await import("../src/providers/fake");
const { projectMemoryScope, writeMemoryEntry } = await import("../src/memory/store");
const { loadUserSettings } = await import("../src/utils/settings");
const settings = loadUserSettings();
if (Object.keys(settings.hooks ?? {}).length || settings.mcp?.servers?.some((server) => server.enabled)) {
  rmSync(root, { recursive: true, force: true });
  throw new Error(
    "This controlled probe requires hooks and MCP servers disabled; no external integration was started.",
  );
}
const trials: Record<string, unknown>[] = [];
try {
  for (const concurrency of [1, 3, 5]) {
    for (let repeat = 0; repeat < 3; repeat++) {
      const start = Date.now();
      const agents: InstanceType<typeof Agent>[] = [];
      const observed: Array<{
        index: number;
        foreignMemory: boolean;
        ownMemory: boolean;
        endMs: number;
        answer: string;
      }> = [];
      let stalledEntered = false;
      let stalledAborted = false;
      let stalledAbortMs: number | null = null;
      const markers = Array.from({ length: concurrency }, (_, i) => `ARCHITECTURE_OWNER_${i}_EXCLUSIVE`);
      const tasks = markers.map(async (marker, index) => {
        const workspace = join(root, `${concurrency}-${repeat}-${index}`);
        mkdirSync(workspace);
        writeFileSync(join(workspace, "README.md"), `# Fixture\nArchitecture uses ${marker}.\n`, "utf8");
        writeMemoryEntry(projectMemoryScope(workspace), {
          slug: "architecture-owner",
          title: "Architecture",
          hook: "Project architecture owner",
          type: "architecture",
          description: "Project architecture",
          body: `Project architecture: ${marker}.`,
          source: "human",
        });
        const provider = new FakeProvider(marker);
        const original = provider.stream.bind(provider);
        let foreignMemory = false;
        let ownMemory = false;
        provider.stream = (request) => {
          ownMemory ||= request.system.includes(marker);
          foreignMemory ||= markers.some((other) => other !== marker && request.system.includes(other));
          if (index !== 0) return original(request);
          return {
            events: (async function* () {
              stalledEntered = true;
              await new Promise<void>((resolve) => {
                if (request.signal?.aborted) {
                  resolve();
                  return;
                }
                const abort = () => {
                  stalledAborted = true;
                  stalledAbortMs = Date.now() - start;
                  resolve();
                };
                request.signal?.addEventListener("abort", abort, { once: true });
              });
              yield { type: "abort" as const };
            })(),
            response: Promise.resolve({ messages: [] }),
          };
        };
        const agent = new Agent(undefined, undefined, "audit-fake", 8, {
          cwd: workspace,
          persistSession: false,
          provider,
          ablate: ["research", "ledger", "skills"],
        });
        agents.push(agent);
        const timer = index === 0 ? setTimeout(() => agent.abort(), 400) : undefined;
        let answer = "";
        try {
          for await (const chunk of agent.processMessage("What is this project's architecture?")) {
            if (chunk.type === "content") answer += chunk.content ?? "";
          }
          observed.push({ index, foreignMemory, ownMemory, endMs: Date.now() - start, answer });
        } finally {
          clearTimeout(timer);
        }
      });
      const watchdog = setTimeout(() => {
        for (const agent of agents) agent.abort();
      }, 5_000);
      try {
        await Promise.all(tasks);
      } finally {
        clearTimeout(watchdog);
        for (const agent of agents) await agent.cleanup();
      }
      trials.push({
        concurrency,
        repeat,
        durationMs: Date.now() - start,
        stalledEntered,
        stalledAborted,
        stalledAbortMs,
        completed: observed.length,
        foreignMemoryCount: observed.filter((x) => x.foreignMemory).length,
        ownMemoryCount: observed.filter((x) => x.ownMemory).length,
        unrelatedCompletedBeforeCancellation: observed.filter(
          (x) => x.index > 0 && stalledAbortMs !== null && x.endMs < stalledAbortMs,
        ).length,
        otherAnswersCorrect: observed.filter((x) => x.index > 0 && x.answer.includes(markers[x.index]!)).length,
        canceled: observed.find((x) => x.index === 0)?.answer.includes("[Cancelled]") ?? false,
        endTimesMs: observed.sort((a, b) => a.index - b.index).map((x) => x.endMs),
      });
    }
  }
  mkdirSync("bench/history/system-audit", { recursive: true });
  writeFileSync(
    "bench/history/system-audit/agent-concurrency.json",
    `${JSON.stringify(
      {
        at: new Date().toISOString(),
        runtime: Bun.version,
        limits:
          "Deterministic separate Agent instances, isolated project stores, same process, no SQLite session persistence or real provider load; not a tenant security test.",
        trials,
      },
      null,
      2,
    )}\n`,
  );
  console.log(JSON.stringify(trials));
} finally {
  rmSync(root, { recursive: true, force: true });
}
