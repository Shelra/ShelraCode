# Field cases

A field case is a real problem someone brought to Shelra, recorded so it can be re-run and set
against another agent's result on the same problem. The benchmark suites in `bench/suites/`
measure the harness on fixed tasks; field cases are the evidence that Shelra resolves the problems
people actually have, on the models they actually use (free ones first).

The scoreboard is [SCOREBOARD.md](SCOREBOARD.md).

## Record a case

1. Find the session: `/sessions` in the TUI, or the id a headless run prints.
2. Extract its numbers:

   ```bash
   bun run scripts/field-case.ts session <session-id>
   ```

   It opens `~/.shelra/shelra.db` read-only and prints the prompt, the model, the time to the
   first answer, the tool calls before it, and the completion-gate loops. The time is marked
   approximate: a round is saved when it completes, but the request's own time is not saved, so
   the session's creation stands in for it.
3. Write `cases/<nnn>-<slug>.json` (see `src/bench/field-cases.ts` for the fields). `solved` and
   `attemptsToSolve` are judged by the person who had the problem, never inferred from the
   transcript. `reference` is the other agent they tried, with its number of attempts.
4. Regenerate the scoreboard:

   ```bash
   bun run scripts/field-case.ts board --write
   ```

## Re-run a case

```bash
bun run scripts/field-case.ts rerun 001 [--model <id>]
```

It runs the case's prompt headless in a new temporary folder (never the user's own folders) and
prints a run record with the time, tool calls and gate loops. Judge the answer, then add the
record under `reruns` in the case file. A re-run shows whether a harness change helped on a real
problem; one run of a free model is one sample, so compare several before concluding.

## Privacy

This repository is public. The script removes the home folder, the user name and the machine name
from everything it prints; keep device names, file contents and other personal details out of the
case files too. The prompt is kept as written so the case can be re-run.
