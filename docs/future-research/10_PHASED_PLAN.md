# Phased plan

Not a roadmap. Each phase answers one research or product risk and must earn the next. No calendar
theatre — durations are effort estimates for one person, and dependencies matter more than dates.

**Phase 0 runs regardless of the thesis.** Everything from Phase 1 onward is conditional on the gate
before it.

---

## Phase 0 — Stop the bleeding

**Goal.** Remove two risks that exist whether or not this thesis is pursued.

**Work.**
1. **Commit the working tree.** 11,577 lines across 72 untracked TypeScript files — `autonomy`,
   `intelligence`, `exec`, `runtimes`, `providers`, `router`, `security`, `context`, `models` — are
   unversioned, with `git stash` empty and no branch holding them. One `git clean -fd` destroys the
   differentiating half of the project. Last commit was 2026-05-15; zero commits in 90 days.
2. **Fix the repository's identity.** The README carries an npm badge and a `bun add -g shelra`
   instruction for a package that returns 404.
3. **Close the wallet path or delete it.** `src/wallet/manager.ts` writes a private key as plaintext JSON;
   there is no encryption anywhere in the tree (`grep` for `createCipher|scrypt|keytar|safeStorage`
   returns nothing); and `resolveWorkspacePath` is imported by exactly one module, so the bash tool, MCP
   servers and the LSP client sit outside containment. No `wallet.json` exists on the current machine, so
   this is latent, not live. Decide: delete the module, or encrypt it and contain the shell.

**Gate.** None — do this first. Effort: hours.

---

## Phase 1 — The base rate

**The kill gate for the entire thesis.** Nothing else is built until this returns a number.

**Hypothesis.** In repositories carrying written behavioural commitments, a material fraction of merged
pull requests silently violate one — without breaking a test and without causing a revert.

**Work.** Select 3–5 public repositories that already have machine-adjacent commitments: an OpenAPI
contract, an ADR set, EARS requirements, or documented invariants. Sample 50 merged PRs per repository,
weighted toward behaviour-changing changes. For each, determine by hand whether it violated a stated
commitment that no test caught and no revert followed.

**Metric.** Silent-violation rate, with a confidence interval, and a per-repository breakdown so the
result is not one repo's pathology.

- **Success:** ≥15% — the problem is real and large enough to build an instrument for.
- **Ambiguous:** 5–15% — proceed to Phase 2 but re-scope toward the domains where the rate concentrates.
- **Kill:** <5% — **stop. Write the negative result and publish it.** It is a genuine contribution and it
  saves months.

**Artifacts.** A labelled dataset, the labelling protocol, and a short report. All of it publishable
either way.

**Discipline this phase inherits** from the abandoned `src/intent/` experiment (see
`research/hypotheses/03-preempted-experiment-postmortem.md`): the ground truth must not be authored by,
typed by, or derived from the mechanism under test; state the achievable p-value before collecting data;
and check that the design can physically produce a negative before running it.

Effort: 1–2 weeks, mostly manual reading. Cost: near zero.

---

## Phase 2 — Can a machine find them?

**Gate:** Phase 1 returned ≥5%.

**Hypothesis.** A model used strictly as a *judge* over predicates extracted from existing commitments
recovers the Phase 1 violations at usable precision.

**Work.** Extract commitments as predicates, never as prose or enumerated cases. Run the model only in
judging mode against the Phase 1 labelled set. Compare against two baselines: the tests already in the
repository, and `/speckit.converge` run on the same commits.

**Metric.** Recall and precision against the human labels.

- **Success:** recall ≥0.6 at precision ≥0.7, and it finds violations the existing tests did not.
- **Kill:** it finds nothing the tests already catch — then the value is in the tests, not the record.

Effort: 2–3 weeks. Cost: modest inference, sub-45 capability tier, so the open-weight price floor applies.

---

## Phase 3 — Does anyone want to look?

**Gate:** Phase 2 hit its precision and recall bar.

**Hypothesis.** A list of undeclared decisions is worth a maintainer's attention.

**Work.** Show real output to 10 maintainers of the sampled repositories. Not a demo — their own
repository, their own commits. Ask which entries they would have wanted to approve, and which are noise.

**Metric.** Fraction of entries rated consequential; time spent per entry.

- **Success:** ≥30% rated consequential and the list reads faster than the diff it summarises.
- **Kill:** they shrug at >90%, or the record takes longer to read than the code. Lane 04's finding that
  the reading path is the binding constraint applies to this product too.

