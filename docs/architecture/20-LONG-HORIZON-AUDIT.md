# 20. Long-horizon audit: can Shelra work on one project for a year? (2026-10-02)

This document answers one question with evidence: **can Shelra work on the same software project for a year:
keep the user's evolving intent, the decisions still in force, the state of the work and what it learned, across
sessions, interruptions and model changes, and keep delivering what the user meant?** It does not trust the
documentation, directory names or feature count. A capability counts only when code, a test, a recorded run or real
use shows it.

Written from the working tree at `45f87d1` (main, clean), the owner's session database and memory stores, two
research lanes (`20-evidence/`), evaluations built for this audit (`bench/long-horizon/`), and two independent Round 3
reviews (an adversarial design review and a claim-by-claim fact check), whose corrections are applied here. Earlier
audits: doc 15 (definition of done, 2026-09-23), doc 17 (engineering lifecycle, 2026-09-24), doc 18 (memory v2,
2026-09-25).

## 0. Method and evidence labels

| Label | Meaning |
| --- | --- |
| `TEST` | Reproduced deterministically through the real `Agent.processMessage`, real tools and real storage, with a scripted model: the Year-in-a-Box layer 1 (`bench/long-horizon/year-in-a-box.ts`) or one of ten probes (`bench/long-horizon/probes.ts`, P1 and P3-P11). The scripted year has no randomness; each variant gave identical numbers on each of its two to five runs during the audit (the repetitions were not kept as separate files). |
| `RUN` | One turn by a real free model through the real agent (`bench/long-horizon/real-run.ts`), graded by hand against a written key and re-graded by an independent reviewer. One run is one sample. |
| `DB` | Real use: `~/.shelra/shelra.db` (330 sessions, 2026-09-06 to 2026-09-26) and the `.shelra/memory` stores on the owner's machine. |
| `CODE` | Read at the cited line: what the code would do, not that it happens. |
| `DOC` | Documentation or memory only. |
| `WEB` | External source, dated, from `20-evidence/research-long-horizon.md` (about 90 sources); `WEB (Anthropic)` marks Anthropic's own documentation or the Claude Code CHANGELOG. |
| `INFERENCE` | The auditor's reasoning from the above. |

The three rounds the brief requires:

1. **Forensic.** What crosses a session boundary (`20-evidence/forensic-state.md`: every durable store, its writer,
   its reader, what a fresh session receives), the real-use database, the stores on disk, and the test chain
   (`bun run typecheck` clean; `bun run test` exit 0 in 1 min 44 s: 164 Vitest files with 1,259 tests and 17 Bun
   files with 112 tests).
2. **Adversarial.** A compressed year of 12 epochs (fresh process and session each, simulated clock, a crash in
   September, a model change in October, superseded decisions, a dropped requirement, stale documentation), ten
   probes aimed at time, scale and boundaries, and nine real free-model turns: reconstruction of the year (two
   models, full Shelra and a bare baseline), a request that conflicts with an old constraint, a continuation after
   the crash, and a cold start on Shelra's own repository.
3. **System design.** §22-§25 derive the minimum architecture from the evidence and challenge each piece; the Round 3
   reviews changed the bottleneck's wording, the P0 list and the roadmap's first phase.

No product code changed. Real-model runs used free OpenRouter models only (§16). No paid model and no reference
agent were run.

## 1. Executive diagnosis

**No, not today, on the evidence.** Inside one request Shelra is strong: the host decides "done" from checks it runs
itself, repairs from parsed failures, stops loops, survives free-model outages and labels unverified work honestly.
Across sessions it keeps a raw history of what happened (an episode per turn, the user's literal rules, approved
decisions) but **derives no current state from that history and delivers almost none of it** to the next session.
What a year needs between sessions (the purpose, the requirements and non-goals in force, the plan and its progress,
what was interrupted, which statements were withdrawn) exists only as text buried in the log, and every request
that cannot name it by its words starts over.

The evidence, by weight:

1. **Real use has never crossed a day** (`DB`). 330 sessions in 20 days; none was used more than 24 hours after it
   was created; the longest-lived project spans 12.9 days, and after 146 sessions its project memory holds two
   entries, both test residue. Nothing in the field has exercised long-horizon work.
2. **With an ideal model, a fresh session in December receives half of what it needs, and one falsehood** (`TEST`,
   §15). The scripted model plans, runs every check, proposes every decision and reflects as the prompt allows. On
   "continue the work we started in January…" the first request carries 5 of 10 facts the year established (no
   purpose, no privacy constraint, no reason for the architecture, no record that the monthly report was dropped, no
   plan progress) and shows "Use SQLite instead of JSON files", withdrawn in July, as a standing rule "in the user's
   own words (they hold for every request)" next to "Use DuckDB instead of SQLite".
