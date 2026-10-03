# Public benchmark: SWE-bench Pro, harness against harness

This folder measures ShelraCode on a public benchmark the way an outside reader can check: the same free OpenRouter
model runs inside two harnesses, ShelraCode and mini-swe-agent (the reference harness Scale ships for SWE-bench Pro),
on the same tasks with the same limits. The difference in resolved rate is the harness's contribution; everything
else is held fixed. One free-model run is one sample: report intervals, not single numbers.

Nothing here has produced a result yet. The first run is the 20-task pilot.

## What runs

- **Tasks:** SWE-bench Pro's public set as Scale republished it for Harbor: 642 validated tasks under `v2/tasks/` of
  [scaleapi/SWE-bench_Pro-os](https://github.com/scaleapi/SWE-bench_Pro-os), pinned at commit
  `66f92766bba642462d4bbe5479e83f91f9211862`. Scale reports that the reference patch resolves 642 of 642 and an
  empty patch none. Each task is a Harbor task directory: the PR description (`instruction.md`), a prebuilt image
  `ghcr.io/scaleapi/swe-bench_pro-v2:<instance_id>` with the repository at `/app`, and a verifier
  (`tests/test.sh`) that writes reward 1 or 0. Harbor's own registry also lists `swebenchpro@1.0` (731 tasks, the
  original release); v2 is preferred because its tasks were re-validated and it ships the protocol below.
