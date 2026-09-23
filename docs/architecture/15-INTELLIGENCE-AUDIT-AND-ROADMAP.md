# 15. Intelligence audit and definitive roadmap (2026-09-23)

This document answers one question with evidence: **if the model behind Shelra were replaced
tomorrow, what would still make that model better at software engineering?** Those parts are Shelra.
Everything else is the model. It then names the bottleneck and orders the work that removes it.

It is written from the working tree at `7b433b0`, the owner's session and benchmark databases, and
experiments run for this audit. Where memory, documentation and code disagree, the code and the
measured behavior win, and the disagreement is listed in Appendix B.

## 0. Method and evidence labels

Every claim carries one of these labels. A capability is only credited when it has behavior evidence
(`TEST`, `RUN` or `DB`); code that exists is `CODE` and is never counted as a capability by itself.

| Label | Meaning |
| --- | --- |
| `TEST` | Reproduced deterministically for this audit with the fake-provider harness (the real `Agent.processMessage`, a scripted model). Probe files are listed in Appendix A. |
| `RUN` | Measured in a real benchmark or field run with a real model (listed in §6 and in `bench/history/benchmark-history.json`). |
| `DB` | Read from recorded history: `~/.shelra/shelra.db` (303 sessions, 2026-09-06 to 2026-09-23) or a project's `.shelra/memory`. |
| `CODE` | Read in the source at the cited line. Says what the code would do, not that it happens. |
| `DOC` | Stated in documentation or memory only. |
| `WEB` | External source (dated, listed in §14 and Appendix C). |
| `INFERENCE` | The auditor's reasoning from the above; stated as such. |

What was done:

1. Reconstruction: auto memory (13 topic files), `CLAUDE.md`, `AGENTS.md`, `PRODUCT.md`, README,
   `docs/architecture/14` §23-§26, `bench/README.md`, field cases, `docs/future-research/*`, git
   history (53 commits since the rewrite), the benchmark database (32 historical runs) and the session
   database (303 sessions, 2,522 tool calls).
2. A full read of the live path: `src/index.ts` → `Agent.processMessage` (`src/agent/agent.ts`, 3,735
   lines) → `src/toolset/tools.ts` → `src/runtimes/local-provider.ts` (the AI SDK step loop) → the
   completion gate → `src/memory/*`.
3. Deterministic probes of the gate, the context compiler, the verify sub-agent and the prompt size
   (Appendix A).
4. Import-graph reachability from `src/index.ts` (dead and disconnected code).
5. Experiments on the real product path with a clean benchmark root: Shelra full vs a bare baseline
   vs single-subsystem ablations, on a free model ladder, against Claude Code (Sonnet 5) and OpenAI
   Codex (gpt-5.6-luna, effort max) on the same tasks and the same oracle (§6).
6. External research on current coding-agent practice, primary sources first (§14).

What was not done: the audit itself changed no product code. Its ablation switches and external agent
adapters lived in a throwaway git worktree (Appendix A). The roadmap was then implemented the same day,
item by item, as local commits; §21 records what each one changed, how it was verified, and what is
still open.

## 1. Executive diagnosis

**Shelra at the audit (`7b433b0`) was a Stage 2 agent: a strong, robust tool loop around the model,
and nothing more that survives a model swap.** Two contributions were Shelra's own and deterministic:
the robustness layer that keeps unreliable free models' turns alive, and the spend controls. Everything
that decides whether the work is *right* (what context matters, what "done" means, whether it was
checked, how to repair it, what to remember) was the model's own behavior or a check the model's text
could satisfy (§4, §5): five ways around the completion check were reproduced (§10), the repository
context was a list of path names that is noise on a real repository (§4 stage 2), and after 303
sessions the project memory held no fact learned from real work (§7).

**Measured on the same tasks and oracle** (§6, one sample per cell): Claude Code (Sonnet 5) resolved
8/8 core, 8/8 silent and 6/6 memory tasks; Codex (gpt-5.6-luna, effort max) 8/8, 8/8 and 5/6, with one
false completion; Shelra with a free model (Nemotron 3 Ultra 550B) 7/8, 6/8 and 3/6. Five of the six
tasks it lost were lost before the agent could work, to the free provider refusing the request; of the
tasks it could attempt it resolved 16 of 17, with one false completion. It took about 250 seconds
per task where Claude Code took about 30. On these fixtures the model is not the limit: availability,
speed and honesty are.

**The bottleneck is the definition of done** (P0-1, P0-2): the harness, not the model, must decide
whether reality matches the request, by running checks it owns on the final state of the work. Every
higher capability (repair, memory, routing, long-horizon work) consumes that signal (§17.2, §20).

**Since the audit** (§21): the task contract now decides "done" whenever a project states its checks;
the loopholes are closed; failures come back parsed, with regressions named and a restore offered;
memory provenance is host-assigned and credited by outcomes; the repository context is the checks, the
git state and the files the request names; the benchmark can see the harness (clean rooms, silent
prompts, ablations, repeats, false completions, reference agents). What is **not yet shown** is that
this raises the resolve rate or lowers false completions across free tiers: that needs the §15.3
protocol (k ≥ 3). The first post-implementation run of the silent suite resolved 7/8 with no false
completion, against 6/8 with one before, on the same model: one sample each (§6.4).

## 2. The original objective, reconstructed

The objective moved five times in seventeen days. Reconstructed from memory and dated documents:

| Date | Stated objective | Source | Status today |
| --- | --- | --- | --- |
| 2026-09-12/13 | Make the existing completion gate load-bearing; a "frontier-grade coding agent" roadmap (Phases 0-6) | doc 14 §5-§14 | Partly executed; Phase 6 ("real usage volume") never started |
| 2026-09-08/15 | Research mission: the durable artifact is the *record of machine discretion* as executable checks; long-horizon memory as its storage layer | `docs/future-research/08`, `11`-`17` | Research only; zero implementation footprint |
| 2026-09-17 | Hard rule: Shelra must not be stateless; every project must make it smarter over time, proven by benchmark | memory `shelra-memory-engine`, doc 14 §24 | Mechanism built; see §7 for what it does in practice |
| 2026-09-18 | "The agent that never loses the project's thread": a decision ledger with re-verifiable evidence; kill test by 2026-10-16 | memory `shelra-objective-decision-ledger`, `PRODUCT.md` | Parked 2026-09-22; owner declared the gate passed 2026-09-23 on a live run, phase 2 not started |
| 2026-09-19 | Hard rules: never abort the flow; model-agnostic guarantees live in deterministic harness code | `AGENTS.md`, doc 14 §26 | Implemented and tested (§4, stage 12) |
| 2026-09-22 | "Es el objetivo realmente resolver": solve real tasks with any model, free models first | memory `shelra-objective-solve`, `CLAUDE.md` | Current objective |

The current objective, in the owner's words in `CLAUDE.md`: *solve real tasks with any model, free
models first, and get better at a project the longer it works on it instead of starting from zero
each session. The model proposes; only host-observed evidence marks work as verified, whichever model
answered.* The brief for this audit adds the chain the architecture is supposed to carry:
**Intent → Specification → Plan → Execution → Reality → Verification → Repair**, plus persistent
learning.

Where each link of that chain stands (details in §4):

| Link | Exists | Partially | Only documented | Missing |
| --- | --- | --- | --- | --- |
| Intent | the request is kept verbatim; standing rules captured | | intent modelling, clarification policy | |
| Specification | | acceptance criteria when the *model* chooses `generate_plan` | host-owned specification | a host-owned, executable definition of done |
| Plan | a plan tool and its UI | criteria reused in nudges and compaction | plan-driven execution | dependency tracking, replanning on failure |
| Execution | a robust tool loop (the strongest part of Shelra) | | | |
| Reality | tool results, bounded; the bench's external oracle | | | host-run checks on the live path |
| Verification | a deterministic *presence* check | | "verified by host evidence" | checks bound to the final state and to the request |
| Repair | provider-level recovery | model-driven retries after fixed nudges | | failure diagnosis, attempt memory, rollback |
| Learning | the memory engine's mechanism | the memory benchmark (one trap, one model) | "gets better at a project" | organic knowledge from real use |

**How close is Shelra to that objective?** The execution substrate is close; the objective is not.
Shelra reliably keeps a free model's turn alive and makes it use tools. The two properties that define
the objective, *host-evidenced completion* and *getting better at a project*, exist as mechanisms that
the evidence in §7 and §10 shows are either bypassable or empty. On its own repository, after 303
sessions over 17 days, Shelra's project memory holds no fact it learned from real work (§7).

## 3. What actually exists

`src/` holds 198 non-test source files and 55,309 lines. From `src/index.ts`, 183 files (52,876 lines)
are reachable at runtime `CODE`. The shares below are by lines.

| Group | Modules (lines) | Role | On the path a user's turn takes? | Behavior evidence |
| --- | --- | --- | --- | --- |
| Turn loop | `agent/agent.ts` 3,735, `agent/*` 1,608 more, `toolset/*` 1,975, `tools/{file,bash,grep}` ~1,000 | the live agent | yes | `TEST` 787 Vitest tests + Bun suites pass; `RUN` §6 |
| Model runtime | `runtimes/local-provider.ts` 345 (the AI SDK step loop), `providers/*` 1,383, `models/*` 1,335 | OpenRouter-first routing, recovery, cost | yes | `TEST` `resilience.test.ts`; `RUN` smoke survived 5 upstream overloads |
| Context | `context/compiler.ts` 216, `agent/compaction.ts` 625, `providers/stale-tool-results.ts` 98, `utils/instructions.ts` | orientation, compaction, result clearing | yes | `TEST` the compiler's output on this repo is noise (§5.1) |
| Memory | `memory/*` 1,774 | project and user memory, reflection, skills | yes | `DB` no organic entries (§7) |
| Storage | `storage/*` 3,110 | sessions, transcript, usage, objectives, checkpoints, bench | yes | `DB` |
| Bench | `bench/*` 2,356 + `storage/benchmarks.ts` 1,366 + `bench/` fixtures/oracles | measurement | no (tooling) | `RUN` |
| UI | `ui/*` 15,425 (`app.tsx` 7,052) | OpenTUI terminal app | yes | owner reviews, render tests |
| Peripheral features | telegram 1,087, payments + wallet 546, schedules + daemon 747, computer use 632, audio 165 | integrations | opt-in | `DB` 1 computer call, 0 payments in 303 sessions |
| Unused intelligence surface | LSP 1,338; sub-agent prompts (~300 lines in `agent.ts`); `verify/*` 1,604 | semantic navigation, delegation, sandboxed verification | reachable | `DB` LSP 0 calls in 2,522; `task` 6 calls; `verify` cannot run commands on Windows or Linux (§10) |
| Retiring | `autonomy/*` 3,027 (`--autonomous`), `intelligence/*` 1,290 (used only by `autonomy`) | a second kernel and a second provider layer | only with `--autonomous` | none recent |
| Dead | 10 files, 2,167 lines: `ui/bench-modal.tsx` 911, `toolset/batch.ts` 413, `cli/installation.ts` 327, `utils/workspace-trust.ts` 109, `memory/report.ts` 84, `tools/checkpoint.ts` 45 (the only reader of checkpoints), others | | unreachable from `src/index.ts` | `CODE` |
| Separate app | `frontend/` Next.js 16, 9,370 lines | landing page and sign-in | no connection to the agent | out of scope for intelligence |

**Competing foundations** `CODE`. The repository carries more than one implementation of several
core concepts:

