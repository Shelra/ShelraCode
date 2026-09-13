# Contradictions and verification

Lead-owned. Two kinds of file live here.

## `verify-NN-<lane>.md` — written by the source-verifier agent

One per lane after each wave. Counts of VERIFIED / PLAUSIBLE / DISPUTED / FABRICATION RISK /
OVER-LABELLED, a table of every non-verified item, and the three findings most likely to change the
synthesis if wrong.

## `matrix.md` — written by the lead after wave 1

Where lanes disagree with each other, with the lead's own findings, or with common belief.

```
| id | claim A (lane) | claim B (lane) | what is actually in dispute | what would settle it | wave-2 action |
```

Rules:
- A contradiction is only listed if both sides cite evidence. "Lane X asserts, lane Y asserts" with no
  sources is a gap, not a contradiction, and goes to the gap list instead.
- Every row must end in either a wave-2 action or an explicit "unresolvable within this mission".
- Contradictions between a lane and the red team are expected and are the most valuable rows.