- **Runner:** [Harbor](https://github.com/harbor-framework/harbor) 0.23.0 with its local Docker environment, on a
  GitHub-hosted `ubuntu-latest` runner (this repository's Windows machine has no Docker).
- **Protocol:** Scale's locked protocol for v2: during the agent phase the sandbox has no network except the model
  endpoint (`--allow-agent-host openrouter.ai`); setup and verification keep normal access. The agent's diff is saved
  as `model.patch`; the unchanged verifier then runs in the same container.
- **Harnesses:**
  - `shelra`: `harbor/shelra_agent.py`, an installed agent. It uploads `shelra-linux-x64` (SHA-256 checked) into
    the task container: by default the dispatched commit built with the release's recipe (`scripts/build.ts`), so
    a change is measured before it ships; with `shelra_build=release`, the published `shelra@1.1.9`. The arm's
    results artifact names the build, so two builds are never resumed into one arm. It runs
    `shelra -p <instruction> --format json --model <model> --model-policy free --max-cost 0 --max-tool-rounds 50
    --no-sandbox` in the repository through `harbor/shelra_runner.sh`, which enforces the limits.
  - `mini-swe-agent`: Scale's `v2/tooling/locked_mini_swe.py` (Harbor's built-in mini-swe-agent plus patch capture,
    an in-sandbox timeout and fixes for old images), mini-swe-agent 2.4.6, with Scale's tool-calling config
    `v2/tooling/configs/mini_toolcall.yaml` and this benchmark's limits written over it.
- **Models:** `nvidia/nemotron-3-ultra-550b-a55b:free` first, `qwen/qwen3.8-27b:free` second. Free models only; never
  `openai/*` or `anthropic/*` through OpenRouter (the driver and the workflow refuse them).

## Same limits for both harnesses

| Limit | Value | Shelra | mini-swe-agent |
| --- | --- | --- | --- |
| Model | one free OpenRouter id | `--model`; `SHELRA_FALLBACK_MODELS` names the same id, so no other model is tried | `-m openrouter/<id>` |
| Model steps per task | 50 (SWE-bench Pro paper's main setting) | runner stops the process at the 50th `step_finish` event | `agent.step_limit: 50` |
| Agent wall time | 2910 s, then a hard stop at 2940 s | runner sends SIGTERM at 2910 s, SIGKILL 30 s later | `agent.wall_time_limit_seconds: 2910`; Scale's `timeout -k 30 2940` |
| Harbor agent timeout | 3000 s (`task.toml`) | same | same |
| Web access in the agent phase | none | `SHELRA_RESEARCH=off`; the sandbox blocks other hosts | the sandbox blocks other hosts |
| Cost | $0 | `--model-policy free --max-cost 0` | `cost_limit: 0` |
| Instruction | the task's `instruction.md`, unchanged | passed as the prompt | wrapped in mini-swe-agent's template (part of that harness) |

A step is one model call. Shelra's top-level steps include its completion-gate and repair rounds; calls Shelra makes
outside the top-level stream (sub-agents, the end-of-turn memory reflection) are not stopped by the cap but are
counted by the request metric below. A run that hits a limit keeps its work on disk: the verifier tests whatever the
working tree holds, for both harnesses.

Shelra runs the checks a project states on its final code. The runner sets `SHELRA_CHECK_TIMEOUT_MS=240000`, so a
whole-repository suite that runs longer than four minutes on the task's one CPU is run again on the packages or tests
the change touched instead of using up the 50 minutes; a check whose tool the image lacks is reported and not sent
back. This is part of the harness under test, set the same for every task.

## Task subsets

`make_subsets.py` builds both files from the pinned Scale checkout and `--check` verifies the committed files:

1. Historical difficulty: Scale published per-task resolved flags for nine reference runs
   (`traj/*/eval_results.json`: Claude Sonnet 4.5, Claude Sonnet 4 twice, Claude Opus 4.1, Gemini 2.5 Pro, GPT-4o,
   GPT-5 with 250 turns, gpt-oss, Kimi K2). A task's pass rate is the share of runs that list it and resolved it.
2. Pool: the 250 tasks with a pass rate in [0.25, 0.75] and at least six runs ("moderate": solved by some systems,
   not by all; 244 v2 tasks were solved by none).
3. Order: tasks ranked by `sha256("shelra-swebench-pro-2026-10-03:" + instance_id)`.
4. `swebench-pro-headline50.txt`: 50 slots split across repositories in proportion to the pool (largest remainder),
   lowest-ranked tasks of each repository. `swebench-pro-pilot20.txt`: 20 slots split the same way over the
   headline set, so the pilot is a subset of the headline. `swebench-pro-subsets.json` lists each task's repository
   and historical pass count.

Ten repositories are represented (Python, Go, JavaScript, TypeScript); tutanota has one pool task and no slot.

## Running it

GitHub Actions, workflow **Public benchmark** (`.github/workflows/public-bench.yml`), manual dispatch only, with the
repository secret `OPENROUTER_API_KEY`. That secret is a key made for this benchmark alone, never the owner's own:
create it in OpenRouter's key settings with a credit limit of $1 (free models cost nothing, and a key at its limit is
refused, so a leaked key can spend at most that), store it under Settings → Secrets and variables → Actions, and delete
the key when the runs are over. The workflow refuses to run with a key that has no credit limit or more than $5 left.
The free-model daily quota belongs to the account, so the benchmark's requests count against the owner's 1,000 a day.
One dispatch runs one arm. For the pilot on the first model:

| Run | agent | model | subset | offset | limit | resume_run_id |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `shelra` | `nvidia/nemotron-3-ultra-550b-a55b:free` | `pilot20` | `0` | `0` | (empty) |
| 2 | `mini-swe-agent` | same | `pilot20` | `0` | `0` | (empty) |
| next | same as the run it continues | | | | | id of that run |

Or from the command line: `gh workflow run public-bench.yml -f agent=shelra -f
model=nvidia/nemotron-3-ultra-550b-a55b:free -f subset=pilot20`. GitHub offers a manual workflow only once it is on
the default branch; `--ref <branch>` then runs it, and builds Shelra, from that branch. Resume a Shelra arm on the
same commit it started on.

A dispatch stops starting tasks when the daily free quota is nearly spent, when a task ran into the daily limit, or
70 minutes before its 320-minute budget (GitHub ends a hosted job at 6 hours). Dispatch the same arm again with
`resume_run_id` set to the stopped run's id: it downloads that run's results, skips every task with a final outcome
and runs the rest. Runs queue one at a time (`concurrency: public-bench`); GitHub keeps only the newest pending
dispatch in a queue, so dispatch the next run after the current one has started.

Locally on a Linux machine with Docker (Python 3.12+):

```bash
pip install harbor==0.23.0
git clone https://github.com/scaleapi/SWE-bench_Pro-os scale && git -C scale checkout 66f92766bba642462d4bbe5479e83f91f9211862
export OPENROUTER_API_KEY=...   # never commit or print it
python bench/public/run_subset.py run --agent shelra --model nvidia/nemotron-3-ultra-550b-a55b:free \
  --subset pilot20 --scale-repo scale --shelra-binary ./shelra-linux-x64 --docker-prune
python bench/public/run_subset.py run --agent mini-swe-agent --model nvidia/nemotron-3-ultra-550b-a55b:free \
  --subset pilot20 --scale-repo scale --docker-prune
python bench/public/collect.py --results bench-results --subset pilot20 --out bench-report
```

`run_subset.py run --dry-run` prints the `harbor run` commands without running anything.

## Free quota

OpenRouter's free models allow 20 requests per minute and, with at least 10 credits purchased, 1000 requests per day,
shared by everything that uses the account. Runs are therefore sequential, and:

- before each task the driver reads `GET /api/v1/key` (not a model request) and stops when fewer than 60 free
  requests are left today (`--min-quota`); the remaining tasks stay `pending`;
- a task that did not resolve and whose logs show OpenRouter's `free-models-per-day` 429 (or Shelra's `limit` event)
  is recorded `quota_lost`, not as a failure, and runs again from scratch next time;
