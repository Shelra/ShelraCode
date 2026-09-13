# The commodity map

What a new entrant must not build as its differentiation. Full evidence:
`research/lanes/05-commodity-map.md`, all product facts fetched 8 September 2026.

---

## 1. The verdict in one paragraph

The agent scaffold is no longer a moat, and the benchmark community has formalised that judgement.
swebench.com now **defaults to a "Bash Only" view** that runs every model inside mini-SWE-agent — a
~100-line, bash-only harness — with the tooltip *"so scores compare models rather than harnesses"*. Scale
AI runs its commercial SWE-bench Pro leaderboard on the same 100-line agent. On Terminal-Bench 4.0 the two
most sophisticated harnesses in existence sit **0.30 points apart** (Codex 58.18%, Claude Code 57.88%)
while changing the *effort level* inside one harness moves the score by **7.57 points**.

> If you are building a better agent loop, you are building the thing the field has formally agreed to
> hold constant.

## 2. Classification

**COMMODITY** = shipped by ≥3 independent systems, at least one free or open, standardised or trivially
copied.

| Capability | Class | Since |
|---|---|---|
| LLM chat and code generation | COMMODITY | 2023 |
| Terminal execution, file read/search/edit | COMMODITY | 2024 |
| Plan mode / plan-then-act | COMMODITY | 2025 |
| Repo search (grep-first) | COMMODITY | 2026 |
| **Embedding / semantic codebase index** | **DECLINING — do not build** | peaked 2024 |
| Read-only exploration subagent | COMMODITY | Oct 2025 |
| Skills (`SKILL.md`) | COMMODITY — **open standard** | standardised 2025-12-18 |
| Hooks | COMMODITY | Jun 2025 |
| Subagents / delegation | COMMODITY | Jul 2025 |
| MCP | COMMODITY — standardised | Nov 2024 |
| Plugins and marketplaces | COMMODITY | 2026 |
| Sandboxing and permission classifiers | COMMODITY | Mar–Jun 2026 |
| Checkpoints, rewind, worktrees | COMMODITY | 2026 |
| Background / cloud / scheduled agents, goal mode | COMMODITY | 2025–2026 |
| Procedural / auto memory | COMMODITY | 2026 |
| Model routing, fallback, multi-provider | COMMODITY | 2026 |
| Browser control and computer use | COMMODITY | 2026 |
| PR review as a product | COMMODITY | 2026 |
| Spec-document generation | COMMODITY | 2025→2026 |
| **Clarifying questions — the act, not the judgement** | COMMODITY | Oct 2025 → Jan 2026 |
| Config import/export between agents | COMMODITY (adversarially so) | 2026 |
| Context compaction | BECOMING COMMODITY (quality still varies) | 2025 |
| Multi-agent orchestration at scale | BECOMING COMMODITY | May 2026 |
| Security scanning by agent | BECOMING COMMODITY | Jul 2026 |
| Self-evolving skills / trajectory learning | RESEARCH-STAGE (artifact is commodity) | 2026 |
| **Cross-session accumulated state** | **DIFFERENTIABLE — open** | — |
| **Reality feedback: did the shipped change still match intent** | **DIFFERENTIABLE — open** | — |

Note the shape of the last two rows: they are the final arrows of the north-star chain. **The incumbents
have taken everything to the left of them.**

## 3. Two structural facts that bound any new entrant

**The absorption lag collapsed.** 2025-era absorptions took 6–7 months. The two most recent took **26 and
19 days**.

| Capability | First shipped | Absorbed by | Lag |
|---|---|---|---|
| Hooks | Claude Code, 2025-06-30 | Cursor CLI 2026-01 | ~7 mo |
| Custom subagents | Claude Code, 2025-07-24 | Cursor 2.4, 2026-01-22 | 6 mo |
| Skills → open standard | 2025-10-16 | agentskills.io, 2025-12-18 | **63 days** |
| Open standard → Cursor | 2025-12-18 | Cursor 2.4, 2026-01-22 | **35 days** |
| Clarifying questions in plan mode | Claude Code, 2025-10-16 | Cursor 2.4 | 3 mo |
| Goal mode | Claude Code, 2026-05 | Cursor, 2026-08-19 | 3 mo |
| Self-hosted execution environments | Claude Code, 2026-08-03 | Cursor, 2026-09-02 | **26 days** |
| Cross-session agent messaging | Claude Code, 2026-08-03 | Codex 0.150.0, 2026-08-26 | **19 days** |

**Configuration lock-in no longer exists.** Codex `/import` pulls instructions, settings, skills, plugins,
projects and up to 50 recent chats out of Claude Code or Cursor, with optional automatic sync. Cursor's CLI
reads Claude Code `settings.json` hooks and loads `.claude/skills`; Copilot reads `.claude/skills`;
OpenCode reads six skill paths including Claude's.

> Any thesis of the form "we win because users configure us deeply" is dead on arrival.

## 4. What agents still fail at — and it is not the patch

*(OBSERVED TODAY, with numbers)*

