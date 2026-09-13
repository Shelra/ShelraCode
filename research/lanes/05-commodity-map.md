# Lane 05 — What is already commodity

**Question:** What should a new company absolutely NOT build as its primary differentiation,
because it is already commodity or will be within two years?

**Cutoff:** 8 September 2026. Every product statement below comes from a fetch on that date.

**Method note:** the WebSearch budget for this session was exhausted before this lane started; discovery
ran through Brave/Bing HTML endpoints via WebFetch (10 successful queries out of ~32 attempts; DuckDuckGo,
Mojeek, Ecosia, Startpage and eventually Brave all served CAPTCHAs or 429s) and through direct
primary-source fetches with `curl` and WebFetch. The arXiv API returned 429 for every attempt, so paper
discovery leaned on Brave results plus direct `arxiv.org/html/<id>` reads. Where a fact could not be
confirmed from a primary source it is written **NOT FOUND** or **UNVERIFIED**, never guessed.

---

## 1. Summary (10 lines)

1. The agent scaffold is not a moat any more: SWE-bench's own leaderboard now defaults to a "Bash Only"
   view that runs every model inside mini-SWE-agent — a ~100-line bash-only harness — explicitly "so
   scores compare models rather than harnesses".
2. Terminal-Bench 4.0 (330 trials, rows updated 3 Sep 2026) puts two entirely different harnesses, Codex
   and Claude Code, 0.30 points apart at the top (58.18% vs 57.88%). Rank is set by model and effort.
3. Under that identical bash-only control, the best open-weight model was ~1.0 point behind the best
   proprietary one and cost an order of magnitude less ($36.6 vs $377 for the full 500-instance run).
4. OpenAI formally retired SWE-bench Verified on 23 February 2026 (contamination, plus 59.4% of audited
   failures having broken tests) and recommended SWE-bench Pro. The official leaderboard's most recent
   submission of any kind is 26 February 2026.
5. Skills, hooks, subagents, MCP, plugins, sandboxing, checkpoints, background/cloud agents, procedural
   memory, worktree isolation, goal mode and multi-agent orchestration are all shipped by at least three
   independent systems, several of them open source and free.
6. Agent Skills is a genuine cross-vendor standard (agentskills.io, opened 18 Dec 2025) with roughly 50
   listed implementers; Copilot, OpenCode, Cursor and OpenHands all read `.claude/skills` or `.agents/skills`.
7. Codex ships `/import`, which pulls instructions, settings, skills, plugins, projects and up to 50
   recent chats out of Claude Code or Cursor. Switching cost has been engineered toward zero.
8. Absorption lag from a startup-shaped feature to an incumbent shipping it is now **19 days to 8 months**,
   and the two most recent examples took 26 and 19 days.
9. Self-evolving harnesses (CODESKILL, SkillOpt, Live-SWE-agent) are real research with real numbers, but
   the coding-specific gain is the smallest of any domain measured (+4.5 pp software engineering versus
   +51.9 pp healthcare in SkillsBench), and the artefact they emit is a portable `SKILL.md`.
10. What is still broken is the *loop*, not the patch: 13.5% on end-to-end SWE-Cycle, 25% on SWE-EVO, up
    to −70% degradation across dependent bug chains, 48% of chain failures caused by the agent's own
    accumulated state. That is where the remaining differentiation lives.

---

## 2. Frontier table (verified 2026-09-08)

| System | Vendor | Version / date verified | Notable capabilities documented | Open source? |
|---|---|---|---|---|
| Claude Code | Anthropic | v2.1.263, npm publish 2026-09-06 | Skills, subagents (nested ≤5, background by default), agent teams, dynamic workflows (≤1000 agents/run), hooks, plugins + marketplaces, MCP, sandboxed Bash, auto memory, checkpointing/`/rewind`, `/goal`, routines, artifacts, Chrome + computer use, remote control, self-hosted environments, ultrareview, `/code-review`, `/skill-doctor` | No (binary CLI; changelog + docs public) |
| Codex (ChatGPT) | OpenAI | CLI 0.153.4, npm publish 2026-09-04 | AGENTS.md, rules, skills (Agent Skills std), subagents, hooks (12 events), plugins + marketplaces, MCP, sandboxing + auto-review, memories, worktrees, cloud env, `/goal` + `/plan`, computer use, browser, Codex Security, SDK, GitHub Action, `/import` from Claude Code & Cursor | Repo `openai/codex` public; licence UNVERIFIED |
| Cursor | Anysphere | 2.4 (2026-01-22), 2.5 (2026-02-17), 3.0 (2026-04-02); latest changelog entry 2026-09-02 | Skills, subagents (own VMs / worktrees), hooks (agent + tab + workspace events), plugins + marketplace, MCP, rules, memories, sandboxed run modes, Instant Grep, Explore subagent, cloud agents, `/goal`, `/best-of-n`, Design mode, Bugbot, Origin code hosting, self-hosted machines | No |
| OpenCode | Anomaly (sst/opencode) | v1.18.29, npm publish 2026-09-04; docs updated 2026-09-08 | Primary agents (Build/Plan) + subagents (General/Explore/Scout), skills incl. `.claude/skills` and `.agents/skills`, plugins, MCP, LSP config, per-agent model/permissions/steps, share links | Yes (licence UNVERIFIED) |
| OpenHands | OpenHands | docs live 2026-09-08 | Agent Canvas, Software Agent SDK, Agent Server (REST/WS), Sandbox Server, cloud, CLI, skills (Agent Skills std + keyword/path triggers), legacy microagents, CLAUDE.md/GEMINI.md recognition, "one to thousands of agents" | Yes; per-repo licences ("Check the repository you use") |
| Cline | Cline | docs live 2026-09-08 | Plan & Act, checkpoints, rules, skills, plugins, hooks, MCP, subagents, memory bank, agent teams, scheduled agents, Kanban, TUI/CLI/IDE/JetBrains/ACP, SDK + ClineCore, OpenTelemetry | Yes (licence UNVERIFIED) |
| Aider | Aider-AI | last release v0.86.0 (2025-08-09); repo last push 2026-05-22; Apache-2.0; 48,832 stars | Repo map, diff/udiff edit formats, `/model`, git integration. No skills/hooks/subagents/MCP in current release notes | Yes (Apache-2.0) |
| SWE-agent | SWE-agent org | repo last push 2026-09-07; MIT; 20,285 stars | ACI, rule-based truncation, configurable tool bundles | Yes (MIT) |
| mini-SWE-agent | SWE-agent org | README fetched 2026-09-08 | ~100 lines of Python, bash-only, `subprocess.run` per action, linear history, ">74% on SWE-bench verified" | Yes |
| Kiro | AWS ("Built and operated by AWS") | docs updated 2026-09-02 / 2026-08-27 | Spec-driven dev (requirements.md, design.md, tasks.md), dependency-graph task waves, steering, hooks, MCP, skills, custom agents + sub-agents, permissions, one engine across IDE/CLI/Web/Mobile, credit pricing, Kiro Crew (open source) | No (Kiro Crew is) |
| Antigravity | Google | app 2.12.2, CLI 1.1.25, SDK 0.1.16, IDE ext 2.5.5 (fetched 2026-09-08) | Agent manager, Projects as access boundaries, Local vs New Worktree mode, artifacts (task lists, walkthroughs, screenshots, browser recordings), Chrome control via slash commands | No |
| Devin | Cognition | blog: SWE-1.7 (2026-07-08), Devin Fusion (2026-07-13), FedRAMP High in process (2026-07-13) | Shell + IDE + browser, CLI, Slack/Teams, API, Devin Fusion hybrid routing with sidekick agents, Devin Security Swarm, own SWE-1.7 model | No |
| Gemini CLI | Google | v0.58.0, npm publish 2026-09-01; skills page updated 2026-04-30 | Skills (Agent Skills std, 4-tier discovery incl. `~/.agents/skills`), extensions, MCP, GEMINI.md | Yes |
| Amp | Sourcegraph | manual fetched 2026-09-08 | Multi-model routing (GPT-5.6, Claude Fable 5.1, fast models), Orbs (per-thread cloud machines), threads, skills, plugins, MCP, agent-to-agent | No |
| ~35 others incl. Junie, GitHub Copilot, VS Code, Goose, Roo Code, Factory, Tabnine, Trae, Letta, Firebender, Mux, Ona, Workshop, Qodo, Snowflake Cortex Code, Databricks Genie Code, Pulumi Neo, Mistral Vibe, pi, VT Code, Emdash, Superconductor, nanobot, Hermes Agent, OpenClaw, ZeroClaw, Piebald, Command Code, Deep Code, Autohand, Agentman, fast-agent, bub, Vita, Spring AI, Laravel Boost | various | agentskills.io client showcase, fetched 2026-09-08 | All implement the Agent Skills `SKILL.md` format | mixed |

