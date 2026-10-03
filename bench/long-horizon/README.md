# Long-horizon evaluations

Built for the long-horizon audit (`docs/architecture/20-LONG-HORIZON-AUDIT.md`). They measure what survives between
sessions: intent, decisions, task state, interruptions, supersession. Everything here drives the real
`Agent.processMessage` with real tools and real storage in a scratch HOME; nothing touches the user's `~/.shelra`.

| File | What it does | Model quota |
| --- | --- | --- |
| `ledgerly.ts` | The scripted year: twelve epochs of one project (Ledgerly), each a user request, the tool calls of an ideal scripted model and the reflection it returns | none |
| `year-in-a-box.ts` | Layer 1: runs the year, each epoch in its own process and session on a simulated clock (epoch 8 is killed mid-turn), and scores the facts that reach the first request of epochs 9-12, the superseded rules shown as current, and a digest counterfactual at two history volumes | none |
| `probes.ts` | Ten probes (P1, P3-P11): plans across turns, rule and decision caps, contradicting statements, deleting the user's rules, cross-project leaks, `cd`, false completion, escalation, compaction | none |
| `real-run.ts` | Layer 2: one real-model turn on a copy of a state the year produced (`--stop-after N`), strict model, optional `--ablate` and simulated `--date` | free OpenRouter quota |
| `prompts/` | The real-run requests and the grading key for reconstruction | — |
| `redact.ts` | Removes local paths from results before they are written (the repository is public) | — |
| `results/` | Committed results; `results/real/` holds the real-model transcripts summarized | — |

```sh
bun run bench/long-horizon/year-in-a-box.ts [--ablate memory|ledger] [--variant tests-allowed|resume] [--keep]
bun run bench/long-horizon/probes.ts [P4 P8 …]
bun run bench/long-horizon/year-in-a-box.ts --stop-after 11      # keeps a state folder for real-run.ts
bun run bench/long-horizon/real-run.ts --state <folder> --model <id> --prompt-file bench/long-horizon/prompts/reconstruct.txt
```

Run `bunx biome format --write bench/long-horizon/results` after regenerating results (line endings).

Limits: the year's scripted model is ideal, so layer 1 measures the harness's ceiling, not a model; its fact metric
checks presence in the first request, which a plain dump of the episode log also passes at twelve epochs, so the
digest counterfactual at a realistic volume is the bar a design must clear. Layer 2 runs are single samples, graded by
hand against `prompts/reconstruct-key.md`.
