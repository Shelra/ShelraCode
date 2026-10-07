# Shelra freeze root cause analysis

Evidence date 2026-10-04, Windows / Bun 1.4.1. There is no single freeze mechanism. This report distinguishes a blocked stream, process settlement failure, synchronous CPU work, pipe backpressure, incorrect repair cycles and expensive verification. It does not label every slow provider response a deadlock.

## Measurable conditions

| Condition | Evidence required | Current detection |
| --- | --- | --- |
| Long-running | New useful observations/mutations or verification advancing | Tool results and check receipts; streamed text alone is weak progress |
| Waiting for provider | Outstanding generation, no stream activity, responsive event loop | SDK deadlines and idle watchdog; audit adds real model activity timestamps |
| Tool blocked | Tool started without settlement, owned external operation pending | Tool IDs/durations; audit records pending tool IDs at end |
| Model loop | Repeated calls/results, edit oscillation or repeated unchanged check failure | Six-step repetition, twelve-step lexical stall, cross-round circles |
| No progress | Stable work/evidence despite activity | Existing detectors are partial; novel words/calls can evade them |
| Queue blocked | Earlier serialized turn unresolved; later request not started | Telegram promise-chain design; no complete queue-wait telemetry |
| Rate limited | Provider 429/allowance evidence and Limited outcome | Routing/limits notices, distinct from silence |
| Dead process | Process has exited; no end event; interrupted live record | Startup live-memory recovery; no external process resurrection |
| Event loop blocked | Timer delay while synchronous operation consumes CPU or waits | Measured explicitly below; normal async heartbeats cannot fire during the block |

The audit added a per-turn `runId`, elapsed time, prepared-context sizes, provider activity timestamps, aggregate stage durations and pending tool IDs. Stage durations overlap model/tool activity; they are not exclusive CPU profiles. The existing idle watchdog and semantic/lexical loop checks remain. A universal run watchdog/operation registry is still missing; increasing deadlines is not the repair.

## Mechanism 1: cancellation cannot wake a suspended stream read — repaired

- Component: `src/providers/stream.ts`, `withIdleWatchdog`.
- Reproduction: underlying async iterator awaits a promise that never settles; abort after 20 ms. Run with idle budget 0 and 180,000 ms. A controlled source rescue at 180 ms makes the baseline experiment terminate.
- Timeline: 0 ms iterator read pending; 20 ms controller abort; pre-fix no new event; approximately 181 ms artificial rescue yields data. Post-fix approximately 21 ms abort event reaches the caller.
- Last successful event: read requested. Provider/model state: no returned stream part. Tool, queue, context and memory: not involved in this isolated reproduction.
- Process state: alive, responsive timers, suspended at `await Promise.race` containing only read/idle. This is an async wait, not a blocked CPU loop.
- Root cause: abort signal was not a participant in the read race. With idle detection disabled the function passed the iterator through, permitting an indefinite wait; otherwise it could wait the idle budget.
- Fix: race explicit abort even with idle detection disabled; handle pre-aborted requests, clear the idle timer/listener and report abort. Do not await an uncooperative iterator's `return()`.
- Regression: two hung-read cancellation cases in `src/providers/stream.test.ts`; final probe six of six meet the 100 ms bound.
- Limit: resolving the caller does not prove an arbitrary external source stopped. Native provider cancellation and owned transports still matter.

Evidence: `baseline.json`, `after.json`, `final.json` under `bench/history/system-audit/`.

## Mechanism 2: killed shell does not emit close — repaired caller settlement

- Component: `src/exec/command.ts`, abort/kill lifecycle.
- Reproduction: child streams remain open, kill helper resolves but child never emits `close`; command timeout 60 seconds. Advance virtual time 5,001 ms after cancellation, then explicitly release the child so the old test cannot leak.
- Last successful event: abort/kill request. Root cause: timeout had a settlement safety timer; user abort did not. The outcome awaited close indefinitely or until the original command timeout.
- Fix: five-second cancellation grace with explicit unconfirmed-closure diagnostic, destroy output streams on forced settlement, and keep `killed` distinct from `timed_out`. A follow-up releases the Windows PID on actual process `exit` even when inherited pipes remain open; otherwise an exit sweep could target a recycled PID. Unix keeps process-group ownership until close for surviving descendants.
- Verification: fail-before/pass-after lifecycle regression plus existing command/shell tests. Duration is a virtual-time upper-bound test, not a real OS kill latency claim.
- Remaining risk: Windows `taskkill` in `killProcessTree` itself has no hard callback deadline. Other callers that await it remain vulnerable. Settled command evidence must not imply the process tree definitely exited.