The reference taxonomy for this space is *Inside the Scaffold: A Source-Code Taxonomy of Coding Agent
Architectures* (Benjamin Rombaut, arXiv:2604.03515, v1 3 Apr 2026 / v2 10 Apr 2026): 13 open-source agents
across 12 dimensions in three layers. Verified and extended above.

---

## 3. Commodity map

Classification key: **COMMODITY** = shipped by ≥3 independent systems, at least one free/open, standardised
or trivially copied. **BECOMING COMMODITY** = ≥2 shipping, third in progress, ≤12 months to parity.
**DIFFERENTIABLE** = a real gap remains between best and rest. **RESEARCH-STAGE** = papers, no product parity.

| Capability | Class | Since | Systems shipping it | Evidence |
|---|---|---|---|---|
| LLM chat + code generation | COMMODITY | 2023 | all 14 in the frontier table | universal |
| Terminal execution / bash tool | COMMODITY | 2024 | all; mini-SWE-agent has *only* bash | "Does not have any tools other than bash" — mini-SWE-agent README |
| File read/search/edit tool set | COMMODITY | 2024 | all | Inside the Scaffold: all agents converge on read/search/edit/execute despite tool counts 0–37; `str_replace_editor` independently in 5 of 13 |
| Plan mode / plan-then-act | COMMODITY | 2025 | Claude Code plan mode, Cursor plan mode, OpenCode Plan agent, Cline Plan & Act, Codex `/plan`, Kiro specs | six independent docs pages |
| Repo search (grep-first) | COMMODITY | 2026 | Cursor Instant Grep, Claude Code Grep/Glob, mini-SWE-agent bash grep | Cursor search docs; Claude Code tools reference |
| Embedding / semantic repo index | **DECLINING — do not build** | peaked 2024 | Cursor no longer documents it; Claude Code never had it | `cursor.com/docs/context/codebase-indexing.md` returns 404; surviving page documents Instant Grep + Explore subagent only |
| Read-only exploration subagent | COMMODITY | Oct 2025 | Claude Code Explore (v2.0.17, 2025-10-15), Cursor Explore subagent, OpenCode Explore/Scout | three docs pages, near-identical design |
| Language-server / code intelligence | BECOMING COMMODITY | 2026 | Claude Code code-intelligence plugins (TS/Py/Go/Rust), OpenCode LSP config, Junie (IntelliJ platform) | Claude Code large-codebases doc; OpenCode docs |
| Context compaction | BECOMING COMMODITY (quality still varies) | 2025 | Claude Code (`/rewind`, "Summarize up to here", plan re-injection after compaction), Codex `PreCompact`/`PostCompact` hooks + remote compaction, Cursor pre-compaction hooks, plus Aider/OpenHands/Gemini CLI/Codex CLI/OpenCode LLM summarisation | Inside the Scaffold catalogues 7 distinct strategies across 13 agents — one of only two places designs still diverge |
| Skills (`SKILL.md`) | COMMODITY — standardised | Oct 2025 → open standard 2025-12-18 | ~50 products on agentskills.io incl. Claude Code, Codex, Cursor, Copilot, VS Code, Gemini CLI, OpenCode, OpenHands, Kiro, Goose, Roo, Factory, Amp, Tabnine, Junie | agentskills.io client showcase; Copilot reads `.github/skills`, `.claude/skills`, `.agents/skills`; OpenCode reads six paths incl. Claude's |
| Hooks | COMMODITY | Jun 2025 (Claude Code v1.0.38, 2025-06-30) | Claude Code, Codex (PreToolUse/PostToolUse/PreCompact/PostCompact/UserPromptSubmit/SubagentStart/SubagentStop/Stop/SessionStart/SessionEnd/PermissionRequest/Interrupt), Cursor (agent + tab + workspace events), Cline, Kiro | event names near-identical across vendors; Cursor CLI reads Claude Code `settings.json` hooks |
| Subagents / delegation | COMMODITY | Jul 2025 (Claude Code v1.0.60, 2025-07-24) | Claude Code, Codex, Cursor (own VMs), OpenCode, Cline, Kiro, OpenHands | six docs pages |
| Multi-agent orchestration at scale | BECOMING COMMODITY | May 2026 | Claude Code dynamic workflows (≤4096 items/call, 1000 agents/run, 16 concurrent), Cline agent teams + multi-agent SDK, OpenHands "one to thousands of agents", Cursor Agents Window | Claude Code workflows doc; OpenHands positioning |
| MCP | COMMODITY — standardised | Nov 2024; spec path dated 2026-07-28 | every system in the table | modelcontextprotocol.io: "supported across a wide range of clients and servers" naming Claude, ChatGPT, VS Code, Cursor |
| Plugins / marketplaces | COMMODITY | 2026 | Claude Code (zip/URL/marketplaces, dependency constraints), Codex plugin CLI + catalogs (0.153.0, 2026-09-03), Cursor plugins (2.5, 2026-02-17) + marketplace (2026-02-05), Cline plugins, OpenCode plugins | four changelogs |
| Sandboxing / permission classifiers | COMMODITY | Mar–Jun 2026 | Claude Code auto mode (preview 2026-03-24, default Aug 2026), Codex sandbox + auto-review, Cursor three run modes + network allowlists, Cline YOLO/auto-approve | Claude Code what's-new weeks 13/23/32; Codex sandboxing docs; Cursor CLI changelog Jan 2026 |
| Checkpoints / rewind / worktrees | COMMODITY | 2026 | Claude Code checkpointing + `/rewind` + worktrees + sparse checkout, Cursor `/worktree` + `/rewind`, Cline checkpoints, Antigravity New Worktree mode, Codex worktrees | five docs pages |
| Background / long-running / cloud agents | COMMODITY | 2025–2026 | Claude Code background sessions + routines + web + teleport, Codex cloud + long-running work, Cursor cloud agents + always-on subscriptions, Devin, OpenHands Cloud, Amp Orbs | six docs/changelogs |
| Goal mode (persist until condition holds) | COMMODITY | May–Aug 2026 | Claude Code `/goal` (week 20, 2026-05-11/15), Codex `/goal`, Cursor `/goal` (2026-08-19) | three primary sources within 14 weeks |
| Procedural / auto memory | COMMODITY | 2026 | Claude Code auto memory (on by default, 4 note types, per repo, subagents get their own), Codex memories in `~/.codex/memories/`, Cursor memories, Cline memory bank | four docs pages |
| Model routing / multi-model / fallback | COMMODITY | 2026 | Cursor Router + 11 documented models, Claude Code `fallbackModel` (≤3) + `modelPicker` + Bedrock/Vertex/Foundry, Codex Bedrock routing, Devin Fusion, Amp, Cline model orchestration | five sources |
| Scheduling / cron | COMMODITY | 2026 | Claude Code routines + desktop scheduled tasks + `/loop`, Codex scheduled tasks, Cline scheduled agents, Cursor Automations | four sources |
| Code review as a product | COMMODITY | 2026 | Claude Code `/code-review` + `/ultrareview` + GitHub Code Review, Codex code review + auto-review, Cursor Bugbot + agent review, Qodo, Devin | five sources |
| Security scanning by agent | BECOMING COMMODITY | Jul 2026 | Claude Security plugin (week 30, 2026-07-20), Codex Security plugin/CLI/SDK, Devin Security Swarm, Cursor | four sources within ~2 months |
| Browser / computer use | COMMODITY | 2026 | Claude Code Chrome GA (week 27) + computer use CLI (week 14) + Desktop in-app browser (week 28), Codex browser + computer use, Cursor in-editor browser + Design mode, Antigravity Chrome control, Devin browser, OpenHands | six sources |
| Spec-driven development workflow | COMMODITY | 2025→2026 | Kiro (requirements/design/tasks + dependency waves), GitHub Spec Kit v1.0 "30+ AI coding agents", Codex `/plan`, Cursor clarification questions, Claude Code plan file + ultraplan | five sources |
| Clarifying questions to the user | BECOMING COMMODITY | Oct 2025 → Jan 2026 | Claude Code interactive question tool + "ask you questions more often in plan mode" (v2.0.21, 2025-10-16), Cursor "Clarification Questions" (2.4, 2026-01-22), Codex `/plan` ("Ask ChatGPT to interview you") | three primary sources in 3 months |
| Config portability / migration | COMMODITY (adversarially so) | 2026 | Codex `/import` from Claude Code and Cursor; Cursor loads `.claude/skills` and Claude Code `settings.json` hooks; Copilot reads `.claude/skills`; OpenCode reads `.claude/skills` | four primary sources |
| Observability of the agent (OTel) | BECOMING COMMODITY | 2026 | Claude Code OTel + `skill_activated` events + `/usage` + `/cost` cache diagnostics, Cline OpenTelemetry integration + events reference, Codex analytics/compliance API | three sources |
| Self-evolving skills / trajectory learning | RESEARCH-STAGE (artefact is commodity) | 2026 | CODESKILL, SkillOpt, SkillRL, EvoSkills, SkillOS, SkillAdaptor, SkillSmith, Live-SWE-agent | §5 |
| Agent-authored tools at runtime | RESEARCH-STAGE | Nov 2025 | Live-SWE-agent (generates its own executable scripts mid-task) | arXiv:2511.13646 |
| Formal verification of generated code | RESEARCH-STAGE | 2025–2026 | Vericoding (Dafny 82% / Verus 44% / Lean 27%); Kiro markets "property-based testing" — docs page NOT FOUND, **UNVERIFIED** | mission brief + kiro.dev homepage |
| Cross-session / accumulated-state management | **DIFFERENTIABLE — open** | — | nobody | §4, ChainSWE |
| Reality-feedback (did the deployed change still match intent) | **DIFFERENTIABLE — open** | — | nobody in this lane's scope | §8 |

