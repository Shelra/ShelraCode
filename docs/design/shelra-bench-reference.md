# Shelra Bench - technical reference

This is the consolidated operational reference for Shelra Bench. The system
turns every benchmark invocation into durable evidence about the Shelra agent
harness.

The primary question is:

> Can Shelra transform human intent into a verified working result?

Shelra Bench is not primarily a contest between language models. Shelra is the
system under improvement. The model and provider are recorded controlled
variables so a harness change can be separated from a model change.

This document describes the implementation currently in the repository. The
benchmark is a development instrument, not a public certification or a claim
that the current task ladder represents all software engineering.

## 1. Product contract

Shelra Bench must satisfy these invariants:

1. Every invocation creates a new run ID and a new monotonic run number.
2. A run is created before manifest, provider, or environment validation.
3. Task progress is persisted incrementally, not only at process exit.
4. Finalized run summaries and finished task results are immutable.
5. Failed, cancelled, invalid, and interrupted runs remain visible.
6. A leaderboard row is never created from fixture data or an invented score.
7. Scores are derived from recorded evidence and are allowed to be N/A.
8. Agent, model, harness version, benchmark version, suite, commit, and
   environment remain visible in the result provenance.
9. The benchmark-owned oracle is separate from files the agent can edit.
10. A host oracle pass is not counted as the agent having verified its own work.

The benchmark therefore measures the harness chain:

~~~text
human intent
  -> agent interpretation
  -> specification and plan
  -> tool execution and file changes
  -> resulting software
  -> external verification
  -> intent fidelity and autonomous recovery
~~~

### What this benchmark is not

- It is not a model popularity leaderboard.
- It is not a collection of fake production entries.
- It is not a test of generated prose or private reasoning.
- It is not valid to compare incompatible benchmark versions as if they were
  one series.
- It is not valid to call missing token, cost, memory, or research telemetry
  zero.

Other agents can be run through an adapter for calibration, but the default
analysis scope is Shelra. A model filter is always available because changing
the model can otherwise look like a harness improvement.

## 2. Terminology and ownership

| Term | Meaning |
| --- | --- |
| BenchmarkRun | One complete invocation, with a new ID, metadata, progress, scores, and status. |
| TaskResult | The result of one task attempt within a run. |
| Acceptance criterion | One independently evaluated requirement, such as AC-01 PASS or AC-03 FAIL. |
| External oracle | A deterministic benchmark-owned check outside the agent workspace. |
| Agent | The harness/system under evaluation, for example Shelra. |
| Model | The model selected by the agent, recorded separately from the agent. |
| Suite | A coherent task collection, for example shelra-agent-core. |
| Benchmark version | Version of methodology, manifest, tasks, and score policy. |
| Baseline | An explicit pointer to a completed compatible run. |
| Artifact | A reference to evidence stored outside the summary row. |

The runner owns lifecycle and persistence. The executor adapts an agent to the
task contract. The oracle owns correctness checks. The UI reads persisted
history; it does not manufacture benchmark data.

## 3. Research basis

The information architecture was informed by existing evaluation systems:

- [OpenRouter Benchmarks](https://openrouter.ai/benchmarks/tau2-bench-airline)
  keep model/provider identity next to accuracy, cost, time, and tokens and
  expose methodology.
- [SWE-bench](https://github.com/swe-bench/SWE-bench) makes suite, task count,
  resolved rate, and evaluation conditions visible.
- [SWE-bench evaluation guide](https://github.com/SWE-bench/SWE-bench/blob/main/docs/guides/evaluation.md)
  separates evaluation execution from the patch being evaluated.
- [Terminal-Bench](https://github.com/softpudding/terminal-bench) makes the
  model/agent distinction and execution cost visible.
- [Harbor evaluation documentation](https://www.harborframework.com/docs/run-jobs/run-evals)
  treats an evaluation as a reproducible job with run-level configuration.
- [Harbor dataset adapters](https://www.harborframework.com/docs/datasets/adapters)
  illustrate why task adapters and benchmark contracts should be explicit.

These are research references, not templates to copy. Shelra adds a
harness-first subject, criterion-level intent fidelity, self-verification
telemetry, and an immutable local history.

## 4. Repository architecture

The implementation reuses Shelra's existing persistence and runtime:

| Concern | Implementation |
| --- | --- |
| Domain types | `src/bench/types.ts` |
| Score calculation | `src/bench/scoring.ts` |
| Manifest loading | `src/bench/manifest.ts` |
| Host/environment metadata | `src/bench/environment.ts` |
| Run lifecycle | `src/bench/runner.ts` |
| Shelra adapter | `src/bench/shelra-executor.ts` |
| Cross-run storage | `src/storage/benchmarks.ts` |
| Schema/migrations | `src/storage/migrations.ts` |
| TUI surface | `src/ui/bench-modal.tsx` |
| CLI entry | `src/index.ts` and `shelra-bench.sh` |
| Development suite | `bench/suites/shelra-agent-core-v0.2.json` |
| Oracle code | `bench/oracles/` |
| Immutable templates | `bench/fixtures/` |

There is one SQLite database at the normal Shelra location
`%USERPROFILE%/.shelra/shelra.db` on Windows or `~/.shelra/shelra.db` on
POSIX systems. Shelra Bench does not introduce a second database.

The autonomy journal remains the detailed source of truth for an objective's
actions and observations. SQLite is the indexed cross-run surface. Large logs,
diffs, screenshots, and traces are referenced as artifacts rather than copied
into leaderboard queries.

## 5. Run lifecycle and persistence

### 5.1 Creation

`createBenchmarkRun()` executes before provider setup and before manifest
validation. It creates:

- a fresh ID such as `run_20260914143723_83bafb09`;
- a monotonic `run_number`;
- a `queued` row;
- a first `run_created` event.

This means a malformed manifest or missing provider still leaves a historical
`invalid` or `failed` record.

### 5.2 Execution

The runner moves through these states:

~~~text
queued -> preparing -> running -> verifying -> completed
                                  |-> failed
                                  |-> cancelled
                                  |-> interrupted
                                  |-> invalid
~~~

The exact terminal state describes the run, while task rows describe the
engineering result. `completed` means the suite ran to its end; it does not
mean that every task passed.

After each task, the runner writes:

- the task status and scores;
- acceptance-criterion results;
- tokens and cost when supplied;
- behavior counters;
- failure type/reason;
- evidence references and objective journal path;
- progress on the parent run;
- structured events.

### 5.3 Finalization and immutability

At finalization, the runner aggregates task results and writes the run summary.
The database rejects updates to a finalized run and rejects updates to a task
whose `finished_at` is set. A correction is a new run; raw measured history is
not edited.

Metadata annotation can be added in a future layer, but it must not rewrite
measured results.

### 5.4 Crash recovery and resume

The run stores a process ID and heartbeat. On a later Bench operation, active
runs whose owning process is no longer alive can be marked `interrupted`.
Already persisted task rows remain available.

The MVP deliberately does not resume an interrupted run. Restarting creates a
new run ID, preserving reproducibility and avoiding a silent mixture of two
execution environments. A future resume feature would need an explicit
checkpoint and compatibility contract.

## 6. Manifest and task contract

A manifest contains:

~~~text
benchmarkVersion
suite
oracleMode
tasks[]
scorePolicy
seed
config
~~~

Each task contains:

~~~text
id
category
difficulty
prompt
acceptanceCriteria[]
workspaceTemplate
researchRequired
memoryRequired
repairExpected
metadata
~~~

In a strict suite, `oracleMode` is `benchmark-owned`. Every criterion must
contain a deterministic `CheckSpec`. The runner rejects a strict manifest that
has no criteria or a criterion without a check.

The agent may derive criteria for planning, but generated criteria are never
the authoritative oracle in a strict suite. The oracle is run after the agent
finishes and receives the copied workspace as its working directory.

### Fresh workspaces

When a task declares `workspaceTemplate`, the runner copies the immutable
template into:

~~~text
.shelra/bench/runs/<runId>/tasks/<taskSlug>-<taskHash>/
~~~

Each run/task therefore starts from the same fixture without sharing changes
with another run. The destination is checked to remain under the benchmark
root. `{{benchmarkRoot}}` and `{{workspace}}` placeholders are resolved by the
runner for external checks.

Visible fixture tests provide useful feedback to the agent. They are not the
only grade. The external oracle is the authoritative strict-suite gate and is
kept outside the workspace the agent edits.

## 7. Current Shelra-first task ladder

The checked-in suite is `shelra-agent-core` version `0.2.0` and contains eight
tasks:

| ID | Difficulty | Main harness capability |
| --- | --- | --- |
| 01-input-normalization | easy | deterministic implementation and basic verification |
| 02-config-pipeline | easy-medium | interpretation across defaults, normalization, and integration |
| 03-ttl-cache | medium | boundary conditions and injected time |
| 04-retry-policy | medium-hard | retry semantics, abort behavior, and error preservation |
| 05-state-migration | hard | repair, immutability, compatibility, and invalid input |
| 06-bounded-queue | hard | concurrency limits, ordered settlement, failures, and cancellation |
| 07-router-integration | very-hard | multi-file HTTP behavior, decoding, status codes, and API wiring |
| 08-workflow-orchestrator | expert | dependency validation, scheduling, retries, skips, event order, and cancellation |

This ladder is intentionally harder than a trivial smoke test. It moves from
small deterministic work to multi-step orchestration and exposes distinct
failure surfaces. It still does not claim to measure the future memory,
session-resume, or research suites.

## 8. Database schema

The shared database is currently at migration version 8. Benchmark tables are:

| Table | Purpose |
| --- | --- |
| `benchmark_runs` | Immutable run summary, provenance, progress, aggregate scores, usage, cost, status, and failure metadata. |
| `benchmark_task_results` | One task result per run, including copied task definition, timing, scores, usage, behavior, criteria JSON, final result, failures, and evidence references. |
| `benchmark_acceptance_results` | One normalized row per acceptance criterion. |
| `benchmark_events` | Append-only structured operational events ordered by run sequence. |
| `benchmark_artifacts` | References to evidence files and metadata. |
| `benchmark_baselines` | Explicit compatible baseline pointer; changing the pointer does not mutate the target run. |

Important `benchmark_runs` fields include:

~~~text
run_number, id, workspace_id, status
created_at, started_at, finished_at, heartbeat_at, finalized_at
benchmark_version, benchmark_suite
agent_name, agent_version, agent_config_json
leaderboard_eligible
model, model_provider, model_version
configuration_fingerprint
repository_commit, repository_dirty, repository_diff_hash
shelra_version, environment_json, benchmark_config_json, seed_text
task_count, completed_task_count, resolved_task_count, resolved_rate
overall_score, coding_score, agentic_score, intent_score
verification_score, research_score, memory_score, repair_score
efficiency_score, scores_json, confidence_json
input_tokens, output_tokens, cached_tokens, reasoning_tokens, total_tokens
cost_micros, cost_kind, cost_source, duration_ms
failure_reason, failure_type, process_id
~~~

The task table has separate duration fields for LLM, tools, verification, and
repair. It also stores the task definition, behavior JSON, acceptance JSON,
final result JSON, failure classification, evidence JSON, and objective run
directory.

Indexes support time/status history, agent/version/configuration filtering,
commit lookup, task status/category filtering, event order, and artifact lookup.
History queries are paginated; the UI does not load all task results at once.

## 9. Scoring and metric definitions

All scores are independent values from 0 to 100. A missing value is N/A, not
zero.

| Dimension | Definition |
| --- | --- |
| Overall | Explicit aggregate from the versioned score policy, or N/A if the policy cannot produce it. |
| Coding | Technical correctness: implementation, build, tests, typecheck, lint, and task checks actually recorded. |
| Agentic | Autonomous progression, exploration, tool use, multi-step completion, and task completion. |
| Intent | Criterion-level match between the human request and delivered behavior. |
| Verification | Coverage and quality of the agent's own verification attempts and evidence. |
| Research | Whether needed external knowledge was sought and applied correctly. |
| Memory | Retention through context compaction, restart, resume, model switch, or long tasks. |
| Repair | Detection, diagnosis, repair, and successful re-verification after failure. |
| Efficiency | Time, calls, tokens, tool work, and cost, without overriding correctness. |

The current provisional policy in the core suite is:

~~~text
coding       0.45
intent       0.35
verification 0.20
correctness floor: coding >= 70
~~~

This policy is explicit and versioned in the manifest. It is not a universal
truth. When the required dimensions are missing, overall is N/A. When coding
falls below the correctness floor, overall is 0 so efficiency cannot buy back
a failed implementation.

### Intent fidelity

Intent is calculated from acceptance criteria, not only task status:

~~~text
passed  = 1.0
partial = 0.5
failed  = 0.0
not_run = 0.0
intent = points / criterion_count * 100
~~~

This makes a task such as a responsive dashboard diagnostically useful:
responsive PASS, live clock PASS, full date FAIL, dark mode PASS means 3/4 and
75 percent intent fidelity.

### Verification distinction

Two facts are persisted separately:

1. The host benchmark oracle detected whether the implementation is correct.
2. The agent performed a successful verification action before completion.

In a strict benchmark-owned suite, missing agent self-verification gives the
verification score zero even if the host oracle passes. This directly measures
false completion risk.

### Missing telemetry

Token counts, cost, duration components, memory, research, and repair are
recorded only when the provider/runtime supplies real evidence. The UI labels
estimated cost as estimated, exact cost as exact, and unavailable values as
N/A. It never invents provider telemetry.

## 10. Behavior, events, and artifacts

Behavior counters can include:

~~~text
planCreated
researchPerformed
researchSources
delegatedAgents
llmCalls
toolCalls
commandsExecuted
filesRead
filesChanged
testsExecuted
verificationAttempts
failuresDetected
repairsAttempted
repairsSucceeded
selfVerification
humanInterventions
completionBlocked
~~~

Events are operational only:

~~~text
run_created, status_changed, task_started, task_finished
verification, repair, artifact, error, note
~~~

Events must not contain private chain-of-thought. They may describe that a
verification command ran, a repair started, or an error occurred.

Artifact references support logs, diffs, screenshots, test output, traces,
research sources, and other evidence. Paths, labels, hashes, byte counts, and
small metadata are indexed; large content remains in the journal/artifact
location.

All persisted JSON and event text pass through benchmark sanitization. API
keys, credentials, and other secrets must never be written to the database,
logs, artifacts, or public exports.

## 11. History, leaderboard, and comparison

### History

Run History is a first-class surface, not a log view. It shows:

~~~text
run number, agent, model, agent version
benchmark version, suite, commit
status, date, duration, cost, tokens
overall, resolved rate, eligibility
~~~

It includes failed and interrupted runs. Filters cover agent, agent version,
model/provider, benchmark version, suite, date, commit, and status. Search
matches run ID, run number, commit, version, and agent.

### Primary leaderboard

The primary leaderboard is Shelra-first. It ranks only runs that are:

- finalized with status `completed`;
- marked `leaderboard_eligible`;
- backed by a recorded overall score;
- compatible with the selected suite/version/configuration scope.

The default sort is overall descending. Primary columns are agent/model,
version, overall, intent, verification, cost, time, and run. Coding, agentic,
research, memory, repair, efficiency, resolved rate, and evidence are
available in wider views or detail pages.

Diagnostic smoke runs, invalid runs, and incomplete runs remain in history but
cannot become leaderboard entries or baselines.

### Latest, best, and baseline

These are separate concepts:

- **Latest**: newest compatible completed Shelra run.
- **Best**: maximum recorded overall score in the selected compatible scope.
- **Baseline**: explicit user-selected completed eligible run.

Setting a baseline does not overwrite it automatically on a new run. A
diagnostic or ineligible run cannot become a baseline.

### Comparison

Run comparison is allowed only when the comparison key is compatible:

~~~text
workspace + suite + benchmarkVersion + agent
agentVersion + model/provider/version
configurationFingerprint
~~~

The UI shows the reason when a direct delta is withheld. The matrix includes
each score, delta, cost delta, duration delta, and task changes:

~~~text
improved, regressed, unchanged
~~~

The task delta is based on recorded task outcomes; it does not infer causality.
Statements such as "verification improved because of commit X" require
additional task-level evidence and are labelled correlation otherwise.

### Regression and improvement detection

The UI marks numeric changes with both text and symbol:

~~~text
up +4.1
down -5.4
same 0.0
N/A
~~~

It can identify affected tasks and failure-type changes. Red/green is never the
only signal. Trend charts show one selected metric at a time and expose the
run number, version, commit, model, cost, and duration for each point.

## 12. UI information architecture

The TUI entry point is `/bench`, implemented as a full-screen OpenTUI modal
inside the existing Shelra workspace. It is not an HTTP route.

Current surfaces:

1. leaderboard;
2. run history;
3. historical trend;
4. run comparison;
5. run detail;
6. task explorer;
7. live/progress state when a persisted run is active.

The visual system reuses `src/ui/theme.ts` and the existing modal grammar.
Shelra Aurora is restrained: emerald/cyan/violet accents identify current or
active context, while tables and charts use solid semantic colors.

Dark and light themes preserve the same semantics. Scores always include their
number. Status includes text or a glyph. Improvements and regressions include
direction and delta. Charts have a textual point list or table equivalent.
Keyboard focus is visible, tables are navigable, and narrow terminals may
scroll horizontally rather than deleting important evidence.

The TUI reads SQLite snapshots. A future in-app runner can supply live events,
but a long-running benchmark currently starts from the CLI so cancellation and
ownership remain explicit.

## 13. CLI and execution

### Local HTML dashboard

The repository includes a browser landing page backed by the same SQLite
history:

~~~text
bun run bench:dashboard
open http://127.0.0.1:4173
~~~

The HTML file is not a standalone data viewer. Opening `bench/dashboard.html`
with `file://` cannot reach the local API and therefore shows the explicit
server-required empty state. The dashboard server resolves the repository root
so its workspace scope does not depend on the shell's current directory.

The local server exposes only sanitized dashboard data:

~~~text
GET /api/bench/dashboard
GET /api/bench/runs/:runId
GET /api/bench/compare?ids=<runId>,<runId>
~~~

It paginates the run registry, renders Shelra evolution, opens task detail,
and registers external agents without inventing scores. Set
SHELRA_BENCH_DASHBOARD_PORT to use another local port. The dashboard is a
local development surface; it is not a public sharing endpoint.

The supported command is:

~~~text
bun run src/index.ts bench \
  --manifest bench/suites/shelra-agent-core-v0.2.json \
  --model <fixed-model>
~~~

On POSIX hosts:

~~~text
./shelra-bench.sh \
  --manifest bench/suites/shelra-agent-core-v0.2.json \
  --model <fixed-model>
~~~

Supported options:

| Option | Purpose |
| --- | --- |
| `--manifest <path>` | Select a manifest; default is `.shelra/bench/manifest.json`. |
| `--suite <name>` | Override the suite label for this run. |
| `--agent <name>` | Select an agent adapter; default is `shelra`. |
| `--model <id>` | Fix the model for causal harness comparisons. |
| `--model-policy <policy>` | Select free/auto/economy/balanced/quality/max/custom routing. |
| `--api-key <key>` | Supply the provider key for this process; never persisted. |
| `--base-url <url>` | Override the OpenRouter-compatible endpoint. |
| `--max-cost <usd>` | Bound cumulative benchmark spend. |
| `--max-request-cost <usd>` | Bound one model request. |
| `--directory <dir>` | Run from a selected working directory. |
| `--json` | Emit newline-delimited machine-readable run events. |

`--model-policy free` can route across a changing set of free candidates. It is
useful for a smoke run but is not a controlled causal comparison. Use an exact
`--model` and preserve provider/model/version metadata when measuring a Shelra
change.

The shell file is a thin POSIX wrapper around the Bun CLI. On Windows, invoke
the equivalent Bun command from the repository root.

## 14. Reproducibility and versioning

The minimum reproducibility tuple is:

~~~text
benchmarkVersion + suite + task manifest/config
agent + agentVersion + model/provider/version
repositoryCommit + dirty state + diff hash
seed, when randomness exists
OS/runtime/tool environment
~~~

The run also stores timestamps, task count, sanitized agent configuration,
Shelra version, process ID, progress, and configuration fingerprint.

`repository_dirty = true` is not silently treated as a release. A dirty run
remains useful diagnostic evidence, but it must be labelled as non-clean when
interpreting reproducibility.

Benchmark versions are part of the comparison key. When task definitions,
oracle behavior, or scoring methodology changes materially, increment the
version and show an apples-to-apples warning for cross-version comparisons.

Future suites should be additive:

~~~text
shelra-coding-core
shelra-agentic
shelra-memory
shelra-verification
shelra-research
shelra-full
~~~

No suite should expose a score for a dimension it did not measure.

## 15. Current real-data validation snapshot

The following is a validation snapshot from 2026-09-14, not a fixture and not
a permanent claim about Shelra quality. It documents what the current runner
actually persisted in the local database.

### Local history at validation time

| Run | ID | Suite/version | Status | Eligible | Result |
| --- | --- | --- | --- | --- | --- |
| 1 | run_20260914095310_c25c9c54 | unconfigured | invalid | no | manifest was missing; no score |
| 2 | run_20260914121118_3c0fd752 | coding-core-smoke / real-smoke-0.1 | completed | no | 1/1, 100.0, diagnostic only |
| 3 | run_20260914143723_83bafb09 | shelra-agent-core / 0.2.0 | completed | yes | 3/8, overall 0.0 |
| 4 | run_20260914180339_5a417b2e | shelra-agent-core / 0.2.0 | interrupted | yes | 1/8 persisted before interruption; no final score |
| 5 | run_20260914180532_5ccd2263 | shelra-agent-core / 0.2.0 | completed | yes | unavailable fixed model; 0/8, overall 0.0 |
| 6 | run_20260914180625_947c44de | shelra-agent-core / 0.2.0 | completed | yes | 4/8, overall 80.0 |
| 7 | run_20260914195514_2dbe6b4e | shelra-agent-core / 0.2.0 | interrupted | yes | 2/8 persisted before interruption; no final score |

Run 1 is evidence that validation errors are persisted. Run 2 is evidence
that a trivial smoke result is not promoted to production ranking. Run 3 is
the first strict, multi-task, leaderboard-eligible development run.

Runs 4 and 7 prove that process interruption does not discard already
completed tasks. Run 5 proves that a fixed but unavailable provider model does
not silently fall back to another model. Run 6 is the current best completed
eligible run. The dashboard recovered run 7 after its owning process exited and
retained both completed task results.

### Run 3

~~~text
run number:       3
run id:           run_20260914143723_83bafb09
status:           completed
leaderboard:      eligible
suite/version:    shelra-agent-core / 0.2.0
agent/version:    shelra / 1.1.7
model policy:     free (candidate routing, not causal)
resolved:         3 / 8 (37.5 percent)
overall:          0.0
coding:           50.0
intent:           50.0
verification:     60.0
research/memory/repair/efficiency: N/A
cost:             $0.00 exact
duration:         41m 07.619s
commit:           af7e7bdecaf6efa40aa2fd0d93c33dcf7f9580b9
dirty:            true
~~~

The overall score is zero because the provisional policy applies the coding
correctness floor and the aggregate coding score is below 70. This is an
intentional correctness gate, not a missing-score display.

Task statuses were:

~~~text
01 PASS
02 PASS
03 FAIL
04 FAIL
05 FAIL
06 FAIL
07 PASS
08 FAIL
~~~

The earlier one-task smoke run (#2) recorded 100.0, but it is
`leaderboard_eligible = false` and is excluded from the primary leaderboard
and baseline selection. It remains visible in history as diagnostic evidence.
This is why a trivial 100 does not represent Shelra's production benchmark
performance.

### Run 6: current eligible result

~~~text
run number:       6
run id:           run_20260914180625_947c44de
status:           completed
leaderboard:      eligible
suite/version:    shelra-agent-core / 0.2.0
agent/version:    shelra / 1.1.7
model:            openrouter/qwen/qwen3-coder-30b-a3b-instruct
model control:    strict; no cross-model fallback
resolved:         4 / 8 (50.0 percent)
overall:          80.0
coding:           75.0
intent:           75.0
verification:     100.0
repair:           0.0
research/memory/efficiency: N/A
cost:             unavailable (provider did not report a complete run cost)
duration:         11m 32.767s
commit:           af7e7bdecaf6efa40aa2fd0d93c33dcf7f9580b9
dirty:            true
~~~

Task statuses were:

~~~text
01 PASS   input normalization
02 PASS   configuration pipeline
03 PASS   TTL cache
04 PASS   retry policy
05 FAIL   state migration (hidden preservation/removal case)
06 FAIL   bounded queue (concurrency exceeded)
07 FAIL   router integration
08 FAIL   workflow orchestrator (retry behavior)
~~~

The 80.0 overall is the score produced by policy version 1: coding 45 percent,
intent 35 percent, and verification 20 percent, after the 70-point correctness
floor opened. It must be read together with the 50 percent resolved rate. A
failed task can still receive partial coding/intent credit when one of its two
deterministic criteria passes. This is not a claim that Shelra solved 80 percent
of tasks.

The increase from run 3 to run 6 is evidence of a better observed result, but
it is not a causal harness-only comparison because the fixed model and
configuration differ. The UI correctly withholds a direct delta. A clean
causal comparison requires repeated runs with the same suite, benchmark
version, model, configuration fingerprint, and preferably clean commits.

The harness changes exercised by these runs are general runtime behavior, not
task-specific solutions:

- supplied acceptance contracts bypass redundant model interpretation and
  planning and produce one coherent implementation task;
- declared local verification commands run before the independent benchmark
  oracle, so agent self-verification remains distinct from external grading;
- an explicit benchmark model is strict and cannot silently switch providers
  or model IDs;
- explicit instructions not to edit tests protect test paths at the file
  application boundary;
- implementation and diagnosis calls use bounded 6,000-token outputs and a
  longer 120-second operational timeout for economical models;
- shared root/subcommand CLI options are merged, preventing `--model` and cost
  controls from being silently ignored.

## 16. Tests and validation

The repository test command excludes benchmark fixtures and `.shelra` runtime
data from the general Vitest collection, then runs the Bun-native suites that
need Bun SQLite/OpenTUI behavior.

The persistence tests prove:

- two or more executions create distinct IDs and run numbers;
- the first run remains after later runs;
- finalized run updates are rejected;
- task acceptance criteria persist independently;
- diagnostic runs cannot become baselines;
- invalid/failed/interrupted states remain queryable;
- comparison deltas and task changes are calculated from stored data.

The runner tests prove:

- the row exists before execution setup;
- progress and task results are persisted after each task;
- strict oracle validation rejects incomplete manifests;
- interrupted and failed execution finalizes with the correct state.

The UI tests cover persisted empty states, history, detail, comparison, and
eligibility presentation.

Recommended validation commands:

~~~text
bun run test
bun run typecheck
bun run lint
SHELRA_BUILD_SKIP_INSTALL=1 bun run build
git diff --check
~~~

For a real end-to-end run:

~~~text
bun run src/index.ts bench \
  --manifest bench/suites/shelra-agent-core-v0.2.json \
  --model <fixed-model>
~~~

Run the command twice, inspect `benchmark_runs`, restart Shelra, and confirm
both run IDs remain available in history and detail views. Use
`--model-policy free` only when variable free routing is acceptable.

## 17. Contributor rules

When adding a task:

1. Make the task harder in a measurable way; do not add a toy smoke task to
   inflate the score.
2. Add an immutable template under `bench/fixtures/`.
3. Add visible tests for useful agent feedback.
4. Add a benchmark-owned oracle under `bench/oracles/`.
5. Keep oracle code outside the workspace copied to the agent.
6. Define every acceptance criterion and its deterministic check.
7. State which dimensions are actually measured.
8. Update the benchmark version when methodology or task semantics change.
9. Add persistence and comparison coverage where the schema changes.
10. Run the real suite and record whether it is clean, dirty, exact, estimated,
    or unavailable.

When changing scoring, update the policy version and explain the impact. Never
rewrite old scores in place.

When adding provider or agent telemetry, preserve the distinction between
observed, estimated, and unavailable values. Never turn a missing metric into a
zero.

## 18. Known limitations and roadmap

Current limitations:

- The core ladder is a serious local development suite, not a public
  certification benchmark.
- Research, memory, session resume, and multi-run statistics are not yet
  measured by the core suite.
- Live in-TUI execution is not yet brokered; the CLI runner is the reliable
  long-running entry point.
- Provider-native reasoning tokens and richer verification evidence depend on
  provider/runtime telemetry.
- A dirty repository is recorded but does not yet persist a full patch bundle
  automatically.
- Public sharing and export security still require a dedicated review.

Next architecture steps:

- add dedicated multi-turn memory and resume protocols;
- add research tasks with source-quality and application checks;
- add controlled repeated runs and report median/variance only when sample
  counts justify them;
- add explicit release benchmark labels and JSON/CSV export;
- add a live execution broker with cancellation and ownership semantics;
- add richer artifact retention and redaction policies.

## References in this repository

- [Architecture and data contract](./shelra-bench-architecture.md)
- [UI design specification](./shelra-bench-ui.md)
- [Task ladder README](../../bench/README.md)
- [Benchmark types](../../src/bench/types.ts)
- [Benchmark runner](../../src/bench/runner.ts)
- [Benchmark storage](../../src/storage/benchmarks.ts)
- [Database migrations](../../src/storage/migrations.ts)
