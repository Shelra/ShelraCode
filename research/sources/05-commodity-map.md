# Lane 05 — Sources

All accessed **2026-09-08** unless noted. `VERIFIED` = fetched and read this pass. `UNVERIFIED` = title
and URL seen in a search result but the page itself was not fetched, or the fetch failed.

**Access note:** the session's WebSearch budget was exhausted before this lane began. Discovery used
Brave Search and Bing HTML endpoints through WebFetch (Brave produced 6 usable result pages before
returning 429/CAPTCHA; DuckDuckGo, DuckDuckGo Lite, Mojeek, Ecosia and Startpage all blocked). The arXiv
API returned HTTP 429 on every attempt (4 tries via the `arxiv-search` skill and direct `curl`), so no
systematic dated arXiv listing was produced; papers were reached by direct `arxiv.org/html/<id>` and
`arxiv.org/abs/<id>` fetches. GitHub's REST API rate-limited after one call from this IP, so most
repository licences could not be confirmed.

---

## A. Vendor primary sources — product documentation and changelogs

| # | Title | Org / author | Date | URL | Status | What it evidences |
|---|---|---|---|---|---|---|
| 1 | Claude Code CHANGELOG.md (387 version entries; downloaded and grepped) | Anthropic | latest entry v2.1.263 | https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md | VERIFIED | Exact feature first-appearances: hooks v1.0.38, custom subagents v1.0.60, Explore subagent v2.0.17, Claude Skills v2.0.20, interactive question tool v2.0.21, `/skill-doctor` v2.1.261 |
| 2 | npm registry metadata for `@anthropic-ai/claude-code` (publish timestamps) | npm / Anthropic | modified 2026-09-06 | https://registry.npmjs.org/@anthropic-ai/claude-code | VERIFIED | Hard dates for every version above: 1.0.38 = 2025-06-30, 1.0.60 = 2025-07-24, 2.0.20 = 2025-10-16, 2.1.83 = 2026-03-24, 2.1.263 = 2026-09-06 |
| 3 | Claude Code — Overview | Anthropic | fetched 2026-09-08 | https://code.claude.com/docs/en/overview | VERIFIED | Surfaces, MCP, skills, hooks, subagents, background agents, routines, auto memory, Chrome, Slack |
| 4 | Claude Code — documentation index (`llms.txt`) | Anthropic | fetched 2026-09-08 | https://code.claude.com/docs/llms.txt | VERIFIED | Complete feature surface: agent teams, workflows, cross-session messaging, artifacts, channels, goal, checkpointing, sandboxing, self-hosted environments, ultrareview |
| 5 | Claude Code — What's new (weekly digests, weeks 13–34 of 2026) | Anthropic | 2026-03-23 → 2026-08-21 | https://code.claude.com/docs/en/whats-new/index.md | VERIFIED | Dated ship log for auto mode, computer use, ultraplan, routines, ultrareview, agent view, `/goal`, `/code-review`, dynamic workflows, artifacts, Chrome GA, Opus 5, cross-session messaging, self-hosted environments |
| 6 | Claude Code — Orchestrate subagents at scale with dynamic workflows | Anthropic | fetched 2026-09-08 | https://code.claude.com/docs/en/workflows.md | VERIFIED | ≤1000 agents/run, ≤4096 items/call, 16 concurrent, "Large workflow" warning at 25 agents / 1.5M tokens, `/deep-research`, size guidelines |
| 7 | Claude Code — Extend Claude with skills | Anthropic | fetched 2026-09-08 | https://code.claude.com/docs/en/skills.md | VERIFIED | `SKILL.md`, progressive disclosure, six load locations, spec-compliant vs Claude-Code-extension frontmatter, agentskills.io conformance, `disableSkillShellExecution` |
| 8 | Claude Code — How Claude remembers your project (memory) | Anthropic | fetched 2026-09-08 | https://code.claude.com/docs/en/memory.md | VERIFIED | Auto memory on by default, four note types, per repository, first 200 lines / 25 KB, subagent memory |
| 9 | Claude Code — Set up Claude Code in a monorepo or large codebase | Anthropic | fetched 2026-09-08 | https://code.claude.com/docs/en/large-codebases.md | VERIFIED | Grep + deny rules + LSP code-intelligence plugins + per-directory skills; RAG only via MCP; no embeddings index |
| 10 | Claude Code — Extend Claude Code (features overview) | Anthropic | fetched 2026-09-08 | https://code.claude.com/docs/en/features-overview.md | VERIFIED | Vendor's own comparison of CLAUDE.md / skills / subagents / workflows / hooks / MCP / plugins |
| 11 | ChatGPT & Codex changelog | OpenAI | entries 2026-08-26 → 2026-09-04 | https://learn.chatgpt.com/docs/changelog | VERIFIED | Codex CLI 0.150.0–0.153.4; plugin marketplaces, `Interrupt` hooks, task `@`-mentions, remote compaction, GPT-6 Astra |
| 12 | Codex / ChatGPT documentation index (`llms.txt`) | OpenAI | fetched 2026-09-08 | https://learn.chatgpt.com/docs/llms.txt | VERIFIED | Full surface: AGENTS.md, rules, subagents, hooks, plugins, skills, MCP, sandboxing, auto-review, memories, worktrees, `/goal`, computer use, security CLI/SDK |
| 13 | Codex — Import from another agent | OpenAI | fetched 2026-09-08 | https://learn.chatgpt.com/docs/import.md | VERIFIED | `/import` from Claude Code and Cursor: instructions, settings.json→config.toml, skills, plugins, projects, ≤50 chats, optional sync |
| 14 | Codex — Hooks | OpenAI | fetched 2026-09-08 | https://learn.chatgpt.com/docs/hooks.md | VERIFIED | 12 lifecycle events near-identical to Claude Code's; trust-review flow; hook discovery locations |
| 15 | Codex — Subagents | OpenAI | fetched 2026-09-08 | https://learn.chatgpt.com/docs/agent-configuration/subagents.md | VERIFIED | Subagent workflows default-on; context pollution / context rot rationale |
| 16 | Codex — Long-running work | OpenAI | fetched 2026-09-08 | https://learn.chatgpt.com/docs/long-running-work.md | VERIFIED | `/goal` on app, CLI, IDE; `/plan` = "Ask ChatGPT to interview you ... measurable success criteria" |
| 17 | Codex — Build skills | OpenAI | fetched 2026-09-08 | https://learn.chatgpt.com/docs/build-skills | VERIFIED | Codex skills "build on the open agent skills standard"; `.agents/skills` at repo/user/admin/system scope |
| 18 | Codex — Memories | OpenAI | fetched 2026-09-08 | https://learn.chatgpt.com/docs/customization/memories.md | VERIFIED | Automatic memory generation into `~/.codex/memories/`, idle-triggered, secret redaction |
| 19 | Cursor changelog (latest entries) | Anysphere | 2026-08-13 → 2026-09-02 | https://cursor.com/changelog | VERIFIED | Self-hosted machines (2026-09-02), repo-less start (2026-08-27), cloud agents + `/goal` + subagent VMs (2026-08-19), Origin code hosting (2026-08-17), prebuilt envs (2026-08-13) |
| 20 | Cursor 2.4 — Subagents, Skills, and Image Generation | Anysphere | 2026-01-22 | https://cursor.com/changelog/2-4 | VERIFIED | Skills (`SKILL.md`), subagents, Clarification Questions, Cursor Blame, 29 improvements |
| 21 | Cursor 3.0 — New Cursor Interface | Anysphere | 2026-04-02 | https://cursor.com/changelog/3-0 | VERIFIED | Agents Window, Design Mode, `/worktree`, `/best-of-n`, Explorer subagent caching, MCP Apps |
| 22 | Cursor CLI changelog | Anysphere | Jan 2026 → 2026-08-26 | https://cursor.com/docs/cli/changelog | VERIFIED | Hooks Jan 2026 (and "Claude Code settings.json hooks are read and merged"), subagents Mar 2026, plugin marketplaces May–Jul 2026, sandbox three-mode model, auto-review |
| 23 | Cursor — Skills | Anysphere | fetched 2026-09-08 | https://cursor.com/docs/context/skills | VERIFIED | Agent Skills open standard; backward-compat loading from `.claude/skills` and `~/.claude/skills`; `/migrate-to-skills` in 2.4 |
| 24 | Cursor — Subagents | Anysphere | fetched 2026-09-08 | https://cursor.com/docs/agent/subagents | VERIFIED | YAML frontmatter, `readonly`, `is_background`, worktree/cloud VM isolation, `claude-opus-5[effort=high,context=300k]` model syntax |
| 25 | Cursor — Hooks | Anysphere | fetched 2026-09-08 | https://cursor.com/docs/agent/hooks | VERIFIED | Agent/Tab/workspace event set, deny/allow/ask/modify, prompt-based hooks, `failClosed`, enterprise→user precedence |
| 26 | Cursor — Search (Instant Grep) | Anysphere | fetched 2026-09-08 | https://cursor.com/docs/agent/tools/search.md | VERIFIED | Instant Grep + Explore subagent are the entire documented retrieval story; path encryption |
| 27 | Cursor — codebase indexing page | Anysphere | fetched 2026-09-08 | https://cursor.com/docs/context/codebase-indexing.md | VERIFIED — **404** | Semantic index no longer documented |
| 28 | Cursor documentation index (`llms.txt`) | Anysphere | fetched 2026-09-08 | https://cursor.com/llms.txt | VERIFIED | Full page list: plugins, rules, skills, subagents, hooks, MCP, cloud agents, grok-bot, Bugbot, worktrees; 11 supported models |
| 29 | OpenCode docs — overview | Anomaly | updated 2026-09-08 | https://opencode.ai/docs/ | VERIFIED | Terminal/desktop/IDE, plan vs build modes, agent skills, plugins, MCP, LSP, permissions, sharing |
| 30 | OpenCode docs — Agents | Anomaly | updated 2026-09-08 | https://opencode.ai/docs/agents/ | VERIFIED | Build/Plan primary agents; General/Explore/Scout subagents; per-agent model, permissions, temperature, `steps` cap |
| 31 | OpenCode docs — Skills | Anomaly | updated 2026-09-08 | https://opencode.ai/docs/skills/ | VERIFIED | Six skill paths including `.claude/skills`, `~/.claude/skills`, `.agents/skills` |
| 32 | npm registry metadata for `opencode-ai` | npm / Anomaly | latest 1.18.29, 2026-09-04 | https://registry.npmjs.org/opencode-ai | VERIFIED | Release cadence; first publish 2025-05-31; 12,090 versions |
| 33 | OpenHands documentation home | OpenHands | fetched 2026-09-08 | https://docs.openhands.dev/ | VERIFIED | Agent Canvas, Software Agent SDK, Agent Server, Sandbox Server, Cloud, CLI; per-repo licences |
| 34 | OpenHands — Skills | OpenHands | fetched 2026-09-08 | https://docs.openhands.dev/overview/skills | VERIFIED | "OpenHands supports the Agent Skills specification"; `.agents/skills`, `.openhands/skills`, legacy microagents; CLAUDE.md/GEMINI.md recognition |
| 35 | Cline documentation index (`llms.txt`) | Cline | fetched 2026-09-08 | https://docs.cline.bot/llms.txt | VERIFIED | Rules, skills, plugins, hooks, MCP, plan&act, checkpoints, subagents, memory bank, agent teams, scheduled agents, SDK, OpenTelemetry |
| 36 | Cline documentation home | Cline | fetched 2026-09-08 | https://docs.cline.bot/ | VERIFIED | Editor + terminal agent, explicit approval model, multi-IDE, SDK/Agent Core |
| 37 | Aider release history | Aider-AI | latest v0.86.0, 2025-08-09 | https://aider.chat/HISTORY.html + https://api.github.com/repos/Aider-AI/aider/releases | VERIFIED | Last release 2025-08-09; no skills/hooks/subagents/MCP |
| 38 | Aider repository metadata | Aider-AI / GitHub | pushed 2026-05-22 | https://api.github.com/repos/Aider-AI/aider | VERIFIED | 48,832 stars, Apache-2.0, created 2023-05-09, not archived, last push 2026-05-22 |
| 39 | SWE-agent repository metadata | SWE-agent org / GitHub | pushed 2026-09-07 | https://api.github.com/repos/SWE-agent/SWE-agent | VERIFIED | 20,285 stars, MIT, created 2024-04-02, actively maintained |
| 40 | mini-SWE-agent README | SWE-agent org | fetched 2026-09-08 | https://raw.githubusercontent.com/SWE-agent/mini-swe-agent/main/README.md | VERIFIED | ~100 lines of Python; bash-only; `subprocess.run` per action; linear history; ">74% on the SWE-bench verified benchmark" |
| 41 | Kiro documentation | AWS | updated 2026-09-02 | https://kiro.dev/docs/ | VERIFIED | Specs, steering, hooks, MCP, skills, custom agents + sub-agents, permissions, one engine across IDE/CLI/Web/Mobile |
| 42 | Kiro — Specs | AWS | page dated 2026-08-27 | https://kiro.dev/docs/specs/ | VERIFIED | requirements.md / design.md / tasks.md; dependency-graph "waves" of concurrent tasks; EARS notation NOT mentioned |
| 43 | Kiro homepage | AWS | fetched 2026-09-08 | https://kiro.dev/ | VERIFIED | "Built and operated by AWS"; credit pricing with pre-paid overages; markets property-based testing; Kiro Crew open source |
| 44 | Kiro property-based testing docs | AWS | fetched 2026-09-08 | https://kiro.dev/docs/property-testing/ | **404 — UNVERIFIED** | The marketed verification claim could not be confirmed |
| 45 | Google Antigravity — Getting started | Google | fetched 2026-09-08 | https://antigravity.google/docs/getting-started | VERIFIED | v2.12.2, CLI 1.1.25, SDK 0.1.16, IDE ext 2.5.5; Projects as boundaries; Local vs New Worktree mode; artifacts incl. browser recordings; Chrome control |
| 46 | Devin documentation home | Cognition | fetched 2026-09-08 | https://docs.devin.ai/ | VERIFIED | Shell + IDE + browser; web app, CLI, Slack/Teams, API; ~3-hour task rule of thumb; ACU pricing NOT FOUND on this page |
| 47 | Cognition blog index | Cognition | posts 2026-07-08 → 2026-07-28 | https://cognition.com/blog | VERIFIED | SWE-1.7 (2026-07-08), Devin Fusion (2026-07-13), FedRAMP High in process (2026-07-13), Devin Security Swarm |
| 48 | Gemini CLI — Skills | Google | page updated 2026-04-30 | https://geminicli.com/docs/cli/skills/ | VERIFIED | Follows Agent Skills open standard; four-tier discovery incl. `~/.agents/skills`; `.agents/skills` "provides interoperability across different AI tools" |
| 49 | npm registry metadata for `@google/gemini-cli` | npm / Google | latest 0.58.0, 2026-09-01 | https://registry.npmjs.org/@google/gemini-cli | VERIFIED | Active release cadence; first publish 2025-06-25 |
| 50 | npm registry metadata for `@openai/codex` | npm / OpenAI | latest 0.153.4, 2026-09-04 | https://registry.npmjs.org/@openai/codex | VERIFIED | 4,330 versions; first publish 2025-04-16 |
| 51 | GitHub Copilot — About agent skills | GitHub | fetched 2026-09-08 | https://docs.github.com/en/copilot/concepts/agents/about-agent-skills | VERIFIED | Copilot reads `.github/skills`, **`.claude/skills`** and `.agents/skills`; cloud agent, code review, CLI, VS Code and JetBrains agent mode |
| 52 | Amp manual | Sourcegraph | fetched 2026-09-08 | https://ampcode.com/manual | VERIFIED | Multi-model routing (GPT-5.6, Claude Fable 5.1, fast models), Orbs, threads, skills, plugins, MCP, agent-to-agent |
| 53 | GitHub Spec Kit README | GitHub | v1.0.0; maintainer post dated 2026-08-21 | https://raw.githubusercontent.com/github/spec-kit/main/README.md | VERIFIED | "30+ AI coding agents"; `/speckit.constitution|specify|plan|tasks|implement|converge|clarify|analyze|checklist` |

