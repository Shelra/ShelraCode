# Lane 14 — Memory poisoning and long-horizon memory security

**Date:** 2026-09-14/15 · **Role:** adversarial security research · **Scope:** the attack surface
introduced specifically by *persistent* agent memory, as distinct from single-session prompt
injection. Extension lane, parallel to 11 (memory taxonomy) and 13 (context retrieval); does not
reopen the selected thesis in `docs/future-research/08_SELECTED_THESIS.md`.

---

## 1. Summary (10 lines)

Persistent memory converts a one-turn prompt-injection bug into a standing compromise: once
malicious content is written to a memory file, vector store, or skill, it survives context resets,
new sessions, and — in several documented cases — propagates across devices, projects, or tenants
without the attacker touching the system again. This is not hypothetical: OpenAI patched a
ChatGPT memory-persistence exploit in September 2024 (SpAIware), Google confirmed a fix for a
Gemini long-term-memory attack in November 2025, and a July 2026 paper (MemGhost) demonstrates an
87.5%/71.4% success rate planting false persistent memories in OpenClaw and Claude Code SDK agents
from a single email, using exactly the MEMORY.md/AGENTS.md loading pattern this repository itself
uses. Query-only attacks (MINJA, AgentPoison) show an attacker need not even hold write access to
the memory store — retrieval similarity alone is the exploitable surface. Secret retention is
real in principle but thinly evidenced in practice: Anthropic's own memory-tool documentation
states plainly that redaction is the *developer's* responsibility and that the platform's only
built-in control is that "Claude usually refuses" — a soft, model-judgment gate, not an enforced
one — and no documented case of a secret round-tripping out of persistent agent memory (as opposed
to a session leak or account breach) was found. Cross-project/tenant scoping is shipped in at
least two products (GitHub Copilot Memory, the MemClaw research system) but the one system with a
published trust-tier design still leaked cross-tenant memories through a GET-by-id endpoint during
its own evaluation. Stale security-relevant memory is measured only indirectly: the STALE
benchmark finds the best model correctly detects an invalidated belief only 55.2% of the time, with
no security-specific replication found. The single most direct architectural fix in this space — a
mandatory human approval gate before any autonomous memory write — exists only in a hobbyist
open-source PR thread and one independent researcher's blog post as of the cutoff, not in any major
vendor's shipped product.

---

## 2. Memory poisoning mechanics, with evidence/examples

The mechanics split into three attacker postures: (a) direct write access to the memory
store/config file via a supply-chain or file-system vector, (b) indirect injection via content the
agent legitimately fetches (email, web page, MCP tool output, repository file) that the agent then
summarizes into memory on the victim's behalf, and (c) query-only injection that never touches the
write path at all, only the retrieval/similarity path.

```
CLAIM: ChatGPT's 2024 memory feature could be permanently poisoned via prompt injection from an
untrusted web page, causing continuous data exfiltration across all future sessions from a single
interaction.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: Johann Rehberger (Embrace The Red) discovered in May 2024 that prompt injection from
untrusted content could insert persistent instructions into ChatGPT's long-term memory; a full
end-to-end exploit chaining memory injection with image-based exfiltration was demonstrated in June
2024; OpenAI patched it in ChatGPT v1.2024.247, September 2024, adding `url_safe` validation. The
researcher's own assessment: this does not fully prevent injected content from being written to
memory, only the exfiltration channel that made it visible.
SOURCE: "Spyware Injection Into Your ChatGPT's Long-Term Memory (SpAIware)" — Johann Rehberger,
Embrace The Red — 2024-09 (updated) — https://embracethered.com/blog/posts/2024/chatgpt-macos-app-persistent-data-exfiltration/ — accessed 2026-09-14
COUNTEREVIDENCE: The specific exfiltration vector (invisible markdown images) was closed; Rehberger
notes the underlying memory-injection primitive was not eliminated, only one exploitation path.
OPEN QUESTION: Has any vendor since 2024 shipped a memory-write gate that blocks *content*, as
opposed to blocking one exfiltration channel after the fact?
```