This phase tests the **accountability tax** — the output is a written record of a decision someone must
own, and the person who must adopt it is the person it exposes. Effort: 2 weeks, mostly conversations.

---

## Phase 4 — Does it survive change?

**Gate:** Phase 3 showed the entries are consequential.

**Hypothesis.** The record can be maintained across changes without going stale — the failure that killed
every previous traceability system.

This is the genuinely unsolved research problem: Lahiri's open problem #2, change intent and
compositionality, had **no published method** as of September 2026. The most promising lead is *Partial
Contracts Suffice* (July 2026): LLM-inferred **caller-sufficient** contracts giving sound regression
equivalence with zero false positives.

**Work.** Replay 6 months of history on one repository. Each commit updates the record. Measure staleness,
false invalidation, and how much re-checking each change forces.

**Metric.** Staleness rate after 6 months of simulated evolution.

- **Success:** <20% stale with bounded re-checking per change.
- **Kill:** the record decays like every traceability system before it. **This is the most likely place
  the thesis dies**, and it should be reached before any product work.

Effort: 3–4 weeks.

---

## Phase 5 — The smallest useful tool

**Gate:** Phases 1–4 all passed.

Only now build. An OSS CLI that runs in CI, on one domain where the oracle already exists — the narrowest
of OpenAPI contracts, ADRs, or EARS requirements. Distribution is a repository someone stars; there is no
other channel available to a solo builder.

**Kill:** if `/speckit.converge` or Kiro's property-based testing already covers >80% of the surface when
run on the same repositories, there is no wedge — only a preference.

---

## Phase 6 — Only if 1–5 all passed

Longitudinal service, multi-repo corpus, the network effects in lane 08's U3 (correlated monoculture
defects). Not planned here. Any plan written now would be fiction.

---

## Legacy disposition

| Module | Disposition | Reason |
|---|---|---|
| `src/intelligence/` | **KEEP** | Narrow provider-agnostic question/answer boundary with structured output and honest per-call cost accounting. Proven in live use at ~$0.003/call. Directly answers the counterparty risk that just materialised when OpenAI announced it would stop supplying Cursor. |
| `src/autonomy/` | **ADAPT** | The runtime — not the model — decides completion, via deterministic machine-evaluable checks, and it records honestly which criteria were model-judged. That is the oracle-engineering shape the thesis needs. Note the limit: SWE-Gate found 221 of 644 test-passing repairs still violate the review constraints that decide real acceptance. |
| `src/verify/`, `src/exec/`, `src/security/` | **ADAPT** | Evidence collection, process control and the symlink-hardened path guard are reusable. The guard must be extended beyond `src/tools/file.ts`. |
| `src/agent/`, `src/tools/`, `src/lsp/`, `src/mcp/`, `src/hooks/`, `src/ui/` | **DEPRECATE** | Commodity. Shipped by three or more systems including free open-source ones. |
| `src/runtimes/`, `src/models/`, `src/hardware/`, `src/startup/`, `src/setup/` | **DELETE** | Local GGUF management against llama.cpp (127k stars), Ollama and LM Studio. Local-first fails on electricity cost before model quality. |
| `src/router/` | **DELETE** | Model routing is commodity in five shipping systems. |
| `src/payments/`, `src/wallet/` | **DELETE** | Unrelated to the thesis, and the plaintext-key path is the repository's only serious security exposure. |
| `src/telegram/` | **DELETE** | Claude Code's Channels names Telegram explicitly. |
| `src/intent/` | **DELETE** | Contaminated by construction — ground truth typed by the mechanism under test. Keep only the harness shape: uniform de-duplication before scoring, and a judge blind to arm identity seeing shuffled items. The corpus and probe catalogue must not be reused. |
| `ShelraCode/` | **DELETE** | Nested reference checkout, gitignored, migration forensics only. |

**Would a clean rewrite be cheaper?** For the thesis as stated: yes, except for `src/intelligence/` and
the deterministic-check core of `src/autonomy/`. The Phase 1–4 work needs neither a TUI, nor a tool
system, nor an agent loop. Roughly **85% of the current tree is irrelevant to the selected thesis**, and
carrying it costs maintenance for capabilities three incumbents give away.

That recommendation only becomes actionable at Phase 5. Until then, delete nothing except by the Phase 0
decision on the wallet — the research phases need almost none of it, and a repository that is not being
built does not need to be tidy.