---

## 4. Benchmark saturation and what still fails

```
CLAIM: OpenAI formally retired SWE-bench Verified as a frontier measure on 23 February 2026, citing both
       broken tests and training contamination.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: OpenAI's post is dated "February 23, 2026" and subtitled "SWE-bench Verified is increasingly
  contaminated. We recommend SWE-bench Pro." Verbatim: "state-of-the-art progress on SWE-bench Verified
  has slowed, improving from 74.9% to 80.9% in the last 6 months"; "We audited a 27.6% subset of the
  dataset that models often failed to solve and found that at least 59.4% of the audited problems have
  flawed test cases that reject functionally correct submissions"; of the 138 audited problems, "35.5%
  ... have strict test cases that enforce specific implementation details", "18.8% ... have tests that
  check for additional functionality that wasn't specified in the problem description", remaining 5.1%
  miscellaneous; "all frontier models we tested were able to reproduce the original, human-written bug
  fix ... or verbatim problem statement specifics for certain tasks"; "This is why we have stopped
  reporting SWE-bench Verified scores, and we recommend that other model developers do so too ... OpenAI
  recommends reporting results for SWE-bench Pro."
SOURCE: Why SWE-bench Verified no longer measures frontier coding capabilities — OpenAI — 2026-02-23 —
  https://openai.com/index/why-we-no-longer-evaluate-swe-bench-verified/ — accessed 2026-09-08
COUNTEREVIDENCE: Latent Space reported that "the authors of the original SWE-Bench still assert that the
  ceiling for a saturation call should be closer to 87-95%" (search snippet only; article not fetched,
  UNVERIFIED). So "saturated" is contested; "contaminated" is not.
OPEN QUESTION: Does SWE-bench Pro survive the same contamination audit, given it is now the recommended
  replacement and its public split sits on Hugging Face?
```

```
CLAIM: The official SWE-bench Verified leaderboard has effectively stopped receiving frontier
       submissions; its best verified entry is 79.2% and its newest entry of any kind is 26 Feb 2026.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: Parsed the embedded `leaderboard-data` JSON on swebench.com (180 Verified entries). Top:
  Sonar Foundation Agent + Claude 4.5 Opus 79.2 (2025-12-05); live-SWE-agent + Claude 4.5 Opus 79.2
  (2025-12-15); TRAE + Doubao-Seed-Code 78.8 (2025-09-28); live-SWE-agent + Gemini 3 Pro 77.4, marked
  checked:"false"; mini-SWE-agent + Claude 4.5 Opus (high) 76.8 (2026-02-17). Most recent submission:
  mini-SWE-agent + Gemini 3 Pro, 69.6, 2026-02-26. Six months of silence.
SOURCE: SWE-bench Leaderboards — SWE-bench team — page fetched 2026-09-08 — https://www.swebench.com/ —
  accessed 2026-09-08
COUNTEREVIDENCE: Aggregator sites claim 93.9–96% (codeant.ai, benchlm.ai, digitalapplied); one of them
  concedes "99 of the 100 leaderboard entries are self-reported". None of those figures appears on the
  official board. Treat any 90%+ SWE-bench Verified claim as a vendor self-report on an abandoned metric.
OPEN QUESTION: Is the silence a deliberate community retirement or a maintenance lapse?
```