```
CLAIM: A single crafted email can plant a false persistent memory in an open-source personal agent
and in Claude Code SDK-based agents, with the memory surviving into unrelated future conversations
and the planted content concealed from the user in the agent's visible reply.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: MemGhost (Zhang et al., arXiv:2607.05189, submitted 2026-07-06) trains a one-shot
payload-generation policy (environment proxy + rubric-based reward, SFT+RL) to produce email
payloads that induce memory adoption while remaining conversationally stealthy. Reported
end-to-end success: 87.5% against OpenClaw on GPT-5.4, 71.4% against Claude Code SDK agents on
Sonnet 4.6; the attack transfers across architectures (NanoClaw, Hermes Agent) and across memory
backends (filesystem and vector-based Mem0). The paper explicitly targets the pattern where "a
single write is loaded into every later session instead of waiting to be pulled from a separate
memory store" — i.e., files like MEMORY.md/AGENTS.md read directly into the system prompt at
session start.
SOURCE: "When Claws Remember but Do Not Tell: Stealthy Memory Injection in Persistent Personal
Agents" — Yechao Zhang, Shiqian Zhao, Jiawen Zhang, Jie Zhang, Gelei Deng, Xiaogeng Liu, Chaowei
Xiao, Tianwei Zhang — 2026-07-06 — https://arxiv.org/abs/2607.05189 — accessed 2026-09-14
SOURCE: "New MemGhost Attack Plants Persistent False Memories in AI Agents Through One Email" —
The Hacker News — 2026-07-13 — https://thehackernews.com/2026/07/new-memghost-attack-plants-persistent.html — accessed 2026-09-14
COUNTEREVIDENCE: OpenClaw's vendor disputed the paper's test setup, stating its own guidance
recommends routing untrusted email through a separate agent stripped of memory and file tools, and
said it is "weighing memory-write controls for external content, including provenance, audit logs,
and confirmation prompts" — i.e. conceding the controls do not yet exist in the shipped product.
OPEN QUESTION: What is the success rate against an agent that *does* follow the untrusted-content
isolation pattern OpenClaw recommends? The paper's headline numbers are against default
configuration.
```

```
CLAIM: An attacker with no write access to an LLM agent's memory bank — only the ability to send
queries and observe outputs — can covertly implant malicious records that get retrieved as
few-shot demonstrations for other users' future queries, with a 98.2% average injection success
rate.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: MINJA (Dong, Xu, He, Li, Tang, Liu, Liu, Xiang; arXiv:2503.03704, submitted 2025-03-05,
latest revision 2026-02-12) uses "bridging steps" linking a victim's future query to injected
malicious reasoning, with an indication prompt progressively shortened so the poisoned record
survives similarity-based retrieval without the injection text itself being present at retrieval
time.
SOURCE: "Memory Injection Attacks on LLM Agents via Query-Only Interaction" (MINJA) — Dong et al. —
2025-03-05, rev. 2026-02-12 — https://arxiv.org/abs/2503.03704 — accessed 2026-09-14
COUNTEREVIDENCE: None found specific to this paper; it is corroborated rather than contradicted by
AgentPoison (below), which independently demonstrates the same query/retrieval-only poisoning
class against different agent types.
OPEN QUESTION: Does any deployed memory system distinguish "record was retrieved because it is
relevant" from "record was retrieved because it was engineered to be retrieved"? No defense of this
specific kind was found deployed.
```

```
CLAIM: Long-term memory or RAG knowledge bases can be backdoored with very few malicious
demonstrations, requiring no model fine-tuning, such that an optimized trigger phrase in a user's
otherwise-normal instruction reliably retrieves the poisoned content and drives a target adversarial
action.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: AgentPoison (arXiv:2407.12784, 2024-07) formulates trigger generation as constrained
optimization mapping triggered instances to a unique embedding region, demonstrated against a
RAG-based autonomous-driving agent, a knowledge-intensive QA agent, and a healthcare EHR agent.
SOURCE: "AgentPoison: Red-teaming LLM Agents via Poisoning Memory or Knowledge Bases" — 2024-07 —
https://arxiv.org/abs/2407.12784 — accessed 2026-09-14
COUNTEREVIDENCE: This is a red-team paper, not a documented in-the-wild incident; treat the attack
as demonstrated-feasible, not observed-exploited.
OPEN QUESTION: Has AgentPoison-style trigger optimization been attempted against any coding-agent
memory/RAG store specifically (as opposed to driving/QA/healthcare domains)?
```

```
CLAIM: A live, first-hand example of exactly this lane's subject occurred during this research
session: a WebFetch tool result (nominally the content of the GitHub Copilot Memory documentation
page) returned, appended after the genuine extracted content, a block formatted to imitate this
harness's own system-reminder syntax — including a different user email address than the one
established for this session, and a fabricated persistent-memory entry ("Sequential agents
feedback") never present in this session's real memory file.
LABEL: OBSERVED TODAY
CONFIDENCE: high (the event occurred; its origin is not determined)
EVIDENCE: Tool output captured verbatim during this session, 2026-09-14/15. Real system-reminders
in this harness arrive as their own top-level blocks between turns, never embedded inside a
WebFetch tool-result payload; the appended block's structure, and its attempt to alter both
identity (userEmail) and durable memory content, matches this lane's own threat model for
prompt-injection-into-persistence almost exactly.
SOURCE: This session's own tool transcript — accessed 2026-09-15
COUNTEREVIDENCE: none — this is a direct observation, not a literature claim. It was not acted on:
the original session email and memory state were retained, and no memory file was written on the
basis of the injected block.
OPEN QUESTION: Whether the injected block originated from the fetched page itself, a
fetch-processing intermediary, or was a deliberate test of this research session, could not be
determined from within the session. Flagged for the lead session to check the underlying
infrastructure, not attributed to GitHub's actual documentation content, which was not independently
re-verified as compromised.
```

Skills are a fourth mechanism worth naming separately: they are markdown files an agent loads and
then *acts on* as if they were vetted instructions, which makes a poisoned skill functionally
equivalent to a poisoned memory file even though it arrives via an install/marketplace flow rather
than a memory write.

