# Shelra Bench — architecture and data contract

Shelra Bench turns each benchmark invocation into durable, inspectable evidence.
It is primarily a development instrument for improving the Shelra agent
harness: a task is only useful when the requested change, the resulting
software, and the verification evidence can be related after the process exits.
Other agents can be imported later for calibration, but they are not the
default subject or the source of a model popularity contest.

For the consolidated operational reference, including the current real-data
validation snapshot, see [shelra-bench-reference.md](./shelra-bench-reference.md).

## Research decisions

- OpenRouter's benchmark surface keeps model/provider identity next to accuracy,
  standard deviation, cost, time, and output tokens, and explains the task
  grader and aggregation method. Shelra therefore records these as separate
  provenance fields instead of one opaque score. See
  <https://openrouter.ai/benchmarks/tau2-bench-airline>.
- SWE-bench makes suite choice, task count, resolved rate, and comparable
  execution conditions visible. Shelra treats `benchmarkVersion` and `suite`
  as part of the comparison key. See <https://www.swebench.com/>.
- Terminal-Bench separates `MODEL` from `AGENT`, publishes cost/tokens, and
  signals confidence intervals. Shelra follows the same distinction but only
  displays confidence when the runner actually records repeated-run evidence.
  See <https://www.tbench.ai/>.
- SWE-Bench Pro documents reproducible environments, task construction, and
  fail-to-pass/pass-to-pass verification; its public methodology also shows why
  task quality and underspecification must remain visible in benchmark records.
  See <https://labs.scale.com/leaderboard/swe_bench_pro_public>.

These references inform the information architecture; Shelra Bench does not
copy their leaderboard presentation or claim their scores.

## Existing Shelra boundaries

Shelra already owns one SQLite database at `~/.shelra/shelra.db`, migrated by
`src/storage/migrations.ts`. The autonomy runtime already owns a durable,
append-only execution journal under `.shelra/objectives/<objective-id>` and
stores bulky command/browser evidence as files. Shelra Bench reuses both:

- SQLite is the cross-run index used by history, leaderboard, filters, and
  comparison.
- The autonomy journal remains the detailed per-task source of truth. SQL rows
  reference its artifacts and retain the structured summary needed for fast
  inspection; they do not copy private model reasoning or large logs.
- No second database and no in-memory-only result path are introduced.

## Run lifecycle

`createBenchmarkRun()` is the first operation performed by the runner. It
allocates a fresh UUID and an auto-incremented human run number, then writes a
`queued` row and a `run_created` event. Manifest, provider, or environment
errors are finalized as `invalid` or `failed` after that row exists.

During execution, progress and task results are persisted after every task:

```text
queued → preparing → running → verifying → completed
                                      ├── failed
                                      ├── cancelled
                                      ├── interrupted
                                      └── invalid
```

Terminal result rows cannot be updated through the store. An interrupted
process may leave an active row; the next Bench command can mark it
`interrupted` when its recorded process is no longer alive. The MVP does not
resume an interrupted run: a fresh invocation always receives a new run ID so
the historical record stays immutable and the execution conditions are not
silently mixed.

## Persistence schema

The shared database schema (current migration 8) adds these tables:

| Table | Responsibility |
| --- | --- |
| `benchmark_runs` | One immutable run summary, metadata, progress, resolved-task rate, aggregate scores, usage, failure classification, and status. The `run_number` is monotonic; `id` is a UUID-style stable identifier. |
| `benchmark_task_results` | One task attempt per run, including the persisted task definition/prompt and benchmark-owned acceptance contract, status, scores, durations, usage, behavior counters, failure reason/type, final result, and the journal directory. |
| `benchmark_acceptance_results` | One row per task acceptance criterion. Pass/fail/partial is never collapsed to a task-only boolean. |
| `benchmark_events` | Append-only operational events with per-run sequence numbers. It contains phases, task boundaries, verification, repair, and errors, never private chain-of-thought. |
| `benchmark_artifacts` | Lightweight references to logs, diffs, screenshots, test output, and research sources; large content stays outside the main tables. |
| `benchmark_baselines` | A replaceable pointer to a selected completed run. Changing a baseline does not mutate the run it points to. |

Run metadata records agent, model/provider, Shelra and benchmark versions,
repository commit/dirty state/diff hash, environment profile, sanitized
configuration, task count, seed, and timestamps. Secrets are removed before
JSON is persisted; API keys are never part of a benchmark record.
The configuration fingerprint covers the benchmark/agent configuration and
model identity; it is part of the compatibility check for score deltas.

Indexes cover workspace/time, status, agent, suite/version, commit, task
status/category, and event order. History queries are paginated. The UI never
loads the complete database into the renderer.

## Scoring contract

Dimension scores are independent optional values in the range 0–100:

`overall`, `coding`, `agentic`, `intent`, `verification`, `research`,
`memory`, `repair`, and `efficiency`.

The default Shelra objective adapter can derive only evidence it actually has:
technical resolution from the external acceptance gate, intent fidelity from
the benchmark-owned (or runtime-derived, when no oracle is supplied) criterion results, verification coverage from checked criteria,
and repair success from recorded repair attempts. Agentic quality, self-
verification as a distinct signal, research quality, memory, and other
dimensions remain `N/A` until an evaluator records them.
It never guesses token counts, cost, or causality.

