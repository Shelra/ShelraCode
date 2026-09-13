# Lane 10 — Red team: why the north-star thesis is wrong

**Date:** 2026-09-08 · **Role:** adversary · **Scope:** attack the thesis, the free-LLM strategy, and Shelra itself.

Everything below is an attack. Where an attack failed against the evidence, that is stated plainly in
§5. `COUNTEREVIDENCE` in each block means *the strongest thing I found FOR the thesis that I could
not refute*.

---

## 1. Summary — the strongest single reason not to build this (5 lines)

The thesis correctly names the problem — the gap between what a human meant and what the software
does — and then proposes to close it with the one faculty the 2026 evidence says models do not have:
enumerating what a request fails to say. Models judge membership far better than they enumerate sets
(F1 0.60–0.77 vs 0.26–0.48), collapse *unanimously* onto one wrong reading in 3–32% of tasks with no
disagreement signal, and after one clarification turn detrimental collapse **rises** to 37.3–76.5% on
MBPP variants. Meanwhile the explicit-artifact layer that the thesis says will "matter more" has been
measured: repository context files change resolve rate by −0.5% to +2.4% (never significant) while
adding 20–23% inference cost. The market's best-funded pure-play on this exact thesis — Tessl,
$125M — has removed "spec-as-source" from its homepage and now sells a skills registry.

---

## 2. Load-bearing claims of the thesis

| # | Load-bearing claim | Steelman | Attack | Key evidence | Verdict |
|---|---|---|---|---|---|
| C1 | The scarce problem is keeping intent ↔ understanding ↔ spec ↔ code ↔ outcome aligned | Every empirical study of AI-assisted delivery finds the constraint downstream of generation: review queues, instability, "almost right but not quite" (66% of devs) | Real, but it is a *review and permission* problem, not a *specification* problem. Amazon's 13-hour outage came from Kiro — a spec-driven tool — deleting an environment. A spec would not have stopped it; a blast-radius boundary would | Codacy/LinearB 5.3×; SO2025 66%; FT/Amazon Kiro incident | **Survives as a problem statement; fails as a problem *diagnosis*** |
| C2 | Explicit intermediate representations will matter *more* as generation gets cheaper | As models absorb public knowledge, the residual value of writing something down concentrates on what the model cannot infer — private intent | Measured and mostly null. ETH SRI, 438 tasks, 4 agents: LLM-generated context files −0.5%/−2% resolve; developer-written +2.4% (p=0.21, n.s.); cost +20–23%, steps +2.45–3.92 | arXiv 2602.11988 | **Fails for descriptive artifacts; survives narrowly for prescriptive ones** |
| C3 | Intent can be elicited/formalised well enough to be a product | Lahiri frames it as a grand challenge with a research agenda; Kleppmann predicts proof automation makes specs the remaining work | The elicitation engine is an LLM, and LLMs cannot enumerate omissions, cannot self-identify ambiguity, and get *worse* after clarifying | 2608.01000; 2607.01953; 2607.00711; 2604.21505 | **Fails at product strength; survives as research** |
| C4 | A small company can build something durable there | Niches abandoned by incumbents can be defended by focus | GitHub ships Spec Kit MIT (134,096★, `/speckit.converge` = the reality-vs-intent check) and OpenSpec is at 67,659★; AWS ships Kiro with automated reasoning over requirements; Claude Code ships channels/skills/hooks/routines/subagents | GitHub API 2026-09-08; kiro.dev; code.claude.com | **Fails** |
| C5 | Zero-cost inference is achievable (preference, not constraint) | Open weights improve fast; llama.cpp is mature; harness quality beats model quality on some tasks | Free tiers: 50 req/day (OpenRouter, no credits); Gemini free = "Content used to improve our products" + human reviewers read I/O. Local: best open-weight 31.2% vs 64.5% frontier on contamination-free repo issues. Hardware: RAM at 2007-normalized prices, Micron locked through 2031 | openrouter FAQ; ai.google.dev/terms 2026-04-28; swe-rebench; Micron/GamingOnLinux | **Fails** |
| C6 | Deterministic acceptance checks make autonomy safe | Tests are an oracle the model cannot argue with | Of 644 repairs that pass functional tests, **221 fail the review constraints** that decide real acceptance (34.3%) | arXiv 2609.04167 | **Fails as stated; survives as a floor, not a ceiling** |
| C7 | Shelra is a reasonable base | 43k lines, working TUI, LSP, MCP, sandbox, hooks | 11,577 lines of the differentiating work are **untracked**; last commit 2026-05-15 (116 days); fork of a 3,461★ upstream last pushed 2026-07-06; `shelra` is **not published on npm** though the README badge and install command assume it; funded wallet private key stored in plaintext with the shell tool unguarded | git/npm/GitHub, this repo | **Fails** |

---

## 3. Top kill-assumptions, ranked by impact × likelihood × cheapness-to-test

### K1 — Free and local inference cannot run an agentic loop (rank 1: total impact, observed, trivially testable)

- **Fails if:** a completed coding task costs more provider requests than a free tier grants per day, or the only models that fit consumer hardware resolve too few real issues to be useful, or free-tier terms make the tool unusable on private code.
- **Evidence to get this week:** instrument one Shelra run end-to-end and count *requests* (not tokens) per completed task; re-read the free-tier ToS of every provider you intend to route to.
- **Kill criterion:** if the median completed task costs >25 provider requests, a 50-req/day free tier supports <2 tasks/day and the "zero cost to user" promise is dead. If any target provider's free tier trains on submitted content, the tool is unusable on proprietary code by construction.
- **Cheapest test:** add a request counter and run ten real tasks. One afternoon.

### K2 — The clarification mechanism is built on a faculty models lack (rank 2)