## B. Standards bodies and cross-vendor infrastructure

| # | Title | Org / author | Date | URL | Status | What it evidences |
|---|---|---|---|---|---|---|
| 54 | Agent Skills — Overview and client showcase | Agent Skills (originated at Anthropic, released as open standard) | fetched 2026-09-08 | https://agentskills.io/ | VERIFIED | The format spec, progressive disclosure, and the full client list (~50 products) used for the commodity count |
| 55 | Model Context Protocol — What is MCP? | MCP project | spec path dated 2026-07-28 | https://modelcontextprotocol.io/ | VERIFIED | MCP as open standard; broad client support named (Claude, ChatGPT, VS Code, Cursor); **no foundation/governance statement found** |

## C. Benchmarks and leaderboards

| # | Title | Org / author | Date | URL | Status | What it evidences |
|---|---|---|---|---|---|---|
| 56 | Why SWE-bench Verified no longer measures frontier coding capabilities | OpenAI | 2026-02-23 | https://openai.com/index/why-we-no-longer-evaluate-swe-bench-verified/ | VERIFIED (fetched with curl; WebFetch was 403) | 74.9%→80.9% in 6 months; 27.6% audit subset; 59.4% of 138 audited problems flawed; 35.5% narrow / 18.8% wide / 5.1% misc; gold-patch recall by all frontier models; recommendation to report SWE-bench Pro |
| 57 | SWE-bench Leaderboards (with embedded `leaderboard-data` JSON, 5 boards, 180 Verified entries) | SWE-bench team | fetched 2026-09-08 | https://www.swebench.com/ | VERIFIED | "Bash Only" default view tooltip; best Verified 79.2%; newest entry 2026-02-26; 2026-02-17 mini-SWE-agent sweep with per-model cost |
| 58 | SWE-Bench Pro Public leaderboard | Scale AI | fetched 2026-09-08 | https://labs.scale.com/leaderboard/swe_bench_pro_public | VERIFIED | Muse Spark 1.1 61.50±3.10; GPT-5.4 (xHigh) 59.10±3.56; claude-opus-4-6 51.90±3.61; gemini-3.1-pro 46.10±3.60; mini-swe-agent harness, 250-turn cap |
| 59 | SWE Atlas — Refactoring leaderboard | Scale AI | fetched 2026-09-08 | https://labs.scale.com/leaderboard/sweatlas-refactoring | VERIFIED | Harness-labelled rows: Fable-5.1 (Claude Code) 56.67±6.52 → Gemini-3-Flash (mini-SWE-agent) 10.00±4.80 |
| 60 | Terminal-Bench 4.0 leaderboard (embedded row data parsed from page) | Stanford / Harbor / Laude Institute | rows updated 2026-09-03 | https://www.tbench.ai/leaderboard/terminal-bench/4.0 | VERIFIED | Full 18-row table with accuracy, cost, effort and date; top 58.18% Codex/GPT-6 Astra, 57.88% Claude Code/Fable 5.1 |
| 61 | terminal-bench repository | Laude Institute | fetched 2026-09-08 | https://github.com/laude-institute/terminal-bench | VERIFIED (partial) | Beta ~100 tasks, Terminal-Bench-Core v0.1.1, Harbor for 2.0, ICLR 2026 paper; **4.0 task count and dates NOT FOUND** |
| 62 | SWE-Bench Pro dataset card | Scale AI | fetched via search snippet | https://huggingface.co/datasets/ScaleAI/SWE-bench_Pro | UNVERIFIED | Public split exists on Hugging Face (relevant to the contamination question) |