- the per-task difference in the key's `free_model_daily_requests.used` counter is recorded as the task's request
  count. It covers every request the account made meanwhile, so do not use the same account elsewhere during a run.

## Outcomes and reporting

Per task (`bench-results/<agent>/<model>/tasks/<instance_id>.json`): `resolved` (reward 1), `unresolved`,
`setup_failed` (the harness could not be installed on that image twice: counted as unresolved for that harness),
`error` (the environment or verifier failed twice: excluded, listed), and the non-final `pending`, `quota_lost`,
`infra_error`, `setup_error`.

`collect.py` merges any number of results folders and writes `summary.json` and `summary.md`:

- **Resolved rate** per arm over final outcomes, with a 95% bootstrap interval (10,000 resamples over tasks).
- **Paired comparison** on tasks with a final outcome in both arms: difference in resolved rate with a 95% paired
  bootstrap interval, the tasks only one harness solved, and an exact McNemar p-value. With 20 tasks the interval
  will be wide; the pilot checks the pipeline and gives a first estimate, the headline 50 is the reported number.
- **False completions:** tasks the harness reported as done whose evaluation failed. Shelra, strict: the host's
  `[Checked by Shelra …]` verdict; broad: that, or a turn that ended normally without a verdict line
  (`[Not verified …]`, `[Not marked complete …]`, a stop at a limit are not claims). mini-swe-agent's analog: exit
  status `Submitted`.
- **Cost of a solve:** OpenRouter requests, harness steps and tokens (input + output) per solved task.
- Shelra tasks where any step was served by a model other than the one under test are flagged
  (`model_contaminated`); there should be none.

Each workflow run uploads `public-bench-<agent>-<model>-<subset>-results` (per-task JSON, the report; kept 90 days)
and `-logs` (Harbor trial folders with trajectories, Shelra's JSONL stream and session trace, `model.patch`; 30
days). Secrets are scrubbed from both before upload: a model can read its own environment with a shell command.

## Expected cost of the pilot

Per arm, 20 tasks: at most 50 model steps each, so up to about 1000 requests for mini-swe-agent and somewhat more
for Shelra (reflection and sub-agent calls), plus retries after per-minute 429s. That is up to one day of the free
quota per arm; the two arms of the pilot take two to three days of quota if every task uses its full budget, less
when tasks finish early. Wall time per task: pulling the image (the pilot's 20 images total 32 GB compressed, 0.7
to 5.7 GB each; protonmail/webclients is the largest) and setup, up to 49 minutes of agent time, then the verifier:
roughly 20 to 60 minutes, so 7 to 20 hours per arm, two to four dispatches. The daily quota, not the runner, sets
the pace.

## Not verified yet

No part of this has run end to end: the Windows machine that wrote it has no Docker. Checked locally: Python syntax,
`actionlint` on the workflow, the runner's step, time and exit handling with a fake binary, Harbor 0.23.0 resolving
the job configuration (`--print-config`; `--dry-run` needs Docker), both agents' install and run commands against a
fake environment, the driver's stop-on-quota, resume, retry and secret scrubbing with a fake `harbor`, the subset
files against Scale's task list, Scale's dataset export and the Hugging Face dataset, and the collector on fabricated
results. Open risks: whether the Bun-compiled binary (glibc 2.17 or newer) starts on every task image (the setup
phase fails loudly if not, and the task counts as unresolved for Shelra), disk space for the largest images, and
Harbor's network allowlist on the runner's kernel. The workflow can be dispatched only once it is on the default
branch.

## Files

- `harbor/shelra_agent.py`, `harbor/shelra_runner.sh`: the Shelra installed agent and its in-container runner.
- `run_subset.py`: sequential, resumable driver for one arm; `redact` scrubs secrets.
- `collect.py`: merge and compare.
- `make_subsets.py`, `swebench-pro-pilot20.txt`, `swebench-pro-headline50.txt`, `swebench-pro-subsets.json`.