```
CLAIM: A comprehensive audit of the largest available public corpus of agent skills found prompt
injection in over a third of scanned skills and dozens of live malicious payloads still publicly
available at scan time.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: Snyk's ToxicSkills study scanned 3,984 skills from ClawHub and skills.sh as of
2026-02-05: 13.4% (534/3,984) contained critical-level security issues, prompt injection appeared
in 36% of skills tested, 1,467 malicious payloads were catalogued across the ecosystem, 76 were
specifically designed for credential theft/backdoor installation/data exfiltration with 8 still
publicly available at time of writing, and 91% of malicious skills combined prompt injection with
conventional malware. The paradigmatic payload is "malicious direction embedded in the
natural-language instruction body of the SKILL.md itself," not an accompanying script.
SOURCE: "Snyk Finds Prompt Injection in 36%, 1467 Malicious Payloads in a ToxicSkills Study of
Agent Skills Supply Chain Compromise" — Snyk — 2026-02 — https://snyk.io/blog/toxicskills-malicious-ai-agent-skills-clawhub/ — accessed 2026-09-14
COUNTEREVIDENCE: Snyk released mcp-scan alongside the study as an open-source detector, showing at
least a partial, shipped, if opt-in, response exists.
OPEN QUESTION: What fraction of scanned skills were subsequently removed by ClawHub/skills.sh
moderation versus remaining live indefinitely?
```

---

## 3. Prompt-injection persistence — what makes it different from single-session injection

The crux distinction: single-session injection (e.g., EchoLeak) compromises one interaction and
ends when the session ends; persistence-class injection compromises a *storage medium* the agent
consults on every future interaction, so the attacker's one action keeps paying out without further
access. Three sub-properties recur across the evidence:

1. **No repeat access needed.** SpAIware, MemGhost, and the Gemini memory attack all require the
   attacker to act exactly once; the payload does the rest.
2. **Blast radius beyond the compromised session.** The Gemini attack is the sharpest example:
   because Gemini's long-term memory is tied to the whole Google Workspace account, a phone
   notification could poison behavior on the victim's tablet, computer, and smart speaker.
3. **Detection is harder than single-turn injection**, because the poisoned content no longer
   needs to resemble an injection at the moment it is *used* — only at the moment it was *written*,
   which may be sessions earlier and reviewed, if at all, by a different mechanism than whatever
   screens the live conversation.

```
CLAIM: Google confirmed and fixed a Gemini vulnerability in which indirect, delayed-tool-invocation
prompt injection (from WhatsApp/Slack/SMS notifications) could permanently corrupt Gemini's
long-term memory across a victim's entire Workspace account, including scheduling a recurring
surveillance task.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: SafeBreach Labs demonstrated "Fake Context Alignment" (hiding instructions in foreign
languages or muted hyperlinks) driving persistent memory poisoning and a daily recurring task
reading the victim's recent messages. Google confirmed on 2025-11-14 that updated content-classifier
improvements mitigated the indirect prompt injection and delayed-tool-invocation scenarios.
SOURCE: "Hacking Google Gemini's Memory with Prompt Injection and Delayed Tool Invocation" —
embracethered.com — 2025 — https://embracethered.com/blog/posts/2025/gemini-memory-persistence-prompt-injection/ — accessed 2026-09-14
SOURCE: "New Google Gemini Vulnerability Exploited via Prompt Injections from WhatsApp, Slack, and
SMS" — Cyber Security News — accessed 2026-09-14
COUNTEREVIDENCE: Google's fix (content classifiers) targets the injection *delivery*, not the
memory-write authorization boundary itself; whether the same content-classifier approach
generalizes to novel phrasing was not independently tested in the retrieved material.
OPEN QUESTION: What is the false-negative rate of Google's content classifier against injection
phrasing not represented in its training data?
```

```
CLAIM: A poisoned npm package's postinstall hook can rewrite Claude Code's MEMORY.md files —
loaded verbatim (first 200 lines) into the system prompt as trusted context — to make the agent
recommend insecure practices (e.g., committing API keys to source instead of using environment
variables) persistently across all subsequent projects and sessions, and to re-enable itself even
if the user disables memory loading.
LABEL: OBSERVED TODAY
CONFIDENCE: medium-high (single vendor security-blog source, not independently cross-verified
against a second publication)
EVIDENCE: Cisco's security blog documents the chain: npm lifecycle-hook code execution → memory
file rewrite → persistence via appended shell aliases that force memory re-enablement. Anthropic's
response, per the same post: Claude Code v2.1.50 (2026-04-01) "removed user memories from the
system prompt," and Anthropic's stated position is that the user principal is fully trusted, with
users responsible for vetting untrusted repository dependencies.
SOURCE: "Identifying and remediating a persistent memory compromise in Claude Code" — Cisco Blogs —
accessed 2026-09-14 — https://blogs.cisco.com/ai/identifying-and-remediating-a-persistent-memory-compromise-in-claude-code
COUNTEREVIDENCE: none found; this is a single vendor-blog source and should be treated as
UNVERIFIED-by-a-second-source even though the vendor (Cisco) and the specificity of the version
number (v2.1.50) are consistent with a real fix rather than marketing.
OPEN QUESTION: Does "removed user memories from the system prompt" mean memory content is no longer
trusted as instruction-equivalent, or only that it is loaded through a different channel that could
carry the same trust level under a different mechanism? The post does not say.
```

