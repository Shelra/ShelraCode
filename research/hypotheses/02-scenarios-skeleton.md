# Competing futures — skeleton (pre-evidence, to be rewritten after wave 1)

Lead-authored 2026-09-08 before lane results. Everything here is a placeholder structure with the
lead's priors marked as such. The point is to fix the *questions* each scenario must answer so that
lane evidence is slotted, not improvised.

## Scenario A — Intent/spec dominance

Specification or an explicit semantic model becomes the primary human-authored artifact; code is
derived and regenerable.

- Enabling conditions: cheap regeneration; checkable specs; low-cost spec maintenance; tooling that
  makes spec review cheaper than code review.
- Barriers: circular specification cost; MDE history; spec drift; state/migration problems; humans
  preferring iteration over specification.
- Evidence for: (lanes 03, 04)
- Evidence against: (lanes 02, 10)
- Winners / obsolete: 
- Unresolved problems that remain even if A wins: 
- Lead prior (SPECULATIVE): partial, domain-limited — strongest where behaviour is objectively
  checkable and errors are expensive (money, compliance, protocols).

## Scenario B — Agent dominance

Models become good enough that intermediate specifications stay implicit; humans converse, agents
build, tests and telemetry close the loop.

- Enabling conditions: continued capability scaling; agents that elicit well; cheap verification;
  users tolerant of iteration.
- Barriers: semantic collapse (unanimous wrong readings) not diminishing with scale; review
  bottleneck; accountability and audit requirements; regulated domains.
- Evidence for: (lanes 05, 09)
- Evidence against: (lanes 02, 07, 08)
- Winners / obsolete: 
- Unresolved problems that remain even if B wins: reality↔intent; accountability; provenance.
- Lead prior (SPECULATIVE): dominant for low-stakes software; contested elsewhere.

## Scenario C — Hybrid

Humans use intent interfaces; systems internally generate semantic representations, proofs and
implementations; the explicit artifact is a decision/evidence record rather than a full spec.

- Enabling conditions: cheap extraction and maintenance of intermediate artifacts by AI; review
  moving from code diff to behaviour/decision diff; evidence attached to requirements.
- Barriers: artifact goes stale like all traceability before it; nobody pays for it until an
  incident; incumbents absorb the feature.
- Evidence for: (lanes 02, 03, 07, 08)
- Evidence against: (lane 10)
- Winners / obsolete: 
- Unresolved problems that remain even if C wins: which decisions deserve a human; outcome judgement.
- Lead prior (SPECULATIVE): most likely shape; least clear who captures value.

## Additional scenarios to consider if evidence supports

- D — Regulation-driven: liability and audit requirements force explicit intent records regardless
  of technical merit (watch lanes 08, 10 for evidence).
- E — Abundance collapse: software becomes so cheap that "which system is authoritative" dominates
  all other problems (lane 08 §40).

## The invariant question (§47)

To be answered after synthesis: which problem stays important across A, B, C (and D/E)?
Candidates the lead will test: (1) reality↔intent judgement; (2) decision provenance / who is
answerable; (3) discovering what the human did not say; (4) keeping evidence fresh under change.
