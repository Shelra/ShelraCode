/** Summarize audit artifacts; no private traces, prompts or credentials are read. */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { redactPaths } from "../bench/long-horizon/redact";
import { redact } from "../src/utils/session-trace";

const dir = "bench/history/system-audit";
// Failed validation contains scratch/home paths in stacks as well as successful output. Keep the evidence,
// but use the same path/key redaction as the reproducible evaluation artifacts before it is shared.
for (const file of readdirSync(dir).filter((name) => /\.(?:log|txt|json)$/u.test(name))) {
  const path = join(dir, file);
  const original = readFileSync(path, "utf8");
  const redacted = redact(redactPaths(original));
  if (redacted !== original) writeFileSync(path, redacted, "utf8");
  // Root *.log ignore rules should not remove the evidence from a future review/checkout.
  if (file.endsWith(".log")) {
    const reviewPath = join(dir, file.replace(/\.log$/u, ".txt"));
    // Older ignored logs must not overwrite the newer final validation's reviewable .txt output.
    if (!existsSync(reviewPath)) writeFileSync(reviewPath, redacted, "utf8");
  }
}
type Trial = {
  probe: string;
  durationMs?: number;
  passed?: boolean;
  concurrency?: number;
  actual?: number;
  expected?: number;
  bytes?: number;
  connected?: boolean;
};
type Live = {
  level: number;
  repeat: number;
  durationMs?: number;
  finalCorrectness: boolean;
  hostUnverified?: boolean;
  hostVerified?: boolean;
  timeoutCount?: number;
  toolCalls?: number;
  repeatedToolCalls?: number;
  inputTokens?: number;
  outputTokens?: number;
  errors?: number;
  modelRounds?: number;
  auxiliaryModelCalls?: number;
  lastStage?: string;
  intentViolations?: string[];
  requiredFailureProbesObserved?: boolean;
};
const read = <T>(file: string): T => JSON.parse(readFileSync(file, "utf8")) as T;
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)]! : 0;
};
const before = read<{ trials: Trial[] }>(join(dir, "baseline.json"));
const after = read<{ trials: Trial[] }>(join(dir, "final.json"));
const liveBefore = read<{ results: Live[] }>(join(dir, "live-complexity-before-check-guard.json"));
const afterArtifact = existsSync(join(dir, "live-complexity-final.json"))
  ? "live-complexity-final.json"
  : "live-complexity-after.json";
const liveIntermediate = existsSync(join(dir, "live-complexity-after.json"))
  ? read<{ results: Live[] }>(join(dir, "live-complexity-after.json"))
  : { results: [] };
const liveAfter = existsSync(join(dir, afterArtifact))
  ? read<{ results: Live[] }>(join(dir, afterArtifact))
  : { results: [] };
