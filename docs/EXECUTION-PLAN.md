# Shelra execution plan

Approved by the owner on 2026-09-23. Every session working toward the objective follows this plan and
reports against it. Phases are ordered by dependency, not by calendar: a phase is done when its exit
criterion is met and measured, and the next one starts right after.

## North

**Shelra is the coding agent that gets real work done with free models, because the harness, not the
model, guarantees that the work is right and that the project's decisions hold over time.** By
2026-10-16 this is shown with public evidence against Claude Code and Codex.

Why people would choose it:

- **Free.** Real results without paying for a model.
- **Guarantees.** "Done" only when checks the host ran passed; the project's decisions are kept, change
  after change.
- **Measured.** The first evidence (`docs/architecture/15-evidence/decision-head-to-head.md`): Claude Code
  broke a rule written in its own `CLAUDE.md` in 3 of 3 runs while Shelra on an open model kept it.

## Working rules

1. Free models only, for measuring and for running. No OpenRouter credit unless the owner asks for a
   specific paid run. Never GPT or Claude models through OpenRouter; Claude Code and Codex run through
   their own CLIs as references.
2. Every phase has a measurable exit criterion; the next phase does not start before it is met.
3. Every experiment states its hypothesis and pass criterion before it runs; k ≥ 3, same conditions,
   results saved in `bench/history/` and published with their method and limits.
4. One phase at a time; work that does not serve the north waits.
5. Report to the owner when a phase closes, and a short daily status.

## Phases

| Phase | Goal | Exit criterion | Status |
| --- | --- | --- | --- |
| 0-3 | Trustworthy measurement; the problem confirmed; decisions recorded with the user's approval (`src/ledger/`); decisions enforced through the task contract | done and verified | done |
| F4. Secure the base | Resolve the possible regression seen on 2026-09-23: on the core suite the current code scored 6/8 against 8/8 for the baseline and used 79% more tokens (one paid sample each) | current code ≥ baseline on the core suite at k = 3 on a free model, and tokens per task within +20% of the baseline | next |
| F5. Prove the decision difference | The ledger on vs off with the rule only in `docs/decisions`, on two free models (Nemotron 3 Ultra, Qwen 27B); the battery grown from 3 to 10 traps; head-to-head against Claude Code and Codex | Shelra with the ledger ≥ 90% of tasks passed with the rule kept, ≥ 30 points above Shelra without it, and above Claude Code and Codex | pending |
| F6. Prove continuity | A chain benchmark: one repository evolving through 10 tasks while decisions are added and superseded | ≥ 90% of the active decisions kept across the chain | pending |
| F7. Expert harness for free models | Harder tasks where free models fail today; better repair and verification until they succeed | false completions ≤ 2%, and the gap to Claude Code and Codex measured and narrowed | pending |
| F8. Usable | `shelra decisions import` (rules from `CLAUDE.md`, `AGENTS.md` and ADRs become decisions with checks), `shelra decisions check` as a hook or CI step for any agent, speed, first-run setup | a new user has their rules enforced in under 5 minutes | pending |
| F9. Real use | Shelra and one of the owner's projects work with the ledger on | one week of use with the violations caught recorded | needs the owner's project |
| F10. Public evidence and people | A results page, a "why Shelra" write-up, five people trying it | published, and their feedback recorded | needs the owner's five people |
| F11. Decision | Continue or change course | taken with the numbers on the table | 2026-10-16 |

Building and measuring run in parallel: benchmark runs use each day's free quota while the next
phase's code and fixtures are built. The free quota is the pace setter (OpenRouter's is 1000 requests a
day), which is why more free providers are part of F4's groundwork.

## Owner decisions

- 2026-09-23: plan approved; add more free providers; ask whenever a doubt remains.
- Open: the project for F9; the five people for F10.
