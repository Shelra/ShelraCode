# Unserved problems, ranked

Full evidence: `research/lanes/08-market.md`. Every "unserved" call was made only after searching for
competitors, and the searches are recorded in the lane. **Confidence on every "APPARENTLY OPEN" call is
downgraded** because the session's web-search budget was exhausted and discovery ran through news RSS and
arXiv rather than general search — absence of a competitor is weaker evidence here than usual.

Reader constraint: **solo, unfunded, no distribution, no unfair advantage.** The ranking reflects that.

---

## The ranking

| # | Problem | Classification | Solo-viable? | Verdict |
|---|---|---|---|---|
| 1 | **Longitudinal intent conformance** — does the system still do what we agreed? | UNDER-SERVED | Yes, conditionally | **Selected.** See `08_SELECTED_THESIS.md` |
| 2 | **Predicate elicitation** rather than examples | RESEARCH-STAGE | Not a company | The *mechanism* that makes #1 tractable |
| 3 | **Productised remediation** — ship the fix, not the finding | EMERGING (services) / UNDER-SERVED (product) | Yes — revenue in month one | The honest fallback |
| 4 | **Comprehension measurement** — how much do we actually understand? | APPARENTLY OPEN (low confidence) | Weak | The buyer must commission evidence of their own ignorance |
| 5 | **Correlated monoculture defects** across unrelated codebases | APPARENTLY OPEN / RESEARCH-STAGE | No | Real network effect, impossible to start solo |
| 6 | **Triage capacity for OSS maintainers** | UNDER-SERVED (demand without budget) | No | Emotionally compelling, commercially poor |

---

## 1. Longitudinal intent conformance — **selected**

**Problem.** Every product accumulates things it was supposed to do. Nothing in the toolchain checks, on an
ongoing basis, whether those things are still true. Review checks diffs. Tests check what someone
remembered to assert. Observability checks whether it is up.

**Evidence it exists.** Lahiri names the intent gap as *"magnified by AI-generated code"* and states the
crux: *"since specifications lack an independent oracle, verifying that they truly capture user intent is
difficult and user-dependent."* The Specification Paradox paper names Specification Overfitting and
Specification Debt. SpecOps 2026 exists to *"transform specifications from static documentation into
living, executable, and lifecycle-spanning drivers."*

**Why current tools fail.** Kiro and Spec Kit generate specs at the start and abandon them. Requirements
suites (Jama, Codebeamer, Polarion) maintain traceability by human labour and target certification.
Review tools compare a diff against standards, not a system against its commitments. And the formal path
is not ready: end-to-end certified synthesis on 946 real problems is **5.29%**.

**Existing competitors.** Baz's spec-reviewer agent — per-PR, planning-time, genuinely in the space.
Qodo's rules miner mines *observed practice*, not *intended constraints*, and cannot express a rule the
team has never yet followed. Kiro and Spec Kit author only. **arXiv search for "specification drift code
intent conformance" returned zero results.**

**Why the gap persists.** Three reasons, and they are the real barriers. (i) *The artifact does not exist* —
most teams have no durable statement of intent to check against, so the product must first create its own
input. (ii) *The measurable proxies say nothing is wrong* — revert rate flat, merge rate flat, so nobody is
alarmed. (iii) *It is a schlep* — extracting intent from tickets, docs and conversations is unglamorous
operational work of exactly the kind founders skip.

**Defensibility.** The accumulated, verified intent corpus for a specific codebase compounds, does not
transfer between customers, and cannot be shortcut by an incumbent — Codex `/import` moves configuration,
not decision history. Counter-positioning holds: agent vendors sell velocity, and a product whose job is to
say *"this change violated a commitment you made"* is a brake.

**Falsification.** 50 merged PRs from a repo with written commitments; count silent violations that broke
no test and caused no revert. **Under ~5%, the problem is imaginary.**

**Solo conditions.** Start where an authoritative spec already exists and is semi-machine-readable —
OpenAPI, RFCs, ADRs, EARS requirements, IaC policy — rather than eliciting intent from scratch. RFCAudit is
the existence proof: **47 real bugs at 81.9% precision against RFC prose.** Build predicates and use the
model as judge, never enumerator. Ship as an OSS CLI in CI. **Do not sell requirements management** — that
is enterprise sales you cannot do.

## 2. Predicate elicitation

Every AI dev tool asks humans for the wrong thing: examples, tests and prose — the artifacts models are
worst at completing — instead of rules. Models reach **F1 ≈0.99 specifying predicates** against 19–42% for
authored acceptance sets.

Spec Kit and Kiro produce prose requirements documents; eval platforms ask for example-based test sets.
Both are the enumeration mode the research says is weakest. The finding is six weeks old and cuts against
the entire "just describe what you want in English" narrative the industry spent two years selling.