## D. Research papers

| # | Title | Org / author | Date | URL | Status | What it evidences |
|---|---|---|---|---|---|---|
| 63 | Inside the Scaffold: A Source-Code Taxonomy of Coding Agent Architectures (arXiv:2604.03515) | Benjamin Rombaut | v1 2026-04-03, v2 2026-04-10 | https://arxiv.org/abs/2604.03515 and https://arxiv.org/html/2604.03515v2 | VERIFIED | 13 agents × 12 dimensions; 5 loop primitives; 11/13 compose multiple; convergence on read/search/edit/execute with tool counts 0–37; `str_replace_editor` in 5/13; 7 compaction strategies; 7 state-management patterns |
| 64 | SWE Atlas: Benchmarking Coding Agents Beyond Issue Resolution (arXiv:2605.08366v1) | Scale AI (Romero Calvo et al., 13 authors) | 2026-05-08 | https://arxiv.org/html/2605.08366v1 | VERIFIED | 284 tasks (124/90/70); GPT-5.4 43.49%, Opus 4.7 41.89%; "frontier coding models are quickly saturating simple issue resolution benchmarks"; monotonic improvement Opus 4.1→4.7 |
| 65 | ChainSWE: Benchmarking Coding Agents on Multi-Bug Software Maintenance (arXiv:2607.02606) | Georgia Tech with NVIDIA, UCL, NYU, Stanford, Cornell | v2 2026-09-01 | https://arxiv.org/html/2607.02606 | VERIFIED | 304 issues / 54 projects; up to −70%; per-position decay; 48% of downstream failures from accumulated agent state; under-edits 9:1 |
| 66 | SWE-Cycle: Benchmarking Code Agents across the Complete Issue Resolution Cycle (arXiv:2605.13139v1) | Shanghai Jiao Tong University, Meituan | 2026-05-13 | https://arxiv.org/html/2605.13139v1 | VERIFIED | 489 instances; Env 78.1% / Impl 40.1% / TestGen 67.3%; FullCycle 13.5%, none above 14% |
| 67 | SWE-EVO: Benchmarking Coding Agents in Long-Horizon Software Evolution Scenarios (arXiv:2512.18470v6) | FPT Software AI Center, U. Melbourne, VinUniversity | v6 2026-05-22 | https://arxiv.org/html/2512.18470v6 | VERIFIED | ~21 files / 874 tests per instance; best model 25%; gpt-5.2 72.80% → 22.92%; cites Meta Context Engineering at 89.1% vs 70.7% hand-engineered |
| 68 | Judging Is Not Enumerating: Silent Omissions in LLM-Authored Acceptable Sets (arXiv:2608.01000) | Chen, Chen, Lin, Long, Vong | 2026-08-02 | https://arxiv.org/abs/2608.01000 | VERIFIED | Judge F1 0.74–0.90 vs authored suites admitting 19–42% of correct solutions; judge−author gap +0.34 to +0.29; predicate specification F1 ≈ 0.99 |
| 69 | CODESKILL: Learning Self-Evolving Skills for Coding Agents (arXiv:2605.25430) | Nanyang Technological University, Zhejiang University | 2026-05-25 | https://arxiv.org/html/2605.25430 | VERIFIED | +9.69 over no-skill, +4.01 over strongest baseline; +8.24 held-out Terminal-Bench 2; +8.93 cross-policy; limitations: NL-only skills, single-skill updates |
| 70 | SkillOpt: Executive Strategy for Self-Evolving Agent Skills (arXiv:2605.23904v2) | Microsoft, SJTU, Tongji, Fudan | 2026-05 | https://arxiv.org/html/2605.23904 | VERIFIED | +23.5 avg over six **non-coding** benchmarks; +24.8 under Codex and +19.1 under Claude Code; Codex→Claude Code skill transfer +59.7; artefact is a 300–2,000-token `best_skill.md` |
| 71 | Agent Skill Evaluation and Evolution: Frameworks and Benchmarks (arXiv:2606.11435v1) | Rutgers University, UNC Charlotte | 2026-06-09 | https://arxiv.org/html/2606.11435v1 | VERIFIED | SkillsBench +16% average, **+4.5 pp software engineering** vs +51.9 healthcare; "no existing benchmark evaluates evolution longitudinally"; skill names/descriptions insufficient for routing |
| 72 | Live-SWE-agent: Can Software Engineering Agents Self-Evolve on the Fly? (arXiv:2511.13646) | Xia, Wang, Yang, Wei, Zhang | v1 2025-11-17, v3 2025-11-24 | https://arxiv.org/abs/2511.13646 and https://live-swe-agent.github.io/ | VERIFIED | Runtime tool synthesis from bash-only start; 79.2% Verified with Opus 4.5 ($0.86/instance), 77.4% with Gemini 3 Pro ($0.48), 45.8% SWE-Bench Pro |
| 73 | SWE-Chain: Benchmarking Coding Agents on Chained Release-Level Package Upgrades (arXiv:2605.14415v1) | not captured | 2026-05 | https://arxiv.org/html/2605.14415v1 | **UNVERIFIED** — title/URL from search result only | Existence of a chained-upgrade benchmark |
| 74 | SkillRL / EvoSkills / SkillOS / SkillAdaptor / SkillSmith / SkillOpt-Lite / A Survey of Self-Evolving Agents (arXiv:2602.08234, 2604.01687, 2605.06614, 2606.01311, 2606.01314, 2607.03451, 2507.21046) | various | 2025–2026 | arxiv.org (per id) | **UNVERIFIED** — titles/URLs from search results; abstracts not fetched | Breadth of the self-evolving-skills literature in 2026 |

