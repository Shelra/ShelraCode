# 17. Engineering lifecycle audit: `addyosmani/agent-skills` against Shelra (2026-09-24)

This document answers one question: **which ideas in `addyosmani/agent-skills` would make Shelra more
reliable, more autonomous, more verifiable and less dependent on the model, and how should they
enter Shelra without turning it into a collection of prompts?** It audits that repository's
DEFINE → PLAN → BUILD → VERIFY → REVIEW → SHIP lifecycle against Shelra's own loop, Intent →
Specification → Plan → Execution → Reality → Verification → Repair, and against the evidence in
[doc 15](15-INTELLIGENCE-AUDIT-AND-ROADMAP.md).

It proceeds in three rounds. Round 1 (§3-§4) establishes what the external system is and how it
compares. Round 2 (§5) attacks both systems. Round 3 (§6) designs what Shelra should use.

## 0. Method, scope and evidence labels

- **External repository.** `github.com/addyosmani/agent-skills` at `bcab6a1` (2026-09-22, version
  0.6.10, 569 commits since 2026-02-15). It was cloned into a scratch folder, read file by file
  (all 25 skills, 4 personas, 7 references, 9 commands and their three host copies, the hooks, the
  eval cases, the scripts, the docs), and its own offline validators and tests were run. Nothing was
  installed into Shelra or into any agent.
- **Shelra.** The working tree at `04a1ee8`. The live path (`src/index.ts` → `Agent.processMessage`)
  was traced in code and its always-on prompt measured offline. Doc 15 (2026-09-23) and its §21
  implementation status are the baseline. This audit does not repeat that work; it updates it where
  the code has moved.
- **What was not done.** No model call, no benchmark run and no product code change during the
  audit; line citations are at `04a1ee8`. The fix of the loophole S10 that followed it is described
  in §6.14 (commit `9e05f87`). The F4 re-measure scheduled for 2026-09-25 00:05Z was left alone.

Labels follow doc 15, with two added for the external repository:

| Label | Meaning |
| --- | --- |
| `CODE` | Shelra source at the cited line: what the code would do. |
| `TEST` | Shown by Shelra's tests or by an offline script run for this audit. |
| `RUN` | Measured in a benchmark run (`bench/history/benchmark-history.json`). |
| `DOC` | Stated in Shelra's documentation only. |
| `EXT` | Read in `agent-skills` at `bcab6a1`, cited `agent-skills:<path>:<line>`. |
| `EXT-RUN` | The output of `agent-skills`' own validators or tests, run offline for this audit. |
| `WEB` | An external source, dated (Appendix C). |
| `INFERENCE` | The auditor's reasoning from the above, stated as such. |

## 1. Verdict

**What `agent-skills` is.** It is a curated library of engineering procedure written for a model to
read. It contains:

- 25 Markdown workflows totalling 340,210 characters, with a median of 13,545 per skill;
- four reviewer personas and seven checklists;
- nine slash commands, kept in three host-specific copies;
- a CI that lints the Markdown's shape and checks, with a lexical TF-IDF score, that each skill's
  description matches the prompts its authors wrote for it.

Its "lifecycle" is a naming convention shared by skills and commands. It is not a state machine,
and no component observes whether a phase happened. Of everything its README calls enforced
("red-green-refactor, enforced", "Decide it once, enforce it everywhere"), no mechanism runs by
default:

- the only blocking code is two hooks that a user must wire by hand;
- its behavioural evals force the skill into the prompt, have an LLM grade the trace, and have no
  arm without the skill;
- the only measurement that compares with and without the skill is two anecdotal plugin runs. In
  them, the review skill fired in 5 of 7 runs and the TDD skill in 2 of 7 (§3.14).

**What it gets right.** It has a sharp model of the failures an agent commits under pressure:

- skipping the failing test;
- weakening the bar to reach green;
- accepting its own review of its own work;
- filling ambiguity silently;
- losing state between sessions.

It also names concrete counter-moves: a diff-scoped guard against weakening, fail-before/pass-after
proof, fresh-context adversarial review, a handoff record at session boundaries, a log of discarded
attempts, and a definition of done kept separate from acceptance criteria.

**What Shelra should do with it.** Shelra's rule is that guarantees live in deterministic harness
code (`CLAUDE.md`; doc 15 §14.2 P5). Every strong idea above is worth adopting only in that form:

- as host code that observes the workspace, runs checks and decides;
- or as optional procedure text that is measured before it stays.

Shelra should not import the skills as a pack, the meta-skill router, the six-command lifecycle, the
personas' fan-out, the anti-rationalization tables, or the multi-host scaffolding (§6.13). The
synthesis in §6 turns the lifecycle into states the host owns, with explicit backtrack edges and
memory at every state. It picks five adoptions (§6.12).

The next step is the floor guard's first slice (§6.14): fix the definition of done at the start of
the turn. This audit reproduced a turn that passes Shelra's contract by rewriting its own test
script (S10). The adversarial challenge of stated behaviours targets the false completions Shelra
actually measures, but it must first pass an offline pre-test, because the model it would check
already tested the failing behaviour under its own misreading.

## 2. Shelra today, as the code runs it

Doc 15 §2 and §4 reconstructed the loop at `7b433b0`. Its §21 fixes changed several rows. At
`04a1ee8` the live path does this (`CODE` unless marked):

| Link | What happens on the live path | Host or model | What persists | Where |
| --- | --- | --- | --- | --- |
| Intent | The request is kept verbatim. "Always/never" sentences become human-sourced memory without a model call. Active approved decisions are injected. | host captures, nobody interprets | transcript, `.shelra/memory`, `docs/decisions` | `agent.ts:2410-2425`, `memory/reflection.ts:58-98`, `ledger/prompt.ts:17-31` |
| Specification | There is no spec artifact. Two things come close: optional plan criteria, and a requirement checklist extracted from obligation sentences (English and Spanish, at most 10). The checklist triggers one audit round when the request names three or more behaviours. | host triggers, model writes | criteria for the session; the checklist is not kept | `agent/requirements.ts:14-72`, `toolset/tools.ts:1187-1257` |
| Plan | `generate_plan` is optional. Its one host-enforced part: each criterion's `command` runs once when the plan is published, and a command that did not pass then joins the contract as a task check. Step statuses are whatever the model reports; nothing orders execution by the plan. | model, plus a host probe | yes, for the session and across resume | `tools.ts:1295-1302`, `agent.ts:3246-3252` |
| Execution | 24 tools, hardened; destructive shell commands ask in the TUI and are blocked headless; fresh-context sub-agents with no nesting and no gate; skills as a name-and-description catalog read on demand. | model chooses, host hardens | transcript; per-turn attempt journal | `tools.ts:201-1480`, `security/destructive.ts`, `utils/skills.ts:198-233` |
| Reality | Workspace state from `git status` plus sizes and mtimes, taken at turn start, after each passing check and at the end, so shell writes count. | host | the verdict row | `agent/workspace-state.ts` |
| Verification | When the project states its checks, the host runs them (test, type-check, lint) on the final code, adding plan task checks and the checks of approved decisions in scope. It reuses an unchanged run of the agent's own. Without stated checks, a real check program must have run after the last change. Pre-existing tests are protected. | host | the verdict in the transcript | `contract/*`, `agent.ts:3055-3549` |
| Repair | Up to 3 rounds. Each gets the parsed failures, the regressions named, the files the attempt changed, `restore_file`, and maximum reasoning effort when the same failures repeat. Then an honest `[Not verified — …]`. | host triggers, model repairs | the note only; the journal is in memory | `agent.ts:3319-3446`, `contract/failures.ts` |
| Review | None independent. `/review` sends a fixed prompt to the same agent and model, and the kernel's `reviewPassed` always equals `verificationPassed`. | — | — | `ui/app.tsx:313-335`, `agent/kernel.ts:102-119` |
| Ship | `/commit-push` and `/commit-pr` are prompts. There is no CI watch, deploy or rollback. `shelra decisions check` can run in any agent's hook or CI. | model | — | `ui/app.tsx:337-347`, `ledger/cli.ts` |
| Learn | After a qualifying turn: one bounded reflection call, then a deterministic write gate. Credit is +1 when the contract passed and −1 when its rounds ran out. A procedure with credit ≥ 2 is promoted to `.agents/skills/<slug>/SKILL.md`. | model proposes, host decides | `.shelra/memory`, `.agents/skills` | `memory/*`, `agent.ts:3600-3606, 3741-3779` |

Measured, with one sample per cell unless k is given (`RUN`, doc 15 §6):

- On the core suite, free Nemotron 3 Ultra resolved 7 of 8 tasks at the audit, and 21 of 24 at k = 3 on the F4 code
  (`e9c776e`, 2026-09-24), against 23 of 24 for the baseline. This tree is re-measured on 2026-09-25.
- Every false completion in those F4 runs (both arms) has the same shape: **a stated requirement the
  project's visible tests did not cover, missed while those tests passed** (doc 15 §6.3 item 3,
  §6.6).

The session records show two distinct causes behind that shape:

- **Task `06-bounded-queue` (two of the three).** The model *did* exercise the abort requirement
  itself. Its audit table reads "Abort at 50ms → only 1 item started, rejects with reason | ✅ Stops
  new work". But it read "stop starting new work after an AbortSignal is aborted" as "reject the
  call". The oracle reads it together with "settle every item": the call must resolve with every
  item's result (`bench/oracles/shelra-agent-core-v0.2.ts:220-234`).
- **Task `08-workflow-orchestrator` (one).** A failure in how retry, dependencies and concurrency
  interact, which none of the model's per-behaviour checks exercised.

So the measured failure is **the agent's reading of an under-specified request, and the interactions
between behaviours, where the visible tests are silent**. It is not the absence of a check. That
matters for what can fix it (§6.14).

## 3. Round 1: the architecture of `agent-skills`

### 3.1 Components and how each host wires them

| Component | Contents | Size | Wiring (`EXT`) |
| --- | --- | --- | --- |
| `skills/` | 25 `SKILL.md` workflows plus a few supporting files | 340,210 chars of bodies; 50,655 bytes of supporting files | Claude Code: `.claude-plugin/plugin.json:11-12` (`"skills": "./skills"`). Codex: `.codex-plugin/plugin.json:12`. Copilot and Gemini find `skills/` by convention. |
| `agents/` | Four persona prompts: code-reviewer, test-engineer, security-auditor, web-performance-auditor | 24,540 bytes | Discovered by convention as Claude Code subagents (`AGENTS.md:84`). Frontmatter holds only `name` and `description`: no model, tools or skills. |
| Commands | 9 commands, each in three copies (`.claude/commands/*.md`, `commands/*.toml`, `.gemini/commands/*.toml`) | 17,593 bytes per copy | `scripts/validate-commands.js:10-18` checks names and descriptions across the copies. It does not compare bodies (`:15-17`). |
| `references/` | Definition of done; checklists for testing, security, performance, accessibility and observability; orchestration patterns | 67,293 bytes | Linked from skills as plain text paths such as `` `../../references/definition-of-done.md` `` |
| `hooks/` | `session-start.sh`, the `sdd-cache` pair and `simplify-ignore.sh`, each with a test | 68,456 bytes | **None is active after installing.** There is no `hooks.json`, and the manifest has no `hooks` key. Each must be wired by hand in `.claude/settings.json` (`hooks/SDD-CACHE.md:13-47`). |
| `evals/` | 25 case files, each for one skill, plus 2 plugin cases | 88 positive and 52 negative trigger prompts, 33 behavioural evals | Run by `scripts/run-evals.js` (§3.14) |
| `scripts/` | Skill lint and validators for commands, reference links, artifact paths and versions | 13 files | Run by CI (`.github/workflows/test-plugin-install.yml`) |

`EXT-RUN`: every validator passes. The skill lint reports "25 skills checked — 0 error(s)", and the
routing evals report "rank-1 rate: 100% (88/88)". The node tests: 107 pass.

### 3.2 How a request actually flows

The architecture the README draws is USER REQUEST → COMMAND → SKILL SELECTION → WORKFLOW → QUALITY
GATES → SPECIALIST REVIEW → VERIFICATION → SHIP. What runs is simpler (`EXT`, `INFERENCE`):

```
request ─┬─ user types a command ─► the command's prompt: "Invoke the agent-skills:<skill> skill"
         │                          plus a condensed restatement of its steps
         └─ no command ───────────► the host lists every skill's description; the model decides
                                    whether to load a body (Claude Code's Skill tool, Codex, …)
                ▼
       the model reads Markdown and, if it complies, follows it:
       writes SPEC.md, tasks/plan.md and tasks/todo.md, runs tests, ticks checklists
                ▼
       /review: a skill in the same context
       /ship:   three personas as subagents in parallel, merged by the main context
                ▼
       "verification" and "gates" = checklists the model ticks; "GO" = the human
```

No step is observed by anything except the model and the human. The platform supplies what isolation
there is: subagents with their own context, and no nesting of subagents.

### 3.3 The six phases

