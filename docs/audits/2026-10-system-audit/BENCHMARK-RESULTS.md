# Reproducible benchmark results

Generated 2026-10-04T23:37:00.062Z. Bun 1.4.1, Windows. Raw evidence is in `bench/history/system-audit/`.

## Bounded fault probes, before versus final

| Probe | Before passes | After passes | Before median ms | After median ms |
| --- | --- | --- | --- | --- |
| cancel-hung-stream | 0/6 | 6/6 | 181.49 | 21.10 |
| native-success-followed-by-cmdlet-failure | 0/3 | 3/3 | 469.00 | 430.00 |
| newline-free-stderr (8 MiB) | not measured | not measured | 2347.25 | 0.85 |
| same-project-memory-writers (3 writers) | 0/3 | 3/3 | 667.00 | 1391.00 |
| same-project-memory-writers (5 writers) | 0/3 | 3/3 | 824.00 | 2041.00 |

Parser timing has no pass predicate: losslessness and bounded streaming are asserted in the regression test. The canceled reader is rescued at 180 ms so the pre-fix experiment terminates; without rescue it can wait indefinitely with idle detection disabled. Concurrent memory count improved from 20/60 and 20/100 to every expected entry. Serialization deliberately costs throughput. The initial worker type typo and overlapping baseline workload are documented in WORKING-AUDIT.md. These are wall-clock and blocked-timer measurements, not an exclusive CPU flamegraph.

## Live complexity ladder, three scheduled repetitions per level

The fixture progresses from arithmetic to repository explanation, one-file fix, two-file change, debugging, API boundary, twelve modules, deliberate tool failures, 200 distractor modules and stale documentation. Source-code behavior, bracketed host-outcome notices and task deadline are separate outcomes. These small fixtures do not establish production-repository competence. Behavior correctness is only the code oracle; at levels 8–10 the final harness additionally records whether both requested failure probes were observed. A behavior pass without those probes does not prove the whole instruction was followed; the requested probe-before-edit ordering is not enforced by this metric.

| Level | Behavior before | Behavior after | Correct without negative verdict before | After | Deadline hits before / after | Median seconds before / after |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 3/3 | 3/3 | 3/3 | 3/3 | 0 / 0 | 1.9 / 1.3 |
| 2 | 3/3 | 3/3 | 3/3 | 3/3 | 0 / 0 | 7.9 / 9.8 |
| 3 | 3/3 | 3/3 | 0/3 | 3/3 | 0 / 0 | 27.8 / 54.0 |
| 4 | 3/3 | 3/3 | 0/3 | 2/3 | 2 / 3 | 75.1 / 75.7 |
| 5 | 2/3 | 3/3 | 0/3 | 2/3 | 1 / 3 | 57.7 / 75.7 |
| 6 | 1/3 | 3/3 | 0/3 | 0/3 | 3 / 3 | 75.4 / 75.8 |
| 7 | 3/3 | 2/3 | 0/3 | 0/3 | 2 / 3 | 75.3 / 75.5 |
| 8 | 3/3 | 3/3 | 0/3 | 0/3 | 3 / 3 | 75.4 / 75.6 |
| 9 | 3/3 | 1/2 | 0/3 | 1/2 | 3 / 1 | 75.4 / 75.7 |
| 10 | 3/3 | not run | 0/3 | not run | 3 / unknown | 75.4 / unknown |

| Metric | Baseline all 30 | Intermediate all 30 | Baseline paired 26 | Final partial 26 |
| --- | --- | --- | --- | --- |
| Executed trials | 30 | 30 | 26 | 26 |
| Behavior oracle passes | 27/30 | 27/30 | 23/26 | 24/26 |
| Correct without negative bracketed notice | 6/30 | 8/30 | 6/26 | 14/26 |
| Experimental deadline hits | 17 | 21 | 13 | 16 |
| Median duration, seconds | 75.1 | 75.5 | 75.1 | 75.5 |
| Observed tool calls | 537 | 479 | 401 | 320 |
| Repeated call signatures | 60 | 29 | 58 | 21 |
| Reported input tokens (coverage differs) | 3353213 | 3016995 | 2528672 | 2370550 |
| Reported output tokens (coverage differs) | 83595 | 53866 | 68732 | 40873 |
| Observed error events | 39 | 31 | 21 | 27 |

After artifact: `live-complexity-final.json`. Intermediate results are retained rather than overwritten. The harness records source fingerprint and coverage; machine-readable totals are in `summary.json`. A missing per-level trial is not a successful trial.