const pairedBefore = liveBefore.results.filter((b) =>
  liveAfter.results.some((a) => a.level === b.level && a.repeat === b.repeat),
);
const groups = [
  { probe: "cancel-hung-stream" },
  { probe: "native-success-followed-by-cmdlet-failure" },
  { probe: "newline-free-stderr", bytes: 8_388_608 },
  { probe: "same-project-memory-writers", concurrency: 3 },
  { probe: "same-project-memory-writers", concurrency: 5 },
];
const comparisons = groups.map((group) => {
  const select = (trials: Trial[]) =>
    trials.filter(
      (trial) =>
        trial.probe === group.probe &&
        (group.bytes === undefined || trial.bytes === group.bytes) &&
        (group.concurrency === undefined || trial.concurrency === group.concurrency),
    );
  const b = select(before.trials),
    a = select(after.trials);
  return {
    ...group,
    before: {
      trials: b.length,
      passes: b.some((x) => typeof x.passed === "boolean") ? b.filter((x) => x.passed).length : null,
      medianMs: median(b.map((x) => x.durationMs ?? 0)),
      indexed: b.map((x) => x.actual),
    },
    after: {
      trials: a.length,
      passes: a.some((x) => typeof x.passed === "boolean") ? a.filter((x) => x.passed).length : null,
      medianMs: median(a.map((x) => x.durationMs ?? 0)),
      indexed: a.map((x) => x.actual),
    },
  };
});
function summarize(results: Live[]) {
  return {
    tasks: results.length,
    behaviorCorrect: results.filter((x) => x.finalCorrectness).length,
    correctWithoutNegativeHostVerdict: results.filter((x) => x.finalCorrectness && !x.hostUnverified).length,
    timeouts: results.reduce((sum, x) => sum + (x.timeoutCount ?? 0), 0),
    medianDurationMs: median(results.map((x) => x.durationMs ?? 0)),
    tools: results.reduce((sum, x) => sum + (x.toolCalls ?? 0), 0),
    repeatedTools: results.reduce((sum, x) => sum + (x.repeatedToolCalls ?? 0), 0),
    inputTokens: results.reduce((sum, x) => sum + (x.inputTokens ?? 0), 0),
    outputTokens: results.reduce((sum, x) => sum + (x.outputTokens ?? 0), 0),
    errors: results.reduce((sum, x) => sum + (x.errors ?? 0), 0),
    intentViolations: results.some((x) => x.intentViolations !== undefined)
      ? results.reduce((sum, x) => sum + (x.intentViolations?.length ?? 0), 0)
      : null,
    failureProbeTrials: results.filter((x) => x.requiredFailureProbesObserved !== undefined).length,
    requiredFailureProbesObserved: results.some((x) => x.requiredFailureProbesObserved !== undefined)
      ? results.filter((x) => x.requiredFailureProbesObserved === true).length
      : null,
  };
}
const levels = Array.from({ length: 10 }, (_, index) => ({
  level: index + 1,
  before: summarize(liveBefore.results.filter((x) => x.level === index + 1)),
  after: summarize(liveAfter.results.filter((x) => x.level === index + 1)),
}));
const concurrency = read<{
  trials: Array<{
    concurrency: number;
    stalledAbortMs: number;
    completed: number;
    ownMemoryCount: number;
    foreignMemoryCount: number;
    otherAnswersCorrect: number;
    unrelatedCompletedBeforeCancellation: number;
  }>;
}>(join(dir, "agent-concurrency.json"));
const concurrentGroups = [1, 3, 5].map((count) => {
  const trials = concurrency.trials.filter((trial) => trial.concurrency === count);
  return {
    concurrency: count,
    trials: trials.length,
    completed: trials.reduce((sum, trial) => sum + trial.completed, 0),
    ownMemory: trials.reduce((sum, trial) => sum + trial.ownMemoryCount, 0),
    foreignMemory: trials.reduce((sum, trial) => sum + trial.foreignMemoryCount, 0),
    correctUnrelatedAnswers: trials.reduce((sum, trial) => sum + trial.otherAnswersCorrect, 0),
    unrelatedFinishedBeforeAbort: trials.reduce((sum, trial) => sum + trial.unrelatedCompletedBeforeCancellation, 0),
    abortTimerRangeMs: [
      Math.min(...trials.map((x) => x.stalledAbortMs)),
      Math.max(...trials.map((x) => x.stalledAbortMs)),
    ],
  };
});
const fairStress = read<{ trials: Trial[] }>(join(dir, "fairness-stress.json")).trials.filter(
  (trial) => trial.probe === "same-project-memory-writers",
);
const database = read<{
  trials: Array<{
    databaseReturnedMs: number;
    cancellationFiredMs: number;
    failure: string;
    integrity: string;
    titleUnchanged: boolean;
  }>;
}>(join(dir, "database-contention.json"));
const privacy = read<{ result: Record<string, boolean | number> }>(join(dir, "privacy.json"));
const validation = read<{ results: Array<{ command: string; exitCode: number; durationMs: number }> }>(
  join(dir, "validation.json"),
);
const testLog = readFileSync(
  join(dir, existsSync(join(dir, "validation-test.txt")) ? "validation-test.txt" : "validation-test.log"),
  "utf8",
);
const vitestCounts = [...testLog.matchAll(/Tests\s+(\d+) passed/gu)].map((match) => Number(match[1]));
const bunCounts = [...testLog.matchAll(/^\s*(\d+) pass\s*$/gmu)].map((match) => Number(match[1]));
const summary = {
  at: new Date().toISOString(),
  runtime: Bun.version,
  comparisons,
  live: {
    before: summarize(liveBefore.results),
    intermediate: summarize(liveIntermediate.results),
    afterArtifact,
    after: summarize(liveAfter.results),
    pairedBefore: summarize(pairedBefore),
    unexecutedFinalTasks: 30 - liveAfter.results.length,
    levels,
  },
  concurrency: concurrentGroups,
  memoryFairnessStress: { trials: fairStress.length, passed: fairStress.filter((x) => x.passed).length },
  databaseContention: {
    trials: database.trials.length,
    cancellationRangeMs: [
      Math.min(...database.trials.map((x) => x.cancellationFiredMs)),
      Math.max(...database.trials.map((x) => x.cancellationFiredMs)),
    ],
    allBusy: database.trials.every((x) => x.failure === "SQLITE_BUSY"),
    integrityOk: database.trials.every((x) => x.integrity === "ok" && x.titleUnchanged),
  },
  privacy: privacy.result,
  visionRoundTrip: read<Record<string, unknown>>(join(dir, "vision-json-roundtrip.json")),
  validation: {
    results: validation.results,
    mainVitestTests: vitestCounts[0],
    separateVitestTests: vitestCounts.slice(1).reduce((sum, count) => sum + count, 0),
    bunTests: bunCounts.reduce((sum, count) => sum + count, 0),
  },
  limits: [
    "Live before/after uses the free router, not a fixed upstream model. It is descriptive, not a randomized causal model-quality study.",
    "Before ladder ran while independent runtime fixes were being made, but the faulty check guard stayed unchanged for all 30 tasks. Final ladder uses stable guard repair.",
    "Before oracle ran verify.ts in the fixture; final oracle is regenerated from the out-of-project immutable spec and reports check-file violations. Final grading is stronger.",
    "Earlier live peak context counts only round input; final counts prepared per-step history too. Earlier token counts omit auxiliary calls; final includes returned auxiliary usage. Those aggregates are not directly comparable.",
    "75 seconds is an experimental task budget, not a production timeout. A deadline proves failure to finish within the budget, not an infinite freeze.",
    "The ladder also uses tighter model budgets (60s round / 45s step / 20s chunk) and 100/250ms interruption pauses. Product defaults are 15min / 5min / 90s. This stress test is not the default CLI failure rate.",
    "Repeated call counts include legitimate re-verification. They are not synonymous with detected model loops.",
    "Host flags classify bracketed notices in accumulated text, not independent typed completion receipts. Earlier negative notices may be included. Code correctness is measured independently.",
    "Rounds count primary stream invocations rather than every HTTP request; step usage is provider reported and auxiliary/child coverage is incomplete. Tool events can include host checks. No missing metric is a measured zero.",
    "Levels 8–10 additionally report observed missing-read and explicit exit-7 failure text in the final harness only. The narrow matcher can miss alternate paths or errors lacking an exit-code string; absence is not proof of violation. Earlier observation is unknown, and probe-before-edit ordering is not enforced by the grade.",
    "No months-long live endurance or full multi-tenant isolation conclusion follows from these fixtures.",
  ],
};
writeFileSync(join(dir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
const rows = levels
  .map(
    (x) =>
      `| ${x.level} | ${x.before.behaviorCorrect}/${x.before.tasks} | ${x.after.tasks ? `${x.after.behaviorCorrect}/${x.after.tasks}` : "not run"} | ${x.before.correctWithoutNegativeHostVerdict}/${x.before.tasks} | ${x.after.tasks ? `${x.after.correctWithoutNegativeHostVerdict}/${x.after.tasks}` : "not run"} | ${x.before.timeouts} / ${x.after.tasks ? x.after.timeouts : "unknown"} | ${(x.before.medianDurationMs / 1000).toFixed(1)} / ${x.after.tasks ? (x.after.medianDurationMs / 1000).toFixed(1) : "unknown"} |`,
  )
  .join("\n");
const bt = String.fromCharCode(96);
const liveColumns = [summary.live.before, summary.live.intermediate, summary.live.pairedBefore, summary.live.after];
const liveMetrics: Array<[string, (value: ReturnType<typeof summarize>) => string | number]> = [
  ["Executed trials", (x) => x.tasks],
  ["Behavior oracle passes", (x) => `${x.behaviorCorrect}/${x.tasks}`],
  ["Correct without negative bracketed notice", (x) => `${x.correctWithoutNegativeHostVerdict}/${x.tasks}`],
  ["Experimental deadline hits", (x) => x.timeouts],
  ["Median duration, seconds", (x) => (x.medianDurationMs / 1000).toFixed(1)],
  ["Observed tool calls", (x) => x.tools],
  ["Repeated call signatures", (x) => x.repeatedTools],
  ["Reported input tokens (coverage differs)", (x) => x.inputTokens],
  ["Reported output tokens (coverage differs)", (x) => x.outputTokens],
  ["Observed error events", (x) => x.errors],
];
const report = `# Reproducible benchmark results

Generated ${summary.at}. Bun ${Bun.version}, Windows. Raw evidence is in ${bt}bench/history/system-audit/${bt}.

## Bounded fault probes, before versus final

| Probe | Before passes | After passes | Before median ms | After median ms |
| --- | --- | --- | --- | --- |
${comparisons.map((x) => `| ${x.probe}${x.concurrency ? ` (${x.concurrency} writers)` : ""}${x.bytes ? " (8 MiB)" : ""} | ${x.before.passes === null ? "not measured" : `${x.before.passes}/${x.before.trials}`} | ${x.after.passes === null ? "not measured" : `${x.after.passes}/${x.after.trials}`} | ${x.before.medianMs.toFixed(2)} | ${x.after.medianMs.toFixed(2)} |`).join("\n")}

Parser timing has no pass predicate: losslessness and bounded streaming are asserted in the regression test. The canceled reader is rescued at 180 ms so the pre-fix experiment terminates; without rescue it can wait indefinitely with idle detection disabled. Concurrent memory count improved from 20/60 and 20/100 to every expected entry. Serialization deliberately costs throughput. The initial worker type typo and overlapping baseline workload are documented in WORKING-AUDIT.md. These are wall-clock and blocked-timer measurements, not an exclusive CPU flamegraph.

## Live complexity ladder, three scheduled repetitions per level

The fixture progresses from arithmetic to repository explanation, one-file fix, two-file change, debugging, API boundary, twelve modules, deliberate tool failures, 200 distractor modules and stale documentation. Source-code behavior, bracketed host-outcome notices and task deadline are separate outcomes. These small fixtures do not establish production-repository competence. Behavior correctness is only the code oracle; at levels 8–10 the final harness additionally records whether both requested failure probes were observed. A behavior pass without those probes does not prove the whole instruction was followed; the requested probe-before-edit ordering is not enforced by this metric.

| Level | Behavior before | Behavior after | Correct without negative verdict before | After | Deadline hits before / after | Median seconds before / after |
| --- | --- | --- | --- | --- | --- | --- |
${rows}

| Metric | Baseline all 30 | Intermediate all 30 | Baseline paired 26 | Final partial 26 |
| --- | --- | --- | --- | --- |
${liveMetrics.map(([name, format]) => `| ${name} | ${liveColumns.map(format).join(" | ")} |`).join("\n")}

After artifact: ${bt}${afterArtifact}${bt}. Intermediate results are retained rather than overwritten. The harness records source fingerprint and coverage; machine-readable totals are in ${bt}summary.json${bt}. A missing per-level trial is not a successful trial.

The final rerun collected ${summary.live.after.tasks}/30 trials; ${summary.live.unexecutedFinalTasks} were not executed after the provider returned Limited and a reset time. Compare the same executed level/repetition pairs in the last two columns; do not compare a 26-trial denominator against 30. The earlier complete post-guard 30-trial run remains available; it is not mislabeled as the latest product snapshot. Final live trials preceded the additional MCP model/persistence, Windows-exit, monotonic-lock and image-persistence regressions; no MCP server or SQLite session persistence was enabled in those isolated live fixtures. Those later boundary changes are verified by regressions and the final repository checks, not by an invented complete final ladder. ${bt}--resume${bt} skips existing trials and rejects a changed product fingerprint; after additional source changes use a fresh label.

${summary.limits.map((x) => `- ${x}`).join("\n")}

Per-task raw JSON records wall time, first tool action, rounds, tools, repeated signatures, errors, input/output usage, context characters, memory tool reads/writes, verification-stage entries and final correctness. Final records add real model activity, step count, auxiliary calls, stage timeline, pending tools, retries and intent violations. Unmeasured metrics must not be inferred as zero from absent fields.

## Memory and operations

The scripted real-Agent memory suite improved from 10/11 scenarios to 11/11; cold-start assertions from 11/12 to 12/12. Ranking metrics remained unchanged: at 5,000 synthetic distractors, recall 83%, precision 75%, rule recall 100% on the 92-query dataset. The final run measured p50/p95 39.5/144.7 ms. These distractors stress in-memory ranking beyond the physical 200-entry index cap. See MEMORY-CONTEXT-AUDIT.md for per-scenario limits and restart coverage.

The actual local MCP fixture writes 2 MiB of stderr before initializing. Recreated undrained policy failed to initialize within 500 ms in 3/3 cases; the fixed runtime initialized in 45.6–51.2 ms in 3/3. Reading only one line of a 32 MiB file still blocked the event loop for 305–361 ms while returning 40 characters. This latter bottleneck is measured and remains open; it is not a demonstrated permanent freeze or retained memory leak. See operations.json.

The first memory-lock repair passed isolated probes but lost one admitted entry during the full unsandboxed test suite (99/100 with all children exiting successfully). An owner-change regression reproduced unsafe dead-owner recovery. After that correction, a full-suite rerun exposed unfair lock admission rejecting two writers at the existing one-second bound. Unique waiter tickets now prevent a fast writer from reacquiring through its whole batch ahead of others; the bound was not increased. A later isolated frozen-clock regression proved that a wall-clock deadline could wait indefinitely; using a monotonic clock restores the existing bound. The five-process regression still requires all 100 readable bodies and additionally checks that no writer monopolizes its whole batch. ${summary.memoryFairnessStress.passed}/${summary.memoryFairnessStress.trials} writer stress trials at concurrency 1/3/5 pass after admission repair, and the bounded final probes and complete repository suite pass after the monotonic-clock follow-up. Failed intermediate artifacts remain as ${bt}validation-unrestricted-initial.json${bt} and ${bt}validation-before-fairness.json${bt}; sandbox failures are recorded separately.

## SQLite contention and log privacy

An external writer holds a transaction against an isolated database for six seconds. The product's synchronous SQLite call fails with SQLITE_BUSY after about 5.4 seconds; a cancellation timer intended for 20 ms cannot run until the call returns. Across ${summary.databaseContention.trials} repetitions the timer fires at ${summary.databaseContention.cancellationRangeMs.map((x) => x.toFixed(1)).join("–")} ms. All seeded titles are unchanged and integrity checks pass. This is bounded event-loop blocking, not an infinite deadlock or demonstrated corruption. The path remains open; it is separate from the no-persistence concurrency fixture below. See ${bt}database-contention.json${bt}.

An isolated command receives only OS variables and two artificial credentials. The actual command capture and disk RunLog retain the seeded known-format key and arbitrary password; the trace redactor removes the known-format key but retains the password. No real credential, private database, external request or exfiltration is used. This confirms the raw log/environment trust gap (F20); a streaming redaction and child-environment policy remains required. See ${bt}privacy.json${bt}.

The final attachment follow-up tests the installed SDK schema through the JSON round trip used by transcripts. Local/downloaded binary data is valid fresh but invalid after replay in 2/2 cases. New base64 file data restores 2/2 replay validity and exact decoded bytes; all ten vision tests pass. Existing binary-object rows are not migrated, and live visual reasoning is unmeasured. See ${bt}vision-json-roundtrip.json${bt}.

## Separate-Agent concurrency and hidden verification work

Three repetitions each use 1/3/5 real Agent instances in one process, isolated project stores and a scripted provider with one intentionally pending stream. All ${concurrentGroups.reduce((sum, x) => sum + x.completed, 0)} turns settle; ${concurrentGroups.reduce((sum, x) => sum + x.correctUnrelatedAnswers, 0)} nonstalled answers return their own marker, all contexts contain their own project marker and none contains a foreign marker. ${concurrentGroups.reduce((sum, x) => sum + x.unrelatedFinishedBeforeAbort, 0)} of 18 unrelated turns finish before the stalled stream is actually canceled. Most turns advance independently of that pending stream; one closes afterward. This is not SQLite persistence, a real-provider load or a multi-tenant security test.

| Simultaneous Agents | Repetitions | Completed / canceled turns | Foreign project markers | Intended 400 ms abort actually fired at ms |
| --- | --- | --- | --- | --- |
${concurrentGroups.map((x) => `| ${x.concurrency} | ${x.trials} | ${x.completed} | ${x.foreignMemory} | ${x.abortTimerRangeMs.join("–")} |`).join("\n")}

Timer lateness rises under concurrency. Synchronous context/closing work and promise scheduling need profiling before attribution; a responsive async stream does not guarantee a prompt cancellation timer. See ${bt}agent-concurrency.json${bt}.

A diagnostic one-file live rerun records the main model ending at 15.360 s, a checker doing real tool work through 66.870 s, and closing recap starting at 67.924 s. The 75 s budget then cancels reflection; source and host verification have passed. This is an active, largely hidden verifier tail, not a captured deadlock. The checker had a wrong Node runtime hint for a declared Bun check, now covered by a fail-before/pass-after regression. Its isolated contribution to latency is not known. See ${bt}live-complexity-verifier-diagnostic.json${bt} and the dedicated freeze report.

## Final repository validation

All five commands ${summary.validation.results.map((x) => `${bt}${x.command}${bt} (exit ${x.exitCode})`).join(", ")} pass. The root chain includes ${summary.validation.mainVitestTests} main Vitest tests, ${summary.validation.separateVitestTests} separately run Vitest tests and ${summary.validation.bunTests} Bun tests. Build emits both bundle and binary with per-user installation disabled. Baseline frontend typecheck and backend typecheck/32 fake-database tests also passed; those independent packages are unchanged. See ${bt}validation.json${bt} and the path-redacted validation logs.

## Reproduction

Run benchmarks serially. Product changes already applied mean the original before JSON cannot be regenerated without the original revision. Regression tests record the exact former behavior; the undrained MCP fixture explicitly recreates the original transport policy.

${bt}bun scripts/system-audit.ts final${bt}

${bt}bun scripts/system-audit-operations.ts${bt}

${bt}bun scripts/system-audit-concurrency.ts${bt}

${bt}bun scripts/system-audit-db.ts${bt}

${bt}bun scripts/system-audit-privacy.ts${bt}

${bt}bun scripts/system-audit.ts fairness-stress --repetitions=10${bt}

${bt}bun scripts/system-audit-live.ts verifier-diagnostic --level=3 --repetitions=1 --diagnostic${bt}

${bt}bun scripts/system-audit-live.ts <label>${bt} — configured OpenRouter key; exclusively free router; 30 isolated tasks and bounded cancellation; spends free request quota.

${bt}bun run bench/long-horizon/memory-evals.ts --label <label>${bt}

${bt}bun run bench/memory/run.ts --label <label> --dataset dataset-v2.json --sizes 0,100,1000,5000${bt}

${bt}bun scripts/system-audit-validate.ts${bt} — runs the full root validation, skips binary installation and preserves exact exit status/output.

${bt}bun scripts/system-audit-report.ts${bt} — regenerates this report and summary JSON, redacting home/scratch paths in retained validation logs.

The existing memory harness writes two tracked year-state snapshots as a side effect. Those incidental files were restored to the original checkout after runs; audit-labelled results are retained.
`;
writeFileSync("docs/audits/2026-10-system-audit/BENCHMARK-RESULTS.md", report, "utf8");
console.log(
  JSON.stringify({
    baselineTasks: summary.live.before.tasks,
    finalTasks: summary.live.after.tasks,
    finalBehaviorPasses: summary.live.after.behaviorCorrect,
    unexecuted: summary.live.unexecutedFinalTasks,
    validation: summary.validation,
  }),
);