| Phase | Purpose | Input → output | Gate: what proves it, who checks | Failure → backtrack as written | Skills, command | State left behind |
| --- | --- | --- | --- | --- | --- | --- |
| DEFINE | Turn intent into requirements | Request → statement of intent, one-pager, `SPEC.md`, `CONSTRAINTS.md` | An explicit human "yes" (`interview-me:113-122`); the human reviews each spec phase (`spec-driven-development`). Checked by the human. | Assumptions filled silently → surface them. An interview that does not converge → "step back" with the user (`interview-me:140`). | interview-me, idea-refine, spec-driven-development, constraint-driven-development; `/spec`, `/constraints` | Optional files: `SPEC.md`, `docs/intent/`, `docs/ideas/`, `CONSTRAINTS.md` |
| PLAN | Dependency-ordered, verifiable tasks | Spec → `tasks/plan.md` and `tasks/todo.md` | Each task has acceptance criteria and a verification step, and the human approves the plan (`planning-and-task-breakdown:242-253`). Checked by the model's own checklist, then the human. | XL tasks → split. An existing unfinished plan → stop and ask (`:150-155`). | planning-and-task-breakdown; `/plan` | Markdown checkboxes |
| BUILD | Thin slices, test first | Next unchecked task → code, a test, a commit per slice | The increment checklist (`incremental-implementation:199-209`). Checked by the model. | A red test → the debugging skill. A missing requirement → stop and ask (`context-engineering:279-297`). | incremental, TDD, context, source-driven, doubt-driven, frontend, API; `/build`, `/build auto` | Commits; ticked boxes |
| VERIFY | Prove it works | A slice → passing tests and runtime evidence | "A task is not complete until verification passes… there must be evidence" (`using-agent-skills:110-112`). Checked by the model. | Stop the line → reproduce, localize, reduce, fix, guard (`debugging-and-error-recovery:21-34`) | TDD (listed under Build in `CLAUDE.md:23` and under Verify in `using-agent-skills:180`), browser-testing, debugging; `/test` | A regression test |
| REVIEW | A quality gate before merge | Diff → findings by severity and a verdict | "Don't approve code with Critical issues" (`agents/code-reviewer.md:94`). Checked by the same model in a persona. The human makes the final call (`code-review-and-quality:205-220`). | "Model A addresses the feedback" → back to BUILD, implicitly | code-review, simplification, security, performance; personas; `/review`, `/code-simplify`, `/webperf` | None: the review lives in the conversation |
| SHIP | Safe release | Reviewed change → GO/NO-GO, rollback plan, monitoring | `/ship` fans out to three personas and says NO-GO on any Critical finding (`.claude/commands/ship.md:71`). The pre-launch checklist is ticked by the model; GO is the human's. | Trigger conditions → rollback (`shipping-and-launch:251-278`) | git-workflow, ci-cd, deprecation, documentation, observability, shipping; `/ship` | Commits, changelog, ADRs |

Every gate in the table is either the model's own checklist or a human's yes. None is an observation
of the workspace by something other than the model.

### 3.4 DEFINE

| Question | Answer (`EXT`) |
| --- | --- |
| Does it tell an idea from a requirement? | Yes, by skill: `idea-refine` diverges and converges on a concept; `interview-me` extracts intent; `spec-driven-development` writes requirements. |
| Does it detect ambiguity? | Only by the model's judgment, prompted by a confidence number (`interview-me:40-51`) and by "surface assumptions" (`using-agent-skills:49-61`). |
| Does it produce acceptance criteria? | Yes, as prose: "Success Criteria… specific, testable conditions" (`spec-driven-development`). The "make the dashboard faster" example shows a reframing into measurable targets. |
| Are constraints explicit? | Yes, in two places: Always / Ask first / Never in the spec, and `CONSTRAINTS.md`, where every numbered row must name the command that produces the verdict ("A dimension with a number and no command… is an aspiration", `constraint-driven-development:123-124`). |
| Are assumptions recorded? | Surfaced in chat ("ASSUMPTIONS I'M MAKING… Correct me now"); recorded only if the spec file is written. |
| Are non-goals recorded? | Yes: "Out of scope" is a non-negotiable line of the intent restatement (`interview-me:111`), and idea-refine outputs a "Not Doing list". |
| Can an agent know DEFINE is done? | By a human's explicit yes. `interview-me`'s stop test ("can I predict the user's reaction to the next three questions?", `:134-140`) is a self-assessment. |
| How is drift from the spec detected later? | It is not. "Keeping the Spec Alive" asks the agent to update the spec first and to reference it in PRs (`spec-driven-development:210-217`). No mechanism compares the code or the plan with the spec. |

DEFINE requires a live human at every step. `interview-me:36` and `constraint-driven-development:36-38`
say not to run in non-interactive contexts; `using-agent-skills:65-73` says "STOP… Wait for resolution".

### 3.5 PLAN

The planning skill is the most concrete in the repository. Each task carries:

- a one-paragraph description;
- acceptance criteria and a verification step;
- its dependencies;
- the files likely touched;
- a size (XS to XL, where XL means "break it down").

Checkpoints come every 2-3 tasks. One rule protects work in progress: an unfinished plan for
different work is never overwritten; the agent stops and asks (`planning-and-task-breakdown:150-155`).
Parallelism is described but not executed.

**Does the plan control execution?** No. The plan is `tasks/todo.md`: checkboxes the model ticks.
`/build` reads the next unchecked task because its prompt says so (`.claude/commands/build.md:35`).
Nothing checks that:

- a ticked task's verification ran;
- the diff stayed within the task's files;
- the order followed the dependencies.

Rollback appears as a property of increments ("independently revertable",
`incremental-implementation:174-181`). It is not a step of the plan. This is the same finding doc
15 §8 made for Shelra's `generate_plan`: a planner that produces Markdown and does not control
execution.

### 3.6 BUILD

Seven skills share this phase because it is where the model does most of its work. Their overlaps,
with the owner of each concern, are as follows (`EXT`, `INFERENCE`):

| Concern | Skills that address it | Overlap |
| --- | --- | --- |
| Slice size and order | incremental-implementation, planning | complementary |
| Test first; red → green; Prove-It | test-driven-development, debugging (the "guard" step), doubt-driven (a TDD RED "is the doubt step for behavioral claims", `:227`) | the same idea stated three ways |
| Simplicity and scope discipline | using-agent-skills §4-5, incremental Rules 0 and 0.5, code-simplification | duplicated nearly word for word |
| The right context | context-engineering, source-driven-development | complementary, but `AGENTS.md:60-62` lists "I'll gather context first" as a thought to ignore |
| Doubt about one's own decisions | doubt-driven-development, code-review's multi-model pattern | different timing, the same mechanism |

BUILD does describe the right loop, *small slice → implement → validate at once → update state*:

- the increment cycle, Implement → Test → Verify → Commit (`incremental-implementation:21-42`);
- "more than 100 lines of code written without running tests" as a red flag.

The loop is still carried entirely by the model's compliance.

### 3.7 VERIFY: an independent reality check, or another prompt?

Another prompt. Across all 25 skills, evidence is gathered by the model running commands and reading
their output:

- **Tests, build, lint, type-check:** the model runs the repository's commands (`test-driven-development:24-34`).
- **Browser, DOM, console, network:** through the Chrome DevTools MCP (`browser-testing-with-devtools`).
- **Logs and runtime:** the model reads them (debugging, observability).
- **API and database:** only if the model probes them.
- **External behavior:** the post-launch checks, done by a human (`shipping-and-launch:225-236`).

Nothing compares the result with the specification except the model's own checklist. The
repository's strongest defence against a model grading itself is doubt-driven development, a
fresh-context reviewer (§3.19), and that reviewer is another model reading text.

Shelra's standard is SPECIFICATION → EXECUTION → REALITY → COMPARISON with the comparison made by
the host. `agent-skills` implements the first three through the model. It leaves the comparison to
the same model, or to a human.

### 3.8 The repair loops

| Failure | What the repository says | Explicit or implicit | Enforced? |
| --- | --- | --- | --- |
| A test fails | Stop the line: reproduce, localize, reduce, fix, guard, verify (`debugging-and-error-recovery:21-34`). In `/build auto`: stop when no fix is obvious (`build.md:36-37`). | explicit, local to one skill | no |
| The build fails | The same triage (`:188-197`) | explicit | no |
| An assumption is wrong | "STOP. Name the confusion. Ask." (`using-agent-skills:65-73`; `context-engineering:253-297`) | explicit, and only with a human present | no |
| The spec is incomplete | "Update the spec first, then implement" (`spec-driven-development:214`) | implicit: no detection | no |
| The implementation drifts from the spec or plan | nothing | missing | — |
| Review rejects the change | "Model A addresses the feedback" (`code-review-and-quality:205-220`) | implicit edge to BUILD; none to PLAN or DEFINE | no |
| A doubt finding holds | Classify it (contract misread, actionable, trade-off, noise); change and re-loop; at most 3 cycles, then escalate to the user (`doubt-driven-development:168-191`) | explicit and bounded | no |
| An optimization is neutral or worse | "Neutral is a revert"; log every attempt, including reverted ones (`performance-optimization:366-401`) | explicit | no |
| A production check fails | Trigger conditions and rollback steps (`shipping-and-launch:251-278`) | explicit, as a human procedure | no |

The loops exist as prose, each inside one skill. There is no global graph of where a failure sends
the work. There is no edge from VERIFY or REVIEW back to PLAN or DEFINE except "stop and ask a
human", no global bound, and no state that records which loop the work is in. The only bounded loop
is doubt-driven's three cycles.

### 3.9 REVIEW: skill versus persona

- **A skill is procedure** that the working agent follows in its own context. `code-review-and-quality`
  gives five axes, a severity scale, "review the tests first" and "verify the verification".
- **A persona is a role** with an output format, run as a subagent with its own context window, which
  returns only its report (`docs/agents.md:76,110`). The composition rules: the user or a command
  orchestrates; personas never call personas; the one endorsed multi-persona pattern is `/ship`'s
  fan-out and merge (`AGENTS.md:78-80`).

**Is a persona's critique independent?**

- **Context, partly.** The persona does not inherit the author's reasoning. Where the host has no
  subagent tool, though, the personas run "sequentially" in the main context (`ship.md:19`), and then
  there is no independence at all.
- **Model, no.** The personas set no model, so they run on the same model, with the same blind
  spots. The one place the repository reaches for another model is doubt-driven's optional
  cross-model escalation through the Gemini or Codex CLIs, offered to the user and never automatic
  (`doubt-driven-development:112-166`).
- **Evidence, no.** A persona reads the diff and reports. The code-reviewer's template asks "Build
  verified: yes/no", which the persona answers by reading, not by running.

The repository also drifts on its own severity labels:

- `/review` asks for "Critical, Important, or Suggestion" (`.claude/commands/review.md:15`);
- the skill and the persona use Critical, Required, Optional and Nit (`agents/code-reviewer.md:49-57`).

### 3.10 SHIP

SHIP is more than `git push`. It covers:

- atomic commits and semantic versioning;
- CI quality gates, and feeding CI failures back to the agent;
- feature flags and staged rollouts with thresholds;
- rollback plans with trigger conditions;
- an error-budget release gate;
- expand/contract migrations;
- runbooks and symptom-based alerts;
- post-launch checks in the first hour.

All of it is human-operated procedure the agent is asked to follow or to set up. "Feeding CI
failures back" is a copy-and-paste loop (`ci-cd-and-automation:164-192`).

What Shelra needs now:

- commit hygiene, which it already has as owner rules and as the `/commit-*` prompts;
- `shelra decisions check` as a CI step, which exists (F8).

Deploy, rollout, monitoring and production verification belong to projects Shelra works *on*. They
become Shelra's concern only if Shelra ever watches a deployed system, which is not in the execution
plan.

### 3.11 The meta-skill `using-agent-skills`

It routes by a phase-shaped decision tree (`:16-43`) and adds six "non-negotiable" behaviours
(`:45-114`). It has four weaknesses:

- **Trigger quality.** It depends on the host showing the model 25 descriptions and the model
  choosing. The repository's own measurements show that choosing fails. The review skill fired in 5
  of 7 runs; TDD fired in 2 of 7 on a test-first prompt; three plain review phrasings fired nothing
  in 6 runs (`evals/README.md:53`, Claude Code 2.1.278 with claude-opus-5, never in CI).
- **Conflicts and priority.** "Multiple skills can apply", and a feature may chain eight of them
  (`:137`). Nothing sets priority when two conflict, as when `interview-me`, `idea-refine` and
  `doubt-driven` all claim "stress-test my plan".
- **Cost of unnecessary activation.** The OpenCode rules say to invoke a skill on "even 1% chance"
  and to ignore "I'll gather context first" (`AGENTS.md:51-62`). That maximizes activation, and
  every activation reads a 10-20 KB body.
- **Fallback.** None. When no skill fits, the tree says nothing. The optional SessionStart hook that
  would inject the meta-skill in full (10,540 bytes) is deliberately not wired upstream, because it
  "would run a second router on top of the native one" (`hooks/session-start.sh:5-8`).

