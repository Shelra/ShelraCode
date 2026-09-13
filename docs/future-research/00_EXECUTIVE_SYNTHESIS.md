# Executive synthesis

**Deep Future Research Mission · 8 September 2026 · research only, nothing was built**

Ten parallel research lanes, ~700 sources, all fetched on 8 September 2026. The full audit trail is in
`research/` — per-lane reports, source registers, the contradiction matrix, and lead-level hypothesis
notes. Every claim below carries a label: **OBSERVED TODAY · STRONG TREND · REASONABLE EXTRAPOLATION ·
SPECULATIVE**. Nothing thirty years out is above REASONABLE EXTRAPOLATION.

One methodological caveat, stated up front: the session's web-search budget was exhausted after the
first two lanes. Eight lanes ran on direct primary fetches, the arXiv/OpenAlex/Crossref APIs, the GitHub
and npm registries, and live API calls. That is a *stronger* evidence class per source, but it narrows
discovery — it biases the corpus away from vendor marketing, analyst reports and non-English material.
Source verification was run on one lane of ten before being stopped for cost; its results are in §8.

---

## 1. Where is software development going?

**Not toward specification. Toward verification.** (STRONG TREND)

The lane that studied thirty years of abstraction shifts found the property that separates the ones that
won from the ones that stalled, and it is not expressiveness or tooling:

> The shifts that reached majority adoption — high-level languages, logic synthesis, SQL, declarative
> infrastructure — had a **fixed, machine-checkable target semantics**, and their residual gap was a
> *performance* gap, not a *correctness* gap.

SQL won although its optimiser is routinely wrong by factors of 1000×, because a bad plan is slow, not
incorrect. Logic synthesis won because Boolean equivalence between RTL and gates is decidable and was
industrialised in about eight years. High-level synthesis has stalled for **thirty years** because
turning C into RTL requires *inventing* a micro-architecture — a design decision, not a translation.

Intent → code sits on the failure side of that line. No decidable check exists between an English intent
and a program, and the residual gap is a correctness gap. This is Parnas in 1985, quoted by Brooks: *"in
most cases it is the solution method, not the problem, whose specification has to be given."*

So the trajectory is not "specifications replace code". It is that **the primary engineering activity
becomes the design and maintenance of executable checks** — what lane 01 calls oracle engineering, and
what lane 03 shows the market has already started reaching for and failing to build.

## 2. What becomes commodity?

**Everything upstream of the check.** (OBSERVED TODAY)

Twenty-plus agent capabilities are now shipped by three or more independent systems, at least one free
and open-source: the agent loop, terminal and file tooling, repo search, skills, hooks, subagents, MCP,
plugins, sandboxing, checkpoints, background and scheduled agents, goal mode, procedural memory, model
routing, browser control, PR review, security scanning, spec-document generation, and clarifying
questions as a feature.

Two facts fix the ceiling for any new entrant:

- **The absorption lag collapsed from 6–7 months in 2025 to 26 and 19 days in August–September 2026.**
- **Codex `/import` pulls a user's entire Claude Code or Cursor setup — instructions, settings, skills,
  plugins, projects, 50 recent chats — with optional sync**, and Copilot, Cursor and OpenCode read each
  other's directories. Configuration lock-in no longer exists for anyone to sell.

The benchmark community has formalised the verdict: swebench.com now defaults to a "Bash Only" view that
runs every model inside mini-SWE-agent, a ~100-line bash-only harness, with the tooltip *"so scores
compare models rather than harnesses"*. If you are building a better agent loop, you are building the
thing the field has agreed to hold constant.

## 3. What becomes scarce?

**The oracle.** Four lanes reached this independently, and lane 03 supplies the decisive economic shape:
**the cost curve has split in two.** (OBSERVED TODAY)

| | Direction | Evidence |
|---|---|---|
| Proving a **given** property | Collapsing fast | Schwarz solves 91.5% of SV-COMP ReachSafety; CryptoProver replaced 8 months × 5 engineers with 11.4 hours and $467; pure Dafny verification went 68% → 96% in a year |
| Writing the property that captures **intent** | Barely moved | VeriContest spec-generation 48.3%; end-to-end certified synthesis on 946 real competitive problems is **5.29%**; adding natural-language descriptions to formal specs does not help |

