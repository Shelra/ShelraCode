# Post-mortem: the "silent consensus" experiment (abandoned before execution)

Written 2026-09-08 by the lead. Recorded because the mission requires negative results to be kept
(§75, §96) and because the failure modes here should discipline every later experiment in this plan.

**Status: abandoned. Never executed. No result was produced. Code exists at `src/intent/` and is
contaminated — see Disposition.**

## What was hypothesised

For prose-described *stateful* software, a large fraction of consequential unspecified decisions is
resolved uniformly by a model across independent samples. Because the state of the art in behavioural
ambiguity detection works by sampling interpretations and flagging *disagreement*, that unanimous
subset would be structurally invisible. A fixed, model-independent catalogue of decision classes was
proposed to recover it, motivated by the judging-beats-enumerating asymmetry.

## Why it was abandoned — three independent findings

### 1. The core claim was already published (fatal)

Richter & Papadakis, *Underspecification does not imply Incoherence: The Risks of Semantic Collapse
in Coding Models*, arXiv:2607.01953, 2 July 2026. Verbatim from the abstract: LLMs "frequently
collapse onto a single incorrect interpretation of the task description, consistently generating
coherent but behaviorally misaligned code… we term this failure mode detrimental semantic collapse".
They sample k∈{1,5,10,25}, cluster by test-observed behaviour, define collapse as unanimity, and
report >10% MBPP, 3% HumanEval, 32% LiveCodeBench, rising ~5× under injected underspecification.
They explicitly name ClarifyGPT and SpecFix and simulate ClarifyGPT's protocol to show it stays
silent on collapsed cases.

The lead had searched for this and missed it by searching its own coined vocabulary ("silent
consensus") instead of the field's ("semantic collapse", "coherence"). **Lesson: search the concept
under at least three vocabularies, including the one an author who disagreed with you would use.**

### 2. The design could not produce a negative (fatal)

An adversarial review of the apparatus found the experiment structurally incapable of falsifying its
own hypothesis. The two disqualifying defects:

- **The ground truth was closed under the probe catalogue.** `Decision.category` was typed as
  `ProbeCategory`, making it impossible to record a ground-truth decision outside the ten classes the
  probe arm was handed. The wording alignment was near-verbatim: one probe's throwaway example list
  ("a rate, a price, a tax, an address") appeared as four separate ground-truth decisions across
  three domains. The probe arm was graded against its own answer key.
- **The silent-consensus set was defined by the instrument the study then showed could not find it.**
  The sampling prompt in the measurement function and in the divergence arm were the same string.
  The divergence arm's failure was guaranteed by construction, not discovered. The report template
  additionally hardcoded the unfalsifiable sentence "No sampling-based detector can reach these,
  however it is implemented."

Further defects, each biasing the result the same way: forced commitment ("do not hedge") suppresses
the very hedging a real detector uses; K=5 unanimity has a 95% lower bound of only p≈0.55, so ~4 of
72 decisions would be spuriously labelled unanimous; K samples were byte-identical calls with no
temperature control; index misalignment could silently fabricate unanimity; "precision" was
mechanically capped at 12/itemsRaised and was really a terseness penalty; and with 6 cases the
sign test's best achievable p is 0.031, only on a 6-of-6 sweep.

### 3. The corpus was not valid (severe)

An independent audit of the 72 ground-truth decisions found 38% failing at least one validity test:
8 not actually undetermined by the request, 3 with no behavioural consequence, and **23 with broken
discriminators**. The discriminator failures shared one craft error — the scenario repeatedly picked
the parameter value at which two options coincide (cancelling 3 h before when the windows are 24 h
and 6 h; rounding 7.145 where banker's and customer-favouring rounding agree). One decision (iv-12)
asked something the request already answered in its own text. Effective independent decision count
after de-duplication was nearer 60 than 72.

## What survives as usable evidence

- **Semantic collapse is real and quantified** — by someone else, on stateless function-level tasks.
- **The stateful case is genuinely unmeasured.** That is a narrow, legitimate gap, and it is a
  "port an existing finding to a harder corpus" contribution, not a conceptual one.
- **The judging/enumerating asymmetry has not been applied to requirements elicitation.** A fixed,
  model-independent catalogue compared head-to-head against open enumeration, motivated by that
  asymmetry, was not found in the literature. The nearest neighbours are Vijayvargiya et al.
  (taxonomy weights a reward, questions still open-ended) and REA-Coder (checklists, but generated
  per problem). This remains the most defensible fragment of the original idea.
- **Existing benchmarks should be used before building a corpus**: ClarEval already implements
  specification reduction; Orchid has 5,216 annotated ambiguity variants; ClarifyCodeBench has 419
  annotated real-world tasks. A new corpus needs a reason those cannot serve.

## Methodological rules this failure imposes on the rest of the mission

1. **Prior art before apparatus.** No experiment is designed until the concept has been searched
   under the field's own vocabulary and the three nearest published systems have been read.
2. **The ground truth may not be typed by, derived from, or authored with knowledge of the mechanism
   under test.** If the same person or model produces both, the result measures leakage.
3. **Every design must be checked by asking which result would falsify it and whether the apparatus
   can physically produce that result.** If no route to a negative exists, the experiment is a
   confirmation ritual and must not be run.
4. **Report the achievable p before collecting data.** With n clusters, state the best possible
   result under the intended test.
5. **A measurement instrument is a paper, not a product.** Establishing a number does not establish
   that anyone would pay for the thing that acts on it.

## Disposition of `src/intent/`

~1,100 lines across `types.ts`, `corpus.ts`, `probes.ts`, `arms.ts`, `scoring.ts`, `experiment.ts`,
plus `scripts/run-intent-experiment.ts`. Never committed; never executed to completion.

Classification for the legacy-disposition section of the final plan: **DELETE**, with two exceptions
worth extracting if a later phase needs them —

- the arm-harness shape (uniform de-duplication before scoring; a judge blind to arm identity and
  seeing shuffled items) is sound and reusable;
- `src/intelligence/` (not part of `src/intent/`) proved itself here as a clean provider-agnostic
  question/answer boundary with structured output and per-call cost accounting. It ran real calls at
  ~$0.003 each and reported cost honestly. That module is a genuine asset.

The corpus and probe catalogue must not be reused. They are contaminated by construction.