The final rerun collected 26/30 trials; 4 were not executed after the provider returned Limited and a reset time. Compare the same executed level/repetition pairs in the last two columns; do not compare a 26-trial denominator against 30. The earlier complete post-guard 30-trial run remains available; it is not mislabeled as the latest product snapshot. Final live trials preceded the additional MCP model/persistence, Windows-exit, monotonic-lock and image-persistence regressions; no MCP server or SQLite session persistence was enabled in those isolated live fixtures. Those later boundary changes are verified by regressions and the final repository checks, not by an invented complete final ladder. `--resume` skips existing trials and rejects a changed product fingerprint; after additional source changes use a fresh label.

- Live before/after uses the free router, not a fixed upstream model. It is descriptive, not a randomized causal model-quality study.
- Before ladder ran while independent runtime fixes were being made, but the faulty check guard stayed unchanged for all 30 tasks. Final ladder uses stable guard repair.
- Before oracle ran verify.ts in the fixture; final oracle is regenerated from the out-of-project immutable spec and reports check-file violations. Final grading is stronger.
- Earlier live peak context counts only round input; final counts prepared per-step history too. Earlier token counts omit auxiliary calls; final includes returned auxiliary usage. Those aggregates are not directly comparable.
- 75 seconds is an experimental task budget, not a production timeout. A deadline proves failure to finish within the budget, not an infinite freeze.
- The ladder also uses tighter model budgets (60s round / 45s step / 20s chunk) and 100/250ms interruption pauses. Product defaults are 15min / 5min / 90s. This stress test is not the default CLI failure rate.
- Repeated call counts include legitimate re-verification. They are not synonymous with detected model loops.
- Host flags classify bracketed notices in accumulated text, not independent typed completion receipts. Earlier negative notices may be included. Code correctness is measured independently.
- Rounds count primary stream invocations rather than every HTTP request; step usage is provider reported and auxiliary/child coverage is incomplete. Tool events can include host checks. No missing metric is a measured zero.
- Levels 8–10 additionally report observed missing-read and explicit exit-7 failure text in the final harness only. The narrow matcher can miss alternate paths or errors lacking an exit-code string; absence is not proof of violation. Earlier observation is unknown, and probe-before-edit ordering is not enforced by the grade.
- No months-long live endurance or full multi-tenant isolation conclusion follows from these fixtures.

Per-task raw JSON records wall time, first tool action, rounds, tools, repeated signatures, errors, input/output usage, context characters, memory tool reads/writes, verification-stage entries and final correctness. Final records add real model activity, step count, auxiliary calls, stage timeline, pending tools, retries and intent violations. Unmeasured metrics must not be inferred as zero from absent fields.

## Memory and operations

The scripted real-Agent memory suite improved from 10/11 scenarios to 11/11; cold-start assertions from 11/12 to 12/12. Ranking metrics remained unchanged: at 5,000 synthetic distractors, recall 83%, precision 75%, rule recall 100% on the 92-query dataset. The final run measured p50/p95 39.5/144.7 ms. These distractors stress in-memory ranking beyond the physical 200-entry index cap. See MEMORY-CONTEXT-AUDIT.md for per-scenario limits and restart coverage.

The actual local MCP fixture writes 2 MiB of stderr before initializing. Recreated undrained policy failed to initialize within 500 ms in 3/3 cases; the fixed runtime initialized in 45.6–51.2 ms in 3/3. Reading only one line of a 32 MiB file still blocked the event loop for 305–361 ms while returning 40 characters. This latter bottleneck is measured and remains open; it is not a demonstrated permanent freeze or retained memory leak. See operations.json.

The first memory-lock repair passed isolated probes but lost one admitted entry during the full unsandboxed test suite (99/100 with all children exiting successfully). An owner-change regression reproduced unsafe dead-owner recovery. After that correction, a full-suite rerun exposed unfair lock admission rejecting two writers at the existing one-second bound. Unique waiter tickets now prevent a fast writer from reacquiring through its whole batch ahead of others; the bound was not increased. A later isolated frozen-clock regression proved that a wall-clock deadline could wait indefinitely; using a monotonic clock restores the existing bound. The five-process regression still requires all 100 readable bodies and additionally checks that no writer monopolizes its whole batch. 30/30 writer stress trials at concurrency 1/3/5 pass after admission repair, and the bounded final probes and complete repository suite pass after the monotonic-clock follow-up. Failed intermediate artifacts remain as `validation-unrestricted-initial.json` and `validation-before-fairness.json`; sandbox failures are recorded separately.

## SQLite contention and log privacy

