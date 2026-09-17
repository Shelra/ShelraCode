# Lane 14 — Sources (memory security)

All accessed **2026-09-14** unless stated. `UNVERIFIED` means single-source, not independently
corroborated, or fetch-limited (headline/excerpt only).

---

## A. Documented exploits / vendor security disclosures

| # | Title | Org / Author | Date | URL | Evidences |
|---|---|---|---|---|---|
| A1 | Spyware Injection Into Your ChatGPT's Long-Term Memory (SpAIware) | Johann Rehberger, Embrace The Red | 2024-05 through 2024-09 patch | https://embracethered.com/blog/posts/2024/chatgpt-macos-app-persistent-data-exfiltration/ | First documented persistent-memory prompt-injection exploit; OpenAI patch v1.2024.247, Sept 2024 |
| A2 | ZombAI: beaconing agent via ChatGPT memory persistence | Johann Rehberger | 2025-01 | referenced via search; not independently re-fetched | First full beaconing-agent implementation exploiting memory persistence |
| A3 | Hacking Google Gemini's Memory with Prompt Injection and Delayed Tool Invocation | embracethered.com | 2025 | https://embracethered.com/blog/posts/2025/gemini-memory-persistence-prompt-injection/ | "Fake Context Alignment" persistent memory poisoning across Workspace account; Google fix confirmed 2025-11-14 |
| A4 | New Google Gemini Vulnerability Exploited via Prompt Injections from WhatsApp, Slack, and SMS | Cyber Security News | 2025 | (search result, title only re-verified) | SafeBreach Labs research summary; multi-device blast radius; recurring-task surveillance capability |
| A5 | EchoLeak: The First Real-World Zero-Click Prompt Injection Exploit in a Production LLM System (CVE-2025-32711) | arXiv (independent researchers) | 2025-09 | https://arxiv.org/abs/2509.10540 | Zero-click, single-session (non-persistent) boundary case; CVSS 9.3; Aim Security original disclosure June 2025 |
| A6 | Identifying and remediating a persistent memory compromise in Claude Code | Cisco Blogs | 2026 (references Claude Code v2.1.50, 2026-04-01) | https://blogs.cisco.com/ai/identifying-and-remediating-a-persistent-memory-compromise-in-claude-code | MEMORY.md postinstall-hook poisoning chain; Anthropic's fix (removed user memories from system prompt) — **UNVERIFIED against a second publication** |
| A7 | MCP Security Notification: Tool Poisoning Attacks | Invariant Labs | 2025-04 | https://invariantlabs.ai/blog/mcp-security-notification-tool-poisoning-attacks | First public PoC of MCP tool-description poisoning; exfiltration without user interaction |
| A8 | CVE-2026-30615: Windsurf Zero-Click MCP Prompt Injection RCE | OX Security / GitHub Advisory Database (GHSA-wj2m-jvpr-64cq) | 2026 | https://github.com/advisories/GHSA-wj2m-jvpr-64cq | Persistent-config (mcp.json) boundary case; CVSS 8.0; zero-click via opened file |
| A9 | Snyk Finds Prompt Injection in 36%, 1467 Malicious Payloads in a ToxicSkills Study of Agent Skills Supply Chain Compromise | Snyk | 2026-02 (scan date 2026-02-05) | https://snyk.io/blog/toxicskills-malicious-ai-agent-skills-clawhub/ | 3,984 skills scanned; 13.4% critical issues; 36% prompt injection; 1,467 malicious payloads; mcp-scan released |
| A10 | Mixpanel security incident affecting some ChatGPT users | OpenAI | 2025-11 | https://openai.com/index/mixpanel-incident/ | Account-level breach, not memory-write-path leak; used as contrast in §4 |

## B. Peer-reviewed / preprint literature

