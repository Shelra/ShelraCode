# ShelraCode: forensic audit and engineering hardening

Evidence date: 2026-10-04. Scope: the current working checkout, Bun 1.4.1 on Windows, including the repairs below. The unrelated `scripts/npm-publish.ts` edit was preserved. No new dependencies, provider redesign, production deployment or binary installation was performed.

## Can this agent be trusted for months of production work?

**The evidence does not establish that capability.** Shelra has a substantial agent runtime, persistent memory, recovery policy and an unusually active host verification gate. It is considerably more than a prompt followed by tools. Nevertheless, green baseline tests coexisted with reproducible cancellation failures, incorrect command success, lost concurrent memory, lost closing plans, tool-protocol false success and a completion guard that fought legitimate coding changes. The live rerun still has verification tails that exceed the experimental task budget. These are material barriers to unattended operation.

Fifteen defect groups were repaired with regressions, and traces now expose real model activity and prepared context sizes. The short deterministic improvements are strong evidence for those particular fixes. They do not demonstrate production correctness over weeks, semantic intent preservation through arbitrary follow-ups, safe multi-tenancy or leak-free endurance. Scores and priorities below are engineering assessments of this evidence, not statistically validated product ratings.

The complete intermediate 30-trial live comparison did **not** show an overall success-rate improvement: independent behavior correctness stayed 27/30. Correct results without a negative bracketed outcome notice rose from 6/30 to 8/30, repeated signatures fell from 60 to 29, but experimental deadline hits rose from 17 to 21. The final rerun collected 26/30 trials before OpenRouter returned Limited with a reset at 20:00 local time; four were not executed. In the same 26 level/repetition pairs, behavior correctness went from 23 to 24, repeated signatures from 58 to 21, and deadline hits from 13 to 16. Exact paired comparisons are in the benchmark report. These are small fixtures with tighter budgets than production (60/45/20-second model budgets and a 75-second turn budget, versus product defaults 15 minutes/5 minutes/90 seconds). Changing free-router models, stronger final grading and incomplete auxiliary metrics prevent causal claims about aggregate tokens/latency. Later MCP status, Windows PID, monotonic-lock and image-persistence follow-ups are covered by fail-before regressions and final checks; they are not claimed as a completed fresh 30-trial live ladder.

Read the [actual architecture and state diagram](ARCHITECTURE.md), [freeze analysis](SHELRA_FREEZE_ROOT_CAUSE_ANALYSIS.md), [memory/context investigation](MEMORY-CONTEXT-AUDIT.md), [benchmark results](BENCHMARK-RESULTS.md) and [living experiment ledger](WORKING-AUDIT.md). Raw results and executable harnesses are retained; the benchmark report specifies experimental limitations and reproduction commands.

## What explains the reported symptoms?

**Query failures have several sources.** The host could report success for a PowerShell command whose last cmdlet failed, and for an MCP result explicitly marked `isError`. Its check-definition guard classified application imports as immutable test infrastructure. This injected repair instructions telling the model to undo legitimate changes. One live debugging trial actually restored correct code and stopped. Cancellation, unsupported runner assumptions and verification latency contributed independently. The free router also serves different upstream models: provider/model variability is present, but cannot explain the deterministic host failures.

**Freezes are not one defect.** A pending stream read ignored cancellation; a shell child that never emitted `close` could keep cancellation pending; large newline-free stderr blocked the event loop; undrained MCP stderr blocked a real child before initialization. These were reproduced and repaired. A wall-clock memory wait could also become indefinite when the clock stopped advancing; its deadline is now monotonic. A large ranged file read still performs a full synchronous read, SQLite contention demonstrably blocks cancellation about 5.4 seconds, and live turns still spend long periods inside verification. Historical traces with gaps are corroborating leads, not proof of current deadlocks. Each measured mechanism is documented separately in the freeze report.

