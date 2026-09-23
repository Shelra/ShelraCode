# Benchmark history

`benchmark-history.json` is the versioned record of every Shelra Bench run and field case: which agent
(Shelra, with any subsystems switched off; or a reference agent such as Claude Code or Codex), which
model, which harness commit, and how every task ended. It exists so growth and regressions can be
shown with evidence and compared across agents and months, not remembered.

The run database itself (`~/.shelra/shelra.db`) stays on the machine that ran the benchmark; this file
is what gets committed.

## Update it

```bash
bun run scripts/bench-history.ts import                      # the default database, ~/.shelra/shelra.db
bun run scripts/bench-history.ts import --db <path> --source <label>
bun run scripts/bench-history.ts summary                     # one line per run
```

Runs are merged by id: a run already in the file is replaced by its newer copy and nothing is ever
dropped. Field cases are re-read from `bench/field/cases/` on every import.

The website's "Benchmark" section is derived from this file: after an import, run
`bun run bench:sync` in `frontend/` and commit `frontend/src/lib/bench-summary.json` with it.

## What a run records

`agent.name` and `agent.config` (the harness, the model policy, and `ablation` when subsystems were
switched off), `model`, `harnessCommit` and `harnessDirty`, run status, task counts, scores, tokens
and cost, and one entry per task with its status, duration, behavior counters (steps, tool calls,
checks run, whether completion was blocked), the oracle's verdict per criterion, and the failure
reason.

Runs #1-#32 record commits from before the history rewrite of 2026-09-22 (`af7e7bd`, `572c0e0`); those
commits are not in the public history.

## Privacy

The repository is public. The import removes the home folder, the user name and the machine name from
every text and reduces graded workspace paths to their last folder. Check a new import with a search for
your user name before committing it.