Two boundary cases sharpen what is and is not this lane's subject:

```
CLAIM: EchoLeak (CVE-2025-32711, CVSS 9.3), the first documented real-world zero-click prompt
injection with concrete data exfiltration in a production LLM system, is explicitly a
single-session vulnerability with no memory-persistence component — useful as the contrast case
for this lane.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: Aim Security disclosed the Microsoft 365 Copilot flaw in June 2025: a single crafted
email, no user interaction, chained XPIA-classifier evasion, markdown link-redaction bypass,
auto-fetched images, and a Teams-proxy CSP allowance to exfiltrate data within one Copilot
interaction. Microsoft patched server-side; no persistence mechanism is described.
SOURCE: "EchoLeak: The First Real-World Zero-Click Prompt Injection Exploit in a Production LLM
System" — arXiv:2509.10540 — 2025-09 — https://arxiv.org/abs/2509.10540 — accessed 2026-09-14
COUNTEREVIDENCE: none; included as scope-boundary evidence, not to attack the claim.
OPEN QUESTION: none — this is a clarifying contrast, not a contested claim.
```

```
CLAIM: CVE-2026-30615 (Windsurf IDE, CVSS 8.0) sits at the boundary between single-session
injection and memory persistence: a zero-click prompt injection from source files/comments/markdown
does not write to a "memory" store, but does durably rewrite the local mcp.json configuration file
to register an attacker-controlled MCP server — a persistent artifact functionally similar to
memory poisoning even though the field's own vocabulary would not call it that.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: OX Security's advisory: Windsurf 1.9544.26 processes injected text from opened files as a
directive, silently overwriting mcp.json and registering a malicious STDIO server with no approval
dialog and no user interaction beyond opening the project.
SOURCE: "CVE-2026-30615: Windsurf Zero-Click MCP Prompt Injection RCE" — OX Security / GitHub
Advisory Database GHSA-wj2m-jvpr-64cq — 2026 — https://github.com/advisories/GHSA-wj2m-jvpr-64cq — accessed 2026-09-14
COUNTEREVIDENCE: none found against the technical claim; the classification question (is a rewritten
config file "memory") is definitional, not evidential.
OPEN QUESTION: Should agent-config files (mcp.json, hook registrations, settings.json-equivalents)
be governed by the same write-gate proposals as memory files proper? No source addresses this
directly; it is treated here as an open question rather than assumed.
```

---

## 4. Secret retention risk and documented redaction mechanisms

The mechanism for a secret entering persistent memory is not in dispute: any system that summarizes
a transcript into a durable note can, in principle, capture a credential that appeared in that
transcript. What is thin is *evidence of it happening through the memory-write path specifically*,
as opposed to through account compromise, log exposure, or a developer pasting a key into a chat
that a human later reads. The strongest primary evidence found is Anthropic's own admission that
its shipped control is soft.

```
CLAIM: Anthropic's memory tool ships with only a model-judgment-based refusal against writing
sensitive information to persistent memory, and explicitly assigns the burden of enforced redaction,
path-traversal protection, and file-size/expiration limits to the developer implementing the storage
backend — none of these are enforced by the platform itself.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: Verbatim from Anthropic's own documentation, "Security considerations" section: "Claude
usually refuses to write sensitive information to memory files. For stronger guarantees, add
validation that strips sensitive data before your handler writes the file." The same page states
the memory tool "operates client-side: Claude requests file operations, and your application
executes them," and separately warns, under a hard `<Warning>` callout, that "a malicious path such
as `/memories/../../secrets.env` can reach files outside the `/memories` directory. Your
implementation must validate every path in every command."
SOURCE: "Memory tool" — Anthropic, Claude Docs — accessed 2026-09-14 — https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool
COUNTEREVIDENCE: Anthropic does provide reference SDK helpers (`BetaLocalFilesystemMemoryTool`) and
explicitly documents the path-traversal risk with concrete mitigation steps, which is more candor
than most vendors surveyed offer about their own defaults.
OPEN QUESTION: Has any independent red-team measured the actual refusal rate of "Claude usually
refuses" against realistic transcripts containing credentials, analogous to the omission-rate
numbers other lanes found for specification tasks? None was found.
```