| # | Title | Org / Author | Date | URL | Evidences |
|---|---|---|---|---|---|
| B1 | Memory Injection Attacks on LLM Agents via Query-Only Interaction (MINJA) | Dong, Xu, He, Li, Tang, Liu, Liu, Xiang | 2025-03-05, rev. 2026-02-12 | https://arxiv.org/abs/2503.03704 | 98.2% avg injection success; query-only, no write access needed; bridging-step + progressive-shortening mechanism |
| B2 | AgentPoison: Red-teaming LLM Agents via Poisoning Memory or Knowledge Bases | (2024-07) | 2024-07 | https://arxiv.org/abs/2407.12784 | Backdoor via few poisoned demonstrations, no fine-tuning; optimized trigger in embedding space; tested on driving/QA/healthcare agents |
| B3 | When Claws Remember but Do Not Tell: Stealthy Memory Injection in Persistent Personal Agents (MemGhost) | Zhang, Zhao, Zhang, Zhang, Deng, Liu, Xiao, Zhang | 2026-07-06 | https://arxiv.org/abs/2607.05189 | 87.5% (OpenClaw/GPT-5.4) / 71.4% (Claude Code SDK/Sonnet 4.6) end-to-end success from one email; transfers across NanoClaw, Hermes Agent, filesystem and Mem0 backends |
| B4 | Hidden in Memory: Sleeper Memory Poisoning in LLM Agents | Pulipaka, Hlebik, Raghav, Abdelnabi, Raina, Sheth, Fritz | 2026-05-14, rev. 2026-05-18 | https://arxiv.org/abs/2605.15338 | Delayed-activation memory poisoning distinct from prompt injection; 99.8% (GPT-5.5) / 95% (Kimi-K2.6) memory-injection rate; 60-89% intended-action rate among successful retrievals |
| B5 | MemSecBench: Tracking Agent Memory Poisoning from Persistence to Consequence and Repair | Chen, Xie, Fu, Zhou, Yu, Xuan (Zhejiang Univ. of Technology) | 2026-07-29 | https://arxiv.org/html/2607.27080v1 | 310-case benchmark; 7-checkpoint lifecycle taxonomy (write/execute/forget stages); MPSR 84.2%, E2E-ASR 50.3%; "no memory backend is uniformly safer"; 30-point benign-preservation repair gap |
| B6 | STALE: Can LLM Agents Know When Their Memories Are No Longer Valid? | Chao, Bai, Sheng, Li, Sun | 2026-05-07 | https://arxiv.org/abs/2605.06527 | Best-model 55.2% accuracy on implicit-conflict staleness detection; 400 scenarios / 1,200 queries; three-dimension probing framework (State Resolution, Premise Resistance, Implicit Policy Adaptation) |
| B7 | Governed Shared Memory for Multi-Agent LLM Systems (MemClaw / ArgusFleet) | Margalit, Cohen-Inger, Avram, Taig, Margalit | 2026-06-23 | https://arxiv.org/html/2606.24535v1 | Deployed multi-tenant memory service with trust tiers (agent-local/team/tenant/restricted); disclosed and remediated a real cross-tenant GET-by-id leak during its own evaluation |
| B8 | Contextual Agentic Memory is a Memo, Not True Memory | (authors not independently re-verified beyond search excerpt) | 2026-04 | https://arxiv.org/abs/2604.27707 | Argues current agent "memory" implements lookup, not weight-based consolidation; names structural vulnerability to persistent poisoning as a direct consequence of the lookup architecture |
| B9 | Agent Skills Enable a New Class of Realistic and Trivially Simple Prompt Injections | Schmotz, Abdelnabi, Andriushchenko | 2025-10-30 | https://arxiv.org/abs/2510.26328 | Skills as a reusable/persistent injection mechanism; "Don't ask again" approval-bypass finding |
| B10 | Agentic Memory Poisoning & Integrity Vulnerabilities (CWE-AGNT-005) | Cloud Security Alliance | 2026-03-27 (draft) | https://labs.cloudsecurityalliance.org/agentic/csa-research-note-cve-cwe-agentic-catalog-20260327/ | Proposed CWE extension for memory poisoning; maps to OWASP ASI06 and MITRE ATLAS AML.T0031; mitigation list (access control, integrity protection, human review before privileged shared-memory writes) |

## C. Standards bodies, frameworks, taxonomies

| # | Title | Org | Date | URL | Evidences |
|---|---|---|---|---|---|
| C1 | OWASP Top 10 for Agentic Applications | OWASP GenAI Security Project | 2025-12-09 | https://genai.owasp.org/2025/12/09/owasp-top-10-for-agentic-applications-the-benchmark-for-agentic-security-in-the-age-of-autonomous-ai/ | Full ASI01-ASI10 list; ASI06 = "Memory & Context Poisoning" ("Gemini Memory Attack" cited as example); ASI04 Agentic Supply Chain (MCP/A2A) |

## D. Vendor / official documentation