3. **The facts are in the log; the log does not scale as delivery** (`TEST`, counterfactual). A digest of Shelra's
   own `episodes.jsonl`, newest first in 3,000 characters, would carry all 14 facts at the end of the 12-epoch year,
   and none of them after 30 more routine turns (about three days at the pace of the owner's busiest project). The
   history exists; current state does not.
4. **A continuation is told to start over, and a strong model recovers by digging** (`TEST`, `RUN`). The session
   killed mid-turn kept zero messages (the round, and the user's request with it, are written when the round ends).
   The next session's "Continue where we left off." got the host's check run but no repository context (the request
   reads as conversation) and the note "treat it as new here, and do not assume earlier work on it". A real free model
   given that state (Nemotron 3 Ultra, n = 1) still found the interrupted refactor by listing `.shelra/` and reading
   the raw episode log, after first looking for a `.shelra/plan.json` that does not exist, and finished it.
5. **Verification decays as the project ages, and learning stops with it** (`TEST`, `RUN`). Test protection decides
   by the request's wording whether tests may change. In the year, 6 of 10 working epochs ended `[Not verified — it
   changed tests that existed before …]`; in 5 of them the change kept or extended what the tests checked (a removed
   feature's test, an added regression case, import paths moved by a refactor). Those exits skip reflection, so from
   May the model-written memory never grew again, and the episode log labels correct work "unverified", which a real
   model later reported as "the June attempt broke existing tests". In the continuation run, test protection made the
   model keep re-export shims instead of updating one test import.
6. **The forgetting curve forgets the constraint that matters most** (`TEST`, `RUN`). "Nothing may leave the user's
   machine" was said in prose, so it was stored as a model inference and archived in May, 119 days after it was
   written, as "faded from disuse". In December, full Shelra asked to add "an automatic nightly backup to Google
   Drive" planned it and asked about a cron library, never about the data leaving the machine.
7. **The best reconstructions came from raw files, not from what Shelra injects** (`RUN`). On the year's final state,
   the bare baseline (every subsystem off, files on disk) matched or beat full Shelra on both models: Nemotron 3 Ultra
   8-8.5 (full, two runs) vs 11.5 (bare), Qwen 3.8 27B 10.5 vs 12, out of 12. The bare runs listed `.shelra/memory/`
   and read the raw log; the full runs mostly trusted the context they were handed. Not isolated: the arms also differ
   in system prompt size and web research. Full Shelra was better at keeping rules: on the conflict request it offered
   a no-dependency option where the bare run installed `googleapis`.
8. **A cold start on Shelra's own repository reconstructs the past, not the present** (`RUN`). Asked, with no history,
   what the project is, its objective, its active architecture and what remains, a strong free model answered the
   objective, the architecture and the open work from the history docs `00` and `10` (the old xAI migration), about 2
   of 6 right. Shelra does not load `CLAUDE.md`, where the current objective lives. And the host's check repair turned
   that request, which said "without changing anything", into edits of `tsconfig.json` and `package.json`.

**The bottleneck** (§22, P0-1): **Shelra records the project's history but owns no current state derived from it,
and delivers neither.** Task state was built as session state, memory (lexical, capped, fading, told not to store
"the task itself") was left to carry continuity, and the one durable intent artifact that works, the decision ledger,
covers only decisions.

**The next escalón** (§24): a project record, versioned with the code, derived by the host from what it observes at
turn boundaries (objective, requirements, constraints and non-goals, decisions, tasks with status and evidence,
failed approaches, interruptions), sized for a year rather than a week, and rebuilt into the opening context of every
session, continuations included. It extends what already works (the ledger's format and approval, the plan and
acceptance types, the contract's evidence) and replaces the dormant task stores rather than adding one.

## 2. Original Shelra mission

Reconstructed from memory, `CLAUDE.md`, `PRODUCT.md`, the execution plan and doc 15 §2:

| Date | Stated mission | Status in the code today |
| --- | --- | --- |
| 2026-09-08/15 | Research: the durable artifact is a record of machine discretion as executable checks; long-horizon memory is its storage layer (`docs/future-research/08`, `11`-`17`) | Research; the decision ledger is the only built piece |
| 2026-09-17 | Hard rule: Shelra is never stateless; every project makes it smarter (decision D-0006) | Memory engine built and rebuilt (doc 18); §6 measures what it carries |
| 2026-09-18 | "The agent that never loses the project's thread": a decision ledger with re-verifiable evidence | Ledger built 2026-09-23; enforced on the turn; its proof (F5, F6) not run on Shelra yet |
| 2026-09-22 | "Es el objetivo realmente resolver": solve real tasks, free models first | The current objective (`CLAUDE.md`) |
| 2026-09-23 | Execution plan: guarantees in harness code; F6 "prove continuity" with a ten-step chain | F6 suite built, reference arms measured, Shelra arm not run |
| 2026-10-02 | This brief: one project for one year; intent → reality fidelity | This document |

The long horizon was always in the mission ("gets better at a project the longer it works on it instead of starting
from zero each session", `CLAUDE.md`). Since 2026-09-22 effort went to the single turn (contract, smoke check, loop
detection, research and diagnosis before work), which was the bottleneck then (doc 15). It has moved.

**Is the brief's loop the right architecture?** Intent → specification → plan → execution → reality → verification →
repair → learning is right for one unit of work, and Shelra now runs most of it inside a turn (§8). For a year it
lacks a persistent home (each pass starts from whatever the next request reaches) and an explicit "intent changed"
edge (a new request is a new loop, never a change to an old one). The corrected loop, used by §23:

```
            ┌──────────── project record (durable, versioned, host-derived) ◄────────────────┐
            ▼                                                                                 │
 request ─► reconcile with record ─► specify (criteria) ─► plan ─► act ─► observe ─► verify ──┤
            │  (conflict? changed intent? continuation? read-only?)               │           │
            └──► escalate with options when judgment is needed          repair ◄─┘           │
                                                                  learn: record + evidence ───┘
```

## 3. Current runtime architecture

The live path, unchanged in shape since doc 15 and grown in size: `src/index.ts` (CLI, headless `-p`) and `src/ui/`
(OpenTUI) → `Agent.processMessage` (`src/agent/agent.ts`, **5,615 lines**: 3,735 at doc 15, 3,465 on 2026-09-22; 43
commits since 2026-09-23) → AI SDK step loop (`src/runtimes/local-provider.ts`) → tools (`src/toolset/tools.ts`,
executors in `src/tools/`) → completion gate and task contract (`src/contract/`) → memory (`src/memory/`) and the
decision ledger (`src/ledger/`). Sessions in SQLite (`src/storage/`). By doc 15's own measure, `src/` holds 71,549
lines in 244 files (55,309 at doc 15, nine days earlier); 235 files are reachable from the entry point and 4 are dead
(§17).

Before the model's first step (`20-evidence/forensic-state.md` §B, `CODE`): hooks fire (their output is discarded,
`agent.ts:2699,2708`); finished background delegations become system messages; the host runs the project's checks
when the request asks to check, fix, continue or test (`pre-work.ts:33-36`; skipped only for approval-only follow-ups
such as "sigue" or "ok, continúa"); one web search on the request (`research/pre-task.ts:44-50`); the context packet
(`compileContextPacket`, empty for a request classified as conversation, `context/compiler.ts:262-266`); interrupted
turns recovered into episodes; the user's literal rules captured; the daily consolidation; memory ranked for the
request; then the system prompt: mode prompt, the `AGENTS.md` chain (`CLAUDE.md` is not loaded; only its command
table is read by check discovery), decisions, project memory, skills, cwd and date, the packet, running processes.

What crosses a session boundary and how it reaches the next model (`forensic-state.md` §A, `CODE`; `TEST` where
marked):

| Store | Written | Reaches a later session's model? |
| --- | --- | --- |
| `docs/decisions/*.md` (ledger, in git) | on the user's approval | every request: the 30 lowest active ids, each with title, rule (≤240 chars), scope and check; never the `why` (`TEST` P4) |
| `.shelra/memory/` entries (git-ignored) | user rules (regex), reflection (model), `memory_write` (model), host lessons | ranked by word overlap; rules always (≤1,500 chars) |
| `.shelra/memory/episodes.jsonl` | every agent-mode turn that did work | ≤2 lines on word overlap, or the last 3 through `memory_list`; the `summary` field is never shown |
| `.shelra/memory/live/<session>.json` | on tool results, at most every 20 s | converted to an `interrupted` episode at the next turn in that folder |
| `.shelra/memory/archive.jsonl` | consolidation, "make room" | as "faded" pointers when a request matches |
| SQLite `messages`, `tool_calls`, `tool_results` | at the end of each model round | only when that same session is resumed |
| plan, criteria, step status (inside `tool_results`) | per round | same session only; `update_plan_step` stops working after the publishing turn (`TEST` P1) |
| `compactions` | at ~85% of the window | same session only; summary written by the turn's own model |
| `objectives` rows | many times per turn (38 call sites) | restored into the same session's kernel for the UI, then discarded at the next turn |
| `objective_tasks` | never (zero non-test callers) | 0 rows in real use (`DB`) |
| `checkpoints` (full pre-images) | before every file-tool write | no reader outside tests; 778 rows (`DB`) |
| session recap | a model call after every round | UI only |
| traces `~/.shelra/logs/sessions/` | every event | CLI only; deleted after 14 days |
| `swallowed-errors.jsonl` | every logged swallowed failure | no reader |

## 4. Intent pipeline

Where the user's intent is represented, from the raw request to the outcome (`CODE`, `TEST`):

| Stage | Representation | Lifetime | Evidence |
| --- | --- | --- | --- |
| Raw request | verbatim message | the session transcript; 600 chars in an episode | `episodes.ts:126-143` |
| Interpreted intent | none host-side | the model's context | no intent model, no ambiguity or conflict step |
| Specification | `generate_plan` goal, requirements, criteria, when the model plans; a requirement checklist for "dense" requests | session (plan); turn (checklist) | `tools.ts:1241-1407`; `agent.ts:3036` |
| Acceptance criteria | plan criteria; a criterion command that did not pass before joins the contract | session | `agent.ts:4053-4060` |
| Plan | steps with `working/complete/claimed/failed` | session; updatable only in the publishing turn | `TEST` P1 |
| Tasks | none beyond plan steps | — | `objective_tasks` never written |
| Implementation | files, git | durable | — |
| Verification | contract results, smoke check, verdict | turn; the verdict also in the transcript and as an episode note | `agent.ts:1725-1747` |
| Evidence | `turnVerificationEvidence` strings | turn | not kept per task |
| Outcome | final answer | transcript; episode `summary` (never shown) | `forensic-state.md` §A.2 |
| Standing intent | user rules ("always/never/remember that/we use/use X instead of Y"), ledger decisions | durable | `reflection.ts:77-90`; `src/ledger/` |

**Where semantic drift happens.** (a) Between sessions: everything above "implementation" except rules and decisions
stays behind, and the next session rebuilds intent from its request, the files and whatever the model reads.
(b) After compaction: the turn's own model writes the summary; the host keeps only the acceptance criteria verbatim
(`TEST` P11: with a weak summarizer the goal "never round before summing" is gone, the criterion stays). (c) At a change
of intent: "We no longer want the monthly report; replace it with a yearly tax summary, but keep the CSV import" is
captured by nothing (`TEST` P5: the `NO_LONGER` pattern needs "use"), so the non-goal and the constraint survive only
in git history and an episode line. (d) At "done": green tests that do not exercise the request pass silently (`TEST`
P9: a change implementing nothing of "add a --json flag" ended with no verdict line and an episode labelled
`verified`). (e) Against the request itself: "without changing anything" is not represented, so the host's check
repair can override it (`RUN` cold start).

**Intent traceability (brief §13).** WHY: not represented (decisions carry a `why` the prompt never shows). WHAT: per
session (plan goal). CONSTRAINTS: only when phrased as a rule or approved as a decision. NON-GOALS: no field anywhere.
ACCEPTANCE CRITERIA: per session. EVIDENCE: per turn. Only rules and decisions outlive the prompt that created them.

## 5. Context architecture

The brief's pipeline mapped onto the code (`CODE`, `TEST`):

| Brief's stage | What exists | Gap |
| --- | --- | --- |
| Task interpretation | `classifyTurn`: coding, repository, conversation | "continue where we left off", "sigue", "what were we doing?" classify as conversation: empty packet (`compiler.ts:262-266`) |
| Project memory | rules; ≤4 expanded entries ≥60% of the best score; ≤12 pointers; ≤2 faded; ≤2 episode lessons | lexical; a continuation with no shared words gets "treat it as new here" (`retrieval.ts:564-575`) |
| Documentation | `AGENTS.md` chain, uncapped | `CLAUDE.md` not loaded; README and docs only if the model reads them; history docs indistinguishable from current ones |
| Repository | stated checks, git branch, ≤12 uncommitted files, last 3 commits, files the request names, the whole list for ≤40 files | none for conversation-class requests |
| Task state | none | — |
| Recent execution | the host's check run (for check/fix/continue/test requests), running processes, same-session transcript | the previous session's verdict and final answer are not given |
| Relevant code | files the request names; the model's own search | — |

**What stays out, and should.** Bounded reads (`read_file` 2,000 lines / 50,000 chars), cleared stale tool results,
an 8,000-char packet, a 3,000-char knowledge tier. Measured in the year (`TEST`): first requests of 5,400-8,900
characters, no duplicated documentation, no flood of tool output. Context *noise* is low; *coverage* is the failure.

**What stays out and should not.** For a continuation: the plan and its progress, the interrupted turn, the last
verdict, the purpose. For an old feature: knowledge that faded (the CSV entry, archived in July, came back in November
as a "faded" pointer naming a path the October refactor had moved, `TEST` E10). For a rationale question: the
decision's `why` (`TEST` E11).

**Context recovery (brief §11).** Compaction fires at ~85% of the window, keeps the last 35% verbatim, summarizes the
rest with the turn's own model in a fixed template, and re-appends the active acceptance criteria (`compaction.ts:69-100,
243-254`). `TEST` P11: goal lost, criteria kept, with a weak summarizer. Real use: one compaction in 330 sessions
(`DB`), so its quality on real work is unmeasured. A fresh session gets none of the summary: it lives in the old
session's table.

## 6. Memory architecture

### 6.1 Which knowledge classes exist (brief §6)

| Class | Distinct representation | Survives a year? | Evidence |
| --- | --- | --- | --- |
| Project identity | no (only `AGENTS.md` if the user wrote one) | — | `forensic-state.md` §F.1 |
| User intent / objective | no; reflection is told not to store "the task itself" | — | `reflection.ts:356` |
| Requirements | no (session plan only) | — | §4 |
| Constraints | partly: user rules said as rules; ledger decisions | a constraint said in prose becomes an inference and fades | `TEST` |
| Decisions + rationale | ledger (rule, why, evidence; no alternatives field); memory `decisions`/`architecture` (model-written, unapproved) | ledger yes; memory entries fade | `TEST` E11, P4 |
| Current state | no (git summary recomputed per coding request) | — | §5 |
| Task state | no | — | §7 |
| Episodic history | `episodes.jsonl` | on disk (rotates at 4 MB); reaches the model by word overlap | `TEST` E9, counterfactual |
| Learned project knowledge | `conventions`, `build`, `testing`, `procedure`, skill proposals | only from turns that end verified or fail honestly | `TEST` |
| Failures | `failure`, `known-problems`, host-observed lessons | as above | `TEST` (June's lesson never stored) |
| User corrections | `conventions` tagged `correction` | yes, and never retired by a later correction | `TEST` P5 |
| Obsolete information | `status: superseded/archived` | for explicit supersession; not for correction chains | `TEST` P5, E9 |
| Temporary context | `reminder` (once); "for now/today" sentences refused as rules | — | `reflection.ts:93` |

### 6.2 Quality of each subsystem (brief §7)

| Subsystem | Write | Retrieve / rank | Scope | Provenance / time / confidence | Supersession / invalidation | Consolidation / GC | Conflicts |
| --- | --- | --- | --- | --- | --- | --- | --- |
| User rules | regex on the typed text, no model; ≤5 per message | always shown, ≤1,500 chars, then pointers | project, or user-wide for preferences about how Shelra talks | `human`, conf 1, date in body | a new value of the same rule supersedes; a correction retires entries whose index line names its subject, **except other corrections and entries that describe a change** (`reflection.ts:532,534`) | never archived; **40 per type, the 41st dropped silently** (`TEST` P3: 45 stated, 40 kept, 33 shown) | contradicting corrections all stay current (`TEST` P5) |
| Reflection | one bounded model call per qualifying turn; gate | knowledge tier: IDF-weighted overlap × trust × strength × staleness × credit | project | `inference` (0.65 weight); capped 0.4 when unverified | `supersedes` named by the model; near-duplicates merged into one slug | archived when older than 45 days and strength < 0.2: **about 118 days after the last use** (`dynamics.ts:70-74`) | an inference never retires a human entry |
| `memory_write` (model) | gate; forced `inference` | as reflection | project or **user-wide** | `inference` | — | as reflection | — |
| Host lessons | a failing check that passes after work between | knowledge tier | project | `observed` | merge | importance 0.6 | — |
| Episodes | host, every working turn | ≥2 shared terms (or half) → ≤2 lines; last 3 via `memory_list` | project | outcome label from the verdict | none (append-only) | rotation at 4 MB | — |
| Ledger | `propose_decision` + the user's approval only | every request, 30 lowest ids, no `why` | prompt and proposals: the shell's cwd; enforcement: the launch folder | `source`, dates, `approved` | `supersedes` on approval; no retirement; no contradiction check; scopes never re-checked | none | none |

### 6.3 What the year showed (`TEST`)

- **Write.** Six entries in January to March (E1: the cents rule, `storage-json-files`, `offline-only`; E2:
  `csv-import`; E3: the SQLite correction, `storage-sqlite`). From May no reflection ran (test protection, §9); the
  user's own rules were still captured (two in July), so the index held 4-5 entries all year. With the user adding
  "Update the tests as needed." to the five work requests that touch tests (variant `tests-allowed`), memory held 8-9
  entries, and the late requests gained one fact in October and one in November, none in December.
- **Supersession.** D-0001 (SQLite) became `superseded` on D-0002's approval and left the prompt: the ledger works.
  `storage-json-files` was retired twice over (reflection's `supersedes` and the user's correction); `storage-sqlite`
  was retired by the user's July correction. The user's own corrections are never retired: "Use SQLite instead of
  JSON files" and "Use DuckDB instead of SQLite" both stand in December, and P5 adds a third current truth ("We use
  Postgres for storage").
- **Forgetting.** `offline-only` (the privacy constraint; importance 0.45 because a model wrote it) archived on
  2026-05-04, 119 days after it was written; `csv-import` archived 2026-07-06 and offered back in November with a stale
  path. The withdrawn human correction can never fade (`source: human` never fades).
- **Real use agrees** (`DB`). This repository's memory: 2 entries, test residue from 2026-09-17. The Mario Kart test
  project: a correct PowerShell lesson; `project-setup`, written by the model's own `memory_write` at confidence 0.9 in
  a turn that ended unverified, stating "the development server is running and serving the game at localhost:8080";
  and a reflection-written `procedure` at confidence 0.95 whose body is `Stop-Process -Id 7972 -Force`: the action
  the owner complained about (the model killing a process it did not own), kept as a reusable procedure with a
  hard-coded PID. The destructive-command guard added later (`ae247e6`) blocks the command; the memory still
  recommends it.

### 6.4 Hygiene and safety (`TEST`, `CODE`)

- The model can hard-delete a rule the user stated (`TEST` P6: `memory_delete` removed `user-rule-never-commit-generated-files`; no version kept), although the gate forbids it from *rewriting* one.
- A fact the model saves with `scope:"user"` reaches every other project as `[user-wide]` (`TEST` P7).
- Memory is keyed to the launch folder, sessions to the git root, the decisions prompt to the shell's cwd: a start in `repo/packages/api` sees none of `repo/.shelra/memory` (`TEST` P7); after a `cd`, decisions leave the prompt while the gate still enforces them (`TEST` P8).
- Memory is git-ignored (`store.ts:77-89`) while decisions are versioned: a clone or a second machine has the decisions and none of the rules, episodes or lessons.

## 7. Task-state architecture

**No task state outlives a session** (`CODE`, `TEST`):

| Candidate | Scope | Read by a new session? | Evidence |
| --- | --- | --- | --- |
| `generate_plan` result and step updates | session (`tool_results`) | no | `agent.ts:1059-1080` |
| the same plan in the session's next turn | session | visible in history, **not updatable** | `TEST` P1 |
| `objectives` rows (request, phase, blocker) | one row per turn | no | `objectives.ts:57-93`; kernel discarded at `agent.ts:2675` |
| `objective_tasks` (status, attempts, last error) | — | never written | 0 rows (`DB`) |
| attempt journal (`restore_file`) | turn | no | `agent.ts:2677` |
| live save | project | as an `interrupted` episode | `episodes.ts:262-280` |
| episodes | project | by word overlap | `TEST` E9 |
| commit links | — | none; the packet shows the last 3 commits | `compiler.ts:96-99` |

For a session that starts tomorrow: current objective — no; phase — no; active task — no; what blocks it — no (a
`report_blocker` reason survives only as transcript text); what is verified — only as episode labels that test
protection makes unreliable; what failed — host lessons for environment traps, nothing for approaches; what changed
since the plan, what needs replanning — no.

**Reconstruction after weeks offline** depends on the model reading the repository. The real runs (§15.2) show strong
free models can do much of it from README, `docs/decisions`, `git log` and, when they look, the raw episode log; the
real continuation run went looking for a plan file that does not exist.

## 8. Agent lifecycle

The turn as the code runs it today (doc 15 §4's classes in parentheses where doc 15 had the stage):

| Stage | Class now | What changed since doc 15 |
| --- | --- | --- |
| Intent | FUNCTIONAL (FUNCTIONAL) | requirement checklist list-aware and Spanish; read-only requests not represented |
| Context discovery | FUNCTIONAL for coding requests, ABSENT for continuations (WEAK) | lean packet: checks, git, named files |
| Memory retrieval | FUNCTIONAL mechanism, harmful note on continuations (FAKE in practice) | tiers, rules always, episodes, faded pointers (doc 18) |
| Research before work | FUNCTIONAL (new stage) | host search on the request |
| Diagnosis before work | FUNCTIONAL (new stage) | host runs stated checks for check/fix/continue/test requests |
| Specification | PARTIAL (MISSING) | plan criteria with `command` join the contract |
| Planning | PARTIAL; dead after one turn (COSMETIC as control) | `claimed` when no check backs a step |
| Action | FUNCTIONAL, guarded (unguarded) | destructive commands asked (TUI) or refused (headless), `TEST` P10 |
| Verification | STRONG within a turn when the project states checks (PARTIAL) | host-run contract, smoke check, local URL checks |
| Repair | FUNCTIONAL (WEAK) | parsed failures, regression naming, `restore_file`, circle and stall detection |
| Completion | honest labels, silent pass on uncovered intent (FUNCTIONAL) | `[Checked by Shelra …]` only when the host ran a check |
| Learning | WEAK (WEAK) | many mechanisms; stalled by test protection (§6.3) |
| Across sessions | WEAK | episodes, live save, interrupted recovery; no task state |

**Reality loop (brief §19).** Inside a turn Shelra is not "prompt → model → code → done": when the project states
checks, the host runs them on the final code, sends parsed failures back for a bounded repair, opens a web app
headless, requests the pages the answer names, and labels the result. Two links stay model-owned: SPEC (which
behaviors the checks must cover) and COMPARE-to-intent (whether passing checks mean the request was met, P9). Across
turns the loop does not close: nothing compares today's work with last month's intent.

## 9. Verification architecture

What the host verifies, and when (`CODE`, `TEST`; mechanisms from doc 15 §21 and AGENTS.md re-checked): the project's
stated checks run by the host on the final code (reusing an agent run made after the last change); a plan criterion
whose command did not pass before; a decision's check when the change touches its scope; the web app opened headless
when web files changed; local pages the answer names; pre-existing tests and check definitions protected.

**Five ways the signal fails over a long horizon:**

1. **Test protection by wording** (`test-protection.ts:16-32`). In the year, 6 of 10 working epochs held back with
   passing checks; in 5 the change kept or extended what tests check (E4 deleted the test of a feature the user asked
   to remove, E5 added a regression case, E7 and E9 moved import paths, E10 added a case); E6 replaced a real SQLite
   assertion with a test of an in-memory stub, which protection arguably should hold. It also protects the tests
   Shelra itself wrote in earlier sessions. Recorded in the execution plan on 2026-09-23 ("Findings to act on"); open.
2. **It shapes the code.** In the real continuation run the model restored a one-line test import to satisfy
   protection and kept two re-export shim files instead (`RUN` continue-ultra-full): protection traded a test edit for
   permanent indirection.
3. **Intent coverage is the model's job**: green tests that do not exercise the request pass silently and the episode
   says `verified` (`TEST` P9). The requirement audit runs only for "dense" requests.
4. **Decision scopes rot.** D-0002 covers `src/store.ts`; the August refactor moved it to `src/storage/store.ts`.
   Nothing notices that the glob now matches no file, so the decision's check no longer joins any turn's contract
   (`TEST` state after E11; `CODE` `agent.ts:4027-4040`).
5. **The repair loop ignores the request.** A read-only request whose shell work (a `bun install`) counted as a change
   was sent back three times to make the checks pass, and the model edited the repository to do it (`RUN` cold
   start). A verified turn whose checks the agent ran itself carries no host line (`agent.ts:4155-4160`), so "the host
   checked" and "the model says so" look alike unless the host re-ran.

**False-completion traps (brief §18).** "A build passes but the feature does not work": not caught unless a check
exercises the feature (P9). "A unit test passes but the UI is broken": caught for web apps the smoke check can open
(AGENTS.md; not re-tested here). "Matches the plan but not the requirement": not caught (the plan's criteria are the
model's). "Renders but persistence fails": not caught without a check.

## 10. Repair architecture

Within a turn, repair is evidence-driven (doc 15 Phase 2, re-checked in code): failures parsed per runner; a check
that passed after the previous attempt and fails now is named with the files that attempt changed; `restore_file`
offered; the same failure four times while files change stops the round (`circles.ts`); a stall or six repeated steps
stop the generation; repeated failures raise reasoning effort. Across turns there is no attempt memory beyond host
lessons (an environment trap and what got past it) and episode failure lines. Failed *approaches* are never recorded;
the research lane's clearest finding for multi-session work is that log ("without them, successive sessions will
re-attempt the same dead ends", `WEB (Anthropic)` A-LRSCI).

## 11. Learning / Skills architecture

- **Consolidation** (daily): a failure repeated across turns becomes one lesson; unused inferences are archived. In
  the year it archived the privacy constraint and the CSV knowledge and produced no lesson (`TEST`).
- **Skills**: a procedure with credit ≥2 becomes a proposal under `.shelra/memory/skill-proposals/`; only `shelra
  memory promote` writes `.agents/skills/<slug>/SKILL.md`. In real use no proposal exists in any of the 60 workspaces
  or the user store (`DB`).
- **Ablation** (`TEST`): memory off drops the December request from 5 to 2 facts (DuckDB through the decisions, the
  CSV import through the file list; the rules are gone). With the ledger off the memory corrections still name DuckDB,
  so this scenario cannot show the ledger's value; its enforcement value is what F5/F6 measure.

It records more than it learns. Repeated experience did not become stable knowledge in the year (nothing
consolidated), and what was learned is lost to the forgetting curve when nobody re-reads it. The field finds that
self-written knowledge does not pay on average and that memory pays for facts the repository cannot tell (`WEB`
CL-Bench, DreamBench-SWE, SkillsBench).

## 12. Provider / model independence

- **State is model- and provider-neutral** (`TEST`): the year switched models in October and nothing stored depended
  on it; memory, decisions and episodes are plain files; transcripts are AI SDK messages.
- **Guarantees that hold for any model** (`CODE`, doc 15 §5 updated): the contract, test and check protection, smoke
  and URL checks, loop/stall/circle detection, the destructive-command guard, spend limits, resilience and fallback,
  decision enforcement, rule injection. These are Shelra's.
- **What is model-owned over a long horizon** (`RUN`): rebuilding where the project stands, whether to read the
  history, whether a request conflicts with old intent. On reconstruction the same model scored 8-8.5 (full) and 11.5
  (bare) depending on whether it explored; Qwen 27B scored 10.5 full because it called `memory_list`. Conflict
  detection failed in both arms.
- **Provider switch mid-project**: the multi-provider plan (doc 19, branch `provider`) records that opaque reasoning
  state must replay unchanged and that `usage_events` has no provider column. A fresh session is safe because nothing
  durable carries provider state; resuming an old session on another provider is not.
- **Bare-model baseline** (brief §29): `-p` has no `--ablate` (it is a `shelra bench` flag; AGENTS.md's `--ablate
  research` wording applies to the bench), so `real-run.ts` passes the ablation to the agent as the bench does.

## 13. Hallucination failure analysis

| Kind | Seen / possible | Evidence | Harness-owned cause |
| --- | --- | --- | --- |
| Repository (a file that does not exist) | seen before: field case 002 invented `loop.ts`, `control-plane.ts`, `ollama.ts`, `http.ts` from docs about `ShelraCode/` | `bench/field/SCOREBOARD.md`, `bench/field/cases/002-project-audit.json` | history docs in the repo |
| State (claims work done or running) | **seen**: "the development server is running" kept at conf 0.9 from an unverified turn | `DB` | the gate admits state claims from `memory_write` |
| Memory (a withdrawn statement as current) | **structural**: "Use SQLite instead of JSON files" shown as a standing rule in every late epoch | `TEST` | correction chains never retire |
| Intent (requirements never asked) | **seen**: "No CLI / UI / entry point" listed as half-done work | `RUN` recon-ultra-full | no record of what was asked |
| History (a past event misreported) | **seen**: "the June attempt broke existing tests" | `RUN` recon-ultra-full | episode labels say `unverified` for test-protection exits |
| Architecture (an architecture other than the code's) | **seen twice**: the bare conflict run built the backup for "data stored in JSON files" (stale README); the cold start described the xAI migration as the current objective (history docs) | `RUN` | stale and history docs, no signal that they are stale |
| API (outdated or nonexistent API) | not measured | — | research before work mitigates |
| Execution (claims a run that did not happen) | mitigated: host evidence comes from executed commands | doc 15 | — |
| Verification (works without evidence) | **seen**: P9 silent pass, episode `verified` | `TEST` | intent coverage is model-owned |
| Completion ("done" because code was written) | mitigated where the project states checks; documents-only turns always unverified | doc 15 | — |

**The evidence rule (brief §17).** Shelra distinguishes `human / observed / inference / web` sources and `verified /
unverified` outcomes. It does not tie a claim to its evidence: an entry has a confidence and timestamps but no link to
the command or file that supports it (except entries naming a command that later passes). KNOWN / INFERRED / ASSUMED
/ UNKNOWN / VERIFIED is not a status a claim can have, and a model inference became durable project truth twice in
real use (the server-running claim, the Stop-Process procedure).

## 14. Long-horizon failure analysis

The brief's one-year scenario, for the code as it is (`TEST` where the year exercised it, `CODE` otherwise):

| Month | What happens today |
| --- | --- |
| January: a product starts | Purpose and constraints said in prose are not captured; literal "always/never" rules are. The plan lives in that session. |
| March: architecture changes | Approved decisions supersede correctly; the user's corrections pile up as rules that all stay current. |
| May: requirements become obsolete | "We no longer want X" is not captured; git history and an episode line are the only trace. Constraints stored as inferences start to fade (about four months unused). |
| July: hundreds of decisions | The prompt lists the 30 oldest active decisions and "… and N more"; the newest are invisible (`TEST` P4). Rules past 40 per type are dropped silently (P3). |
| September: features partly done | Plans died with their sessions; a crash loses the round and the request; nothing lists open work. |
| November: documentation stale | Nothing detects it; a real model built on it (`RUN`). Decision scopes point at moved files. |
| December: "continue the January work, keep valid decisions, ignore superseded ones" | The model gets the active decisions (oldest 30), every rule including withdrawn ones, up to two episode lines and the git summary, and rebuilds the rest by reading. With an ideal model 5 of 10 facts arrive. Real strong free models reconstructed 8-12 of 12, the best of them by reading the raw log. |

## 15. Year-in-a-Box results

### 15.1 Layer 1: deterministic, ideal model (`TEST`)

Ledgerly, an offline expense tracker, lives from 2026-01-05 to 2026-12-15 (`bench/long-horizon/ledgerly.ts`): set up
with JSON storage, one literal rule (integer cents) and a privacy constraint said in prose (Jan); CSV import and a
monthly report (Feb); SQLite as decision D-0001 with rationale (Mar); "we no longer want the monthly report" → a
yearly tax summary, CSV import kept (May); a decimal-comma bug (Jun); DuckDB as D-0002 superseding D-0001, plus "never
add another dependency without asking me first" (Jul); a 4-step refactor left at 2 of 4 (Aug); the process killed after
its first tool result (Sep); "Continue where we left off." on another model (Oct); an old feature revisited (Nov); a
rationale question with stale docs (Nov); the December continuation. Each epoch is its own process and session; the
simulated user approves decisions and commits. The scripted reflection returns only what the reflection prompt allows
(no task progress), plus one derivable entry (`csv-import`) of the kind real reflections write.

Facts in the first request of the late epochs. Variants: `full`; memory off; ledger off; the user adds "Update the
tests as needed." to the five work requests that touch existing tests (E4, E5, E6, E7, E10); epoch 9 resumes the
crashed session with `-s latest` instead of a new one.

| Epoch, fact | full | memory off | ledger off | tests allowed | resume |
| --- | --- | --- | --- | --- | --- |
| Oct F1 purpose (offline tracker for freelancers) | - | - | - | - | - |
| Oct F2 privacy constraint | - | - | - | - | - |
| Oct F3 rule: integer cents | Y | - | Y | Y | Y |
| Oct F4 rule: no dependency without asking | Y | - | Y | Y | Y |
| Oct F5 active architecture: DuckDB | Y | Y | Y | Y | Y |
| Oct F12 the refactor's target modules | - | - | - | Y | - |
| Oct F13 the interrupted turn | - | - | - | - | - |
| Oct F14 refactor progress (what remains) | - | - | - | - | - |
| **Oct total** | **3/8** | **1/8** | **3/8** | **4/8** | **3/8** |
| Nov F2 privacy constraint | - | - | - | - | - |
| Nov F3 rule: integer cents | Y | - | Y | Y | Y |
| Nov F4 rule: no dependency without asking | Y | - | Y | Y | Y |
| Nov F10 CSV import knowledge | Y | Y | Y | Y | Y |
| Nov F11 decimal-comma lesson | - | - | - | Y | - |
| **Nov total** | **3/5** | **1/5** | **3/5** | **4/5** | **3/5** |
| Nov-rationale F3 rule: integer cents | Y | - | Y | Y | Y |
| Nov-rationale F5 DuckDB | Y | Y | Y | Y | Y |
| Nov-rationale F6 why DuckDB (columnar queries) | - | - | - | - | - |
| Nov-rationale F7 what came before (SQLite, JSON) | Y | - | Y | Y | Y |
| Nov-rationale F8 why SQLite; Postgres rejected | - | - | - | - | - |
| **Nov-rationale total** | **3/5** | **1/5** | **3/5** | **3/5** | **3/5** |
| Dec F1 purpose | - | - | - | - | - |
| Dec F2 privacy constraint | - | - | - | - | - |
| Dec F3 rule: integer cents | Y | - | Y | Y | Y |
| Dec F4 rule: no dependency without asking | Y | - | Y | Y | Y |
| Dec F5 DuckDB | Y | Y | Y | Y | Y |
| Dec F6 why DuckDB | - | - | - | - | - |
| Dec F9 tax summary replaced the monthly report | - | - | - | Y | - |
| Dec F10 CSV import | Y | Y | Y | Y | Y |
| Dec F12 the refactor's target modules | Y | - | Y | - | Y |
| Dec F14 refactor progress | - | - | - | - | - |
| **Dec total** | **5/10** | **2/10** | **5/10** | **5/10** | **5/10** |
| Superseded rule shown as current (each late epoch) | 1 | 0 | 1 | 1 | 1 |

Also measured: the crashed September session kept **0 messages** (the others 2-36), so `-s latest` brings nothing
back; the "treat it as new here" note reached the October continuation; F7 is credited in part from the withdrawn
rule itself. Results: `bench/long-horizon/results/*.json`.

**Counterfactual: deliver the log that exists** (computed offline from the final state; not product behavior). A digest
of `episodes.jsonl`, newest first, one line per turn (date, outcome, request, summary) within 3,000 characters:

| Log | Facts carried (of 14) | Characters |
| --- | --- | --- |
| the year's 11 episodes | 14 | 2,727 |
| plus 30 routine turns (≈ 3 days at the owner's pace: 146 sessions in 12.9 days) | 0 | 2,891 |
| plus 300 routine turns | 0 | 2,943 |

The year's metric cannot tell a structured record from a dump at 12 epochs; it can at realistic volume. Any proposal
is measured against both (§23 Phase 0).

**The brief's memory tests (§8).**

| Test | Where | Result |
| --- | --- | --- |
| A, cold start | real run on a clone of this repository | about 2/6; objective, architecture and open work from history docs; unrequested edits (§15.2) |
| B, interrupted task | year E8/E9; real run `continue-ultra-full` | harness: request lost, "treat it as new here", no packet; real strong model: recovered by reading the raw log, finished with shims (n = 1) |
| C, old decision | year D-0001 → D-0002 | ledger PASS (only D-0002 in the prompt); memory FAIL (the withdrawn correction stays a standing rule) |
| D, contradictory memory | probe P5 | FAIL: three storage engines current at once; no timestamp, source or authority reasoning in retrieval |
| E, cross-project isolation | probe P7 | FAIL for model-written user-wide facts; per-folder stores otherwise separate; a subfolder start sees no repository memory |
| F, months-old rationale | year E11; real reconstruction runs | not pushed (the `why` is never in the prompt); pullable: every real model found it in `docs/decisions/*.md` |

### 15.2 Layer 2: real free models (`RUN`)

Reconstruction and conflict ran on the state after epoch 11; the continuation on the state after the crash (epoch 8);
the cold start on a fresh clone of this repository. Graded against `bench/long-horizon/prompts/reconstruct-key.md` (12
points); a second reviewer's independent grades in brackets where they differ.

| Run | Model, arm | Tools | Result | Notes |
| --- | --- | --- | --- | --- |
| recon-ultra-full | Nemotron 3 Ultra, full (real date) | 18 | 8.5 [8] | missed the unfinished refactor and the crash; "the June attempt broke existing tests" (false, from episode labels); "no CLI" invented as half-done work |
| recon-ultra-full-dated | Nemotron 3 Ultra, full | 16 | 8.5 [8] | flagged README and ARCHITECTURE as stale; same misses |
| recon-ultra-bare | Nemotron 3 Ultra, bare | 28 | 11.5 | listed `.shelra/`, read `episodes.jsonl` and the archive: found steps 3-4, the interruption, the archived privacy rule |
| recon-qwen-full | Qwen 3.8 27B, full | 17 | 10.5 | called `memory_list` (interruption found); found the unmoved tax summary; asked before a dependency; missed the privacy constraint |
| recon-qwen-bare | Qwen 3.8 27B, bare | 30 | 12 | read the whole `.shelra/memory/` raw; flagged the archived privacy rule and proposed restoring it |
| conflict-ultra-full | Nemotron 3 Ultra, full | 8 | conflict **not** raised | planned the Google Drive upload; three design questions, one offering a no-dependency option; nothing on data leaving the machine |
| conflict-ultra-bare | Nemotron 3 Ultra, bare | 32 | conflict not raised; rule broken | added `googleapis`, built the upload, assumed JSON storage from the stale README, reported complete |
| continue-ultra-full | Nemotron 3 Ultra, full (state after E8) | 48 | task resumed and finished | despite the "new here" note: listed files, looked for `.shelra/plan.json`, read the raw log, moved the tax summary into `src/reports`; restored a test edit for protection and kept re-export shims; tests green |
| cold-start-ultra-full | Nemotron 3 Ultra, full (clone, no `node_modules`) | 49 | about 2/6; edits made | answers from history docs `00` and `10`; its `bun install` counted as a change, the host asked three times for passing checks, and the model edited `tsconfig.json`, `package.json` (added `viem`) and added a file, against "without changing anything" |

Reading (`INFERENCE`, n ≤ 2 per arm): on reconstruction the bare arm matched or beat the full arm on both models; full
was better at following the user's rules. The direction agrees with the field (verbatim history beats extraction,
`WEB` DreamBench-SWE, Letta), but the arms differ in more than memory (system prompt about 1,000 vs 7,600 characters, web
research in the full arm only, a packet that lists files without `.shelra/`).

## 16. Ablation results

| Removed | Effect on long-horizon continuity | Evidence |
| --- | --- | --- |
| memory (layer 1) | December 5 → 2 facts; rules lost; the withdrawn-rule falsehood also gone | `TEST` |
| ledger (layer 1) | no change in reached facts (memory corrections name the architecture); enforcement not exercised | `TEST` |
| everything (bare, real) | reconstruction equal or better (+3.5 Ultra, +1.5 Qwen); rules broken on the conflict request; stale docs trusted | `RUN` |
| test protection (requests worded to allow test edits) | memory 4-5 → 8-9 entries; Oct 3 → 4, Nov 3 → 4, Dec 5 → 5 facts | `TEST` |
| delivery of the log (counterfactual digest) | 14/14 at 12 epochs; 0/14 after 30 routine turns | `TEST` |

Real-model spend of this audit: 9 turns, 246 tool calls, 34 recorded model calls (rounds, reflections, recaps; about
280 OpenRouter requests counting each step), 3.44 M input and 53 K output tokens, all on `:free` models.

## 17. Code quality / architectural debt

Reviewed against Google's "improves overall code health" standard (`WEB`) and doc 15 §12 (`CODE`):

- **A god file growing fast.** `agent.ts` went from 3,465 lines (2026-09-22) to 5,615 in ten days; the turn loop, the
  gate, contract wiring, memory capture, live saves, the ledger, smoke and URL checks and sub-agents live in one class.
  Every long-horizon fix touches it, and parallel sessions collide in it.
- **Write-only state that looks like capability**: `objective_tasks` (never written), `checkpoints` (778 full file
  copies, no reader outside tests, no pruning), `objectives` (restored for one UI, then discarded), `sessions.status`
  (always `active`), `Episode.summary` (never shown), `swallowed-errors.jsonl` (no reader), the recap (a model call
  after every round, UI only). `CLAUDE.md` lists this pattern as already paid for.
- **Two decision systems**: the ledger (approved, enforced, versioned) and memory's `decisions`/`architecture` types
  (model-written, unapproved, fading), unlinked.
- **Three keying conventions**: launch folder (memory, decision enforcement), git root (sessions), shell cwd (decisions
  prompt, proposals, `AGENTS.md`, skills, packet).
- **Dead code** (doc 15's `reach.ts`, re-run): `ui/bench-modal.tsx` (910 lines), `cli/installation.ts` (326),
  `tools/checkpoint.ts` (44, the only checkpoint reader), and `providers/fake.ts` (56, tests only). Doc 15 §21 recorded
  dead code as removed; these remain.
- **Unbounded growth**: transcripts, `checkpoints` and `archive.jsonl` have no retention; traces are deleted after 14
  days, so a failure older than two weeks cannot be investigated from traces.
- **Silent failure**: 44 call sites log swallowed failures through `recordSwallowedError`; about 285 other `catch {}`
  or `.catch(() => {})` forms in non-test `src/` swallow without a record.
- **Strengths**: the full chain is green (1,259 Vitest and 112 Bun tests); behavior changes since doc 15 carry
  fail-before tests; no TODO/FIXME markers.

**Architectural entropy (brief §39).** Nothing checks code health over time (no structural tests, size or duplication
budgets, stale-doc detection); the harness itself produced indirection in the continuation run (§9 item 2). The field
measures erosion in agent-extended code and finds prompting lowers the starting point, not the slope (`WEB`
SlopCodeBench, the MSR '26 Cursor study). Not the bottleneck; the first thing to degrade once continuity works
(§23 Phase 6).

## 18. Scaling limits

| Dimension | Current limit (evidence) | First failure | Now? | Later |
| --- | --- | --- | --- | --- |
| Time | one session; no task state; unused inferences archived about four months after their last use | the next morning, or the first crash | **yes** | project record (§24) |
| Codebase | lean context and agentic search; unmeasured beyond this repository | unknown | no | measure first (doc 15 Phase 3.2) |
| Projects | per-folder stores; user-wide store open to the model | a model fact leaking to every project (P7) | yes (patch) | — |
| Concurrency | memory index rewritten without a lock (`forensic-state.md` §F, inferred) | two terminals on one repository | soon | one file per item, append-only index |
| Branches | decisions versioned with the code; memory git-ignored | a record or ledger edited on two branches | with the record | one file per item, merge-friendly |
| Users | single developer, local files | a second machine has decisions but no memory | no | — |
| Memory | 200 index lines, 40 per type, 30 decisions shown | the 31st decision, the 41st rule (P3, P4) | **yes** | selection by scope and recency, explicit overflow |
| History volume | lexical recall of episodes; a digest would hold about a day | 30 routine turns push the year out of view (counterfactual) | **yes** | derived state instead of recency |
| Execution | one local process; the round is the unit of persistence | a kill mid-round (E8) | soon | step journal |
| Providers | OpenRouter first; multi-provider planned (doc 19) | opaque reasoning replay on a resumed session | with doc 19 | doc 19 |
| Intelligence | per-turn guarantees host-owned; continuity model-owned | a model that does not explore (`RUN`) | **yes** | host-built continuation context |

## 19. Escalation model

| Mechanism | When | Shape |
| --- | --- | --- |
| `report_blocker` | the model decides | one text field; the turn ends `[Stopped — reason]` (`TEST` P10) |
| plan questions | the model decides, inside `generate_plan` | TUI tabs; headless cannot answer |
| destructive command | host-detected (force push, `rm -rf`, a foreign process kill, …) | TUI asks; headless refuses with "ask the user" (`TEST` P10) |
| decision approval | the model proposes | TUI panel; headless leaves it waiting |
| completion gate exhausted | three unanswered verification requests | `[Not verified — …]` |
| repeated failure | the same failure while files change | reasoning effort raised; the round stopped |

Missing: host-triggered escalation for **judgment** (a request that conflicts with an active decision, requirement or
constraint; an ambiguous request; an irreversible migration; a missing credential found mid-task; a check that cannot
pass without breaking the request), and any structure in the escalation itself. Both real conflict runs missed the
privacy conflict; in the cold start the host itself pushed past "without changing anything" instead of stopping. The
field measures the same weakness in every frontier model and finds a separate "is this specified, does this conflict?"
step works better than asking the coding model to notice (`WEB` HiL-Bench, Ambig-SWE, Ask-or-Assume).

A precise escalation, which `report_blocker` cannot carry today: what is blocked; why; what was verified; the options
and their trade-offs; the decision needed and the default; what is safe to continue meanwhile. Unnecessary, missed
and successful-autonomous rates are measured nowhere; §25 defines them.

**Permissions and blast radius (brief §44).** File tools are confined to the workspace and a scratch folder; the shell
runs on the host under a destructive-command policy (ask/block/allow); no network egress control; Shuru sandboxing
only on macOS Apple Silicon (`bash.ts:455`); doc 19's P0 plans to scrub provider keys from the shell's environment.
The research lane's principle (contain at the environment first, steer the model second, `WEB (Anthropic)` A-CONTAIN,
A-SANDBOX) is not met; for a year of autonomous work the destructive-command guard is the only host-enforced boundary.

## 20. Observability gaps

An engineer can see for a failed turn: the request, the model that answered, host notes, tool calls and results, the
verdict, memory recall (trace kind `recall`), logged swallowed errors, provider stream parts. For a long horizon:

- No identifier ties work across sessions: a task spanning five sessions is five unrelated session ids.
- Traces are deleted after 14 days; episodes rotate at 4 MB; `history.jsonl` and `reflections.jsonl` at 1 MB.
- Why memory forgot something is recorded (`archive.jsonl`) but surfaced only through `shelra memory`, never when the
  forgotten fact would have mattered.
- Task state transitions do not exist, so they cannot be traced.
- A passing turn is unlabeled unless the host re-ran a check (§9 item 5).

## 21. Long-horizon scorecard

PROVEN = shown by `TEST`/`RUN`/`DB` here (or by doc 15's tests where noted); PARTIAL = works in part, or only within a
turn; WEAK = exists, fails under the year; MISSING = no mechanism; UNTESTED = exists, behavior not measured.

| Capability | Current | Evidence | Failure mode | Target |
| --- | --- | --- | --- | --- |
| Intent understanding | PARTIAL | plan goal per session; requirement audit for dense requests | silent pass on uncovered intent (P9); read-only request overridden (cold start) | requests reconciled with the record before work |
| Intent retention | MISSING | §4; year F1, F9 | purpose, non-goals, dropped requirements lost between sessions | ≥ 90% of active intent reaches the next session |
| Specification | PARTIAL | plan criteria join the contract | model-chosen; session-scoped | criteria persisted per task |
| Context selection | PARTIAL | low noise | no packet for continuations; "treat it as new here" | continuations get state |
| Context recovery | WEAK | P11; 1 compaction in real use | goal lost with a weak summarizer; nothing outside the session | host-kept goal; record re-injected |
| Memory write | WEAK | year: reflection stopped from May; real use: test residue here | test protection stops reflection; state claims admitted | evidence-gated writes that keep up as the project ages |
| Memory retrieval | PARTIAL | doc 18 benchmark: 91% recall on the tuned set, 83% held out (5,000 entries); year E10 brought CSV back as faded | lexical; continuations miss | fed by the record |
| Memory freshness | WEAK | privacy rule archived; withdrawn rule permanent | forgetting by source, not by kind | constraints never fade; superseded never current |
| Conflict handling | WEAK | P5; conflict runs | contradicting rules current together; request conflicts unflagged | conflicts caught at write and at request |
| Task persistence | MISSING | §7; P1; `objective_tasks` 0 rows | plans die with the turn | tasks survive sessions and crashes |
| Planning | PARTIAL | plan tool, `claimed` status | not updatable after one turn | plan = persisted tasks |
| Replanning | MISSING | — | nothing compares plan and reality across turns | record updated from evidence |
| Tool selection | PARTIAL (model) | doc 15 §9 | — | unchanged |
| Execution | PROVEN within a turn (doc 15 resilience tests; real runs survived timeouts) | resilience suite | a kill loses the round | step journal |
| Verification | PROVEN within a turn (contract tests); WEAK over time | year: 6/10 held | wording-based protection, scope rot, silent pass, request ignored | ages with the project |
| Repair | PARTIAL | parsed failures, circles | no cross-turn attempt memory; shims under protection | failed approaches recorded |
| Hallucination resistance | PARTIAL | §13 | memory, history and architecture hallucinations seen | claims tied to evidence |
| Skills | UNTESTED | no proposal in real use | — | measured before extended |
| Learning | WEAK | year, `DB` | records rather than learns | non-derivable facts only, credited by outcomes |
| Crash recovery | WEAK | E8: 0 messages; interrupted episode reaches the model by overlap only; a strong model recovered by digging | round and request lost; no re-run safety | resume from journal + record |
| Model independence | PARTIAL | per-turn guarantees host-owned; continuity model-owned (`RUN`) | depends on the model exploring | continuation context host-built |
| Observability | PARTIAL | traces, recall events | 14-day traces; no cross-session task id | task ids across sessions |
| Escalation | WEAK | P10; conflict runs; cold start | no judgment escalation; unstructured blocker | conflict-triggered, structured |
| Code health | PARTIAL | tests green; `agent.ts` growth; write-only stores | entropy unchecked | structural checks |
| Long-horizon continuity | MISSING | §1, §14, §15 | — | §25 |

## 22. P0 root causes

P0-1 is the bottleneck. P0-2 to P0-5 are what would make any record wrong, misdirected or unsafe.

### P0-1. History is recorded; current state is neither derived nor delivered

- **Symptom.** Each session starts from its request. Purpose, requirements, non-goals, the plan, progress, evidence
  and interruptions are in no store a session reads; a "continue" continues only if the model digs.
- **Root cause.** Task state was designed as session state (the plan inside `tool_results`); the per-turn kernel is
  discarded; `objective_tasks` was never wired; memory, which is lexical, capped and fading and is told not to store
  "the task itself", was left to carry continuity. The episode log holds the raw facts but is append-only history
  with no notion of what is current, and is shown by word overlap only.
- **Code.** `agent.ts:1059-1080` (plan restore by session id), `agent.ts:2724` (plan reset per turn),
  `tools.ts:356,1421-1427`, `storage/objectives.ts:133-159` (no callers), `reflection.ts:356`,
  `retrieval.ts:564-575`, `episodes.ts:391-409` (lesson lines omit the summary).
- **Consequence.** Blocks intent retention, task persistence, replanning, crash recovery and long-horizon continuity.
- **Proof.** `TEST` year 3/8 and 5/10; the digest counterfactual (14/14, then 0/14 at +30 turns); P1; `DB` 0 rows of
  task state; `RUN` reconstructions that depend on the model reading raw files.
- **Fix class.** New subsystem built from existing primitives (§24), replacing the dormant task stores.
- **Exit criterion.** Year layer 1: ≥ 9/10 December and ≥ 7/8 October facts **with 300 routine turns added**, and no
  superseded statement shown as current; `update_plan_step` works across turns and sessions; layer 2, k = 3 on two free
  models: the continuation resumes the right task without redoing finished steps, and the full arm reconstructs at
  least as well as the bare arm.

### P0-2. Continuations are misdirected

- **Symptom.** "Continue where we left off." gets the host's check run but no repository context and an explicit
  instruction to assume no earlier work; approval-only follow-ups ("sigue", "ok, continúa") also skip the check run and
  research.
- **Root cause.** `classifyTurn` reads continuations as conversation → empty packet; `noteWhenNothingMatches` adds the
  note whenever lexical retrieval finds nothing, which is the normal case for "continue"; `isShortFollowUp` skips
  diagnosis and research for approval-only messages.
- **Code.** `context/compiler.ts:262-266`, `memory/retrieval.ts:564-575`, `agent/pre-work.ts:33-36`, `research/pre-task.ts:44-50`.
- **Consequence.** The cheapest continuity (git state, the last episodes, the interrupted turn) is withheld when it is
  needed most; recovery depends on the model ignoring the host's own advice.
- **Proof.** `TEST` E9 first request; `RUN` continue-ultra-full (recovered by digging, n = 1); `forensic-state.md` §B.3.
- **Fix class.** Patch.
- **Exit criterion.** Year E9: F13 and F12/F14 reached; no "new here" note while episodes, live saves or an open task
  exist.

### P0-3. Durable statements have no single current version and no trust boundary

- **Symptom.** Withdrawn truths stay current; the model can delete the user's rules, write facts into every project,
  and keep its own bad actions as high-confidence procedures; constraints said in prose fade.
- **Root cause.** Corrections and change-describing entries are exempt from contradiction checks (`reflection.ts:532,
  534`); human entries never fade and never retire; `memory_delete` and `memory_write scope:"user"` skip the authority
  rules the gate enforces on writes; the gate admits state claims and destructive, PID-specific procedures; importance
  is by source, not by kind, so a constraint written by a model fades.
- **Code.** `reflection.ts:512-538`; `tools.ts:830-839,880-904`; `memory/gate.ts:304-431`; `dynamics.ts:53-59,70-74`.
- **Consequence.** A year of history becomes a set of contradictions and self-poisoned procedures; a record built on
  them inherits both.
- **Proof.** `TEST` P5, P6, P7, year E9-E12 standing rules, `offline-only` archived; `DB` the Stop-Process procedure
  and the server-running claim.
- **Fix class.** Patches plus one rule: every durable statement has one current version per subject; only its
  author's tier can retire it; constraints do not fade; state claims and process-specific destructive commands are
  not admitted.
- **Exit criterion.** P5 shows one current storage statement; P6 refuses; P7 keeps project facts in their project; a
  red-team set of poisoned candidates (PID kills, "server is running", injected instructions) is refused through every
  write channel; the privacy constraint survives the year.

### P0-4. Verification decays as the project ages, and learning starves with it

- **Symptom.** Correct work is reported `[Not verified]`; history says "unverified"; memory stops growing; the code
  accumulates indirection to dodge protection; a request the tests do not exercise passes as verified.
- **Root cause.** Test protection decides by request wording, not by whether a change weakens a test; protected exits
  skip reflection; intent coverage is the model's job outside dense requests.
- **Code.** `contract/test-protection.ts:16-32`; the test-protection block and `recordUnlearnedTurn` in `agent.ts`; `agent.ts:3036`.
- **Consequence.** Every downstream signal (episode outcomes, memory credit, reflection, skills, a future record's task
  status) is fed by a verdict that is wrong more often as the test suite grows.
- **Proof.** `TEST` year: 6/10 held, 5 wrongly; variant `tests-allowed` (memory doubles); P9; `RUN` the false "June
  broke tests" history and the shims.
- **Fix class.** Refactor of the protection decision (judge the change's effect on the old tests), truthful outcome
  labels ("passed; held by test protection"), and a "partly verified" outcome for behaviors nothing exercised.
- **Exit criterion.** Year epochs E4, E5, E7, E9, E10 end verified without the user's wording; E6-style weakening and
  doc 15's test-weakening probes are still caught; P9 ends "partly verified".

### P0-5. The request is not reconciled with standing intent, or with itself

- **Symptom.** A request that breaks a constraint is planned without a word; a request that forbids changes ends with
  changes; the only structured stop is a single text field.
- **Root cause.** No host step compares the request with constraints, non-goals and decisions before work; no
  representation of the request's own limits ("without changing anything", "only investigate"); the completion gate
  treats any mutation (a dependency install included) as the model's change to be repaired.
- **Code.** no reconciliation step exists (`agent.ts:2669-2997` assembles the turn); gate and contract repair in
  `agent.ts:4027-4300`; `tools.ts:1454-1465` (`report_blocker`).
- **Consequence.** Long-horizon intent fidelity: the agent can do the wrong thing correctly, verified.
- **Proof.** `RUN` conflict-ultra-full and -bare (0 of 2 raised the privacy conflict); `RUN` cold start (read-only
  request edited after three host repair requests).
- **Fix class.** New host step (deterministic matching against the record first; a bounded model check where matching
  cannot decide) plus a structured escalation; a read-only request suspends repair.
- **Exit criterion.** The conflict request escalated before work in 3/3 runs on two free models; no unnecessary
  escalation on the year's ordinary requests; a read-only request never ends with changes the model did not make
  willingly, nor with a host-requested repair.

**P1** (needed soon): the crash journal (the round and the request lost, no interrupted-call marking, no re-run
safety); the decision prompt's lowest-30 slice, hidden `why` and rotting scopes; the 40-per-type rule cap; one
workspace key; a concurrency-safe memory index; a failed-approaches log; stale- and history-doc signals (and loading
`CLAUDE.md`); long-horizon evals in the test chain; cross-session task ids and trace retention for open tasks; real
use of Shelra on one of the owner's projects (execution plan F9), the evidence this audit could not find.
**P2**: split `agent.ts`; delete the write-only stores or give them readers; entropy checks; skills measured before
extended; provider switches on resumed sessions (doc 19).

## 23. Definitive roadmap

Dependency-ordered; each phase produces what the next consumes. The Round 3 review moved delivery of what already
exists to the front: it is cheap, it is harness code, and it shows how much of the gap remains before a new subsystem
is sized.

```
Phase 0 measure ─► Phase 1 deliver what exists ─► Phase 3 project record (escalón) ─► Phase 4 reconcile + escalate
                   Phase 2 trust + verification that ages (in parallel with 1) ──┘          │
                                                    Phase 5 learning on the record ◄────────┤
                                                    Phase 6 scale and entropy ◄─────────────┘
```

### Phase 0. Measure the long horizon

- **Problem.** No regression test sees cross-session behavior; real use never crossed a day.
- **Target.** Every change shows its effect on a year in about 30 seconds, at small and at realistic volume.
- **Architecture.** `bench/long-horizon/` (built by this audit): layer 1 with thresholds and the superseded-as-current
  count; a volume variant (≥ 300 routine episodes); the digest counterfactual as the bar any record must beat; the ten
  probes as assertions; layer 2 as the primary exit (k ≥ 3, two free models, written keys, a second grader).
- **Dependencies.** None. **Migration.** Commit the folder; `bun run bench:long-horizon`; record today's numbers in
  `bench/history/`.
- **Exit.** Layer 1 reproduces §15.1; probes reproduce §6.4 and §7; a layer-2 batch (reconstruction and continuation,
  2 models × 3) recorded with method.
- **Not to build.** A dashboard; an LLM grader.

### Phase 1. Deliver what Shelra already has

- **Problem.** P0-2, the delivery half of P0-1, the labelling half of P0-4, the read-only half of P0-5.
- **Target.** What exists reaches the next session, labelled truthfully.
- **Architecture.** Continuations get the packet, the last episodes with their summaries, live and interrupted turns
  and the last verdict, and never the "new here" note while those exist; plans persist per workspace and
  `update_plan_step` works across turns and sessions; outcomes say "passed; held by test protection" instead of
  "unverified", and such exits still reflect; a request that forbids changes suspends check repair.
- **Dependencies.** Phase 0. **Migration.** Additive; no store changes format.
- **Exit.** P0-2's exit; year E9 F12-F14 reached; P1 probe passes; the cold-start request ends without host-requested
  edits. Then measure what is left against the volume variant before sizing Phase 3.
- **Not to build.** A prompt line telling the model to read `episodes.jsonl` (a guarantee belongs in harness code);
  embeddings.

### Phase 2. Trust and verification that ages (parallel with Phase 1)

- **Problem.** P0-3; the refactor half of P0-4.
- **Target.** One current version per statement, a trust boundary on every write channel, and a "verified" that stays
  true and frequent as tests grow.
- **Architecture.** Correction chains supersede; "we no longer want/need X" captured; `memory_delete` refuses human
  entries; user-wide writes limited to preferences; constraints never fade; state claims and process-specific
  destructive commands refused; test protection judges the change (added tests and assertions pass; a test deleted
  with the behavior the request removes passes; removed assertions, skipped tests and changed expectations still
  block); "partly verified" for behaviors nothing exercised.
- **Dependencies.** Phase 0. **Migration.** Existing protection tests stay and gain cases.
- **Exit.** P0-3's and P0-4's exits.
- **Not to build.** An LLM judge of tests; mutation testing on every turn.

### Phase 3. The project record (the next escalón, §24)

- **Problem.** The derivation half of P0-1: at realistic volume no recency view carries the year.
- **Target.** A fresh session, after weeks or a crash, on any model, knows the objective, the requirements,
  constraints, non-goals and decisions in force, the tasks with status and evidence, what failed and what was
  interrupted, and resumes the right task.
- **Architecture.** §24.
- **Dependencies.** Phases 1 and 2 (a record fed by mislabelled verdicts and leaky supersession would be wrong).
- **Migration.** The ledger's one-file-per-item format and approval flow are the template; published plans become
  tasks; episodes stay as the raw history the record links to; `objective_tasks` becomes the index of the record's
  tasks or is deleted; the `--autonomous` rebuild decided in doc 14 §25.8 uses the same task store instead of
  `autonomy/journal.ts` (one task store for both paths).
- **Exit.** P0-1's exit; the brief's Test A and Test B as layer-2 runs, k = 3, two free models.
- **Not to build.** A database server, a workflow engine, a vector store, a second plan system.

### Phase 4. Reconcile requests with intent; escalate precisely

- **Problem.** P0-5.
- **Target.** "Back up to Google Drive" in an offline product stops before work with a precise question.
- **Architecture.** A host step before round 1 compares the request with the record's constraints, non-goals and
  active decisions (deterministic matching first, a bounded model check only where matching cannot decide); conflicts
  and read-only requests produce a structured escalation (what, why, what was verified, options, trade-off, decision
  needed, default, what is safe meanwhile); changes of intent become record changes with supersession.
- **Dependencies.** Phase 3. **Exit.** P0-5's exit.
- **Not to build.** An ambiguity classifier in the system prompt.

### Phase 5. Learning on top of the record

- **Target.** Repeated experience becomes stable knowledge where it belongs: a decision, a requirement, a check, a
  skill, or a memory entry for what the repository cannot tell.
- **Architecture.** Memory keeps only non-derivable facts; constraints and requirements live in the record;
  consolidation proposes record changes for approval; failed approaches are recorded per task.
- **Dependencies.** Phase 3. **Exit.** With-memory vs without on epochs whose facts are not in the files
  (DreamBench-style), k = 3, an interval excluding zero; the poisoning red team refused.
- **Not to build.** Auto-installed skills; more forgetting-curve tuning.

### Phase 6. Scale and entropy

- **Target.** The record and memory stay small and correct after hundreds of decisions and tasks; code health does
  not erode.
- **Architecture.** Record compaction (closed tasks summarized, links kept); decision selection by scope and recency;
  trace retention for open tasks; optional structural checks (size and duplication budgets); doc 19 for provider
  switches.
- **Dependencies.** Phases 3-5. **Exit.** A synthetic record of 1,000 decisions and 500 tasks keeps the year's
  numbers.
- **Not to build.** Microservices, distributed queues, multi-agent swarms, event sourcing of every step, cloud sync.

**Not to build at all yet** (evidence in `20-evidence/research-long-horizon.md`): a vector database or temporal
knowledge graph (lexical and agentic search compete; graph gains are vendor-measured and contested); a workflow
engine (even mature ones are at-least-once across crashes; a local journal suffices); more memory dynamics (the year
shows the curve forgetting the wrong things); multi-agent orchestration (doc 15); unreviewed autonomous memory
rewriting; exactly-once promises for shell commands.

## 24. Next escalón

**The single capability: a durable, host-derived project record.** Shelra keeps, versioned with the code, a small
record of the project's current intent and work: the objective and its non-goals, requirements and constraints in
force, the decisions in force (the existing ledger), tasks with status, acceptance criteria and evidence, the
approaches that failed, and what was interrupted. The host derives it from what it observes at turn boundaries (a plan
published, a check passed or held, a verdict, a crash recovered, a decision approved, an intent changed), never from
the model's word alone; the user approves what becomes intent. Every session's first request is built from it,
continuations included, and its size does not grow with the length of the project's history.

It changes Shelra's category because it moves continuity from "whatever the next model rediscovers" to state the
harness owns, the move doc 15 made for "done" inside a turn, made for the project across turns. The evidence converges
on it: every December gap in §15 is a fact that is in the log but not in the context; a recency view of the log loses
all of them within days of ordinary work; the best real reconstructions came from models doing by hand the derivation
the record would do for every model.

**Challenged against simpler options.**

- *Deliver the log (Phase 1).* Measured: complete at 12 epochs, empty after 30 routine turns. Necessary, not
  sufficient; it is Phase 1.
- *Store intent as memory entries.* Memory is lexical, capped, fading and model-written; the year shows each of those
  losing intent.
- *Rely on the model to read the repository.* Strong models often can (the bare runs, the continuation run); the same
  models often do not (the full runs). A weaker model can less. The harness should hand every model the same state.
- *A progress file the model maintains* (Anthropic's feature list, Codex's Plan/Documentation files, `WEB`). It works
  for a disciplined model; Shelra's principle is that guarantees live in host code, so the host derives the record
  from evidence and the model proposes.
- *Revive `objective_tasks` or `AutonomyKernel`.* Their schemas are reusable; their problem was that nothing on the
  live path wrote or read them. The record is defined by its readers (every session's opening context) as much as by
  its writers.

**Design constraints from the evidence.** One file per item, like the ledger, so branches and two terminals merge
instead of colliding; keyed to the git root; bounded opening context (selection by relevance and status, not
recency); every entry with its source, time, status and supersession link (`WEB` StateMemBench, Zep); approval for
anything instruction-level.

**The supporting capabilities:**

1. **Continuation context** (P0-2, Phase 1): continuations and resumes rebuilt from the record, git state, the last
   episodes and the interrupted turn.
2. **Supersession and trust** (P0-3, Phase 2): one current version per subject across rules, decisions and intent, and
   a trust boundary on every write channel; the record inherits both.
3. **Verification that ages** (P0-4, Phase 2): task status and evidence come from verdicts that stay true as tests
   grow.
4. **Request reconciliation and precise escalation** (P0-5, Phase 4): the record is consulted before work, not only
   after.
5. **Permanent long-horizon evaluation** (Phase 0): the year at two volumes, the probes and real-model batches with
   written keys.

**Owner decisions it needs** (product direction, not settled here): whether the record lives versioned in the
repository like `docs/decisions/` or locally under `.shelra/`; whether requirements and non-goals need the user's
approval as decisions do; whether added tests and assertions may pass test protection without the request asking.

## 25. Elite exit criteria

All on free models, k ≥ 3, written keys, results in `bench/history/`:

| Capability | Metric | Elite target |
| --- | --- | --- |
| Understand | intent items reaching the next session (year, both volumes) | ≥ 95% |
| Ground | continuations whose first request carries state (packet + record) | 100% |
| Specify | stated behaviors with an executed check | ≥ 90% (doc 15 §17.3) |
| Plan | tasks surviving crash, session and model change | 100% in the year |
| Execute | turns surviving provider failures | doc 15 target kept |
| Observe reality | user-visible apps opened by the host when changed | doc 15 target kept |
| Verify | false completions (reported done, oracle failed) | ≤ 2% per free tier |
| Repair | first-attempt failures converted | ≥ 60% |
| Continue across sessions | layer 2: the continuation resumes the right task without redoing work | 3/3 on two free models |
| Preserve knowledge | superseded statements shown as current | 0 |
| Learn | with-memory vs without on non-derivable epochs | an interval that excludes zero |
| Escalate | conflicts raised before work / unnecessary escalations on ordinary requests | ≥ 90% / ≤ 10% |
| Respect the request | read-only requests ending with changes; unrequested-change rate | 0 / measured and falling |
| Deliver intent | year-end reconstruction (key of 12) | ≥ 11 on two free models, full arm ≥ bare arm |

**One-year definition of done.** Shelra may claim "it can maintain a complex software project for one year without
losing its mission, critical context or engineering reliability" only when all of these hold, published with method:
(1) the Year-in-a-Box layer 1 reaches ≥ 9/10 December facts **with 300 routine turns added** and shows 0 superseded
statements as current; (2) layer 2 on two free models, k = 3: reconstruction ≥ 11/12 with the full arm at least as good
as the bare arm, the continuation after a crash resumes the right task without redoing work, the conflict request is
escalated before work, and the read-only cold start makes no change; (3) a longer synthetic year (≥ 50 epochs, ≥ 100
decisions, ≥ 3 model or provider changes) keeps those numbers; (4) false completions ≤ 2% on the silent suite across
the year's epochs; (5) one real project of the owner worked on with Shelra for at least eight weeks (this document's
target; execution plan F9 asks for one week), with every continuation context and escalation logged, and no week in
which the owner had to re-explain the project's purpose, a decision in force or the open work.

## The final five questions

1. **If every active conversation disappeared today, could Shelra recover this project correctly tomorrow?** Not
   reliably. On its own repository a strong free model, starting cold, recovered the recent commits and answered the
   objective, the architecture and the open work from history documents (about 2 of 6), because the current objective
   lives in `CLAUDE.md`, which Shelra does not load, and nothing marks history docs as history except prose. On a
   project with a clean repository and an episode log, strong free models recovered most of the picture (8-12 of 12),
   but only by reading raw files the harness does not hand them.
2. **Over a year, can Shelra tell decisions still valid from superseded ones?** For approved decisions, yes: the
   ledger supersedes and the prompt shows only active ones (though the 30 lowest ids, without their `why`). For
   everything else, no: the user's own corrections all stay current ("Use SQLite instead of JSON files" next to "Use
   DuckDB instead of SQLite" in every late epoch), changes of intent are not captured, and constraints written by a
   model fade.
3. **Can Shelra recognize that it does not have enough evidence instead of hallucinating?** For "is the work done",
   largely yes within a turn when the project states checks, with gaps (P9's silent pass). For "what is true about this
   project", no host mechanism exists: retrieval tells the model "treat it as new here" when it finds nothing, the
   model reported a false history from mislabelled episodes, and stale documents were trusted as current.
4. **Can Shelra prove the result satisfies the user's original and current intent?** It can prove that the project's
   checks pass on the final code. It cannot connect that to intent: requirements and non-goals are not persisted,
   coverage of the request by the checks is not checked outside dense requests, and requests are not reconciled with
   standing constraints (0 of 2 runs caught the privacy conflict).
5. **If the model is replaced tomorrow, what intelligence remains because of Shelra?** The per-turn guarantees: the
   host-owned definition of done, test and check protection, smoke and URL checks, loop, stall and circle detection,
   destructive-command policy, spend limits, provider resilience, rule injection and decision enforcement. Across
   sessions, almost nothing that a model does not have to rebuild by reading: the continuity measured here belonged to
   the model's diligence, not to Shelra.

## Appendix A. Evidence index and how to reproduce

All commands from the repository root; no model quota unless noted. Details and run list: `20-evidence/README.md`.

| What | Command | Output |
| --- | --- | --- |
| Year-in-a-Box, layer 1 | `bun run bench/long-horizon/year-in-a-box.ts [--ablate memory\|ledger] [--variant tests-allowed\|resume]` | `bench/long-horizon/results/<label>.json` (includes the digest counterfactual) |
| A state for real runs | `bun run bench/long-horizon/year-in-a-box.ts --stop-after 11` (or 8) | a kept scratch folder |
| Probes P1, P3-P11 | `bun run bench/long-horizon/probes.ts [P4 …]` | `bench/long-horizon/results/probes.json` |
| Real-model turn (free quota) | `bun run bench/long-horizon/real-run.ts --state <root> --model <id> --prompt-file bench/long-horizon/prompts/<name>.txt [--ablate bare] [--date …]` | `bench/long-horizon/results/real/<label>.json` |
| Session-boundary trace | — | `20-evidence/forensic-state.md` |
| External research | — | `20-evidence/research-long-horizon.md` |

## Appendix B. Where documentation, memory and code disagree (found by this audit)

1. `CLAUDE.md` "active decisions go into every request": the 30 lowest ids, read from the shell's cwd (`TEST` P4, P8).
2. AGENTS.md "the user's standing rules, facts and corrections reach every request": 1,500 characters in full, 40 per
   type stored, the rest dropped or listed (`TEST` P3).
3. AGENTS.md "`--ablate research` turns it off" (and `smoke`, `diagnose`): `--ablate` exists on `shelra bench` only
   (`CODE` `index.ts:1742-1767`, `:1920`).
4. AGENTS.md "Every turn that did work records an episode … however it ended": agent mode only; a killed process
   records one only through a live save, at the next agent-mode turn in that folder.
5. README "`--session latest` picks up where you left off" and `openSavedSession`'s comment (`agent.ts:1386-1391`)
   "plan state and task kernel come back, and the next turn goes on from them": the plan cannot be updated in the next
   turn and the kernel is discarded (`TEST` P1).
6. README "Use `/compact` in TUI": no such command.
7. Doc 18 §4.4 lists `validFrom` and `invalidated`: no `validFrom` field; nothing sets `invalidated`.
8. Doc 18 §4.3 says the plan joins the memory query: it does not (`agent.ts:2888`).
9. Doc 15 §21 (row "0.3 Small fixes") records dead code as removed: four dead files remain (§17).
10. `agent.ts:1109-1111` ("what is this session doing right now becomes a query against objectives"): the rows are
    restored only into the same session's kernel and discarded at the next turn; no other reader exists.
11. AGENTS.md "Memory stays fresh while a turn works": true on disk; the next model sees the live save only as an
    episode, by word overlap (`TEST` E9).
12. AGENTS.md calls `docs/architecture/00`-`13` history; nothing in the files themselves says so, and a cold-start
    model used `00` and `10` as current (`RUN`).
