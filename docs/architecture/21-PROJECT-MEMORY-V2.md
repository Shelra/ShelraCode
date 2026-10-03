# 21. Project Memory V2: from a failure log to project knowledge

Status: built and measured on the branch `memory-v2`, 2026-10-03 (phases A `2dc3433`, B `cd203d8`, C `9ffd899`, D
`be0c3a3`; the blocker stop the real-model runs exposed, `757a004`). Written after the long-horizon audit (doc 20). A first design (types renamed, a `state.json`, subject-keyed
supersession, a separate memory-commit call) was reviewed adversarially before any of it was built and replaced by the
smaller design below; §6 says what was dropped and why. The owner's decisions (2026-10-03): memory stays local in
`.shelra/` (git-ignored, per machine); one local commit per phase on `memory-v2`; intent taken from the user's messages
becomes current only with a verbatim quote the host finds; up to a day of free-model quota for the real-model runs.

## 1. The question, answered from code and tests

**Would a year on one repository make Shelra progressively more knowledgeable about it? Before this work, no.**

- **What memory held after real use.** Every project store on the owner's machine after 330 sessions: 6 active entries
  in 3 stores. Two were host-observed failure lessons, four were model inferences (two test residue, one a procedure
  that killed a hard-coded process id, one a claim that a dev server "is running"). 546 reflection audit records, almost
  all "did not qualify". 9 episodes.
- **The Year-in-a-Box** (doc 20 §15; `bench/long-horizon/year-in-a-box.ts`): with an ideal scripted model, the December
  session received 5 of 10 facts the year established, and a withdrawn rule as current.
- **The brief's evaluations** (`bench/long-horizon/memory-evals.ts`, `results/memory-evals-before.json`): 5 of 11
  passed.

## 2. Why memory "remembered errors"

In count, memory held almost nothing. By design, the only paths that wrote durable knowledge without a model were
literal user directives and host-observed failure lessons:

| Writer | Model? | Fired on | Wrote |
| --- | --- | --- | --- |
| user directives (`extractUserDirectives`) | no | every turn | literal "always/never/remember that/use X instead of Y" sentences |
| host failure lessons (`deterministicFailureCandidates`) | no | a failing command a later command gets past | `failure` |
| consolidation | no | daily | failures repeated across turns |
| episodes | no | every working turn | history, not knowledge |
| reflection (`reflectOnTurn`) | yes | only a turn that ended verified or with failing checks; never one held by test protection | up to 5 entries |
| `memory_write` | the model's choice | rarely (2 calls in 3,635) | anything |

Success, intent, progress and documents depended on one optional model call that most real exits skipped. Test
protection made it worse as a project aged: in the Year-in-a-Box 6 of 10 working months were held, and each wrote
failures and nothing else. There was no representation of intent, of where work stood, or of the project's documents.

## 3. Data flow

Before:

```
user message ──► regex directives ──► gate ──► .shelra/memory/<slug>.md + MEMORY.md
tool results ──► failure→recovery ──► gate ──► failure lessons
turn end ──► episode ──► only if verified/failing checks: reflection ──► gate ──► entries
next request ──► lexical ranking over entries ──► PROJECT MEMORY
             └─► ledger: the 30 lowest-numbered active decisions ──► DECISIONS
```

After:

```
user message ──► regex directives + correction chains (adopted vs dropped) ──► gate ──► entries
                 └─► the session's own words kept for quote checks (never the host's nudges)
tool results ──► failure→recovery ──► gate ──► failure lessons
             └─► plan published / step updated ──► session plan ──► live save, episode snapshot
turn end (verified, failing checks, or held by test protection with passing checks) ──► reflection
             ──► quote check (user's words → human, tag intent) ──► labels (unverified, held) ──► importance
             ──► gate ──► entries
next request ──► rules and intent (always) ──► ranked entries ──► past attempts ──► open plans
             ──► first request or "continue": lessons + latest turns ──► PROJECT DOCUMENTS (pointers, stale flags)
             └─► ledger: active decisions by relevance then recency, why of the top 3, what is no longer in force
"continue" in a new session ──► the newest open plan becomes the session's plan
```

## 4. Principles

1. **Memory is not chat history and not documentation.** History is a source (episodes, transcripts); documentation
   stays authoritative and is indexed as pointers; memory holds what neither gives cheaply.
2. **Where work stands is derived, not stored twice.** Plans are snapshotted with the turn that worked on them; the
   open ones are derived from those snapshots when a request needs them.