| # | Title | Org | Date | URL | Evidences |
|---|---|---|---|---|---|
| D1 | Memory tool | Anthropic, Claude Docs | accessed 2026-09-14 | https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool | Client-side architecture; explicit "Security considerations" section; verbatim quote on soft secret-refusal; path-traversal `<Warning>`; developer-owned expiration/size-cap responsibility |
| D2 | About GitHub Copilot Memory | GitHub Docs | accessed 2026-09-14 | https://docs.github.com/en/copilot/concepts/agents/copilot-memory | Repo/user/org three-tier scope model; write-access gating for repo-level facts; no explicit prompt-injection discussion (noted gap). **See methodological note below.** |
| D3 | Copilot Memory has more controls for deletion, scope, and the Copilot CLI | GitHub Changelog | 2026-05-26 | https://github.blog/changelog/2026-05-26-copilot-memory-has-more-controls-for-deletion-scope-and-the-copilot-cli/ | Admin/org-level review-delete-disable controls added post public-preview |
| D4 | Memory FAQ / Memory FAQ (Business Version) | OpenAI Help Center | accessed 2026-09-14 | https://help.openai.com/en/articles/8590148-memory-faq ; https://help.openai.com/en/articles/9295112-memory-faq-business-version | Per-account, project-scoped isolation; workspace admin controls; memory disabled by default in Healthcare/Regulated Workspace |
| D5 | Secret Detection/Redaction (Enterprise-only) | LiteLLM docs | accessed 2026-09-14 | https://docs.litellm.ai/docs/proxy/guardrails/secret_detection | Gateway-layer secret redaction, opt-in, enterprise tier |
| D6 | PII and secrets redaction | LangChain / LangSmith docs | accessed 2026-09-14 | https://docs.langchain.com/langsmith/llm-gateway-redaction | Gateway-layer redaction, distinct from agent's own memory-write path |
| D7 | AI Memory Security: Best Practices and Implementation | Mem0 | accessed 2026-09-14 | https://mem0.ai/blog/ai-memory-security-best-practices | Vendor best-practice guidance (encryption at rest, RBAC, trust-scored retrieval) — advisory, not a platform guarantee |

## E. Practitioner / community / secondary analysis

| # | Title | Author / Org | Date | URL | Evidences |
|---|---|---|---|---|---|
| E1 | New MemGhost Attack Plants Persistent False Memories in AI Agents Through One Email | The Hacker News | 2026-07-13 | https://thehackernews.com/2026/07/new-memghost-attack-plants-persistent.html | Secondary summary of B3, incl. OpenClaw vendor response quote |
| E2 | Advanced LLM security: Preventing secret leakage across agents and prompts | (security vendor blog, via Security Boulevard) | 2025-12 | https://securityboulevard.com/2025/12/advanced-llm-security-preventing-secret-leakage-across-agents-and-prompts/ | Practitioner-level secret-scrubbing pattern description (regex + entropy) |
| E3 | Persistent Agent Memory Needs Write Authorization, Not Just Safety Screening | Zylos Research | 2026-09-11 | https://zylos.ai/research/2026-09-11-persistent-agent-memory-write-authorization/ | Independent research note arguing for provenance/quarantine/use-time-check architecture; evidence that this idea is not yet mainstream (single small-shop blog, three days before cutoff) |
| E4 | Improve memory Write Gate review flow (PR #44966) / Make memory Write Gate approvals explicit and staged (issue #44963) | NousResearch/hermes-agent (GitHub) | 2026 | github.com/NousResearch/hermes-agent | Only concrete shipped-adjacent (open-source, in-progress) implementation of a human-approval gate specifically for memory writes found in this search |
| E5 | He Turned Off ChatGPT's Memory. It Referenced Another Client Anyway. | smithstephen.com | accessed 2026-09-14 | (URL via search result) | **UNVERIFIED** — single anecdotal report of possible cross-context memory bleed, no reproduction, not corroborated |
| E6 | State of AI Agent Memory 2026: Benchmarks & Trends Report | Mem0 | 2026 | https://mem0.ai/blog/state-of-ai-agent-memory-2026 | Background/context only; vendor market report, not independently verified data |

## F. This session's own observation

| # | Description | Date | Note |
|---|---|---|---|
| F1 | A WebFetch tool-result payload (nominally content of source D2, the GitHub Copilot Memory docs page) returned, appended after the genuine extracted content, a block imitating this harness's own system-reminder format — including an altered user email address and a fabricated persistent-memory entry not present in this session's actual memory. | 2026-09-14/15 | Not acted on. Recorded as a first-hand finding directly on this lane's topic (see lane report §2). Origin (fetched page vs. pipeline artifact vs. deliberate test) not determined from within the session; not attributed to GitHub's actual documentation. |

---

## Tally

- **Sources listed:** 32 (10 exploit/disclosure, 10 preprint/academic, 1 standards, 7 vendor docs,
  6 practitioner/secondary, 1 first-hand session observation)
- **UNVERIFIED or single-source-only:** A6 (Cisco — single publication), A2/A4 (title-level
  re-verification only, not re-fetched in full), E3 (small independent shop, very recent),
  E5 (single anecdotal blog post, not corroborated)
- **Method note:** Discovery performed via WebSearch and WebFetch only (no arXiv-search skill
  invocation was needed given WebSearch's date-aware results were sufficient for this lane's
  2025-2026 window). No lane 11/12/13 output was consulted per instructions; provenance/trust-tier
  concepts referenced above (MemClaw's tiers, CSA's CWE proposal) were sourced independently and
  stress-tested adversarially, not taken from another lane's taxonomy work.
