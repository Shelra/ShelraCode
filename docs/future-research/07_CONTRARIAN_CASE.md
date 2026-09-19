# The contrarian case

**The strongest case for not building this.** Written by a lane instructed to attack the thesis, not to
help the project. Nothing here has been softened. Full text: `research/lanes/10-red-team.md`; its source
audit: `research/contradictions/verify-10-red-team.md`.

Where the audit corrected a claim, the correction is applied here.

---

## 1. The single strongest reason not to build this

> The thesis correctly names the problem — the gap between what a human meant and what the software does —
> and then proposes to close it with the one faculty the 2026 evidence says models do not have: enumerating
> what a request fails to say.

Models judge membership far better than they enumerate sets. They collapse *unanimously* onto one wrong
reading in 3–32% of tasks with no disagreement signal. And after one clarification turn, detrimental
collapse **rises** to 37.3–76.5% on MBPP variants.

Meanwhile the explicit-artifact layer the thesis says will "matter more" has been measured: repository
context files change resolve rate by **−0.5% to +2.4%, never significant**, while adding **20–23%**
inference cost and 2.45–3.92 extra steps.

And the market's best-funded pure play on this exact thesis — **Tessl, $125M** — removed spec-as-source
from its homepage and now sells a skills registry.

## 2. Load-bearing claims, attacked

| Claim | Verdict |
|---|---|
| The scarce problem is keeping intent ↔ spec ↔ code ↔ outcome aligned | **Survives as a problem statement; fails as a diagnosis.** It is a review-and-permission problem, not a specification problem. Amazon's 13-hour outage came from Kiro — a *spec-driven* tool — deleting an environment. A spec would not have stopped it; a blast-radius boundary would. |
| Explicit intermediate representations matter more as generation cheapens | **Fails for descriptive artifacts; survives narrowly for prescriptive ones.** |
| Intent can be elicited well enough to be a product | **Fails at product strength; survives as research.** |
| A small company can build something durable there | **Fails.** GitHub ships Spec Kit MIT at 134,096 stars including `/speckit.converge` — the reality-vs-intent check, given away. |
| Zero-cost inference is achievable | **Fails.** 50 requests/day without credits; Gemini's free tier trains on your content with human reviewers; best open-weight 31.2% against 64.5% frontier on contamination-free repository issues. |
| Deterministic acceptance checks make autonomy safe | **Fails as stated; survives as a floor, not a ceiling.** 221 of 644 test-passing repairs violate the review constraints that decide real acceptance. |
| Shelra is a reasonable base | **Fails.** See §5. |

## 3. The attacks that landed hardest

**Specification engineering becomes bureaucracy.** The two most-read practitioner assessments both
conclude the artifact volume exceeds its value. Marmelab: one feature — displaying the current date —
produced *"8 files and 1,300 lines of text"*, with developers *"spending 80% of your time reading instead
of thinking"*. Böckeler (Thoughtworks): Kiro generated *"4 user stories with 16 acceptance criteria"* for a
trivial bug fix, she would *"rather review code than all these markdown files"*, and spec-as-source risks
inheriting *"the downsides of both MDD and LLMs: Inflexibility **and** non-determinism."*

**Natural language already suffices for a large market.** Lovable reached $100M ARR in eight months and
$200M by November 2025 at a $1.8B valuation. The product is a prompt box, with no specification layer at
all.

**The residual failures may not be intent failures.** Sourcegraph's 1,281-run study across 40+
enterprise-scale repositories concluded: *"The difference between complete failure and near-perfect
completion wasn't intelligence — it was efficient access to context."* If that is right, the bottleneck is
retrieval infrastructure and this thesis is aiming one layer too high.

**Formal verification is the one place the attack failed** — and that is bad news, not good. Verified
synthesis is genuinely improving. But the same benchmark reports that *"adding natural-language
descriptions does not significantly improve performance"*: **vericoding works fine without the
natural-language layer the thesis centres on.**

**The crisis may be dissolving on its own.** DORA 2025 reversed DORA 2024 and now links AI adoption to
*higher* delivery throughput, framing AI as *"a mirror and a multiplier"*. If the bottleneck resolves
through ordinary organisational practice, the thesis loses its "why now".

## 4. Problems nobody is talking about, from the contrarian side

1. **The accountability tax.** The output is a written record of a decision someone must own, and the
   person who must adopt it is the person it exposes. As one practitioner put it: *"Developers have always
   been given ambiguous requirements, and questions about them have always been furiously rejected."* Every
   requirements tool that succeeded historically sold into regulated industries where accountability was
   *mandated, not chosen.* No vendor prices this and no benchmark measures it.
2. **The spec layer is an unreviewed code-execution surface.** Instructions in context *are* obeyed —
   naming a tool raised its usage from under 0.01 to 1.6 invocations per instance. `AGENTS.md`, skill files
   and MCP configs are committed and reviewed with markdown-level scrutiny while carrying shell-level
   consequence. Nobody red-teams the spec layer as a supply-chain surface.
3. **The oracle and the author are the same model.** Every "does reality match intent" product ends in an
   LLM judge. Self-consistent errors do not shrink with scale and semantic collapse is by definition
   unanimous — so generator and verifier fail *together*, invisibly. Multi-sampling and LLM-as-judge, the
   two pillars of current evaluation practice, are both blind to correlated error.