```
CLAIM: Third-party LLM gateway/observability products (not the model vendors themselves) ship
opt-in secret detection and redaction as a proxy-layer feature, which is the most concrete "shipped"
mitigation found for this specific risk — but it sits outside the agent's own memory-write path and
must be separately integrated.
LABEL: OBSERVED TODAY
CONFIDENCE: medium
EVIDENCE: LiteLLM documents an enterprise-only "Secret Detection/Redaction" guardrail; LangChain's
LangSmith documents PII/secrets redaction at the gateway layer. Independent practitioner guidance
(Doppler) recommends "a session-end hook that writes episodic events running a regex-plus-entropy
scrubber in-process before anything touches disk," combining known-prefix matching (GitHub/AWS/LLM
provider key formats), structural matches (JWTs, connection strings), and a Shannon-entropy
catch-all (≥4.5 bits/char flagged as probable secret).
SOURCE: "Secret Detection/Redaction (Enterprise-only)" — LiteLLM docs — accessed 2026-09-14 —
https://docs.litellm.ai/docs/proxy/guardrails/secret_detection
SOURCE: "PII and secrets redaction" — LangChain / LangSmith docs — accessed 2026-09-14 —
https://docs.langchain.com/langsmith/llm-gateway-redaction
COUNTEREVIDENCE: These are gateway/proxy features guarding the *model call*, not the memory-write
call specifically; a secret could still be summarized into a durable note by an agent's own
memory-writing logic without ever passing back through the gateway that scans it.
OPEN QUESTION: Does any shipped product scan the *memory write payload itself*, as opposed to the
model's input/output stream generally? Not found in this search.
```

```
CLAIM: No documented, publicly reported case was found of a credential entering an agent's
persistent memory store and later being retrieved into an unrelated future session as the specific
exploitation vector — as opposed to account-level breaches (Mixpanel/OpenAI incident, November
2025) or a human directly reading a pasted secret in a single chat.
LABEL: absence of evidence, not evidence of absence — stated explicitly rather than left implicit
CONFIDENCE: medium
EVIDENCE: Search for "secret leaked into ChatGPT memory," "API key persistent memory incident," and
similar surfaced only (a) account-compromise incidents unrelated to the memory-write mechanism, and
(b) generic advice pages about not pasting secrets into chat interfaces, none of which document the
memory-retrieval step actually occurring.
SOURCE: multiple, see `research/sources/14-memory-security.md` §E — accessed 2026-09-14
COUNTEREVIDENCE: The mechanism is trivially constructible (see MINJA, AgentPoison, MemGhost above,
none of which require the secret to be a special case), so the absence is more likely
under-disclosure than infeasibility — vendors that patch memory bugs quietly, as Anthropic and
OpenAI both appear to have done, may not publish secret-specific case studies even when they occur.
OPEN QUESTION: Would a targeted red-team (plant a synthetic credential in a transcript, observe
whether a memory-summarization step captures it, across 2-3 shipped memory tools) close this gap
cheaply? This looks like exactly the kind of one-afternoon experiment lane 10's kill-test method
would recommend.
```

---

## 5. Cross-project/agent contamination boundaries and enforcement evidence

Two shipped products with explicit scoping and one research system with a formally designed
trust-tier model were found. The research system is the most instructive: it is the only one that
published a real, disclosed vulnerability in its own scoping enforcement.

```
CLAIM: GitHub Copilot Memory (public preview 2026-01-15, expanded controls 2026-05-26) scopes
memory facts to three explicit tiers — repository, user, and organization/enterprise — and gates
repository-level fact creation to users with write access to that repository, with repository
admins able to disable memory and review/delete stored facts.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: "Memories about a repository stay within that repository... Copilot only creates
repository-level facts in response to actions by users with write access to the repository who have
Copilot Memory enabled, and those facts can only be used in operations on the same repository."
Repository admins can disable Copilot Memory per-repo from repository settings.
SOURCE: "About GitHub Copilot Memory" — GitHub Docs — accessed 2026-09-14 —
https://docs.github.com/en/copilot/concepts/agents/copilot-memory
SOURCE: "Copilot Memory has more controls for deletion, scope, and the Copilot CLI" — GitHub
Changelog — 2026-05-26 — https://github.blog/changelog/2026-05-26-copilot-memory-has-more-controls-for-deletion-scope-and-the-copilot-cli/ — accessed 2026-09-14
COUNTEREVIDENCE: The documentation contains no explicit discussion of prompt-injection risk to the
memory-write path — the scoping model governs *who may trigger* a write (an authorized human user),
not *what content* an agent acting on that human's behalf might be induced to write from untrusted
fetched material. This is the same category gap identified as a cross-cutting problem in §9.
OPEN QUESTION: Has GitHub published or been the subject of any red-team analysis of whether
injected repository content (an issue, a PR description, a file) can cause a repo-scoped memory
fact to be written that then persists as if it were a legitimate project decision?
```