Everything else the mission examined is a restatement of that split. Lane 04's three-condition test for
when spec-as-source works — cheap regeneration, no hidden state, **a cheap continuous oracle** — and its
finding that general software fails the third condition hardest, not the first. Lane 02's verdict on the
circular-specification problem: the machine absorbs most of the cost of vagueness (+29.7% tokens for a
bare user story instead of a full spec), but *"the circularity bites hardest exactly where no oracle
exists."* Lane 01's historical pattern. Same constraint, four vocabularies.

Also scarce, and worse than assumed: **human review attention**, which scales linearly with headcount
while generation scales multiplicatively per developer.

## 4. What will humans do, and what will machines derive?

The division of labour is the inverse of the popular one. (STRONG TREND)

> The machine is good at **checking** and bad at **specifying**.

Measured: on executable code, models judging a candidate reach F1 0.74–0.90, while the acceptance suites
those same models author admit only **19–42%** of oracle-correct solutions. Asked to emit a *predicate*
rather than enumerate its extension, the same models reach **F1 ≈0.99**. Omissions are detected 6–7×
less often than over-inclusions; one 43,227-item production deployment failed omission-first at 10:1.

Three separate literatures found this boundary in three vocabularies — acceptable sets, instantiation
correctness, XMI instance models — and **none of them cites the others**. The design rule that falls out
has never been written down: *an intent artifact must be a rule language, and the instance layer must be
produced by deterministic tooling, never by the model.*

But the human side has a hard limit too, and it breaks the field's founding assumption. Lahiri's premise
is that *"there is no oracle for specification correctness other than the user"*. That was tested in
July 2026: **86 programmers judged incorrect machine-generated assertions at 49% accuracy — chance —
while reporting the same confidence as on correct ones.** Natural-language explanations did not help;
low-quality explanations *lowered* accuracy while *raising* confidence.

So the human is not a reliable validator either. The product cannot be "ask the human to confirm". It
can only be **make the decision visible and cheap to contest**.

## 5. What is the strongest unresolved problem?

**There is a class of decision now being made at machine volume, by machines, with no record — and no
instrument exists that would tell us whether it matters.** (OBSERVED TODAY)

The number: **24.7% of requirement decisions are "structurally valid but discretionary choices not
explicitly mandated by the stakeholder"**. Not bugs, not requirements — authorship, exercised by a
machine, attributed to nobody. Software has provenance for code (blame, review, sign-off) and for
requirements (traceability). It has **none for discretion**. Nobody is building the record *"the system
chose X; the human never said anything about X; here is the list."*

Three adjacent gaps confirm the same hole from other angles:

- **No review surface shows what is absent.** Every review UI ever built shows what *is* there. The
  dominant error is omission and it is structurally unauditable by diff.
- **Behavioural diffing is the emptiest square on the board.** The best shipping tool
  (`cargo-semver-checks`) explicitly refuses to detect behavioural changes; academic semantic
  differencing peaked in 2014 and the LLM wave has not touched it. There is no `git merge` for intent.
- **Evidence invalidation barely exists as a field.** "Incremental verification" returns 8 arXiv hits
  since 2024; "regression verification" 2; "specification drift" essentially nothing in software
  engineering.

And the market signal that the gap is deliberate, not merely unnoticed: **OpenSpec issue #987, asking for
executable specs — "Spec IS the test — no duplication, no drift" — was closed as _not planned_.**

## 6. Does the north-star chain survive scrutiny?

**Partly. Two of its premises are now contradicted by evidence.**

| Premise | Verdict |
|---|---|
| The chain intent → understanding → spec → software → reality is the right decomposition | **Partly false.** The unowned object is *orthogonal* to the chain: it is the log of every place an arrow was traversed without a human. |
| Each arrow loses information and the losses compound into a visible crisis | **Unsupported as stated.** The best primary panel (802 developers, 196,212 PRs) shows throughput at 2.09× with **merge rate flat and revert rate slightly down**. The bottleneck was resolved by lowering the standard: human review coverage fell 89% → 68% while automated review rose 19% → 84%. |
| A representation richer than Markdown is needed | **False.** Markdown won 470,795 `spec.md` files across 73,030 repos against ~1,345 GitHub stars for the entire SysML v2 ecosystem in six years. LSP won by explicitly *refusing* to standardise a semantic representation. And **AI is anti-DSL**: model competence tracks training-corpus mass, so on ATL "Pass@1 remains unchanged across all strategies and models". A private notation is now a tax, not a lever. |
| Explicit intermediate artifacts matter more as generation cheapens | **False for prose, open for predicates.** The only rigorous ablation (438 tasks, 4 agents, ETH) found LLM-generated context files change resolution by −0.5% to +2.4%, never significant, at +20–23% cost. Every *partial, predicate-shaped* intervention measured a real gain. |
| Reality ↔ intent alignment matters and is unserved | **Confirmed, and it is the emptiest arrow.** No product in any lane's scope checks a shipped change against the intent that motivated it. |

