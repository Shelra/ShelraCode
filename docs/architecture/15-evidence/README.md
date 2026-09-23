# Evidence for the 2026-09-23 intelligence audit

Everything needed to check or repeat the measurements in
[`15-INTELLIGENCE-AUDIT-AND-ROADMAP.md`](../15-INTELLIGENCE-AUDIT-AND-ROADMAP.md).

| Path | What it is |
| --- | --- |
| `probes/ctx-probe.ts` | What the context compiler selects on this repository (§4 stage 2) |
| `probes/verif-probe.ts` | Which shell commands the completion gate counts as verification (§10) |
| `probes/reach.ts` | Import-graph reachability from `src/index.ts`: runtime, type-only, dead (§3) |
| `probes/sessions-by-cwd.ts` | Tool usage and gate activity from the local session database (§7-§10) |
| `probes/reflections.ts` | Composition of `.shelra/memory/reflections.jsonl` (§7) |
| `audit-worktree.patch` | Ablation switches, the Claude Code and Codex reference adapters, and the probe tests, against `7b433b0` |
| `frontier-practices.md` | The research stream's notes and sources (§14) |
| `results.md` | The experiment tables of §6, generated from the run logs |

Run the probes from the repository root: `bun run docs/architecture/15-evidence/probes/<name>.ts`.
`sessions-by-cwd.ts` reads `~/.shelra/shelra.db` read-only.

## Repeating the experiment

1. Create a throwaway worktree and apply the patch:

   ```bash
   git worktree add --detach ../shelra-audit-wt 7b433b0
   cd ../shelra-audit-wt
   git apply ../shelra/docs/architecture/15-evidence/audit-worktree.patch
   bun install --frozen-lockfile
   bunx vitest run --pool=forks src/agent/audit-probes.test.ts src/agent/audit-ablation.test.ts
   ```

2. Make a clean benchmark root outside any git repository, with its own home folder, and copy the
   suites, fixtures and oracles into it (`bench/`). Add the silent suite: the core manifest with
   "Run bun test before completing." removed from every prompt.

3. Run one configuration at a time (two benchmark processes lock the same SQLite database). With
   `ROOT` the clean root and `WT` the worktree:

   ```bash
   export OPENROUTER_API_KEY=...          # never written to disk by these steps
   export USERPROFILE="$ROOT/home" HOME="$ROOT/home"
   export SHELRA_BENCH_MAX_TOOL_ROUNDS=80
   export SHELRA_ABLATE=bare              # or: gate, memory, plan, ...; unset for full Shelra
   cd "$ROOT"
   bun run "$WT/src/index.ts" bench --manifest bench/suites/shelra-agent-core-v0.2.json \
     --model nvidia/nemotron-3-ultra-550b-a55b:free --suite core-bare-nemotron --json > core-bare.ndjson
   ```

   The reference adapters take `--agent claude-code --model sonnet` (the `claude` CLI must be logged in;
   set `AUDIT_REAL_USERPROFILE` to the real home folder so it finds its login) and
   `--agent codex --model gpt-5.6-luna` (`AUDIT_CODEX_EFFORT`, default `max`).

4. Merge the runs into the versioned history:

   ```bash
   bun run scripts/bench-history.ts import --db "$ROOT/home/.shelra/shelra.db" --source audit-2026-09-23
   ```

One run per cell is one sample. The audit used one run per cell by the owner's choice (a compact,
one-day experiment on the free quota); §6 states which differences that can and cannot support.

## Repeating it on the current code

The switches are part of `shelra bench` since the implementation (§21), so no patch is needed. From
the same clean root, with its own `HOME`, one benchmark at a time:

```bash
bun run "$REPO/src/index.ts" bench --manifest bench/suites/shelra-agent-core-silent-v0.2.json \
  --model nvidia/nemotron-3-ultra-550b-a55b:free --max-tool-rounds 80 --no-clean-room \
  --suite silent-full-nemotron --json > silent-full.ndjson
```

Add `--ablate contract` (or any subsystem of `bench/README.md`) for an ablation, `--repeat 3` for three
samples with a confidence interval, and `--agent claude-code|codex` for a reference. Without
`--no-clean-room` each task runs in its own git repository in a temporary clean room, the default for new
measurements; the §6.4 runs kept the audit's layout so they compare with §6.2.
