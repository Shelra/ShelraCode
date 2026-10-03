# Evidence for doc 20 (long-horizon audit, 2026-10-02)

| File | What it is |
| --- | --- |
| `forensic-state.md` | Round 1: every store that crosses a session boundary, who writes it, who reads it, and what a fresh session receives (commit `45f87d1`). |
| `research-long-horizon.md` | External research, about 90 sources tagged EST / EST\* / EXP / MKT / UNVERIFIED, with 15 principles, a "premature" list and 13 long-horizon evaluation designs. |
| `../../../bench/long-horizon/` | The evaluations built for the audit (see below); results under `results/`. |

## Reproduce

From the repository root. Layer 1 and the probes spend no model quota and give the same numbers on every run.

```sh
bun run bench/long-horizon/year-in-a-box.ts                         # results/full.json
bun run bench/long-horizon/year-in-a-box.ts --ablate memory         # results/ablate-memory.json
bun run bench/long-horizon/year-in-a-box.ts --ablate ledger         # results/ablate-ledger.json
bun run bench/long-horizon/year-in-a-box.ts --variant tests-allowed # results/tests-allowed.json
bun run bench/long-horizon/year-in-a-box.ts --variant resume        # results/resume.json
bun run bench/long-horizon/probes.ts                                # results/probes.json (P1, P3-P11)
```

Real-model turns (free OpenRouter quota; one at a time; the key is read from `~/.shelra/auth.json` and never
printed; HOME is a scratch copy of the state):

```sh
bun run bench/long-horizon/year-in-a-box.ts --stop-after 11         # prints the kept scratch folder
bun run bench/long-horizon/real-run.ts --state <folder> --model nvidia/nemotron-3-ultra-550b-a55b:free \
  --label recon-ultra-full-dated --date 2026-12-15T12:00:00Z --prompt-file bench/long-horizon/prompts/reconstruct.txt
```

The cold start used a fresh `git clone` of this repository at `45f87d1` (no `node_modules`, no `.shelra/`) as
`--state <folder> --workspace shelra`.

## Real-use statistics (owner's machine, read-only)

From `~/.shelra/shelra.db` on 2026-10-02 (the audit's `db-usage.ts`, not committed: it names local folders):

- 330 sessions from 2026-09-06 to 2026-09-26 in 60 workspaces. User turns per session: 0 in 138, 1 in 138, 2-3 in
  42, 4-10 in 11, more than 10 in 1. No session was updated more than 24 hours after it was created.
- The longest-lived workspace is this repository: 146 sessions over 12.9 days. Its project memory holds 2 entries,
  both written by tests on 2026-09-17.
- 1 compaction in all sessions; `objective_tasks` 0 rows; `checkpoints` 778 rows (no reader); `objectives` 248 rows.
- Tool calls: bash 1,513, read_file 807, edit_file 388, write_file 326, update_plan_step 219, generate_plan 135,
  memory_list 11, memory_read 8, memory_write 2.

## Real-model runs

Nine turns, all on free models, graded by hand against `bench/long-horizon/prompts/reconstruct-key.md` (the
reconstruction runs) or described from the transcript. Totals: 246 tool calls, 34 recorded model calls (rounds,
reflections, recaps; each round has several steps, about 280 OpenRouter requests in all), 3.44 M input and 53 K
output tokens.

| Label | Model | Arm | State / date | Seconds | Tools | Result |
| --- | --- | --- | --- | --- | --- | --- |
| recon-ultra-full | Nemotron 3 Ultra | full | after E11 / real date | 92 | 18 | 8-8.5 / 12 |
| recon-ultra-full-dated | Nemotron 3 Ultra | full | after E11 / 2026-12-15 | 80 | 16 | 8-8.5 / 12 |
| recon-ultra-bare | Nemotron 3 Ultra | bare | after E11 / 2026-12-15 | 50 | 28 | 11.5 / 12 |
| recon-qwen-full | Qwen 3.8 27B | full | after E11 / 2026-12-15 | 68 | 17 | 10.5 / 12 |
| recon-qwen-bare | Qwen 3.8 27B | bare | after E11 / 2026-12-15 | 59 | 30 | 12 / 12 |
| conflict-ultra-full | Nemotron 3 Ultra | full | after E11 / 2026-12-15 | 48 | 8 | conflict with "nothing leaves the machine" not raised; asked three design questions, offered a no-dependency option |
| conflict-ultra-bare | Nemotron 3 Ultra | bare | after E11 / 2026-12-15 | 181 | 32 | conflict not raised; added `googleapis`, built the upload, assumed JSON storage from the stale README |
| continue-ultra-full | Nemotron 3 Ultra | full | after E8 (crash) / 2026-10-20 | 235 | 48 | found the interrupted refactor in the raw episode log, finished it, tests green; kept re-export shims after test protection made it restore a test edit |
| cold-start-ultra-full | Nemotron 3 Ultra | full | clone of this repo / real date | 804 | 49 | about 2 / 6 (objective, architecture and remaining work taken from history docs 00 and 10); the host's check repair turned the read-only request into edits of `tsconfig.json` and `package.json` |

A second reviewer re-graded the reconstruction runs independently: 8, 8, 11.5, 10.5, 12 (Round 3 review).