**Primitive behavior is partly architectural.** The model authors decomposition, chooses discovery/edit strategies and revises hypotheses. The host provides context, plans, tools, bounded recovery and evidence gates, but does not maintain a mandatory dependency plan, durable engineering hypotheses or a single enforced task state machine. Lexical novelty is used as a progress proxy. An active gate can therefore make a capable model behave worse, while a weaker model must supply almost all higher-order engineering strategy itself. The baseline ladder's passing behavior with negative host outcomes is a concrete example of orchestration limiting useful work.

**Intent was lost at specific boundaries.** Compaction could preserve an inaccurate summary while dropping the verbatim active objective. Normal turn closing omitted a plan that live recovery had preserved. Claimed/unverified outcomes could retire unfinished work. These paths now have explicit preservation tests. Current-objective retention 20 and 50 tool steps back is proved at the input boundary; semantic compliance under a real model, every prior objective after a new follow-up, and arbitrarily large constraints are not proved.

**Memory works, but imperfectly.** The controlled real-Agent/scripted-provider suite improved from 10/11 to 11/11 scenarios, including cold start, fresh processes, changed business rules and a killed refactor. Concurrent memory admission improved from 20/100 to 100/100 entries. Retrieval ranking itself did not improve: at 5,000 synthetic distractors, body recall is 83% and precision 75%; standing-rule recall is 100% in that dataset. Vague and cross-language queries are weaker than direct file/name queries. This is useful persistent memory, not evidence of reliable unlimited project understanding.

## Failure report

P0 means catastrophic or an unconditional block to core usage. None was established to that standard. P1 findings can seriously undermine unattended usage even when they do not affect every query. A fixed row means its stated regression passes; it does not certify every surrounding subsystem.

