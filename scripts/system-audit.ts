/** Bounded forensic probes. No provider calls, credentials or user state are read. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { runCommand } from "../src/exec/command";
import { createShellErrorFilter } from "../src/exec/shell";
import { listMemoryRecords, projectMemoryScope, readMemoryIndex } from "../src/memory/store";
import { withIdleWatchdog } from "../src/providers/stream";

const label = process.argv[2] ?? "baseline";
if (!/^[\w-]+$/u.test(label)) throw new Error("Use a simple audit label.");
const repetitions = Number(process.argv.find((arg) => arg.startsWith("--repetitions="))?.split("=")[1] ?? 3);
if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 30) throw new Error("Use repetitions 1–30.");
const trials: Array<Record<string, unknown>> = [];
for (let repeat = 0; repeat < repetitions; repeat++) {
  for (const idleMs of [0, 180_000]) {
    const controller = new AbortController();
    const started = performance.now();
    // A controlled rescue avoids leaving the pre-fix reader suspended forever.
    const source = (async function* () {
      await new Promise((resolve) => setTimeout(resolve, 180));
      yield { type: "text-delta", text: "late" };
    })();
    const timer = setTimeout(() => controller.abort(), 20);
    const parts: unknown[] = [];
    for await (const part of withIdleWatchdog(source, idleMs, controller)) parts.push(part);
    clearTimeout(timer);
    const durationMs = performance.now() - started;
    trials.push({ probe: "cancel-hung-stream", repeat, idleMs, durationMs, passed: durationMs < 100, parts });
  }
  if (process.platform === "win32") {
    const result = await runCommand({
      command: 'bun -e "process.exit(0)"; Get-Item -LiteralPath __shelra_audit_missing__',
      log: false,
      maxMemoryMb: 0,
      timeoutMs: 10_000,
    });
    trials.push({
      probe: "native-success-followed-by-cmdlet-failure",
      repeat,
      durationMs: result.durationMs,
      state: result.state,
      exitCode: result.exitCode,
      passed: result.exitCode !== 0,
      stderrHasError: /Cannot find path|does not exist/iu.test(result.stderr),
    });
  }
  for (const bytes of [1_048_576, 8_388_608]) {
    const filter = createShellErrorFilter();
    const chunk = "x".repeat(4096);
    const start = performance.now();
    let emitted = 0;
    for (let sent = 0; sent < bytes; sent += chunk.length) emitted += filter.push(chunk).length;
    const heldUntilFlush = filter.flush().length;
    trials.push({
      probe: "newline-free-stderr",
      repeat,
      bytes,
      durationMs: performance.now() - start,
      emittedBeforeFlush: emitted,
      heldUntilFlush,
      lossless: emitted + heldUntilFlush === bytes,
    });
  }
}

// Real concurrent Bun processes share one memory directory. Results contain counts only.
const root = mkdtempSync(join(tmpdir(), "shelra-audit-memory-"));
try {
  const module = new URL("../src/memory/store.ts", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/u, "$1");
  const child = join(root, "writer.ts");
  writeFileSync(
    child,
    [
      `import { writeMemoryEntry, projectMemoryScope } from ${JSON.stringify(module)};`,
      "const [root, worker, start] = process.argv.slice(2);",
      "await Bun.sleep(Math.max(0, Number(start) - Date.now()));",
      "let errors = 0; for (let i=0; i<20; i++) { try { writeMemoryEntry(projectMemoryScope(root),",
      '{slug: "worker-"+worker+"-entry-"+i, title: "Worker "+worker+" entry "+i, hook: "Project fact",',
      'type:"architecture", description:"A test fact", body:"Fixture architecture uses API boundaries.", source:"human"});',
      "} catch { errors++; } } console.log(JSON.stringify({errors}));",
    ].join("\n"),
    "utf8",
  );
  for (const concurrency of [1, 3, 5]) {
    for (let repeat = 0; repeat < repetitions; repeat++) {
      const project = join(root, `c-${concurrency}-${repeat}`);
      mkdirSync(project);
      const start = Date.now() + 300;
      const children = Array.from({ length: concurrency }, (_, index) =>
        Bun.spawn([process.execPath, child, project, String(index), String(start)], {
          stdout: "pipe",
          stderr: "pipe",
          env: { ...process.env, SHELRA_DIAGNOSTICS_LOG: "off" },
        }),
      );
      const outputs = await Promise.all(
        children.map(async (proc) => {
          const [stdout, stderr, code] = await Promise.all([
            new Response(proc.stdout).text(),
            new Response(proc.stderr).text(),
            proc.exited,
          ]);
          return { code, errors: code === 0 ? JSON.parse(stdout).errors : 20, stderrBytes: stderr.length };
        }),
      );
      const actual = readMemoryIndex(projectMemoryScope(project)).entries.length;
      const readable = listMemoryRecords(projectMemoryScope(project)).length;
      trials.push({
        probe: "same-project-memory-writers",
        concurrency,
        repeat,
        expected: concurrency * 20,
        actual,
        readable,
        errors: outputs.reduce((sum, x) => sum + x.errors, 0),
        passed: actual === concurrency * 20 && readable === concurrency * 20 && outputs.every((x) => x.errors === 0),
        durationMs: Date.now() - start + 300,
      });
    }
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}
const dir = "bench/history/system-audit";
mkdirSync(dir, { recursive: true });
const result = {
  schemaVersion: 1,
  label,
  at: new Date().toISOString(),
  platform: process.platform,
  runtime: `Bun ${Bun.version}`,
  method: `k=${repetitions}; deterministic bounded fault injection and real local process execution; no LLM quality claim`,
  trials,
};
writeFileSync(join(dir, `${label}.json`), `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(JSON.stringify(result, null, 2));