Shelra, by comparison, lists name, description and path, and the model reads the body with
`read_file` (`utils/skills.ts:216-233`). There is no router and no priority, which is the same
progressive disclosure without the meta-skill. Neither system measures whether the right skill was
read.

### 3.12 Skill anatomy

Frontmatter, then Overview, When to Use, Process, Common Rationalizations, Red Flags and Verification.
The lint requires five of those headings (`scripts/lib/skill-lint.js:45-51`), a "Use when" trigger
and a description of at most 1,024 characters. It sets no size limit: the "under 500 lines" advice
is unchecked, and the largest skill has 497 lines.

The docs call the layout "a recommended pattern, not a rigid template"
(`docs/skill-anatomy.md:45`). The lint makes it rigid.

Each principle, assessed:

- **Process, not prose.** The strongest principle. A skill that ends in commands and exit criteria
  can be checked; an essay cannot.
- **Anti-rationalization tables.** They name real failure moves: "I'll test it later", "the failing
  test is probably wrong". No eval in the repository measures whether the tables change behaviour.
  They cost roughly 10-15% of every body (`INFERENCE` from the section sizes).
- **Verification.** Every skill ends in a checklist whose items the model ticks. The shape is right
  and the checker is the author.
- **Progressive disclosure.** It works as far as the host's loader works: descriptions always, bodies
  on demand. It breaks where skills point at shared references (§3.13).

### 3.13 References and portability

Shared checklists live in `references/` so that skills stay short and the same checklist is written
once. Skills name them as plain text relative paths (`` `../../references/definition-of-done.md` ``,
`using-agent-skills:114`).

**Portability.** Installing one skill copies only `skills/<name>/`, so every `../../references/`
path points at nothing. This is documented (`README.md:61-66`, issue #361;
`docs/getting-started.md:165-167`) and open. The validator's history records the earlier failure:
"All 18 links across 11 skills resolved to files that do not exist… agents… hit a file-not-found and
stalled" (`scripts/validate-reference-links.js:8-13`). The validator now passes because it checks
only the full repository layout.

The repository's own rules disagree on where skill-specific reference material goes. `CONTRIBUTING.md:63`
says "Don't put reference material inside skill directories"; `docs/skill-anatomy.md:14,177`
endorses `skills/<name>/references/`.

**Lesson for Shelra.** A skill must be self-contained. A shared file that a skill needs at runtime
is a hidden dependency that breaks the first time the skill is moved, promoted or installed alone.

### 3.14 Evals

| Tier | What it tests | Grader | Deterministic? | In CI? |
| --- | --- | --- | --- | --- |
| Schema | Each skill has ≥ 3 positive trigger prompts, ≥ 2 negative ones and ≥ 1 behavioural eval (`run-evals.js:52-54,351-354`) | script | yes | yes |
| Routing | A TF-IDF cosine over descriptions, skill-name tokens weighted ×2. A positive prompt must rank its skill in the top k; a negative must not rank it first, and its named owner must outrank it. Two descriptions at ≥ 75% similarity fail; the rank-1 floor is 95% (`:104-149, 293-379`). | script | yes | yes |
| Behavioural | `claude -p --append-system-prompt "Follow this skill exactly:\n\n<SKILL.md>"` in a fixture; a second `claude -p` grades the trace against expectations (`:49, 562-593`) | LLM judge | no | no |
| Plugin | `claude plugin eval` with and without the plugin: 2 cases (review fires; review stays quiet on a TDD prompt) | tool-used grader, a regex and an LLM | partly | no |

These evals measure the text, not engineering success:

- **Routing.** It measures whether a description's vocabulary matches prompts its authors wrote. "Not
  a real host router" (`evals/README.md:22`).
- **Behavioural.** It forces the skill into the system prompt, so it measures compliance, not
  routing. There is no run without the skill. The judge reads "tests pass" from the trace, and no
  script re-runs the tests; the workspace is deleted afterwards (`run-evals.js:602-606`).
- **Results.** None are published: `evals/results/` is gitignored, and the ledger of rejected changes
  (`evals/skill-impact.md`) is an empty table.
- **The only with/without numbers** are the anecdotes of §3.11.

The discipline is worth keeping:

- every skill has cases;
- negative triggers name the skill that should win instead;
- description collisions fail the build;
- rejected changes go into a ledger.

The measurement is not. Shelra can establish the rule "every important skill has an evaluation" only
with evaluations that measure outcomes on the product path (§6.9).

### 3.15 Hooks: instruction versus enforcement

