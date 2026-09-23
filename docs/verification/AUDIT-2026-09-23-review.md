# Review of `docs/AUDIT-2026-09-23.md`

Shelra wrote the audit in a live run on 2026-09-23 (session `84c3480c9ffd`, `nemotron-3-ultra-550b-a55b:free`,
72 tool calls in this repository) from the prompt "do a broad audit of the project, a deep research plan and
a market validation; search the web for context; review all the current code". This page records how
true it is, checked the same day against the code at `f0e4eb9` and the public sources it cites.

## Verdict

The inventory of what exists is accurate; most of the conclusions are not. Of about 106 checkable
claims, 38% are true (eight of them are line counts), 22% stale, 16% false, 17% misleading and 8%
unverifiable. The technical-debt list repeats `docs/architecture/14-AGENT-HARNESS-RECONSTRUCTION.md`
§2-§4 and §20, written on 2026-09-12/13, and presents it as current; six of the seven first-phase
roadmap items are already done, and the seventh goes against a recorded decision (§25.8).

## What the run shows about Shelra

- The model stream stalled three times; each time the turn resumed from its completed steps (the
  resilience rule held).
- The completion gate blocked twice: the model "verified" its acceptance criteria by re-reading its own
  report, which the gate does not count. `docs/verification/AC1_architecture_analysis.txt` is a copy of the
  report's own module table whose "Source:" line cites the report; it evidences nothing.
- Research followed stale documents over the code, and web figures were used without opening the
  primary source (the market table matches one AI-written blog post label for label), against the
  research rule in `AGENTS.md`.

## False, stale or misleading claims

Repository claims were checked in the code; the public figures were read on 2026-09-23 and may change.

| Claim (report line) | Class | Evidence | Correct statement |
| --- | --- | --- | --- |
| "#4 on OpenRouter's coding agents ranking (435B tokens)" (13) | False | `src/providers/openrouter.ts:187`: Shelra sends a title but never an `HTTP-Referer`, which OpenRouter's app attribution needs; the report's own ranking table (113-119) lists other apps | Shelra cannot appear in OpenRouter's app rankings; the figures quoted are daily totals of other apps |
| "21 risks (2 Critical, 8 High, 11 Medium)" (16) | False | `docs/architecture/08-RISK-REGISTER.md` | 3 Critical, 14 High, 4 Medium, in the phase-0 register, which has no status column |
| "11 excluded suites requiring bun:sqlite", "~380+ tests" (16, 195-197) | False / stale | the `test` script in `package.json` | 15 files skip the Vitest pass and 12 of them run later in the same chain under `bun test`; about 830 test cases |
| The completion gate has "zero observers" (52, 172, 258, 340) | Stale | `src/agent/agent.ts` completion gate; the TUI reads the kernel state | The gate is enforced: it asks up to three times, then reports `[Not verified …]` (this run shows it) |
| No objective-to-session link; plans lost at compaction; no cross-turn criteria (54-56, 183, 259-264) | Stale | `src/storage/migrations.ts`, `src/storage/plan-state.test.ts`, doc 14 | Built and tested |
| Effort picker unread; memory project-only without confidence or staleness (180-188, 262-263) | Stale | `src/memory/retrieval.ts`, `src/agent/agent.ts` (project and user-wide memory on every turn) | Fixed |
| "Unify the kernel vocabulary" (50, 171, 261) | Stale | doc 14 §25.8 | The recorded decision is to retire `AutonomyKernel` and rebuild `--autonomous` on `Agent.processMessage` |
| "No live real-model test" (176) | Stale | doc 14 §23-§25, `bench/field/SCOREBOARD.md` | Real-model runs and a field case are recorded |
| Computer use and Telegram "deferred" (190) | False | `src/index.ts`, `src/agent/agent.ts` | Both ship as opt-in features |
| "Open-source the core", "add a paid policy" (277, 289) | False premise | `LICENSE`, the spending policies in `src/index.ts` | The repository is public under MIT; paid policies and spend caps exist |
| "0 to 85 overall" on the core suite (15) | Misleading | doc 14 §23.4-§23.5, `bench/README.md` | Runs #8 to #11; 0 is the floor applied below 70 coding; coding went 50 to 81 and tasks 1/8 to 5/8, one model, one sample |
| "Lint/Format: clean" (199) | Misleading | the CI runs on `main` | Clean locally; CI stops at its format check (line endings, see `AGENTS.md`) |
| Stop-blocking hooks, memory authorship, Telegram, computer use, a free tier as "unique" (124-128, 235, 344) | False | the public docs of Claude Code, Codex, aider and Gemini CLI | Other agents already offer these |
| "If Cursor or Claude Code adds a terminal mode" (132, 314) | False | cursor.com/blog/cli | Cursor's CLI shipped in 2025; Claude Code is a terminal tool |
| SWE-bench "82% vs ~58%" (135), Devin, Cline and Aider figures (101-103) | False | the vendors' pages and model cards | The quoted numbers do not match their sources |
| 84%, 51%, 29%, 64% as 2026 figures (87-92) | Misleading | Stack Overflow Developer Survey 2025; a Cisco 2025 study | 2025 data; the 64% surveyed privacy and security staff, not developers |
| Market share, ARR and TAM (14, 98-100, 210) | Misleading / false | CB Insights (Dec 2025) | The 70% is of a smaller market; some ARR figures are not public; the TAM sums overlap |
| Personas, pricing and revenue targets (214-332) | Misleading | `PRODUCT.md` | No audience beyond the maintainer is confirmed; pricing and usage data are not to be invented |

## True, and worth keeping

- The eight module line counts match the code within a line, and there are 134 test files.
- The completion gate blocks a change that has no verification.
- Memory has provenance, a write gate and a capped index (`src/memory/store.ts`).
- The recovery mechanisms exist: the credential fallback, the empty-step retry and provider quarantine.
- The benchmark drives the real chat path.

## What the report leaves out

- The recorded objective (`CLAUDE.md`): solve real tasks, free models first, with its best evidence
  (field case 001, solved by a free model on its first answer).
- What the gate proves: that a successful command matched a verification pattern, not that the code is
  correct.
- The one measurement of memory: 4 of 6 runs passed with memory, 1 of 9 without, on one fixture
  (doc 14 §24.3).
- That product direction and spending, which its roadmap sets, are the owner's decisions.