```
CLAIM: The benchmark authority has institutionalised the view that the scaffold is a confound to be
       controlled for, not a contribution to be measured.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: swebench.com ships a "Bash Only" toggle whose tooltip reads verbatim: "Show only runs in the
  mini-SWE-agent environment, so scores compare models rather than harnesses". Its benchmark card reads:
  "Bash Only — 500 instances — The default Verified view: every model in the same mini-SWE-agent
  environment." 49 of 180 Verified entries are mini-SWE-agent runs. Scale AI's commercial SWE-bench Pro
  public leaderboard also runs mini-swe-agent for most entries, and its SWE Atlas board notes "Update
  July 28, 2026 We have increased mini-swe-agent step count from 250 to 500 for newer models".
SOURCE: SWE-bench Leaderboards — https://www.swebench.com/ ; SWE-Bench Pro Public — Scale AI —
  https://labs.scale.com/leaderboard/swe_bench_pro_public ; SWE Atlas Codebase QnA — Scale AI —
  https://labs.scale.com/leaderboard/sweatlas-qna — all accessed 2026-09-08
COUNTEREVIDENCE: Scale's SWE Atlas Refactoring board still shows harness-labelled rows where Claude Code
  entries top mini-SWE-agent entries (Fable-5.1/Claude Code 56.67±6.52 vs GLM 5.2/mini-SWE-agent
  42.38±6.76) — but the model differs too, so it is not a clean harness ablation.
OPEN QUESTION: What is the measured harness delta for one fixed model? Nobody publishes it (see §8).
```

```
CLAIM: On the hardest current agentic benchmark, two completely different harnesses are statistically
       indistinguishable; ranking is driven by model and reasoning effort.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: Terminal-Bench 4.0 leaderboard (embedded JSON, 330 trials per row, rows updated 2026-09-03):
  1) Codex + GPT-6 Astra (max) 58.18%, $3,267; 2) Claude Code + Fable 5.1 (max) 57.88%, $6,244;
  2) Codex + GPT-6 Astra (xhigh) 57.88%, $2,351; 5) Codex + GPT-6 Astra (medium) 54.24%, $1,915;
  6) Claude Code + Opus 5 (max) 51.82%, $5,969; 7) Codex + GPT-6 Astra (low) 50.61%, $1,557;
  8) Claude Code + Fable 5 (max) 44.55%; 9) Claude Code + GLM-5.3 (max) 41.82%, $2,728;
  13) Grok Build + Grok 4.6 20.30%; 14) mini-SWE-agent + Gemini 3.8 Flash 19.09%;
  16) Claude Code + Sonnet 5 (max) 12.42% at $9,604. Gap between the top two harnesses: 0.30 pp.
  Gap between effort levels inside one harness: 7.57 pp.
SOURCE: Terminal-Bench 4.0 leaderboard — Stanford / Harbor / Laude Institute — rows dated 2026-09-03 —
  https://www.tbench.ai/leaderboard/terminal-bench/4.0 — accessed 2026-09-08
COUNTEREVIDENCE: The same harness with a weak model collapses (Claude Code + Sonnet 5 at 12.42%), so the
  harness is clearly not sufficient — but that cuts the same way: the harness is not what varies.
OPEN QUESTION: Terminal-Bench 4.0's task count and release date are NOT FOUND on the page; the GitHub
  README still describes a ~100-task beta and redirects to Harbor for 2.0.
```

```
CLAIM: Under an identical bash-only harness, the best open-weight model was ~1 point behind the best
       proprietary model at roughly one-tenth the cost.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: SWE-bench Verified, mini-SWE-agent 2.0.0, all submitted 2026-02-17, single attempt, full
  500-instance cost: Claude 4.5 Opus (high) 76.8% / $377.0; Gemini 3 Flash (high) 75.8% / $178.0;
  MiniMax M2.5 (high, open-weights flag true) 75.8% / $36.6; Claude 4.6 Opus 75.6% / $275.8; GLM 5 (open)
  72.8% / $267.2; GPT 5.2 (high) 72.8% / $236.8; Kimi K2.5 (open) 70.8% / $73.3; DeepSeek V3.2 (open)
  70.0% / $223.9; Claude 4.5 Haiku 66.6% / $165.5.
SOURCE: SWE-bench Leaderboards embedded data — https://www.swebench.com/ — accessed 2026-09-08
COUNTEREVIDENCE: The snapshot is ~7 months old and predates GPT-6 Astra and Fable 5.1. On Terminal-Bench
  4.0 the newest open-weight entry (Claude Code + GLM-5.3, 41.82%) is 16.4 points behind the top, so the
  1-point gap may be a February artefact rather than a durable state.
OPEN QUESTION: Is the open-weight gap re-opening specifically on long-horizon tasks?
```

```
CLAIM: End-to-end autonomy — reconstruct the environment, implement, and author the verifying tests —
       is where agents actually fail, and the failure is catastrophic rather than marginal.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: SWE-Cycle (489 filtered instances) isolates three sub-tasks plus a FullCycle task. With gold
  inputs: environment reconstruction 78.1% (Claude-Sonnet-4.6 best), verification test generation 67.3%,
  code implementation 40.1% ("the primary bottleneck"). Fully autonomous FullCycle from a bare
  repository: 13.5% (GLM-5.1 best); "no model exceeded 14% strict solve rate". SWE-EVO (release-transition
  tasks, ~21 files and averaging 874 tests per instance): "the best model reaches only 25% on SWE-EVO,
  while gpt-5.2 drops from 72.80% on SWE-Bench Verified to 22.92% on SWE-EVO". SWE Atlas (284 tasks:
  Codebase Q&A 124, Test Writing 90, Refactoring 70): overall Pass@1 GPT-5.4 43.49%, Opus 4.7 41.89%;
  Codebase Q&A 40.80% / 40.30%.
SOURCE: SWE-Cycle — Shanghai Jiao Tong University & Meituan — 2026-05-13 — arXiv:2605.13139v1 ;
  SWE-EVO — FPT Software AI Center / U. Melbourne / VinUniversity — 2026-05-22 — arXiv:2512.18470v6 ;
  SWE Atlas — Scale AI — 2026-05-08 — arXiv:2605.08366v1 — all accessed 2026-09-08
COUNTEREVIDENCE: SWE Atlas reports all three workflows "improve monotonically" across Claude Opus 4.1→4.7
  over an 8-month window, so these are moving targets, not walls.
OPEN QUESTION: How much of the FullCycle collapse is environment flakiness rather than model capability?
```

```
CLAIM: The dominant failure mode of long-lived coding agents is the state they themselves leave behind,
       not the difficulty of the next bug.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: ChainSWE (304 chronologically ordered issues across 54 Python projects, mined from six
  SWE-bench-family datasets) reports "a consistent performance drop by up to 70% as the chain length
  increases". Per-bug accuracy Oracle→Seq: GPT-5.5 69.1%→49.0% (−29%), Claude-Opus-4.7 64.5%→40.5%
  (−37%), DeepSeek-V4-Pro 42.8%→29.6% (−31%). By chain position (length-3, baseline aggregate):
  position 1 58.6%→57.1%, position 2 64.3%→39.3% (−39% relative), position 3 67.0%→27.7% (−59% relative).
  Chain-level success: mean 20% Oracle, 17% Seq. Decisively: "48% of downstream failures at positions 2–3
  stem from accumulated agent-generated state rather than intrinsic bug difficulty; under-edits outnumber
  over-edits nine-to-one."
SOURCE: ChainSWE: Benchmarking Coding Agents on Multi-Bug Software Maintenance — Georgia Institute of
  Technology with NVIDIA, UCL, NYU, Stanford, Cornell — 2026-09-01 (v2) — arXiv:2607.02606 —
  https://arxiv.org/html/2607.02606 — accessed 2026-09-08
COUNTEREVIDENCE: The scaffold is held fixed (SWE-Edit) and only three context-management configurations
  were tried (full transcript; summarise at 50K input tokens; viewer/editor sub-agents), so a
  better-engineered harness might recover part of the drop — which would make this differentiable rather
  than a wall. That is the strongest remaining argument for harness investment found in this lane.
OPEN QUESTION: Does any shipping product's compaction strategy actually reduce chain-position decay?
```