| Hook | Event | What it does | Blocks? | Bypass |
| --- | --- | --- | --- | --- |
| `session-start.sh` | SessionStart | Injects the whole meta-skill as context | no | Not wired upstream on purpose |
| `sdd-cache-pre.sh` | PreToolUse (WebFetch) | On an HTTP 304 it serves the cached documentation page by exiting 2 | yes (exit 2) | Fails open without `jq` or `curl`; SSRF hardening is open (#295) |
| `sdd-cache-post.sh` | PostToolUse (WebFetch) | Caches the fetched page | no | — |
| `simplify-ignore.sh` | PreToolUse Read, PostToolUse Edit/Write, Stop | Rewrites protected blocks **on disk** into placeholders while the session runs, and restores them at Stop | no | Grep or `cat` read the real code, and a `.bak` copy sits in `.claude/`. Tests run mid-session execute the placeholder code (`INFERENCE` from `SIMPLIFY-IGNORE.md:11`). |

Every process rule in the repository is an instruction:

- phase order, test first, commit per task;
- stopping on risk, never overwriting a plan;
- NO-GO on Critical.

The system enforcements are CI lint on the repository itself and two opt-in hooks, neither of which
guards a process rule. Where the model does not comply, nothing notices.

### 3.16 Commands versus skills

`AGENTS.md:72-78` states the intended split:

- skills are the *how*;
- personas are the *who*;
- commands are the *when*, and they orchestrate.

In practice, every command except `/webperf` begins "Invoke the agent-skills:<skill> skill" and then
restates the skill's steps: `/review` repeats the five axes and `/test` repeats Prove-It. That is how
the severity labels drifted (§3.9). Commands orchestrate only in two places: `/ship` fans out to
three personas, and `/build auto` loops over tasks.

The right relation, which the repository states but does not keep: **a command selects and sequences;
a skill holds procedure; neither restates the other; and the thing that decides whether the step
succeeded is neither.**

### 3.17 `/build auto`

Everything below lives in the command's prompt (`.claude/commands/build.md`, `EXT`).

- **Approved by the human:** only the plan. "Single checkpoint… wait for an unambiguous affirmative…
  This is the only human gate" (`:34`).
- **Preconditions:** a spec at a known path, or stop (`:31`); a clean baseline from `git status
  --porcelain`, stopping on unrelated changes (`:32`).
- **What runs autonomously:** each task in dependency order: red → green → regression → build →
  commit → mark complete. It stages only the files the task touched, commits once per task, and
  commits the plan itself first (`:34-35`).
- **What stops it:**
  - a test that cannot be made to pass, or a build that breaks with no obvious fix;
  - an ambiguous spec, or a decision the spec does not cover;
  - anything high-risk or irreversible: "auth/permission changes, destructive data migrations,
    payments, deletions, deploys, anything touching secrets, or anything you can't undo with `git
    revert`" (`:36-39`).
- **Resume:** run `/build auto` again; it continues from the next unchecked task (`:41`).
- **Replanning:** none. A missing decision stops the run.
- **Verification** is preserved in the text: each task is test-driven and committed.
- **Enforcement:** none. The catalog's own anti-pattern C, "Loses the human checkpoints"
  (`references/orchestration-patterns.md:316-326`), sits uneasily with it.

**Compared with Shelra's autonomy objective** (`--autonomous` rebuilt on `Agent.processMessage`; doc
15 Phase 7), the shape is right:

- one approval of a plan;
- stop conditions for ambiguity and irreversibility;
- a restart boundary at each task;
- resume from durable state.

Shelra would make each property a host fact, not a sentence. A task is complete when its contract
passed, not when its box is ticked. Irreversible means what `security/destructive.ts` refuses, or
what an approved decision's scope covers. Resume means the persisted contract and attempt ledger.

### 3.18 Memory: absent

`agent-skills` has no cross-session memory, no repository memory beyond files a human commits, no
mistakes learned, and no skill creation from use. Its only durable state is Markdown in the user's
repository:

- `SPEC.md`, `tasks/plan.md`, `tasks/todo.md` and `CONSTRAINTS.md`;
- ADRs and a `PERF.md` of attempts;
- `docs/intent/` and `docs/ideas/`.

These survive only if the model writes them and a human commits them. Context-engineering's
"Restartable Session Boundaries" (`:123-137`) is the closest idea to memory. It lists what to persist
before leaving a session: the accepted scope and decisions, the task status and the next task, the
files changed, the exact verification commands and their outcomes, and the open questions. It then
says the harness should do the rest: "The skill defines the handoff contract; process supervision…
belong to the harness."

This is the largest architectural difference. Shelra's objective is an agent that does not lose the
project's thread (`PRODUCT.md`). `agent-skills` delegates the thread to the human and to git.

### 3.19 Four skills examined closely

**`context-engineering`.** Addressed to two readers at once, the human setting up the agent and the
agent itself. Its principles:

- a hierarchy, from rules files through specs, source and errors to history;
- load the relevant section, not everything;
- one example of the pattern;
- trim at 75% of the window and compress before dropping;
- put task-critical content last;
- treat external content as data.

Shelra already implements most of them in code, not text:

- the `AGENTS.md` chain;
- the context packet of checks, git state and named files, with no generated overview, which the
  literature found unhelpful (doc 15 §14.1, [AGENTSMD]);
- stale tool results cleared past 160,000 characters;
- compaction that keeps the acceptance criteria;
- fetched content marked untrusted.

What Shelra lacks is its handoff record (§3.18). **Adopt the principles, which are mostly present;
adapt the handoff record; do not install the skill.**

**`doubt-driven-development`.** The cycle is CLAIM → EXTRACT → DOUBT → RECONCILE → STOP. Its
load-bearing details:

- the reviewer gets the artifact and the contract, never the claim or the reasoning (`:106`);
- the prompt is adversarial;
- findings are classified by precedence: contract misread, then actionable, trade-off, noise;
- the loop stops after 3 cycles;
- "doubt theater", substantive findings with none classified actionable, is a checkable signal
  (`:215`);
- TDD's failing test *is* the doubt step for a behavioural claim (`:227`).

It reduces hallucination only when the reviewer can find what the author missed. With the same
model and only text, it mostly buys tokens. The literature says the same: separating judge from
worker helps, and a transcript-only judge is noisy and gameable (doc 15 §14.2 P10).

**The right triggers for Shelra** are risk signals the host can compute:

- a request naming three or more behaviours (Shelra's requirement-dense rule);
- a change inside an approved decision's scope;
- a repeated contract failure;
- security-sensitive paths.

The reviewer's output must be executable, a probe that fails, before it counts (§6.12). It should
never run on trivial turns.

**`constraint-driven-development`.** A project's quality bar as a file. Each number comes with its
reason and the command that produces the verdict, placed by cost: fast checks after every edit, the
task suite at the end, the full suite in CI. Three further parts:

- a **floor** that needs no setup: no new suppressions, no stubs, no skipped or deleted tests, no
  secrets, and the file itself never weakened;
- **ratchets**, which record today's value and refuse to get worse;
- a **circularity ranking**, from external (axe, osv-scanner) through project (lint rules) to suite
  (the project's own tests, "the only genuinely circular one").

It ships a reference floor guard as real code (`references/floor-guard.md`). The guard is
diff-scoped, reads untracked files too, exits 0, 1 or 2, and says "never let a 2 read as a 0". This
is the repository's single most transferable idea.

In Shelra these are decisions with checks (§6.5), and the floor becomes host code. There should be
no `CONSTRAINTS.md` as a second system beside `docs/decisions`.

**Definition of Done** (`references/definition-of-done.md`). It separates the two concepts cleanly.
Acceptance criteria are per task and ask "did we build this thing?". The Definition of Done is
standing and asks "is it ready?" (`:5-15`). Its checklist mixes checkable items (tests fail without
the change and pass with it; lint passes) with judgment items (naming reveals intent) and a human
gate ("the human has reviewed and approved before merge", `:51`).

Shelra does not confuse the two concepts, but it does not name them either (§6.5).

## 4. Round 1 comparison

| `agent-skills` | Shelra | Who does it better, and why |
| --- | --- | --- |
| DEFINE: interview, spec file, constraints, human yes | Request verbatim, rule capture, requirement checklist, optional plan questions (TUI only) | **agent-skills** on content: non-goals, assumptions, testable success criteria. **Shelra** on autonomy: it does not stop a headless turn to ask. Neither detects drift. |
| PLAN: sized tasks with AC, dependencies, checkpoints, no overwrite | `generate_plan` with criteria and steps; a criterion's command probed before the change and added to the contract | **Shelra**: part of its plan becomes a host check. agent-skills' task anatomy is richer; neither plan controls execution. |
| BUILD: slices, TDD, context, doubt, docs | Hardened tool loop, argument repair, journaled writes, destructive guard | **Shelra** on execution robustness (doc 15 §5). agent-skills on *advice* for what to do; advice is not measured. |
| VERIFY: the model runs tests and ticks a checklist | Host-run contract on the final state; checks named by program; shell writes invalidate evidence; tests and decisions protected | **Shelra**, clearly: its verdict is the host's, not the model's. |
| REVIEW: same-context skill and same-model personas, severities, a verdict | None independent | **agent-skills**: a review step exists and has a rubric. Neither grounds the reviewer in execution. |
| SHIP: rollout, rollback, observability procedure | Commit prompts; `shelra decisions check` for CI | **agent-skills** as knowledge; not Shelra's scope today. |
| Skills | 25 curated bodies | A catalog plus `read_file`; 8 skills in this repository; procedures promoted from credited memory | **agent-skills** on curated content. **Shelra** on having a route from outcomes to skills, unused so far (doc 15 §7). |
| Commands | 9 lifecycle commands, 3 copies | TUI commands (`/plan`, `/review`, `/verify`, `/checks`, `/commit-*`, …) | Neither is load-bearing; agent-skills duplicates more. |
| Hooks | 2 opt-in hooks; none guard a process rule | 17 events; PreToolUse and Stop can block; user-scope only (repo hooks ignored for safety, `hooks/config.ts:4-14`) | **Shelra**. |
| Agents / personas | 4 personas, no model or tools set, fan-out on `/ship` | 9+ sub-agent types, fresh context, no gate; rarely used (6 calls in 2,522, doc 15 §9) | Tie: both have isolation without grounding. |
| References | Shared checklists, broken on single install | None | agent-skills for content; the portability defect is the lesson. |
| Evals | Routing lint in CI; forced-skill LLM-judged runs on demand | Deterministic oracles on the product path; `--ablate`, `--repeat`, pass^k, false completions, reference agents; immutable history | **Shelra**, clearly: it measures outcomes, with ablations. |
| Memory | None | Retrieval, deterministic write gate, credit from contract outcomes, promotion; decision ledger | **Shelra**, as mechanism; its organic content is still thin (doc 15 §7). |
| State | Markdown files the model maintains | Transcript, plan tool results, verdicts, decisions in SQLite and Markdown; journal in memory; `AgentKernel` phases are labels | Shelra has more state, but not workflow state (§6.6). |
| Repair | Prose loops per skill, bounded only in doubt-driven | Bounded host rounds with parsed failures, regressions named, restore offered, effort raised | **Shelra** within a turn. **agent-skills** names more backtrack targets (ask a human, revert, rollback). |

## 5. Round 2: adversarial review

This round attacks both systems. A finding survives only with evidence.

### 5.1 Against `agent-skills`

| # | Finding | Evidence | Consequence for Shelra |
| --- | --- | --- | --- |
| A1 | **Enforcement is claimed, not built.** "Enforced", "enforce it everywhere" and "pauses on failures or risky steps" describe prompt text. No process rule has a mechanism, and no hook is active after installing. | `EXT` `README.md:32,38,58,372`; §3.15 | Nothing to adopt as a guarantee; every idea must be re-built as host code. |
| A2 | **Routing is unreliable by the repository's own measurement.** The skills fire when they should in 5 of 7 and 2 of 7 runs, and not at all on plain review phrasings. The CI routing test is lexical and cannot see this. | `EXT` `evals/README.md:22,53` | A process that depends on the right skill firing is a process that often does not happen. |
| A3 | **The evals measure compliance, not success.** The skill is forced into the prompt, an LLM judges the trace, there is no without-skill arm, and no results are published. | `EXT` `run-evals.js:49,562-606`; `evals/skill-impact.md` | Its claims of effect are unmeasured. Shelra cannot import them as evidence. |
| A4 | **Duplication breeds drift.** There are three copies of every command, and their bodies are not compared. Commands restate skills: `/review`'s severity labels already differ from the skill's. The simplicity and scope rules are written three times. "Stress-test my plan" belongs to three skills. | `EXT` `validate-commands.js:15-17`; §3.6, §3.9, §3.11 | Commands must not carry procedure; one fact, one place. |
| A5 | **Internal contradictions.** TDD is in Build (`CLAUDE.md:23`) or in Verify (`using-agent-skills:180`). "I'll gather context first" is an error (`AGENTS.md:62`) while `context-engineering` teaches exactly that. The anatomy is optional in the docs and required by lint. Where references go is disputed (`CONTRIBUTING.md:63` against `skill-anatomy.md:14`). | `EXT` | A lifecycle whose phase mapping is inconsistent cannot be executed as a state machine; it was never meant to be. |
| A6 | **It assumes a human at every gate.** Six places say stop, ask and wait (interview, spec phases, confusion, missing requirement, plan overwrite, cross-model offer), and two skills refuse to run non-interactively. | `EXT` §3.4 | Incompatible with headless `-p`, the benchmark and `--autonomous`. Shelra's autonomy rule is to ask only for decisions that belong to the owner and to decide the rest. |
| A7 | **Token cost.** In Shelra's own loader, the 25 skills cost 16,604 catalog characters on every request, against 5,029 today, about +28% of the ~42,000-character always-on prompt. Each body read adds a median 13,545 characters to the history, which every later step re-sends. | `TEST` §6.11 | On free models, where the F4 finding was that 19% more steps cost 55% more tokens (doc 15 §6.6), catalog and body cost is not free. |
| A8 | **Portability defect.** Shared references break on single-skill installs (#361, open), and an earlier version stalled agents on 18 missing links. | `EXT` §3.13 | Shelra's skills must be self-contained. |
| A9 | **No state, no memory.** Plans are checkboxes, and continuity is whatever the model wrote and a human committed. | `EXT` §3.18 | The one capability Shelra is built to own is absent. |
| A10 | **Repair is local and unbounded.** Loops are prose per skill; there is no edge back to PLAN or DEFINE except asking a human, and only doubt-driven has a bound. | `EXT` §3.8 | Shelra needs typed routes and one budget (§6.3). |
| A11 | **Independent review is not independent.** The personas share the model; without a subagent tool they share the context; none runs anything. | `EXT` §3.9 | Review must be grounded in execution to be worth its tokens (§6.12). |
| A12 | **A hook that edits the user's files.** `simplify-ignore` rewrites source on disk for the whole session. | `EXT` §3.15 | Reject. Shelra never changes files to steer the model. |
| A13 | **Model dependence is total.** Every behaviour depends on the model reading and obeying. Shelra's own head-to-head shows how variable obedience is. Claude Code (Sonnet 5) broke a logging rule written in its `CLAUDE.md` in 3 of 3 runs, while free Nemotron obeyed the same rule in `AGENTS.md` 9 of 9 times, with or without the ledger. | `RUN` doc 15 §6.5 | Instructions work for some models on some rules. A guarantee cannot rest on that. |

### 5.2 Against Shelra

The same attack, turned on Shelra's live path at `04a1ee8`:

| # | Finding | Evidence | Addressed in |
| --- | --- | --- | --- |
| S1 | **Stated behaviours are checked only by the model that wrote the code, under its own reading.** The requirement audit is a user message asking the same model, in the same context, to audit itself. In `06-bounded-queue` the request says "stop starting new work after an AbortSignal is aborted" and "settle every item". The visible test file never mentions abort. The model probed abort itself and passed its own probe, because it read abort as rejecting the call. The oracle expects every item settled, so the call resolves. The audit confirmed the misreading instead of catching it. | `CODE` `agent.ts:3551-3570`; `RUN` doc 15 §6.6 and the F4 session excerpts in `bench/history/benchmark-history.json` (`F4B-core-baseline-nemotron-2`); fixture `bench/fixtures/shelra-agent-core-v0.2/06-bounded-queue/src/queue.test.ts`; oracle `bench/oracles/shelra-agent-core-v0.2.ts:220-234` | §6.12, §6.14 |
| S2 | **Test protection is file-level and keyword-gated.** Any change to a pre-existing test file holds the turn unless the request's wording asks for test edits. A legitimate update, such as a new field in a compared body, is blocked, while weakening inside a *new* test file, or through config (a lowered coverage threshold, a disabled lint rule), is not seen. | `CODE` `contract/test-protection.ts:8-32`; `DOC` `docs/EXECUTION-PLAN.md` "Findings to act on" | §6.12 item 1 |
| S3 | **Failure has one route.** Every gate exit is a nudge back into the same turn's loop, then `[Not verified]`. There is no replan, no separate path for a check that could not run (the judge knows the difference, the route does not), and no path back to the user when the request itself is wrong, except `report_blocker`. | `CODE` `agent.ts:3319-3549`; `ledger/judge.ts` | §6.3 |
| S4 | **The lifecycle state is labels.** `AgentKernel` phases are written for display, and `reviewPassed` always equals `verificationPassed`. The real state machine is a `while (true)` with eight ordered exits and local counters. The plan-gate comments describe a gate that does not exist (`published` is written, never read). | `CODE` `agent/kernel.ts`, `agent.ts:3014-3016`, `toolset/tools.ts:1272` | §6.6 |
| S5 | **Continuity stops at the verdict.** The attempt journal is in memory. The open contract, the failing checks and what was tried are not persisted, so "continue" starts over. The SQLite checkpoints still have no reader. | `CODE` `agent.ts:969-1027`; doc 15 §21 item 4.5 | §6.4 |
| S6 | **No independent review.** `/review` is a fixed prompt to the same agent. | `CODE` `ui/app.tsx:313-335` | §6.12 |
| S7 | **Skills are unmeasured.** Eight skills reach every prompt in this repository, among them the untracked `spec-driven-development`, a byte-identical copy of `agent-skills`' skill. That copy costs 617 characters per request and tells the model to wait for human review at each phase and to write `SPEC.md` and `tasks/`. No Shelra skill has a routing or outcome evaluation, and project skills are trusted without review. | `TEST` §6.11; `CODE` `utils/skills.ts:198-233` | §6.8, §6.9 |
| S8 | **A Stop hook that blocks ends the turn.** Claude Code instead sends the reason back so the model continues. Shelra's Stop hook cannot drive repair. | `CODE` `agent.ts:3580-3595` | §6.3 (a hook verdict is one more failing check) |
| S9 | **Small doc-code disagreements.** Appendix B lists them. | | Appendix B |
| S10 | **A turn can redefine its own definition of done.** The contract discovers its checks from the final workspace (`contract/discover.ts:114-143`, called at `agent.ts:3248`), so a turn that edits `package.json`'s `test` script, or the command table in `AGENTS.md`, is judged by the check it wrote. Reproduced for this audit with a scripted model and the real check runner. Wrong code with the original `"test": "bun test"` ends `[Not verified]`. The same wrong code plus `"test": "echo 1 pass"` ends "[Checked by Shelra on the final code …]", reported as verified. Test protection covers test files only. This is `agent-skills`' floor move "the threshold moved", and the ledger already refuses the same move for decision records. **Fixed on 2026-09-24:** the gate compares the checks with the ones the turn started with (`src/contract/check-definitions.ts`). The probe is now a permanent test in `src/agent/completion-gate.test.ts`, which fails on the previous code. | `TEST` probe in Appendix A | §6.12 item 1, §6.14 |

### 5.3 External evidence

The Round 2 red-team was an independent agent whose task was to kill the thesis "adopting this
lifecycle architecture measurably raises a coding agent's task success and honesty, including for
weaker models". It found **no controlled measurement of `agent-skills`, or of any general-purpose
lifecycle pack, on coding outcomes.** The pack's own comparison (`docs/comparison.md`) calls itself
"one developer's single-task experiment, not a benchmark".

The closest controlled evidence follows, component by component. ✓ marks a source the auditor
re-read at its primary location on 2026-09-24; the rest are as the red-team reported them.

**Skills per phase: wounded.**
- ✓ SkillsBench v4 (arXiv 2602.12670, 2026-06-14):
  - "compact and standard-length Skills (+19.0 and +21.5 pp) outperform detailed (+14.5 pp) and
    comprehensive documentation (+0.7 pp)";
  - "Software Engineering (+11.6 pp)" is among the domains that benefit least (v1: +4.5 pp, and 16
    of 84 tasks got worse);
  - "Self-generated Skills land below the no-Skills baseline on all three configurations".

  `agent-skills`' bodies are comprehensive by design: median 13,545 characters, up to 497 lines.
- ✓ TDAD (arXiv 2603.17973, 2026-03-18; Qwen3-Coder 30B and Qwen3.5-35B-A3B): "adding TDD procedural
  instructions without targeted test context increased regressions to 9.94% -- worse than no
  intervention at all". Its conclusion, as the red-team quoted it: "surfacing contextual information
  outperforms prescribing procedural workflows."

**Routing by description: dead as a guarantee.**
- ✓ Vercel (2026-01-27): "In 56% of eval cases, the skill was never invoked." Pass rates: no
  documentation 53%, skill 53%, skill with explicit instructions 79%, an `AGENTS.md` documentation
  index 100%.
- ✓ Anthropic's `skill-creator` skill: "currently Claude has a tendency to 'undertrigger' skills",
  and "Claude only consults skills for tasks it can't easily handle on its own".
- ✓ Claude Code documentation: descriptions "truncated at 1,536 characters in the skill listing";
  bodies load "only when it's used".
- ✓ Skill shadowing (arXiv 2605.24050, 2026-05-21): "performance degrades as libraries grow -- by up to
  21% when scaling from a small set of helpful skills to a 202-skill library."

**Always-loaded instructions: followed, and still no gain.**
- ✓ The ETH study (arXiv 2602.11988): context files "do not generally improve task success rates,
  while increasing inference cost by over 20%". It also found that "instructions in the context files
  are well followed by coding agents". Compliance was not the missing piece.
- Instruction-density studies report that adherence falls as instruction count and session length
  grow (IFScale arXiv 2507.11538; MTAC-IFBench arXiv 2609.14992).

**Anti-rationalization text: never measured for skills; wording matters, structure matters more.**
- ✓ ImpossibleBench (arXiv 2510.20270, 2025-10-23):
  - "For both GPT-5 and o3, prompt A and B lead to a cheating rate >85%, while prompt D lowers them to
    1% and 33%", so wording can move strong models a long way;
  - but "Hiding tests from agents reduces cheating success rate to near zero".

  The structural control dominates, and it does not depend on the model reading anything.
- No study of anti-rationalization tables themselves was found.

**Personas and self-review: dead as a lever; outside feedback and model diversity help.**
- As the red-team reported them:
  - persona prompts "do not improve model performance" (Zheng et al., arXiv 2311.10054);
  - "LLMs struggle to self-correct their responses without external feedback" (Huang et al., ICLR
    2024, arXiv 2310.01798);
  - multi-agent debate rarely beats one agent, while model heterogeneity helps (arXiv 2502.08788);
  - aggregating several reviews raises review F1 (SWR-Bench, arXiv 2509.01494).
- Doc 15 §14.2 P10 reached the same point: separate the judge from the worker, but ground it in
  executed evidence.

**Plan once, then run: wounded.**
- ✓ "From Plan to Action" (arXiv 2604.12147, v3 2026-08-07): "A subpar plan hurts performance even
  more than no plan at all", while "periodic plan reminders can mitigate plan violations and improve
  task success."
- [HDSTUDY] (arXiv 2609.20804) finds planning an accuracy scaffold for weaker models and a cost saver
  for stronger ones.

**Spec-first tooling: practitioner reports only.** Spec Kit, Kiro, Tessl and OpenSpec have no
outcome benchmark with a no-spec arm. Expert reports describe agents not following the instructions
despite all the files (Böckeler, martinfowler.com, 2025-10-15). One report counts 2,577 lines of
Markdown and 3.5 hours of review for 689 lines of code (Eberhardt, Scott Logic, 2025-11-26).

**What the evidence supports** (`INFERENCE`), and what Shelra's rule already demands:

- small, task-matched knowledge, placed deterministically;
- structural controls the model cannot skip;
- review grounded in outside feedback;
- paired with/without measurement.

### 5.4 What survives Round 2

From `agent-skills`, the ideas that survive are those that can become host-observed facts:

- the floor guard against weakening;
- fail-before/pass-after proof;
- fresh-context adversarial review, *if* grounded in execution;
- the session handoff record;
- a log of discarded attempts;
- the split between acceptance criteria and a definition of done;
- no overwriting of in-flight state;
- the eval discipline of negative triggers with named owners and a ledger of rejected changes.

What does not survive: the skills as a pack, the meta-router, the commands as lifecycle, the
personas' fan-out, the anti-rationalization tables, the multi-host scaffolding and its evaluation
method.

From Shelra, what survives is the verification spine: a host-run contract on the final state, and
measurement on the product path. What it must fix is S1-S8 and S10.

## 6. Round 3: Shelra synthesis

### 6.1 Design rules

1. **A guarantee is host code, or it is not a guarantee.** Procedure text is optional help, kept only
   when a measurement shows it helps.
2. **One contract, two tiers.** The **definition of done** is standing: the project's checks, the
   approved decisions whose scope a change touches, and the floor. The **acceptance criteria** belong
   to the task: the request's stated behaviours, plan criteria with commands, and confirmed probes.
   The verdict reports each tier.
3. **Lifecycle stages are host states, not phases the user drives.** DEFINE and PLAN produce artifacts
   the host builds and the model may enrich. They are never gates the model must pass before it may
   act: a plan gate was built once and removed because mid-size models fumbled it (doc 14 §23.3).
4. **Every failure has a typed route, every route has a bound, and the last route is an honest
   report.**
5. **Memory is read at intake and written at every outcome**, not only at the end of a passing turn.
6. **A reviewer's finding counts only as a command the host ran and saw fail.**
7. **Skills are few, self-contained and measured.**

### 6.2 The lifecycle

```
            ┌───────────── decisions · memory · handoff of the last turn (read) ─────────────┐
            ▼                                                                                │
 INTAKE ─► DEFINE ─► (PLAN) ─► BUILD ─► OBSERVE ─► VERIFY ─pass─► (CHALLENGE) ─pass─► REPORT ─► LEARN ─► HANDOFF
              ▲        ▲        ▲                    │                 │
              │        │        └──── REPAIR ◄───────┤ a check failed  │ a probe failed on the host's re-run
              │        │               ▲  ▲          │                 │
              │        │               │  └──────────┼─────────────────┘
              │        └─ REPLAN ◄─────┘ the same failure after a changed attempt
              │                                      │ the check could not run ─► ENVIRONMENT ─► VERIFY, or REPORT
              └─ REDEFINE ◄──────────────────────────┤ the model reports the request cannot be met as written
                 (TUI: ask the user; headless: state the assumption and go on, or stop via report_blocker)
                                                     └ the turn's total bound is spent ─► REPORT [Not verified — …]

 (…) = conditional.  SHIP is not a state of a task: it is the same contract run over a branch in CI
 (`shelra decisions check`, the project's checks). Production observation is deferred.
```

**Compared with the hypothesis in the brief** (INTENT → DEFINE → SPECIFICATION → PLAN → BUILD →
REALITY → VERIFY → REPAIR/REPLAN/REDEFINE → REVIEW → SHIP → PRODUCTION REALITY → OBSERVE → LEARN), it
changes three things:

- **REVIEW moves before REPORT and becomes CHALLENGE.** It is grounded in execution, conditional on
  risk, and it feeds REPAIR, not a human verdict.
- **Two routes are added.** ENVIRONMENT separates "the check could not run" from "the code is wrong".
  Shelra's judge draws that distinction today for decision checks only. HANDOFF closes the loop
  across sessions.
- **SHIP and production observation are not per-task states.** Shelra does not deploy. When it gains
  a deploy surface, OBSERVE becomes the entry of a new turn whose DEFINE is the production signal.

| State | Owner | Output artifact | Leaves when | Failure route | Persists |
| --- | --- | --- | --- | --- | --- |
| INTAKE | host | request verbatim, standing rules, decisions in force, retrieved memory, the open handoff | always | — | transcript, memory |
| DEFINE | host builds, model enriches | contract draft: the acceptance tier from the request's requirement sentences (host-extracted; the model splits them into behaviours), plus the model's stated reading of each where the request is open, and any non-goals | always (not a gate) | a change that needs an approved decision to change → `propose_decision`, the user approves (exists) | contract (new: with the session) |
| PLAN (optional) | model; host probes | criteria whose commands ran before any change: baseline and vacuity | — | a criterion already passing is flagged vacuous | plan (exists) |
| BUILD | model | changes; one journal entry per attempt | the model stops | destructive command → ask or refuse (exists) | journal (new: persisted) |
| OBSERVE | host | workspace diff including shell writes; evidence timeline | — | — | verdict row |
| VERIFY | host | results per tier; floor findings; protected-test findings | every check passes, the floor is clean | red → REPAIR; could not run → ENVIRONMENT; floor or decision-record move → REPAIR once, then REPORT | contract results (new: persisted) |
| CHALLENGE (risk-triggered) | host schedules, fresh-context model proposes, host re-runs | probes: commands that pass only if a stated behaviour holds | no probe fails on the host's re-run | a failing probe joins the acceptance tier → REPAIR | probes and outcomes |
| REPAIR | host routes, model acts | parsed failures, regressions, an attempt-ledger entry (what changed, what it was meant to fix, the result) | the shared bound (3 rounds today) | same failure after a changed attempt → REPLAN; a regression → restore offered (exists) | attempt ledger (new: persisted) |
| REPLAN | host nudges, model changes approach | a nudge that names the failed approaches from the attempt ledger. It extends what exists (the same failures after a changed attempt are named and effort is raised, `agent.ts:3333-3411`); it never requires `generate_plan`, which would be a plan gate mid-turn | once per turn | still failing → REPORT | attempt ledger |
| ENVIRONMENT | host | the setup failure named, e.g. runner missing or timed out. `ledger/judge.ts` classifies this today, but only for decision checks (`contract/contract.ts:75`); the route extends it to every check | the check runs | not fixable → REPORT, not blamed on the code | verdict |
| REDEFINE | user | the question: an unmeetable or contradictory requirement, from `report_blocker` (the headless exit exists, `agent.ts:3102-3110`) | the user's answer starts a new turn | headless: state the assumption in the report and continue where one reading is reasonable; `[Stopped — …]` only when none is | handoff |
| REPORT | host | a verdict per tier, the evidence, the unverified list | — | — | transcript (exists) |
| LEARN | model proposes, host gates | observed facts, credit, attempt outcomes, skill candidates | write gate | — | memory |
| HANDOFF | host | open contract, attempt ledger, the next step, open questions | end of turn | — | session store |

### 6.3 The failure and repair loop

```
 VERIFY ─► each check: passed · failed · could not run        (ledger/judge.ts already classifies)
   │
   ├─ could not run ─► ENVIRONMENT: name it; one round to fix the setup ─► VERIFY
   │                      └─ still cannot run ─► REPORT "could not run: <why>" (never "the code is wrong")
   │
   ├─ failed ─► REPAIR round n (one shared bound, N = 3)
   │              inputs: parsed failures · regressions against the last attempt · files that attempt
   │                      changed · the attempt ledger (every earlier hypothesis and its result)
   │              └─► BUILD ─► OBSERVE ─► VERIFY
   │                    ├─ same failure, different diff ─► REPLAN (once): "approaches A and B failed because …"
   │                    ├─ same diff as an earlier attempt ─► refused as a repeat (doc 15 §19 2.2, open)
   │                    └─ a check that passed before now fails ─► regression named, restore offered (exists)
   │
   ├─ floor violation (a weakening move) ─► REPAIR once, with the move named ─► still there ─► REPORT
   ├─ Stop hook blocked ─► one more failing check, with its reason (today it ends the turn)
   ├─ the model says it cannot be done (report_blocker) ─► REDEFINE (TUI) or REPORT [Stopped — …] (headless)
   └─ N rounds spent ─► REPORT [Not verified — <tier>: <check>] ─► LEARN (the failure is data) ─► HANDOFF

 One total bound per turn covers every route: REPAIR, REPLAN, ENVIRONMENT, the floor, test protection,
 decision records and CHALLENGE. Today each has its own counter or flag, and the contract and the
 no-evidence gate share `verificationRetries` (`agent.ts:3319, 3490`).
```

**What exists today** (doc 15 §21 items 2.1-2.4):

- the REPAIR round with parsed failures;
- regressions named and restore offered;
- reasoning effort raised on a repeated failure;
- the bound and the honest report.

**What is new:**

- ENVIRONMENT for every check, not only decision checks;
- REPLAN as a nudge that names the failed approaches, extending today's repeated-failure notice;
- REDEFINE as a route of its own; its headless exit, `report_blocker`, already exists;
- the persisted attempt ledger;
- one total bound per turn;
- a Stop hook as a failing check;
- LEARN on every exit. Today it runs on two of the nine terminal exits (`agent.ts:3452, 3611`),
  Appendix B6.

### 6.4 Memory and learning

`agent-skills` has no memory (§3.18). In Shelra, memory is not a box after SHIP. It is read at intake
and written at every state that observes an outcome:

```
 INTAKE    reads   decisions (by scope) · memory (lexical retrieval) · handoff (open contract, attempts)
 VERIFY    writes  credit ±1 to the memory in context · commands observed to pass (confirmed facts)
 REPAIR    writes  the attempt ledger: what changed, the hypothesis, the result
 CHALLENGE writes  a confirmed, undisputed probe, offered as a regression test (test protection makes a kept
                   test binding from the next turn, so a disputed reading must never be kept)
 LEARN     writes  observed facts first; model reflections as low-weight, expiring inferences; a procedure
                   becomes a skill only after credited uses and the owner's yes (doc 15 Phase 5)
 HANDOFF   writes  the state the next session needs (context-engineering's handoff contract, host-written)
```

Accumulated expertise has three levels, ordered by how much a later turn can trust it:

1. **Executable**: the project's tests and the approved decisions' checks. They are re-run, so they
   cannot go stale silently. A lesson that can become a check should. An undisputed probe can become
   a regression test, and a quality bar becomes a decision with a check (§6.5).
2. **Observed**: facts the host saw, such as a command that passed or a failure and the change that
   fixed it. They are re-confirmed by running the command (doc 15 §21 item 4.4).
3. **Inferred**: model reflections. Low weight, credited by outcomes, and expiring.

This is the answer to "does it learn mistakes?". A mistake becomes a failing check that stays in the
project, not a sentence in a memory file.

### 6.5 Acceptance criteria, definition of done and constraints

`agent-skills` separates the two concepts cleanly (§3.19). Shelra has both inside one contract. Its
checks are `kind: test | typecheck | lint | build | task | decision` (`contract/contract.ts:34`); the
first four are the definition of done, `task` is acceptance, and `decision` is the ledger's part of
the definition of done. But Shelra names neither concept. Its acceptance criteria are
checked only when they come with a command: the request's stated behaviours reach the model as a
self-audit and never become checks (S1).

| Concept | Scope | Owner | In Shelra | Enforced by |
| --- | --- | --- | --- | --- |
| Definition of done | every change in the project | the project and the user | discovered checks (test, type-check, lint); approved decisions whose scope a change touches; the floor (§6.12 item 1); protected tests | the host, on the final state |
| Acceptance criteria | this task | the request, the plan | stated behaviours; plan criteria with commands; confirmed probes | the host, once each has a command |
| Constraints (a quality bar with numbers) | the project | the user | **decisions with checks.** A coverage floor, a bundle budget or a ratchet ("must not fall below today's value") is a decision whose check compares against a recorded number. | the host, via the decision's check |
| `AGENTS.md` / `CLAUDE.md` | guidance | the user | read by the model; discovery reads their command tables | nothing, unless imported as decisions (F8) |
| Skills | procedure | the curator | optional text | nothing; measured (§6.9) |

A rule lives in one place. If it can be checked, it is a decision with a check. `AGENTS.md` may
mention it, and F8's planned `shelra decisions import` would convert `CLAUDE.md`, `AGENTS.md` and ADR
rules into decisions. There is no `CONSTRAINTS.md`.

### 6.6 Should the lifecycle be executable state?

**Yes, for the host's gate. No, for the model's work.**

- **Why yes.** The gate already is a state machine, only an implicit one. Inside one loop
  (`agent.ts:3028-3625`, S4) it has:
  - nine terminal exits (lines 3052, 3109, 3147, 3198, 3222, 3474, 3548, 3595, 3625): empty reply,
    blocker, protected tests, a decision approved elsewhere, decision records, contract exhausted,
    no evidence, Stop hook, done;
  - six re-entry edges, where a nudge sends the turn back into the loop;
  - separate counters and one-shot flags.

  Making it explicit brings four things:
  - every transition becomes a unit-testable table instead of a scripted-model scenario;
  - the state can be persisted, which continuity (S5) and `--autonomous` (doc 15 Phase 7) need;
  - the new routes (REPLAN, ENVIRONMENT, REDEFINE) have somewhere to live;
  - the Checks view can show the real state instead of the `AgentKernel` phase labels, which should
    then be deleted. The kernel's mutation list stays: the gate reads it (`agent.ts:3070, 3079, 3161`).
- **Why not more.** Mandatory phases for the model repeat the plan gate that failed. A workflow
  engine with plugins, or commands that move the state, would put guarantees back in the user's
  hands.
- **Shape.** A pure `next(state, observation) → { state, action }` owned by the completion
  contract. The existing blocks become transition handlers. The first change is a refactor that
  preserves behaviour exactly, verified by the existing gate and resilience tests; new routes land
  after it. It fits the pending split of `agent.ts` (doc 15 Q1).

### 6.7 Commands

Shelra should **not** adopt `/spec /plan /build /test /review /ship`:

- The lifecycle runs on every turn, including headless `-p` and the benchmark, which have no
  commands.
- A guarantee that depends on the user typing a command is not a guarantee.

TUI commands stay thin. Each maps to a host state, and none restates procedure:

| Command | Becomes |
| --- | --- |
| `/plan` | unchanged (plan mode) |
| `/verify` | run the contract now, on the current workspace, with no model; replaces the sandbox-only path that cannot run on Windows or Linux |
| `/review` | CHALLENGE on demand: fresh context, execution-grounded; not a same-context prompt |
| `/checks` | shows the contract by tier, with the current state |
| `/commit-push`, `/commit-pr` | unchanged prompts; they state the last verdict before committing |
| `/constraints` | not needed: `shelra decisions` is the constraints command |
| `/build auto` | not a command: `--autonomous` rebuilt on `Agent.processMessage` (doc 15 Phase 7), taking over its good properties as host facts (§3.17) |
| `/spec`, `/ship`, `/test` | not added: DEFINE's output shows in the Plan and Checks views; SHIP is CI; tests are the contract |

### 6.8 Skills in Shelra

- **What a Shelra skill is.** A self-contained procedure, loaded as a catalog entry, whose body the
  model reads on demand (the current loader is right). The anatomy, adapted:
  - frontmatter with a "Use when" trigger;
  - numbered steps that end in commands;
  - a "Done when" section naming commands whose success the host can observe;
  - no anti-rationalization table (unmeasured, §3.12);
  - no `../` paths or shared references (§3.13);
  - kept short: focused skills beat bundles (§5.3).
- **Admission.** No skill enters the tracked `.agents/skills` without a routing evaluation and an
  outcome evaluation (§6.9). A skill that fails either goes into a ledger of rejected changes, which
  is `agent-skills`' one good eval artifact.
- **Promotion from memory** should become what doc 15 Phase 5 proposes: credited uses, then the
  owner's approval. Today it is automatic: a procedure with enough credit and confidence is written
  to `.agents/skills/` with no one asked (`memory/skills.ts:56-104`). This is a risk to measure, not
  a feature to trust. SkillsBench v4 found model-authored skills below
  the no-skills baseline in every configuration (§5.3). Shelra's promotion differs, in that it
  requires contract-passing uses, but that difference is unproven until a promoted skill passes the
  outcome evaluation.
- **The untracked `spec-driven-development`** (S7) is the owner's decision; this audit does not touch
  it. Where it lives now, `.agents/skills/`, it reaches every Shelra request in this repository. For
  Claude Code sessions only, `.claude/skills/` or `~/.claude/skills/` would keep it out of Shelra's
  prompt.

### 6.9 Evaluation strategy

**The rule: every important Shelra skill or harness component has an evaluation at each of these
levels before it is described as helping.**

| Level | Question | How | Deterministic |
| --- | --- | --- | --- |
| 1. Mechanism | Does it fire on the live path, and only when it should? | A scripted-model test on `Agent.processMessage` that fails before the change and passes after (the project's rule) | yes |
| 2. Routing (skills) | Does a real model open the right `SKILL.md`, and leave it closed on the negatives? | Positive prompts, and negative prompts naming the skill that should win (from `agent-skills`); the host observes `read_file` of the path; free models, k ≥ 3 | the observation, yes; the model, no |
| 3. Outcome | Does it raise resolve rate or lower false completions? | `--ablate <component>` on the product path, deterministic oracles, k ≥ 3, pass^k, on two free tiers (the weak-strong gap should narrow) | the oracle, yes |
| 4. Cost | What does it cost per resolved task? | tokens per resolved task; the always-on prompt size, tracked | yes |

A component that fails level 3 is removed or left behind its switch, and the rejection is recorded
in `bench/history` so nobody proposes it again unaware.

If the owner ever wants to test an `agent-skills` idea as text rather than as host code, three
cheap tests would decide it. They cost free-model tokens only, and each states in advance what
kills the idea:

1. **Routing on free models.** List the candidate descriptions and run 20 realistic prompts 3 times
   each. Kill description routing if the intended `SKILL.md` is opened in fewer than 80% of runs.
2. **Procedure text on a weak model.** Run one skill's body inlined, against absent, on a
   `bench/suites/` suite at k = 3. Kill it if the gain is inside run-to-run spread, or if steps or
   loops rise (TDAD saw regressions rise, §5.3).
3. **Anti-rationalization over structure.** Use tasks whose tests conflict with the request, with and
   without the table, with test protection on in both arms. Kill the table if the outcomes match.

### 6.10 Classification of every component

| Component | Class | Reason |
| --- | --- | --- |
| using-agent-skills (meta-skill) | **REJECT** | A prompt router with "non-negotiable" behaviours and human stops. Upstream itself declined to wire it as a second router. Shelra's catalog already discloses progressively; routing must be measured (§6.9), not prompted. |
| interview-me | **REFERENCE** | Needs a live user and refuses non-interactive use. Its "out of scope" line and its hypothesis-plus-guess format may inform the TUI's plan questions. |
| idea-refine | **REJECT** | Product ideation, not engineering reliability. |
| spec-driven-development | **ADAPT** | The ideas enter DEFINE as host artifacts: testable success criteria, surfaced assumptions, Always/Ask/Never boundaries, non-goals. The gated human workflow, `SPEC.md` and `tasks/` do not. |
| constraint-driven-development | **MERGE** into the ledger, plus **ADAPT** the floor guard as host code | Constraints and ratchets are decisions with checks (§6.5). The floor is host code (§6.12 item 1). The circularity ranking informs which checks to prefer. |
| planning-and-task-breakdown | **MERGE** into `generate_plan` | Its task fields already exist. "Never overwrite an unfinished plan" becomes a host rule: plans persist across resume, so a plan for a different request should not silently replace one with unfinished steps. |
| incremental-implementation | **REFERENCE** | Scope discipline is already in the prompt. "Do not re-run on unchanged code" is already how the contract reuses runs. Commit-per-slice conflicts with commit-when-asked; checkpoints and the journal are the host's slices. |
| test-driven-development | **ADAPT** (Prove-It) | Fail-before/pass-after becomes host evidence: plan criteria (exists), confirmed probes (§6.12). The rest (pyramid, DAMP, mocks) is reference. |
| context-engineering | **REFERENCE**, plus **ADAPT** the handoff record | Its principles are mostly implemented in code (§3.19). |
| source-driven-development | **MERGE** into the research rule | `AGENTS.md`'s research rule already says to verify leads against the official source. |
| doubt-driven-development | **ADAPT** as CHALLENGE, after a pre-test | Fresh context, artifact plus contract, adversarial, bounded. It changes in two ways: the host schedules it, and a finding counts only as a command the host re-ran and saw fail. Build it only if the offline pre-test of §6.14 shows it catches what the same-context audit missed. |
| frontend-ui-engineering | **DEFER** | Domain knowledge; a candidate user skill once §6.9 exists. |
| api-and-interface-design | **REFERENCE** | Domain knowledge. |
| browser-testing-with-devtools | **DEFER** | Runtime verification of web tasks is a real gap, not the current north. Shelra has Playwright and an `agent-browser` skill. |
| debugging-and-error-recovery | **MERGE** into REPAIR | Reproduce → localize → reduce → fix → guard shapes the repair round's content. The "guard" step is Prove-It. Treating error text as untrusted data is already a rule. |
| code-review-and-quality | **REFERENCE** | The five axes and the severity scale can inform the challenger's prompt. A text-only finding never counts, for or against the verdict (rule 6; doc 15 "An LLM judge without execution"). |
| code-simplification | **REFERENCE** | |
| security-and-hardening | **REFERENCE** | Its rule for destructive operations on derived paths agrees with `security/destructive.ts`'s design. |
| performance-optimization | **MERGE** into the attempt ledger | Keep-or-revert and "log every attempt, including the reverted ones" is the attempt ledger (doc 15 §19 2.2). |
| git-workflow-and-versioning | **REFERENCE** | Owner rules and `/commit-*` cover it. |
| ci-cd-and-automation | **DEFER** | `shelra decisions check` in CI exists (F8). Feeding CI failures back is later. |
| deprecation-and-migration | **REFERENCE** | |
| documentation-and-adrs | **MERGE** into the ledger | `docs/decisions` records are ADRs with checks; F8 would import ADRs. |
| observability-and-instrumentation | **DEFER** | Production observation is not Shelra's surface yet. |
| shipping-and-launch | **DEFER** | As above. |
| Personas (`agents/`) | **REJECT** | Same model, text only. The fan-out multiplies tokens (doc 15 §19 puts multi-agent at 4-15×), and doc 15's "What not to build yet" rules out more sub-agent types. The challenger, if the pre-test earns it, is the existing `explore` sub-agent path with a different brief, not a new persona. |
| Commands | **REJECT** as lifecycle | §6.7. |
| Hooks | **REJECT** `simplify-ignore`; **REFERENCE** `sdd-cache` | One edits user files; the other is a documentation cache Shelra does not need now. |
| `references/` | **ADAPT** the definition of done (as tiers, §6.5); **REFERENCE** the checklists; **REJECT** shared runtime references | Portability (§3.13). |
| Evals | **ADAPT** the discipline, **REJECT** the method | Keep negative triggers with owners, collision checks and a rejected-changes ledger. Drop lexical routing as the metric, forced skills and LLM judges. |
| Skill anatomy | **ADAPT** (§6.8) | Keep process, trigger and "done when"; drop the anti-rationalization tables. |
| Multi-host adapters and validators | **REJECT** | Shelra is the host. |
| `/build auto` | **DEFER** to `--autonomous` | §3.17. |

No component is **ADOPT**, meaning used as it stands: each needs either a host mechanism or a
measurement first.

### 6.11 Token and context cost

Measured offline with Shelra's own loader and prompt builder (`TEST`; method in Appendix A):

| Item | Characters | Approx. tokens | When |
| --- | --- | --- | --- |
| Shelra's always-on prompt today (base prompt 5,553; this repository's `AGENTS.md` 11,967; skills catalog 5,029; context packet 697; 24 tool schemas 18,691) | ~42,000 | ~10,500 | every request |
| The untracked `spec-driven-development` skill's catalog entry | 617 | ~150 | every request in this repository, today |
| All 25 `agent-skills` in Shelra's catalog | 16,604 | ~4,150 | every request (the catalog grows from 5,029: +28% of the always-on prompt) |
| One skill body read | median 13,545, max 21,717 | ~3,400 to ~5,400 | once per read, then in the history re-sent at every later step until stale-result clearing (160,000 characters) |
| All 25 bodies | 340,210 | ~85,000 | never all at once, but a lifecycle chain of eight skills (`using-agent-skills:137`) is ~100,000 characters |
| `agent-skills`' SessionStart injection, if wired | 10,540 bytes | ~2,600 | every session |

The synthesis adds very little to the always-on prompt:

- no catalog entries;
- the floor guard, the state machine and the handoff record are code;
- CHALLENGE costs one sub-agent run, only on risk-triggered turns;
- the handoff adds a bounded block, and only on "continue".

### 6.12 Top five adoptions

Each passes the intelligence test, *does it raise the probability that the task is done right?*, and
each is rated on the model-independence test, *does it still help with a weaker model?*

| # | Adoption | From | Targets | Model-independent? | Plan phase |
| --- | --- | --- | --- | --- | --- |
| 1 | **The floor guard.** The definition of done is fixed at turn start. The host records the checks it discovered, and the test and checker configuration files, when the turn begins, then refuses moves that lower the bar. **Check moves:** a changed or removed check script or command-table row, or a lowered threshold or disabled rule in test, coverage or lint configuration. **Test moves:** added `.skip`, `.only`, `xit` or `pytest.mark.skip`; removed assertions; deleted test files, in new and existing files alike. **Silencing:** new suppressions (`@ts-ignore`, `eslint-disable`, `biome-ignore`, `noqa`), and stubs or empty `catch` blocks on changed lines. A move the request asks for passes. "Could not run" never reads as clean. Today's whole-file, keyword-gated protection of existing tests is then narrowed to these moves, so a legitimate update that adds to an expectation passes. | constraint-driven + floor-guard | S10 (reproduced); S2; the recorded F7 finding | **Yes.** Deterministic, no model call, no quota. | The S10 loophole is a correctness bug (owner's call to fix now); the rest in F7, where it is the plan's only recorded finding |
| 2 | **CHALLENGE, if its pre-test earns it: execution-grounded adversarial probes of the stated behaviours.** The existing `explore` sub-agent path runs with a fresh brief, not a new type. It gets the host-extracted requirement sentences, the diff, the contract results and the active decisions, but not the working model's reasoning. It splits the sentences into behaviours and returns at most one probe command per behaviour, favouring interactions between behaviours. The host runs each probe with a short timeout of its own and compares the workspace before and after, rejecting any probe that changed something; no sandbox exists off macOS, and the destructive guard is a net, not a sandbox (`security/destructive.ts:16-17`). A probe that fails before exercising the code (a syntax error, a wrong import) is discarded. A probe that fails on the code joins the acceptance tier and goes to REPAIR. If the working model disputes it, through `report_blocker` with the probe named, or does not repair it, the turn ends `[Not verified — disputed probe: …]`, and the TUI asks the user. A probe is never silently dropped and never forced. A challenger that fails means "challenge not run" and blocks nothing (resilience rule). | doubt-driven + Prove-It | S1: the reading of under-specified requests and the interactions between behaviours | **Partly.** It cannot create a false pass, but a misreading probe can push toward wrong behaviour; the dispute route and the user bound that. A same-model challenger may share the working model's misreading, as task 06 suggests. | F7, after the pre-test of §6.14 |
| 3 | **An explicit, persisted gate state machine** with the typed routes of §6.3 (REPLAN as a nudge, ENVIRONMENT for every check, REDEFINE), one total bound per turn, the Stop hook as a failing check, and LEARN on every exit. The `AgentKernel` phase labels are deleted; its mutation list stays. | the lifecycle, made executable | S3, S4, S8 | **Yes.** Host routing. | F7 groundwork, with the `agent.ts` split |
| 4 | **The handoff record and a persisted attempt ledger.** Open contract, failing checks, each attempt's change and result, the next step and open questions, written by the host at the end of a turn and read at INTAKE on "continue". Repeated diffs are refused. | context-engineering's restartable boundary + performance's attempt log | S5; doc 15 §21 items 2.2 and 4.5 | **Yes.** Host-written; the model only reads it. | F7 (continuity across sessions; F6 measures it) |
| 5 | **Named contract tiers, and constraints as decisions.** The verdict reports the definition of done and the acceptance criteria separately. Quality bars and ratchets are decisions with checks. The skill admission rule of §6.8-§6.9 applies to every tracked skill, and promotion from memory asks the owner. | definition-of-done + constraint-driven + evals discipline | S7; a clearer verdict; no parallel systems | **Yes.** | F8 (import); the admission rule as soon as the owner adopts it |

### 6.13 What not to import

| Do not import | Because |
| --- | --- |
| The 25 skills as a pack, or the meta-skill router | +28% always-on prompt, unmeasured effect, unreliable triggering (A2, A7), and software engineering gains least from curated skills (§5.3) |
| `/spec /plan /build /test /review /ship` as the lifecycle | Guarantees would depend on the user typing commands; headless runs have none (§6.7) |
| Anti-rationalization tables and "you MUST" rules | Unmeasured. Where wording was measured it moved strong models, but structure moved them further (ImpossibleBench, §5.3), and procedure text raised regressions on a 30B model (TDAD). Shelra has measured a prompt-level behaviour demand looping a 30B model for 96 steps (doc 14 §25.2). Shelra's structural controls (test protection, the floor) do this job for any model. |
| Human stops at every phase | Incompatible with headless runs, the benchmark and `--autonomous`; Shelra asks only for decisions that are the owner's |
| Persona fan-out (`/ship`) | Same model, text only, several times the tokens (4-15× for multi-agent, doc 15 §19) |
| `SPEC.md`, `tasks/plan.md`, `tasks/todo.md`, `CONSTRAINTS.md` as state | State the model maintains by hand; Shelra's contract, plan tool, ledger and handoff are host state |
| Shared references linked from skills | Hidden runtime dependencies (A8) |
| Lexical routing evals, forced-skill runs, LLM-judged traces | They measure compliance, not outcomes (A3) |
| `simplify-ignore` and on-disk rewriting of user code | Unsafe (A12) |
| Multi-host adapters, command copies, version validators | Shelra is the host |
| Commit per slice | Conflicts with commit-when-asked; the journal already gives per-attempt rollback |

### 6.14 Next step

**The smallest change with the largest gain in reliability is the floor guard (§6.12 item 1),
starting with its first slice: fix the definition of done at turn start.**

**Phase order.** The execution plan runs one phase at a time. A phase starts only after the previous
exit criterion is met, and the parallel-building clause covers the next phase's code, which is F5
(`docs/EXECUTION-PLAN.md`, working rules 2 and 4). F4 is not met yet. Two consequences:

- the loophole S10, a correctness bug in the verification spine, is the owner's call to fix now, as
  the review rounds' bugs were;
- everything else in §6.12 waits for F7, where it belongs.

**Why this one.**

- **It closes a reproduced hole** (S10). Today a turn can make "verified" mean whatever its own edit
  of the test script says. This audit did not search past runs for it. ImpossibleBench shows
  frontier models exploit tests at high rates when they can (§5.3).
- **It is deterministic, costs no quota, and helps any model equally.**
- **Its second slice is the plan's only recorded F7 finding:** test protection that blocks
  legitimate test updates.
- **CHALLENGE aims at the measured false completions but is not ready.** The measured cases are a
  misreading the model *tested under its own reading* (task 06) and an interaction nobody probed
  (task 08). A challenger of the same model may share the misreading, so its value is a hypothesis
  that needs the pre-test below first.

**First slice (zero quota). Done on 2026-09-24.**

- **Scope, as built.** The code is `src/contract/check-definitions.ts` and the gate block after test
  protection in `src/agent/agent.ts`. Two adversarial workflows attacked it: the first confirmed 15
  ways around the first version or false alarms, the second found where the fixes regressed or
  stopped short, and its verifiers re-ran the findings against the fixed code. Each confirmed case
  is now a test.
  - **What is recorded.** When the turn starts, in the session's workspace (never in a folder a
    `cd` moved the shell to), the host records each check and, part by part, everything in the
    project that decides what it runs:
    - the package scripts it calls, with their pre and post scripts, the scripts those call (in
      nested and workspace packages, through `npm-run-all` globs, `concurrently`, `--workspaces`
      and flags before the verb), and bare `yarn`/`pnpm` script calls;
    - a Make or just recipe: every rule for the target, its prerequisites, its variables and the
      variables those use (assignments of every kind and `define` blocks), the files it includes
      and their content, and whether a `GNUmakefile` would take its place;
    - the tooling files it executes (`scripts/run-tests.js`, `./test.sh`) and the local files those
      load, two levels deep; not the code under test, and not test files, which test protection
      guards;
    - the package manager's settings (`.npmrc`, `.yarnrc`, `.yarnrc.yml`, `pnpm-workspace.yaml`, the
      `packageManager` field);
    - the test runner's configuration under every name it is read from, including its absence:
      `pytest.ini`, `.pytest.ini`, `pytest.toml`, the pytest sections of `setup.cfg`, `tox.ini` and
      `pyproject.toml`, every `conftest.py`, `bunfig.toml` `[test]`, the Jest, Vitest, Vite, Mocha and
      Playwright config files in every extension, and the runner fields of `package.json`;
    - a `node_modules/.bin` shim and the file it points to (npm's `.cmd` and shell shims, links, and
      Bun's `.bunx`);
    - a local module that would shadow `python -m pytest` (`pytest`, `_pytest`, `pluggy`,
      `iniconfig`, `py`).
  - **What the contract runs.** The turn-start commands, in that workspace, also under the Shuru
    sandbox. A check source the turn added, or a command-table row it relabelled, does not change
    the definition of done.
  - **What counts as a change.** Any part that now runs something else. Not a change:
    - new steps appended after the old ones with `&&`, every old step still first and unchanged (a
      new first step, an `||`, or a `cd` or `exit` before the old steps is a change; a new
      `--exclude` counts as appended only when an appended step runs what it excludes), which covers
      this repository's own "add a `bun test <file>` step" convention;
    - a package-manager switch that comes only from a new lockfile;
    - a runner shim or entry file whose installed package changed version (a dependency update;
      the same version with other content is a change), and a `package.json` saved with a
      byte-order mark;
    - a part that was missing when the turn started (a script, a recipe, a file) and is now a
      recognised test runner (`vitest run`, `bun test`, `pytest`, `go test` …), never `echo`.
      A step skipped by `--if-present` or fanned out to workspaces is not missing.
  - **What the request allows.** A kind the request asks to change is judged as it is now. It asks
    when a verb acts on the check's script, command, runner or configuration ("update the test
    script", "migrate from jest to vitest", "upgrade ESLint", "make npm test also run the
    integration tests"), in English or Spanish, or when it merges other work in (`git merge`, a
    rebase). A prohibition ("don't change the lint script", "leave the scripts alone") takes away
    the kinds its clause names, or every kind when it names a check but no kind; "do not modify the
    tests" is about test files, not about what a check runs. A short approval ("yes, go ahead",
    "dale": approval words only, at most eight) keeps what the request it answers allowed; "ok, now
    fix X" is a new request. A sentence with any negation grants nothing, even one the prohibition
    lexicon does not know. A bare object ("fix the config loader so the tests pass") grants only a
    runner the sentence names, or a kind right after it ("the config for the tests"). Merging covers
    "merge PR #42", "sync with upstream" and "resolve the conflicts". Accepting a change already
    made ("keep the check changes", "keep the new test script", "acepta los cambios de los checks";
    never "keep the current test script", which forbids) allows it; every `[Not verified]` note
    about a changed check names that phrase.
  - **Who made the change.** Judged from each file as it was before the turn's first write to it
    (the attempt journal), so a script another session, the user's editor, a merge or a shell
    command changed is not blamed on the turn, even when the turn then wrote the same file for
    another reason. A file the turn found with merge-conflict markers is the merge's.
  - **What happens on a change.**
    - Made by the turn's own file edits: one round to put the checks back, then
      `[Not verified — it changed the checks that decide "done" …]`.
    - Made any other way: a neutral `[Not verified]` that tells the model to undo nothing.
    - Either way, the next turn in the session starts from the checks, and the files that define
      them, as they were, until a gate finds them unchanged and no new check source, so "continue"
      is not judged by the rewritten check. A change made outside the turn keeps later turns
      unverified the same way until the user accepts it: the cost of never letting a shell write
      launder a check into the next turn's definition of done.
  - **What does not count as evidence.** A check run counts only when it ran in the turn's
    workspace. When the project states no checks, a run of a check whose definition the turn changed
    (its script, recipe, runner settings or tooling, including files changed during the turn) does
    not count toward the evidence gate, unless the request allows that kind.
- **Verification, as run.**
  - The S10 probe is now a permanent test. It fails on the previous code, which ran the neutered
    script (`npm run test` → `echo`) and reported it passed, and it passes now.
  - Ten agent-level tests in `completion-gate.test.ts`, run through the agent's real `write_file`
    tool. Eight fail on the previous code:
    - rewriting the check;
    - putting it back;
    - "continue" after a rewrite;
    - a `cd` into another folder;
    - a script written in a project with no checks;
    - an explicit prohibition;
    - a change made outside the turn's edits;
    - another session's change to a file the turn then wrote.

    The other two, a request that asks for the change and a follow-up approval, pass on the
    previous code, which never blocked a change.
  - Twenty-four unit tests in `check-definitions.test.ts` cover the resolver, the appended-step rule,
    the repair rule, the recorded configuration, dependency updates, byte-order marks, the evidence
    discount, ownership and the request rules above (seven of them fail on `9e05f87`, the first
    commit of the fix, which the second round's verifiers re-tested); a `bash.test.ts` case covers a host run in the
    folder it names. Reading the definitions at turn start cannot end the turn: a failure is
    recorded and the turn runs unprotected.
- **Known gaps, not covered by this slice:**
  - the carry and the allowance live in the running session: a session resumed in a new process
    starts from the checks as they are on disk;
  - runner internals under `node_modules` beyond the shim's target, a shim created during the turn
    that shadows another (recording absent shims would flag every first `npm install`), and
    user-level settings such as `~/.npmrc`;
  - setup files that a Jest or Vitest config names (the config itself is recorded), and plugin
    modules that a `conftest.py` loads;
  - reading the definitions is synchronous and walks the project for `conftest.py` files (bounded
    to four levels): a cost on each check-like command in a very large monorepo;
  - configuration that weakens a lint or type check without touching its command (an ESLint rule
    turned off, `strict: false` in `tsconfig.json`): the second slice.
- **Second slice (F7).** Move-level test protection: the test and silencing moves of §6.12 item 1 in
  new and existing files, and additive expectation changes allowed. Measured on
  `shelra-agent-contract-v0.1`, where no regression is allowed, and on fixtures that need a legitimate
  test update, where today's keyword gate fails them.

**CHALLENGE pre-test, before any CHALLENGE code** (F7, owner-approved quota, a handful of requests):

- **The setup.** Give a fresh-context challenger the three failing F4 tasks, with their request, final
  code and contract results, and three passing F4 tasks as controls. The final code comes from the
  saved sessions, or from re-running when they were not kept.
- **Build it only if** its probes fail on at least 2 of the 3 failing tasks' code and on none of the
  controls.
- **If built, measure it this way:**
  - the oracle resolve rate as the primary metric, with Wilson intervals;
  - three arms paired by task: today's audit, CHALLENGE, and neither (with `--ablate audit`);
  - `[Not verified]` endings and timeouts reported per arm, since the benchmark's false-completion
    count excludes turns that end with a host note (`src/bench/agent-executor.ts:82, 287-290`), and a
    noisier note must not look like progress;
  - tokens against the F4 baseline (190K per task), not against the current code;
  - held-out tasks harder than the core suite (F7's fixtures).

  At n = 24, 3 against 1 false completions is not a significant difference (Fisher's exact test,
  one-sided p ≈ 0.3), and even 1 of 24 (4.2%) misses F7's ≤ 2%. The core suite alone cannot decide
  CHALLENGE.

### 6.15 What the review of this synthesis changed

An independent adversarial review of §6 (2026-09-24) raised four blocking findings. Each was checked
against the code and the run records before the text above was corrected.

**Blocking findings:**

1. **The first draft named task 06 as CHALLENGE's canonical case.** The run records show the model
   had already probed abort under its own reading (§2).
2. **The draft let a dispute drop a failing probe**, which would put the author back in the judge's
   seat. A dispute now ends `[Not verified]` and goes to the user.
3. **The draft's pass criterion could not separate 3 from 1 of 24.** It could also be met by noisier
   host notes, and 1 of 24 misses F7 anyway.
4. **The draft placed an F7 item ahead of an unmet F4.**

**Smaller corrections:**

- the gate has nine terminal exits, not eight, and seven of them skip learning;
- the judge covers decision checks only;
- REPLAN partly exists and must stay a nudge;
- headless REDEFINE is today's `report_blocker` exit;
- promotion to skills is automatic today;
- probes can write through `bash`, since no sandbox exists off macOS.

Designing the floor guard's first slice after the review led to the reproduced loophole S10. That
changed the next step.

## Appendix A. How to reproduce

- **External repository:** `git clone https://github.com/addyosmani/agent-skills` and `git checkout
  bcab6a1`. Then, offline:
  - `node scripts/validate-skills.js`, `node scripts/validate-commands.js`,
    `node scripts/validate-reference-links.js`;
  - `node scripts/run-evals.js --min-rank1 95`;
  - `node --test scripts/*-test.js`.
- **Catalog cost in Shelra's loader:** copy the clone's `skills/` to `<scratch>/proj/.agents/skills`.
  Then, with `HOME` and `USERPROFILE` pointed at an empty scratch folder, run from this repository
  `bun -e` with `discoverSkills(<scratch>/proj)` and `formatSkillsForPrompt(...)` from
  `src/utils/skills.ts`, and take the length of the result. Run the same on this repository, with and
  without the untracked skill.
- **Shelra's always-on prompt:** the pattern of doc 15's `15-evidence/probes/`, with `HOME` pointed at
  scratch; no model call.
- **The S10 loophole.** A scripted-model Vitest case on `Agent.processMessage` with the real check
  runner, built on the harness of `src/agent/completion-gate.test.ts`:
  - the workspace holds `package.json` with `"test": "bun test"`, a `src/slug.ts` stub, and
    `src/slug.test.ts` expecting `slugify(' A ')` to be `'a'`;
  - the scripted model writes a wrong `slugify` (identity), then says "Done.";
  - **control:** the turn ends `[Not verified]`;
  - **probe:** the model also rewrites `package.json` to `"test": "echo 1 pass"`, and the turn ends
    "[Checked by Shelra on the final code …]".

  Run on 2026-09-24 from a temporary file that was deleted afterwards; both cases behaved as
  described. It is the first test the fix in §6.14 must turn around.
- **The F4 failures:** `bench/history/benchmark-history.json`, runs `F4C-*` and `F4B-*`,
  `taskResults[].acceptance` and `finalResult.finalTextExcerpt`.

## Appendix B. Where Shelra's documentation, comments and code disagree (found by this audit)

B1-B7 were corrected on 2026-09-24, together with the S10 fix: the documents and comments now say
what the code does. B8 was left as it is on purpose, because tool text is behaviour and changing it
needs a benchmark re-run (`CLAUDE.md`).

| # | Statement | Where | What the code does |
| --- | --- | --- | --- |
| B1 | "a plan criterion whose command failed before the change joins them" | `CLAUDE.md` | A criterion whose command did not pass before joins, including one that was not run (`agent.ts:3250`, `commandBefore !== "passed"`) |
| B2 | File tools "already require generate_plan first"; plan-gate comments | `agent.ts:3014-3016`, `:452`; `toolset/tools.ts:82`; `bench/agent-executor.ts:23` | There is no plan gate: `planState.published` is written (`tools.ts:1272`) and never read |
| B3 | `AGENTS.md` and `CLAUDE.md` are merged into the prompt | `context/compiler.ts:259-260` (comment) | Only the `AGENTS.md` / `AGENTS.override.md` chain is loaded (`utils/instructions.ts:36-55`). `CLAUDE.md` is read only for its command table (`contract/discover.ts:76`) |
| B4 | "Blocking Stop hooks" | `CLAUDE.md` | A blocking Stop hook ends the turn with `[Not marked complete — …]`. The reason is not sent back to the model (`agent.ts:3580-3595`). `UserPromptSubmit` cannot block (`agent.ts:2382`) |
| B5 | "An entry gains credit when the project's checks pass with it in context" | `AGENTS.md` | True only where a contract applies. A project with no stated checks never earns credit, so promotion never fires there. User-scope entries are never credited |
| B6 | Reflection after a turn that "worked through a failure" | `AGENTS.md` | Skipped on the protected-test, decision-record, no-evidence, Stop-hook and `report_blocker` exits (`agent.ts:3102-3148, 3534-3548, 3584-3595`) |
| B7 | "Index lines always" | `docs/design/shelra-memory-engine.md` | The listing is capped at 12 (`memory/retrieval.ts:50`) |
| B8 | `update_plan_step`: "complete only after concrete evidence exists" | tool description (`tools.ts:1351`) | Not checked by the host |

## Appendix C. Sources

`agent-skills` files are cited inline at `bcab6a1`. External sources carried over from doc 15 §14 and
`15-evidence/frontier-practices.md`:

- [SKILLSB] arXiv 2602.12670 (v1 2026-02-13, v4 2026-06-14)
- [AGENTSMD] arXiv 2602.11988 (2026-02-12, v2 2026-06-23)
- [VERCEL] https://vercel.com/blog/agents-md-outperforms-skills-in-our-agent-evals (2026-01-27)
- [HDSTUDY] arXiv 2609.20804
- [TB2] arXiv 2601.11868

Sources added by this audit's Round 2. ✓ means re-read by the auditor at its primary location on
2026-09-24; the rest are as the red-team reported them.

| Key | Source | Date | Label |
| --- | --- | --- | --- |
| ✓ SKILLSB v4 | SkillsBench, https://arxiv.org/abs/2602.12670 (v4) | 2026-06-14 | EXP |
| ✓ TDAD | TDAD: Test-Driven Agentic Development…, https://arxiv.org/abs/2603.17973 | 2026-03-18 | EXP |
| ✓ VERCEL | https://vercel.com/blog/agents-md-outperforms-skills-in-our-agent-evals | 2026-01-27 | EXP |
| ✓ SKILL-CREATOR | Anthropic, https://github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md | read 2026-09-24 | vendor |
| ✓ CC-SKILLS | Claude Code skills documentation, https://code.claude.com/docs/en/skills | read 2026-09-24 | vendor |
| ✓ SHADOW | More Skills, Worse Agents? Skill Shadowing…, https://arxiv.org/abs/2605.24050 | 2026-05-21 | EXP |
| ✓ AGENTSMD | Evaluating AGENTS.md…, https://arxiv.org/abs/2602.11988 | 2026-02-12 | EXP |
| ✓ IMPOSSIBLE | ImpossibleBench, https://arxiv.org/abs/2510.20270 | 2025-10-23 | EXP |
| ✓ PLANCOMP | From Plan to Action: How Well Do Agents Follow the Plan?, https://arxiv.org/abs/2604.12147 (v3) | 2026-08-07 | EXP |
| IFSCALE | https://arxiv.org/abs/2507.11538 | 2025-07-15 | EXP |
| MTAC | https://arxiv.org/abs/2609.14992 | 2026-09-14 | EXP |
| PERSONA | Zheng et al., https://arxiv.org/abs/2311.10054 (EMNLP Findings 2024) | 2024 | EST |
| SELFCORR | Huang et al., https://arxiv.org/abs/2310.01798 (ICLR 2024) | 2024 | EST |
| MAD | https://arxiv.org/abs/2502.08788 | 2025 | EXP |
| SWR | SWR-Bench, https://arxiv.org/abs/2509.01494 | 2025 | EXP |
| BOECKELER | https://martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html | 2025-10-15 | practitioner |
| EBERHARDT | https://blog.scottlogic.com/2025/11/26/putting-spec-kit-through-its-paces-radical-idea-or-reinvented-waterfall.html | 2025-11-26 | practitioner |
| COMPARISON | `agent-skills` `docs/comparison.md` at `bcab6a1` | 2026-09-22 | anecdotal |