- **Fails if:** the model cannot enumerate the decisions a request leaves open, or asking about them degrades the result.
- **Evidence to get:** run the corpus already sitting in `src/intent/corpus.ts` against three model families; score recall of the *known* decision set (not the model's own list) and measure post-clarification correctness.
- **Kill criterion:** if recall of known decisions is <0.5, or if one clarification turn does not reduce behavioural divergence, the product's core loop cannot be built from these models.
- **Cheapest test:** you already wrote the instrument. Run it. Days, not weeks.

### K3 — Incumbents have already shipped the whole loop, for free (rank 3)

- **Fails if:** the artifact you would sell is already in a 134k-star MIT repo, and the surrounding runtime is already in a vendor CLI with 13 maintainers shipping 507 versions.
- **Evidence to get:** run `/speckit.constitution → specify → plan → tasks → implement → converge` on a real brownfield feature and record what is missing.
- **Kill criterion:** if Spec Kit + Claude Code covers >80% of your intended surface, there is no wedge, only a preference.
- **Cheapest test:** one afternoon with `specify init` on a real repo.

### K4 — The explicit artifact does not pay for itself (rank 4)

- **Fails if:** writing intent down changes outcomes by less than it costs.
- **Evidence to get:** replicate the ETH ablation on *your* repo: same tasks, with and without the artifact, measure resolve rate, steps, tokens.
- **Kill criterion:** if the artifact adds >15% cost for <5pp resolve improvement on tasks the model has not memorised, the layer is overhead.
- **Cheapest test:** 20 tasks × 2 arms. Two days.

### K5 — Deterministic acceptance is not acceptance (rank 5)

- **Fails if:** things that pass your checks are still rejected by the person who asked.
- **Evidence to get:** take 30 of your own autonomy-runtime completions and have a human grade them against the original request.
- **Kill criterion:** if >20% of check-passing outputs are rejected on grounds the checks never modelled, "the runtime decides completion" is a slogan, not a mechanism.
- **Cheapest test:** grade 30 completions by hand. One day.

### K6 — The buyer is the person the tool exposes (rank 6)

- **Fails if:** the tool's output ("here are 12 decisions your request does not answer") is a demand on the requester's time and a written record of their commitment — and they do not want either.
- **Evidence to get:** ten conversations with the *requesters* (PMs, founders, tech leads), not the implementers.
- **Kill criterion:** if fewer than 3 of 10 will commit to answering a decision list in writing before work starts, the adoption path does not exist regardless of accuracy.
- **Cheapest test:** ten conversations. A week.

### K7 — Shelra is the wrong base (rank 7: certain, but the base is replaceable)

- **Fails if:** the differentiating work is unversioned, the distribution channel does not exist, and the security posture blocks the intended users.
- **Evidence to get:** already gathered — see §4.11.
- **Kill criterion:** any of: 11.5k untracked lines lost; `npm i -g shelra` 404s for a first user; a prompt-injection reaches `~/.shelra/wallet.json`.
- **Cheapest test:** `git status`, `npm view shelra`, and one adversarial prompt. Thirty minutes.

---

## 4. Attack-by-attack findings

### 4.1 — Coding agents become good enough that explicit specs are unnecessary

```
CLAIM: Frontier agents still fail one third of contamination-free repository issues, so "good enough
to skip specification" is not observed — but the failures are not the kind explicit specs fix.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: SWE-rebench, problems drawn 2026-05-15 to 2026-07-01, 111 problems from 65 repositories:
best resolved rate 64.5% ±1.41 (Fable 5 [high]); Grok 4.5 63.8%; Opus 5 63.4%; GLM-5.2 62.9%;
GPT-5.6 Sol 62.3%. Separately, SWE-Gate finds 221 of 644 test-passing repairs violate the review
constraints that decide real acceptance.
SOURCE: SWE-rebench leaderboard — evaluation window May–Jul 2026 — https://swe-rebench.com/ — accessed 2026-09-08
SOURCE: "SWE-Gate: Passing Functional Tests Is Not Enough for Software Engineering Agents" — He, Wang, Liu, Chen, Zhang, Li — 2026-09-03 — https://arxiv.org/abs/2609.04167 — accessed 2026-09-08
COUNTEREVIDENCE: HN practitioners in Aug 2026 report the opposite in practice — "Agents are already
too good, the models improved. Nowadays you can just start with a plan.md" (@thiago_fm, 2026-08-06).
And the ETH ablation shows the explicit artifact does not close the residual gap either, so the 35%
failure rate does not by itself license a spec product.
OPEN QUESTION: What fraction of the 35% residual is attributable to underspecified intent versus
retrieval, context, and review-constraint failure? Sourcegraph's CodeScaleBench work suggests the
latter dominates.
```

The sharpest version of this attack is not "agents are good enough." It is **"the residual failures
are not intent failures."** Sourcegraph's 1,281-run study across 40+ enterprise-scale repositories
concluded: *"The difference between complete failure and near-perfect completion wasn't intelligence
— it was efficient access to context."* They identify a ~400,000-line grep threshold above which
standard tooling fails systematically, and a case where a baseline agent made *"96 tool calls over
84 minutes"* against five calls and under five minutes with proper tooling. If that is right, the
bottleneck is retrieval infrastructure, and the thesis is aiming one layer too high.

### 4.2 — Natural-language interfaces solve intent sufficiently

```
CLAIM: The fastest revenue ramp in software history was achieved with no explicit specification layer
at all — plain natural-language prompting.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: Lovable reached $100M ARR in July 2025 (eight months from launch), $200M ARR by
2025-11-19, at a $1.8B valuation on $225M+ raised. The product is a prompt box.
SOURCE: "As Lovable hits $200M ARR, its CEO credits staying in Europe for its success" — TechCrunch — 2025-11-19 — https://techcrunch.com/2025/11/19/as-lovable-hits-200m-arr-its-ceo-credits-staying-in-europe-for-its-success/ — accessed 2026-09-08
COUNTEREVIDENCE: ARR of a self-serve product with undisclosed churn is a weak durability signal; a
critic in Oct 2025 called it "Vanity Metric 2.0". The buyers are also largely not professional
engineers working in existing codebases — the segment this thesis targets.
OPEN QUESTION: What is Lovable's net revenue retention at 18 months, and what fraction of its
projects survive contact with a second developer?
```

### 4.3 — Specification engineering becomes bureaucracy

```
CLAIM: The two most-read practitioner assessments of spec-driven development both conclude the
artifact volume exceeds its value, and one draws the explicit parallel to model-driven development's
failure.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: Zaninotto (Marmelab, 2025-11-12, 225 HN points / 191 comments) reports one feature —
displaying the current date — producing "8 files and 1,300 lines of text", and that developers
"spend most of their time reading long Markdown files, hunting for basic mistakes hidden in overly
verbose, expert-sounding prose", spending "80% of your time reading instead of thinking".
Böckeler (Thoughtworks, on martinfowler.com, 2025-10-15) reports Kiro generating "4 user stories
with 16 acceptance criteria" for a trivial bug fix, states she would "rather review code than all
these markdown files", and warns spec-as-source risks inheriting "the downsides of both MDD and
LLMs: Inflexibility _and_ non-determinism."
SOURCE: "Spec-Driven Development: The Waterfall Strikes Back" — François Zaninotto, Marmelab — 2025-11-12 — https://marmelab.com/blog/2025/11/12/spec-driven-development-waterfall-strikes-back.html — accessed 2026-09-08
SOURCE: "Understanding Spec-Driven-Development: Kiro, Spec-Kit, and Tessl" — Birgitta Böckeler, Thoughtworks — 2025-10-15 — https://martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html — accessed 2026-09-08
COUNTEREVIDENCE: Marc Brooker (AWS) argues the waterfall charge is a category error — specs are
pulled "*up*" iteratively, not written "*up-front*" — and that the point is "we can set an agent off
building without a human inside the tight loop". Böckeler also affirms "the general principle of
spec-first is definitely valuable in many situations."
OPEN QUESTION: Is the bureaucracy complaint about specification *as such*, or about the specific
verbosity of LLM-generated markdown? A 200-word spec has never been benchmarked against a
1,300-line one.
```

By August 2026 the community reading is that the tool category faded: *"Nowadays though, it seems
like all the SDD tools have kinda fallen off but all of the complaints remain."* (Ask HN, 2026-08-05).

### 4.4 — Specs become as complex as code

```
CLAIM: The circular-specification problem is now stated by practitioners as the structural reason SDD
stalls: the spec→code mapping is neither complete nor deterministic, so the spec cannot function as
a higher-level language.
LABEL: OBSERVED TODAY
CONFIDENCE: medium
EVIDENCE: HN, 2026-08-05: "the reason you don't have to read assembly when you write in a higher
language is that, over time that abstraction has become largely complete and is deterministic...
Spec driven development is none of those things... there's no way to consistently reconcile the spec
with the code." Reply: "the spec is not comprehensive enough to guarantee one specific
implementation. If the spec really did translate one-to-one then the spec would really become a
higher level language." Breunig (2026-03-04) reports the same from the other side: "the act of
implementing code generates new decisions. Those decisions inform the spec" — i.e. the spec is
downstream of implementation as often as upstream, which is what makes synchronisation expensive.
SOURCE: "Ask HN: What Happened to Spec-Driven Development?" — Hacker News — 2026-08-05 — https://news.ycombinator.com/item?id=49182353 — accessed 2026-09-08
SOURCE: "Learnings from a No-Code Lib: Keep the Spec Driven Development Triangle in Sync" — Drew Breunig — 2026-03-04 — https://www.dbreunig.com/2026/03/04/the-spec-driven-development-triangle.html — accessed 2026-09-08
COUNTEREVIDENCE: The vericoding benchmark shows the fully-formal version of this mapping *is*
becoming tractable in at least one language: 82% verified synthesis in Dafny, and "LLM progress has
improved progress on pure Dafny verification from 68% to 96% over the past year."
OPEN QUESTION: Does the 96% Dafny result generalise past algorithmic kernels to systems with I/O,
concurrency and money — the domains the intent corpus in this repository targets?
```

### 4.5 — Intent cannot be formalised sufficiently

```
CLAIM: The specific faculty a spec/intent product needs — enumerating what a request does not say —
is the one LLMs are measurably worst at, and it does not improve with reasoning effort or scale.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: "Judging Is Not Enumerating": models score F1 0.74–0.90 judging executable code but their
authored acceptance suites accept only 19–42% of correct solutions; when specifying a predicate
directly they reach ~F1 0.99; they detect planted over-inclusions 6–7× more often than planted
omissions; a production deployment showed 10:1 omission-first failures across 43,227 items.
ClarifyCodeBench names three effects: "Capability Decoupling" (code-generation strength does not
transfer to clarification), "The Reasoning Paradox" (more thinking improves correctness but yields
marginal gains in identifying ambiguities), and "The Multi-ambiguity Ceiling" (performance degrades
sharply as ambiguity density rises). Orchid (1,304 tasks, four ambiguity types) finds LLMs
"lack the capability to identify or resolve such ambiguity autonomously." Self-consistent errors
"remain stable or even increase" as model scale increases.
SOURCE: "Judging Is Not Enumerating: Silent Omissions in LLM-Authored Acceptable Sets" — Chen, Chen, Lin, Long, Vong — 2026-08-02 — https://arxiv.org/abs/2608.01000 — accessed 2026-09-08
SOURCE: "ClarifyCodeBench: Evaluating LLMs on Clarifying Ambiguous Requirements for Code Generation" — Fang, Jin, Dong, Li, Zhang, Jin, Li — 2026-07-01 (rev 2026-08-31) — https://arxiv.org/abs/2607.00711 — accessed 2026-09-08
SOURCE: "Assessing the Impact of Requirement Ambiguity on LLM-based Function-Level Code Generation" (Orchid) — Yang, Xie, Yang, Hu, Huang, Zhang, Miao, Su, Wan, Pu — 2026-04-23 — https://arxiv.org/abs/2604.21505 — accessed 2026-09-08
SOURCE: "Too Consistent to Detect: A Study of Self-Consistent Errors in LLMs" — Tan et al. — 2025-05-23 — https://arxiv.org/abs/2505.17656 — accessed 2026-09-08
COUNTEREVIDENCE: The same papers show the *judging* half is strong (F1 0.60–0.99). A product that
supplies the decision taxonomy from outside the model and asks the model only to judge membership
sidesteps the enumeration deficit entirely — which is exactly what `src/intent/probes.ts` and the
`ProbeCategory` enum in this repository already do.
OPEN QUESTION: Can a fixed, human-authored decision taxonomy (concurrency, partial failure,
lifecycle, temporal, authority, money, boundary) recover enough recall to make the judging-only
architecture viable? This is testable this week and I found no published attempt.
```

This is the deepest attack in the lane. The thesis says "the scarce thing is knowing what the human
meant." The evidence says the machine cannot tell you what it does not know it was not told.

### 4.6 — Incumbents absorb the entire opportunity

```
CLAIM: Every layer of the thesis chain is already shipped, free, by GitHub, AWS and Anthropic, with
release cadences a solo builder cannot match.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: github/spec-kit — 134,096 stars, 12,067 forks, 318 open issues, MIT, created 2025-08-21,
pushed 2026-09-08; v1.0.0 shipped; commands include /speckit.specify, /speckit.plan, /speckit.tasks,
/speckit.clarify, /speckit.analyze, /speckit.checklist and /speckit.converge — the last defined as
"Assess the codebase against spec/plan/tasks and append remaining work as new tasks", i.e. the
reality-vs-intent check, given away. Fission-AI/OpenSpec — 67,659 stars, pushed 2026-09-07. AWS Kiro:
converts prompts to "requirements, architectural designs, and sequenced tasks", checks requirements
"for contradictions and gaps using automated reasoning techniques", validates behaviour through
property-based testing, and carries steering files across IDE/CLI/web/mobile. Claude Code: 144,441
stars; @anthropic-ai/claude-code at 507 npm versions with 13 maintainers, published 2026-09-06;
documented surface includes plan review, skills, subagents, background agents, hooks, CLAUDE.md plus
auto memory, MCP, routines and scheduled tasks, sandboxing, Agent SDK, and **Channels — "Push events
from Telegram, Discord, iMessage, or my own webhooks into a session."**
SOURCE: GitHub REST API repository metrics for github/spec-kit, Fission-AI/OpenSpec, anthropics/claude-code — accessed 2026-09-08
SOURCE: spec-kit README (v1.0.0) — GitHub — https://raw.githubusercontent.com/github/spec-kit/main/README.md — accessed 2026-09-08
SOURCE: Kiro — AWS — https://kiro.dev/ and https://kiro.dev/docs/specs/ — accessed 2026-09-08
SOURCE: Claude Code overview — Anthropic — https://code.claude.com/docs/en/overview — accessed 2026-09-08
COUNTEREVIDENCE: Ubiquity is not adoption. Spec Kit's star count vastly exceeds any observed usage;
the Feb 2026 Ask HN thread notes it had gone "over a month" without commits, and practitioners
repeatedly report rolling their own markdown instead of adopting a framework. Wide free tooling can
indicate an unsolved problem rather than a solved one.
OPEN QUESTION: Does anyone actually run /speckit.converge twice on the same repository? Star counts
do not answer this and no usage telemetry is public.
```

Shelra's differentiators map one-to-one onto Claude Code's shipped features: Telegram bridge →
Channels (Telegram named explicitly); schedule → Routines and desktop scheduled tasks; delegations →
subagents and background agents; hooks → hooks; sandbox → sandboxing; instructions → CLAUDE.md and
auto memory. The remaining non-overlap is local GGUF management (llama.cpp, 127,506★, plus Ollama and
LM Studio) and crypto payments — whose rails are Coinbase's and Cloudflare's, not Shelra's.

### 4.7 — Formal methods remain niche

```
CLAIM: This attack largely FAILED. Formal verification is the one part of the chain where 2025–2026
evidence shows a genuine capability discontinuity.
LABEL: STRONG TREND
CONFIDENCE: medium
EVIDENCE: Vericoding: 12,504 formal specifications (3,029 Dafny, 2,334 Verus/Rust, 7,141 Lean),
6,174 previously unseen; verified-synthesis rates 82% Dafny, 44% Verus, 27% Lean; and "LLM progress
has improved progress on pure Dafny verification from 68% to 96% over the past year." Kleppmann's
"AI will make formal verification go mainstream" drew 827 HN points and 434 comments (2025-12-08).
Gavran's 50-year retrospective concedes that fully automatic verification, "once deemed impossible,
now approaches feasibility through LLM-powered tools."
SOURCE: "A benchmark for vericoding: formally verified program synthesis" — Bursuc, Ehrenborg, Lin et al. (BAIF/MIT) — 2025-09-26 — https://arxiv.org/abs/2509.22908 — accessed 2026-09-08
SOURCE: "AI will make formal verification go mainstream" — Martin Kleppmann — 2025-12-08 — https://martin.kleppmann.com/2025/12/08/ai-formal-verification.html — accessed 2026-09-08
SOURCE: "The Case Against Formal Verification, 50 Years Later" — Ivan Gavran — 2026-08-15 — https://ivan-gavran.github.io/0-social-processes-paper — accessed 2026-09-08
COUNTEREVIDENCE (i.e. evidence FOR my attack): the same benchmark reports that "adding
natural-language descriptions does not significantly improve performance" — the natural-language
intent layer the thesis centres on adds nothing to verified synthesis. And both Kleppmann and Gavran
land on the same caveat: the challenge "will move to correctly defining the specification", where
the translation from informal requirement to formal spec is itself unverified and, in Gavran's
words, "a lot can be lost or misinterpreted."
OPEN QUESTION: Dafny at 96% is on algorithmic kernels with machine-checkable postconditions. What is
the equivalent number for a booking system's refund policy?
```

The sting for the thesis: verification getting cheap is *bad* news for a product that sells the
natural-language layer, because vericoding works fine **without** it.

### 4.8 — Real-world outcome alignment cannot be automated

```
CLAIM: The last arrow in the chain — "does reality still match intent" — is a human judgement that
the strongest available telemetry shows getting harder, and the canonical 2025–26 failure happened
under a spec-driven tool.
LABEL: OBSERVED TODAY
CONFIDENCE: medium
EVIDENCE: CircleCI 2026 (28M+ CI workflows, 22K+ organisations): feature-branch throughput +59% YoY
while main-branch throughput is −7% for the median team and main-branch success is 70.8%. LinearB
2026: agentic-AI PRs sit in the pickup queue "5.3x longer than unassisted PRs"; AI-assisted 2.47×.
Faros AI: "31% more PRs merging with no review." Stack Overflow 2025: only 3.1% highly trust AI
accuracy while 45.7% distrust it; the leading frustration is "AI solutions that are almost right,
but not quite" (66%), the second is "Debugging AI-generated code is more time-consuming" (45.2%);
favourability fell from 70%+ to 60%. And the canonical alignment failure ran on a spec-driven tool:
Amazon's Kiro, asked for a small change to a cost-calculation service, "deleted and recreated an
entire environment", causing a roughly 13-hour outage in December 2025; Amazon subsequently barred
junior and mid-level engineers from pushing AI-assisted code without senior approval.
SOURCE: "AI is breaking code review" — Codacy — 2026-06-08 — https://blog.codacy.com/ai-breaking-code-review-how-engineering-teams-survive-pr-bottleneck — accessed 2026-09-08 (secondary; cites CircleCI, LinearB, Faros AI, Stack Overflow)
SOURCE: Stack Overflow Developer Survey 2025, AI section — https://survey.stackoverflow.co/2025/ai — accessed 2026-09-08
SOURCE: "A 'high blast radius': Amazon probes surge in outages linked to AI coding tools" — Paul Sawers, Tessl, reporting the Financial Times — 2026-03-11 — https://tessl.io/blog/a-high-blast-radius-amazon-probes-surge-in-outages-linked-to-ai-coding-tools/ — accessed 2026-09-08 (secondary; FT original paywalled and UNVERIFIED at source)
COUNTEREVIDENCE: DORA 2025 (2025-09-23) reports 90% AI adoption among software professionals, a
median of two hours per day of AI work, over 80% reporting productivity gains, and — reversing its
own 2024 finding — that AI adoption is now "linked to higher software delivery throughput", framing
AI as "a mirror and a multiplier". If throughput is now rising, the outcome-misalignment crisis may
be absorbed by ordinary organisational practice rather than by tooling.
OPEN QUESTION: Was the Amazon incident a specification failure or a permission failure? The answer
determines whether this thesis or a blast-radius product is the right response.
```

### 4.9 — A new semantic IR becomes obsolete as models improve

```
CLAIM: The measured value of writing an explicit repository-level representation is approximately
zero where the model already knows the domain, and positive only where the information is genuinely
outside the model — a residual that public-knowledge growth shrinks.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: ETH SRI ablation across SWE-bench Lite (300 tasks, 11 popular Python repositories) and
CTXbench (138 instances, 12 less-known repositories carrying developer-committed context files),
four agents (Claude Code/Sonnet-4.5, Codex/GPT-5.2, Codex/GPT-5.1-mini, Qwen Code/Qwen3-30b-coder):
LLM-generated context files reduce average resolution rate by 0.5% and 2% (p = 0.87 and 0.37);
developer-provided files improve it by 2.4% (p = 0.21) and significantly outperform LLM-generated
ones (p = 0.038); cost rises 20% and 23% (p < 0.001%) with +2.45 and +3.92 steps; reasoning tokens
rise 22% for GPT-5.2 and 10% for GPT-5.1-mini. Repository overviews "do not meaningfully reduce"
file-discovery time for any agent. Instructions, by contrast, are obeyed: naming a tool raised its
usage from <0.01 to 1.6 invocations per instance.
Contrast: Vercel's eval on Next.js 16 APIs absent from training data reports baseline 53% → default
Skill 53% (+0pp) → Skill with explicit instructions 79% → AGENTS.md docs index 100% (+47pp).
SOURCE: "Evaluating AGENTS.md: Are Repository-Level Context Files Helpful for Coding Agents?" — Gloaguen, Mündler, Müller, Raychev, Vechev (ETH SRI) — 2026-02-12, rev 2026-06-23 — https://arxiv.org/abs/2602.11988 and https://arxiv.org/html/2602.11988v2 — accessed 2026-09-08
SOURCE: "AGENTS.md outperforms skills in our agent evals" — Jude Gao, Vercel — 2026-01-27 — https://vercel.com/blog/agents-md-outperforms-skills-in-our-agent-evals — accessed 2026-09-08 (vendor blog; sample size not disclosed)
COUNTEREVIDENCE: The Vercel result is the thesis's best defence: where the information is truly
private or novel, an explicit artifact is worth +47pp. The two results reconcile if the artifact's
value equals the information the model cannot infer — which is exactly the thesis's steelman, and
which private organisational intent never stops generating.
OPEN QUESTION: Where is the boundary? Nobody has measured resolve-rate delta as a function of how
much of the needed information is recoverable from the repository itself.
```

The historical precedent is stated by the most credible practitioner in the space: Böckeler's warning
that spec-as-source risks "the downsides of both MDD and LLMs: Inflexibility *and* non-determinism."
Model-driven development lost to the same forces — the model became a second artifact to maintain,
and round-tripping never worked.

**The single strongest market signal in this lane.** Tessl raised $125M explicitly on spec-centric
development — $25M seed (April 2024, boldstart and GV) plus a $100M Series A announced 2024-11-14 led
by Index with Accel — promising that developers would "specify what they want, captured in a
specification format" and that "Spec-driven apps will be language agnostic, easily adapted from
JavaScript to Python, iPhone to Android or browser to native app." As of 2026-09-08 the Tessl
homepage sells an "Agent Enablement Platform" for **skills** — "skills are the new code" — with a
3,000+ skill registry, security scanning, policy gating and audit logs, listing Cisco, Zillow,
JustEat, Intercom and ByteDance as users, and with **no mention of spec-as-source anywhere on the
page**. The best-funded, best-connected pure-play on this exact thesis moved off it in under two
years, toward the artifact that encodes *procedure* rather than *intent*.

### 4.10 — The free-LLM strategy is a trap

```
CLAIM: Free-tier inference is legally, quantitatively and architecturally incompatible with an
agentic coding tool that touches private code.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: (a) Legal — Gemini API Additional Terms, last modified 2026-04-28: "When you use Unpaid
Services, including, for example, Google AI Studio and the unpaid quota on Gemini API, Google uses
the content you submit to the Services and any generated responses to provide, improve, and develop
Google products and services and machine learning technologies", and "To help with quality and
improve our products, human reviewers may read, annotate, and process your API input and output."
The pricing table marks the free tier "Content used to improve our products — Yes" and the paid tier
"not used". The same terms prohibit using the service "to develop models that compete with the
Services". (b) Quantitative — OpenRouter free models carry "low rate limits (50 requests per day
total)" without purchased credits, rising to 1,000/day after $10 in credits. An agentic loop issues
roughly one request per tool round. (c) Treadmill — the Gemini changelog shows model retirements
roughly every 2–4 months through 2026 (gemini-3.1-flash-lite-preview shut down 2026-05-25,
gemini-3.1-flash-image-preview 2026-06-25, Gemini 2.0 Flash 2026-06-01, Imagen 4 2026-08-17,
gemini-robotics-er-1.6-preview 2026-08-31), with preview models given 2–3 months' notice.
SOURCE: Gemini API Additional Terms of Service — Google — last modified 2026-04-28 — https://ai.google.dev/gemini-api/terms — accessed 2026-09-08
SOURCE: Gemini API pricing — Google — https://ai.google.dev/gemini-api/docs/pricing — accessed 2026-09-08
SOURCE: OpenRouter FAQ — https://openrouter.ai/docs/faq — accessed 2026-09-08
SOURCE: Gemini API changelog / deprecations — https://ai.google.dev/gemini-api/docs/changelog — accessed 2026-09-08
COUNTEREVIDENCE: Free tiers have persisted and broadened for two years — Gemini 2.5 Pro plus a long
list of 3.x Flash and Flash-Lite models remain on the free tier as of this date, which is more
generous than most 2024 forecasts predicted. OpenRouter also routes away from providers that log
unless the user explicitly opts in.
OPEN QUESTION: What is the actual per-completed-task request count for Shelra's loop? Without that
number the 50/day limit cannot be scored.
```

```
CLAIM: The local-inference escape hatch is closing from the hardware side, not the model side.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: On contamination-free repository issues drawn May–July 2026, the best open-weight entrant
scores 31.2% ±1.68 (Qwen3.6-27B) against 64.5% frontier — roughly half. Practitioners put the usable
local threshold at "64gb... for getting meaningful work done while also maintaining a large enough
context window" (HN, 2026-05-21), and note that "enterprise-consumed tokens come with legal/data
protection agreements... there is no BYOD equivalent set of practices and protections for local LLMs
(BYOLLM)." Meanwhile memory is in a multi-year squeeze: Micron has signed 16 five-year strategic
customer agreements running through 2031, states tight conditions will "persist beyond calendar
2027", and discontinued its Crucial consumer business in December 2025; Samsung and SK Hynix were
reported in January 2026 as seeking LPDDR increases of roughly 80% and 100% QoQ respectively;
Raspberry Pi raised prices up to 70% in February 2026 in response to memory costs.
SOURCE: SWE-rebench leaderboard — https://swe-rebench.com/ — accessed 2026-09-08
SOURCE: "Expect RAM prices to stay high with Micron locking in deals for 5 years" — GamingOnLinux, citing Micron earnings materials — 2026-06-26 — https://www.gamingonlinux.com/2026/06/expect-ram-prices-to-stay-high-with-micron-locking-in-deals-for-5-years/ — accessed 2026-09-08
SOURCE: "Ask HN: Is the next big thing locally running coding agents?" — Hacker News — 2026-05-21 — https://news.ycombinator.com/item?id=48223375 — accessed 2026-09-08
COUNTEREVIDENCE: The strongest single result against this attack: Minervini's harness-bench (1,360
runs — 17 model quantisations × 5 harnesses × 16 tasks — on a single M3 Max with 128GB) found
Qwen3.6-27B UD-Q4_K_XL with the Pi harness passing 16/16 at roughly 207 s/task, and gpt-oss-120b
MXFP4 passing 15/16 at roughly 34 s/task, and concluded that harness engineering outweighs model
quality (Pi 76.9% vs Aider 62.5% on the same models, Q4 sweep). That is a direct endorsement of
"local-first, harness-differentiated".
OPEN QUESTION: harness-bench used 16 self-contained SE tasks; SWE-rebench used 111 real repository
issues, and the same model family scores 100% on one and 31.2% on the other. Which distribution
matches the work a paying user brings? Nobody has run the same local models on both.
```

### 4.11 — Shelra itself

```
CLAIM: The differentiating half of Shelra exists only as uncommitted working-tree files, on a fork of
a decelerating upstream, distributed through an npm package name that does not exist.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: Directly measured in this repository on 2026-09-08. Tracked TypeScript: 31,189 lines.
Untracked TypeScript: 11,577 lines across 72 files — this is src/intent/, src/autonomy/, src/exec/,
src/runtimes/, src/intelligence/, src/models/, src/providers/, src/router/, src/security/,
src/hardware/, src/cli/, src/context/, src/setup/, src/startup/, src/daemon/, src/headless/ — that
is, every module that differentiates Shelra from its upstream. A further 60+ tracked files are
modified and uncommitted. `git stash list` is empty; no branch holds this work. Last commit:
2026-05-15 (116 days ago); commits in the last 90 days: 0. `git remote origin` still points at
https://github.com/superagent-ai/grok-cli (3,461 stars, 420 forks, last pushed 2026-07-06), and the
README's CI badge points at the upstream's workflow. `npm view shelra` returns "Not found", while
README.md carries an npm version badge for `shelra` and instructs `bun add -g shelra`. The upstream's
own package, @vibe-kit/grok-cli, was last published 2025-11-27. package.json still lists
"author": "Vibe Kit".
SOURCE: This repository — git, wc, npm registry, GitHub REST API — accessed 2026-09-08
COUNTEREVIDENCE: The code quality is high by the metrics available: 69 test files against 213 source
files, exactly one TODO/FIXME marker across ~43,600 lines, a genuinely symlink-hardened workspace
path guard, and unusually disciplined module-level documentation. This is not slop.
OPEN QUESTION: Is the untracked state deliberate (a rewrite staged for one squashed commit) or
accidental? The answer moves this from fatal to housekeeping — but the risk profile is identical
either way until it is committed.
```

```
CLAIM: Shelra combines a funded, plaintext crypto private key with a shell tool that has no workspace
containment — a combination that converts any prompt injection into fund loss.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: src/wallet/manager.ts generates a key with generatePrivateKey() and writes
{privateKey, address, chain, createdAt} as plaintext JSON to ~/.shelra/wallet.json (directory mode
0o700, file mode 0o600 — both no-ops on Windows, the platform this checkout runs on). Grepping the
whole tree for createCipher|scrypt|keytar|safeStorage returns nothing: there is no encryption
anywhere in the codebase. The containment helper resolveWorkspacePath (src/security/workspace-guard.ts)
is imported by exactly one module — src/tools/file.ts — so the bash/exec path, MCP servers and the
LSP client all sit outside it. The wallet holds real USDC on Base (contract 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913).
Untrusted text reaches the model from fetched web pages, MCP tool results, repository files and the
Telegram bridge.
SOURCE: This repository — src/wallet/manager.ts, src/security/workspace-guard.ts, src/tools/file.ts — accessed 2026-09-08
COUNTEREVIDENCE: The Telegram bridge is correctly gated — bridge.ts:44-46 checks
getApprovedUserIds() and requires an explicit /pair code approved in the terminal, so that channel
is not open to the world. The file tool's own guard is well built, resolving through non-existent
ancestors so symlinked parents cannot be used to escape.
OPEN QUESTION: Is there a sandbox mode that actually contains the bash tool? A `sandboxMode` setting
exists in the agent config but its enforcement path was not traced in this pass.
```

```
CLAIM: Shelra's ship velocity is two to three orders of magnitude below the tools it competes with.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: npm publish history read on 2026-09-08 — opencode-ai: 12,089 versions, last published
2026-09-08; @openai/codex: 4,330 versions, 18 maintainers, published 2026-09-07;
@anthropic-ai/claude-code: 507 versions, 13 maintainers, published 2026-09-06; @charmland/crush: 186
versions, published 2026-08-31. GitHub stars: claude-code 144,441; llama.cpp 127,506; codex 122,500;
gemini-cli 106,870; cline 67,666; OpenSpec 67,659; aider 48,832; continue 35,834; serena 29,033;
crush 27,956; qwen-code 27,712. Shelra: one primary maintainer, 0 commits in 90 days, 0 npm versions.
SOURCE: npm registry and GitHub REST API — accessed 2026-09-08
COUNTEREVIDENCE: Version count measures release automation, not value; Aider holds 48,832 stars on a
repository last pushed 2026-05-22, so a slow cadence is survivable in this category.
OPEN QUESTION: none — this is simply a fact to price.
```

---

## 5. What is well-reasoned and survived

I attacked these and could not break them.

1. **The problem statement.** Something between "what the human wanted" and "what shipped" is the
   expensive part now, and multiple independent 2025–26 sources converge on it: 66% of developers
   name "almost right, but not quite" as their leading frustration; agentic PRs sit 5.3× longer in
   review; 31% more PRs merge unreviewed; main-branch throughput is down 7% while feature-branch
   throughput is up 59%. The thesis is aimed at a real wound.

2. **The judging/enumerating asymmetry as an architecture, not a defect.** The papers that most
   damage the naive product ("ask the model what's missing") simultaneously license a specific
   design: supply the decision taxonomy from outside the model and use the model only to judge
   membership, where it scores F1 0.60–0.99. `src/intent/probes.ts` and the `ProbeCategory` enum
   (concurrency, partial_failure, lifecycle, temporal, authority, money, boundary) already embody
   exactly that. This is the one design choice in the repository that the 2026 literature actively
   supports and that no shipped competitor makes.

3. **Semantic collapse is real, large, and invisible to the deployed detectors.** Over 10% on MBPP,
   3% on HumanEval, 18–32% on LiveCodeBench for *original* tasks; 23–55% on underspecified MBPP
   variants; and 11%–49.7% of tasks receive an incorrect solution without ever triggering a
   clarifying question from clustering-based methods like ClarifyGPT and SpecFix. No shipped product
   addresses this failure mode. It survived every attack I made on it.

4. **Verification cost is genuinely collapsing.** 68% → 96% on pure Dafny verification in one year is
   a real discontinuity, and the vericoding benchmark is a serious 12,504-specification artifact.
   Whatever else is wrong with the thesis, "verification gets cheap" is a sound premise.

5. **Shelra's engineering discipline.** 69 test files against 213 sources, one TODO across 43,600
   lines, a correctly symlink-hardened path guard, and module headers that state intent rather than
   restating code. The problems here are strategic and operational, not craft.

---

## 6. What I could not assess

- **Whether Spec Kit's 134k stars represent usage.** No public telemetry; stars in this category are
  known to be aspirational.
- **The Financial Times original on the Amazon/Kiro incident** — paywalled; read only through Tessl's
  secondary account. Numbers marked accordingly.
- **DORA's full 2025 and 2026 datasets** — the report PDFs sit behind gated landing pages that
  returned 404 or navigation-only content; only the Google blog summary was retrievable.
- **Terminal-Bench 4.0 leaderboard values** — the page renders its table client-side; the fetch
  returned column headers only.
- **Groq's free-tier limits** — the public docs page shows a Free Plan tab without its values.
- **swebench.com leaderboard values** — truncated on fetch.
- **thenewstack.io "AI hasn't shifted the bottleneck"** and **CACM "Leveraging Requirements
  Engineering for AI Coding Tool Success"** — body text not retrievable (truncation / HTTP 403).
  Both would have sharpened §4.8 and are listed UNVERIFIED.
- **Whether Shelra's `sandboxMode` actually contains the bash tool** — the config surface was traced,
  the enforcement path was not.
- **Any other lane's claims** — `research/lanes/` contained only this file at the time of writing.
  Second-wave work should attack the synthesis directly.
- **WebSearch was unavailable** (session budget exhausted at first call). All discovery was done
  through the arXiv API, the Hacker News Algolia API, the GitHub REST API, the npm registry, and
  direct WebFetch. This biases the corpus toward sources discoverable by those channels and away from
  vendor marketing, analyst reports and non-English material.

---

## 7. Contradictions with common belief

1. **Common belief: spec-driven development is the emerging consensus for agentic coding.**
   Evidence says the tooling category peaked and receded. The best-funded pure-play (Tessl, $125M,
   Index/Accel/GV/boldstart) removed spec-as-source from its homepage and now sells a skills
   registry. The two most-read practitioner reviews (Marmelab, 225 HN points; Böckeler on
   martinfowler.com, 128 points) both conclude the artifact volume exceeds its value. The August 2026
   community read is explicit: "all the SDD tools have kinda fallen off but all of the complaints
   remain."

2. **Common belief: writing intent down (AGENTS.md, CLAUDE.md, specs) makes agents better.**
   The only rigorous ablation — 438 tasks, four agents, ETH SRI — found LLM-generated context files
   *reduce* resolution by 0.5–2%, developer-written files improve it by a non-significant 2.4%, and
   both add 20–23% cost and 2.45–3.92 extra steps. Repository overviews, "although popular and
   recommended by model providers, are not helpful."

3. **Common belief: asking clarifying questions fixes underspecification.**
   After one clarification turn, detrimental semantic collapse *increases* to 37.3%–76.5% on MBPP
   variants. Clarification is not a monotone improvement, and no shipped product warns users of this.

4. **Common belief: open models are closing the gap, so free local inference is imminent.**
   On contamination-free repository issues drawn May–July 2026 the best open-weight entrant sits at
   31.2% against 64.5% frontier — and the hardware to run even that got structurally more expensive,
   with Micron locked into five-year enterprise contracts through 2031 and its consumer memory brand
   discontinued in December 2025.

5. **Common belief: AI moved the bottleneck from writing code to reviewing it.**
   Contested by the source most likely to know: DORA 2025 reports 90% adoption, 80%+ perceived
   productivity gain, and — reversing its own 2024 finding — that AI adoption is now *linked to
   higher* delivery throughput, framing AI as "a mirror and a multiplier". The paradox may be
   dissolving without any new tooling category.

---

## 8. Problems nobody is talking about (from the contrarian side)

1. **The accountability tax.** An intent-clarification tool's output is a written record of a
   decision someone must own. The person who has to adopt it is the person it exposes. As one
   commenter put it on 2026-02-28: *"Developers have always been given ambiguous requirements, and
   questions about them have always been furiously rejected. Then they guess what was meant, or
   should have been meant, and that is what is deployed."* Every requirements tool that succeeded
   historically sold into regulated industries where the accountability was mandated, not chosen. No
   SDD vendor prices this, and no benchmark measures it.

2. **The spec layer is an unreviewed code-execution surface.** The same ETH paper that found
   repository overviews useless found instructions *are* obeyed: naming a tool raised its usage from
   under 0.01 to 1.6 invocations per instance. AGENTS.md, CLAUDE.md and `.specify/` files are
   committed, PR-able, and reviewed with markdown-level scrutiny while carrying shell-level
   consequence. One line landed in a spec file is more reliably executed than one line landed in code
   is reliably merged. Nobody is red-teaming the spec layer as a supply-chain surface — and Spec Kit's
   own README already warns that community extensions are "independently created and maintained".

3. **The oracle and the author are the same model.** Every "does reality still match intent" product
   ends in an LLM judge. Self-consistent errors "remain stable or even increase" as models scale, and
   semantic collapse is by definition unanimous. So the generator and the verifier fail *together*,
   and the failure is invisible by construction — no disagreement, no uncertainty signal, no
   clarifying question. Multi-sampling and LLM-as-judge, the two pillars of current evaluation
   practice, are both blind to correlated error.

4. **Nobody reports the cost of the specification itself.** Marmelab measured 1,300 lines across 8
   files for a feature that displays a date; ETH measured +20–23% inference cost and +2.45–3.92 steps
   per task. That is a recurring tax paid per task, forever. No SDD tool surfaces "tokens spent on
   spec overhead" as a metric, so nobody can compute the layer's return.

5. **Local-first's binding constraint in 2026 is the DRAM market, not model quality.** The
   local-inference discourse argues about parameter counts and quantisation. The actual gate is that
   memory prices reversed years of decline within months, Micron locked supply through 2031 and
   discontinued its consumer brand, and Raspberry Pi raised prices 70%. A strategy that assumes
   "consumer hardware gets cheaper" is betting against a contracted, multi-year supply squeeze.

6. **The intent gap has never been measured directly.** Every benchmark measures whether generated
   code passes tests. None measures *how many decisions the request left open, and who answered
   them*. Orchid, ClarEval and ClarifyCodeBench all measure the model's clarification *behaviour*,
   not the gap itself. The instrument in `src/intent/` is, as far as this search found, the only
   attempt at a model-independent decision taxonomy that counts silent machine decisions — and it is
   unpublished and untracked.

7. **Enterprise has no legal framework for bring-your-own-local-model.** "Enterprise-consumed tokens
   come with legal/data protection agreements. They have just gotten comfortable with BYOD — there is
   no BYOD equivalent set of practices and protections for local LLMs." Local-first is assumed to be
   the privacy-safe option; procurement has no instrument that says so.

---

## 9. Commodity vs stays hard

**Becomes commodity**

| Item | Label | Evidence |
|---|---|---|
| The markdown spec workflow (constitution → specify → plan → tasks → implement → converge) | OBSERVED TODAY | Spec Kit MIT, 134,096★; OpenSpec 67,659★ |
| Terminal coding-agent harness | OBSERVED TODAY | opencode-ai 12,089 npm versions; codex 122,500★; gemini-cli 106,870★; crush; cline 67,666★ |
| Local GGUF discovery, download, quant selection, serving | OBSERVED TODAY | llama.cpp 127,506★, plus Ollama and LM Studio |
| Chat-surface bridging (Telegram, Discord, iMessage, webhooks) | OBSERVED TODAY | Claude Code "Channels" names Telegram explicitly |
| Scheduling, subagents, hooks, sandboxing, memory files, MCP | OBSERVED TODAY | Claude Code docs, 2026-09-08 |
| Clarifying-question generation | OBSERVED TODAY | present in every plan mode; `/speckit.clarify`; Kiro requirements phase |
| Agent-to-agent payment rails | OBSERVED TODAY | x402 (Coinbase, Cloudflare Monetization Gateway Jul 2026); 3.1M transactions in 30 days reported Jun 2026 |
| Verified synthesis in verification-friendly languages | STRONG TREND | Dafny 68% → 96% in one year |
| Coding-model capability itself at the 60% resolve level | STRONG TREND | five distinct vendors within 2.2 points of each other on SWE-rebench |

**Stays hard**

| Item | Label | Evidence |
|---|---|---|
| Enumerating what a request does not say | OBSERVED TODAY | enumerate F1 0.26–0.48 vs judge 0.60–0.77; authored suites accept 19–42% of correct solutions; 10:1 omission-first failures over 43,227 items |
| Detecting a confident, unanimous, wrong reading | OBSERVED TODAY | 11%–49.7% of tasks solved wrongly with no clarifying question triggered |
| Making clarification help rather than hurt | OBSERVED TODAY | post-clarification collapse rises to 37.3%–76.5% on MBPP variants |
| Non-test acceptance constraints | OBSERVED TODAY | 221 of 644 test-passing repairs violate review constraints |
| Keeping spec, tests and code in sync at agent speed | STRONG TREND | Breunig's triangle; Böckeler; isoform "reality changes faster than specs do" |
| Getting a human to answer a decision list | STRONG TREND | organisational incentive, not capability; unchanged since DeMillo–Lipton–Perlis 1979 |
| Frontier-class agentic loops on consumer hardware | OBSERVED TODAY | 31.2% vs 64.5%; ~64GB practical floor; memory squeeze contracted through 2027+ |
| Retrieval in codebases past roughly 400k lines | OBSERVED TODAY | Sourcegraph CodeScaleBench grep threshold; retrieval noise worsens with more tools |
| A legal/procurement framework for BYO-local-model | OBSERVED TODAY | no BYOLLM equivalent to BYOD practice |
| Distribution for a solo builder in this category | OBSERVED TODAY | the nine largest competitors are all free and all shipped this week |

---

## 10. Open questions for the second wave

1. Run the corpus in `src/intent/corpus.ts` against three model families and report recall of the
   *known* decision set. If judging-only recall beats model enumeration by the margin the literature
   predicts, that is the single most defensible technical claim available to this project — and it is
   one experiment away.
2. Where exactly is the boundary between the ETH null result (−0.5% to +2.4%) and Vercel's +47pp?
   Measure resolve-rate delta as a function of how much of the needed information is recoverable
   from the repository itself.
3. Has anyone run `/speckit.converge` twice on the same brownfield repository and measured whether
   the loop actually closes? Star count is not usage, and this is the incumbent's answer to the
   thesis's final arrow.
4. What did Tessl's customers actually buy before the skills pivot, and did anyone pay for specs?
   This is the market's most informative negative result and it is undocumented.
5. What is the real per-completed-task *request* count for an agentic loop? Every free-tier argument
   in this lane turns on that one number and nobody publishes it.
6. Was the Amazon/Kiro 13-hour outage a specification failure or a permission failure? Get the FT
   original. The answer decides whether this thesis or a blast-radius/permission product is the right
   response.
7. Do the other lanes' proposed moats survive the fact that Spec Kit is MIT, free, at 134,096 stars,
   and already ships `converge`? Attack their strongest claim on that ground first.
8. Is `sandboxMode` in Shelra actually enforced on the bash path? Until answered, treat the wallet as
   compromised-in-principle and do not fund it.
9. Does the review-bottleneck framing survive 2026? DORA 2025 reversed DORA 2024 on throughput. If
   the bottleneck is dissolving through ordinary practice, the thesis's urgency premise weakens.
10. Is there any measured case of an explicit intermediate representation surviving three model
    generations without being rewritten? If not, the durability claim in the thesis has no
    precedent in evidence.