Not a company — it is an interaction design, and designs get copied. It is the **component** that makes #1
work where earlier spec tools failed.

## 3. Productised remediation

The market discovered that generating is cheap and *finishing* is expensive, and is solving it by hiring
freelancers. Freelancer.com AI-cleanup listings rose **87%** from August 2025 to June 2026, reaching 10,760
posts; Upwork +70% YoY; Fiverr "AI cleanup" searches up **more than 20×** since 2023.

Tools return findings; someone still has to land a correct change. The gap between "here is a diff" and
"this is merged, tested and not a regression" is the entire cost — and the reason vendors avoid it is
liability, not difficulty. GitHub publicly *disputed* Wiz's claim that Copilot Autofix wrote a Snowflake
flaw in August 2026, which shows how contested fix-liability already is.

**The only candidate producing revenue in month one**, requiring no distribution beyond a marketplace
profile and no funding. Falsification: do it by hand for ten customers at a fixed price; if you cannot
reach a positive margin manually, no automation saves it. **Realistic ceiling: a good solo income, not a
company** — which, for an explicitly solo bootstrapped reader, may be the correct answer.

## 4. Comprehension measurement

Organisations have no instrument for the quantity that now matters most: how much of their codebase any
human can correctly reason about. Every proxy that used to work was an authorship proxy, and **authorship
no longer implies understanding** — *"the same footprint is now compatible with full, partial, or no
understanding."*

"Comprehension debt" became a named research construct in under twelve months (621 diaries, 207 students).
Meanwhile the six vendors in SD Times' 2026 Software Engineering Intelligence category — Plandek,
Allstacks, Broadcom, Gitkraken, LinearB, Jellyfish — all measure delivery, flow or productivity. **None
claims to measure comprehension.**

Why it persists: **it measures the buyer's own failure.** An engineering leader who installs a comprehension
meter is commissioning evidence that their organisation does not understand its own system, exactly when
being asked to justify AI spend. That is a *won't*, not a *can't* — the more durable kind of moat, and also
the reason the market may never exist.

Caution: a widely circulated Forbes piece attaches hard numbers to comprehension debt (PRs +20%, incidents
per PR +23.5%, privilege escalation +322%) and **cites no sources for any of them**. None could be verified.
Do not propagate those figures.

## 5. Correlated monoculture defects

When thousands of teams use the same three models, they receive the same wrong answers. A defect stops
being an isolated event and becomes a template replicated across unrelated organisations sharing no code,
no vendor and no dependency edge.

"AI Code in the Wild" (1,000 top repositories, 7,000+ CVE-linked changes) finds *"near-identical insecure
templates recur across unrelated projects"*. The mechanism is documented separately: semantic collapse
converges models on a single wrong reading in 3–32% of tasks, invisible to disagreement-based detection,
and self-consistent errors do not diminish with scale.

SAST and SCA are per-repository and per-known-CWE. Dependency tools watch graphs — but **monoculture
defects spread with no dependency edge at all**, so graph-based propagation analysis is structurally blind.
There is no CVE-equivalent for "this model version systematically emits this wrong pattern", no disclosure
channel, and no vendor whose job it is to notice.

Genuine network effect: each corpus member improves detection for all. And that is exactly why it cannot be
started solo — you need the corpus before the product. The one solo-viable version is a public-corpus
research report, which converts to money only via consulting or acquisition.

## 6. Triage capacity for OSS maintainers

Linux went from ~500 CVEs per release to **over 1,500** by 7.2; security reports from 2–3 per week to 5–10
per day; Torvalds called the private security list *"almost entirely unmanageable"*. Apple capped open
bug-bounty reports and added a 30-day cool-off in June 2026, citing AI-generated submission volume.

And the flood is not pure noise — one AI tool found six real curl vulnerabilities that two others missed —
which is precisely what makes triage unavoidable.

**Why it stays unserved: the people with the problem have no money.** The classic structure of a problem
that stays unserved. Take it only as a credibility-building loss-leader.

---

## Second-order effects worth tracking

- **Supply and demand have decoupled.** ~560,000 new App Store apps in H1 2026, on pace to exceed 1 million
  for the year, against download growth of 2–3%.
- **Build-vs-buy is shifting but failing.** 32% of organisations chose to build rather than buy — while
  internal builds succeed ~33% of the time against ~67% for vendor tools. The two findings sit in the same
  article and point in opposite directions.
- **The apprenticeship pipeline is thinning.** Employment for 22–25-year-olds in AI-exposed occupations is
  19% below trend, widening since August 2025. Note the figure is for AI-exposed occupations generally, not
  software developers specifically — no software-specific figure could be verified.
- **The AI-governance why-now slipped 16 months.** EU AI Act high-risk obligations moved from 2 August 2026
  to **2 December 2027**. Do not build to a deadline regulators keep moving.