```
CLAIM: LLMs are far better at judging a candidate solution than at enumerating the acceptable set, and
       better still at writing the predicate — an argument for specification artefacts over generated
       test suites.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: On executable-code benchmarks, models judging solutions reach F1 0.74–0.90, but the suites they
  author "admit only 19-42% of oracle-correct solutions". On incompleteness-proof algorithmic
  construction the judge-minus-author F1 gap is +0.34 to +0.29. When asked to emit a predicate
  specification instead of enumerating instances, "the same models reached F1 about 0.99".
SOURCE: Judging Is Not Enumerating: Silent Omissions in LLM-Authored Acceptable Sets — Chen, Chen, Lin,
  Long, Vong — 2026-08-02 — arXiv:2608.01000 — https://arxiv.org/abs/2608.01000 — accessed 2026-09-08
COUNTEREVIDENCE: none found after searching for rebuttals; the arXiv API was unavailable this pass for a
  systematic citation sweep, so absence of rebuttal is weak evidence.
OPEN QUESTION: Does the predicate advantage survive when the predicate must be machine-executable
  (Dafny/Verus/Lean), where Vericoding reports 82% / 44% / 27%?
```

### Newer benchmarks — verification status

| Benchmark | Status | Verified detail |
|---|---|---|
| SWE-bench Verified | **Retired by OpenAI 2026-02-23**; leaderboard stale since 2026-02-26 | OpenAI post + leaderboard JSON |
| SWE-bench Pro (Scale AI) | Live; recommended by OpenAI; public split on Hugging Face; mini-swe-agent harness | Muse Spark 1.1 61.50±3.10; GPT-5.4 (xHigh) 59.10±3.56; Muse Spark 55.00±3.60; claude-opus-4-6 (thinking) 51.90±3.61; gemini-3.1-pro (thinking) 46.10±3.60; most rows 250-turn cap, uncapped cost |
| SWE Atlas (Scale AI) | Live; arXiv:2605.08366, 2026-05-08 | 284 tasks; GPT-5.4 43.49% / Opus 4.7 41.89% overall; refactoring board tops at Fable-5.1 (Claude Code) 56.67±6.52 |
| SWE-Cycle | arXiv:2605.13139v1, 2026-05-13, SJTU + Meituan | 489 instances; FullCycle 13.5%, none above 14% |
| ChainSWE | arXiv:2607.02606 v2, 2026-09-01, Georgia Tech et al. | 304 issues / 54 projects; up to −70% over chain length |
| SWE-EVO | arXiv:2512.18470v6, 2026-05-22 | best model 25%; gpt-5.2 72.80% → 22.92% |
| SWE-Chain | arXiv:2605.14415v1, chained release-level package upgrades | title/URL verified via search snippet only; **paper not fetched, UNVERIFIED** |
| Terminal-Bench 4.0 | Live; hosted by Stanford / Harbor / Laude Institute | top 58.18%; task count and release date NOT FOUND |
| SWE-bench Multimodal | Live but stale (best 35.98%, 2025-07 / 2025-11) | leaderboard JSON |
| SWE-bench Multilingual | Live; mini-SWE-agent sweep 2026-02-13, best 72.7% (Gemini 3 Flash) | leaderboard JSON |
| SWE-Atlas / SWE-Cycle / ChainSWE / SWE-EVO combined | none has a vendor-adopted reporting norm | no frontier launch in 2026 was found reporting any of them as its headline |

---

## 5. Self-evolving harnesses, skill optimisation and tool synthesis

The research is real and the numbers are large. The moat is not.

```
CLAIM: Learned skill libraries and skill-optimisation loops produce large measured gains — but their
       smallest gains are in software engineering, and the artefact they emit is a portable file any
       competitor can load.
LABEL: OBSERVED TODAY
CONFIDENCE: medium
EVIDENCE: A 2026 survey reports SkillsBench results where "curated skills raise average pass rates by
  16%, with domain-specific gains ranging from +4.5 percentage points in software engineering to +51.9 in
  healthcare". CODESKILL (an RL-trained skill-management policy: extract, evolve, add/merge/drop, GRPO
  with hybrid rubric + verifiable rewards) improves +9.69 pass rate over a no-skill baseline and +4.01
  over the strongest prompt/memory baseline, with +8.24 on held-out Terminal-Bench 2 and +8.93
  cross-policy on a frozen GPT-5.4-mini. SkillOpt averages +23.5 points over six benchmarks — but those
  six are SearchQA, SpreadsheetBench, OfficeQA, DocVQA, LiveMathematicianBench and ALFWorld; **none is a
  coding benchmark**. Its deployed artefact is "only a compact best_skill.md", 300–2,000 tokens, from
  1–4 accepted edits, adding zero inference-time cost.
SOURCE: Agent Skill Evaluation and Evolution: Frameworks and Benchmarks — Rutgers / UNC Charlotte —
  2026-06-09 — arXiv:2606.11435v1 ; CODESKILL — Nanyang Technological University & Zhejiang University —
  2026-05-25 — arXiv:2605.25430 ; SkillOpt — Microsoft with SJTU, Tongji, Fudan — 2026-05 —
  arXiv:2605.23904v2 — all accessed 2026-09-08
COUNTEREVIDENCE: SkillOpt demonstrates strong cross-harness transfer — "a SpreadsheetBench skill trained
  in Codex transfers to Claude Code with +59.7 point gain" — and 82% retention transferring GPT-5.4 →
  GPT-5.4-mini. That is evidence *against* skills as a moat: they transfer to competitors too. The survey
  also notes "no existing benchmark evaluates evolution longitudinally", so durability is unmeasured.
OPEN QUESTION: Is there any coding-domain learned skill whose value survives the next model release?
```

```
CLAIM: An agent that writes its own tools at runtime beat every hand-built scaffold on SWE-bench Verified
       in late 2025 — and the technique was published, not turned into a moat.
LABEL: OBSERVED TODAY
CONFIDENCE: medium
EVIDENCE: Live-SWE-agent "can autonomously and continuously evolve itself on-the-fly during runtime",
  starting from bash only and generating executable scripts as tools, reflecting after each step on
  whether to create new ones. Reported 79.2% on SWE-bench Verified with Claude Opus 4.5 ($0.86 avg/
  instance), 77.4% with Gemini 3 Pro Preview ($0.48), 75.4% with Claude Sonnet 4.5 ($0.68), and 45.8% on
  SWE-Bench Pro with Claude Sonnet 4.5 ($0.73). Positioned against Darwin-Gödel-Machine-style approaches
  that need "costly offline training".
SOURCE: Live-SWE-agent: Can Software Engineering Agents Self-Evolve on the Fly? — Xia, Wang, Yang, Wei,
  Zhang — 2025-11-17 (v1), rev 2025-11-24 — arXiv:2511.13646 — https://live-swe-agent.github.io/ —
  accessed 2026-09-08
COUNTEREVIDENCE: Its headline number is on the benchmark OpenAI declared contaminated three months later,
  and the Gemini row on the official leaderboard carries checked:"false". No Live-SWE-agent entry appears
  on Terminal-Bench 4.0 or on Scale's SWE-bench Pro public board.
OPEN QUESTION: Does runtime tool synthesis still win on an uncontaminated long-horizon benchmark?
```

**Verdict for a new entrant.** Self-improvement is a *capability*, not a *moat*, for three structural
reasons, all observed today:

1. **The artefact is standardised.** Whatever the loop learns lands in a `SKILL.md` — a format ~50
   products already read, several of them directly out of each other's directories.