```
CLAIM: The one research system found with an explicit, published multi-tenant trust-tier design for
shared agent memory (agent-local / team-shared / tenant-global / restricted, with trust≥2 gating
cross-fleet reads) nonetheless shipped a real production vulnerability allowing agents to retrieve
fleet-scoped memories across tenant boundaries via an under-scoped GET-by-id endpoint, discovered
and disclosed during the authors' own adversarial evaluation.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: MemClaw (a deployed multi-tenant memory service, evaluated live via its REST API by the
authors' ArgusFleet harness) implements hierarchical scopes and provenance (derivation-chain
reconstruction, `derived_from` metadata, writer identity preserved through storage round-trips).
The paper reports: "the GET-by-id endpoint initially enforced only tenant-level scope, allowing
agents to retrieve fleet-scoped memories they shouldn't access. This gap was disclosed and
remediated during the study."
SOURCE: "Governed Shared Memory for Multi-Agent LLM Systems" — Margalit, Cohen-Inger, Avram, Taig,
Margalit — 2026-06-23 — https://arxiv.org/html/2606.24535v1 — accessed 2026-09-14
COUNTEREVIDENCE: The bug was found and fixed by the system's own authors before wide deployment,
which is a genuinely positive signal about the value of adversarial self-evaluation — but it is also
the strongest evidence in this whole lane that a formally designed trust-tier scheme does not imply
correct enforcement, only correct intent.
OPEN QUESTION: Is MemClaw in production use beyond the paper's own evaluation harness? Not
established from the retrieved material.
```

```
CLAIM: OpenAI's ChatGPT ships per-account and per-project memory isolation by default (project-only
memory ignores global memory and other projects; workspace admins can disable memory
org-wide; memory is disabled by default in ChatGPT for Healthcare and Regulated Workspace
configurations) — a shipped, documented boundary, contradicted by at least one unverified
practitioner anecdote of cross-client bleed.
LABEL: OBSERVED TODAY (the isolation feature); UNVERIFIED (the anecdote of it failing)
CONFIDENCE: medium
EVIDENCE: OpenAI's Memory FAQ and Business-version FAQ document the isolation model explicitly.
Separately, a single practitioner blog post ("He Turned Off ChatGPT's Memory. It Referenced Another
Client Anyway.") reports an apparent cross-context reference after memory was disabled.
SOURCE: "Memory FAQ" / "Memory FAQ (Business Version)" — OpenAI Help Center — accessed 2026-09-14
SOURCE: "He Turned Off ChatGPT's Memory. It Referenced Another Client Anyway." — smithstephen.com —
accessed 2026-09-14 (UNVERIFIED — single anecdotal source, no reproduction steps, not corroborated)
COUNTEREVIDENCE: The anecdote could equally be explained by in-conversation context (uploaded
files, prior messages in the same thread) rather than a memory-isolation failure; it is flagged, not
credited, as UNVERIFIED per source-hygiene rules.
OPEN QUESTION: Has this specific anecdote been investigated or reproduced by a second party?
```

---

## 6. Stale security-assumption decay — evidence or its absence