| ID | Severity | Subsystem / symptom | Root cause | Evidence / reproduction | Fix or required action | Verification |
| --- | --- | --- | --- | --- | --- | --- |
| F01 | P1 | Stream cannot cancel | `withIdleWatchdog` raced read against idle only; idle=0 removed the race entirely | Hung async iterator, cancellation at 20 ms; before settles only at artificial 180 ms rescue | Explicit abort race and listener cleanup | Original tests and repeated timing probe pass, approximately 21 ms after |
| F02 | P1 | Shell cancellation waits forever; stale Windows PID can remain tracked | Abort awaited unguaranteed `close`; exit and pipe closure were conflated | Never-close child and exited-parent/open-pipe exit-sweep regressions | Bounded 5-second settlement; release Windows PID on actual exit; preserve Unix group ownership; report unconfirmed closure | Both fail-before/pass-after lifecycle regressions pass; no real unrelated PID was killed |
| F03 | P1 | Failed command counted successful | Stale native `LASTEXITCODE=0` overrode last PowerShell cmdlet failure | Native success then missing `Get-Item`, 3/3 false exit 0 | Correct epilogue precedence; preserve native nonzero code | Real Windows regression; 3/3 correct exit 1 |
| F04 | P1 | Huge stderr appears frozen | Unbounded pending line repeatedly concatenated/split synchronously | 8 MiB without newline, approximately 2.35 seconds in the synchronous parser | Stream oversized pending lines with 64 KiB bound | Lossless regression; approximately 1 ms parser probe |
| F05 | P1 | Memory loses facts, starves writers or blocks after clock change | Unlocked index mutation/shared temporary; first repair had unsafe recovery/unfair admission and a wall-clock deadline | Initial 3/5-process probes; full-suite loss/rejections; isolated frozen-clock worker exceeds rescue bound | Unique temporary, owner-checked recovery, fair tickets and monotonic deadline; one-second wait unchanged | Final 60/60 and 100/100 readable; stress/full suite and frozen-clock regression pass |
| F06 | P1 | Unfinished work disappears | Claimed status treated as finished; unverified untracked closing retired plans | Episode/open-plan unit scenarios | Only completed steps finished; only verified closing retires untracked plan | Episode regressions pass |
| F07 | P2 | Abort listeners accumulate | Local-provider listener never removed after successful stream | Repeated successful streams with listener spies | Named listener removed in generator `finally` | Fail-before/pass-after test; long RSS trend not measured |
| F08 | P1 | Compaction loses original intent | Checkpoint depended on summary and published criteria | Wrong-summary fixture with objective 20/50 steps back | Pin bounded JSON-quoted active objective | Both preservation regressions pass; live semantic adherence remains unproved |
| F09 | P1 | Image preparation stalls; resumed attachment becomes invalid | Unbounded fetch/body and binary object loses SDK type in JSON transcript | Pending fetch/body, abort/size/URL fixtures; local/remote replay rejected by installed SDK schema | Shared 10-second deadline, 10 MiB cap, explicit notice, fetch once; new data encoded as base64 | Ten vision regressions pass; 0/2 to 2/2 replay validity; legacy rows not migrated |
| F10 | P1 | MCP initialization blocks / leaks late client | Piped stderr never consumed; timeout did not own cleanup | Real child writes 2 MiB stderr before handshake; late-client mocks | Drain without logging raw content, bounded transport/late-client cleanup | Undrained policy fails 3/3 at 500 ms; fixed handshake 45.6–51.2 ms, 3/3 |
| F11 | P1 | One process manager stops another | Module-global process registry | Separate managers at 1/3/5 with owned mock children | Registry scoped to instance | Ownership regression passes; whole-agent tenant isolation not established |
| F12 | P1 | Restart loses normally closing plan | `learnFromTurn` omitted plan, then marked turn learned and removed live record | Real Agent closing fixture; cold-start memory scenario | Merge current plan into every closing digest | Cold-start 11/12 to 12/12; suite 10/11 to 11/11 |
| F13 | P1 | Guard reverses correct coding work | Check discovery recursively protected ordinary application imports | `bun verify.ts` imports invoice/tax/summary; live debugging reversal | Follow transitive tooling helpers only, preserve actual check protection | New regression and existing protection tests pass; live rerun separately reported |
| F14 | P1 | Tool failure becomes successful live/resumed/model evidence | Host stringified MCP errors as success; SDK converter discarded `isError`; persistence coerced nonboolean success | Original three cases plus four fail-before model/persistence regressions; installed SDK converter inspected | Common host/resume interpretation; MCP failure emits SDK `error-text`, successful image converter preserved | All protocol/MCP/transcript tests pass; complete root suite passes |
| F15 | P2 | Trace cannot distinguish host prose from model progress | Turn traces lacked correlation and prepared context/real activity timings | Host notice preceding actual model activity; interleaved traces | Run UUID, elapsed/stage/tool timings, context counts, first/last model activity | Trace regressions pass; child operation detail still incomplete |
| F16 | P2 | Verification/closing appears frozen from primary stream | Independent checker and reflection add largely hidden work | Diagnostic main ends 15.360 s, active checker ends 66.870 s, closing starts 67.924 s; experimental deadlines are tighter than production | Runner hint repaired; expose all child/closing operation lifecycle and measure before changing budgets | Active hidden tail established; neither deadlock nor default-runtime task failure established by that budget |
| F17 | P2 | Ranged file read blocks loop / allocates heavily | `read_file` reads/splits whole file before limiting output | One line of 32 MiB: 305–361 ms event-loop delay, first RSS delta approximately 226 MiB | Bounded streaming/ranged reader after preserving encoding and line semantics | Measured; open; not a permanent freeze or leak claim |
| F18 | P1 | External operation can outlive task cancellation | No universal operation owner/deadline; hardening awaits arbitrary `execute` | Source: optional tools, download paths, Windows taskkill callback, cleanup/log settlement | Common named operation wrapper with cancellation, output limit and explicit unsettled state | Static evidence; individual paths need fault-injection coverage |
| F19 | P1 | Long-term intent/state can drift | Objective, plan, observations and completion receipts spread across kernel, locals, transcript, episodes | State diagram and closing/compaction defects; latest request replaces active kernel objective | One persisted task record with explicit accepted constraints and verified observations | Architecture limitation; no months-long proof |
| F20 | P1 | Credentials/private output can reach logs or tools | Shell inherits environment; raw run log differs from trace redaction | Isolated fake-key/password shell probe: both reach capture/disk; trace masks known key, not arbitrary password | Define streaming log/capture redaction and child environment policy without corrupting output or chunk-boundary protection | Runtime exposure confirmed with artificial credentials only; no real credential/network/exfiltration |
| F21 | P1 | Separate sessions are not a tenant boundary | Same-Agent mutable state; shared scratch/resources; global Telegram serialization | `Agent.runTurn`, workspace guard scratch root, turn coordinator; separate-Agent 1/3/5 probe | Enforce single-flight per instance, owner/session scope and explicit queue policy | Scripted separate instances: 27 turns settle, 18 unrelated answers correct, no foreign project marker; tenant security/persistent load unproved |
| F22 | P2 | Checker selects wrong runtime | Runner hint recognized Bun lock or `bun test`, not `test: bun verify.ts` | Bun-only fixture gets Node hint; live Node `.ts` symptom and fail-before unit cases | Leading declared Bun command establishes runtime; Vitest/Jest precedence retained | Custom Bun script and `bun run` regressions pass; isolated latency share of F16 unproved |
| F23 | P2 | Answer checker flags historical code as missing path | Path-shaped identifier heuristic lacks semantic context | Live L3 explains old `items.length`; claim check says nonexistent path | Restrict filesystem claims to explicit path references/evidence | Observed false warning; open |
| F24 | P2 | CI misses critical runtime regressions | CI runs formatting/lint/typecheck/build, not root test chain | `.github/workflows/typecheck.yml`; green initial baseline despite reproduced failures | Add runtime regression job with platform matrix where practical | Static; workflow unchanged in this audit |
| F25 | P2 | Compatible endpoint metadata overpromises | Generic adapter assumes capabilities/context and sends provider-shaped reasoning options | `runtimes/local-provider.ts` capability/request construction | Explicit capability negotiation/defaults and provider contract tests | Source finding; only OpenRouter exercised live |
| F26 | P2 | Old unfinished task falls out of effective memory | Plans derived from bounded rotating episodes; only selected open plans injected | `memory/episodes.ts` rotation and plan lookup | Persist active tasks independently of episode retention | Source limitation; rotation endurance not empirically established |
| F27 | P2 | Log output can accumulate outside bounded captures | Run-log writes ignore backpressure; close waits on stream; disk logs not equivalently capped | `exec/logging.ts` / `RunLog` and background log path | Bounded spool/rotation and explicit write/close failure status | Static; no prolonged disk-fill experiment |
| F28 | P1 | Independent checker can change the project it checks | Checker gets ordinary file/shell tools; forbidden changes are detected after execution | `Agent.runIndependentCheck` snapshots changes and tells parent to review rather than enforcing write scope | Enforce checker writes to its owned verify directory and isolate shell side effects | Static privilege-boundary finding; no exploit claimed |
| F29 | P2 | Simple questions carry substantial fixed prompt/schema cost | Agent mode keeps coding instructions/context/tool schemas even without tools | Final arithmetic level: 25,376 reported input tokens across three one-round, zero-tool trials | Measure wire schema share, then narrow context/tool surface by actual task mode | Numeric overhead established; not a proved latency bottleneck |
| F30 | P2 | SQLite wait blocks cancellation and other local activity | Synchronous `bun:sqlite` write waits on five-second busy policy in the event loop | Three external-writer trials: intended 20 ms cancellation fires after 5337–5394 ms; SQLITE_BUSY; integrity ok | Short transactions, explicit contention telemetry, then consider an owned DB worker if actual load justifies it | Measured bounded blocking; open; not a permanent deadlock or corrupt database |

