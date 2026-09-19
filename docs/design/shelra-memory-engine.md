# Shelra memory engine: persistent learning across sessions

Status: implemented 2026-09-17 (`src/memory/`), integrated into the turn loop (`src/agent/agent.ts`)
and the `memory_write` tool; proven by the cross-session suite `bench/suites/shelra-memory-v0.1.json`.
Evidence base: `research/lanes/11-memory-taxonomy.md`, `13-context-retrieval.md`, `14-memory-security.md`
and the synthesis in `docs/future-research/12_LONG_HORIZON_TARGET_ARCHITECTURE.md`; Claude Code's own
auto-memory and skill-development guidance under `references/claude-code/`.

## The rule this serves

Shelra must not behave like a stateless coding agent. Every project must become smarter the longer
Shelra works on it: retrieve what is relevant before acting, learn after meaningful work, keep what
is reusable, drop what is stale or wrong, and turn repeated procedures into skills. The loop is

```
Experience → Memory → Knowledge → Skill → Better decisions → Better execution → New experience
```

## What the research dictated (and what it ruled out)

| Finding | Source | Consequence in the design |
|---|---|---|
| Memory systems fail at the **write decision**, not retrieval; a cheap deterministic gate should admit/merge/discard and defer only ambiguous cases | lane 11 §6 (SAGE, PROJECTMEM, ConsistencyGate) | One deterministic write gate (`gate.ts`) in front of every writer, automatic or model-initiated |
| Provenance must be first-class; a human statement outranks an observed fact, which outranks an inference, which outranks fetched web content; a human item must not be silently overwritten by an inference | lane 11 §4, §2.10; lane 14 | `source` + `confidence` on every entry; gate refuses inference-over-human; web-derived directives are rejected |
| Temporal fields: created/modified plus "last confirmed", supersession, never silent overwrite | lane 11 §3 (Zep, MADR) | `created`, `modified`, `lastConfirmed`, `supersedes`, `revision`; append-only `history.jsonl` timeline |
| Lexical/agentic retrieval wins for code; embeddings add staleness, exfiltration surface and a subsystem to keep correct | lane 13 §1 (Anthropic, Cursor, AAAI 2026) | Deterministic lexical ranking (`retrieval.ts`): token overlap, path overlap, provenance, recency, staleness; no vector index |
| Progressive disclosure: metadata always, body on trigger, resources on demand | lane 13 §2; Claude Code skills | Index lines always; top-k bodies within a character budget; the rest as pointers loadable with `memory_read` |
| Evidence must be re-checkable; staleness self-detection by models is ~55% | lane 14 (STALE) | Cheap mechanical staleness: `relatedFiles` mtimes vs `lastConfirmed` mark an entry "may be stale" |
| Untrusted content becoming permanent memory is the sharpest security gap in the field | lane 14 | Secret-shaped and instruction-shaped text is rejected at the gate; `source: web` never carries directives |
| Skills are the durable form of procedural knowledge | Anthropic skill-development guidance | Procedures used in ≥2 turns are promoted to `.agents/skills/<slug>/SKILL.md` automatically |

## Components

- **Store** (`src/memory/store.ts`): markdown files under `<workspace>/.shelra/memory/`, an index
  (`MEMORY.md`, capped at 200 lines / 25 KB), one topic file per entry with the extended frontmatter,
  and `history.jsonl` (created / updated / confirmed / deleted / promoted, rotated at 1 MB).
  `recordMemoryUse` bumps `uses`/`lastUsed` on retrieval; `confirmMemoryEntry` refreshes `lastConfirmed`.
- **Write gate** (`src/memory/gate.ts`): reject (too short/long, credential-shaped, instruction-shaped,
  web-derived directive), update (same slug, or a near-duplicate with more confidence/trust), skip
  (exact repeat, near-duplicate that is no better, human-stated entry vs an inference, per-type cap),
  create (novel). Pure function of candidate + current records; every decision carries a reason.
- **Retrieval** (`src/memory/retrieval.ts`): `score = (relevance + pathOverlap) × trust × recency ×
  stalePenalty`; expands up to 4 bodies within 3,000 characters, lists the rest. Runs before every
  turn and before every sub-agent brief; nothing is embedded.
- **Reflection** (`src/memory/reflection.ts`): after a turn that changed files and verified them, or
  worked through a failure, or involved ≥8 tool calls, one bounded model call (30 s, ~1.2K output
  tokens) sees a digest (request, files changed, last 12 commands with outcomes, final report,
  existing slugs) and proposes ≤5 durable facts as JSON; the gate decides. Explicit user directives
  ("always …", "never …", "prefer …") are captured deterministically as `source: human` without a model.
- **Skill promotion** (`src/memory/skills.ts`): `procedure` entries used in ≥2 turns from a trusted
  source become project skills with provenance in the body; idempotent, regenerated when the memory changes.
- **Tools**: `memory_list`, `memory_read`, `memory_write` (now gated, with `related_files`, `confidence`,
  `source`), `memory_delete`.

## Retention

Raw transcripts stay in SQLite; distilled knowledge lives in memory. The index cap forces
consolidation, the per-type cap (40) stops sprawl, staleness marks flag drift, and `memory_delete`
plus supersession keep the store honest. The timeline is the only append-only artifact and rotates.

## What is proven, and how

`bench/suites/shelra-memory-v0.1.json` runs three tasks on one fixture: phase A implements a function
whose tests depend on an undocumented codegen step; phase B (two arms, both copied from phase A's
finished workspace) changes the schema and must regenerate — once with the memory phase A wrote,
once with `.shelra/memory` and `.agents/skills` wiped. The oracle verifies a hash of the schema inside
the generated module, so only real regeneration passes. Results are recorded per run in
`benchmark_runs`; see `docs/architecture/14-AGENT-HARNESS-RECONSTRUCTION.md` §24 for the table.

First valid sample (run #14, 2026-09-17, qwen3-coder-30b): phase A learned the procedure
(`schema-generation-workflow`); phase B with memory retrieved all three entries and passed the
regeneration check in 22 steps / 75 s; the same phase B without memory failed it in 23 steps /
133 s. Two earlier runs were invalid for the question and are documented with their causes
(an empty reflection, later covered by the retry + deterministic fallback; a workspace-copy filter
that skipped `.shelra`, later fixed and tested).

## Known limitations

- Retrieval is lexical; a request phrased with none of an entry's vocabulary will not expand it
  (the index line is still listed). Tags written by the reflection step mitigate this.
- Reflection quality depends on the turn's model; the gate bounds the damage of a poor extraction but
  cannot invent a good one.
- Skill promotion writes into the repository (`.agents/skills`); teams should review promoted skills
  like any other committed file.
- Memory is per workspace; user-level preferences across projects are not stored globally yet.