2. **The gains are smallest in code.** +4.5 pp for software engineering is the floor of the SkillsBench
   range; the impressive numbers are spreadsheets, documents and healthcare — i.e. domains where the model
   lacks pretraining coverage, which is the opposite of code.
3. **The incumbent already ships the plumbing *and the garbage collection*.** Claude Code shipped
   `/skill-doctor` "to identify unused skills and their context costs" in v2.1.261 (2026-09-04). Within
   eleven months of the format existing, the interesting problem moved from skill *generation* to skill
   *curation, provenance and retirement* — and no vendor has an incentive to solve that cross-vendor.

---

## 6. Incumbent absorption — dated examples

Every date is from a primary source (npm publish timestamp, vendor changelog, or vendor docs).

| Capability | First shipped by | Date | Absorbed by | Date | Lag |
|---|---|---|---|---|---|
| Hooks | Claude Code v1.0.38 | 2025-06-30 | Cursor CLI hooks (session start/end/stop, pre-compaction, subagent lifecycle) | 2026-01 | ~7 mo |
| Hooks | Claude Code v1.0.38 | 2025-06-30 | Codex hooks (12 events; `Interrupt` added in 0.150.0) | 2026-08-26 | ~14 mo |
| Custom subagents | Claude Code v1.0.60 | 2025-07-24 | Cursor 2.4 subagents | 2026-01-22 | 6 mo |
| Custom subagents | Claude Code v1.0.60 | 2025-07-24 | Cursor CLI parallel subagents | 2026-03 | 8 mo |
| Skills (`SKILL.md`) | Claude Skills / Claude Code v2.0.20 | 2025-10-16 | published as open standard at agentskills.io | 2025-12-18 | **63 days** |
| Skills | open standard | 2025-12-18 | Cursor 2.4 ("an open standard for extending agents with domain-specific knowledge and workflows") | 2026-01-22 | **35 days** |
| Skills | open standard | 2025-12-18 | Codex, GitHub Copilot, VS Code, Gemini CLI, OpenCode, OpenHands, Kiro, Goose, Roo Code, Factory, Amp, Tabnine, Junie, Trae, Letta, … (~50 clients) | through 2026 | ≤9 mo |
| Read-only Explore subagent | Claude Code v2.0.17 | 2025-10-15 | Cursor Explore subagent (+ Explorer subagent caching in 3.0) | ≤2026-04-02 | ≤6 mo |
| Plugins + marketplace | Claude Code plugins/marketplaces | 2026-H1 | Cursor marketplace 2026-02-05, plugins in 2.5 2026-02-17; Codex plugin CLI + remote marketplaces 0.153.0 2026-09-03 | 2026-02 → 2026-09 | 1–8 mo |
| Clarifying questions in plan mode | Claude Code v2.0.21 ("interactive question tool"; "Claude will now ask you questions more often in plan mode") | 2025-10-16 | Cursor 2.4 "Clarification Questions" (agents ask mid-task while continuing other work) | 2026-01-22 | 3 mo |
| Clarifying questions | Claude Code | 2025-10-16 | Codex `/plan` — "Ask ChatGPT to interview you, identify constraints, and turn the result into a goal with measurable success criteria" | 2026 (docs) | ≤11 mo |
| Goal mode | Claude Code `/goal` (week 20) | 2026-05-11/15 | Cursor `/goal` command for long-lived objectives | 2026-08-19 | 3 mo |
| Goal mode | Claude Code `/goal` | 2026-05 | Codex `/goal` in app, CLI and IDE | 2026 (docs) | ≤4 mo |
| Cloud bug-hunting fleet | Claude Code `/ultrareview` public research preview (week 17) | 2026-04-20/24 | `claude ultrareview` in CI (week 18) 2026-04-27; Codex auto-review; Cursor Bugbot | 2026 | weeks–months |
| Agent security scanning | Claude Security plugin (week 30) | 2026-07-20 | Codex Security plugin/CLI/SDK; Cognition Devin Security Swarm | 2026-07 | **~0–2 mo** |
| Self-hosted execution environments | Claude Code self-hosted environments, public beta (week 32) | 2026-08-03/07 | Cursor "Self-hosted machines" (tool execution in your own network, dynamic pool scheduling) | 2026-09-02 | **26 days** |
| Cross-session agent messaging | Claude Code cross-session messaging (week 32) | 2026-08-03/07 | Codex 0.150.0: reference other tasks with `@`, agents can "read/create/message tasks" | 2026-08-26 | **19 days** |
| Spec-driven development | Kiro (AWS) preview | mid-2025 | GitHub Spec Kit v1.0 supporting "30+ AI coding agents"; Codex `/plan`; Claude Code plan file + ultraplan | 2026-08-21 | ~12 mo |
| Whole-setup migration between agents | — | — | Codex `/import` from Claude Code and Cursor: instructions → AGENTS.md, `settings.json` → `config.toml`, skills, plugins, projects, ≤50 chats from last 30 days, with optional automatic sync | 2026 (docs) | — |

Two patterns matter more than any individual row:

- **The lag is collapsing.** 2025-era absorptions took 6–7 months. The two most recent took **26 and 19
  days**. A feature is now copied inside a single release cycle.
- **The incumbents absorb each other's *configuration*, not just their features.** Cursor's CLI reads
  Claude Code `settings.json` hooks and loads from `.claude/skills`; GitHub Copilot reads `.claude/skills`;
  OpenCode reads six skill paths including Claude's and the `.agents/` alias; Codex imports whole Claude
  Code and Cursor setups with sync. There is no configuration lock-in left for anyone to sell.

---

## 7. Contradictions with common belief

**1. "SWE-bench Verified is at 95% — coding is basically solved."**
The official leaderboard's best verified entry is **79.2%**, and it has received no submission since
2026-02-26. The 93–96% figures on aggregator sites are vendor self-reports; one of those sites concedes
"99 of the 100 leaderboard entries are self-reported". Meanwhile OpenAI's own audit found 59.4% of
hard-instance failures were the *benchmark's* fault, not the model's. On the tasks the community still
measures — Terminal-Bench 4.0, SWE-bench Pro, SWE Atlas, SWE-Cycle, SWE-EVO — frontier systems sit
between **13.5% and 61.5%**.

**2. "The scaffold / agent harness is where the product value is."**
The maintainers of the benchmark that created this market made a ~100-line bash-only agent the *control
condition*, with the tooltip "so scores compare models rather than harnesses". Scale AI runs its
commercial SWE-bench Pro leaderboard on that same 100-line agent. And on Terminal-Bench 4.0 the two most
sophisticated harnesses in existence are 0.30 points apart while effort level inside one harness moves the
score by 7.57 points. If you are building "a better agent loop", you are building the thing the field has
formally agreed to hold constant.

**3. "Codebase indexing / embedding retrieval is a durable moat."**
Cursor — the company that made semantic codebase indexing famous — no longer has a codebase-indexing docs
page (`/docs/context/codebase-indexing.md` → 404). Its surviving Search page documents exactly two things:
Instant Grep ("a custom search engine that outperforms `ripgrep` on large codebases") and an Explore
subagent running "a faster model". Claude Code's large-codebase guide recommends per-directory CLAUDE.md,
`Read` deny rules, LSP plugins and per-directory skills, and mentions RAG only as "if your organization
already runs a code search or RAG index over the repository, expose it as an MCP tool". Retrieval
collapsed into grep plus a cheap read-only agent.