The fifteen repair groups F01–F14 and F22 are small boundary changes, not an agent rewrite. F15 is an observability improvement. F02/F05/F09/F14 required additional ownership, clock and SDK/persistence follow-ups after isolated successes. Remaining rows distinguish measured failures from source-derived risks. Full-suite failures of the first memory repair are retained; no wait budget or assertion was relaxed to make them pass. Required checks, exact outputs and failed intermediate results are in [VALIDATION.md](VALIDATION.md).

## Evidence-based scorecard

Scores describe the inspected and repaired system. Confidence is limited where only controlled fixtures or source inspection exist. A green unit suite is not a score of ten.

| Capability | Score / 10 | Reason and practical limit |
| --- | --- | --- |
| Query reliability | 5 | Simple live fixtures succeed; completion failures and deadline hits remain |
| Complex-task reliability | 3 | Check-guard defect repaired, but multi-file verification often outlasts budget; no production endurance |
| Coding intelligence | 5 | Live fixtures frequently produce correct code; decomposition and strategy remain model dependent |
| User-intent preservation | 5 | Objective/plan boundary fixes have direct tests; not all historical constraints are explicit task state |
| Repository understanding | 5 | Compiler/discovery/tools exist; 200-file fixture is modest and no call graph or production-project evaluation proves depth |
| Planning | 5 | Published plans persist better after repair; planning is optional and not an enforced dependency model |
| Tool usage | 6 | Built-ins validate schemas and recover errors; MCP protocol repaired, generic limits still inconsistent |
| Error recovery | 6 | Bounded retries/fallbacks preserve steps and policy; unbounded external cleanup still possible |
| Self-correction | 5 | Host repair and circle detection exist; former guard actively defeated valid correction; no robust hypothesis model |
| Verification | 5 | Real host checks and independent tests are strengths; guard/runner repaired, false path warnings and lengthy tail still limit reliability |
| Memory | 6 | 11/11 controlled continuity scenarios after fix; 83% recall and 75% precision under ranking stress |
| Long-term project continuity | 4 | Crash/restart fixture and durable facts work; bounded episodes/constraints and no months-equivalent live workload |
| Context engineering | 6 | Selected context, durable rules, compaction, stale-result clearing; imperfect ranking, summary trust and token estimates |
| Provider reliability | 5 | Real free-router variability plus useful fault handling; other providers not validated live here |
| Concurrency | 4 | File admission/ownership repaired; separate real-Agent scripted 1/3/5 succeeds, but timer delay grows and persistent/provider/tenant load is unproved |
| Performance | 5 | Parser defect fixed; full-file reads and synchronous SQLite contention block the loop; active verification adds long tails |
| Observability | 6 | Correlation and primary progress/context timings added; child, queue, complete wire cost and watchdog gaps remain |
| Crash recovery | 5 | Interrupted memory/plan scenarios survive restart; partial file changes and running processes are not an atomic recoverable task |
| Security | 4 | File realpath guards and command policies help; inherited environment, raw logs and privileged repo instructions are weak boundaries |
| Maintainability | 4 | Many useful focused modules/tests, but approximately 6,265 nonblank lines in Agent and 7,260 in TUI concentrate coupled state |

