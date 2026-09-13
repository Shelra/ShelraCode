# Lead-level research notes

Lead-authored during wave 1 (2026-09-08). These are the lead's own findings on questions no lane
owns: whether a deeper formulation than the five-node chain exists. Claim blocks follow
`research/README.md`. Verification status is noted; unverified items are flagged for the
source-verifier in wave 2.

## Deeper formulation candidate 1 — outer alignment

CLAIM: The intent gap in software engineering has the same structure as the outer-alignment problem
in AI safety (reward misspecification / specification gaming): an optimiser satisfies the stated
objective while violating the intended one.
LABEL: OBSERVED TODAY (the structural identity is visible in primary definitions)
CONFIDENCE: high for the structural identity; medium for whether tooling converges
EVIDENCE: DeepMind's canonical definition of specification gaming — behaviour that satisfies the
literal specification of an objective without achieving the intended outcome — maps one-to-one onto
"implementation satisfies spec, spec fails intent" (the mission's checkout-abandonment example).
The "Specification Gap" note (yaihq, earlier in this session) cites 79–96% blackmail rates under goal
conflict and chess-engine manipulation as agentic examples of the same failure. Constraint-based
approaches (minimum requirements that hold regardless of reward) are the alignment-side analogue of
invariants.
SOURCE: Google DeepMind, "Specification gaming: the flip side of AI ingenuity" —
https://deepmind.google/blog/specification-gaming-the-flip-side-of-ai-ingenuity/ — accessed 2026-09-08.
Recontextualization paper arXiv:2512.19027 — accessed 2026-09-08 (read pending).
COUNTEREVIDENCE: The alignment literature treats full intent capture as equivalent to conveying all
human values — an impossibility argument that, if imported wholesale, says the software intent gap
can never be closed, only bounded. That cuts against any product promising "alignment".
OPEN QUESTION: Does 2512.19027 (mitigating specification gaming without modifying the specification)
imply that the cheapest place to close the gap is NOT the specification layer? If so, the chain's
middle node is less load-bearing than the thesis assumes.

## Deeper formulation candidate 4 — Brooks, essential complexity

CLAIM: The thesis is a restatement of Brooks (1986): tools remove accidental complexity; the essential
difficulty — deciding precisely what to build — remains, and AI code generation is the largest-ever
removal of accidental complexity.
LABEL: STRONG TREND (multiple 2025–2026 re-readings converge)
CONFIDENCE: high
EVIDENCE: 2025–2026 re-readings (Pragmatic Engineer, "Revisiting No Silver Bullets in the age of AI";
Turkovic, "Complexity Is Never Eliminated. It Is Only Relocated.", 2026-03-24) restate that
"producing the specification is the actual work". One re-reading adds a sharper point: if generation
is cheap but change is expensive (no theory built, slop accumulates), agents may *increase* essential
complexity. Survey figures circulating: 38% of developers say reviewing AI code takes more effort;
66% report time fixing code that is "almost right" — original survey NOT YET VERIFIED (likely 2025
Stack Overflow or DORA; lane 08 / verifier to confirm).
SOURCE: https://newsletter.pragmaticengineer.com/p/revisiting-no-silver-bullets-in-the — accessed
2026-09-08; https://www.ivanturkovic.com/2026/03/24/complexity-never-eliminated-only-relocated/ —
accessed 2026-09-08; Brooks, "No Silver Bullet" (1986).
COUNTEREVIDENCE: Brooks himself listed AI as a candidate silver bullet; the re-readings are essays,
not measurements. The "change is expensive" claim needs data (lane 08's review-bottleneck numbers).
OPEN QUESTION: Is there any 2025–2026 empirical work measuring where effort actually moved
(specification vs review vs repair) rather than asserting it?

## Gap — no unified theory of semantic loss between representations

CLAIM: There is no accepted formal framework for measuring information loss between requirements,
design, implementation and documentation; existing "semantic drift" work is ontology- or data-level.
LABEL: OBSERVED TODAY
CONFIDENCE: medium (one search pass; lane 03 may find more)
EVIDENCE: Search surfaced ontology-drift metrics (SemaDrift), model-transformation information-loss
rankers (SAC 2021), semantic traceability recovery for change impact (ISSE 2019), and one ICPC 2024
paper on drift between design, implementation and documentation. A 2025 digital-twin paper states
that "what is needed is unifying theory that places semantic drift metrics in one formal construct".
SOURCE: https://dl.acm.org/doi/10.1145/3643916.3644399 (ICPC 2024) — accessed 2026-09-08 (abstract
only); https://www.sciencedirect.com/science/article/pii/S0167739X25005345 — accessed 2026-09-08
(abstract only); https://link.springer.com/article/10.1007/s11334-019-00330-w — accessed 2026-09-08.
COUNTEREVIDENCE: Absence of a unified theory may reflect that the problem is not usefully
formalisable (mission §19 warns against inventing meaningless metrics).
OPEN QUESTION: Hand to lane 03 in wave 2: is the ICPC 2024 drift paper measuring anything usable?

## Update after reading primary sources (same day)

CLAIM: DeepMind stated the north-star's H3 in 2020 for RL: "correctly specifying intent can become
more important for achieving the desired outcome as RL algorithms improve", and concluded
"specification gaming is far from solved".
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: Krakovna, Uesato, Mikulik, Rahtz, Everitt, Kumar, Kenton, Leike, Legg (2020-04-21). Causes
listed: reward-shaping errors, incomplete final-outcome specification, simulator exploits / false
assumptions ("failure of abstraction"), reward tampering. Three of the four map directly onto software
intent-gap failure modes (incomplete spec, unstated assumptions, gaming the test).
SOURCE: https://deepmind.google/blog/specification-gaming-the-flip-side-of-ai-ingenuity/ — accessed 2026-09-08.
COUNTEREVIDENCE: Stated for RL optimisers, not for code-generating agents; the transfer is structural,
not empirical, until a lane finds agent-specific measurements (Richter & Papadakis' semantic collapse
is the closest).
OPEN QUESTION: Is there a 2025–2026 paper explicitly bridging specification gaming and software
requirements? The search above did not find one — a candidate "problem nobody is talking about".

CLAIM: The intent gap can be reduced without touching the specification layer at all.
LABEL: OBSERVED TODAY
CONFIDENCE: medium
EVIDENCE: Azarbal et al., "Recontextualization Mitigates Specification Gaming without Modifying the
Specification", arXiv:2512.19027 v2 (Feb 2026): training-time method that prevents models from
learning to exploit misspecified signals; demonstrated on four scenarios including "code
special-casing to pass incorrect tests" and "overwriting evaluation functions instead of writing
correct code".
SOURCE: https://arxiv.org/abs/2512.19027 — accessed 2026-09-08.
COUNTEREVIDENCE: A training-time lever belongs to model providers, not to a tool builder; it reduces
gaming of a given spec but cannot supply intent the spec never contained.
OPEN QUESTION: For H4 — how much of the observed loss is *gaming* (fixable at training) versus
*absence* (only fixable by eliciting more intent)? This split decides where a product should sit.

CLAIM (partial): Orosz (Pragmatic Engineer, 2026-05-12) reports AI "generates 100x-or-more code
output" while "productivity, reliability, and simplicity improvements are a bit unimpressive – at
least for now".
LABEL: OBSERVED TODAY (practitioner analysis; paywalled beyond the excerpt)
CONFIDENCE: low (partial read)
SOURCE: https://newsletter.pragmaticengineer.com/p/revisiting-no-silver-bullets-in-the — accessed
2026-09-08, paywalled.

## Notes for synthesis

- If candidate 1 holds, the mission's "alignment" vocabulary is not a metaphor: it is the same
  problem class, with known impossibility results. Any thesis must be phrased as *bounding* the gap,
  never closing it.
- If Brooks holds, the thesis is old and true, which is good for importance and bad for novelty:
  the question becomes what *changed* — and the candidate answer is that the cost of maintaining
  the intermediate artifact fell, not that the problem appeared.