The honest problem statement, which lane 08 wrote better than the brief did:

> The failure modes we can currently measure have not worsened. Reverts catch breakage in days; nothing
> in these datasets can see a requirement quietly implemented wrong. Anyone selling "AI is breaking
> production" is ahead of the evidence — and anyone concluding "therefore it is fine" is mistaking the
> absence of a measurement for the absence of a problem.

## 7. What should Shelra become — and stop trying to become?

**Stop:** being a coding agent. Every layer of the current product is in the commodity table above, and
the differentiators map one-to-one onto features Claude Code shipped this year — Telegram bridge →
Channels, schedule → Routines, delegations → subagents, hooks → hooks, sandbox → sandboxing. The
remaining non-overlap is local GGUF management (against llama.cpp at 127k stars, plus Ollama and LM
Studio) and crypto payments, whose rails belong to Coinbase and Cloudflare.

Also stop: local-first as an economic argument. It dies on electricity before model quality — local
inference costs $0.14–0.17 per million output tokens in US residential power *alone*, at parity with the
cheapest cloud open-weight pricing, and 20 of 26 notable 2026 open-weight models need >128 GB at 4-bit.

**Become:** an instrument, then possibly a tool, for the record of machine discretion. See
`08_SELECTED_THESIS.md` for the thesis and `10_PHASED_PLAN.md` for the falsifiable phases. The first
deliverable is a measurement, not a product, because the problem statement in §5 is currently an
assertion.

Disposition of the existing code is in `09_SHELRA_IMPLICATIONS.md`. Summary: two modules survive
(`src/intelligence/`, `src/autonomy/`), most of the rest is commodity surface, and 11,577 lines of the
differentiating work are sitting **uncommitted** in the working tree.

## 8. Research verdict

# PURSUE CONDITIONALLY

Conditional on one experiment, which is cheap, decisive, and needs no new corpus:

> Take 50 merged pull requests from a repository that has written commitments — ADRs, an OpenAPI
> contract, EARS requirements. Count how many silently violated a stated commitment **without breaking a
> test and without causing a revert**.
>
> **Below roughly 5%, the thesis is dead and the project should stop.**

The reasoning for "conditionally" rather than "pursue": the problem is real and unowned, four independent
lanes converge on the artifact, and it passes the durability test that kills most tooling ideas — it does
not get less useful when models improve, it gets *larger*, because a more capable model exercises more
discretion, not less. But the base rate is unmeasured, the buyer has no dashboard telling them they have
the problem, and the incumbents are 19 days away from anything legible.

The reasoning against ABANDON: every alternative candidate was eliminated by evidence rather than taste,
and the one that survived was independently reached by an adversarial lane instructed to kill the thesis.

**Honest ceiling.** For a solo, unfunded builder the realistic outcome is a sharp public measurement and
a small OSS tool that does one thing existing agents do badly — not a company. Lane 08's candidate U5
(productised remediation) is the only option that produces revenue in month one, and its ceiling is a
good income. That should be said plainly before anyone spends months.

## 9. Verification status

Source verification ran on lane 10 before being stopped for cost. Of its claims: **46 VERIFIED, 6
PLAUSIBLE, 7 DISPUTED, 4 FABRICATION RISK, 5 OVER-LABELLED**. All eleven cited arXiv preprints existed
with correct titles, authors and dates; the load-bearing figures (ETH ablation with both p-values,
vericoding, SWE-Gate, semantic collapse, Tessl's funding and homepage pivot) checked out verbatim.

The failures were specific and instructive: one quotation that does not exist in its source, one precise
statistic with no citation anywhere, one CI figure welded from two different measurements, and one
"community reading" resting on a 3-point Hacker News thread. Two corrections propagated into this
synthesis, and one number the lead had relayed earlier — the judge-vs-author F1 pair 0.60–0.77 / 0.26–0.48
— was found to come from a single-task Qwen2.5 scale sweep rather than a cross-model result; the
cross-model figures (0.74–0.90 against 19–42%) are used here instead.

**The other nine lanes are unverified.** Treat their headline numbers as sourced-but-unaudited. The one
number this synthesis explicitly does *not* rely on is "+98% PRs / +91% review time", whose provenance
lane 08 could not establish.