- **End-to-end autonomy.** SWE-Cycle: with gold inputs, environment reconstruction 78.1%, verification test
  generation 67.3%, code implementation 40.1%. **Fully autonomous from a bare repository: 13.5%**, and *"no
  model exceeded 14% strict solve rate."*
- **Multi-release evolution.** SWE-EVO: best model 25%; gpt-5.2 drops from 72.80% on SWE-bench Verified to
  **22.92%**.
- **Their own accumulated state.** ChainSWE, 304 chronologically ordered issues across 54 projects:
  degradation **up to −70%** along a chain; by chain position, accuracy falls 58.6% → 39.3% → 27.7%. And
  the decisive line: **"48% of downstream failures at positions 2–3 stem from accumulated agent-generated
  state rather than intrinsic bug difficulty; under-edits outnumber over-edits nine-to-one."**
- **Non-test acceptance.** SWE-Gate: **221 of 644** test-passing repairs violate the review constraints
  that decide real acceptance.

**Nobody ships a "what did I leave half-done in this repository" ledger** — which is precisely what the
benchmark says is killing them. Auto memory stores preferences and corrections; Claude Code's own docs say
it *"skips anything it can derive from the codebase, such as architecture, file paths, or debugging fixes."*

## 5. Benchmark integrity

OpenAI formally retired SWE-bench Verified on **23 February 2026**: *"We audited a 27.6% subset … and found
that at least 59.4% of the audited problems have flawed test cases that reject functionally correct
submissions"*, plus contamination — *"all frontier models we tested were able to reproduce the original,
human-written bug fix."*

The official leaderboard's best verified entry is **79.2%**, and its newest submission of any kind is
**26 February 2026**. Six months of silence. Any 90%+ SWE-bench Verified claim circulating on aggregator
sites is a vendor self-report on an abandoned metric — one aggregator concedes *"99 of the 100 leaderboard
entries are self-reported."*

## 6. Contradictions with common belief

1. **"Coding is basically solved at 95%."** On benchmarks the community still measures — Terminal-Bench
   4.0, SWE-bench Pro, SWE Atlas, SWE-Cycle, SWE-EVO — frontier systems sit between **13.5% and 61.5%**.
2. **"The harness is where the value is."** The field made a 100-line agent the control condition.
3. **"Codebase indexing is a durable moat."** Cursor — the company that made semantic indexing famous — no
   longer has a codebase-indexing docs page; the URL 404s. Retrieval collapsed into grep plus a cheap
   read-only subagent.
4. **"Open source is a year behind."** Under an identical bash-only harness, open-weight MiniMax M2.5
   scored 75.8% against Claude 4.5 Opus's 76.8% — **at one-tenth the cost ($36.6 vs $377)**.
5. **"Skills are a startup category."** The format is an open standard read by ~50 products, several
   directly out of each other's directories. Within eleven months the interesting problem moved from skill
   *generation* to skill *curation and retirement* — Anthropic shipped `/skill-doctor` on 2026-09-04.

## 7. Problems nobody is talking about

1. **No published harness ablation for a single fixed model.** Everyone reports "model + harness". The one
   dimension where designs still genuinely diverge — context compaction, with 7 distinct strategies across
   13 agents — is the one dimension nobody evaluates.
2. **Cost dispersion of 3–10× at equal capability is not a product.** Terminal-Bench: 58.18% for $3,267
   against 57.88% for $6,244 — a 91% premium for −0.30 points. Codex at *low* effort gets 87% of the top
   score for 24% of the cost. Vendors ship effort sliders whose recommended settings move *up*.
3. **The evaluation vacuum after SWE-bench Verified has no auditor.** The recommended replacement is run by
   a vendor that also sells evaluation services, and rubric-graded benchmarks may inherit the same omission
   bias they were introduced to escape.
4. **Skill and plugin sprawl arrived with no provenance, no attestation and no lifecycle.** Skills execute
   shell commands via dynamic injection and install from marketplaces. There is no cross-vendor signing.
5. **Nobody measures whether the clarifying question was the *right* one.** Three vendors ship
   clarification; zero benchmarks score it. Given semantic collapse, the feature most likely fires when the
   model is already uncertain and stays silent exactly when the whole ensemble is confidently wrong — a
   shipped capability with an unmeasured and probably inverted hit rate.
6. **The independents are quietly dying and nobody is writing the post-mortem.** Aider — 48,832 stars, the
   tool that popularised repo maps and diff edit formats — last shipped a release on 2025-08-09 and has no
   skills, hooks, subagents or MCP.

## 8. Direct answer

**Do not differentiate on:** the agent harness; terminal, file or browser tooling; retrieval; skills;
hooks; subagents; MCP; plugins; sandboxing; checkpoints; memory; model routing; background agents; goal
loops; PR review; security scanning; spec-document generation; or "we ask better clarifying questions" as a
feature rather than as a measured judgement.

Every one is shipped by three or more systems including at least one free and open-source, or standardised
such that your implementation is loadable by your competitor. **The observed absorption lag gives you
between 19 days and 8 months.**