No provider, prompt, database or memory participates in this reproduction. The pending condition is the child `close` event, not an agent queue. A separate fail-before mock regression verifies the Windows exit sweep never targets the exited parent PID; no unrelated real process was killed.

## Mechanism 3: newline-free stderr consumes unbounded parser memory and CPU — repaired

- Component: `src/exec/shell.ts`, `createShellErrorFilter`.
- Reproduction: feed 4 KiB chunks containing no newline, up to 1 or 8 MiB, three repetitions.
- Timeline: every chunk concatenates into pending text and splits the entire accumulated string. Before: no output reaches bounded capture until flush; the synchronous 8 MiB loop blocks roughly 2.35 seconds. After: pending text is streamed once it exceeds 64 KiB; roughly 1 ms parser time in the first after run, with all bytes preserved.
- Last successful event: stderr data callback. Process state: JavaScript actively executing repeated concatenation/split, preventing timers, cancellation and TUI rendering. Provider/queue/context/memory activity cannot advance on that event loop during the synchronous block.
- Root cause: downstream 16 KiB capture does not bound an upstream line parser. Reprocessing the growing pending prefix produces superlinear work.
- Fix: bounded long-line buffering with passthrough until newline, then resume ordinary CLIXML normalization. Oversized CLIXML remains raw evidence rather than being fully normalized.
- Regression: one-MiB lossless/bounded test, existing CLIXML tests, three-repetition parser probe. This is a component-level improvement; it is not a claim that every query is thousands of times faster.

## Mechanism 4: MCP stderr backpressure prevents initialization — repaired and reproduced with a real child

- Components: `src/mcp/runtime.ts`; installed `StdioClientTransport` in the MCP SDK.
- Reproduction: local Bun child writes 2 MiB stderr and waits for that write's callback before replying to initialize. Recreate the original undrained `stderr: "pipe"` policy, then use the fixed product bundle.
- Timeline: server starts and writes diagnostics; PassThrough high-water mark is reached; server cannot finish the write; initialization receives no reply. In 3/3 original-policy probes it has not connected at the controlled 500 ms deadline. Fixed runtime connects in 45.6–51.2 ms in 3/3.
- Last successful event: child start / stderr write. Provider state: no LLM involved. Tool state: MCP connection awaiting initialization. Queue: sequential configured-server connection work; a failed connection delays later ones until its deadline. Context/memory: not involved in this isolated probe.
- Root cause: SDK pipes child stderr into a PassThrough that Shelra never consumed. Separately, racing a connection promise against a timeout did not close its owned stdio transport or a client that connected later.
- Fix: drain stderr while counting bytes, own transport from creation, close on failed initialization and close late-arriving clients. Cleanup failures enter diagnostics/errors.
- Regression: two ownership fault tests in `src/mcp/runtime.test.ts` and actual process probe `scripts/system-audit-operations.ts` / `operations.json`.
- Limits: original policy was recreated after the repair, rather than checking out and building the old tree. A 500 ms deadline is a laboratory bound; production's existing connection timeout is 20 seconds. MCP tool execution itself still depends on SDK cancellation/request semantics and has no universal Shelra result-size/deadline policy.

## Mechanism 5: completion guard orders valid application fixes to be restored — repaired

- Components: `src/contract/check-definitions.ts`, transitive `addToolingFile`; `Agent.runTurn` check-definition repair branch.
- Fixture: package `test` script executes `bun verify.ts`; verifier imports `invoice.ts`, `tax.ts`, later `summary.ts`. Request fixes those implementations and forbids editing the verifier.
- Baseline observation: all three one-file runs produced passing source behavior but ended Not verified. Across the ladder, 27/30 final behavior oracles passed but only the six non-editing tasks ended without a negative host verdict. Seventeen turns reached the 75-second experimental budget.
- Specific intent loss: level 5, repeat 1 fixed all three modules, then received the host's restore instruction. It reverted the implementations, failed the oracle and reported that “the user requested to restore” them. The user had requested the opposite.
- Timeline for that run: first tool action 4,567 ms; correct implementation and passing tests appear in answer; check-definition guard injects restore order; restored code fails; Stopped outcome after 47,696 ms. Intermediate event timestamps were not collected in this first ladder, so no finer timeline is claimed.
- Root cause: a verifier's imported application modules were hashed as immutable check definitions. The guard then treated ordinary implementation changes as test tampering. Authority of the repair prompt displaced the original goal.
- Fix: transitive immutable definitions follow tooling-classified helpers, not arbitrary application imports. Existing guards still protect scripts, runner config and tooling helpers; relevant protection suites pass.
- Regression: a legitimate `invoice.ts` fix changes neither check definition nor eligibility of `bun run test`; failed before and passes now. The entire live ladder is rerun after the guard repair.
- Remaining limit: tooling roles are inferred from path/name heuristics. Explicit check-role metadata is preferable for unusual layouts. This is a bounded wrong repair cycle, not an infinite loop.