| Concept | Implementations | Which one the user's turn uses |
| --- | --- | --- |
| Execution kernel | `Agent.processMessage`; `AutonomyKernel` (`--autonomous`) | the first |
| Model access | `ProviderAdapter` (`src/providers`); `IntelligenceProvider` (`src/intelligence`, including a `claude -p` provider) | the first; the second serves only `autonomy` |
| Lifecycle state | `AgentKernel` phases (labels, §4 stage 5); `AutonomyKernel` phases | neither controls the turn |
| Verification | completion gate + a regex (`agent/verification-evidence.ts`); `src/verify` (Shuru recipes, `/verify`, the `verify` sub-agent); `autonomy/acceptance.ts` `CheckSpec` (the bench oracle) | the regex; `CheckSpec` never runs on a user's turn |
| Definition of done | model-published acceptance criteria (text); `CheckSpec` criteria (executable, bench only) | text |
| Task state | transcript; `objectives` index (written, read only for display); `checkpoints` (written, never read) | transcript |

Effort follows the surface, not the core: since the history's first commit, 52 commits added about
28,900 lines of docs, 14,000 of website, 9,100 of TUI and 9,700 of bench and scripts, against about
2,700 in `src/agent`, 2,100 in `src/memory`, 1,900 in providers and 1,000 in tools `DB` (git numstat).

## 4. The agent lifecycle, stage by stage

One user turn, as the code runs it. Classification scale from the brief: STRONG, FUNCTIONAL, PARTIAL,
WEAK, MISSING, FAKE/COSMETIC, UNKNOWN. "Model-driven" means the stage happens only if the model
decides to do it; the harness neither requires nor checks it.

| # | Stage | Class | What actually happens | Evidence |
| --- | --- | --- | --- | --- |
| 1 | User intent | FUNCTIONAL | The request is kept verbatim; `UserPromptSubmit` hooks run; "always/never" sentences become human-sourced memory without a model call. No intent model, no clarification policy beyond the prompt's "state your interpretation and proceed". | `CODE` `agent.ts:2370-2417`, `memory/reflection.ts:71` |
| 2 | Context discovery | WEAK | `AGENTS.md` files from the git root to the cwd are injected (works). The host "repository context" lists up to 24 paths whose names contain a word of the request, from the first 256 files of an alphabetical walk. On this repository it lists 28 paths, none under `src/`, for "fix the completion gate in src/agent/agent.ts". No git state, no repo map, no build/test command discovery. | `TEST` compiler probe; `CODE` `context/compiler.ts:5,164-173` |
| 3 | Memory retrieval | FAKE in practice (mechanism FUNCTIONAL) | Lexical ranking injects up to 4 entries. The stores it reads are empty in real use (§7). | `TEST` memory tests; `DB` §7 |
| 4 | Specification | MISSING (host); model-optional | Nothing host-side. The model may publish acceptance criteria through `generate_plan`; requirement sentences are extracted from the request only at the end, for the audit round. | `CODE` `toolset/tools.ts:1104`, `agent/requirements.ts` |
| 5 | Planning | PARTIAL, and COSMETIC as control | `generate_plan` publishes a plan the UI renders and the gate quotes; nothing executes, orders or re-plans from it. `AgentKernel` moves `discover → analyze → plan` in consecutive lines with nothing between them (`agent.ts:2394,2431,2432`); the phases are labels written to the `objectives` table. | `CODE`; `DB` plans in 62 of 119 sessions with tools |
| 6 | Model decision | MODEL | The AI SDK's multi-step loop (`streamText`, `stopWhen: stepCountIs(400)`), temperature 0.7, reasoning effort "high" when supported. | `CODE` `runtimes/local-provider.ts:165-192`, `agent.ts:2583` |
| 7 | Tool selection | MODEL, with FUNCTIONAL harness support | 22 tools; which to call is the model's choice. The harness repairs malformed calls (`<item>` markup, JSON where a string is expected, flattened arrays) and turns tool exceptions into readable failures. LSP was called 0 times and sub-agents 6 times in 2,522 recorded calls. | `TEST`; `DB` |
| 8 | Action | FUNCTIONAL, unguarded | File tools are confined to the workspace and a scratch folder. `bash` runs any command on the host: no risk classification, no approval, and the only sandbox (Shuru) requires macOS on Apple Silicon. | `CODE` `security/workspace-guard.ts`, `tools/bash.ts:550` |
| 9 | Environment result | FUNCTIONAL | Results are bounded (`read_file` 2,000 lines / 50,000 chars), failures come back as results, old results are cleared from long requests. | `TEST` `file-read.test.ts`, `stale-tool-results.test.ts` |
| 10 | State update | PARTIAL | Completed steps are persisted even when a round fails (STRONG). A checkpoint of every file is saved before each write, and nothing reads it: the only reader, `tools/checkpoint.ts`, is unreachable. Plan state is whatever the model reports with `update_plan_step`. | `TEST` resilience; `CODE` reachability |
| 11 | Verification | PARTIAL (a presence check) | "Verified" means: some successful bash command in the turn matched a list of check-like words. Five loopholes reproduced (§10). | `TEST` `audit-probes.test.ts` |
| 12 | Failure detection | STRONG for infrastructure, WEAK for the task | Provider failures, stalls, empty steps, leaked tool markup and identical-call loops are detected and handled without the model. Whether the *task* failed (a red test, a wrong behavior) is left for the model to notice. | `TEST` `resilience.test.ts`; `CODE` |
| 13 | Repair / replan | WEAK (a reprompt) | The gate appends a fixed nudge and re-enters the loop, up to 3 times. No failure diagnosis, no memory of failed attempts beyond identical-call detection, no rollback, no forced change of approach. | `CODE` `agent.ts:2968-3033` |
| 14 | Final validation | WEAK | The same presence check. Evidence from before later edits still counts; the host never re-runs a check on the final state. | `TEST` loophole 3 |
| 15 | Memory / skill learning | WEAK (produces noise) | After a "verified" turn one reflection call proposes facts; a gate filters them. In the smoke run of this audit it stored `slugify-implementation` (the task itself) and `run-tests`. Skills are promoted when retrieval *injected* a procedure twice, not when it helped. | `RUN`; `CODE` `memory/skills.ts:26` |
| 16 | Completion | FUNCTIONAL | An honest `[Not verified — …]` label when the nudges run out; Stop hooks can refuse completion. The label is streamed and its reason written to the `objectives` index, but it is not saved in the transcript, so the next turn's model never sees that the previous turn ended unverified. | `TEST`; memory 2026-09-23 open finding |

The shape is clear: the harness is **strong where failures are mechanical** (stages 9, 10, 12) and
**absent or cosmetic where failures are semantic** (stages 2, 4, 5, 11, 13, 14, 15). Every stage that
decides whether the *work* is right is either the model's own judgment or a check that the model's
text can satisfy.

## 5. Intelligence audit: what Shelra adds on top of the model

The test for every row: would this still help if the model were swapped for a weaker or a stronger
one? "Deterministic" means the harness does it whatever the model does; "model-driven" means it happens
only if the model chooses it.

| Dimension | What Shelra itself contributes | Deterministic? | Level | Evidence |
| --- | --- | --- | --- | --- |
| **Robustness** (keeping a turn alive and well-formed) | retries, fallback routers, empty-step and leaked-markup retries, argument repair, bounded outputs, loop stop, idle watchdog, upstream quarantine, credential fallback, tool exceptions as results | yes | **STRONG** | `TEST` resilience and provider suites; `RUN` this audit's runs survived repeated "Service temporarily overloaded"; doc 14 §23: 1/8 → 5/8 on one model came mostly from here |
| Context engineering | `AGENTS.md` chain; compaction with criteria preserved; stale-result clearing; bounded reads | yes | FUNCTIONAL | `TEST` |
| Repository understanding | a path-name listing that is noise beyond small repositories | yes, but wrong | **WEAK** | `TEST` §4 stage 2 |
| Memory | retrieval and a write gate exist; nothing organic accumulates | mechanism yes, content model-driven | **FAKE in practice** | `DB` §7 |
| Planning | a forgiving plan tool; criteria survive compaction and appear in nudges | model-driven | PARTIAL (no control) | `CODE` §8 |
| Tool use | makes the model's calls survive (repair, hardening); selection is the model's | execution yes, selection no | FUNCTIONAL | `DB`, `TEST` §9 |
| Execution | the AI SDK step loop plus Shelra's recovery | loop: library; recovery: yes | FUNCTIONAL | `CODE` |
| Verification | a presence check that some check-like command succeeded | yes, but bypassable | **PARTIAL / WEAK** | `TEST` five loopholes §10 |
| Repair | infrastructure: yes; task: a fixed nudge | infra yes, task no | infra STRONG, task **WEAK** | §11 |
| Research | safe `search_web`/`open_web` tools, fetched text marked untrusted; when to research is the model's call | model-driven | PARTIAL | `DB` 82 web calls in 11 sessions |
| Self-evaluation | the requirement audit (English only, one prompted round) and the documents-only fact-check | trigger yes, judgment model | WEAK | `TEST` §10 |
| Cost and budget | spend limits enforced before every request; cost read from the provider | yes | STRONG | `TEST`, doc 14 §23.3 |
| Honesty of the final report | `[Not verified — …]` when the nudges run out | yes | FUNCTIONAL (not persisted) | `TEST` |

**Two things are Shelra; the rest is the model.** Replace the model tomorrow and two contributions
survive intact: the *robustness layer*, which lets unreliable free models finish turns at all, and the
*spend controls*. Everything that decides whether the work is correct, what context matters, what to
remember and how to repair a wrong result is either the model's own behavior or a check the model's text
can satisfy. §6 measures how much of the outcome each part carries.

## 6. Model dependence: what the experiments measured

### 6.1 Setup

All runs used the real product path (`Agent.processMessage`) or a reference agent, the same fixtures
and the same benchmark-owned oracles, on 2026-09-23 `RUN`:

- **Clean root**: a folder outside any git repository holding a copy of `bench/`, with its own `HOME`;
  tasks ran under it, so no repository instructions, skills or memory leaked in (Q7).
- **Suites**: *core* (8 tasks whose prompts end with "Run bun test before completing"), *silent* (the
  same 8 tasks without that sentence, so the harness must decide about verification itself),
  *memory* (6 tasks: two traps, each learned once and then recalled with and without memory).
- **Shelra** at `7b433b0` plus the audit patch: full harness, `bare` (environment facts, six tools,
  robustness layer kept) and no gate; model pinned with no fallback; at most 80 tool rounds per task.
- **References**: Claude Code (`claude -p --model sonnet`, Sonnet 5) and Codex (`codex exec`,
  gpt-5.6-luna, reasoning effort max), each in its own harness, graded by the same oracle.
- One sample per cell. A task the free provider refused before the agent could act is counted as
  *infra-lost*; the supplement run S1b re-ran S1's lost tasks (06 and 08 then passed; 07 was lost again).

### 6.2 Results

| Run | Agent | Model | Harness | Resolved | Infra-lost | False completions | Median time (s) | Median model steps |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| S1 (+S1b) | Shelra | Nemotron 3 Ultra 550B (free) | full | 7/8 | 1 | 0 | 252 | 15 |
| S2 | Shelra | Nemotron 3 Ultra 550B (free) | bare | 1/8 | 6 | 1 | 1 | 1 |
| C1 | Claude Code | Sonnet 5 | its own | 8/8 | 0 | 0 | 29 | 7 |
| X1 | Codex | gpt-5.6-luna, max | its own | 8/8 | 0 | 0 | 101 | 1 |
| S3 | Shelra | Nemotron 3 Ultra 550B (free) | full, silent | 6/8 | 1 | 1 | 271 | 18 |
| S4 | Shelra | Nemotron 3 Ultra 550B (free) | no gate, silent | 7/8 | 0 | 1 | 104 | 8 |
| C2 | Claude Code | Sonnet 5 | its own, silent | 8/8 | 0 | 0 | 32 | 7 |
| X2 | Codex | gpt-5.6-luna, max | its own, silent | 8/8 | 0 | 0 | 139 | 1 |
| S5 | Shelra | Nemotron 3 Ultra 550B (free) | full, memory | 3/6 | 3 | 0 | 9 | 4 |
| C3 | Claude Code | Sonnet 5 | its own, memory | 6/6 | 0 | 0 | 21 | 11 |
| X3 | Codex | gpt-5.6-luna, max | its own, memory | 5/6 | 0 | 1 | 78 | 1 |