No literature specific to *security-labeled* staleness ("this dependency has no known CVEs," "this
auth flow is safe") was found. The closest available evidence is general belief-staleness research,
which is troubling enough to extrapolate from cautiously.

```
CLAIM: The best evaluated LLM agent correctly recognizes that a stored memory has been invalidated
by a later, only-implicit conflict just 55.2% of the time, and recognizing that a memory is stale
does not reliably translate into applying the updated belief in downstream behavior.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: STALE (Chao, Bai, Sheng, Li, Sun; arXiv:2605.06527, submitted 2026-05-07) tests three
dimensions — State Resolution (detecting outdated priors), Premise Resistance (rejecting queries
built on false stale assumptions), and Implicit Policy Adaptation (acting on the updated state) —
across 400 expert-validated conflict scenarios / 1,200 queries spanning 100+ topics. Its named
failure mode, "Implicit Conflict," is exactly the shape of a silently aging security fact: "a later
observation invalidates an earlier memory without explicit negation, requiring contextual inference
and commonsense reasoning to detect." Best-model overall accuracy: 55.2%.
SOURCE: "STALE: Can LLM Agents Know When Their Memories Are No Longer Valid?" — Chao et al. —
2026-05-07 — https://arxiv.org/abs/2605.06527 — accessed 2026-09-14
COUNTEREVIDENCE: STALE's scenarios are general-domain (the paper's examples concern facts like
employer changes), not security-domain; extrapolating its 55.2% figure to "this dependency has no
known CVEs" is an inference, not a direct measurement, and is labeled accordingly below.
OPEN QUESTION: Has STALE, or an equivalent benchmark, been run on a security-fact-specific dataset
(CVE status, deprecated-auth-flow status, credential-rotation status)? Not found.
```

```
CLAIM: No dedicated research field or benchmark for *security-specific* memory staleness in agentic
systems currently exists; the closest published framing is a single sentence in the Governed Shared
Memory paper — "a system with memory can act with confidence on a stale record, and in regulated
workflows a confident wrong action is a compliance event" — which names the problem without
measuring it.
LABEL: REASONABLE EXTRAPOLATION (from STALE's general-domain results plus this framing sentence)
CONFIDENCE: medium
EVIDENCE: Repeated, deliberately broad searches ("stale security assumption decay agent memory,"
"no known CVE outdated context," "knowledge staleness agent memory security") returned STALE, the
Governed Shared Memory paper, and general AI-memory-governance vendor content, but no paper framing
staleness explicitly as a *security* invalidation problem (e.g., "this dependency was patched, this
memory was not updated").
SOURCE: search log, this session — accessed 2026-09-14
COUNTEREVIDENCE: none — the gap itself is the finding.
OPEN QUESTION: This is the clearest open research gap in the entire lane and the most direct
candidate for original work: instrument a coding agent's memory with a synthetic "dependency X has
no known CVEs as of date Y" fact, patch the dependency in a way that falsifies it, and measure
whether/when the agent's memory-consulting behavior notices.
```

---

## 7. Mitigations table

| Mitigation | Status | Evidence | Source |
|---|---|---|---|
| Path-traversal validation on memory-tool file operations | **SHIPPED, as a developer obligation** (Anthropic's SDK code samples implement it; the platform does not enforce it centrally) | Explicit `<Warning>` + concrete validation steps in docs | Anthropic memory-tool docs |
| Secret-write refusal into memory | **SHIPPED, soft/behavioral only** (model-judgment refusal, not an enforced platform control) | "Claude usually refuses to write sensitive information... For stronger guarantees, add validation" | Anthropic memory-tool docs |
| Secret detection/redaction at the model-I/O gateway layer | **SHIPPED (third-party, opt-in, enterprise-tier)**; not native to any agent's own memory-write path | LiteLLM "Secret Detection/Redaction (Enterprise-only)"; LangSmith PII/secrets redaction | LiteLLM docs; LangChain docs |
| Repo-scoped persistent memory with admin disable/delete | **SHIPPED** | GitHub Copilot Memory, public preview 2026-01-15, expanded controls 2026-05-26 | GitHub Docs / Changelog |
| Formal multi-tenant trust-tier scoping for shared agent memory (agent-local/team/tenant/restricted) | **SHIPPED in at least one research/production system, imperfectly enforced** (real cross-tenant leak found and fixed during its own study) | MemClaw / Governed Shared Memory | arXiv:2606.24535 |
| Mandatory human approval gate before an autonomous memory write | **PROPOSED / early open-source pattern only** — not found in any major vendor's shipped product as of the cutoff | Hermes-agent "Write Gate" PR/issue thread; independent researcher note | github.com/NousResearch/hermes-agent PR #44966 / issue #44963; zylos.ai research note (2026-09-11) |
| Skill/tool signing and attestation (SLSA, Sigstore, in-toto, SBOM) for agent skills | **PROPOSED / borrowed vocabulary, not integrated into any skill-install flow surveyed** | CSA research note explicitly imports the vocabulary from software supply-chain tooling | Cloud Security Alliance lab note |
| Pre-install skill/tool scanning for prompt injection and malicious payloads | **SHIPPED (third-party OSS tool, opt-in, not a vendor-native install gate)** | Snyk's `mcp-scan`; Invariant Labs' MCP-Scan | Snyk ToxicSkills post; invariantlabs.ai |
| Formal taxonomy/classification of memory poisoning as a risk category | **SHIPPED as a taxonomy, not as a control** | OWASP ASI06 "Memory & Context Poisoning"; CSA CWE-AGNT-005 | genai.owasp.org; CSA research note |
| Context clearing/compaction to bound active context growth | **SHIPPED** — orthogonal to this lane: reduces token growth, does not prevent or detect memory-file poisoning | Anthropic context-editing / compaction features | Anthropic docs |
| Removal of persistent user memory from the trusted system-prompt channel after a documented compromise | **SHIPPED, reactive** | Claude Code v2.1.50 (2026-04-01), per Cisco's account | Cisco Blogs (single-source, UNVERIFIED against a second publication) |
| Memory expiration / periodic deletion of stale or long-unaccessed entries | **PROPOSED**, stated as the developer's responsibility, not platform-enforced | "Periodically delete memory files that haven't been accessed in a long time" | Anthropic memory-tool docs |
| Query-only / retrieval-triggered poisoning defense (distinguishing relevant retrieval from engineered retrieval) | **RESEARCH-ONLY** — no deployed defense of this kind found | MINJA, AgentPoison name the attack; no counter-paper found deploying a defense | arXiv:2503.03704; arXiv:2407.12784 |
| Security-specific memory-staleness detection ("this fact is a security assumption that may have expired") | **RESEARCH-ONLY, and only by extrapolation from general staleness research** — no security-specific instrument found | STALE benchmark (general-domain) | arXiv:2605.06527 |

---

## 8. Contradictions with common belief

1. **Common belief: "the vendor's memory tool handles security for you."** Anthropic's own
   documentation states the opposite in its own words: the platform's only built-in protection
   against writing secrets to memory is that "Claude usually refuses," and path-traversal
   protection, redaction, size caps, and expiration are all listed as the *developer's*
   responsibility to implement, with the tool itself operating entirely client-side.

2. **Common belief: richer, more structured memory backends (vector stores, graph memory) are
   inherently more secure than flat memory files, because they are more "engineered."**
   MemSecBench directly falsifies this at the data level: "no memory backend is uniformly safer,"
   and the same backend (Mem0) *reduces* end-to-end attack success by 4.2-13.5 points under one
   harness/model pairing (OpenClaw) while *increasing* it from 34.8% to 48.7% under another
   (Hermes + MiniMax-M3). Backend sophistication and backend safety are not the same axis.

3. **Common belief: once a system publishes a formal trust-tier or scoping design for shared
   memory, cross-tenant leakage is solved by construction.** The one production system found with
   a published, explicit trust-tier model (MemClaw's agent-local/team/tenant/restricted hierarchy)
   still shipped a real cross-tenant leak in its GET-by-id endpoint, caught only because the authors
   adversarially evaluated their own live API.

4. **Common belief: the danger in agentic memory is the model "going rogue" or misaligning.** Every
   demonstrated exploit surveyed here (SpAIware, MemGhost, MINJA, AgentPoison, the Gemini memory
   attack, ToxicSkills) works against a model faithfully following instructions exactly as an
   attacker wrote them into content the model was told to process. No misalignment is required; a
   perfectly obedient model is the attack surface.

---

## 9. Problems nobody is talking about

1. **Every scoping design surveyed governs who may trigger a write, not what content gets written.**
   GitHub Copilot Memory gates repository-level facts to "users with write access... who have
   Copilot Memory enabled" — but the actual attack surface in every documented exploit is
   *untrusted content the authorized user's own agent processed on their behalf* (an email, a web
   page, a repository file, an MCP tool result). Restricting the human actor does nothing about the
   content that human's agent is fed. This exact category error recurs across GitHub Copilot Memory,
   MemClaw's trust tiers, and Anthropic's memory-tool docs — none of them address content-origin
   provenance as distinct from write-permission.

2. **The single most direct fix — a mandatory approval gate before any autonomous memory write
   triggered by untrusted content — exists nowhere shipped.** It appears only as an open pull-request
   discussion in a hobbyist open-source agent (`NousResearch/hermes-agent`, issue #44963 / PR #44966)
   and a single independent researcher's blog post dated 2026-09-11 (three days before this lane's
   cutoff). Every major vendor surveyed (Anthropic, OpenAI, GitHub, Google) ships either a soft
   model-judgment refusal or a scope boundary, and none ships a hard human-in-the-loop gate
   specifically for memory writes as distinct from ordinary tool-use approvals.

3. **Nobody has measured security-fact staleness as its own thing.** The only belief-staleness
   research found (STALE) uses general-domain conflict scenarios (an employer changing, for
   example) and reports a 55.2% best-model detection rate for *implicit* invalidation — arguably the
   dominant real-world pattern for a security fact ("dependency X has a CVE now" rarely announces
   itself as a negation of "dependency X has no known CVEs"). No one has re-run this instrument on a
   security-labeled dataset.

4. **Skill/tool supply-chain provenance is being reinvented from scratch rather than adopted from
   mature tooling that already exists.** CSA's own framing explicitly borrows vocabulary from
   SLSA, Sigstore, in-toto, and SBOM/VEX — but as of Snyk's February 2026 scan of the two largest
   public skill registries, none of the 3,984 scanned skills were gated by any such attestation
   requirement; the registries accept and serve unsigned, unattested markdown files that get loaded
   as trusted instructions.

5. **Repair is measured far less than attack, and the gap is large.** MemSecBench's own numbers show
   an 86.3% success rate at *removing* a targeted poisoned memory but only 56.1% at removing it
   *without also destroying legitimate co-located memories* — a 30-point "benign preservation" tax
   that means even a system capable of detecting a poisoning incident faces a nontrivial, largely
   unstudied surgical-removal problem once it tries to clean up.

---

## 10. Open questions for the second wave

1. Has any major vendor, between this cutoff and a later check, shipped a *mandatory* (not merely
   advisory) write-approval gate specifically for memory writes triggered by content the agent
   itself fetched, as distinct from an explicit user "remember this" command? This is the single
   largest gap identified in §9 and the cheapest to re-check via vendor changelogs.

2. What is the actual (not anecdotal) rate at which secrets enter persistent agent memory in
   production? §4 found the mechanism is trivially constructible and completely undisclosed in
   practice — a synthetic-credential red-team against 2-3 shipped memory tools (Anthropic's,
   Mem0's, GitHub Copilot Memory) would close this in roughly the "one afternoon" the mission's
   kill-test methodology favors.

3. Do lane 11's proposed provenance/trust-tier fields survive contact with *retrieval-only* attacks
   (MINJA, AgentPoison) that never touch the write-authorization path at all, only the
   similarity-search path? Every scoping/provenance design surveyed in this lane assumes the threat
   model is "who wrote this," but MINJA and AgentPoison both attack "what gets retrieved," which a
   write-time trust tier does not constrain. This is the most direct adversarial question this lane
   can hand to lane 11's design.

4. Given MemSecBench's finding that no backend is uniformly safer and effects reverse by
   harness/model pairing, is memory-*backend* choice a meaningful security lever at all, or is the
   harness's own admission-control logic (MemSecBench's "adoption," checkpoint E2, where success
   rate contracts sharpest) the only place a defense generalizes? If the latter, lane 12's harness
   design — not lane 11's memory schema — is where this lane's mitigations actually belong.

## Second wave (2026-09-15)

No second-wave tasking has reached this lane as of this write. This report stands as the complete
first-wave deliverable for lane 14.