4. **Nobody reports the cost of the specification itself.** 1,300 lines for a date display; +20–23%
   inference cost per task, forever. No tool surfaces "tokens spent on spec overhead", so nobody can compute
   the layer's return.

## 5. The attack on Shelra itself

All measured directly in the repository on 8 September 2026.

- **11,577 lines across 72 untracked TypeScript files** — `autonomy`, `intelligence`, `exec`, `runtimes`,
  `providers`, `router`, `security`, and every other core module.
  `git stash` is empty; no branch holds this work.
- **Last commit 2026-05-15. Zero commits in 90 days.**
- **`npm view shelra` returns 404** while the README carries an npm version badge and instructs
  `bun add -g shelra`.
- `src/wallet/manager.ts` writes a private key as **plaintext JSON**; grepping the whole tree for
  `createCipher|scrypt|keytar|safeStorage` returns nothing. The workspace guard is imported by exactly one
  module, so the bash tool, MCP servers and the LSP client sit outside containment. *(Verified addendum: no
  `wallet.json` exists on the current machine, so this is latent, not live.)*
- Ship velocity against competitors: opencode-ai 12,089 npm versions, `@openai/codex` 4,330,
  `@anthropic-ai/claude-code` 507. Shelra: one maintainer, 0 commits in 90 days, 0 npm versions. *(The
  audit rated these version counts PLAUSIBLE rather than verified — WebFetch truncates large registry
  documents — and asks for re-derivation with a recorded command.)*

**Counterevidence the lane recorded itself:** the code quality is high. 69 test files against 213 sources,
**zero** TODO/FIXME markers across ~43,600 lines (the lane said one; the audit found none), a genuinely
symlink-hardened workspace path guard, and unusually disciplined module documentation. *This is not slop.
The problems are strategic and operational, not craft.*

## 6. What survived the attack

The lane attacked these and could not break them.

1. **The problem statement.** Something between what the human wanted and what shipped is the expensive
   part now.
2. **The judging/enumerating asymmetry as an architecture, not a defect.** The papers that most damage the
   naive product simultaneously license a specific design: supply the decision taxonomy from outside the
   model and use the model only to judge membership.
3. **Semantic collapse is real, large, and invisible to deployed detectors.** 11–49.7% of tasks receive an
   incorrect solution without ever triggering a clarifying question. **No shipped product addresses it.**
4. **Verification cost is genuinely collapsing.** 68% → 96% on pure Dafny in one year is a real
   discontinuity.
5. **Shelra's engineering discipline.**

## 7. Kill-assumptions, ranked, with the cheapest test for each

| # | Fails if | Cheapest test |
|---|---|---|
| K1 | A completed task costs more provider requests than a free tier grants per day, or free-tier terms make the tool unusable on private code | Instrument one run; count *requests* per completed task. One afternoon |
| K2 | The model cannot enumerate the decisions a request leaves open, or asking degrades the result | Score recall of a **known** decision set across three model families. Days |
| K3 | Spec Kit plus Claude Code already covers >80% of the intended surface | One afternoon with `specify init` on a real brownfield repo |
| K4 | Writing intent down changes outcomes by less than it costs | Replicate the ETH ablation on your own repo: 20 tasks × 2 arms. Two days |
| K5 | Things that pass your checks are still rejected by the person who asked | Grade 30 of your own autonomy-runtime completions by hand. One day |
| K6 | Requesters will not commit to answering a decision list in writing | Ten conversations with requesters, not implementers. A week |
| K7 | The differentiating work is unversioned and the distribution channel does not exist | `git status`, `npm view shelra`, one adversarial prompt. **Thirty minutes** |

## 8. What the source audit corrected in this lane

The verification pass rated the lane **46 VERIFIED, 6 PLAUSIBLE, 7 DISPUTED, 4 FABRICATION RISK, 5
OVER-LABELLED**. All eleven cited arXiv preprints exist with correct titles, authors and dates.

Three corrections matter and are applied above:

1. **A quotation that does not exist.** The lane attributed to Gavran the phrase *"once deemed impossible,
   now approaches feasibility through LLM-powered tools."* Two independent fetches: those words do not
   appear. The real sentence is *"LLM-powered tools are closing this gap quickly."* The substance survives;
   the quote does not. It sat inside the lane's most load-bearing *positive* conclusion.
2. **A precise statistic with no source anywhere.** "Agent-to-agent payment rails · 3.1M transactions in 30
   days" has no citation in the lane's own register. **Deleted, not propagated.**
3. **"The community reading" was a 3-point Hacker News thread with 4 comments.** The narrative that
   spec-driven development peaked and receded now rests where it should: on the fully-verified Tessl pivot
   ($125M, Index/Accel/GV/boldstart, and a homepage that today contains no occurrence of "spec"), with the
   HN threads as anecdote.

One statistic was also welded from two different measurements: the real figures are overall CI throughput
+59% year over year, feature-branch +15% for the median team, main-branch −7% with 70.8% success — a spread
of about 22 points, not the ~66 the lane implied.

**The other nine lanes were not audited.** Verification was stopped for cost.