## Mechanism 6: verification delays after model work ends — observed, not fully attributed

Intermediate post-guard ladder (`live-complexity-after.json`), level 3 repeat 2: first provider activity 3,320 ms, last root-model activity 10,730 ms, independent checking begins at 10,760 ms, and the 75-second external budget cancels the run. Four observed provider stream invocations include checker work. Source passes the independent out-of-project behavior oracle; host verification did not finish before cancellation.

For successful one-file trials, checking/closing adds substantial wall time after model output: level 3 repeat 0 last model activity 14,081 ms, final duration 43,533 ms; repeat 1 last activity 16,467 ms, final duration 45,980 ms. These are a measured tail, not permanent deadlock evidence.

Progress stopped being visible in the root stream while the independent checker worked. The checker uses up to 24 steps and runs on the same routed model/provider, with its own tool/stream recovery. Root status/context metrics do not expose every child's event. Before F22, its runner hint chose Node for the fixture's `bun verify.ts` script when no Bun lockfile existed. Two fail-before regressions reproduce this independently of the provider; leading declared Bun commands now select Bun without changing Vitest/Jest precedence. The complete root suite passes. Its contribution to these observed tail times is not isolated; final ladder results are reported separately.

### Diagnostic rerun: checker remained active, then reflection waited

`live-complexity-verifier-diagnostic.json` adds per-provider-round events and existing child activity callbacks to a separate one-file trial. The main generation ended at 15,360 ms. The independent checker started at 15,381 ms, repeatedly read files and ran short commands, wrote its test at 60,816 ms, ran another command at 62,896–63,513 ms, and ended at 66,870 ms. The host accepted its check and entered closing recap at 67,924 ms. Cancellation at 75,008 ms settled the run at 75,730 ms. Final source behavior passed and the answer contained a checked verdict; the deadline occurred during closing work.

This run establishes an **active but mostly hidden verification tail**, not a dead checker or pipe hang: every observed child tool call settled. Extra discovery and runtime probing included Node/Bun version commands despite a Bun fixture. The wrong runner hint is a plausible contributor to redundant work; its causal time share was not isolated. There were no queued pending primary tools, no model-loop stop and no claim of a captured native deadlock stack. Closing reflection is an additional provider operation outside the primary model activity metric.

The audit did not disable independent verification to make the benchmark green. No product timeout was increased. Final per-level results and remaining deadline hits are retained, including failures after the fixes. Other delayed trials lack equivalent child detail, so this one attribution is not generalized to all deadline hits.

## Mechanism 7: synchronous file range read — measured, open

`src/tools/file.ts` reads the entire file and splits every line before applying its output/range cap. Reading line 1 of a 32 MiB file returned 40 characters but blocked the event loop for 305–361 ms in three probes. First-run RSS increased about 226 MiB; later deltas fell. This establishes transient allocation and synchronous latency, not an ongoing memory leak. Very large/generated files can stall TUI and cancellation while parsing. A streaming/ranged read that preserves total-line reporting should be measured and regression-tested before replacement.

## Mechanism 8: memory writer starvation and recovery race — repaired, bounded stall

The store's first serialization repair passed isolated contention probes but failed the complete unsandboxed suite: five children exited zero while only 99 of their 100 admitted entries remained. A deterministic regression replaces the observed owner's lock while its PID check reports process exit. The reaper must not unlink that new live owner; it now checks the exact observed owner again. After that correction, the next complete suite exposed a separate admission problem: two writers reported memory busy at the one-second bound while a fast owner kept reacquiring through its batch.

The last progress event in the unfair case was another writer's completed memory admission. The waiting process was alive inside synchronous `Atomics.wait`/lock acquisition, so its own event loop and cancellation could not advance during that bounded wait. There was no model, tool queue or provider activity in this isolated store test. It was bounded starvation plus explicit failed admission, not an infinite database deadlock. The full-suite log preserves the failed writes; no exact native CPU stack or per-ticket timeline was recorded.

Unique time/PID/UUID tickets now admit the oldest live waiter before reacquisition; dead unique tickets are removed and owner-checked lock recovery remains. The wait budget stays one second. The regression requires all 100 bodies and checks that no writer monopolizes its whole batch. Ten stress repetitions each at 1/3/5 writers pass all 30 trials; final original three-repeat probes preserve 60/60 and 100/100 entries with zero errors. The latest five-writer median is 2.041 seconds, a fairness/correctness cost rather than a throughput win. The root suite also passes after this correction. Compound memory writes still lack crash-atomic transaction semantics and a long genuinely held operation can still produce a bounded busy failure.

