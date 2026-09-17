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

---

## Second wave (2026-09-14)

**Question for this wave:** across Claude Code, Codex, Cursor, Cline, OpenCode, Gemini CLI and Aider, what
specifically happens to *project-level* continuity — not user preferences — across a gap of months? This
goes deep on the gap flagged in §8 point 2 ("nobody ships a 'what did I leave half-done in this repository'
ledger") and open question 11.

**Cutoff:** 14 September 2026. Every statement below was **re-fetched** on 14–15 September 2026; nothing
from the 8 September pass was assumed to still hold, and two findings below show it did not. A small number
of artefacts (Codex `0.155.0-alpha.5/6`, Cline `sdk/v0.0.83`, `desktop-v0.0.28`, `cli-v3.0.62`) carry
publish timestamps of 2026-09-15 UTC; they are recorded with their true dates rather than suppressed.

**Source-hygiene note (acting on the lane-12 warning):** this wave did not use `doc.jarvisuni.com` or
`codex-docs.com`, and neither appeared in the original report. Because the coordinator flagged Codex
documentation impersonation, every load-bearing Codex claim here was additionally verified against
`developers.openai.com` and the `openai/codex` GitHub repository. The repo's own `docs/config.md`,
`docs/slash_commands.md` and `docs/agents_md.md` are stubs that redirect to `developers.openai.com/codex/...`,
and the page served at `developers.openai.com/codex/guides/agents-md` carries the HTML title
"Custom instructions with AGENTS.md | ChatGPT Learn" — i.e. `learn.chatgpt.com` and `developers.openai.com`
serve the same official OpenAI corpus. The strongest Codex finding in this wave (the 30-day memory horizon)
is cited from `developers.openai.com`, not from `learn.chatgpt.com`.

---

### S1. What changed since 2026-09-08 (six days)

1. **Cursor shipped the thing this lane said nobody ships.** Cursor Projects launched 2026-09-10, two days
   after the original report, promising "context over months of work" and a per-Project file set that
   syncs across machines. It is beta, undocumented outside the changelog, and cloud-first.
2. **Claude Code shipped 8 releases (v2.1.265–v2.1.272, 2026-09-08 → 2026-09-14) and none of them touched
   project continuity.** The only memory-adjacent line in the window is a truncation-warning improvement.
3. **The original report was wrong on two counts.** Claude Code's auto memory *does* distinguish project
   state from user preference — it has a typed `project` note class the original report did not quote. And
   Codex local memories are **off by default**, which the original report implied were automatic.
4. **Cursor's memories documentation is gone.** `cursor.com/docs/memories.md` and
   `cursor.com/docs/context/memories.md` both 404, and the string "memor" appears nowhere in
   `cursor.com/llms.txt` except one line in `rules.md` saying models *don't* have memory. The same
   quiet-deletion pattern as codebase-indexing (§7.3).
5. **Codex has a documented 30-day forgetting horizon**, in two places, in the official config reference.
6. **Gemini CLI has an Auto Memory feature** the original report missed: experimental, off by default,
   human-gated through a `/memory inbox` review queue.
7. **The decisive finding is a retention sweep, not a feature gap.** Claude Code deletes plan files and task
   lists after 30 days by default. The artefacts that encode "what I left half-done" are garbage-collected
   before a months-long gap ends.
8. **The gap is already being filled by an Apache-2.0 cross-vendor layer** with ~94k GitHub stars, which
   changes the strategic reading of §8 point 2 from "unserved" to "served by a commodity".

---

### S2. Question 1 — does each system separate *user preference* memory from *project state* memory?

| System | Separate surfaces? | Verdict | The doc language that settles it |
|---|---|---|---|
| Claude Code | **Yes — typed** | Distinguishes, but with an explicit derivability carve-out | Auto memory writes four typed notes: "`user`: your role, expertise, and working preferences"; "`feedback`: corrections you give Claude and approaches you confirm"; "**`project`: ongoing work, deadlines, and decisions that Claude can't derive from the code or git history**"; "`reference`: where to find information outside the project". Then: "Claude skips anything it can derive from the codebase, such as architecture, file paths, or debugging fixes." |
| Codex | **No** | Conflated by construction, and user-global | "The main memory files live under `~/.codex/memories/` and include summaries, durable entries, recent inputs, and supporting evidence from prior chats." No project scoping, no type field documented. Separately: "Keep required team guidance in `AGENTS.md` or checked-in documentation. Treat memories as a helpful recall layer, not as the only source for rules that must always apply." |
| Cursor (pre-Projects) | **N/A — feature undocumented** | Neither; rules only | `cursor.com/docs/memories.md` → 404. The only memory sentence in the docs corpus: "Large language models don't retain memory between completions. Rules provide persistent, reusable context at the prompt level." |
| Cursor Projects | **Conflated, deliberately** | One bucket for both | "Agents add research and artifacts, along with what they learn about the codebase **and how you prefer work to be done**." One shared-context file set holds project knowledge and user preference together. |
| Cline | **Yes — six files** | The cleanest separation of the seven, but it is a methodology, not a feature | `activeContext.md` = "Current focus, recent changes, next steps"; `progress.md` = "What works, what's left, known issues"; `systemPatterns.md` = "Key technical decisions"; `projectbrief.md` = "Source of truth for project scope". Preference lives in `.clinerules`, state lives in `memory-bank/`. |
| OpenCode | **No memory feature at all** | Rules only | The docs index has no memory page and no session-persistence page. `AGENTS.md`: "This is similar to Cursor's rules." Project vs global scope exists, but for *instructions*: project `AGENTS.md` vs `~/.config/opencode/AGENTS.md`. |
| Gemini CLI | **Partially** | Global vs project patch targets, but one content class | Auto Memory mines "durable facts, preferences, workflow constraints, and procedural patterns that recur across sessions" — one undifferentiated class. It does split *destinations*: "Private patches target the project memory directory; global patches target only your personal `~/.gemini/GEMINI.md` file." |
| Aider | **No** | Chat log only | `--chat-history-file` (default `.aider.chat.history.md`) and `--input-history-file`. No memory concept. |

```
CLAIM: Only two of the seven systems type project state separately from user preference, and in both cases
       the mechanism excludes exactly the class of fact a months-later resumption needs most.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: Claude Code is the only system with a vendor-shipped, automatically-written, typed `project`
  memory class. Its docs define it as "ongoing work, deadlines, and decisions that Claude can't derive from
  the code or git history" — then immediately bound it: "Claude skips anything it can derive from the
  codebase, such as architecture, file paths, or debugging fixes. It also skips anything your CLAUDE.md
  files already say." Writing is discretionary: "Claude doesn't save something every session. It decides
  what's worth remembering based on whether the information would be useful in a future conversation."
  Cline's Memory Bank types state across six files (`activeContext.md`, `progress.md`, `systemPatterns.md`,
  `projectbrief.md`, `productContext.md`, `techContext.md`) but ships as copy-paste text: "Copy this into a
  Cline Rules file (for example, `.clinerules/memory-bank.md`)". The other five conflate or have nothing.
SOURCE: How Claude remembers your project — Anthropic — fetched 2026-09-14 —
  https://code.claude.com/docs/en/memory.md ; Memory Bank — Cline — fetched 2026-09-14 —
  https://docs.cline.bot/best-practices/memory-bank.md — both accessed 2026-09-14
COUNTEREVIDENCE: The derivability carve-out is defensible engineering, not an oversight — architecture and
  file paths genuinely are re-derivable, and storing them invites staleness. The real gap is narrower than
  "project memory": it is *in-flight* state, which is neither a preference nor derivable from the code.
OPEN QUESTION: What fraction of auto-memory files in the wild actually carry `type: project`? Nobody has
  published a corpus study, and the files are machine-local by design ("Files are not shared across
  machines or cloud environments"), so no vendor can measure it either.
```

---

### S3. Question 2 — does anything persist an active task, a decision log, abandoned approaches, or acceptance status?

Four artefact classes, seven systems. **YES** = persists across sessions as a first-class durable artefact;
**PARTIAL** = persists but scoped to one session/chat, or requires the user to drive it; **NO** = explicit absence.

| System | Active task / plan | Decision log with rationale | Abandoned approaches | Acceptance / verification status |
|---|---|---|---|---|
| Claude Code | PARTIAL — `plans/` on disk, re-injected after compaction, **swept at 30 days** | NO (`project` notes may *incidentally* mention decisions; no structure, no rationale field) | NO | NO |
| Codex | PARTIAL — `/goal` condition, per-chat only | NO | NO | PARTIAL — goal text *is* the completion criteria, but only while the chat lives |
| Cursor | PARTIAL — plan file, home dir by default, opt-in "Save to workspace" | NO | NO | NO |
| Cursor Projects | YES claimed ("months of work") — unverifiable, no docs page | NO (not claimed) | NO (not claimed) | PARTIAL — "brings the finished work back to you to check" |
| Cline | YES — `activeContext.md` ("next steps") | YES — `progress.md` → "Evolution of project decisions"; `systemPatterns.md` → "Key technical decisions" | PARTIAL — `activeContext.md` → "Active decisions and considerations" | YES — `progress.md` → "What works, what's left, known issues" |
| OpenCode | NO | NO | NO | NO |
| Gemini CLI | PARTIAL — `write_todos` in-session; `/resume save <name>` named forks | NO | PARTIAL — named conversation forks | NO |
| Aider | NO (`.aider.chat.history.md` is a transcript, not a ledger, and is not loaded by default) | NO | NO | NO |

```
CLAIM: Exactly one of the seven systems persists a decision log with rationale and an acceptance status —
       and it is not a shipped feature, it is a prompt template the vendor says works on competitors too.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: Cline's Memory Bank is the only design in the seven that names all four artefact classes.
  `progress.md` is specified to hold "What works / What's left to build / Current status / Known issues /
  Evolution of project decisions"; `activeContext.md` holds "Current work focus / Recent changes / Next
  steps / Active decisions and considerations / Learnings and project insights"; `systemPatterns.md` holds
  "Key technical decisions". But the docs classify it as a methodology, not a capability: "Memory Bank is a
  documentation methodology that transforms Cline from a stateless assistant into a persistent development
  partner", installed by "Copy this into a Cline Rules file", driven by typed English commands ("initialize
  memory bank", "update memory bank", "follow your custom instructions"). Cline's own FAQ makes the
  non-moat explicit: "Does this work with other AI tools? Yes. Memory Bank is a documentation methodology
  that works with any AI that can read docs. Commands may differ but the approach works across tools."
  No other system in the seven documents a decision-rationale artefact at all.
SOURCE: Memory Bank — Cline — fetched 2026-09-14 — https://docs.cline.bot/best-practices/memory-bank.md —
  accessed 2026-09-14
COUNTEREVIDENCE: Memory Bank is user-triggered and therefore unreliable in exactly the scenario this wave
  asks about: a developer who walks away for three months is, by construction, a developer who did not run
  "update memory bank" before leaving. The docs concede the maintenance burden — "`activeContext.md`
  changes most frequently; update it after each session" — which is a discipline requirement, not a
  guarantee. A ledger that depends on the human remembering to write it is not a solution to the human
  forgetting.
OPEN QUESTION: Does any Memory Bank deployment survive contact with a real multi-month gap? The pattern has
  circulated since early 2025; no longitudinal study of memory-bank drift or accuracy exists.
```

```
CLAIM: Claude Code writes the strongest half-done-work artefacts of any first-party system — a plan file
       and a task list, both on disk — and then deletes them on a 30-day timer by default.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: `~/.claude/` retention: "Claude Code deletes the files in the paths below once they're older than
  `cleanupPeriodDays`, as long as it can safely determine the retention period. The default is 30 days
  and the minimum is 1; setting `0` fails with a validation error." The swept paths include, verbatim:
  `projects/<project>/<session>.jsonl` — "Full conversation transcript: every message, tool call, and tool
  result"; `projects/<project>/<session>/subagents/` — subagent transcripts; `file-history/<session>/` —
  "Pre-edit snapshots of files Claude changed, used for checkpoint restore"; `plans/` — "Plan files
  written during plan mode"; and `tasks/` — "Task lists written by the task tools, one directory per
  list". Auto memory is the documented exception: "the sweep doesn't delete the memory files in a
  project's auto memory directory... Claude Code removes that directory only if it has been empty for the
  whole retention period." One other thing survives indefinitely: `history.jsonl`, "Every prompt you've
  typed, with timestamp and project path."
SOURCE: What lives in the `.claude` directory — Anthropic — fetched 2026-09-14 —
  https://code.claude.com/docs/en/claude-directory.md — accessed 2026-09-14
COUNTEREVIDENCE: `cleanupPeriodDays` is user-configurable at any settings scope, so a team that cares can
  set it to 365. And the sweep is a deliberate privacy control, not an oversight — the same page warns
  "Transcripts and history are not encrypted at rest" and recommends *lowering* the value. The default
  therefore encodes a real trade-off: continuity versus plaintext-credential exposure. That is the most
  interesting thing in this wave — project continuity and transcript hygiene are in direct conflict, and
  every vendor has silently resolved it in favour of hygiene.
OPEN QUESTION: Would a ledger that stores *derived, redacted* state rather than raw transcripts dissolve
  the conflict? Nobody has tried to separate the two retention policies.
```

---

### S4. Question 3 — what is lost across a months-long gap, per each system's own docs

Deliberately restricted to what the vendors state. Inferences are kept out of the table.

| System | What its own docs say is lost | Documented time constant |
|---|---|---|
| Claude Code | Transcript, subagent transcripts, spilled tool results, checkpoint snapshots, **plan files**, **task lists**, debug logs, session env metadata, paste/image caches — all deleted by the retention sweep. On resume *within* the window: a tool still running when the process ended "doesn't finish or run again... Claude continues without its output"; `--mcp-config`, `--settings`, `--plugin-dir`, `--fallback-model` and `--add-dir` directories are not restored; an active goal's "turn count, timer, and token-spend baseline reset"; "Background Bash and monitor tasks aren't [restored]"; on the picker and `/resume` routes the stored permission mode is not restored. If the session is over 100K tokens and idle over ~1 hour, resume offers a summary, and "whatever the summary leaves out is no longer in Claude's context". | **30 days** (`cleanupPeriodDays` default); ~1 hour + 100K tokens triggers the summarise-on-resume dialog |
| Codex | Threads older than the horizon stop being memory inputs, and unused memories stop being consolidated. Transcript persistence is a toggle: `history.persistence` = "save-all \| none". Goal state is per-chat: "Each chat keeps its own context, messages, results, and goal." | **30 days**, twice: `memories.max_rollout_age_days` "Maximum age of threads considered for memory generation. Defaults to 30 and is clamped to 0 - 90"; `memories.max_unused_days` "Maximum days since a memory was last used before it becomes ineligible for consolidation. Defaults to 30 and is clamped to 0 - 365" |
| Cursor | Not documented. Docs describe recovery-by-search, not retention: "Cursor builds a local search index that scales to thousands of conversations", plus `@Chats` "to reference context from a previous conversation". Plans default to the home directory unless you click "Save to workspace". | **NOT FOUND** — no retention or expiry statement located in the docs corpus |
| Cline | Not stated as loss; the claim is the opposite, and it is scoped in days: "Even if you close the editor and return **days** later, Cline can pick up where you left off." Implied deletion pressure: "Favorited tasks are protected from deletion." | **NOT FOUND** for a sweep; "days" is the only horizon the docs name |
| OpenCode | Nothing documented. Sessions are the only unit (`--continue`, `--session <id>`, `--fork`, `opencode session list`, `opencode session delete`). No memory feature, no retention statement. | **NOT FOUND** |
| Gemini CLI | `gemini -r` "restores your chat history and memory". Deletion is manual and explicit: `x` in the `/resume` browser "permanently deletes the history for that specific conversation"; `/exit --delete` "removes the current session's conversation history and tool output files before exiting". Auto Memory ignores sessions under 10 user messages and any session not idle at least 3 hours. | **3 hours** idle / **10** user messages (eligibility floors); no expiry documented |
| Aider | The chat log is written into the repository (`.aider.chat.history.md`) but **not loaded**: `--restore-chat-history` — "Restore the previous chat history messages (**default: False**)". Nothing else persists. | n/a — loss is immediate and by default, at every restart |

```
CLAIM: Two of the three frontier agents have a 30-day forgetting constant written into their defaults, and
       neither vendor frames it as a continuity decision.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: Claude Code: `cleanupPeriodDays` default 30 days, sweeping transcripts, `plans/` and `tasks/`;
  framed on a page about disk layout and plaintext storage. Codex: `memories.max_rollout_age_days` default
  30 (clamped 0-90) and `memories.max_unused_days` default 30 (clamped 0-365); framed as configuration
  knobs in a reference table. Neither page discusses what happens to a project resumed after the horizon.
  A developer returning after three months therefore finds, on both systems, that the machine-side record
  of what was in flight has already expired — while the *prompts they typed* survive indefinitely in
  Claude Code's `history.jsonl`, and the *preferences* survive in the memory directory the sweep skips.
  The system preserves who you are and what you asked, and discards what it was doing.
SOURCE: What lives in the `.claude` directory — Anthropic — fetched 2026-09-14 —
  https://code.claude.com/docs/en/claude-directory.md ; Codex configuration reference — OpenAI —
  fetched 2026-09-14 — https://developers.openai.com/codex/config-reference — both accessed 2026-09-14
COUNTEREVIDENCE: Both constants are configurable, and Codex's is arguably correct for its purpose: a
  memory derived from a three-month-old thread is a strong staleness risk, and this lane's own evidence
  (ChainSWE, §4) says accumulated stale state is what kills agents. It is defensible that a *conversational*
  memory should decay. The gap is that no vendor ships a second, non-decaying store for facts that should
  not decay — and a design decision does not become wrong merely because it is six months old.
OPEN QUESTION: Is 30 days empirically right? No vendor publishes a staleness-versus-utility curve for
  agent memory, and Codex's own clamp ranges (0-90 for one knob, 0-365 for the other) show the vendors do
  not agree with themselves about the order of magnitude.
```

```
CLAIM: Claude Code has shipped a per-fact staleness signal since July 2026 — the only freshness primitive
       found in any of the seven — but it is a timestamp on a preference note, not on a task.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: "When Claude writes a memory file that begins with YAML frontmatter, Claude Code records the
  write time in a `modified` frontmatter field as an ISO 8601 timestamp. The timestamp shows how current
  the fact is, both to you and to Claude when it reads the memory back... The `modified` field requires
  Claude Code v2.1.214 or later." v2.1.214 published to npm 2026-07-18T00:13:41Z. The changelog states the
  intent earlier and more plainly, at v2.1.75: "Added last-modified timestamps to memory files, helping
  Claude reason about which memories are fresh vs. stale." No equivalent exists in Codex, Cursor, Cline,
  OpenCode, Gemini CLI or Aider: searching each corpus for a per-fact freshness or confidence field
  returned nothing.
SOURCE: How Claude remembers your project — Anthropic — fetched 2026-09-14 —
  https://code.claude.com/docs/en/memory.md ; CHANGELOG.md v2.1.75 and v2.1.214 — Anthropic — fetched
  2026-09-14 — https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md ; npm publish
  time for 2.1.214 — https://registry.npmjs.org/@anthropic-ai/claude-code — all accessed 2026-09-14
COUNTEREVIDENCE: A write timestamp is a weak staleness proxy. It records when the note was written, not
  whether the underlying fact still holds — the codebase can invalidate a three-day-old note and leave a
  three-month-old one true. Nothing in the docs connects `modified` to repository state, commit history,
  or any verification. It is metadata, not validation.
OPEN QUESTION: Would a memory invalidated by *git evidence* (the file it references changed; the test it
  cites now passes) outperform a timestamp? No system attempts it and no paper in this lane measures it.
```

---

### S5. Question 4 — vendor movement since 2026-09-08

There is exactly one, and it arrived two days after the original report.

```
CLAIM: Cursor shipped "Projects" on 2026-09-10 — the first first-party product in this lane's scope to
       market continuity across months as its headline claim — and it is beta, cloud-first, and had no
       documentation page five days later.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: Cursor changelog, dated "Sep 10, 2026", verbatim: "Today we're launching Projects in Cursor.
  Projects lets you take on larger bodies of work, such as a feature, a migration, or a full app. It
  maintains context over months of work, delegates tasks to thousands of subagents, and performs
  recurring work without being prompted." On the mechanism: "You shouldn't have to onboard an agent every
  time you start a task. Each Project maintains a set of files that sync across every cloud and local
  machine its agents use. Agents add research and artifacts, along with what they learn about the codebase
  and how you prefer work to be done. If one agent figures out how to test a service, for example, every
  future agent can use those instructions. The shared context grows with the Project, making the
  coordinator more effective over time." On the architecture: "A Project runs on its own computer in the
  cloud, so closing your laptop doesn't stop it." On maturity: "Projects are available in beta and rolling
  out to all users starting today." As of 2026-09-15, `cursor.com/docs/projects.md`,
  `cursor.com/help/ai-features/projects.md` and `cursor.com/docs/agent/projects.md` all return 404, and
  `cursor.com/llms.txt` lists no Projects page. The changelog entry is the only primary source that exists.
SOURCE: Cursor Projects — Anysphere — 2026-09-10 — https://cursor.com/changelog/projects — accessed
  2026-09-15 (also carried at https://cursor.com/changelog)
COUNTEREVIDENCE: Read precisely, the claim is narrower than a ledger. The persisted content is described as
  "research and artifacts... what they learn about the codebase and how you prefer work to be done" — that
  is accumulated *knowledge*, the same category as skills and auto memory, explicitly mixed with user
  preference. Nothing in the announcement mentions an active task list, a decision record, a rationale, an
  abandoned approach, or a verification status. And the continuity is bought partly by moving the work to a
  persistent cloud machine — the agent "remembers" in part because it never stopped. That is a hosting
  answer to a state question. Whether a Project resumed after a real three-month idle gap recovers anything
  is untested and unstated.
OPEN QUESTION: Does a Cursor Project's shared-context file set have a schema, and is it exportable? If it
  is opaque and cloud-resident, it is the first genuinely non-portable artefact in this lane — which would
  contradict §8 point 7 and make it the most strategically interesting object in the market.
```

```
CLAIM: No other vendor moved. Across the six days after the original report, Claude Code shipped eight
       releases, Codex a stable minor plus alphas, Gemini CLI a stable release, OpenCode 30 builds and
       Cline four — and not one entry concerns project continuity.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: Claude Code v2.1.265 (2026-09-08) through v2.1.272 (2026-09-14), eight npm publishes. Grepping
  that whole window for memory/ledger/decision/continuity yields exactly one relevant line, in v2.1.268:
  "Improved the MEMORY.md truncation warning to say how many lines were cut and where the cut starts."
  The Week 37 digest (September 7-11, 2026, v2.1.263-v2.1.269) headlines `claude plugin eval`. Searching
  the entire 387-version Claude Code changelog for "ledger", "abandoned approach", "unfinished",
  "half-done", "decision log" and "decision record" returns zero hits. Codex CLI 0.154.0 (2026-09-09)
  headlines GPT-6-Astra availability and "Experimental worktree support... then browse and resume them";
  its SDK note is explicit that resume history selection is presentational — "History selection changes the
  returned response, not model context." Gemini CLI 0.59.0 (2026-09-08) is three security fixes (MCP OAuth
  SSRF, fail-closed workspace trust, restricted-mode MCP filtering). OpenCode reached 1.18.31 (2026-09-14).
  Aider's repository `pushed_at` is still 2026-05-22 — unchanged from the original report, now 3.8 months
  stalled, while its star count rose from 48,832 to 48,966.
SOURCE: npm registry metadata for @anthropic-ai/claude-code, @openai/codex, opencode-ai and
  @google/gemini-cli ; Claude Code CHANGELOG.md ; What's new Week 37 —
  https://code.claude.com/docs/en/whats-new/2026-w37.md ; Codex changelog —
  https://learn.chatgpt.com/docs/changelog ; Gemini CLI changelog —
  https://geminicli.com/docs/changelogs/latest/ ; https://api.github.com/repos/Aider-AI/aider — all
  accessed 2026-09-14/15
COUNTEREVIDENCE: Six days is a short window, and absence of a changelog line is not absence of work in
  progress; Cursor Projects itself would have been invisible to this method on 2026-09-09. The claim is
  about shipped state, not roadmaps.
OPEN QUESTION: none — this is a direct observation, and it should simply be re-run monthly.
```

```
CLAIM: The one continuity primitive that did move cross-vendor in this window is the *conversational
       summary* — Cline now summarises imported Claude Code, Codex and OpenCode histories on first resume —
       which confirms that the portable unit of continuity in 2026 is a summary, not a ledger.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: Cline SDK v0.0.83, published 2026-09-15T05:53:27Z, verbatim: "Sessions imported from Claude
  Code, Codex, or opencode now summarize the foreign history on first resume rather than replaying tool
  calls the current agent cannot make. The summary is persisted so it runs once, the canonical transcript
  is left intact, and a failed attempt falls back to the raw history. Imported sessions also record an
  import origin that is stamped on their telemetry, and resuming a session no longer overwrites stored
  import or automation provenance with a default 'user' origin." This is the fourth vendor-to-vendor import
  path this lane has documented (Codex `/import`, Cursor reading `.claude/`, Copilot reading
  `.claude/skills`, now Cline importing three competitors' sessions) and the first that moves
  *conversations* rather than *configuration*.
SOURCE: cline/cline releases, tag `sdk/sdk/v0.0.83` — Cline — 2026-09-15 —
  https://api.github.com/repos/cline/cline/releases — accessed 2026-09-15
COUNTEREVIDENCE: This is arguably evidence *for* a ledger being valuable: the reason foreign history must
  be summarised is that a raw transcript is not a portable representation of state ("replaying tool calls
  the current agent cannot make"). A structured ledger would import losslessly. The feature therefore both
  proves the summary is the current unit and demonstrates why it is the wrong one.
OPEN QUESTION: If four vendors now read each other's session state, is a de facto interchange format
  emerging? None of the four documents a schema; all four appear to convert into their own.
```

---

### S6. The gap is no longer unserved — it is served by an Apache-2.0 commodity

This is the finding that most changes the original report's strategic reading, and it argues *against* this
lane's own §9 conclusion.

```
CLAIM: A cross-vendor, hook-driven, typed project-decision ledger already exists as open source, works on
       at least seven agents including all the incumbents, and is one of the most-starred repositories in
       this market — so the §8-point-2 gap is a gap in *vendor* products, not in the field.
LABEL: OBSERVED TODAY
CONFIDENCE: medium
EVIDENCE: `thedotmack/claude-mem` (rebranded "Grok Mem"; package name unchanged), Apache-2.0, created
  2025-08-31, last push 2026-09-13, 93,953 stars — against Aider's 48,966 and SWE-agent's 20,285.
  Self-description: "Persistent Context Across Sessions for Every Agent - Captures everything your agent
  does during sessions, compresses it with AI, and injects relevant context back into future sessions.
  Works with Claude Code, OpenClaw, Codex, Gemini, Hermes, Copilot, OpenCode + More." Architecture from its
  README: "5 Lifecycle Hooks - SessionStart, UserPromptSubmit, PostToolUse, Stop, SessionEnd"; "SQLite
  Database - Stores sessions, observations, summaries"; "Chroma Vector Database - Hybrid semantic + keyword
  search"; four MCP tools in a three-layer retrieval pattern (`search` -> `timeline` -> `get_observations`).
  Critically, it carries a typed observation vocabulary that includes `decision` — "needle observations
  (`decision`, `bugfix`, `security_alert`, `sensitive`) are appended as dated `- YYYY-MM-DD [awareness] ...`
  lines" — i.e. a dated decision log, which no first-party system ships. A web search that surfaced it also
  named Mnemos, Memorix and AgentHelm as MCP servers positioning on the same job ("architecture decisions,
  bug root causes, project conventions"), so this is a populated category rather than one project.
SOURCE: thedotmack/claude-mem repository metadata and README — last push 2026-09-13 —
  https://api.github.com/repos/thedotmack/claude-mem and
  https://raw.githubusercontent.com/thedotmack/claude-mem/main/README.md — accessed 2026-09-15 ; category
  context from web search naming Mnemos, Memorix, AgentHelm — accessed 2026-09-15 (secondary, UNVERIFIED)
COUNTEREVIDENCE: Three serious ones. (1) Stars measure attention, not adoption or correctness; a
  93,953-star count on a repo created 12.5 months ago is extraordinary and could not be corroborated with
  an independent usage metric this pass. (2) Its mechanism is transcript mining — "Captures everything your
  agent does during sessions, compresses it with AI" — the same derived-summary approach the vendors use,
  with a richer index; it is not an *authored* ledger with acceptance status, and an observation typed
  `decision` by an extraction model is not the same thing as a recorded decision with rationale. (3) It is
  built on hooks and MCP, both already classified COMMODITY here, so it inherits their portability and
  their fragility when a vendor changes a hook contract. Only the three named competitors were found by a
  single search; Mnemos, Memorix and AgentHelm were not verified directly.
OPEN QUESTION: Is any of these layers actually *used* at scale, and does any measurably improve an agent's
  behaviour after a long gap? No benchmark evaluates cross-session recovery, so the entire category is
  unfalsified — which is what one would expect of a category whose value is asserted rather than measured.
```

---

### S7. Contradictions with common belief (this wave)

**1. "Agent memory means the agent remembers your project."**
Read the docs and it means close to the opposite. Claude Code's memory explicitly "skips anything it can
derive from the codebase, such as architecture, file paths, or debugging fixes". Codex's memories are a
user-global store under `~/.codex/memories/` with no documented project scoping, containing "summaries,
durable entries, recent inputs, and supporting evidence from prior chats". Gemini CLI's Auto Memory targets
"procedural patterns that **recur across sessions**". All three are optimised for *repeated* facts. A
half-finished migration is by definition non-recurring, non-derivable and unique — the exact shape of fact
every one of these memory systems is designed to filter out.

**2. "The state is preserved; you just have to resume the session."**
On Claude Code the session transcript, the plan file, the task list, the subagent transcripts and the
checkpoint snapshots are all deleted at 30 days by default. On Codex, threads older than 30 days stop
feeding memory generation and memories unused for 30 days stop being consolidated. On Aider, the history
file is written into your repository and then *not loaded* — `--restore-chat-history` defaults to `False`.
The default posture of this industry is to forget, and it is documented on pages about disk hygiene and
privacy rather than on pages about memory.

**3. "Cursor has memories."** — this lane said so on 2026-09-08 and it is no longer supportable.
`cursor.com/docs/memories.md` and `cursor.com/docs/context/memories.md` both 404; the string "memor" does
not occur anywhere in `cursor.com/llms.txt` except one line in `rules.md`, which says models *lack* memory:
"Large language models don't retain memory between completions. Rules provide persistent, reusable context
at the prompt level." Cursor's documented answer to "what did I leave half-done" is now full-text search —
"Cursor builds a local search index that scales to thousands of conversations" — plus `@Chats` to pull a
prior conversation in by hand. This is the second time Cursor has silently retired a capability this lane
tracked (codebase indexing was the first, §7.3), and the pattern deserves a name: **Cursor deletes the
documentation for features it is de-emphasising rather than deprecating them loudly.** Any competitive map
built from Cursor's docs has a short half-life, including this one.

**4. "A new entrant could win on cross-session state."**
That was this lane's own closing recommendation on 2026-09-08, and this wave weakens it. The best
decision-log design in the market is a copy-paste prompt template whose vendor advertises that it "works
with any AI that can read docs". The most popular implementation is Apache-2.0 with ~94k stars, built
entirely on hooks and MCP — two capabilities this lane already classified COMMODITY. And the second-largest
incumbent shipped a beta of it within two days of this lane declaring the space empty. The *problem* is
real; the *moat* around it looks no better than the moats around skills or hooks.

---

### S8. Problems nobody is talking about (this wave)

**1. Project continuity and transcript hygiene are in direct conflict, and hygiene has already won.**
Claude Code's retention page recommends *lowering* `cleanupPeriodDays`, in a section headed "Plaintext
storage": "Transcripts and history are not encrypted at rest... If a tool reads a `.env` file or a command
prints a credential, that value is written to `projects/<project>/<session>.jsonl`." The same sweep that
protects you from a leaked credential destroys your plan file and your task list. Nobody has proposed
separating the two policies — a durable, derived, redacted state store with a long horizon, alongside a
short-lived raw transcript. The retention knob is single-valued, and it is pointed at security.

**2. Every system's continuity unit is the conversation; none is the repository.**
Codex: "Each chat keeps its own context, messages, results, and goal", and "Codex CLI treats the directory
where you start it as the project for the chat... The CLI doesn't expose the ChatGPT Projects view."
OpenCode: sessions only, no memory feature anywhere in the docs index. Gemini CLI: `/resume` browses
conversations. Cursor: search across transcripts. Cline: task history with per-task resume. The repository
— the thing that actually persists, that the team shares, that outlives every session — is a *lookup key*
for conversations in all seven, never a first-class carrier of state. Claude Code comes closest (its
auto-memory directory is keyed by git repository and shared across worktrees) and still stores it in
`~/.claude`, machine-local, with the docs stating plainly: "Files are not shared across machines or cloud
environments." **Project state is per-developer-per-machine everywhere in this market.** A teammate
inherits none of it, and neither does your own second laptop.

**3. Freshness is timestamped but never validated.**
Claude Code is alone in stamping facts with a `modified` ISO 8601 time so that "the timestamp shows how
current the fact is". Nothing anywhere connects a stored fact to repository evidence. No system records
"this note refers to `src/auth.ts@abc123`, which has since changed 14 times", or "the test this decision
cited now passes", or "the branch this plan targeted was merged in June". Git is sitting right there
already holding the invalidation signal, and no memory system reads it. Staleness is treated as a function
of clock time when it is plainly a function of code change.

**4. The completion predicate is stored in the most volatile place available.**
Codex's `/goal` makes the goal text "both the first prompt and the completion criteria", and its guidance
asks for "Verification: Add tests, measurements, or review criteria that prove the work is complete".
Claude Code restores an active goal on resume but "resets the turn count, timer, and token-spend baseline",
and the goal lives inside a session transcript the sweep deletes at 30 days. So the one artefact in this
whole market that states *what done means* — the closest thing to an acceptance predicate any of these
systems produce — has the shortest lifetime of anything they persist. Preferences outlive it. Typed
prompts outlive it. The definition of done does not.

**5. Nobody can measure any of this, including the vendors.**
Claude Code's auto memory is machine-local by design; Codex's lives under `~/.codex` as "generated state"
users are told not to hand-edit; Gemini CLI's inbox is local and human-gated. No telemetry crosses the
boundary, so no vendor can answer "how often does a `project` note help a resumption three months later",
and no benchmark in §4's list — SWE-bench Pro, Terminal-Bench 4.0, SWE Atlas, SWE-Cycle, SWE-EVO,
ChainSWE — contains a task that resumes anything. ChainSWE comes closest and holds the scaffold fixed by
design. **The most-cited failure mode in this lane (48% of downstream failures caused by accumulated
state) has no evaluation that exercises a resumption at all.**

---

### S9. Revised classification

Two rows of §3's commodity map change, and two new rows are added.

| Capability | Was (2026-09-08) | Now (2026-09-14) | Why |
|---|---|---|---|
| Procedural / auto memory | COMMODITY | **COMMODITY (confirmed, and narrower than believed)** | Five of seven ship something (Claude Code on by default; Codex off by default; Gemini CLI experimental and off; Cline as methodology; Cursor now undocumented). All target recurring facts with derivable content excluded. Cursor's removal shows it is commoditised to the point of being retractable. |
| Cross-session / accumulated-state management | DIFFERENTIABLE — open, "nobody" | **CONTESTED — no longer empty** | Cursor Projects (2026-09-10, beta, cloud-first); Cline Memory Bank (methodology, portable by the vendor's own statement); claude-mem/Grok Mem (Apache-2.0, ~94k stars, cross-vendor via hooks + MCP, typed `decision` observations). |
| *(new)* Project-state retention policy | — | **UNSERVED** | Every system has exactly one retention knob, defaulted for privacy (30 days on Claude Code and Codex), sweeping plans and task lists along with raw transcripts. No system separates derived project state from raw transcript retention, and the conflict is documented on the vendor's own page. |
| *(new)* Evidence-based staleness invalidation | — | **UNSERVED / RESEARCH-STAGE** | One system stamps write time (`modified`, Claude Code v2.1.214, 2026-07-18). None invalidates a stored fact against git history, test results, or code change. |

The honest net effect on this lane's answer to "what should a new company not build": **"a memory feature"
was already on the do-not-build list and stays there, more firmly.** "Cross-session project state" moves off
the clean-differentiator list and onto a watch list — the *problem* is real and unsolved, but a beta from
the second-largest incumbent and a 94k-star Apache-2.0 implementation both arrived before this lane finished
describing it. What remains genuinely unserved is narrower and less glamorous than "memory": a retention
policy that distinguishes derived state from raw transcripts, and an invalidation mechanism driven by
repository evidence rather than a clock.

---

### S10. Open questions for a third wave

12. **Does Cursor Projects' shared-context file set have an exportable schema?** If yes, it is another
    portable commodity; if it is opaque and cloud-only, it is the first non-portable artefact this lane has
    found and it contradicts §8 point 7. Settle it once a Projects docs page exists.
13. **What actually survives a 90-day gap, measured rather than read?** Nobody has run the experiment: work
    for a week on one repository in each of the seven, wait past every documented horizon, resume, and
    score what the agent can still tell you about the in-flight work. Cheap, falsifiable, and it would be
    the first empirical data in a field currently arguing entirely from documentation.
14. **Is claude-mem's ~94k star count real adoption?** Corroborate with npm download counts or independent
    telemetry. If it is, the most popular artefact in the coding-agent ecosystem is a third-party memory
    layer, which is a market signal nobody has written up.
15. **Would git-evidence invalidation beat timestamp staleness?** The primitive is trivial (store the blob
    SHA a note depends on; flag the note when it changes) and nobody ships it. If it works it belongs in
    the "stays hard" column; if it does not, that is a useful negative result for lane 11.
16. **Why did Cursor delete its memories documentation?** Deprecation, rename, absorption into Projects, or
    quiet failure? The answer decides whether "agent memory" is commoditising or actually *retreating*,
    which are opposite strategic signals. Compare against the codebase-indexing precedent.
17. **Is a session-interchange format emerging?** Codex `/import`, Cursor reading `.claude/`, Copilot
    reading `.claude/skills`, and now Cline summarising foreign Claude Code / Codex / OpenCode histories.
    Four vendors read each other's state and none documents a schema. If a de facto format is forming,
    whoever writes down its spec captures the position `agentskills.io` captured for skills.