**4. "Open source is a year behind the frontier."**
Cline ships plan/act, checkpoints, rules, skills, plugins, hooks, MCP, subagents, memory bank, agent teams,
scheduled agents, an SDK and OpenTelemetry. OpenCode ships primary agents, three built-in subagents, skills
from six directory conventions, plugins, MCP, LSP and per-agent permissions and step caps. OpenHands ships
an agent server, sandbox server, SDK, cloud, and positions on "one to thousands of agents". On models,
under an identical bash-only control, open-weight MiniMax M2.5 scored 75.8% against Claude 4.5 Opus's 76.8%
at one-tenth the cost. The feature gap is near zero; the remaining gap is distribution and reliability.

**5. "Agent memory and skill libraries are a startup category."**
Claude Code writes auto memory by default — four note types (`user`, `feedback`, `project`, `reference`),
per repository, shared across worktrees, first 200 lines or 25 KB loaded every session, and subagents get
their own. Codex generates memories into `~/.codex/memories/` automatically after a chat goes idle.
Cursor has memories; Cline has a memory bank. The format for shareable procedural knowledge is a published
open standard. The unsolved part is not storing memories — it is knowing which are stale, which is why
Anthropic shipped `/skill-doctor` four days before this report.

**6. "More parallel agents means more shipped software."**
The Productivity-Reliability Paradox telemetry (arXiv:2605.01160: +98% PRs, +91% review time, flat
delivery) and the METR RCT (19% slowdown for experienced developers on familiar repos) both say otherwise,
and ChainSWE supplies the mechanism: agents degrade against the state prior agents left behind. Claude
Code's own workflow docs cap runs at 1,000 agents and raise a "Large workflow" warning above 25 agents or
1.5M projected tokens — the vendor itself is telling you the constraint is not agent count.

---

## 8. Problems nobody is talking about

**1. There is no published harness ablation for a single fixed model.**
Everyone reports "model + harness". Nobody reports "Opus 5 under Claude Code vs Codex vs Cursor CLI vs
OpenCode vs mini-SWE-agent" on the same tasks. *Inside the Scaffold* shows the dimensions where designs
still genuinely diverge are context compaction (7 distinct strategies across 13 agents, from
mini-SWE-agent's "none — unbounded growth; agent crashes on ContextWindowExceededError" to Gemini CLI's
"LLM summarization with verification") and state management (7 patterns). So the one dimension that might
still be differentiable is the one dimension nobody evaluates. A credible public harness-ablation rig is
an unserved, cheap-to-build artefact — and it is also the experiment that would falsify this lane.

**2. Cross-session accumulated state is the top failure cause and no product surface exposes it.**
ChainSWE: 48% of downstream failures come from the agent's own earlier edits, and under-edits outnumber
over-edits nine-to-one — agents systematically fail to finish propagating a change they themselves
started. Every shipping product resets context per session and treats each task as independent. Auto
memory stores *preferences and corrections*; Claude Code's own docs say it "skips anything it can derive
from the codebase, such as architecture, file paths, or debugging fixes". Nobody ships a "what did I leave
half-done in this repository" ledger, which is precisely the thing the benchmark says is killing them.

**3. Cost dispersion at equal capability is 3–10× and is not a product.**
Terminal-Bench 4.0: 58.18% for $3,267 (Codex / GPT-6 Astra max) vs 57.88% for $6,244 (Claude Code /
Fable 5.1 max) — a 91% cost premium for −0.30 points. Codex at *low* effort gets 50.61% for $1,557, i.e.
87% of the top score for 24% of the top cost. SWE-bench Verified bash-only: 75.8% for $36.6 (MiniMax M2.5)
vs 76.8% for $377 (Claude 4.5 Opus). Nobody sells "the same outcome at a tenth of the spend" as a
first-class surface; the incumbents ship effort sliders whose recommended settings move *up* (`xhigh`,
`ultracode`), and one changelog entry adds a "spending limit bar" rather than a cost-optimal router.

**4. The evaluation vacuum after SWE-bench Verified has no auditor.**
The recommended replacement (SWE-bench Pro) is run by a vendor that also sells evaluation services. SWE
Atlas explicitly "combines programmatic verification with rubric-based assessment" — an LLM judge — and
*Judging Is Not Enumerating* just showed LLM-authored acceptable sets admit only 19–42% of correct
solutions. Nobody has audited whether LLM-rubric benchmarks inherit the same omission bias they were
introduced to escape. Meanwhile most entries on the SWE-bench Test board carry `checked: false`.

**5. Skill and plugin sprawl arrived with no provenance, no attestation and no lifecycle.**
The format became a standard on 2025-12-18. By 2026-09-04 Anthropic shipped `/skill-doctor` to find unused
skills and their context cost, and the docs already warn that when many skills are present "descriptions
are shortened", which "can strip the keywords Claude uses to decide whether a skill applies". Skills
execute shell commands via dynamic injection and are installed from marketplaces; Claude Code had to ship
`disableSkillShellExecution` and a rule that "Synced skills from claude.ai never execute injected commands
locally". There is still no cross-vendor signing, no provenance chain, and no way to ask "which of my 60
skills changed behaviour last month". A skills SBOM is an obvious missing artefact that no single vendor is
incentivised to build.

**6. Nobody measures whether the clarifying question was the *right* one.**
Three vendors now ship clarification (Claude Code plan-mode questions since 2025-10-16, Cursor 2.4
Clarification Questions, Codex `/plan` interview). Zero benchmarks score the question. The published
measure of the adjacent problem is negative: semantic collapse (arXiv:2607.01953) shows models unanimously
converge on one wrong reading in 3–32% of tasks, invisible to disagreement-based detectors. So the shipped
feature most likely fires when the model is *already* uncertain — and stays silent exactly when the
whole ensemble is confidently wrong. A shipped capability with an unmeasured and probably-inverted hit rate.

**7. `/import` means the incumbents have zeroed each other's switching cost — and therefore yours.**
Codex imports instructions, settings, skills, plugins, projects and 50 recent chats out of Claude Code or
Cursor, with optional automatic sync, and "Importing doesn't change or delete your existing agent setup".
Everyone is optimising for capture, which means any configuration a new entrant accumulates is portable
*away* by design. Any thesis of the form "we win because users configure us deeply" is dead on arrival.

**8. The independents are quietly dying and nobody is writing the post-mortem.**
Aider — 48,832 stars, the tool that popularised repo maps and diff edit formats — last shipped a release on
2025-08-09 and last saw a repository push on 2026-05-22. It has no skills, no hooks, no subagents, no MCP.
It is the control group for what happens to a beloved single-maintainer agent when the incumbents ship
weekly, and no analysis of the coding-agent market treats it as data.

---

## 9. What becomes commodity / what stays hard

### Commodity — do not differentiate on these