Evidence: `validation-unrestricted-initial.json`, `validation-before-fairness.json`/log, `fairness-stress.json`, `final.json`, `src/memory/lock.test.ts`, `src/memory/concurrency.test.ts`.

## Mechanism 9: synchronous SQLite contention delays cancellation — measured, open

- Component: `src/storage/db.ts`, the synchronous `bun:sqlite` API and its 5,000 ms busy policy.
- Reproduction: `scripts/system-audit-db.ts` creates an isolated product SessionStore/database. A separate Bun process holds `BEGIN IMMEDIATE` for six seconds. The parent schedules an abort timer for 20 ms, then calls a real synchronous session-row write.
- Timeline: external writer prints `LOCK_READY`; parent enters `.prepare(...).run(...)`; no parent timer progress is possible during the native call. The write returns `SQLITE_BUSY` at 5,337–5,394 ms and the abort callback fires immediately afterward. The external owner subsequently rolls back and exits zero.
- Last successful progress event: confirmed external lock readiness. Progress stops in the parent database call, not at a provider or tool stream. The parent is alive inside a synchronous native operation; the external writer remains responsive. Provider/tool/queue/context size and memory retrieval are not involved in this isolated experiment.
- Evidence: three repetitions in `database-contention.json`; all seeded titles remain unchanged and `integrity_check` reports `ok`. The executed call site is the reproducible trace boundary; no native stack sample was captured, and no corruption or infinite wait is asserted.
- Root cause: bounded synchronous busy waiting occupies the same thread that services cancellation and UI timers. An AbortController outside that API cannot interrupt it.
- Correct next change: instrument contention and keep transactions short; evaluate an owned worker if real workload measurements justify it. Merely raising busy timeout would extend the blockage. No product fix was bundled without the persistence/concurrency coverage it requires.
- Before/after: 3/3 delayed timers observed; no post-fix improvement claimed. This is independent of the separate-Agent probe, which disables SQLite session persistence.

## Mechanism 10: a wall-clock memory deadline can wait indefinitely — repaired

- Component: `src/memory/lock.ts`, synchronous lock admission.
- Reproduction: a live owner holds the lock. An isolated worker replaces `Date.now` with a constant, then attempts admission. Its parent has a separate 2,500 ms laboratory kill bound.
- Timeline: worker creates its unique ticket and repeatedly attempts/waits. With the former `Date.now() + 1000` deadline, wall time never reaches the limit and the parent must kill it; fail-before result has no normal exit status. With `performance.now() + 1000`, the worker reports the explicit busy failure and exits zero before the laboratory bound.
- Last successful event: ticket creation / live-owner recognition. Provider/model/tool/context and agent queue are not involved. The worker remains alive inside bounded synchronous waits, but the former enclosing loop had no advancing deadline. This is deterministic clock fault injection, not a claim that the host machine's clock actually froze.
- Root cause and fix: wall clocks can jump or stop relative to elapsed work. Use the monotonic elapsed clock for admission's existing one-second budget; no timeout value changed. Ticket ordering still uses wall-clock labels and is not a global clock/fairness guarantee.
- Regression: `src/memory/lock.test.ts`, "keeps its wait bound when the wall clock stops advancing". Original three-repeat bounded probes and full root validation pass afterward. The regression measures bounded settlement, not exact nanosecond timing.
- Remaining crash limitation: the short-lived `.write-lock.reap` mutex has no abandoned-reaper recovery. Compound memory body/index/history writes are also not one transaction. These source-derived crash windows remain in the hardening roadmap; a killed-memory-lock stress campaign was not completed.

## What has not been established

A related query failure was found at the attachment/transcript boundary: freshly prepared local and remote file data passed the installed SDK schema, but the JSON round trip converted binary values into unsupported plain objects (2/2 failures). New attachments now carry SDK-supported base64 data, preserving decoded bytes and replay validity (2/2 passes). This is an input-protocol failure, not a reproduced network freeze; no native provider connection participates. Legacy rows are not migrated. See `vision-json-roundtrip.json` and the ten vision regressions.

No historical 48–73 minute trace gap was labeled a freeze merely from missing content. Historical traces lack full per-step correlation and often buffered text. There is no captured native stack proving SQLite deadlock, exhausted socket pool, SSE parser deadlock, leaked browser connection, or an entire long-run process frozen forever. Those remain hypotheses until reproduced. The browser marketing/demo path is not a UI-to-agent transport, so a browser websocket disconnection cannot explain the CLI failures tested here.

This evidence rejects “just raise the timeout” as a complete remedy. It also rejects “all freezes are fixed”: independent verification, unbounded operation paths, shared serialization and synchronous work remain material risks.