There is no hidden default weighting. A task manifest may include a versioned
`scorePolicy` with explicit weights; `calculateOverallScore` returns `N/A`
when the policy is absent or required dimensions are missing. Correctness can
therefore not be bought back with token savings. The UI ranks only completed
runs with a recorded overall score and shows the policy/version alongside the
result.

Confidence intervals are optional metadata. Shelra does not call one run a
mean, median, variance, or confidence interval without repeated observations.

## UI information architecture

`/bench` opens a full-screen OpenTUI modal using the existing theme and modal
grammar. It has read-first views for leaderboard, history, trend, comparison,
tasks, live progress, and a detail view. Empty states are honest and tell the
user how to collect a real run; production code has no benchmark fixtures.

- Leaderboard primary columns are agent/model, version, overall, intent,
  verification, cost, time, and run. Secondary dimensions are available in
  wider terminals and detail views.
- History includes failed and interrupted runs, not just winners.
- Trends use real Shelra runs only and mark missing metrics as unavailable.
- Comparisons refuse silent cross-version/suite deltas and show the
  incompatibility reason.
- Task detail exposes the original request, criteria, outcomes, behavior
  counters, usage, timing, evidence references, and structured operational
  events. It never displays private chain-of-thought.
- Dark/light roles, glyphs, focus, and reduced-motion behavior reuse
  `src/ui/theme.ts`. Shelra draws no gradients, glows or fades; every colour is
  flat, and the single accent (`#00FF88` in dark) marks active/current state.

## CLI and manifest

The first runner entry point is:

```text
./shelra-bench.sh
bun run src/index.ts bench --manifest .shelra/bench/manifest.json
```

The manifest is intentionally opt-in; this repository does not ship fake task
entries. It contains a benchmark version, suite, task definitions (including
optional benchmark-owned `acceptanceCriteria`), and an optional explicit score
policy. `--agent`, `--suite`, `--model`, `--manifest`, and `--json` are the
supported MVP controls. The Shelra adapter executes each manifest task through
the existing autonomous runtime and persists progress incrementally. Other
coding agents can implement the same executor contract without changing the
storage or UI.

## Reproducibility and comparison

The minimum reproducibility tuple is:

```text
benchmark version + suite + task manifest/config
agent + agent version + model/provider/version
repository commit + dirty state/diff hash
seed (when present) + environment/runtime profile
```

Runs with a different configuration fingerprint are not treated as a direct
before/after comparison, even when their benchmark version and model match.

The default analysis scope is Shelra. Latest and best are separate: latest is
the newest compatible completed Shelra run; best is the maximum recorded
overall score. A baseline is explicit and is not automatically overwritten;
the UI only resolves it for the same model/provider scope so a model switch
cannot silently become a harness baseline.
The model filter is essential: it lets us ask whether Shelra improved because
the harness changed or because the model changed. Other agents are an
explicit secondary scope and only appear when real runs for those agents exist.
Any causal explanation in the UI is labelled as a correlation unless
task-level evidence supports it.

Failure classification is explicit and evidence-led. Supported task/run types
are `intent_failure`, `context_failure`, `memory_failure`, `planning_failure`,
`research_failure`, `tool_failure`, `implementation_failure`,
`verification_failure`, `repair_failure`, `timeout`, `environment`, and
`model_failure`. The adapter currently classifies an observed unmet
benchmark acceptance criterion as `intent_failure`, a missing verification
result as `verification_failure`, and interrupted active tasks as `timeout`;
unknown causes remain `N/A` rather than being guessed.

## Current limitations

- The repository now ships a strict local development ladder under `bench/`, but
  it is not yet a public/certified benchmark release. Running the CLI without a
  manifest still creates a visible `invalid` run rather than fabricating results.
- The interactive TUI can inspect, compare, and set a baseline; launching a
  long-running benchmark from inside the chat is left to the CLI runner until a
  cancellation/live-execution broker is defined.
- The current strict adapter records self-verification only when the objective
  has a successful command, browser observation, or HTTP probe action. Richer
  provider-native evidence and multi-turn memory protocols remain future work.

## Development task ladder

The checked-in `bench/suites/shelra-agent-core-v0.2.json` is a Shelra-first
development suite. It moves from a deterministic input normalizer through
configuration integration, TTL caching, retry policy, state migration, bounded
concurrency, HTTP routing, and an expert workflow orchestrator. The sequence
measures the harness across increasing reasoning horizon and failure surface; it
is not a leaderboard of model capability.

Strict suites set `oracleMode` to `benchmark-owned`. Each task then binds
deterministic `CheckSpec` checks supplied by the benchmark. The autonomous runtime
may still derive a specification for planning, but its generated criteria are
never used as the oracle. `command_succeeds` supports `{{benchmarkRoot}}` and
`{{workspace}}` placeholders and passes the target workspace to an external
evaluator. This keeps oracle code outside the files the agent can change.

Tasks may declare `workspaceTemplate`. The runner copies that immutable template
to `.shelra/bench/runs/<runId>/tasks/<taskId>/` before execution. A repeated run
therefore receives a fresh fixture, while the copied workspace and objective
journal remain available as evidence after completion.

The suite's visible tests are feedback for the agent, not the sole grade. The
external oracle is the authoritative correctness check. A strict task's
verification score is also zero when the agent has no successful
self-verification action; the host's final oracle check is recorded separately
and cannot be mistaken for agent verification.