| Item | Label |
|---|---|
| The agent loop itself (ReAct + generate-test-repair + plan-execute + retry + tree search, composed) | OBSERVED TODAY |
| Bash/terminal execution, file read/search/edit, `str_replace`-style patching | OBSERVED TODAY |
| Repo search by grep plus a cheap read-only explore subagent | OBSERVED TODAY |
| Embedding-based codebase indexing (being retired, not merely commoditised) | OBSERVED TODAY |
| Skills / `SKILL.md` procedural packaging and its distribution | OBSERVED TODAY |
| Hooks with the standard lifecycle event set | OBSERVED TODAY |
| Subagents, nested subagents, parallel fan-out, agent teams | OBSERVED TODAY |
| MCP client and server support | OBSERVED TODAY |
| Plugins and plugin marketplaces | OBSERVED TODAY |
| Sandboxing, permission modes, classifier-based auto-approval | OBSERVED TODAY |
| Checkpoints, rewind, git worktree isolation, sparse checkout | OBSERVED TODAY |
| Background / cloud / scheduled / long-running agents, and goal mode | OBSERVED TODAY |
| Procedural auto memory | OBSERVED TODAY |
| Model routing, fallback chains, multi-provider support | OBSERVED TODAY |
| Browser control and computer use | OBSERVED TODAY |
| PR review bots and agent security scanners | OBSERVED TODAY |
| Spec-scaffold generation (requirements.md / design.md / tasks.md) | OBSERVED TODAY |
| Asking the user a clarifying question — the act, not the judgement | OBSERVED TODAY |
| Config import/export between agents | OBSERVED TODAY |
| Prompt-level scaffold IP of any kind | STRONG TREND |
| Skill-generation and trajectory-distillation loops (output is portable) | STRONG TREND |
| Agent-authored runtime tools | REASONABLE EXTRAPOLATION |
| "Better context compaction" sold as a standalone product | REASONABLE EXTRAPOLATION |

### Stays hard through 2028

| Item | Label | Why |
|---|---|---|
| Knowing whether the change that shipped still matches what was wanted | OBSERVED TODAY (as a gap) | no system in this lane's scope attempts it |
| Carrying correct state across sessions and dependent changes | OBSERVED TODAY | ChainSWE: −70% over chains, 48% self-inflicted, under-edits 9:1 |
| End-to-end autonomy including environment reconstruction and test authoring | OBSERVED TODAY | SWE-Cycle FullCycle 13.5%, none above 14% |
| Multi-file, multi-release software evolution | OBSERVED TODAY | SWE-EVO 25%; gpt-5.2 72.80% → 22.92% |
| Authoring a complete acceptance set (as opposed to judging one) | OBSERVED TODAY | authored suites admit 19–42% of correct solutions; predicates reach F1 ~0.99 |
| Machine-checkable specifications outside Dafny-like settings | STRONG TREND | Vericoding: Dafny 82%, Verus 44%, Lean 27%; NL descriptions did not help |
| Detecting the confidently-wrong single reading | STRONG TREND | semantic collapse 3–32%, invisible to disagreement detectors; self-consistent errors do not shrink with scale |
| Trustworthy evaluation of agents after SWE-bench Verified | OBSERVED TODAY | six-month leaderboard silence; vendor-run and LLM-judged successors |
| Cost-efficiency as an engineered property rather than a slider | OBSERVED TODAY | 3–10× dispersion at equal capability, unproductised |
| Provenance and lifecycle for procedural knowledge (skills/plugins) | REASONABLE EXTRAPOLATION | no cross-vendor signing exists; `/skill-doctor` is the first symptom |

### Direct answer to the lane question

**Do not differentiate on:** the agent harness; terminal/file/browser tooling; retrieval; skills; hooks;
subagents; MCP; plugins; sandboxing; checkpoints; memory; model routing; background agents; goal loops;
PR review; security scanning; spec-document generation; or "we ask better clarifying questions" as a
feature rather than as a measured judgement. Every one of these is already shipped by three or more
systems including at least one free open-source one, or standardised such that your implementation is
loadable by your competitor. The observed absorption lag says you have between **19 days and 8 months**.

**The only defensible ground this lane can see** lies on the axes the benchmarks say are still broken and
the products do not touch: *state that persists correctly across sessions and dependent changes*;
*specification artefacts a machine can check* (models score ~0.99 as predicate-writers and 0.19–0.42 as
set-enumerators); and *the feedback edge from deployed reality back to stated intent*, which nothing in the
frontier table addresses at all. Note the shape of that list: it is the last three arrows of the mission's
north-star chain (SPECIFICATION → SOFTWARE → REALITY → still matches intent?), and the commodity map shows
the incumbents have taken everything to the left of it.

---

## 10. Open questions for the second wave

1. **What is the true harness delta?** Run one fixed model (Opus 5 or GPT-6 Astra) through Claude Code,
   Codex, Cursor CLI, OpenCode and mini-SWE-agent on Terminal-Bench 4.0 or SWE-bench Pro. Nobody has
   published this. If the spread is <5 points, this lane's conclusion hardens to near-certainty; if it is
   >15, "harness quality" is far more differentiable than the leaderboards imply. This is the single
   cheapest experiment that could falsify §7.2.
2. **Is SWE-bench Pro already contaminated?** Its public split is on Hugging Face and its tasks are mined
   from public repositories. Apply OpenAI's own red-teaming protocol (a probe model eliciting gold-patch
   recall from a non-reasoning target over 15 turns) to SWE-bench Pro and report the strong-contamination
   rate. If it is non-trivial, the field has no uncontaminated public coding benchmark at all.
3. **Do LLM-rubric benchmarks inherit the enumeration bias?** SWE Atlas grades partly on rubrics. If LLMs
   are 0.74–0.90 as judges but their authored acceptance sets admit only 19–42% of correct solutions,
   what is the false-negative rate of a rubric-graded refactoring benchmark?
4. **Does any shipping compaction strategy reduce chain-position decay?** Re-run ChainSWE's length-3 chains
   under the real compaction implementations in Claude Code, Codex and Cursor rather than the paper's three
   synthetic configurations. This is the most decision-relevant experiment in the lane: it is the one place
   *Inside the Scaffold* says designs still diverge and the one place ChainSWE says the money is.
5. **How fast is the absorption lag actually falling?** This report found 6–7 months in 2025 and 19–26 days
   in August–September 2026, from a small sample. Build the full dated matrix (capability × vendor × ship
   date) and fit the trend. The kill criterion for any product idea is whether its build time exceeds the
   lag.
6. **Is the open-weight gap re-opening on long horizons?** February 2026 bash-only data shows a 1-point gap
   on single-patch tasks; September 2026 Terminal-Bench shows 16.4 points. Task-length effect, submission
   recency artefact, or real divergence?
7. **What is the licence and governance status of the open agents?** GitHub API rate limits blocked
   verification for `openai/codex`, `sst/opencode`, `cline/cline`, OpenHands and `mini-swe-agent` this
   pass. If any is not OSI-licensed, part of the open-source-parity argument weakens.
8. **Has MCP moved to neutral governance?** modelcontextprotocol.io (spec path dated 2026-07-28) makes no
   foundation claim, and searches for a Linux Foundation / Agentic AI Foundation donation were rate-limited
   and returned nothing usable. Standard-capture risk is unresolved — and the same question now applies to
   agentskills.io, which is stewarded on GitHub under `agentskills/agentskills` with no named foundation.
9. **Did anyone actually die?** No dated evidence was obtainable this pass of coding-agent startups shut
   down or acqui-hired specifically because of incumbent absorption. Aider's stall (last release
   2025-08-09, last push 2026-05-22) is the only decay signal found. The absorption thesis would be far
   stronger with a casualty list, and far weaker if none exists.
10. **Is Kiro's "property-based testing" real?** kiro.dev markets validating "code correctness through
    property-based testing" but `kiro.dev/docs/property-testing/` 404s and the docs `llms.txt` was
    unreachable. If AWS has shipped agent-driven property-based verification, that is the first incumbent
    move into the "stays hard" column and it materially changes this lane's conclusion.
11. **Does anything in the frontier close the reality→intent loop?** This lane found no product that
    checks a shipped change against the intent that motivated it. Lane 07 (observability) should be asked
    directly whether OpenTelemetry-era tooling plus agent hooks is enough to close it, or whether that
    remains genuinely unbuilt.