## Top 10 problems in Shelra

| Rank | Problem / why it happens | Evidence | User impact | Correct fix / current status |
| --- | --- | --- | --- | --- |
| 1 | Verification can contradict the user or fail to finish: check roles are heuristic and child work is opaque | F13, F16, F22, F23; live ladder | Correct work can be reversed, held or look frozen | Guard and runner repaired; finish child visibility and claim correction; diagnostic shows active hidden work, other delays remain open |
| 2 | Cancellation is not a complete lifecycle guarantee | F01, F02, F09, F10, F18 | Esc may return slowly or leave external work alive | Four bounded-path repairs; universal ownership and settlement still needed |
| 3 | Host success could be false | F03, F14 | Failed commands/tools become trusted completion evidence | PowerShell and MCP protocol repaired with fail-before regressions |
| 4 | Project memory could silently lose concurrent knowledge | F05 | Long sessions forget admitted facts and context varies | Owner/admission races repaired, fairness and bodies verified under full suite; multi-file transaction still open |
| 5 | Restart/closing could erase unfinished plans | F06, F12 | Interrupted work resumes without its intended remaining task | Closing and plan semantics repaired; independent durable task store still needed |
| 6 | Active objective could disappear behind a misleading checkpoint | F08, F19 | Agent follows a summary rather than original constraints | Current objective pinned; all accepted constraints/older unresolved objectives still need explicit state |
| 7 | Synchronous parsing, file work and database waits block async progress in a process | F04, F17, F30 | UI/stream/cancellation pauses during local work | Stderr parser repaired; bounded ranged reads and database contention remain open |
| 8 | Tool/process ownership and session isolation are incomplete | F11, F21 | One operation can affect another; one pending queued turn delays others | Process ownership repaired; separate-Agent pending-stream test passes; single-flight, persistent/provider load and tenant scope remain |
| 9 | Progress means novel words/calls more often than verified engineering progress | Architecture, F15/F19; lexical stall detector | Long tasks can continue without moving toward acceptance | Keep loop safeguards; add task/operation progress classification and evidence receipts |
| 10 | Trust/privacy boundaries do not match an autonomous agent's privileges | F20/F21/F27; instruction loader | Shell/logs can expose private data; repo content can influence privileged instructions | Explicit environment/log/trust policy and adversarial coverage; not a cosmetic cleanup |

