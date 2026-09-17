# Long-horizon extension — sources index

Full per-claim sourcing (title/publisher/URL/date/accessed/VERIFIED-or-not, per `research/README.md`'s
mandatory format) lives in the per-lane sources files below — this index does not duplicate them, per the
mission's own rule against meaningless duplication. It points to each, and separately lists the handful of
sources that multiple lanes or documents in this extension relied on, since those are the ones a reader
checking this extension's most load-bearing claims would want first.

## Per-lane sources files

| Lane | File | Scope | Size |
|---|---|---|---|
| 11 — Memory taxonomy | `research/sources/11-memory-taxonomy.md` | Agent-memory systems, ADR practice, temporal modeling | 243 lines |
| 12 — Durable harness | `research/sources/12-durable-harness.md` | Claude Code/Codex/Cursor/Cline/OpenCode internals, durable execution | 191 lines |
| 13 — Context retrieval | `research/sources/13-context-retrieval.md` | Retrieval methods, progressive disclosure, prompt caching | 58 lines |
| 14 — Memory security | `research/sources/14-memory-security.md` | Memory poisoning, injection persistence, mitigations | 86 lines |
| 05 second wave | `research/sources/05-commodity-map.md`, appended section | Cross-vendor project-memory continuity | 49 new sources (S-1..S-49) |
| 09 second wave | `research/sources/09-economics.md`, appended section | Memory/retrieval infra economics | 18 new sources (W1-W18), plus first-hand measurement |
| 15 — Forensic audit | `research/lanes/15-shelracode-forensic-audit.md` | Internal — every source is a `file:line` citation against this repo, not an external URL | inline |

Original mission lanes cited throughout this extension (01, 04, 05 original, 07) are sourced in their own
existing `research/sources/` files, dated 2026-09-08.

## Sources multiple lanes or documents in this extension relied on

These recur across `11_LONG_HORIZON_MEMORY_AND_CONTINUITY.md` through `15_LONG_HORIZON_RISK_REGISTER.md`
— checking these first covers the extension's most load-bearing claims.

- **arXiv:2602.06052** — 2026 58-author agent-memory taxonomy survey. Fetched in full by lane 11. Backs
  the memory-type taxonomy (`12_*` §2) and the procedural-memory-immaturity finding.
- **arXiv:2501.13956** — Zep / Graphiti (temporal knowledge graph). Fetched in full by lane 11; referenced
  by lane 13's retrieval-method verdict. Backs the bitemporal schema recommendation (`12_*` §2.4) and the
  graph-retrieval-for-decisions recommendation (`12_*` §2.6, `13_*` Scenario 1).
- **arXiv:2606.12329** — PROJECTMEM (University of Utah). Fetched in full by lane 11. The only
  coding-agent-specific grounded memory system found; backs the event-sourcing, decision-typing, and
  failure-gate design choices throughout `12_*`.
- **arXiv:2606.24535** — Governed Shared Memory (Caura.ai + Ben-Gurion University). Fetched in full by
  lane 11. Backs the provenance/scope model (`12_*` §4.6) and the write-gate-ordering risk named in R7.
- **arXiv:2605.30711** — SAGE (density-estimator write gate). Fetched in full by lane 11. Backs the
  write-gate design (`12_*` §3) and its cost numbers.
- **adr.github.io/madr** — MADR 4.0.0 specification. Fetched directly by lane 11. Backs the Decision
  Ledger schema (`12_*` §2.4) field-for-field.
- **arXiv:2607.05189** — MemGhost. Cited directly in lane 14's hand-off report. Backs R5's likelihood
  rating (demonstrated, not hypothetical) and the mandatory write-approval-gate recommendation (`14_*`
  Phase 6).
- **arXiv:2602.23368** — Amazon Science, AAAI 2026, agentic keyword search vs. vector RAG. Cited directly
  in lane 13's hand-off report. Backs the "no embeddings for code retrieval" recommendation (`12_*` §2.6).
- **`docs.claude.com`** (Anthropic official documentation, various pages, fetched by lane 12 with
  dates/versions recorded in `research/sources/12-durable-harness.md`) — the primary source base for the
  entire harness-enforced/model-requested analysis in `11_*` §6 and the restart-test finding.
- **`research/lanes/05-commodity-map.md`** (original, 2026-09-08, and its second-wave append,
  2026-09-14) — the internal cross-lane source every other lane in this extension cites rather than
  re-deriving the competitive landscape. Its second-wave section is itself sourced independently
  (49 new entries, `research/sources/05-commodity-map.md`).

## Known sourcing gaps, stated rather than hidden

- Lane 11 flagged two papers (SSGM, arXiv:2603.11768; Always-On Agents, arXiv:2606.30306) where the fetch
  returned only PDF structural metadata, not body text — cited at reduced confidence, not treated as fully
  verified. Anyone building `12_*` §2's temporal/provenance fields further should do a proper fetch of
  these first.
- Lane 11 also recorded and corrected a case where a WebSearch summary (RAGShield, arXiv:2604.00387)
  contradicted the paper's own fetched abstract — the disputed detail was dropped, not kept. Documented as
  a caution about trusting search synthesis over primary fetch, applicable to every lane in this mission,
  not just lane 11.
- This index does not re-verify every source with a fresh `source-verifier` pass (the mission's own
  verification agent, used after the original ten lanes). That pass has not been run against lanes 11-15
  or the second-wave sections — a reasonable next step before treating this extension's conclusions as
  equally load-bearing as the original, verified mission output.