An external writer holds a transaction against an isolated database for six seconds. The product's synchronous SQLite call fails with SQLITE_BUSY after about 5.4 seconds; a cancellation timer intended for 20 ms cannot run until the call returns. Across 3 repetitions the timer fires at 5337.3–5393.8 ms. All seeded titles are unchanged and integrity checks pass. This is bounded event-loop blocking, not an infinite deadlock or demonstrated corruption. The path remains open; it is separate from the no-persistence concurrency fixture below. See `database-contention.json`.

An isolated command receives only OS variables and two artificial credentials. The actual command capture and disk RunLog retain the seeded known-format key and arbitrary password; the trace redactor removes the known-format key but retains the password. No real credential, private database, external request or exfiltration is used. This confirms the raw log/environment trust gap (F20); a streaming redaction and child-environment policy remains required. See `privacy.json`.

The final attachment follow-up tests the installed SDK schema through the JSON round trip used by transcripts. Local/downloaded binary data is valid fresh but invalid after replay in 2/2 cases. New base64 file data restores 2/2 replay validity and exact decoded bytes; all ten vision tests pass. Existing binary-object rows are not migrated, and live visual reasoning is unmeasured. See `vision-json-roundtrip.json`.

## Separate-Agent concurrency and hidden verification work

Three repetitions each use 1/3/5 real Agent instances in one process, isolated project stores and a scripted provider with one intentionally pending stream. All 27 turns settle; 18 nonstalled answers return their own marker, all contexts contain their own project marker and none contains a foreign marker. 17 of 18 unrelated turns finish before the stalled stream is actually canceled. Most turns advance independently of that pending stream; one closes afterward. This is not SQLite persistence, a real-provider load or a multi-tenant security test.

| Simultaneous Agents | Repetitions | Completed / canceled turns | Foreign project markers | Intended 400 ms abort actually fired at ms |
| --- | --- | --- | --- | --- |
| 1 | 3 | 3 | 0 | 414–431 |
| 3 | 3 | 9 | 0 | 746–769 |
| 5 | 3 | 15 | 0 | 1178–1220 |

Timer lateness rises under concurrency. Synchronous context/closing work and promise scheduling need profiling before attribution; a responsive async stream does not guarantee a prompt cancellation timer. See `agent-concurrency.json`.

A diagnostic one-file live rerun records the main model ending at 15.360 s, a checker doing real tool work through 66.870 s, and closing recap starting at 67.924 s. The 75 s budget then cancels reflection; source and host verification have passed. This is an active, largely hidden verifier tail, not a captured deadlock. The checker had a wrong Node runtime hint for a declared Bun check, now covered by a fail-before/pass-after regression. Its isolated contribution to latency is not known. See `live-complexity-verifier-diagnostic.json` and the dedicated freeze report.

## Final repository validation

All five commands `bun run format` (exit 0), `bun run lint` (exit 0), `bun run typecheck` (exit 0), `bun run test` (exit 0), `bun run build` (exit 0) pass. The root chain includes 1511 main Vitest tests, 9 separately run Vitest tests and 116 Bun tests. Build emits both bundle and binary with per-user installation disabled. Baseline frontend typecheck and backend typecheck/32 fake-database tests also passed; those independent packages are unchanged. See `validation.json` and the path-redacted validation logs.

## Reproduction

Run benchmarks serially. Product changes already applied mean the original before JSON cannot be regenerated without the original revision. Regression tests record the exact former behavior; the undrained MCP fixture explicitly recreates the original transport policy.

`bun scripts/system-audit.ts final`

`bun scripts/system-audit-operations.ts`

`bun scripts/system-audit-concurrency.ts`

`bun scripts/system-audit-db.ts`

`bun scripts/system-audit-privacy.ts`

`bun scripts/system-audit.ts fairness-stress --repetitions=10`

`bun scripts/system-audit-live.ts verifier-diagnostic --level=3 --repetitions=1 --diagnostic`

`bun scripts/system-audit-live.ts <label>` — configured OpenRouter key; exclusively free router; 30 isolated tasks and bounded cancellation; spends free request quota.

`bun run bench/long-horizon/memory-evals.ts --label <label>`

`bun run bench/memory/run.ts --label <label> --dataset dataset-v2.json --sizes 0,100,1000,5000`

`bun scripts/system-audit-validate.ts` — runs the full root validation, skips binary installation and preserves exact exit status/output.

`bun scripts/system-audit-report.ts` — regenerates this report and summary JSON, redacting home/scratch paths in retained validation logs.

The existing memory harness writes two tracked year-state snapshots as a side effect. Those incidental files were restored to the original checkout after runs; audit-labelled results are retained.
