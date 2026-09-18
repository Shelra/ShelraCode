# Phase 1: base rate of silent commitment violations (pre-registered protocol)

Written 2026-09-18, before any pull request was sampled or read. It implements Phase 1 of
`docs/future-research/10_PHASED_PLAN.md`, which gates the objective recorded for this project:
Shelra as the agent that does not lose a project's decisions. Changes to this file after sampling
starts are listed in the "Amendments" section at the end, with the reason, never silently.

## Question

In public repositories that carry written architecture decision records (ADRs), what fraction of
merged pull requests adds code that contradicts a decision in effect at the time, without the
decision being changed, without a test failing and without a revert following?

## Decision rule (agreed with the project owner on 2026-09-18)

The verdict uses the point estimate of the human-confirmed violation rate over the whole sample:

| Rate | Verdict |
|---|---|
| below 5% | **Stop.** Write up the negative result. No ledger work proceeds. |
| 5% to 15% | Ambiguous. Proceed, re-scoped to the repositories and commitment kinds where violations concentrate. |
| 15% or more | The problem is real; build the ledger. |

Decision date: 2026-10-16. The Wilson 95% interval is reported next to the point estimate. With
n = 150 the achievable precision is roughly:

| Violations | Rate | 95% interval |
|---|---|---|
| 3 | 2.0% | 0.7% to 5.7% |
| 8 | 5.3% | 2.7% to 10.2% |
| 15 | 10.0% | 6.2% to 15.8% |
| 23 | 15.3% | 10.4% to 22.0% |

The design can produce a negative: nothing in it forces a positive label, and a sample with no
violating additions yields 0%.

## Corpus

Three repositories, chosen because their ADRs contain rules that code can break, in three
ecosystems:

| Repository | ADRs | Language |
|---|---|---|
| `backstage/backstage` | `docs/architecture-decisions/` | TypeScript |
| `mozilla/fxa` | `docs/adr/` | TypeScript/JavaScript |
| `Sylius/Sylius` | `adr/` | PHP |

`guardian/dotcom-rendering` (`dotcom-rendering/docs/architecture/`) is the reserve if one of the
three yields fewer than 50 eligible pull requests.

## Commitments

For each repository, every ADR is read before any pull request is sampled and reduced to zero or
more commitments. A commitment is an explicit, ongoing obligation or prohibition about code, written
in the ADR, with a stated scope of paths it applies to. ADRs that record a one-time event (adopting
ADRs, a completed migration with no ongoing rule, an evaluation) yield no commitment. ADRs whose
status is superseded, deprecated, rejected or proposed yield no commitment. The resulting list,
with each commitment quoted from its ADR, is committed as `commitments.md` before sampling.

A commitment applies to a pull request only if its ADR file exists, with an accepted status, in the
pull request's first parent.

## Sampling

- Pull requests merged into the default branch between 2025-09-01 and 2026-08-31, identified from
  first-parent history (merge commits, or squash commits whose subject ends in `(#number)`).
- Excluded before sampling: bot authors (dependabot, renovate, github-actions and release bots),
  release and version-bump pull requests, and pull requests that touch no source file of the
  repository's language (documentation, lockfiles, changesets and translations only).
- 50 pull requests per repository drawn uniformly at random from the eligible set, with the seed
  `shelra-phase1-2026-09-18`. The eligible count per repository is reported.

## Labels

Each sampled pull request receives exactly one label:

- **violation**: all of the following hold. (a) Lines the pull request adds contradict a
  commitment in effect, inside its scope. (b) The contradiction is new: code moved from elsewhere
  in the same diff does not count. (c) The pull request does not modify or supersede the ADR.
  (d) No later commit in the available history reverts the pull request.
- **no violation**: no commitment in effect is contradicted by added lines.
- **unsure**: the text of the commitment or the diff does not settle it.

Merged pull requests passed the repository's checks, so "no test caught it" holds for every
violation by construction.

## Who labels, and the audit

The first pass is done by an assistant model (Claude, working in this repository), not by Shelra
and not by any mechanism the later phases would build. Every label cites the commitment and the
added lines it rests on. Two sources of evidence are combined for each pull request: a deterministic
search of added lines for patterns written down per commitment in `commitments.md` before sampling,
and a reading of the full diff against every commitment in scope.

The project owner then audits, through a review page, every **violation** and **unsure** label plus
a random 20 of the **no violation** labels. The owner's answer replaces the first-pass label. The
reported rate uses the audited labels; the audited negatives give an estimate of how many
violations the first pass missed, reported as an adjusted rate next to the primary one.

## Known limitations, stated in advance

- Pull request descriptions and review threads are not read: only commit messages and diffs.
  A violation that reviewers explicitly accepted in discussion is still counted, unless the ADR was
  changed.
- ADRs mix behavioural contracts with code conventions. Both count, because the objective is about
  any decision a project wrote down. The report breaks the rate down by commitment kind.
- Three repositories cannot represent the field. The per-repository breakdown is reported so that
  one repository's pathology is visible.
- The first-pass labeler is a language model. The audit exists to measure its error, and the
  report states the measured disagreement.

## Artifacts

`commitments.md`, `sample.jsonl` (the sampled pull requests), `labels.jsonl` (first pass and audit),
and `REPORT.md`, all in this directory, published whatever the result.

## Amendments

None yet.