## Problems discovered that were not reported by the user

The audit found false PowerShell success, MCP failure lost in host/model/persistence representations, import traversal protecting production code as checks, normal closing omitting the plan, concurrent admission losing 80 of 100 entries, a global process registry, listener retention and wrong verification runtime. Regression also exposed unsafe owner recovery, unfair admission, a wall-clock wait that could become indefinite and a stale Windows PID tracked after exit. These defects were corrected with fail-before tests. False path warnings for `items.length` remain open. Local experiments confirmed a synchronous SQLite wait delays cancellation approximately 5.4 seconds, and fake credentials survive raw command logging. These are independent of the user's initial theory about model quality.

Attachment preparation exposed another continuity failure: both local and downloaded binary file parts lost SDK validity after transcript JSON serialization. New attachments now preserve their bytes as SDK-supported base64; both replay cases pass. Existing binary-object rows require a separate migration and have not been repaired retroactively.

Additional source-derived limitations include shared scratch scope, raw run-log privacy/backpressure, episode rotation as active-task retention, generic provider capability assumptions and a CI workflow that does not run runtime tests. They require narrower experiments before quantifying frequency or declaring an exploit.

The independent checker is instructed not to modify production files, but this is checked after execution rather than enforced as a tool boundary (F28). Even arithmetic requests consume roughly 8,459 reported input tokens per trial without tools (F29); context/schema overhead deserves explicit measurement before optimization.

## Documented, implemented and observed

| Claim / expectation | Implementation | Observation |
| --- | --- | --- |
| Cancellation ends a turn promptly | Signals exist widely, but stream read and child close were uninterruptible boundaries | Deterministic hang regressions; repaired boundaries settle within stated bounds |
| Persistent plans survive closing and restart | Live digest included plan, normal closing did not | Cold-start assertion failed; now 12/12 |
| Memory admission persists facts | Separate unlocked index/body writes | Lost 40/80 entries at concurrency 3/5; now no index/body loss in that fixture |
| Test protection guards checks, not application changes | Recursive import traversal did not distinguish roles | Legitimate code repair held/reversed; guard corrected |
| Failed resources remain visible and recoverable | Error hardening exists, but result conversion and shell exit semantics disagreed | Host could count failure as success; repaired |
| CLI freeze might be browser SSE desynchronization | Main product is OpenTUI/headless; frontend dashboard is not its transport | Browser reconnect scenarios do not explain this agent path; actual TUI load/reconnect remains untested |

## Technical debt that matters

**Reliability-critical debt:** incomplete external-operation ownership/cancellation; contradictory completion guards; implicit closing persistence; file-store compound writes without transactions; incomplete child/queue traces; missing runtime CI. These are supported by failures or concrete unbounded paths.

**Structural debt:** Agent/TUI concentrate many mutable concerns; objective/plan/evidence have multiple representations; optional autonomous runtime remains separate; lexical retrieval and progress detection have semantic limits. Extraction should follow operation, task and verification boundaries already demonstrated. Moving code into new classes without ownership semantics would not solve these failures.