3. **Guarantees in host code.** The host decides what becomes durable and how it is labelled; a model proposes. A
   statement attributed to the user carries a quote the host finds in what the user typed.
4. **Learn on every exit the host can trust, labelled truthfully**: verified, unverified (failing checks), held (test
   protection, checks passed).
5. **One format.** Every record is readable by the installed release; new meaning lives in tags.
6. **No new infrastructure without evidence**: local files, the existing lexical engine, no embeddings, no server. The
   CLI never depends on a server (`CLAUDE.md`); Supabase serves only the separate account service in `backend/`.

## 5. What was built

### 5.1 Stores (under the session root's `.shelra/memory/`, unchanged)

| Store | What | Written by |
| --- | --- | --- |
| `<slug>.md` + `MEMORY.md` | knowledge records | the gate only |
| `episodes.jsonl` | what happened per turn, now with the plan snapshot (title, goal, step statuses, criteria) | the host |
| `live/` | the turn in progress, now with the plan snapshot | the host |
| `docs.json` | the document index (§5.4), written only where the store already exists | the host |
| `archive.jsonl`, `history.jsonl`, `reflections.jsonl`, `versions/` | as before | as before |
| `docs/decisions/*.md` | decisions (the ledger, versioned in the repository) | the model proposes, the user approves |

### 5.2 Records

The v1 types (`MemoryType`) and statuses stay. The installed 1.1.8 rewrites every entry it recalls with only the keys it
knows and reads an unknown status as current, so a new field or status would be deleted, or turn into current truth, the
first time the owner ran the released binary on the same project. New meaning is in tags, which 1.1.8 keeps:

| Tag | Meaning | Set by |
| --- | --- | --- |
| `intent` + `evidence:quote` | the project's purpose, a constraint or a non-goal, in the user's verified words; reaches every request with the standing rules | the quote check (§5.5) |
| `held` | learned in a turn test protection held although its checks passed | reflection |
| `unverified` | learned in a turn whose checks still failed, or a change nothing checked | reflection |
| `user-directive`, `correction` | the user's literal rules and corrections | directives |

