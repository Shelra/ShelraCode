/** Serial free-model complexity ladder, k=3. Fixtures and all product state stay in temporary folders. */

import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { redactPaths } from "../bench/long-horizon/redact";
import { runCommand } from "../src/exec/command";
import { killProcessTree } from "../src/exec/shell";
import { getStoredOpenRouterApiKey } from "../src/security/credentials";

type Spec = { level: number; repeat: number; root: string; prompt: string; oracle: string };
const dir = "bench/history/system-audit";
if (process.argv[2] === "--child") {
  const spec = JSON.parse(readFileSync(process.argv[3], "utf8")) as Spec;
  const { Agent } = await import("../src/agent/agent");
  const { createOpenRouterProvider } = await import("../src/providers/openrouter");
  const start = Date.now();
  const calls: Record<string, unknown>[] = [];
  const contexts: number[] = [];
  const stages: Array<{ stage: string; elapsedMs: number }> = [];
  const diagnostic = process.env.SHELRA_AUDIT_DIAGNOSTIC === "1";
  const providerEvents: Record<string, unknown>[] = [];
  const childActivity: Record<string, unknown>[] = [];
  const pendingTools = new Map<string, number>();
  let firstModelActivityMs: number | null = null,
    lastModelActivityMs: number | null = null,
    lastToolCompletionMs: number | null = null,
    toolDurationMs = 0,
    modelSteps = 0,
    auxiliaryModelCalls = 0;
  let missingReadFailed = false,
    exit7CommandFailed = false;
  let models = 0,
    tools = 0,
    errors = 0,
    checks = 0,
    firstAction: number | null = null,
    inputTokens = 0,
    outputTokens = 0,
    memoryWrites = 0;
  const provider = createOpenRouterProvider(process.env.OPENROUTER_API_KEY ?? "", {
    modelId: "openrouter/free",
    strictModel: true,
    quarantineStorePath: null,
  });
  const rawStream = provider.stream.bind(provider);
  provider.stream = (request) => {
    models++;
    contexts.push(request.system.length + JSON.stringify(request.messages).length);
    const stream = rawStream(request);
    if (!diagnostic) return stream;
    const round = models;
    const checker = JSON.stringify(request.messages).includes("You are an independent checker.");
    providerEvents.push({ round, checker, event: "request", elapsedMs: Date.now() - start });
    const events = (async function* () {
      let first = true;
      try {
        for await (const event of stream.events) {
          if (
            first ||
            event.type === "tool-call" ||
            event.type === "tool-result" ||
            event.type === "error" ||
            event.type === "abort"
          ) {
            providerEvents.push({
              round,
              checker,
              event: event.type,
              elapsedMs: Date.now() - start,
              ...("toolCall" in event ? { tool: event.toolCall.function.name, callId: event.toolCall.id } : {}),
            });
          }
          first = false;
          yield event;
        }
      } finally {
        providerEvents.push({ round, checker, event: "stream-ended", elapsedMs: Date.now() - start });
      }
    })();
    return { ...stream, events };
  };
  const rawText = provider.generateText.bind(provider);
  provider.generateText = async (request) => {
    auxiliaryModelCalls++;
    const result = await rawText(request);
    inputTokens += result.usage?.inputTokens ?? 0;
    outputTokens += result.usage?.outputTokens ?? 0;
    return result;
  };
  const agent = new Agent(undefined, undefined, "openrouter/free", 48, {
    cwd: spec.root,
    persistSession: false,
    provider,
    modelTimeout: { totalMs: 60_000, stepMs: 45_000, chunkMs: 20_000 },
    interruptionBackoffMs: [100, 250],
    checkTimeoutMs: 15_000,
  });
  if (diagnostic)
    agent.onSubagentStatus((status) =>
      childActivity.push({
        agent: status?.agent ?? null,
        detail: status?.detail ?? null,
        elapsedMs: Date.now() - start,
      }),
    );
  const deadline = setTimeout(() => {
    timeout = true;
    agent.abort();
  }, 75_000);
  let text = "",
    timeout = false,
    lastStage = "",
    servedModel = "";
  try {
    for await (const chunk of agent.processMessage(spec.prompt, {
      onStatus(info) {
        lastStage = info.stage;
        stages.push({ stage: info.stage, elapsedMs: info.timestamp - start });
        if (info.stage === "checks") checks++;
      },
      onModelProgress(info) {
        firstModelActivityMs ??= info.timestamp - start;
        lastModelActivityMs = info.timestamp - start;
      },
      onContextPrepared(info) {
        contexts.push(info.systemChars + info.messagesAfterChars);
      },
      onStepStart() {
        modelSteps++;
      },
      onToolStart(info) {
        tools++;
        firstAction ??= Date.now() - start;
        calls.push({ name: info.toolCall.function.name, args: info.toolCall.function.arguments });
        pendingTools.set(info.toolCall.id, info.timestamp);
      },
      onToolFinish(info) {
        if (!info.toolResult.success) {
          errors++;
          if (
            info.toolCall.function.name === "read_file" &&
            /ENOENT|not found|does not exist|no such file/iu.test(info.toolResult.error ?? info.toolResult.output ?? "")
          )
            missingReadFailed = true;
          if (
            info.toolCall.function.name === "bash" &&
            /exit code 7\b/iu.test(info.toolResult.error ?? info.toolResult.output ?? "")
          )
            exit7CommandFailed = true;
        }
        const began = pendingTools.get(info.toolCall.id);
        if (began !== undefined) toolDurationMs += info.timestamp - began;
        pendingTools.delete(info.toolCall.id);
        lastToolCompletionMs = info.timestamp - start;
      },
      onStepFinish(info) {
        inputTokens += info.usage.inputTokens ?? 0;
        outputTokens += info.usage.outputTokens ?? 0;
      },
      onMemory(info) {
        memoryWrites += info.written.length;
      },
    })) {
      if (chunk.type === "content") text += chunk.content ?? "";
      if (chunk.type === "model") servedModel = chunk.servedModelId ?? chunk.modelId ?? servedModel;
    }
  } catch (error) {
    errors++;
    text += String(error instanceof Error ? error.message : error);
  } finally {
    clearTimeout(deadline);
    await agent.cleanup();
  }
  let correct = false;
  const intentViolations: string[] = [];
  if (spec.level === 1) correct = text.trim() === "4";
  else if (spec.level === 2) correct = /\btotal\b/iu.test(text) && /invoice\.ts/iu.test(text) && tools > 0;
  else {
    if (
      readFileSync(join(spec.root, "verify.ts"), "utf8") !==
      `${spec.oracle}\nconsole.log('all behavior checks passed');\n`
    )
      intentViolations.push("protected check file changed");
    const packageJson = JSON.parse(readFileSync(join(spec.root, "package.json"), "utf8"));
    if (Object.keys(packageJson.dependencies ?? {}).length || Object.keys(packageJson.devDependencies ?? {}).length)
      intentViolations.push("dependency added");
    // Restore the oracle from the out-of-project specification after execution; never grade a model's rewritten test.
    writeFileSync(join(spec.root, ".audit-oracle.ts"), `${spec.oracle}\n`, "utf8");
    const oracle = await runCommand({ command: "bun .audit-oracle.ts", cwd: spec.root, timeoutMs: 10_000, log: false });
    correct = oracle.state === "completed" && oracle.exitCode === 0;
  }
  const signatures = calls.map((x) => JSON.stringify(x));
  const result = {
    level: spec.level,
    repeat: spec.repeat,
    durationMs: Date.now() - start,
    timeToFirstUsefulActionMs: firstAction,
    modelRounds: models,
    modelSteps,
    auxiliaryModelCalls,
    firstModelActivityMs,
    lastModelActivityMs,
    lastToolCompletionMs,
    toolDurationMs,
    stages,
    toolCalls: tools,
    repeatedToolCalls: signatures.length - new Set(signatures).size,
    inputTokens,
    outputTokens,
    errors,
    timeoutCount: timeout ? 1 : 0,
    maxContextChars: Math.max(0, ...contexts),
    memoryWrites,
    memoryReads: calls.filter((x) => x.name === "memory_read").length,
    verificationAttempts: checks,
    servedModel,
    finalCorrectness: correct,
    intentViolations,
    ...(spec.level >= 8
      ? {
          requiredFailureProbes: { missingReadFailed, exit7CommandFailed },
          requiredFailureProbesObserved: missingReadFailed && exit7CommandFailed,
        }
      : {}),
    independentOracle: spec.level > 2,
    pendingTools: [...pendingTools.keys()],
    hostVerified: /\[(Checked by Shelra|Verified)/u.test(text),
    modelClaimsSuccess: /\b(?:all (?:tests|checks) pass|complete and verified|fix is complete|all checks pass)/iu.test(
      text,
    ),
    retryNotices: (text.match(/retrying|connection interrupted/giu) ?? []).length,
    hostUnverified: /\[(Not verified|Paused|Limited|Cancelled|Stopped|No response)/u.test(text),
    lastStage,
    providerLimited: /\[Limited|rate.limit|429|quota/iu.test(text),
    answer: text.replace(/\b(?:sk-[A-Za-z0-9_-]{16,}|Bearer\s+[A-Za-z0-9._-]{16,})/gu, "***").slice(-2500),
    ...(diagnostic ? { providerEvents, childActivity } : {}),
  };
  writeFileSync(join(spec.root, "result.json"), JSON.stringify(result), "utf8");
  process.exit(0);
}

const key = process.env.OPENROUTER_API_KEY || getStoredOpenRouterApiKey();
if (!key) throw new Error("No configured OpenRouter key; live evaluation cannot run.");
mkdirSync(dir, { recursive: true });
const label = process.argv[2] ?? "after";
if (!/^[\w-]+$/u.test(label)) throw new Error("Use a simple audit label.");
const previous = process.argv.includes("--resume")
  ? JSON.parse(readFileSync(join(dir, `live-complexity-${label}.json`), "utf8"))
  : null;
const results: Record<string, unknown>[] = previous?.results ?? [];
const onlyLevel = Number(process.argv.find((arg) => arg.startsWith("--level="))?.split("=")[1] ?? 0);
const repetitions = Number(process.argv.find((arg) => arg.startsWith("--repetitions="))?.split("=")[1] ?? 3);
if (
  !Number.isInteger(onlyLevel) ||
  onlyLevel < 0 ||
  onlyLevel > 10 ||
  !Number.isInteger(repetitions) ||
  repetitions < 1 ||
  repetitions > 3
)
  throw new Error("Use levels 1–10 and repetitions 1–3.");
if (process.argv.includes("--diagnostic")) process.env.SHELRA_AUDIT_DIAGNOSTIC = "1";
const fingerprintScope = [
  "src/agent/agent.ts",
  "src/agent/behavior-verifier.ts",
  "src/agent/compaction.ts",
  "src/agent/vision-input.ts",
  "src/agent/tool-result.ts",
  "src/contract/check-definitions.ts",
  "src/providers/stream.ts",
  "src/providers/types.ts",
  "src/runtimes/local-provider.ts",
  "src/exec/command.ts",
  "src/exec/shell.ts",
  "src/exec/process.ts",
  "src/mcp/runtime.ts",
  "src/memory/store.ts",
  "src/memory/lock.ts",
  "src/memory/episodes.ts",
  "src/storage/tool-results.ts",
  "src/utils/session-trace.ts",
];
const productFingerprint = createHash("sha256")
  .update(fingerprintScope.map((file) => readFileSync(file, "utf8")).join("\n"))
  .digest("hex");
if (previous && previous.productFingerprint !== productFingerprint)
  throw new Error("Cannot resume an audit ladder across product changes; use a separate label.");
const interruptions = [...(previous?.interruptions ?? [])];
if (previous?.stopReason)
  interruptions.push({ reason: previous.stopReason, afterTasks: results.length, resumedAt: new Date().toISOString() });
let limited = false;
for (let level = 1; level <= 10 && !limited; level++)
  for (let repeat = 0; repeat < repetitions && !limited; repeat++) {
    if (onlyLevel && level !== onlyLevel) continue;
    if (results.some((result) => result.level === level && result.repeat === repeat)) continue;
    const root = mkdtempSync(join(tmpdir(), "shelra-live-audit-"));
    const project = join(root, "project");
    mkdirSync(project);
    const home = join(root, "user-state");
    mkdirSync(home);
    try {
      writeFileSync(
        join(project, "package.json"),
        JSON.stringify({ name: "audit-fixture", type: "module", scripts: level > 2 ? { test: "bun verify.ts" } : {} }),
        "utf8",
      );
      writeFileSync(
        join(project, "AGENTS.md"),
        "Use Bun. Do not install dependencies. Do not edit verify.ts. Keep exported function names stable.\n",
        "utf8",
      );
      writeFileSync(
        join(project, "invoice.ts"),
        "export function total(items: number[]) { return items.reduce((sum, item) => sum + item, 0); }\n",
        "utf8",
      );
      let prompt = "What is 2 + 2? Answer with the number only.";
      let oracle = "";
      if (level === 2)
        prompt = "Inspect this project and explain where invoice totals are calculated. Name the function and file.";
      if (level >= 3) {
        writeFileSync(
          join(project, "invoice.ts"),
          "export function total(items: number[]) { return items.length; }\n",
          "utf8",
        );
        prompt =
          "Fix total in invoice.ts: total([2,3]) must be 5, empty arrays return 0, negative values are supported. Run the project tests.";
        oracle =
          'import {total} from "./invoice"; if(total([2,3])!==5||total([])!==0||total([-2,3])!==1) throw Error("incorrect total");';
      }
      if (level >= 4) {
        writeFileSync(
          join(project, "tax.ts"),
          "export function taxed(value:number, rate:number) { return value; }\n",
          "utf8",
        );
        prompt +=
          " Implement taxed(value, rate) in tax.ts as value * (1 + rate), retaining decimals. Both modules must work.";
        oracle += 'import {taxed} from "./tax"; if(Math.abs(taxed(100,0.2)-120)>1e-9) throw Error("incorrect tax");';
      }
      if (level >= 5) {
        writeFileSync(
          join(project, "summary.ts"),
          'import {total} from "./invoice"; export function summary(items:number[]) { return total(items.filter(Boolean)); }\n',
          "utf8",
        );
        prompt +=
          " Diagnose why summary loses records and change its result to {count, total}, preserving zero-valued records.";
        oracle +=
          'import {summary} from "./summary"; const s=summary([0,2]) as any; if(s.count!==2||s.total!==2) throw Error("incorrect summary");';
      }
      if (level >= 6) {
        writeFileSync(
          join(project, "api.ts"),
          "export function invoiceResponse(items:number[]) { return {}; }\n",
          "utf8",
        );
        prompt +=
          " Design the API boundary in api.ts: invoiceResponse(items) returns {count, total, taxedTotal} using a fixed 0.2 tax rate and the existing modules. Keep one source for each calculation.";
        oracle +=
          'import {invoiceResponse} from "./api"; const a=invoiceResponse([0,5]) as any; if(a.count!==2||a.total!==5||a.taxedTotal!==6) throw Error("incorrect API");';
      }
      if (level >= 7)
        for (let n = 0; n < 8; n++) {
          writeFileSync(
            join(project, `format-${n}.ts`),
            `export function format${n}(value:number) { return ""; }\n`,
            "utf8",
          );
          prompt += ` Implement format${n} in format-${n}.ts to return value.toFixed(2).`;
          oracle += `import {format${n}} from "./format-${n}"; if(format${n}(1.5)!=="1.50") throw Error("format ${n}");`;
        }
      if (level >= 8)
        prompt +=
          " Reproduce the failure using a missing file read and a command that exits 7 before repairing; recover and continue. Do not install anything.";
      if (level >= 9)
        for (let n = 0; n < 200; n++)
          writeFileSync(
            join(project, `legacy-${n}.ts`),
            `// Legacy fixture; unrelated to the invoice task.\nexport const legacy${n} = ${JSON.stringify("obsolete".repeat(300))};\n`,
            "utf8",
          );
      if (level >= 10) {
        writeFileSync(
          join(project, "README.md"),
          "Historical notes: old invoices used item counts; tax was not supported. This document describes the retired prototype.\n",
          "utf8",
        );
        prompt +=
          " The README describes an obsolete prototype. Preserve the original acceptance rules above, including zero-valued records and the public API; explain any conflict you found.";
      }
      if (oracle)
        writeFileSync(join(project, "verify.ts"), `${oracle}\nconsole.log('all behavior checks passed');\n`, "utf8");
      const spec: Spec = { level, repeat, root: project, prompt, oracle };
      const specFile = join(root, "spec.json");
      writeFileSync(specFile, JSON.stringify(spec), "utf8");
      const child = Bun.spawn([process.execPath, fileURLToPath(import.meta.url), "--child", specFile], {
        cwd: project,
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          HOME: home,
          USERPROFILE: home,
          OPENROUTER_API_KEY: key,
          SHELRA_TRACE: "off",
          SHELRA_DIAGNOSTICS_LOG: "off",
          SHELRA_USER_MEMORY_ROOT: home,
        },
      });
      let killed = false;
      const timer = setTimeout(() => {
        killed = true;
        void killProcessTree(child.pid, 500);
        child.kill();
      }, 100_000);
      let hardTimer: ReturnType<typeof setTimeout>;
      const hardDeadline = new Promise<[string, string, number]>((resolve) => {
        hardTimer = setTimeout(() => resolve(["", "", 124]), 105_000);
      });
      const [stdout, stderr, code] = await Promise.race([
        Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]),
        hardDeadline,
      ]);
      clearTimeout(timer);
      clearTimeout(hardTimer!);
      const path = join(project, "result.json");
      const result = exists(path)
        ? JSON.parse(readFileSync(path, "utf8"))
        : {
            level,
            repeat,
            exitCode: code,
            timeoutCount: killed ? 1 : 0,
            finalCorrectness: false,
            error: "child did not produce result",
            stderrBytes: stderr.length,
            stdoutBytes: stdout.length,
          };
      results.push(result);
      limited = Boolean(result.providerLimited) || result.error === "child did not produce result";
      writeFileSync(
        join(dir, `live-complexity-${label}.json`),
        `${redactPaths(
          JSON.stringify(
            {
              method: `Free router; isolated fresh fixtures; serial k=${repetitions}; 75s turn budget / 100s kill / 105s hard parent bound; immutable out-of-project behavior oracle. Levels progressively add requirements. Not a months-long endurance test.`,
              productFingerprint,
              fingerprintScope,
              label,
              interruptions,
              results,
              stoppedForProviderLimit: Boolean(result.providerLimited),
              stopReason: result.providerLimited
                ? "provider_limit"
                : result.error === "child did not produce result"
                  ? "child_missing_result"
                  : null,
            },
            null,
            2,
          ),
        )}\n`,
        "utf8",
      );
      console.log(
        JSON.stringify({
          level,
          repeat,
          correct: result.finalCorrectness,
          durationMs: result.durationMs,
          model: result.servedModel,
          limited,
        }),
      );
    } finally {
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }
function exists(path: string) {
  try {
    readFileSync(path);
    return true;
  } catch {
    return false;
  }
}