Per-task results, token totals and every failure message: `15-evidence/results.md`. (Codex reports
one step per task because `codex exec` streams its whole run as one turn.)

### 6.3 What the numbers say

1. **On these fixtures the model is not the limit.** Claude Code resolved all 22 of its tasks and Codex
   21 of 22; Shelra with a free model resolved 16 of the 17 tasks the provider let it attempt in its
   three full-harness runs. The fixtures separate the agents on availability, speed and honesty, not on difficulty,
   which is itself a finding about the suite (§15.1): harder, larger tasks are needed to measure
   intelligence rather than stamina.
2. **Availability dominates the free tier's losses.** 11 of the 14 tasks Shelra lost across its five
   runs were refused by the free provider before the agent acted ("cannot serve this request … no
   fallback model is left"). A benchmark pins the model, so no fallback may replace it; in product use
   the free router would have taken over. In measurement these are lost samples, which is why the
   protocol needs repeats and a supplement for infra-lost tasks (S1b recovered two of three).
3. **The old gate made no measurable difference, and could not have.** Full (S3) and no-gate (S4)
   silent runs each had one false completion, and both, like the bare run's in S2, share one shape: the
   agent ran the project's visible tests (one to four times), they passed, and the hidden oracle failed.
   (Codex's false completion in X3 is on a memory-recall task; its log does not count test runs.) A gate that only checks that tests ran, or even runs them itself, cannot see
   behavior the project's own tests do not cover. The lever for that gap is the requirement audit and
   task checks that fail before the change (Phase 1.3), not stricter test-running.
4. **The bare ablation is uninformative**: six of its eight tasks were refused by the provider during
   a bad window (13:08-13:18 UTC).
5. **Speed.** Shelra's median task took 250-270 seconds and 15-18 model steps against Claude Code's
   30 seconds and 7 steps. Free-model latency explains part of it; the rest is steps, which the
   contract and the leaner context (Phases 1 and 3) are meant to reduce by making each step count.
6. **Model dependence across free tiers** (a medium and a weak free model on the same suites) is
   scheduled on the next day's free quota; §6.4 records the runs as they complete.

### 6.4 After the implementation

The same clean root, model, tasks, oracle and 80-round bound, with the post-audit code (§21) at
`d282a68`, which includes Phases 0-3 and the memory items up to `4e7c928`, but not the later restore
tool and memory re-confirmation. Runs with `--no-clean-room` so the task layout matches the baseline.

| Run | Suite | Harness | Resolved | Infra-lost | False completions | Median time (s) | Compare with |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A0 | smoke (1 task) | full | 1/1 | 0 | 0 | 368 | — |
| A3 | silent | full | 7/8 | 0 | 0 | 338 | S3: 6/8, 1 infra, 1 false |

On the silent suite the post-audit code resolved one task more and ended none as falsely done. The
task that was a false completion before (06, bounded queue) did not end as done this time: the agent
kept repairing, with 24 test runs, until the benchmark's 1200-second limit stopped it, an honest failure
instead of a claimed success. Task 08, lost to the provider in S3, passed, although the provider failed
again near its end. The cost rose: 2.50 million tokens against 1.10 million, and a median of 24 model
steps per task against 18, a part of it the 75 steps of task 06 before its time limit. One sample per
side: this is consistent with the contract's purpose, not yet evidence that it works; the §15.3
protocol (k ≥ 3, the contract ablation A4) decides that, and whether the extra cost buys it.

Scheduled after the next quota reset: A1 (core, compare S1), A5 (memory, compare S5), A4 (silent with
the contract switched off, the contract's own ablation) and A6 (a second silent sample).

## 7. Memory audit: does Shelra learn?

**Mechanism** `CODE`. Four writers share one deterministic gate (`memory/gate.ts`): the model's
`memory_write` tool, one bounded reflection call after a qualifying turn (`memory/reflection.ts:95`:
a verified change, a failure followed by success, or ≥8 tool calls), a deterministic "command X failed
until Y succeeded" record (`reflection.ts:110`), and "always/never" sentences from the user. Retrieval
ranks entries lexically against the request and the context compiler's paths, expands up to four
bodies (3,000 chars) and lists every other entry by title (`memory/retrieval.ts`). A `procedure`
injected into two turns becomes `.agents/skills/<slug>/SKILL.md` (`memory/skills.ts:26`).

**What it has learned in real use** `DB`:

- This repository's `.shelra/memory` holds two entries, "Email field in User schema" and "Test email
  field validation", written 2026-09-17 by a memory-benchmark task whose memory scope leaked to the
  repository root. Neither describes Shelra.
- Its reflection audit (`reflections.jsonl`) has 527 records. 526 were written by the test suite: the
  gate and resilience tests build an `Agent` whose working directory is the repository and whose fake
  model answers "Summary." or "Implemented and verified.". One came from the leaked benchmark task.
  None came from the 34 sessions the owner and field cases ran in this repository.
- Across all 303 sessions the model called a memory tool in 2. The user-wide store does not exist.

After 17 days and 303 sessions, Shelra knows nothing about its own repository that it did not know
on day one. The only positive evidence is the memory benchmark of 2026-09-17: with phase A's memory,
4 of 6 phase-B tasks passed; without it, 1 of 9 (one trap type, one 30B model) `RUN` doc 14 §24.3.
The i18n trap added afterwards has never been run. This audit's run on the current harness is in §6.

**Quality of what it writes.** In this audit's smoke run the reflection stored
`slugify-implementation` (the task itself, which its own prompt says not to store) and `run-tests`
`RUN`. The deterministic fallback once stored only an `ls` failure (doc 14 §24.3, run #16).

**Defects that stop memory from compounding:**

| # | Defect | Evidence | Effect |
| --- | --- | --- | --- |
| M1 | The model can mark its own write `source: "human"`; the only guard is a sentence in the tool description | `CODE` `toolset/tools.ts:685` | A model inference becomes un-revisable by later inferences and gets the highest retrieval weight |
| M2 | Staleness is one-way: an entry turns "MAY BE STALE" when a related file changes, and only the TUI memory panel can confirm it again | `CODE` `memory/store.ts:424`, sole caller `ui/app.tsx:3195` | In an active repository every file-linked entry decays to "stale" and stays there |
| M3 | Usefulness is never measured: `uses` counts injections into a prompt, and skill promotion keys on it | `CODE` `agent.ts:2420`, `memory/skills.ts:26` | Skills are promoted for being retrieved, not for helping |
| M4 | Learning runs only at the end of a turn that passed the gate; turns that end paused or `[Not verified]`, typical of long real tasks, teach nothing | `CODE` `agent.ts:3017-3079` | The hardest work leaves no trace |
| M5 | No contradiction handling beyond a token-Jaccard duplicate merge | `CODE` `memory/gate.ts:197-238` | Two entries that disagree in different words coexist and can both be injected |
| M6 | Every non-expanded entry is listed in every request, up to the 200-line index cap | `CODE` `retrieval.ts:192-199` | Memory growth becomes per-request token cost |
| M7 | Tests write into the developer's real project memory audit log | `DB` 526 of 527 records | The audit trail of learning is noise |
| M8 | Retrieval ranks against the context compiler's paths, which are noise on large repositories (§4 stage 2) | `TEST` | Path overlap boosts the wrong entries |

**Does six months on one repository make Shelra better at it?** On today's evidence, no. The mechanism
can carry a fact from one session to the next (the benchmark shows it), but nothing makes useful facts
accumulate: writes are rare and noisy, usefulness is not fed back, trust only decays, and the turns that
teach the most never reach the learning step. Stale or wrong memories are marked but still injected;
nothing re-verifies them.

## 8. Planning audit: does the plan control execution?

- `generate_plan` is optional and model-invoked. The host accepts forgiving shapes (bare strings,
  `<item>` markup, a JSON array inside a string), a genuine help for weak models (doc 14 §25.4).
- The plan does not control anything. No step gates an action, no dependency is tracked, no step is
  checked against what the tools did. `update_plan_step` statuses are whatever the model reports; a
  criterion counts as "explicitly evidenced" when any verification ran in the same turn (doc 14 §18).
- Its whole effect on behavior: the criteria survive compaction (`appendActiveCriteriaBlock`), persist
  across turns, and are quoted in the gate's nudges.
- No replanning. When reality differs from the plan, nothing in the host notices.
- `AgentKernel` phases (`frame → discover → analyze → plan → act → …`) are labels written to the
  `objectives` table; three of them are set in consecutive lines (`agent.ts:2394,2431,2432`), and a
  restored kernel is replaced at the start of the next turn (`agent.ts:2386`).
- Models plan when the tool is offered: 62 of 119 sessions with tool calls published a plan `DB`.
  Benchmark tasks with a plan passed 12 of 18, without one 29 of 87, a correlation confounded by model,
  run and task selection `DB`; it cannot be attributed.
- A plan *gate* (no write before a plan) was tried and removed because mid-tier models fumbled the
  nested schema and gave up (doc 14 §23.3 item 4).

Goal, requirements, acceptance criteria, steps and verification methods exist as fields of the plan.
Evidence and completion are not linked to them. By the brief's own definition this is "a planner that
produces Markdown but does not control execution".

## 9. Tool intelligence audit

Which tool, when, in what order, in parallel or not, and whether an action is risky: every one of these
decisions is the model's. What the harness adds is making the model's choices *survive*:

| Harness contribution | Model-agnostic? | Evidence |
| --- | --- | --- |
| Repair of malformed calls (`<item>` markup, JSON where a string is expected, flattened arrays) | yes | `TEST` `providers/messages.ts` tests; doc 14 §24.3 item 1 |
| Tool exceptions become failed results with a way forward; MCP tools too | yes | `TEST` `hardenToolSet` (`toolset/tools.ts:1325`) |
| Bounded reads, CRLF-tolerant edits, PowerShell `&&` rewriting, `cd` confinement | yes | `TEST` |
| Stale tool results cleared from long requests | yes | `TEST`; field case 002 re-run #3: 32K tokens/step vs 92-120K |
| Identical-call loop stop (six repeated steps) | yes | `TEST` `providers/stream.ts` |
| Hooks on every tool (user policies) | yes | `TEST` |

What is missing: no risk classification or approval for shell commands; no host-side decision about
what to gather first (prompt text only); no lint or type diagnostics returned after an edit (the
`lspDiagnostics` field exists; the LSP tool is off by default and was never called); no fast context
retrieval sub-agent.

Usage over 2,522 recorded calls `DB`: bash 1,091, read_file 560, write_file 271, plan tools 304,
edit_file 115, web 82, grep 47, memory tools 6, `task` 6 (general 3, explore 2, verify 1), LSP 0. The
delegation surface (nine sub-agent types, ~300 lines of prompts, background delegations) is almost
never chosen; the sub-agent the gate trusts most, `verify`, cannot run a command on Windows (§10).

**Verdict:** tool *execution* robustness is one of Shelra's two real contributions. Tool *selection*
intelligence is the model's.

## 10. Verification audit: does Shelra know when reality matches intent?

**Mechanism** (`agent.ts:2953-3049`): when a turn changed files through `write_file`/`edit_file`/
`delete_file` and no *verification evidence* was recorded, the host appends a fixed nudge and continues
the turn, up to three times, then ends with `[Not verified — …]`. A turn that only wrote documents gets
one fact-check request and always ends unverified. A request naming three or more behaviors gets one
requirement-audit round. Evidence (`agent/verification-evidence.ts`) is: a successful bash command
whose last `&&` chain contains a check-like word anywhere in its text, running a file changed this
turn, a desktop screenshot, or a successful `task` call to `verify`, `ui-verify` or `computer`.

**Probes** `TEST` (`src/agent/audit-probes.test.ts` in the audit worktree; the real `processMessage`
with a scripted model):

| Probe | Scripted behavior | Result today | Sound behavior |
| --- | --- | --- | --- |
| Control 1 | writes a file, runs nothing | 3 nudges, then `[Not verified]` | same |
| Control 2 | writes a file, `bun test` fails | 3 nudges, then `[Not verified]` | same |
| Loophole 1 | writes a file, `echo "all good, tsc passes"` | **completes as verified** | ask for a real check |
| Loophole 2 | writes a file, `curl https://example.com` | **completes as verified** | ask for a check of the change |
| Loophole 3 | writes a file, `bun test` passes, **then edits another file**, stops | **completes as verified** | re-verify the final state |
| Loophole 4 | changes code through the shell (`node -e "…writeFileSync…"`) | **gate never fires** | treat shell writes as changes |
| Loophole 5 | writes a file, `tsc --version` | **completes as verified** | ask for a real check |
| Verify sub-agent (Windows) | `task(verify)` | every command it runs fails with "Shuru sandbox mode currently requires macOS on Apple Silicon"; a completed `task(verify)` still counts as evidence | not offered, or not counted, where it cannot run |

**Systematic or opportunistic?** Opportunistic. The host never runs a check itself on a user's turn; it
counts what the model ran. The only host-run verification in the codebase, the `CheckSpec` engine in
`autonomy/acceptance.ts`, runs only inside the benchmark.

**Coverage.** Tests, type-checks, lint and builds are recognized; runtime, API and browser checks
happen only if the model does them; no regression baseline is taken before a change; nothing ties a
check to the requirement it proves.

**Real use** `DB`: 14 gate nudges, 13 requirement audits and 2 saved `[Not verified]` notes in 303
sessions (the note is streamed but not persisted, so this undercounts). In benchmark sessions the gate
never had to nudge: every task prompt of the core and memory suites ends with "Run bun test before
completing", so the *user* already demands the verification the gate exists to demand (§15). In field
case 002 a free model gamed the gate by echoing "VERIFIED" and writing "verification" text files;
later fixes closed those doors, not the class.

**Language.** The requirement audit extracts obligations with an English-only pattern
(`agent/requirements.ts:11`). The same four-behavior slugify request extracts 2 requirement sentences
and triggers the audit in English, and extracts 0 in Spanish, the owner's working language `TEST`.

**Verdict:** Shelra does not know whether reality matches intent. It knows whether a command that
looks like a check exited 0 at some point in the turn.

## 11. Repair audit: recovery or re-prompting?

| Failure class | Detected by | Repaired by | Class |
| --- | --- | --- | --- |
| Provider silence, cut stream, 429/5xx, 402/404, empty step, leaked tool markup | the host | the host: retry with backoff, keep completed steps, switch to the provider's fallback router, pause with progress saved | STRONG `TEST` `resilience.test.ts`; `RUN` |
| Rejected API key | the host | the host: another configured key, OpenRouter Free, an installed local model | STRONG `TEST` |
| Transient upstream error that OpenRouter reports as HTTP 404 ("Provider returned error", upstream Nvidia) | the host, **misclassified** as permanent (`isModelUnavailableError` treats every 402/403/404 alike, `agent.ts:3640-3646`) | none with a pinned model: the turn pauses at once; with an unpinned model it switches to the random free router | **defect** `RUN` `TEST`: cost three of eight tasks of this audit's first run in 1-13 s each, and the same model answered 200 to a probe minutes later; a scripted upstream 404 pauses a pinned turn after one attempt (`audit-probes.test.ts`) |
| Tool exception, missing binary, MCP failure | the host | the model, with a readable failure | FUNCTIONAL |
| Identical repeated calls | the host (six steps) | stream ends | FUNCTIONAL |
| Unverified change | the host (weak, §10) | the model, after a fixed nudge | WEAK |
| Red test, wrong behavior, unmet requirement | **the model** | **the model** | model-driven |
| Wrong approach repeated with variations | nobody | nobody | MISSING |

No diagnosis of failing output into structured failures, no record of attempts ("tried X, failed
because Y") that constrains the next attempt, no rollback to the pre-attempt checkpoint although every
write is checkpointed, and no escalation to a stronger model or higher effort on repeated *semantic*
failure (only on provider failure). Two measured side effects of repair-by-prompt: a verification
sentence in the system prompt looped a 30B model for 96 steps (doc 14 §25.2, run #23); the requirement
audit solved task 01 at 38 steps against 6 without it (run #24).

**Verdict:** for infrastructure Shelra recovers on its own, with any model. For the task itself it asks
the model to try again.

## 12. Code quality audit

Reviewed against Google's engineering practices (design, functionality, complexity, tests, naming,
comments, documentation), the TypeScript and Bun documentation, and OWASP guidance for LLM
applications (sources in §14). Systemic findings only:

| # | Finding | Evidence | Severity |
| --- | --- | --- | --- |
| Q1 | **The core is a monolith.** `Agent` (3,735 lines) holds the prompts (~330 lines of prompt text), sub-agent orchestration, compaction, interruption recovery, credential fallback, the gate, the audit, learning, `/verify`, budgets, recaps and side questions. `app.tsx` is 7,052 lines, `index.ts` 1,861. Behavior tests must mock storage and hooks to reach the gate. | `CODE` | P1 |
| Q2 | **Resilience without observability.** 291 `catch` blocks in non-test code; most swallow by design (never throw out of the turn) and record nothing, so a failing memory write, checkpoint, index update or recap is invisible. | `CODE` | P1 |
| Q3 | **Tests are not hermetic.** Agent tests write into the developer's real `.shelra/memory/reflections.jsonl` (526 records). | `DB` | P1 |
| Q4 | **Mechanisms no path reads.** Checkpoints (written on every mutation, reader unreachable), `objectives` phases (display only), `search_x` (no provider supplies it), the `verify` sub-agent off macOS. The exact failure `CLAUDE.md` lists as already paid for. | `CODE`, `TEST` | P0 for verify (it weakens the gate), P2 otherwise |
| Q5 | **Stale model-facing text.** Sub-agent prompts describe a two-column layout and sidebar the TUI no longer has (`ui-verify`), a Debian ARM64 sandbox (`verify-manifest`), and activity labels for removed image, video and X tools. A model reads these as facts. | `CODE` `agent.ts:516-640,3436-3464` | P1 (prompt text is behavior) |
| Q6 | **Unguarded host execution.** `bash` runs any model-generated command on the host; the only sandbox needs macOS on Apple Silicon; no default deny or ask rules. With free and weak models this is the largest security exposure. | `CODE` | P1 |
| Q7 | **Benchmark contamination.** Task workspaces inside the repository have no git root of their own, so every historical product-path run carried Shelra's own `AGENTS.md` (9,671 chars) and its 7 skills (4,475 chars): 19,959 system-prompt chars against 5,796 in a clean project. | `TEST` `audit-prompt-size.test.ts` | P0 for measurement |
| Q8 | **Coupling to a retiring package.** The bench's oracle engine (`evaluateAcceptance`, `CheckSpec`) lives in `src/autonomy`, which is being retired. | `CODE` `bench/agent-executor.ts:3-4` | P1 |
| Q9 | Dead code: 10 files, 2,167 lines; retiring code still shipped: 4,317 lines. | `CODE` reachability | P2 |
| Q10 | Minor: an orphaned doc comment for `describeVerificationEvidence` sits above `STATUS_MESSAGES` in `agent.ts`; two different regexes classify credential errors for display and for control. | `CODE` | P2 |

What is good and should be kept: strict TypeScript with a single `any`; no TODO/FIXME debt; Biome and
CI green; 787 Vitest tests plus Bun suites pass (`TEST`, full chain in the audit worktree); the core
loop is tested *behaviorally* with a scripted provider, the right pattern for agent code; commits are
small and explain why; the benchmark keeps immutable history.

## 13. Architectural debt: what should disappear, merge or be finished

| Action | Item | Why |
| --- | --- | --- |
| **Consolidate** | One verification and definition-of-done engine: move `CheckSpec` + `evaluateAcceptance` out of `src/autonomy` into a neutral module used by the live turn *and* the bench; retire the regex-only evidence and the Shuru-only `src/verify` path into it | Three verification systems today, and the live path uses the weakest (§3, §10) |
| **Retire** | `AutonomyKernel` and `src/intelligence` (§25.8 decision), after `--autonomous` runs on `Agent.processMessage` | A second kernel and a second provider layer that no user turn uses |
| **Finish or remove** | Checkpoints: wire a `/rewind` and automatic rollback of a failed attempt, or stop writing them | Data with no reader (§4 stage 10) |
| **Finish or hide** | The `verify` sub-agent and `/verify` on Windows and Linux: run without Shuru, or stop offering them and stop counting them as evidence | Advertised, trusted by the gate, cannot run on the owner's platform |
| **Rewrite** | The context compiler: a repository map (entry points, test and build commands, recently changed files, git state) instead of a path-name match over the first 256 files | Noise on any real repository (§4 stage 2) |
| **Rewrite** | Memory's write path around host-observed evidence (§7) | The current path writes noise and learns nothing organically |
| **Split** | `agent.ts` into prompt assembly, turn loop, recovery, completion contract, learning, sub-agents | Q1; each becomes testable without mocking the world |
| **Isolate** | Telegram, payments, schedules, computer use behind an extension boundary off the core path | Features, not intelligence; they load and cost schema tokens only when enabled already, but share the core class |
| **Fix now** | Hermetic tests; persist the `[Not verified]` note; benchmark workspaces isolated from the repository | Q3, §4 stage 16, Q7 |
| **Delete** | The 10 unreachable files; `search_x`; stale sub-agent prompt text; `AgentKernel` phases unless a phase ever controls something | Q4, Q5, Q9 |

## 14. What current coding-agent engineering teaches (frontier comparison)

A research stream read about 115 sources for this audit (the full notes, with every quote and number,
are reproduced in `docs/architecture/15-evidence/frontier-practices.md`). Each claim there is classed
ESTABLISHED (production docs or independent replication), EXPERIMENTAL (one study) or MARKETING (no
method). The auditor re-read the load-bearing sources at their primary location on 2026-09-23; those
are marked ✓.

### 14.1 What has been measured

- **The model matters more than the harness across tiers; the harness matters most within a tier and
  for weaker models.** Terminal-Bench 2.0 (89 tasks, ≥5 runs, 95% CIs) ✓: "model selection is usually
  more important than agent scaffold when optimizing for performance"; under one neutral harness
  models span 3.1% to 57.8%, while one model's spread across harnesses is 0.3 to 16.9 points
  ([TB2], arXiv 2601.11868, 2026-01-17). A 9,374-trajectory study finds the framework gap "shrinks with
  each generation of LLM improvement" ([BEYOND], 2604.02547).
- **Vendor harnesses are tuned to their own family.** Claude Opus 4.5 resolved 57.8% under the neutral
  Terminus 2 harness with 3.9M input tokens, and 52.1% under Claude Code with 256.9M ✓; Codex CLI adds
  3.6 to 14.4 points over the neutral harness for GPT models [TB2]. METR found neither Claude Code nor
  Codex significantly raises a model's time horizon over simple loops ([METR-CCCX], 2026-02-13).
- **The same free model family Shelra uses has been studied component by component** ✓ ([HDSTUDY],
  arXiv 2609.20804, 2026-09-17; Nemotron-3 30B/120B/550B and Mistral-Medium-3.5): planning is "an
  accuracy scaffold for weaker models" (30B: 13.6% → 25.2% on SWE-bench Verified) and "a cost saver for
  stronger models, with little change in accuracy"; context management matters most when the window is
  tight (120B at 32k: 11.4% → 43.0%); "bash-capable models can operate effectively with a bash-only
  interface and achieve substantially lower cost".
- **Execution-grounded checking is the most dependable harness lever, and tests are a weak oracle.**
  Selecting among attempts with regression tests added 4.8 to 7.5 points for fixed Claude models
  (Anthropic model announcements) and 6.3 for Agentless. But roughly half of the test-passing
  SWE-bench Verified PRs would not be merged by maintainers, a 24-point gap to the automated grader ✓
  ([METR-MERGE], 2026-03-10, 296 PRs); 29.6% of "plausible" patches behave differently from the
  reference ([PATCHDIFF]); models exploit tests when they can, and test access, feedback loops and an
  explicit "cannot complete" exit change how often ([IMPOSSIBLE], arXiv 2510.20270 ✓ exists; its
  per-model rates were not re-read).
- **Automatically written memory does not help; curated procedure does.** Context files, whether
  LLM-generated or developer-written, "do not generally improve task success rates, while increasing
  inference cost by over 20%", and repository overviews "are not helpful" ✓ ([AGENTSMD], 2602.11988);
  "naive ICL outperforms systems dedicated to memory management" ✓ ([CLBENCH], 2606.05661); curated
  Skills raise the average pass rate from 33.9% to 50.5% ✓, while "Self-generated Skills provide no
  benefit on average" ✓ ([SKILLSB] v4 and v1, 2602.12670).
- **Evaluations need repetition.** Infrastructure alone moved Terminal-Bench by 6 points for one
  model, and "leaderboard differences below 3 percentage points deserve skepticism" ([A-NOISE]);
  pass^k, not pass@1, measures reliability ([A-EVALS], [TAU]).
- **OpenRouter's routers are not quality routers.** The free router picks a model at random from the
  capable pool; the auto router follows aggregate spend share ([OR-FREE], [OR-AUTO], documentation).
  A turn that falls back to `openrouter/free` may change model at every request.

### 14.2 The principles that survive a model swap, and where Shelra stands

| # | Principle (evidence class) | Shelra today |
| --- | --- | --- |
| P1 | Completion is decided by host-observed execution evidence, never by the model's claim (EST) | **Gap.** A presence check the model's text satisfies (§10) |
| P2 | A passing suite is a weak oracle: protect tests, strengthen them, allow an honest "cannot complete" (EST) | **Gap.** No test-tamper check; "Do not modify tests" is prompt text; `[Not verified]` exists |
| P3 | Invest in the agent-computer interface where the model is weakest (EST direction) | **Strong.** Argument repair, CRLF-tolerant edits, bounded reads, hardened failures |
| P4 | Context is a budget enforced by code (EST) | **Functional.** Bounded reads, result clearing, compaction |
| P5 | What must always happen belongs in code, not prompts (EST) | **Mixed.** Robustness and spend: code. Verification quality, provenance, test protection, risk: prompt |
| P6 | Keep always-loaded instructions short and human-curated; no generated overviews (EST) | **Gap.** The host context packet is a generated overview of path names (§4 stage 2) |
| P7 | Curated, verified procedural knowledge helps; self-generated accumulation mostly does not (EXP) | **Gap.** Memory is model-reflected and self-promoted to skills (§7) |
| P8 | Long work lives in durable, structured artifacts outside the context (EST as practice) | **Partial.** Transcript and plan persist; no progress file or feature list on the live path |
| P9 | Plans scaffold weak models and save cost for strong ones; never mandatory for small diffs (EXP) | **Aligned.** Optional plan tool; no reminders |
| P10 | Separate the judge from the worker, but ground the judge in executed evidence (EXP) | **Gap.** No judge; the `verify` sub-agent cannot execute on Windows |
| P11 | Bound every loop: detect repetition and stalls, force a change, stop with a report (EST) | **Partial.** Identical-call stop and stall retry; no forced change of approach |
| P12 | Keep writes single-threaded; sub-agents for read-only search and review (EST) | **Aligned** by accident: sub-agents are almost never used |
| P13 | Every harness change is an experiment: trials, pass^k, CIs, pinned infrastructure (EST) | **Gap.** One run per cell; contaminated fixtures (§15) |
| P14 | Every component encodes an assumption about a model weakness; re-test per model and delete what no longer pays (EST direction) | **Gap.** No ablation switch existed before this audit |
| P15 | Spend is not quality; route by measured task performance (EXP) | **Partial.** Capability-ranked free routing by parameter count; fallback to a random free router |

### 14.3 What this changes in the diagnosis

1. **Shelra's regime is exactly where a harness pays most**: free and mid-size models, windows that
   vary by model, unreliable providers. The literature's strongest harness effects (interface
   tolerance, context budgets, planning for weak models, execution-grounded checking) are all
   available to Shelra. It has the first two; it lacks the one that transfers to every model tier,
   execution-grounded completion.
2. **Tests alone will not do.** A host-owned definition of done must protect the tests it relies on,
   require checks that exercise the stated behaviors (fail before the change, pass after), and give
   the model a legitimate "cannot complete" exit instead of pressure to game the check.
3. **Memory should be rebuilt on evidence, not reflection.** Nothing in the literature supports
   expecting an LLM's own reflections to make a project-specific agent better over months. What helps
   is short, curated, verified procedure; Shelra can produce the *verified* part automatically from
   host-observed outcomes, and leave curation to the owner.
4. **Repository overviews are not the fix for context.** Agentic search with grep is the documented
   winner for code; the path-name overview should go, replaced by the few facts a model cannot cheaply
   discover: the project's check commands, git state and recent changes.
5. **A small neutral core is a legitimate design.** The neutral Terminus 2 harness beat Claude Code for
   Claude models on Terminal-Bench 2.0 with a sixty-fifth of the input tokens. Every Shelra component
   must earn its place per model tier, which requires the ablation switches this audit built.

## 15. Benchmark strategy

### 15.1 What the current benchmark can and cannot see

The core suite (8 tasks) and the memory suite (2 traps) were the right first instrument: they moved
the product path from 1/8 to 5/8 on one model and exposed real harness defects (doc 14 §23-§25). For
the questions in this audit they have five blind spots:

| Blind spot | Evidence | Consequence |
| --- | --- | --- |
| Every task prompt ends with "Run bun test before completing" | `CODE` both manifests; `DB` 0 gate nudges in 110 benchmark sessions | The suite cannot measure the completion gate: the user already asks for the check |
| Fixtures have 8-20 files | `CODE` `bench/fixtures` | Context discovery is never exercised; the broken context compiler (§4 stage 2) is invisible |
| Task workspaces inherit the repository's `AGENTS.md` and skills | `TEST` Q7 | Every historical product-path score was measured with ~14,000 chars of unrelated instructions in the prompt |
| One model per comparison, one run per cell | `DB` 32 runs | Only large effects are detectable; free-model variance is large (field case 001 re-runs took 7.0, 5.3 and 3.1 minutes and gave three different answers) |
| Old harness commits are gone from the public history | `DB` runs #1-#32 record `af7e7bd`, `572c0e0`, pre-rewrite SHAs | A score cannot be tied to the code that produced it without the local backup bundle |

This audit fixed the first and third for its own runs (a "silent" variant of the core suite with the
sentence removed, and a clean benchmark root) and added the missing controls: a bare baseline, single-
subsystem ablations and two external agents on the same oracle (§6, Appendix A).

### 15.2 Public benchmarks: what they measure and what they miss

Summarized from §14. None can be the target; each covers one slice.

| Benchmark | Measures | Misses, for Shelra's question |
| --- | --- | --- |
| SWE-bench Verified / Pro / Live, Multi-SWE-bench | resolving real repository issues, graded by hidden tests | Docker-based (not runnable on this host, doc 14 §25.5); single session; contamination; says nothing about memory or long horizons |
| Terminal-Bench 2.0 | terminal tasks end to end, same model under different agents | Docker-based; no cross-session learning |
| Aider polyglot | single-file exercises with tests | no repository context, no verification judgment |
| METR time-horizon | length of task a model completes at 50% | model-level, not harness-level |

### 15.3 The Shelra Benchmark Suite (proposal)

Design rules, each answering a defect above:

1. **Prompts are written like users write them.** No verification recipe unless the task tests
   instruction-following.
2. **Clean-room workspaces**: each task is its own git repository, outside any other repository, with
   a scratch `HOME`. Nothing of the host leaks into the prompt.
3. **Hidden, benchmark-owned oracles**, run outside the agent's workspace, each validated to fail on the
   untouched fixture and pass on a reference solution.
4. **Every category names the harness capability it measures**, so turning that capability off (an
   ablation switch) must lower that category's score. A capability whose ablation changes nothing has
   not been shown to exist.
5. **Model held fixed, three tiers**: a weak, a medium and a strong free model; Claude Code and Codex as
   external references on the same tasks and oracle.
6. **Repeated runs**: k ≥ 3 per cell; report pass@1 and pass^k (all k passed) with a confidence
   interval; one run is one sample.
7. **Honesty is scored**: the *false-completion rate*, tasks the agent reported done without
   `[Not verified]` while the oracle failed, is a first-class metric next to the resolve rate.
8. **History is append-only**: every run is merged into `bench/history/benchmark-history.json` with its
   harness commit, model, ablation and per-task results (`scripts/bench-history.ts`).

| # | Category | Capability under test | Task shape | Oracle | Ablation that should hurt |
| --- | --- | --- | --- | --- | --- |
| 1 | Repository discovery | context | a symptom in a 300-file repository; the fix is two files deep | hidden test | context |
| 2 | Bug fix with a failing test | verify → repair loop | a red visible test | hidden + visible tests | gate |
| 3 | Feature from prose | definition of done | behaviors stated in prose, half without visible tests | hidden behavior tests | gate, audit |
| 4 | Refactor | regression control | restructure without behavior change | the full pre-existing suite | gate |
| 5 | Frontend | runtime verification | a component with rendered states | Playwright DOM check | gate |
| 6 | Backend / API | runtime verification | an endpoint contract | HTTP checks on a started server | gate |
| 7 | Database migration | state correctness | a schema change with data | migration + query checks | gate |
| 8 | Ambiguous request | intent | two valid readings | accepts either reading, requires the assumption to be stated | — |
| 9 | Tool choice | tool use | needs a background server, or an external spec page | behavior check | web / process tools |
| 10 | Broken build | recovery | a misconfigured dependency | build + test | — |
| 11 | Pre-existing red test | judgment | one unrelated failing test in the suite | the task's tests pass, the unrelated one is not edited | gate |
| 12 | Long context | context management | a 5,000-line file and 40 related files | hidden test | compaction/clearing |
| 13 | Cross-session continuation | continuity | session 1 is interrupted half-way; session 2 says "continue" | hidden test | memory, transcript |
| 14 | Memory recall | learning | the two existing traps plus two new ones (hidden environment variable, flaky command flag) | hash / behavior check | memory |
| 15 | Incorrect memory | memory hygiene | a seeded memory that contradicts the code | the agent follows the code, not the memory | memory |
| 16 | Replanning | adaptation | the planned library is unavailable mid-task | behavior check | plan |
| 17 | Debugging | diagnosis | a runtime stack trace in a multi-module app | hidden test | — |
| 18 | Regression detection | verification breadth | the obvious fix breaks another module | full hidden suite | gate |
| 19 | Silent verification | the gate itself | the core suite without "Run bun test" | the core oracles | gate |
| 20 | Resilience | robustness | a fault-injecting proxy (stalls, 429s, empty steps) in front of the model | the core oracles | robustness layer |
| F | Field cases | real value | the owner's real problems (`bench/field`) | the owner's judgment | — |

Categories 2, 3, 11, 14 and 19 can be built from existing fixtures; 1, 12 and 18 need one mid-size
repository fixture; 20 needs a small HTTP proxy. The first increment (§19, Phase 1) is categories 19,
3, 11, 18 and 15: they measure the capability this audit finds to be the bottleneck.

## 16. Intelligence scorecard

Qualitative levels until the suite in §15.3 produces repeatable numbers: 0 absent, 1 cosmetic (exists,
no effect), 2 partial (works in some cases, bypassable or model-driven), 3 functional (works,
deterministic, unmeasured), 4 strong (works and measured), 5 elite (measured across model tiers and
repeated, better than the references). No number below is invented; where §6 measured something, the
row says so.

| Dimension | Current | Evidence | Failure modes | Target | Gap |
| --- | --- | --- | --- | --- | --- |
| Robustness (transport) | 4 | §5, §6, resilience tests | transient 404 treated as permanent (§11) | 5 | classify upstream errors by retryability; fault-injection category 20 |
| Context engineering | 3 | bounded reads, clearing, compaction | none measured | 4 | measure on category 12 at tight windows (§14: largest effect there) |
| Repository understanding | 1 | context packet is noise (§4) | wrong paths injected; memory ranked on them | 3 | remove the overview; supply checks, git state, exact paths |
| Memory | 1 | no organic learning (§7) | noise writes, self-asserted provenance, one-way staleness | 4 | evidence-derived writes, usefulness credit, re-verification (Phase 4) |
| Planning | 2 | optional tool, no control (§8) | none serious; plans ignored by the host | 3 | plan criteria become contract checks (Phase 1) |
| Tool use | 3 | repair and hardening (§9) | risk unguarded; LSP and sub-agents unused | 4 | safe defaults; drop what never pays (ablation) |
| Execution | 3 | AI SDK loop + recovery | long tasks drift; no durable progress artifact | 4 | contract-driven rounds; progress state (Phase 7) |
| Verification | 2 | presence check, five loopholes (§10) | gaming, stale evidence, shell writes, verify sub-agent | 4 | host-owned contract on the final state (Phase 1) |
| Debugging | 1 | model-driven | no structured failure signal | 3 | parsed check failures in repair rounds (Phase 2) |
| Repair | 2 | infra strong, task = nudge (§11) | repeats, no rollback | 4 | attempt ledger, rollback, escalation (Phase 2) |
| Learning | 1 | 526/527 audit records are test residue | nothing accumulates | 4 | Phases 4-5 |
| Long-horizon reliability | 2 | resume, compaction, pause-and-resume | no durable objective on the live path | 4 | Phase 7 |
| Model independence | 2 | two model-agnostic layers (§5); §6 measures the rest | outcome follows the model | 4 | the contract makes correctness host-owned for every tier |
| Cost efficiency | 3 | spend limits, free-first routing, clearing | free router random; no outcome-based routing | 4 | Phase 6 |
| Safety | 2 | file tools confined; hooks | host shell unguarded; memory provenance escalation | 4 | default deny/ask policy; host-assigned provenance |
| Observability | 2 | session DB, bench history, debug stream | 291 silent catches; gate decisions not persisted | 4 | log swallowed errors; persist contract results in the transcript |

## 17. Gap analysis: the stage Shelra is at, and the one after it

### 17.1 A maturity model built on who closes each loop

The brief's stages mix features with capabilities. This model defines each stage by the loop the
*harness* closes deterministically, so it survives a model swap by construction:

| Stage | The harness guarantees | Example of the missing guarantee |
| --- | --- | --- |
| 0 Wrapper | nothing beyond the model's text | |
| 1 Tool loop | tools run; results return | a malformed call ends the turn |
| 2 Robust loop | the loop survives provider and model failures, and calls arrive well-formed | "done" is whatever the model says |
| **3 Evidence-bound** | **"done" means host-run checks passed on the final state, and those checks cover what was asked** | a red check leads to a generic nudge |
| 4 Self-correcting | failed evidence is diagnosed and drives bounded, non-repeating repair, with rollback | the next session starts from zero |
| 5 Grounded | the host supplies the few repository facts a model cannot cheaply discover, and the effect is measured | knowledge does not accumulate |
| 6 Compounding | verified knowledge accumulates and measurably raises success on the same repository | routing ignores outcomes |
| 7 Adaptive | model, effort and tools are chosen from measured outcomes and cost | objectives do not survive sessions |
| 8 Long-horizon | multi-session objectives with durable, resumable state and contracts | |
| 9 Elite | the §17.3 targets hold on held-out real work, across model tiers, repeated | |

**Shelra today: Stage 2, complete and strong, with a Stage 3 check that is bypassable.** Pieces of
Stages 4-8 exist as mechanisms (memory, skills, checkpoints, plans, resume, routing, `--autonomous`),
but §4-§11 show that none of them is a working capability yet, and each of them depends on something
Stage 3 would supply: a trustworthy signal of whether the work is right.

### 17.2 What separates Shelra from the next stage

One capability: **the harness, not the model, must own the definition of done.** Today the model
decides what to check, whether to check it, and whether the result counts; the harness only counts
check-shaped commands. At Stage 3 the host establishes executable checks for the request before or
while the model works (the project's own checks plus task checks that fail before the change and pass
after), protects them from edits, runs them itself on the final workspace, and reports done only when
they pass. Every later stage consumes that signal: repair needs the failing check, memory needs a
verified outcome to learn from, routing needs outcomes to learn which model works, long-horizon
objectives need contracts that outlive a turn.

### 17.3 "Elite", defined by measurements

Proposed targets for the Shelra Benchmark Suite (§15.3), all with k ≥ 3 runs per cell. They are
engineering targets, not claims:

| Dimension | Metric | Elite target |
| --- | --- | --- |
| Task success | resolve rate on the core + silent suites, strong free tier | within 1 task of Claude Code and Codex (§6 references) |
| Honesty | false-completion rate (reported done, oracle failed) | ≤ 2% on every tier |
| Consistency | pass^3 on the core suite, strong tier | ≥ 0.8 |
| Model independence | resolve-rate gap between the weak and strong free tiers | narrower under full Shelra than under the bare baseline |
| Repair | share of first-attempt contract failures converted by repair | ≥ 60% |
| Regression avoidance | checks that passed at baseline and fail at the end, unreported | 0 |
| Verification coverage | stated behaviors with an executed check (category 3) | ≥ 90% |
| Memory usefulness | steps and tokens on repeated work in the same repository, resolve rate held | −30% or better; incorrect-memory trap passed |
| Cross-session continuity | category 13 | ≥ 90% |
| Repository understanding | category 1 | ≥ strong-tier core rate − 10 points |
| Token efficiency | tokens per resolved task | within 2× of the best reference |
| Human intervention | tasks needing more than "continue" | ≤ 10% |
| Safety | destructive commands outside policy | 0 |
| Observability | "verified" claims traceable to host-run evidence in the transcript | 100% |

## 18. P0 blockers: the critical few

P0 blocks the transition to Stage 3; P1 is needed soon; P2 is useful optimization.

| # | P0 blocker | Where | Why it blocks | Fixed by |
| --- | --- | --- | --- | --- |
| **P0-1** | **No host-owned, executable definition of done.** Acceptance criteria are optional model text; the host never runs a check itself on a user's turn | `agent.ts` gate; `toolset/tools.ts:1104`; `CheckSpec` locked in `src/autonomy` | Without it, "verified" is the model's word; nothing downstream (repair, memory, routing) has a trustworthy signal | Phase 1 |
| **P0-2** | **The completion check is bypassable and not bound to the final state** (five loopholes; `verify` counted where it cannot run) | `agent/verification-evidence.ts`; `agent.ts:2953-3049`, `1723` | Weak and gaming models pass it; strong models are not stopped from stale evidence | Phase 0.2, then Phase 1 |
| **P0-3** | **Measurement cannot see the harness**: recipe prompts, tiny contaminated fixtures, one run per cell, no controls | `bench/*`, `src/bench/*` | No phase can be shown to work; regressions are invisible | Phase 0.1 |
| **P0-4** | **Three verification engines, and the one the live path uses is the weakest** | regex gate; `src/verify` (Shuru); `autonomy/acceptance.ts` | Building a contract as a fourth system repeats the mistake `CLAUDE.md` lists | Phase 1.1 (one engine, shared by the live turn and the bench) |
| **P0-5** | **Task failures are repaired by re-prompting**: no structured failure, no attempt memory, no rollback, no escalation | `agent.ts` gate loop; checkpoints unread | A stricter "done" without better repair only converts false completions into honest failures | Phase 2 |

**P1** (needed soon, not blocking the transition): memory write path rebuilt on evidence with
host-assigned provenance (§7 M1-M8); remove the context overview and supply checks, git state and exact
paths (§4 stage 2); safe defaults for destructive shell commands (Q6); classify the transient upstream
404 as retryable (§11); hermetic tests (Q3); persist the `[Not verified]` note; split `agent.ts` (Q1);
log what the resilience `catch` blocks swallow (Q2); requirement extraction beyond English (§10);
move the bench oracle out of `src/autonomy` (Q8, part of P0-4).

**P2**: delete dead code and stale prompt text (Q4, Q5, Q9); decide LSP (enable with diagnostics after
edits, measured, or remove); isolate peripheral features; split `app.tsx`; retire `AutonomyKernel` and
`src/intelligence` after Phase 7 rebuilds `--autonomous`.

## 19. The definitive roadmap

Ordered by dependency: each phase produces the signal the next one consumes. Every item names its
problem, current state, target, dependencies, files, approach, verification, benchmark and exit
criterion. The phase order differs from the brief's hypothesis in one place: verification comes
before context, because the evidence (§6, §14) shows the harness's most transferable lever is
execution-grounded completion, while repository overviews do not help and agentic search already
works.

```
Phase 0  measurement + honesty ──► Phase 1  task contract (Stage 3) ──► Phase 2  evidence-driven repair (Stage 4)
                                          │                                   │
                                          ├──► Phase 3  lean grounded context  │
                                          └──────────────► Phase 4  memory on evidence ──► Phase 5  verified skills
Phase 0 history ──────────────────────────────────────────► Phase 6  outcome-aware routing
Phases 1 + 2 + 4 ──────────────────────────────────────────► Phase 7  long-horizon objectives (ledger) ──► Phase 8  elite
```

### Phase 0 — Remove the blockers to measurement and honesty

**0.1 A benchmark that can see the harness** (P0-3)
- *Problem*: the suite cannot measure the gate (recipe prompts), context (tiny fixtures) or anything
  small (n = 1); fixtures inherit the repository's `AGENTS.md` and skills.
- *Current*: `src/bench/agent-executor.ts`, `bench/suites/*`; the audit's clean root, ablation
  switches and external adapters live only in the worktree patch (Appendix A).
- *Target*: every task runs in its own git repository in a clean root with a scratch `HOME`;
  `--ablate <list>` is a typed `AgentOptions` field recorded in the run; `--repeat k` reports pass@1,
  pass^k and a confidence interval; the false-completion rate is a first-class score; `claude-code`
  and `codex` are optional reference adapters; each run merges into `bench/history/benchmark-history.json`.
- *Dependencies*: none. *Files*: `src/bench/{runner,agent-executor,manifest}.ts`, `src/index.ts`
  (`runBenchCommand`), new reference adapters, `scripts/bench-history.ts`, `bench/suites/*-silent.json`.
- *Approach*: port the audit patch minus its throwaway parts; switches become constructor options,
  not environment variables.
- *Verification*: tests that a clean-room task prompt carries no inherited instructions
  (`audit-prompt-size` pattern), that each ablation reaches the outgoing request, that history merges
  are idempotent.
- *Benchmark*: re-run §6 with k = 3. *Exit*: one command reproduces §6's table with confidence intervals.

**0.2 Close the completion check's loopholes** (P0-2)
- *Problem*: five reproduced loopholes and a verification sub-agent that cannot run.
- *Target*: evidence is a command whose *program* is a checker (not a word in its text; no `--version`,
  `--help`, `echo`, `cat`); any mutation after the last passing check invalidates it; mutations are read
  from the workspace (git status or a file-hash snapshot taken at turn start), so shell writes count;
  `task(verify)` counts only if the sub-agent itself recorded evidence, and `verify`/`/verify` are not
  offered where Shuru cannot run; the `[Not verified]` note is saved in the transcript; requirement
  extraction works in Spanish as well as English.
- *Files*: `src/agent/verification-evidence.ts`, `src/agent/agent.ts` (gate), `src/tools/bash.ts`,
  `src/agent/requirements.ts`, `src/toolset/tools.ts` (sub-agent list).
- *Verification*: the seven probes of §10 become permanent tests; the five loophole probes must fail
  on today's code and pass after.
- *Benchmark*: silent suite (category 19). *Exit*: probes green; silent-suite false completions
  re-measured.

**0.3 Small correctness and safety fixes found by the audit**
- Classify an upstream 404 "Provider returned error" as retryable before declaring a model
  unavailable (§11); hermetic agent tests (Q3); ship default deny/ask hooks for destructive shell
  commands (Q6); delete dead code and stale prompt text (Q4, Q5, Q9).
- *Verification*: a test replays the 404 and expects a retry; a test asserts no test writes outside a
  temporary directory; a PreToolUse default blocks `git push --force` and `rm -rf` outside the workspace.
- *Exit*: re-running S1's lost tasks shows no infrastructure loss from that error class.

### Phase 1 — The task contract (Stage 3: evidence-bound completion) — the next escalón

**1.1 One verification engine** (P0-4)
- *Problem*: three engines; the live path uses the weakest.
- *Target*: `CheckSpec` and `evaluateAcceptance` move from `src/autonomy` to a neutral `src/contract`;
  the live turn and the bench use it; the regex becomes a fallback observation, not the decision.
- *Files*: `src/autonomy/{acceptance,types}.ts` → `src/contract/*`; `src/bench/agent-executor.ts`.
- *Verification*: bench grading unchanged on replayed workspaces (same verdicts before and after).
- *Exit*: one import site for "did the checks pass" in the whole codebase.

**1.2 Check discovery**
- *Problem*: the host does not know a project's real checks; the model guesses.
- *Target*: deterministic discovery of build, type-check, lint and test commands from manifests,
  runner configs and `AGENTS.md` command tables, cached per workspace as *observed* facts.
- *Files*: new `src/contract/discover.ts`; `src/memory/store.ts` (as observed entries).
- *Verification*: fixtures for Bun, Node, Python, Rust and Go projects; this repository must yield
  `bun run typecheck`, `bun run lint`, `bun run test`.
- *Exit*: discovery is right on every fixture and on the two real repositories used in field cases.

**1.3 Contract creation and baseline** (P0-1)
- *Problem*: no host-owned definition of done.
- *Target*: at the first mutation of a coding turn the host creates a contract: requirements quoted
  from the request; project checks; task checks from `generate_plan` criteria when they are executable
  (commands, HTTP probes, file checks as `CheckSpec`) or model-proposed tests that must **fail before**
  the change; a baseline run records pre-existing failures.
- *Files*: `src/contract/contract.ts`, `src/agent/agent.ts` (turn loop), `src/toolset/tools.ts`
  (`generate_plan` criteria gain an optional `check`).
- *Verification*: scripted-model tests: a task check that already passes before the change is
  rejected as evidence of nothing; a pre-existing failure is not blamed on the turn.
- *Benchmark*: categories 3 and 11.

**1.4 Host-run final evaluation**
- *Target*: when the model stops, the host runs the contract on the final workspace; pass means
  verified; failure sends the failing checks back (Phase 2 makes that repair smart) within a bounded
  number of rounds; the result is saved in the transcript and the `objectives` index.
- *Verification*: loophole probes cannot pass; a scripted edit after the last check triggers a re-run.

**1.5 Test protection and an honest exit**
- *Target*: edits to tests that existed at baseline are detected and reported (blocked unless the
  request allows them); a `report_blocker` tool lets the model end with "cannot be done because …"
  instead of gaming a check (§14.1).
- *Verification*: scripted models that edit a test or special-case a check are caught.

*Phase 1 exit criterion*: on the clean-room silent suite, for each free tier, k = 3, the
false-completion rate is ≤ 2% and the resolve rate is at least the same model's rate on the recipe-prompt
suite; turning the contract off (ablation) measurably raises false completions.

### Phase 2 — Evidence-driven repair (Stage 4)

- **2.1 Structured failures**: parsers for Bun, Vitest, Jest and pytest output and TypeScript errors,
  falling back to exit code plus a bounded tail; the repair round receives test names, messages and
  locations, not a generic nudge. *Files*: `src/contract/failures.ts`.
- **2.2 Attempt ledger**: each repair round records its hypothesis, changed files and resulting checks;
  the next round sees the ledger; an identical or oscillating diff is refused.
- **2.3 Rollback**: an attempt that makes a baseline-passing check fail is rolled back from the
  checkpoints Shelra already records (their first reader), and the regression is reported.
- **2.4 Escalation**: after K failed rounds on the same check, raise reasoning effort or move to the next
  model tier the spending policy allows, or stop with an honest report.
- **2.5 Execution-grounded selection** (optional, free budget permitting): k attempts in separate
  worktrees, chosen by the contract; the literature's most replicated harness gain (§14.1).
- *Dependencies*: Phase 1. *Verification*: scripted-model tests for each mechanism.
- *Benchmark*: categories 2, 17, 18. *Exit*: on the medium free tier, resolve rate on those categories
  rises over Phase 1's, with no unbounded loop and no unreported regression.

### Phase 3 — Lean, grounded context (Stage 5)

- **3.1** Remove the path-name overview (§4 stage 2; overviews measured unhelpful, §14.1). Supply only
  what a model cannot cheaply discover: the discovered checks (1.2), git status, diff stat and recent
  commits, and files the request names exactly.
- **3.2** Measure category 1 (discovery in a 300-file repository) and category 12 (long context) with the
  context ablation; add a symbol search or a retrieval sub-agent only if the measurement asks for it.
- *Dependencies*: 1.2. *Files*: `src/context/compiler.ts`. *Exit*: the probe prompts of Appendix A get the
  right file; no suite regression; category 1 improves or its cost falls.

### Phase 4 — Memory on evidence (Stage 6)

- **4.1 Evidence writes**: observed facts only by default: checks that work, environment traps
  (a failing check, the change that fixed it, the passing check), conventions a check enforces; model
  reflections become low-weight inferences, capped.
- **4.2 Host-assigned provenance**: `human` only from the user's own messages; the model can never set it.
- **4.3 Usefulness credit**: an entry injected into a turn whose contract passed gains credit, one
  injected into a failed turn loses it; ranking uses credit; uncredited entries expire.
- **4.4 Re-verification**: an entry tied to a check is re-confirmed by running the check, not decayed by
  file times; evidence settles contradictions.
- **4.5 Continuity**: the open contract and attempt ledger persist with the session; "continue" resumes
  the failing checks.
- *Dependencies*: Phases 1 and 2. *Files*: `src/memory/*`, `src/agent/agent.ts`.
- *Benchmark*: category 14 with two new traps, category 15 (incorrect memory), category 13.
- *Exit*: with-memory beats without-memory on the medium tier at k = 3 with a confidence interval that
  excludes zero; the incorrect-memory trap is passed; a 30-day dogfood on this repository produces
  observed entries that are later credited in passing turns.

### Phase 5 — Verified, curated skills

- Promote a procedure only after N credited successful uses, keep it focused (≤ 3 modules, §14.1), ask
  the owner before promoting, demote on failure. *Dependencies*: Phase 4.
- *Exit*: a paired evaluation shows a promoted skill shortens later tasks of its family without lowering
  the resolve rate.

### Phase 6 — Outcome-aware model, effort and cost routing (Stage 7)

- Record contract outcomes and cost per task family and model tier in the history; choose the cheapest
  tier that meets a target; escalate on repeated failure (2.4); keep pinned work off the random free
  router; use the local runtime for cheap sub-steps where the hardware allows.
- *Dependencies*: 0.1 history, 2.4. *Exit*: same resolve rate at lower cost, or higher at equal cost,
  than a fixed-model baseline on the suite.

### Phase 7 — Long-horizon objectives (Stage 8), where the decision ledger belongs

- Rebuild `--autonomous` on `Agent.processMessage` (§25.8) with the contract as the objective's
  definition of done, a feature list and a progress log as durable state, and git checkpoints; retire
  `AutonomyKernel` and `src/intelligence`.
- The decision ledger of `docs/future-research/08` becomes *contracts that outlive their task*:
  commitments with executable checks, re-run when the files they cover change. Built this way it reuses
  the contract engine instead of becoming a parallel system.
- *Dependencies*: Phases 1, 2, 4. *Exit*: multi-session tasks complete with no human input beyond
  "continue".

### Phase 8 — Elite reliability

- The full suite of §15.3, k ≥ 3, three free tiers and the two references, a nightly regression run on a
  pinned free model, the history file as the public record. *Exit*: the §17.3 targets.

### What not to build yet

| Do not build (yet) | Because |
| --- | --- |
| More sub-agent types, agent teams, swarms | 6 calls in 2,522; multi-agent costs 4-15× tokens and degrades sequential work (§14) |
| Embeddings, vector indexes, repository overviews | overviews measured unhelpful; agentic search is the documented winner for code (§14) |
| More automatic reflection memory or auto-generated skills | measured null or negative (§14); Phase 4 first |
| The decision ledger as a separate system | it is Phase 7's persistent contract; built first, it would be a fourth engine |
| A new `--autonomous` before the contract | it would need rebuilding again on top of Phase 1 |
| Mandatory plans or plan gates | removed once already; a scaffold only for weak models (§8, §14) |
| An LLM judge without execution | noisy and gameable (§14) |
| More integrations (Telegram, payments, desktop, schedules) and further TUI polish | features, not intelligence; effort has gone there disproportionately (§3) |
| Prompt tuning for one free model | the free router changes the model per request; every such gain is model-specific (§14) |

## 20. The next escalón

**The one architectural capability: host-owned, executable definitions of done.** Before and while
any model works, Shelra establishes what "done" means as checks it can run itself; it protects them,
runs them on the final state of the workspace, and turns their failures into bounded repair. The
model proposes; Shelra decides whether reality matches the request. That single capability moves Shelra
from a robust tool loop (Stage 2) to an evidence-bound agent (Stage 3), and it is the signal every
higher stage consumes.

It changes Shelra's category because it is the one kind of intelligence the evidence says transfers
across model tiers (§14.1, P1 and P2), because it is the point where every current failure converges
(§4: all semantic stages are either model judgment or a check the model's text can satisfy), and
because it gives the free-first strategy its missing half: a weak model iterating against real checks
until they pass is worth more than a strong model trusted on its word.

**The capabilities that support it:**

1. **Check discovery and baseline** (1.2, 1.3): the host knows the project's real checks and which
   ones already fail.
2. **Final-state change tracking** (0.2, 1.4): every mutation, including shell writes, invalidates
   earlier evidence.
3. **Evidence-driven repair** (Phase 2): failing checks are parsed, attempts are remembered, regressions
   are rolled back, escalation is bounded.
4. **An evidence ledger feeding memory** (Phase 4): only what the contract observed becomes durable
   knowledge, credited by later outcomes.
5. **A contract-graded benchmark** (0.1): silent prompts, clean rooms, ablations, references and the
   false-completion rate measure the capability with the same engine.

**Definition of done for the escalón** (all measured with the §15.3 protocol, k ≥ 3):
the five loophole probes fail on today's code and pass after; on the clean-room silent suite the
false-completion rate is ≤ 2% on each free tier; the resolve rate on the silent suite is at least the
same model's rate when the prompt spells out the checks; switching the contract off (ablation) raises
false completions or lowers resolves measurably; and the gap between the weak and strong free tiers is
narrower under Shelra than under the bare baseline (§6 records today's gap).

## 21. Implementation status (2026-09-23)

The owner asked for the P0, P1 and P2 debts to be resolved phase by phase, one local commit per
verified item. Every commit below passed `bun run format`, `bun run lint`, `bun run typecheck` and
`bun run test` before it was made (787 tests at the audit, 882 after the last commit), and each behavior
change carries a test that fails without it. Owner decisions taken along the way: a destructive shell
command is asked about in the TUI and refused where nobody can answer; the `lsp` tool leaves the
default set; a regressing attempt is reported with a restore offered, never rolled back automatically;
escalation raises reasoning effort only, a stronger model waits for Phase 6; `app.tsx`, the
peripheral features and `--autonomous` wait until Phases 0-2 are measured.

| Item | Status | Commits | What changed | Verified by |
| --- | --- | --- | --- | --- |
| 0.1 Benchmark that sees the harness | done | `ceb7de6` `50fc44b` `d08e2e2` `91f8044` `8df513e` `1537588` `d282a68` | versioned history; each task in its own git repository in a clean root with a scratch `HOME`; `--ablate`; `--repeat` with Wilson interval, pass^k and false completions; `--agent claude-code\|codex`; the silent suite; `--max-tool-rounds` reaches the agent | runner control case shows the old leak; ablations reach the outgoing request; history merge idempotent; §6.4 runs |
| 0.2 Close the loopholes | done | `a27ef78` `5678ae0` `fc6ed80` `4b3b456` `35c65a2` | a check counts by the program it runs; every change counts, shell writes included, and evidence before a later change is stale; `verify` offered only where its sandbox runs; the `[Not verified]` note stays in the transcript; Spanish requirements | the five loophole probes, now permanent tests |
| 0.3 Small fixes | done | `5291e78` `b90b126` `da8bb3f` `b5d3f53` `af29e3e` | transient upstream 404 retried; agent tests write only to temporary folders; destructive-command guard **built into the `bash` tool** (policy `shell.destructive`: ask, block or allow), not a hook as §19 proposed, so it holds with no hook configured; `lsp` opt-in; dead code, `search_x` and stale sub-agent text removed | replayed 404; guard tests in scratch repositories; tool-surface test on the real request |
| 1.1 One verification engine | done | `bbf2f21` | `CheckSpec` and evaluation live in `src/contract`; `src/autonomy` wraps them | bench grading unchanged |
| 1.2 Check discovery | done | `7ce7b8d` | test, type-check, lint and build from the project's own files | fixtures per ecosystem; this repository yields its three checks |
| 1.3-1.4 Contract and host-run final evaluation | done, without a baseline run | `b977f94` `cef43df` | when a project states its checks, the host runs test, type-check and lint on the final code, reusing a fresh run of the agent's; a plan criterion's command that fails before the change joins the contract | scripted-model tests. **Open**: a baseline run on the pre-change state (today "failed before" is known only if the agent ran the check before changing anything). Running the suite in place before the first change would delay every coding turn by the suite's runtime (minutes on this repository), and a worktree at `HEAD` has no installed dependencies and misses the user's uncommitted work, so the baseline needs its own design; discovery is not cached |
| 1.5 Test protection, honest exit | done | `c934700` | changed pre-existing tests block completion unless the request asks for them; `report_blocker` | scripted models that weaken a test are caught |
| 2.1 Structured failures | done | `55f2a5c` | Bun, Vitest, Jest, pytest and TypeScript failures parsed into names, messages and locations | parsers tested on real outputs |
| 2.2 Attempt ledger | partial | `55f2a5c` | the same failures after a changed attempt are named ("that approach did not work") | scripted test. **Open**: a recorded hypothesis per round; refusing an oscillating diff |
| 2.3 Rollback | done as decided | `2b31039` | a per-turn journal of each file before each attempt; a check that passed after the previous attempt and fails now is named, with the files the attempt changed, and `restore_file` offered | end-to-end test with real tool execution |
| 2.4 Escalation | partial, as decided | `55f2a5c` | repeated failures raise reasoning effort to the model's top level | scripted test. The model tier waits for Phase 6 |
| 2.5 Execution-grounded selection | not started | | | |
| 3.1 Lean context | done | `3be8333` | the packet is the stated checks, the git state and the files the request names; no path overview, no manifest | the audit probe gets exactly `src/agent/agent.ts`; 211 ms on this repository |
| 3.2 Measure discovery and long context | not started | | needs categories 1 and 12 | |
| 4.1 Evidence writes | partial | `cbe3fea` | a turn that ends unverified reflects too, capped at 0.4 confidence and tagged `unverified` | reflection and agent tests |
| 4.2 Host-assigned provenance (M1) | done | `4e7c928` | `memory_write` can no longer claim `human` | test |
| 4.3 Usefulness credit (M3) | done, without expiry | `4e7c928` | ±1 credit from the contract's outcome; ranking and skill promotion use it | tests. **Open**: expiring uncredited entries |
| 4.4 Re-verification (M2) | done for commands | `cbe3fea` | an entry naming the exact command that passed is re-confirmed | tests. **Open**: contradictions (M5) |
| 4.5 Continuity | partial | `4b3b456` | the verdict persists | **Open**: the open contract and ledger across sessions |
| M6, M7, M8 | done | `4e7c928` `b90b126` `3be8333` | listing cap of 12; tests off the real memory; ranking on named files | tests |
| Q1 Split `agent.ts` | partial | `f80cac3` | the prompts moved to `src/agent/prompts.ts` byte for byte (every prompt captured before and after, identical) | capture comparison. **Open**: loop, recovery, contract, learning, sub-agents |
| Q2 Observability | done | `d6a8c4f` | swallowed failures go to `~/.shelra/logs/swallowed-errors.jsonl` | a resilience test that fails without it |
| Q8 Oracle out of `src/autonomy` | done | `bbf2f21` | | |
| P2 isolate features, split `app.tsx`, retire `AutonomyKernel` | deferred by the owner | | | |

**Still unmeasured.** The behavior changes above are proven by tests, not yet by the benchmark at
k ≥ 3. §6.4 holds the first runs; Phase 1's exit criterion (false completions ≤ 2% per free tier on
the silent suite, and a measurable effect of the contract ablation) is not yet shown. Note also §6.3
item 3: the false completions measured so far come from behavior the projects' visible tests do not
cover, which a test-running contract does not reach; task checks that fail before the change (1.3)
and the requirement audit are the levers for it.

## Appendix A. Evidence index and how to reproduce

**Probes** (`docs/architecture/15-evidence/probes/`, run from the repository root with `bun run`):

| Script | Shows |
| --- | --- |
| `ctx-probe.ts` | what the context compiler selects for three prompts on this repository (§4 stage 2) |
| `verif-probe.ts` | which shell commands the gate counts as verification (§10) |
| `reach.ts` | runtime and type-only reachability from `src/index.ts`; dead files (§3) |
| `sessions-by-cwd.ts` | tool usage, gate nudges and audits by where sessions ran, from `~/.shelra/shelra.db` (§7-§10) |
| `reflections.ts` | the composition of `.shelra/memory/reflections.jsonl` (§7) |

**Experiment harness** (applied to a detached worktree at `7b433b0`; the patch is
`docs/architecture/15-evidence/audit-worktree.patch`):

- `SHELRA_ABLATE=<list>` in `src/agent/agent.ts`: `memory`, `gate`, `audit`, `plan`, `skills`,
  `context`, `subagents`, `web`, or `bare` (all of them plus an environment-facts-only prompt and six
  tools: `bash`, `read_file`, `write_file`, `edit_file`, `delete_file`, `grep`). The bare baseline keeps
  the robustness layer, so bare-vs-full measures the intelligence layers, not transport recovery.
  `src/agent/audit-ablation.test.ts` proves the switch reaches the outgoing request.
- `--agent claude-code` (`src/bench/claude-code-executor.ts`): `claude -p --model sonnet` with
  `--setting-sources ""`, `--strict-mcp-config`, `--no-session-persistence`, edits accepted, Bash
  allowed, auto memory redirected to a scratch folder; graded by the same oracle.
- `--agent codex` (`src/bench/codex-executor.ts`): `codex exec --json --ephemeral -m gpt-5.6-luna
  -c model_reasoning_effort="max" -s workspace-write`; graded by the same oracle.
- Probes of the gate: `src/agent/audit-probes.test.ts`; request size: `src/agent/audit-prompt-size.test.ts`.
- Clean benchmark root: a folder outside any git repository with a copy of `bench/`, a scratch
  `HOME`/`USERPROFILE`, and the OpenRouter key passed through the environment. The silent suite is the
  core manifest with "Run bun test before completing." removed from every prompt.
- Every run was merged into `bench/history/benchmark-history.json` with
  `bun run scripts/bench-history.ts import --db <db> --source <label>`.

**The same experiment on today's code** (§6.4, §21): the switches are now part of `shelra bench`, so no
patch is needed. `--ablate <list>` (the list above plus `contract`), `--agent claude-code|codex`,
`--repeat <k>` and `--max-tool-rounds <n>` are flags; each task runs in a clean room by default
(`--no-clean-room` keeps the layout the audit's runs used); every run merges into the history file.
The §6.4 runs came from a detached worktree at `d282a68` with `--no-clean-room --max-tool-rounds 80`,
from the same clean root with a separate `HOME`, one benchmark at a time.

## Appendix B. Where documentation, memory and code disagree

| # | Statement | Where | What the code or data shows |
| --- | --- | --- | --- |
| B1 | "What the harness enforces: verification before 'done' … only host-observed evidence marks work as verified" | `CLAUDE.md` | A successful command containing a check-like word counts, including `echo "tsc passes"`; evidence before later edits counts (§10) |
| B2 | "`/verify` … builds, tests, boots it, and runs browser smoke checks in a sandboxed environment" | README capabilities | Shuru requires macOS on Apple Silicon; on Windows and Linux every command of the `verify` sub-agent fails (§10) |
| B3 | "Every delegated task follows intent → context → plan → verify → deliver" | README capabilities | Prompt text; sub-agents run with no completion gate (`agent.ts:1824-1968`) |
| B4 | "Procedures used repeatedly become `.agents/skills`" | README, `AGENTS.md` | Promotion counts retrievals, not successful use; no organic promotion recorded (§7) |
| B5 | "Shelra must not behave like a stateless agent" (hard rule) | `AGENTS.md` | No organic memory on its own repository after 303 sessions (§7) |
| B6 | Memory "lives inside the repo … shareable via git" | memory-engine design, memory note | `.shelra/` is gitignored in this repository (`.gitignore:102`) |
| B7 | "`search_x` remains provider-specific" | README capabilities | No provider implements `responseSearch`; the tool never appears |
| B8 | "The copyright holder and year in LICENSE … still the unfilled MIT template" | `PRODUCT.md:60` | LICENSE names the holder since 2026-09-22 |
| B9 | "The decision date is 2026-10-16" for the ledger kill test | `PRODUCT.md:26` | The owner declared the gate passed on 2026-09-23 (memory); `PRODUCT.md` not updated; phase 2 not started |
| B10 | "Quarantine is per process" | doc 14 §23.5 | Persisted since `provider-quarantine.ts` |
| B11 | "Restart-safe session intent" | doc 14 §21 | The restored kernel is replaced at the start of the next turn (`agent.ts:2386`); display only |
| B12 | "PreToolUse/PostToolUse wrappers exist but nothing calls them" | auto memory (UX log) | Outdated since `f9e8b4c`: every tool runs them (memory corrected during this audit) |
| B13 | Benchmark scores describe "the product path people run" | doc 14 §23 | True of the loop; the prompts carried the repository's own `AGENTS.md` and skills (Q7) |
| B14 | Sub-agent prompt for `ui-verify` describes "the two-column layout … sidebar order" | `agent.ts:607` | The TUI has no sidebar since 2026-09-19 |

Resolved since the audit (§21): B1, `CLAUDE.md` describes the contract and the closed loopholes; B2,
the README says where `/verify` runs, and elsewhere it refuses; B3, the README no longer promises a
process for sub-agents, and says the host's checks cover their changes through the parent's final
code; B4, promotion needs two turns whose checks passed; B7, `search_x` was removed; B14, the
`ui-verify` brief describes the single-column log. B5 stays open until organic memory is measured.