Authority is the source: `human` (the user's words, quote found) > `observed` > `inference` > `web`. An inference never
rewrites a human record.

### 5.3 Where work stands: open plans

A session's plan (published with `generate_plan`, updated with `update_plan_step`, restored with a saved session) is
snapshotted into the turn's live save and episode. At turn start, the open plans are derived from the whole episode log
(only lines that carry a plan are parsed): per plan title, the latest snapshot, kept when a step is not done, at most
three, newest first. A plan whose turn ended on its own without moving any step is not open: its work may be done, and
"to do" would be a guess. Every request sees them as "Open plans in this project"; a request to continue ("continue",
"sigue", "where we left off") in a session without a plan adopts the newest one: its steps with their statuses and its
acceptance criteria become the session's, shown as a host `generate_plan` result, so `update_plan_step` goes on from
there. Any other request starts clean (`cross-turn-criteria.test.ts` keeps a previous session's intent out of it).

### 5.4 Document knowledge (`src/memory/docs-index.ts`)

The files git lists (tracked, or untracked and not ignored) at the root, in `.github/`, and in `docs/`, `doc/`, `adr/`,
`spec(s)/`, `rfcs/`, up to five levels, at most 300; the ledger's folder is left out. Each entry: path, title, first
paragraph, headings, size and modified time (a document that did not change is not read again), kind (instructions,
readme, spec, guide, history, changelog), and the backticked repository paths it names that are gone. A process reuses
its index for 30 s. Every turn gets a `PROJECT DOCUMENTS` block: the root README's first paragraph (what the project says
it is), up to three documents the request is about, and a pointer to an instruction file written for another agent
(`CLAUDE.md`, `GEMINI.md`, `.github/copilot-instructions.md`: "AGENTS.md wins where they differ"; never loaded).

A document is flagged `may be stale` when:

- it still states a word the project dropped and never the word that replaced it, and was not edited since: the dropped
  words come from the ledger (a superseded decision's title against the active decision at the end of its chain) and from
  memory (the "Replaces: … (true until …)" notes of a current entry and of the entries it replaced, back along
  `supersedes`); a word any current record or active decision still uses is not a dropped one; words are compared by
  their first four letters ("storage" and "store" are one word); the oldest replacement is reported;
- or two or more of the repository paths it names in backticks, and at least a third of them, are gone (a log that
  names hundreds of current files and a few removed ones is a record, not a stale description).

On this repository: 95 documents, about 100 ms cold and 60 ms warm, 6 flagged (history, audit and plan documents that do
name removed or never-built files).

### 5.5 End-of-task learning

There is still one model call per qualifying turn, the reflection; no second "memory commit" call was added. Changes:

- **Held turns reflect.** A turn test protection holds (it changed tests that existed before the request) whose checks
  passed now reflects; the prompt says Shelra held it and to keep what the commands showed about the project, never that
  the change was right. Its records are tagged `held`, confidence at most 0.55. Turns held for changing the checks'
  definitions, turns a Stop hook refused, `report_blocker` and cancels still do not reflect.
- **Quote-verified intent.** A reflection item may carry `quote`: the user's exact words. The host looks for it in what
  the user typed this session (at most 20 messages; pasted code blocks and `>` lines removed; the host's own nudges are
  user-role messages and are never searched). It counts when it has at least 20 characters, three content words and at
  most 300 characters, and appears word for word after folding case, accents, quotes and spacing. Then the quote is the
  record's hook and the top of its body, the source is `human`, and it is tagged `intent` and `evidence:quote`; it reaches
  every request with the standing rules. A quote that is not there is dropped and the item stays an inference.
- **Hard-won lessons stay.** A failure or known-problem lesson from a turn in which a command failed and the same command
  later passed gets importance 0.75, which `dynamics.ts` never fades by disuse. Without it, the Year-in-a-Box's June
  decimal-comma lesson faded by October in a project worked on once a month.
- **The gate refuses** claims about what is running right now, procedures that kill a process by number or run a command
  the destructive-command guard stops, secrets and instruction-shaped text (unchanged). `memory_write` to the user-wide
  store accepts only preferences; `memory_delete` refuses records the user stated.

### 5.6 Supersession

- **By slug**: a reflection item may name the existing slug it replaces (`supersedes`, chosen from the enumerated
  "ALREADY SAVED" list); the old record leaves the index with its file kept, and the new one says what it replaced.
- **Correction chains**: "Use DuckDB instead of SQLite" retires a current human record whose adopted value is SQLite
  ("Use SQLite instead of JSON files"), and "we no longer want/need X", "we're dropping X" are corrections too.
- **Decisions**: the ledger prompt lists active decisions by relevance to the request then newest first (at most 30),
  the `why` of the three most relevant, and a "No longer in force" line naming up to five superseded decisions and what
  replaced them; decisions are read from the session's root, where the gate enforces them.

### 5.7 Retrieval

The memory section, in order: standing rules and verified intent (always); entries ranked for the request; past attempts
at similar requests; open plans; on a session's first request and on a request to continue, the three most important
lessons not already shown and the three latest turns; the documents block. The "treat it as new here" note is never
given to a request to continue or in a project with open work. Sizes measured on the Year-in-a-Box (§9.3): about
2,500 characters on a continuation, 2,300 on an ordinary request.

### 5.8 Isolation and authority

A project's records stay in its store: `memory_write` with `scope: "user"` stores anything other than a preference in the
project instead, and says so. Memory, the ledger prompt and the ledger gate key to the session's root folder. Re-keying
memory to the git root is deferred (§6).

### 5.9 Migration

None is needed: the file format did not change, a v1 store is a v2 store, and the installed 1.1.8 can still read and write
a store this branch wrote. What v1 records lack (provenance, quotes) is not invented: they keep their source.

## 6. Dropped after review, and why

| First design | Outcome | Why |
| --- | --- | --- |
| Seven new record types and new statuses, with a migration | dropped | the installed release deletes unknown fields and reads unknown statuses as current; only 4 of 12 types are branched on |
| Supersession keyed by a free-text `subject` | dropped | free text misses (duplicates) or over-matches (silently retires a user's constraint); slugs and correction chains cover the measured cases |
| `state.json` with one current plan | dropped | concurrent sessions lose updates; a routine turn's small plan would replace a half-done refactor; it duplicated episodes and live saves |
| A separate memory-commit model call | folded into reflection | a second free-model request per turn for the same digest |
| An `unverified` status | a tag instead | `currentOnly` would drop it while it filled the index |
| Automatic ledger proposals from memory | not built | decisions are versioned files in the user's repository and need the user's yes |
| Re-keying memory to the git root | deferred | paths in records are root-relative and the workspace guard confines file tools to the launch folder; no failing evaluation needed it |
| Supabase as the memory store | not built | the CLI never depends on a server; Supabase serves only `backend/` |

## 7. Evaluations

- `bench/long-horizon/memory-evals.ts`: the brief's eleven tests (cold start, continuation, superseded decision,
  correction retention, isolation, documentation retrieval, stale documents, success procedure, failed approach,
  consolidation, noise), deterministic, through the real agent with a scripted ideal model.
- `bench/long-horizon/year-in-a-box.ts`: one project lived for a year in twelve sessions; variants `routine-plan` (a
  routine turn with a finished plan of its own after the half-done refactor) and `volume` (300 routine turns recorded
  before the continuation).
- `bench/long-horizon/real-eval.ts`: real free models, with and without memory, on the year's December state.

## 8. Source-of-truth order

When sources disagree, Shelra trusts, in order: the user's current request; active decisions the user approved; what the
host observes now (code, tests, git); the project's instruction files; current documentation (unless flagged stale);
active memory records by authority (human, observed, inference); episodes (history); model inference. Superseded records
explain the past and are never followed.

## 9. Results

Every phase was verified with `bun run typecheck`, `bun run lint`, `bun run format` and `bun run test` (1,289 Vitest
tests and the Bun-only suites at the end), and each behavior change has a test that fails without it.

### 9.1 The brief's evaluations (`memory-evals.ts`, deterministic, scripted ideal model)

| Evaluation | Before | A | B | C | D |
| --- | --- | --- | --- | --- | --- |
| cold-start project recall (12 facts) | 5/12 | 9/12 | 10/12 | 11/12 | **12/12** |
| cross-session continuation | 3/6 | 6/6 | 6/6 | 6/6 | **6/6** |
| superseded decision | 1/2 | 2/2 | 2/2 | 2/2 | **2/2** |
| user-correction retention | 1/1 | 1/1 | 1/1 | 1/1 | **1/1** |
| project isolation | 0/1 | 1/1 | 1/1 | 1/1 | **1/1** |
| documentation retrieval | 0/1 | 0/1 | 0/1 | 1/1 | **1/1** |
| stale-document detection | 0/1 | 0/1 | 0/1 | 1/1 | **1/1** |
| successful procedure | 1/1 | 1/1 | 1/1 | 1/1 | **1/1** |
| failed approach | 1/1 | 1/1 | 1/1 | 1/1 | **1/1** |
| consolidation | 2/2 | 2/2 | 2/2 | 2/2 | **2/2** |
| noise resistance | 1/1 | 1/1 | 1/1 | 1/1 | **1/1** |
| **passed** | **5/11** | **8/11** | **8/11** | **10/11** | **11/11** |

A: correction chains, the gate's new refusals, user-scope and delete limits, the decisions prompt, continuations.
B: open plans. C: the document index. D: held reflection, quote-verified intent, orientation, hard-won lessons.

### 9.2 Year-in-a-Box (facts the first request of a new session receives; ideal scripted model)

| Run | E9 continue | E10 CSV task | E11 why DuckDB | E12 continue, keep decisions | Total | Superseded shown as current |
| --- | --- | --- | --- | --- | --- | --- |
| before | 3/8 | 3/5 | 3/5 | 5/10 | 14/28 | 1 per request |
| A | 5/8 | 3/5 | 4/5 | 7/10 | 19/28 | 0 |
| B | 6/8 | 3/5 | 4/5 | 8/10 | 21/28 | 0 |
| C | 8/8 | 4/5 | 4/5 | 10/10 | 26/28 | 0 |
| D | 8/8 | 5/5 | 4/5 | 10/10 | **27/28** | 0 |
| D, routine plan after August | 8/8 | 5/5 | 4/5 | 10/10 | 27/28 | 0 |
| D, 300 routine turns before E9 | 8/8 | 5/5 | 4/5 | 10/10 | 27/28 | 0 |

The fact still missing (E11, F8) is the rationale of the superseded SQLite decision (Postgres rejected: it needs a
server): the decisions prompt names a superseded decision and what replaced it, not its `why`; the file holds it.

**What it costs**: the first request of a new session grew from 6.6-8.1k characters to 9.7-11.0k. The memory and
documents block of a session's first request is 2.8-4.1k characters (rules 0.5k, ranked entries, past attempts 0.5k,
open plans 0.5k, latest turns 0.8k, documents 0.4-0.7k).

### 9.3 Real free models, with and without memory

`bench/long-horizon/real-eval.ts` on the year's state after epoch 11 (simulated date 2026-12-15), the same request with
memory and with `--ablate memory`, three samples per arm, one run at a time, on two free models: 36 runs, plus 2 smoke
runs of the driver (`results/real/v2/`). Points summed over the three samples:

| Task | Model | With memory | Without memory | Mean time with / without |
| --- | --- | --- | --- | --- |
| reconstruct (12-item key) | nemotron-3-ultra-550b | **31/36** | 20/36 | 87 s / 55 s |
| reconstruct (12-item key) | qwen3.8-27b | **33/36** | 26/36 | 58 s / 31 s |
| continue (5 checks on the workspace) | nemotron-3-ultra-550b | **12/15** | 5/15 | 97 s / 526 s |
| continue (5 checks on the workspace) | qwen3.8-27b | **15/15** | 9/15 | 44 s / 60 s |
| conflict (2 checks) | nemotron-3-ultra-550b | **6/6** | 0/6 | 14 s / 625 s |
| conflict (2 checks) | qwen3.8-27b | **6/6** | 4/6 | 17 s / 94 s |

- **Reconstruct**: the items memory adds are the half-done refactor (K9), what went wrong (K10, the interrupted
  September turn), the rules that hold (K11) and the requirement change (K7). Both arms miss K6 (the superseded SQLite
  decision's rationale), as the deterministic year does. Graded by patterns; one answer of each arm was read by hand and
  agrees.
- **Continue**: with memory the model adopted the open plan and finished it: qwen's three runs ended `[Checked by Shelra
  …]`; nemotron's moved the tax summary to `src/reports` and kept a one-line re-export at the old path because the
  protected test imports it there, which the strict check "old file gone" counts as a miss. Without memory the models
  did not know of the refactor: nemotron tried to wire DuckDB for real, added a dependency the user's rule forbids, and
  ended blocked after 7-11 minutes.
- **Conflict**: with memory both models stopped within 10-31 seconds, citing the user's quoted constraint. Without it,
  nemotron built the Google Drive upload every time (one run even ended `[Checked by Shelra …]`, its chosen check being
  that `package.json` names `googleapis`), and qwen did in one of three runs (twice it found the README's "Nothing leaves
  your machine" on its own).

### 9.4 What the first real-model run found

A free model asked for a Google Drive backup in the December state cited the user's verified constraint ("Nothing may
leave the user's machine") and reported a blocker, then kept working in the same generation: it installed `googleapis`
against the user's rule about dependencies and built the upload. The host acted on `report_blocker` only when the whole
generation ended. Fixed in `757a004`: the step that reports a blocker ends the generation. The gate held where it
applied: the model's attempt to rewrite the user's `offline-only` record was refused ("a human-stated memory is only
revised by the human"), and the decision it wrote stayed a proposal awaiting approval.

## 10. Remaining risks

- **Unused inferences still fade, architecture facts included.** In a project worked on once a month, the DuckDB
  architecture entry and the CSV-import entry were archived by December (doc 18 §4.6: being shown is not use). The facts
  survive through the user's rules and the ledger, and a matching request is offered the archived entry back, but the
  detail fades. Hard-won lessons no longer fade; other facts may need a slower curve for sparse projects.
- **The brief is larger** (§9.2). Doc 20 found the bare prompt as good as the full one at reconstruction with one free
  model; §9.3 is the measurement that counts. The review's 1,200-character budget for ordinary requests is not enforced.
- **The ideal model is scripted.** Held reflection and quote-verified intent need a model that proposes the right items
  and copies the user's words exactly; a free model may paraphrase, and a paraphrase stays an inference.
- **Open plans can go stale.** A plan whose work was finished in a turn that never updated its steps stays open until a
  later snapshot of it marks the steps done; only a plan with no step moved at all is excluded.
- **Lexical retrieval** still ranks by shared words (with an English-Spanish lexicon); a request that shares no word with
  a fact gets it only through the always-on tiers (rules, intent, open plans, orientation).
- **Rules are still prompt text where the host has no check.** "Never add a dependency without asking" reached the model
  and was cited, and the model broke it within the same generation; the blocker stop limits that case, but no
  deterministic guard watches `package.json` for new dependencies.
- **Not built**: re-keying memory to the git root; memory-to-ledger proposals; a separate success-lesson type; the stale
  document flag for paths relative to a sub-package (`frontend/src/...` named as `src/...`).