## E. Evidence carried in from the mission brief (re-used, not re-verified this pass)

| # | Item | Status in this lane |
|---|---|---|
| 75 | Vericoding benchmark (arXiv:2509.22908) — Dafny 82%, Verus 44%, Lean 27%; NL descriptions did not help | Cited as given; **not re-fetched this pass** |
| 76 | Richter & Papadakis, "Underspecification does not imply Incoherence" (arXiv:2607.01953) — semantic collapse, 3–32% of tasks, invisible to disagreement-based detectors | Cited as given; **not re-fetched this pass** |
| 77 | Productivity-Reliability Paradox (arXiv:2605.01160) — +98% PRs, +91% review time, flat delivery; METR RCT 19% slowdown | Cited as given; **not re-fetched this pass** |
| 78 | "Too Consistent to Detect" (arXiv:2505.17656) — self-consistent errors do not diminish with scale | Cited as given; **not re-fetched this pass** |

## F. Secondary sources seen only as search snippets (used for orientation, never as evidence)

All **UNVERIFIED**. Listed for audit trail; none is load-bearing in the lane report except where the report
explicitly flags it as a snippet.

- tessl.io — "OpenAI moves beyond SWE-bench Verified as coding benchmarks saturate" (post dated 2026-02-25). Fetched; its account is consistent with source #56 but it did not carry the 59.4% figure. Superseded by the OpenAI primary source.
- latent.space — "The End of SWE-Bench Verified — Mia Glaese & Olivia Watkins" — snippet only; quoted in the report as the counterevidence that original SWE-bench authors put the saturation ceiling at 87–95%.
- blog.pebblous.ai, adwaitx.com, aiwiki.ai, codeant.ai, benchlm.ai, localaimaster.com, morphllm.com, llm-stats.com, digitalapplied.com, layer3labs.io, swfte.com, ayautomate.com, codingfleet.com, supergok.com, medium.com/@allahverdiyev.tural — aggregator/SEO posts claiming SWE-bench figures between 80% and 96%. Used only to establish that inflated third-party numbers circulate; digitalapplied's own snippet ("99 of the 100 leaderboard entries are self-reported") is quoted as such.
- siliconangle.com, thenewstack.io, venturebeat.com, zdnet.com, the-decoder.com, unite.ai, aibusiness.com, techradar.com, agentman.ai — coverage converging on Agent Skills launching October 2025 and being published as an open standard on 2025-12-18. The date is corroborated by the Anthropic engineering page's own update line quoted in a snippet ("We've published Agent Skills as an open standard for cross-platform portability. (December 18, 2025)") — **the Anthropic page itself was not fetched; `anthropic.com/news/agent-skills` returned 404.**
- forum.cursor.com (2026-01-22 / 2026-01-23), korchasa.dev, aimakers.co, cursorworkshop.com, learncursor.dev, releasebot.io, releases.sh, developertoolkit.ai — Cursor 2.4/2.5/3.0 dates. Corroborated by the primary Cursor changelog pages (#20, #21, #22).
- thebcms.com, productbuilder.net, fundesk.io, glukhov.org, dev.to (multiple), buildthisnow.com, devtoollab.com, augmentcode.com — spec-driven-development landscape; used only to locate the Kiro / Spec Kit primary sources.
- reddit.com threads on SWE-bench contamination — noted, not used.

---

## Tally

- **Sources listed:** 78 numbered entries (some entries cover a cluster of related arXiv ids).
- **VERIFIED by direct fetch this pass:** 61.
- **UNVERIFIED or fetch-failed:** 17 — items #44 (Kiro property-testing docs, 404), #62, #73, #74 (7 arXiv
  ids), #75–#78 (4 brief-carried papers), plus the entire §F snippet set counted as one aggregate,
  the Anthropic Agent Skills announcement page (404), and Terminal-Bench 4.0's task count / release date
  (NOT FOUND on the page).
- **Search queries attempted:** 32 (10 returned usable results; the rest hit exhausted budgets, CAPTCHAs,
  403s or 429s). Engines tried: WebSearch (budget exhausted), Bing, DuckDuckGo HTML, DuckDuckGo Lite,
  Mojeek, Ecosia, Startpage, Brave, plus the arXiv API via both the `arxiv-search` skill and direct curl.
- **Repository licences that could not be confirmed** because the GitHub REST API rate-limited this IP
  after one call: `openai/codex`, `sst/opencode`, `cline/cline`, `OpenHands/OpenHands`,
  `SWE-agent/mini-swe-agent`, `github/spec-kit`. Confirmed: `Aider-AI/aider` (Apache-2.0),
  `SWE-agent/SWE-agent` (MIT).