**Cosmetic debt:** long files, repetition, legacy comments and naming inconsistencies are not automatically urgent. No broad formatting, dependency refresh or stylistic rewrite was bundled into critical fixes. Source size is a maintainability signal, not a measured freeze root cause.

## Smallest target architecture

| Responsibility | Current | Minimal target justified by evidence |
| --- | --- | --- |
| Task truth | Kernel + messages + plan + local gate variables + episodes; objective persistence also exists | Extend the existing persistence into one authoritative task record: objective, accepted constraints, criteria, plan, observations, verification receipts; immutable identity |
| External work | Each tool/provider/helper owns different timers and cleanup | Common operation envelope: run/task/owner IDs, signal, stage, meaningful progress, bounded settlement, explicit unsettled result |
| Completion | Many branches in `runTurn` plus optional child checker | One completion coordinator preserving working guards, explicit check-file roles and a typed outcome/receipt |
| Continuity | Live record + episode-derived plans + reflection | Atomic closing task snapshot; episodes as history, not the only active-task database |
| Context | Compiler, retrieval, checkpoint, adapter pruning | Keep working selection; pin task constraints, expose actual prepared sizes/schema usage and selected-memory provenance |
| UI / queue | TUI queue, Telegram promise chain, streamed chunks | Owned queue entries with wait/run/verification state, child progress and cancellation state |

Keep the single Bun package, SQLite, filesystem memory, provider adapter, tools and evidence gate. No microservices, embeddings mandate or wholesale provider redesign is warranted by this evidence.

## Roadmap tied to findings

**P0 — fix now:** no additional proven P0 in this audit. Investigate any future unconditional deadlock, task corruption or credential exfiltration as P0 when reproduced. Do not label all weaknesses catastrophic.

**P1 — next:** implement owner/deadline settlement for F18; persist a single task contract/closing record for F19/F26; define log/environment privacy for F20; enforce instance single-flight and session ownership for F21; enforce checker write/command ownership for F28. Preserve the F01–F14/F22 repairs and their regression coverage. These directly affect unattended correctness and cancellation.

**P2 — hardening:** finish F16 child/closing operation visibility and profiling; bounded ranged reads F17; explicit check roles and claim handling F13/F23; runtime CI F24; capability-contract tests F25; bounded log spool F27; SQLite contention telemetry F30 and transaction/recovery fault injection around memory and episode rotation. Include process death during the new lock-reaper critical section: its static `.write-lock.reap` file has no abandoned-reaper recovery, a source-derived residual risk rather than a passed crash test. Measure before optimizing. Extend the real-Agent scripted 1/3/5 probe to persisted sessions and real providers; add repeated FD/socket/timer/RSS sampling and TUI cancellation under load.

**P3 — advanced agent capabilities:** host-supported dependency planning, hypothesis/decision tracking, durable repository structure and stronger semantic retrieval. Introduce each only after a production-project evaluation shows a concrete gap beyond model quality; use acceptance-level tests rather than a more impressive prompt.

## What remains unproved

No months-long live endurance was run. The year-in-a-box/memory fixtures use scripted model behavior, despite exercising the real Agent and fresh processes. The 1/3/5 separate-Agent concurrency probe also uses a scripted provider and no SQLite persistence. No complete real-provider concurrency load test, provider matrix, sustained socket/FD/RSS leak profile, actual Supabase failure test, malicious-repository prompt-injection campaign or interactive TUI load/cancel recording was completed. Frontend typecheck and backend 32 fake-database tests are baseline checks, not agent transport evidence. The complexity ladder uses small fixtures, changing upstream free models, three repetitions and a 75-second experimental budget; it cannot isolate model quality from orchestration statistically.

The optional `--autonomous` runtime and persistent background delegation are separate paths; source inspection and existing tests are not an independent live benchmark of them. Default-Agent conclusions must not certify every mode. Timing evidence is wall-clock/stage/blocked-timer profiling, not an exclusive CPU flamegraph or a complete wire-token profile.

These limits matter to the original question. Shelra is measurably harder to break at the repaired boundaries. It has not yet earned evidence-backed trust as a months-long autonomous production engineer.
