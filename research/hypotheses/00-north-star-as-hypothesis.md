# The north-star chain, decomposed into falsifiable sub-hypotheses

Lead-authored, 2026-09-08, before wave-1 results. This file exists so that lane evidence can be mapped
onto specific claims rather than onto a slogan. Each sub-hypothesis gets a verdict after synthesis.

## The chain as stated

```
WHAT THE HUMAN WANTS → WHAT THE SYSTEM UNDERSTANDS → WHAT THE SPEC SAYS → WHAT THE SOFTWARE DOES
→ WHAT HAPPENS IN REALITY → DOES REALITY STILL MATCH INTENT?
```

## Sub-hypotheses

| id | claim | what would falsify it | lanes that bear on it |
|----|-------|------------------------|-----------------------|
| H0 | The five-node chain is the right decomposition of the problem. | A simpler or different structure explains the failures better (e.g. a two-node human↔artifact loop with no explicit spec; or the problem is coordination/accountability, not semantics). | 01, 02, 04, 10 |
| H1 | Each arrow loses information and the losses compound. | Evidence that most real failures concentrate at one arrow, or that losses do not compound because later stages recover intent (e.g. tests catch spec errors). | 02, 03, 07 |
| H2 | Loss at each arrow can be detected and, at least ordinally, measured. | No accepted measure exists for intent↔understanding or reality↔intent and none is in reach. | 02, 03, 07 |
| H3 | As code generation gets cheaper, the loss that matters moves upward (intent, understanding, spec) and outward (reality↔intent), away from spec→code. | Evidence that agents already recover intent well enough that upstream loss stays small; or that spec→code remains the dominant failure. | 02, 05, 07, 10 |
| H4 | An explicit intermediate representation (spec / semantic model / decision record) reduces total loss by more than it costs. | Circular-specification evidence: representation cost ≈ implementation cost; MDE history repeating; teams abandoning spec workflows. | 03, 04, 10 |
| H5 | The upstream and outward losses are invariant across plausible futures (agent-dominant, spec-dominant, hybrid). | A future in which models absorb elicitation and outcome judgement so completely that no external artifact is needed. | 01, 05, 09, 10 |
| H6 | A solo, unfunded builder can create something durable on the invariant part. | Incumbent absorption evidence; distribution economics; the artifact only pays off at enterprise scale. | 05, 08, 10 |

## Candidate deeper formulations (to test, not assume)

1. **Outer-alignment framing.** The intent gap in software is a special case of the specification
   problem in AI alignment (reward misspecification, specification gaming). If true, tooling and
   theory converge, and the SE problem inherits both the progress and the impossibility results.
2. **Control-loop framing (§45).** The chain is a loop, not a line: reference (intent), plant
   (software + world), sensor (telemetry), controller (engineering). Loss = error signal. Tests
   where the analogy breaks: non-stationary reference, unobservable state, delayed effects.
3. **Decision-provenance framing.** The durable unit is not the spec but the *decision* — every
   point where someone or something chose one reading over another. Specs, code, and tests are
   projections of the decision set. This is the framing the previous (pre-empted) experiment
   assumed; it must earn its place here with evidence.
4. **Brooks' essential vs accidental complexity.** If AI removes accidental complexity, what remains
   is the essential: deciding what the system should do. This is the oldest statement of the thesis
   and needs to be checked against 2025–2026 re-readings.
5. **Coordination/accountability framing.** The scarce thing is not semantics but who is answerable
   for a behaviour. If that dominates, the product is governance, not representation.

## Verdict table (filled after synthesis)

| id | verdict | label | evidence pointers |
|----|---------|-------|-------------------|
| H0 | | | |
| H1 | | | |
| H2 | | | |
| H3 | | | |
| H4 | | | |
| H5 | | | |
| H6 | | | |
