# Lane 13 — Context retrieval and progressive disclosure

> Given a durable store of years of project knowledge, what minimum subset should be injected into
> a specific model call, and how is that subset selected? Does evidence favor lexical, semantic,
> graph, or hybrid retrieval, and where does each fail?

## 1. Summary (10 lines)

1. Production practice has moved decisively away from embedding/vector-DB retrieval as the default
   for **code**, replacing it with lexical search (grep/glob) plus a cheap read-only "explore" agent
   that iterates — Anthropic did this in Claude Code, and Cursor's docs now describe only Instant
   Grep + an Explore subagent, no embeddings.
2. The stated reasons are not "grep is smarter than embeddings" but operational: staleness (index
   goes stale the moment a file changes), security/privacy (an index is an exfiltratable copy of the
   codebase), and reliability (one fewer subsystem to keep correct) — a maintenance-cost argument,
   not a pure-retrieval-quality argument.
3. An independent, non-Anthropic paper (Amazon Science, AAAI 2026) corroborates the *retrieval
   quality* side of this: agentic keyword search reaches over 90% of vector-RAG performance without
   a standing vector database.
4. This finding is scoped to **code**, where exact identifiers are the dominant query type. It does
   not transfer cleanly to natural-language project history/decision retrieval, where semantic and
   graph methods still measurably win on multi-hop and synthesis-style queries.
5. Progressive disclosure is now a named, documented architecture (Anthropic's Agent Skills: ~100
   tokens/skill metadata always loaded, <5k tokens of instructions loaded on trigger, resources at
   zero cost until read) and a documented agent-loop pattern ("just-in-time" loading of lightweight
   identifiers rather than pre-loaded data).
6. For assembling a task-scoped "context pack," the literature offers two live paradigms: a weighted
   recency+importance+relevance score over an embedding-indexed memory store (Generative Agents,
   2023, still the ancestor pattern cited by 2025-2026 work), and temporal knowledge-graph traversal
   (Zep/Graphiti), which beats both a full-context baseline and the prior best system on accuracy,
   context size, and latency simultaneously — but for conversational/decision memory, not code.
7. Prompt-caching economics reward *stable* prefixes: Anthropic's cache is keyed on an exact-prefix
   breakpoint, refreshed on each hit, non-refunded on a miss (full write-price paid again). A context
   pack that gets reassembled differently every turn defeats caching; one that has a stable prefix
   (identity → constitution → objective) followed by a small variable tail does not.
8. "Lost in the middle" (2023) is not obsolete: Chroma's 2025 study of 18 frontier models found
   monotonic degradation with context length that starts well before the advertised context-window
   ceiling, and RULER (2024, still current in absence of a documented refutation) found only about
   half of models tested hold "satisfactory" performance even at 32K tokens against much larger
   claimed windows.
9. No paper found in this pass benchmarks retrieval over a **multi-year, decision-and-supersession
   style corpus** specifically (the closest are LongMemEval, at ~115K tokens of conversation, and
   code-retrieval benchmarks) — this is a live gap directly relevant to Shelra's stated problem.
10. Verdict below is qualified, not absolute: evidence favors **lexical-first, agentic, tool-mediated
    retrieval for code**, and **graph/temporal-structured retrieval for decision and project-history
    memory where multi-hop reasoning or supersession tracking matters**, with semantic/embedding
    retrieval demoted to a fallback for the cases both handle worse (fuzzy conceptual queries with no
    exact-match anchor).

## 2. Progressive/leveled context disclosure — models found, with evidence

**Anthropic Agent Skills (verified 2026-09-14).** Three-level disclosure with an explicit token-cost
table:

| Level | When loaded | Token cost | Content |
|---|---|---|---|
| 1: Metadata | Always, at startup | ~100 tokens/Skill | `name` + `description` from frontmatter |
| 2: Instructions | On trigger (description match) | <5k tokens | SKILL.md body |
| 3: Resources/code | As referenced | 0 until read; scripts run via bash, only output enters context | Bundled files, executable scripts |

```
CLAIM: Claude's Agent Skills architecture loads only skill name+description (~100 tokens each) into
every system prompt, and defers the full procedural body (capped informally under 5k tokens) until
the description is matched to the task, with bundled reference files and scripts staying at zero
token cost until explicitly read or executed.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: Official docs table, current as of this fetch: Level 1 "~100 tokens per Skill", Level 2
"Under 5k tokens", Level 3 "None until accessed." Loading mechanism: Claude reads SKILL.md from the
filesystem via bash when triggered; script code never enters context, only its output does.
SOURCE: Agent Skills — overview — Anthropic — fetched 2026-09-14 — https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview — accessed 2026-09-14
COUNTEREVIDENCE: lane 05 separately documents that when many per-directory skills accumulate (e.g. a
monorepo with per-package skills), "some skills lose their descriptions entirely" once the metadata
list itself grows large enough to be truncated — so the always-loaded tier is not unboundedly cheap,
it degrades gracefully by dropping information rather than growing token cost, which is a different
failure mode than classic context bloat but a failure mode nonetheless.
OPEN QUESTION: At what skill count does description truncation begin, and does truncation silently
reduce match recall for a skill whose keywords land in the truncated portion?
```

**Anthropic "just-in-time" context loading (agent-loop level, above the skills mechanism).** The
model is: don't pre-process/pre-load data into context; maintain lightweight identifiers (file paths,
saved queries, links) and dynamically resolve them at the moment they're needed via tool calls. This
is explicitly framed as mirroring how a human uses a filesystem/inbox/bookmarks rather than
memorizing. For long-running tasks specifically, three techniques are named: compaction (summarize +
reinitialize), structured note-taking outside the context window, and sub-agent delegation returning
condensed (1,000–2,000 token) summaries rather than raw exploration transcripts.

```
CLAIM: Anthropic's documented agent-context-engineering guidance treats "progressive disclosure" and
"just-in-time loading" as the same design principle applied at two scales — skills (metadata now,
body on trigger) and general agent tool use (identifiers now, content on access) — and explicitly
prefers autonomous navigation/retrieval by the agent over pre-computed retrieval.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: "Letting agents navigate and retrieve data autonomously also enables progressive
disclosure." Sub-agent summaries bounded at 1,000-2,000 tokens are given as a concrete mechanism for
keeping a long task's context small.
SOURCE: Effective context engineering for AI agents — Anthropic — 2025-09-29 — https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents — accessed 2026-09-14
COUNTEREVIDENCE: none found specific to this claim; the piece is a vendor engineering blog, not a
controlled study, so it is a design-philosophy statement rather than a benchmarked result — it should
not be read as proof the technique is optimal, only as a documented production choice.
OPEN QUESTION: Where is the crossover point at which agentic re-discovery of the same information
across repeated tasks becomes more expensive (tokens + latency + tool round-trips) than a cache or
index would have been? Not addressed in any source found this pass.
```

**Claude Code CLAUDE.md hierarchy (production, file-system-level progressive disclosure).**
Root CLAUDE.md loads at launch along with every ancestor of the working directory; each
subdirectory's CLAUDE.md loads only on demand, the moment Claude reads a file there. `claudeMdExcludes`
statically prunes files/subtrees a developer never touches. This is a third instance of the same
underlying pattern (cheap always-on layer + expensive on-demand layer), implemented as a filesystem
convention rather than a model-visible metadata block.

```
CLAIM: Claude Code's monorepo guidance implements progressive disclosure for project instructions via
directory-scoped CLAUDE.md loading (root+ancestors at launch, subdirectory on read) rather than a
single flat file, and explicitly defers to an external RAG/search index only as an opt-in MCP tool,
not a built-in default.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: Exact quote: "if your organization already runs a code search or RAG index over the
repository, expose it as an MCP tool so Claude queries it instead of reading files directly." This is
the single explicit RAG mention in the entire large-codebases guide, and it is conditional ("if your
organization already runs") and instrumental (an MCP tool, not a first-class retrieval subsystem).
SOURCE: Set up Claude Code in a monorepo or large codebase — Anthropic — fetched 2026-09-14 — https://code.claude.com/docs/en/large-codebases — accessed 2026-09-14
COUNTEREVIDENCE: none found against this specific claim; it independently reproduces lane 05's
finding via a different document than lane 05 used, which strengthens rather than weakens it.
OPEN QUESTION: none — this claim is well-supported; open question is squarely #2 below (why, in
research terms, not just in vendor-statement terms).
```

## 3. Retrieval method comparison table

| Method | When it wins (evidence) | When it fails (evidence) | Evidence quality |
|---|---|---|---|
| **Lexical (grep/keyword)** | Exact-identifier code queries; the dominant query shape in a codebase (a function name either exists verbatim or doesn't). Production default at Anthropic, Cursor, and (per lane 05) Cline/Windsurf/Sourcegraph Amp. Amazon Science: keyword search inside an agentic loop reaches >90% of vector-RAG performance. | Fuzzy/conceptual queries with no exact-match anchor ("find the code that handles retries" when the word "retry" never appears); multi-hop reasoning across documents. | Strong for code (vendor-consistent + 1 independent academic paper); weak/absent for natural-language project-history retrieval specifically |
| **Semantic/embedding (dense vector)** | Dialogue-fragmented sources, open-ended "how/why" synthesis questions (Long Context vs RAG study); conceptual similarity search where no lexical anchor exists. RAG (semantic-retrieval-backed) still beats long-context stuffing on economics: cited as 8–82× cheaper for typical workloads (SEARCH-ONLY, not independently verified — flagged). | Code retrieval specifically: displaced by lexical+agentic in production (Cherny, Cursor); introduces "conceptually adjacent but textually unrelated" noise for exact-match queries (vadim.blog synthesis, secondary); staleness — an embedding index goes stale the instant underlying content changes, and re-embedding is a cost/latency tax the grep-first approach avoids entirely. | Mixed: solid for general RAG/QA, explicitly rejected in the code-retrieval production case with named reasons (staleness, security, privacy, reliability) |
| **Graph (knowledge graph / structural)** | Multi-hop reasoning and "sense-making across a whole corpus" queries. HippoRAG: 87.9–90.9% evidence recall on complex reasoning. Recall@5 lift from 73.4% (naive RAG) to 87.8% on multi-hop QA (SEARCH-ONLY, unverified this pass). Zep/Graphiti (temporal graph) beats both full-context and MemGPT on DMR (94.8% vs 93.4%) and LongMemEval (63.8-71.2% vs 55.4-60.2%) while using ~1.6k vs ~115k tokens and ~90% less latency — for agent/decision memory, not code. | Simple single-hop fact lookup: plain RAG wins outright (83.21% vs lower graph-method evidence recall). Token/cost overhead is large — MS-GraphRAG global search ≈4×10⁴ tokens vs vanilla RAG's ≈900 tokens (~40×); indexing cost cited at ~$1,544/M tokens vs ~$1.45/M for vector RAG (SEARCH-ONLY, unverified). Construction pipelines are language/schema-specific and reduce portability. | Strong and quantified for multi-hop/decision-memory retrieval (Zep is VERIFIED with real numbers); cost/overhead claims for Microsoft's specific GraphRAG are SEARCH-ONLY and not independently confirmed |
| **Hybrid (lexical+dense, or lexical+graph)** | Combines exact-identifier precision with conceptual recall (ReACC, CEDAR, RAP-Gen for code). No task found in this pass where a well-implemented hybrid was measurably *worse* than either pure method — it is the safe default when query type is unknown or mixed. | Adds engineering complexity and at least two failure surfaces instead of one; no source quantified a hybrid regression, but none quantified a hybrid win margin over lexical-alone for code either — the "no drop" claim is stronger than the "and it wins" claim in the sources found. | Directionally supported (survey taxonomy), quantitatively thin — this is the biggest evidence gap in the comparison table |
| **Agentic search (tool-mediated, model-driven iteration)** | This is not a fourth retrieval *method* so much as the *delivery mechanism* that made lexical search viable in production: instead of one grep call, the model issues glob → grep → read iteratively, refining based on what it sees, and can spawn an isolated sub-agent so exploration noise doesn't pollute the main context. This is what actually replaced RAG in Claude Code (Cherny, verified quote) and what Cursor, Cline, Windsurf, Devin, and Sourcegraph Amp converged on (per lane 05 and corroborating search results). | Nothing found quantifying agentic search's own failure mode directly (e.g., cost/latency at very large corpora, or how many tool round-trips a hard query needs) — flagged as open question #7 below. | Strong for "this is what shipped and why," weak for "here is where it breaks down" — vendors have published the win, not the failure boundary |

**Reading the table together:** the evidence does not support "one retrieval method wins." It
supports a query-type split — lexical/agentic for exact-match code and identifier lookup, graph/
temporal for multi-hop and decision/supersession reasoning, semantic/dense as a fallback for fuzzy
conceptual queries neither of the above resolves — with hybrid as the unquantified but plausible
safe default when the query type can't be classified in advance.

## 4. Context-pack assembly — relevance-determination approaches and their evidence

Two concrete, evidenced approaches for deciding *what subset* of a large memory store enters a given
call:

**(a) Weighted scoring over recency + importance + relevance.** Generative Agents (2023) defines
`score = recency + importance + relevance` (equal weights in the original), each min-max normalized
to [0,1], relevance computed as cosine similarity between memory and query embeddings, importance
assigned by an LLM call at write time, and the top-scoring memories fill the available context
budget. This is a deterministic, cheap-to-compute ranking function over a semantically-indexed store
— it is *not* LLM-mediated selection at retrieval time (the LLM only scores importance once, at
write time); ranking itself is arithmetic. This pattern is the direct ancestor cited by more recent
(2025-2026) memory-governance papers found in search results but not independently verified this pass.

**(b) Graph traversal with temporal edges.** Zep/Graphiti builds a knowledge graph over
conversational and structured data, with edges carrying validity intervals, and retrieval is a graph
query (traversal + optional semantic search over graph nodes) rather than a flat similarity scan.
This is the approach that most directly encodes "supersession" (a fact/decision with a start and end
of validity) — directly relevant to Shelra's stated interest in decisions that later get revised.
Its measured advantage over flat full-context and over MemGPT (a system without temporal structure)
is in both accuracy and token/latency cost simultaneously, which is a stronger result than a typical
accuracy-only or cost-only benchmark.

```
CLAIM: Task-scoped context-pack assembly research offers at least two evidenced, non-LLM-mediated
relevance-determination mechanisms — a weighted recency/importance/relevance score over embeddings
(Generative Agents) and temporal knowledge-graph traversal (Zep/Graphiti) — and the graph approach,
where measured, outperforms a naive full-context-stuffing baseline on both accuracy and cost/latency
simultaneously for conversational memory.
LABEL: OBSERVED TODAY (for Zep's specific benchmark numbers); the Generative Agents formula's
continued relevance in 2025-2026 systems is a STRONG TREND (cited by later work) rather than directly
re-benchmarked in this pass.
CONFIDENCE: medium-high for Zep numbers (single paper, not independently reproduced by a third party
in sources found); medium for the claim that this generalizes to a code+decision corpus, since Zep's
benchmarks are conversational (DMR, LongMemEval), not a software-project decision ledger.
EVIDENCE: DMR 94.8% (Zep) vs 93.4% (MemGPT) vs 94.4% (full-context) on gpt-4-turbo; LongMemEval 63.8%/
71.2% (Zep, gpt-4o-mini/gpt-4o) vs 55.4%/60.2% (full-context), average retrieved context 1.6k vs 115k
tokens, ~90% latency reduction.
SOURCE: Zep: A Temporal Knowledge Graph Architecture for Agent Memory — arXiv:2501.13956 — submitted
2025-01-20 — https://arxiv.org/html/2501.13956 — accessed 2026-09-14
COUNTEREVIDENCE: this is a vendor-authored paper (Zep is a commercial memory-layer product), so the
comparison baselines (MemGPT, full-context) may be tuned less aggressively than Zep itself; no
independent reproduction was found in this pass.
OPEN QUESTION: has anyone benchmarked graph-based temporal retrieval specifically against a corpus of
engineering decisions with explicit supersession (not conversational turns), which is what lane 11's
memory taxonomy and this mission's thesis actually need retrieved?
```

Whether "deterministic retrieval, similarity search, or LLM-mediated selection... performs better"
(the question posed in scope item 3): no source found in this pass directly compares all three head
to head on identical data. What the evidence does show is that the two non-LLM-mediated approaches
above (arithmetic scoring, graph traversal) both outperform naive full-context stuffing, and that
Anthropic's production guidance explicitly prefers **agent-mediated** selection (the model itself
issuing tool calls to explore) over either — which is a fourth, distinct category (LLM-driven
navigation of raw data, not LLM-driven selection from a pre-scored candidate set) and is the one with
the least controlled-benchmark evidence and the most production adoption. This is itself worth
flagging as a tension: the most evidenced approaches (a, b) are not the one that won in production.

## 5. Context caching economics as it interacts with retrieval strategy

Anthropic's prompt cache (verified from current docs): default TTL 5 minutes, refreshed on every hit
at no extra cost; an optional 1-hour TTL exists at higher write cost. Cache writes cost 1.25× (5-min)
or 2× (1-hour) the base input-token price; cache reads cost 0.1× base input price (0.025× on the
newest Fable-series models). The mechanism is an exact-prefix match at a declared breakpoint — the
documentation explicitly warns that placing the breakpoint on a per-request-variable block (their own
example: a timestamp) silently defeats caching, because the cache write only happens at breakpoints
and a changing block before the breakpoint invalidates everything after it.

```
CLAIM: A context-pack strategy that reassembles its selected content differently on every model call
(e.g., a different subset of files/decisions chosen per task) will not share a cache prefix across
calls, forcing repeated cache-write-priced (1.25-2x) ingestion of content that could otherwise have
been read at the 0.1x cached-read rate, unless the pack is structured so that the volatile, per-task
selection sits strictly after a stable, shared prefix.
LABEL: REASONABLE EXTRAPOLATION (the caching mechanics themselves are OBSERVED TODAY and documented;
the consequence for a dynamically-reassembled context pack is not something any source directly
measured — it follows deductively from Anthropic's own documented breakpoint rule, but no benchmark
of "context-pack reassembly frequency vs cache hit rate" was found).
CONFIDENCE: high for the mechanism, medium for how large the effect is in practice (no measured
numbers found for this specific scenario).
EVIDENCE: Documented cache economics (5-min/1-hr TTL, 1.25x/2x write, 0.1x read) and documented
anti-pattern (breakpoint on a per-request-variable block breaks the cache for everything after it).
SOURCE: Prompt caching — Anthropic — fetched 2026-09-14 — https://platform.claude.com/docs/en/build-with-claude/prompt-caching — accessed 2026-09-14
COUNTEREVIDENCE: none found measuring this specific interaction; flagged as this lane's clearest
unaddressed design constraint (see "problems nobody is talking about," #1).
OPEN QUESTION: is there published guidance (from any vendor) on ordering a context pack — stable
identity/constitution/objective content first, then a small task-variable "recently selected context"
tail — specifically to preserve cache-prefix stability across a retrieval system that changes its
selection every call? None found this pass.
```

A second, softer point: the 5-minute default TTL, refreshed on each hit, means a context pack that
gets reused across a burst of tool calls within a single task (the common case in an agent loop) stays
cheap, but a context pack assembled once per multi-day session (revisiting old project history
occasionally) will almost always cold-write, because the gap between calls exceeds 5 minutes unless
the 1-hour TTL is explicitly requested. This makes the caching benefit strongly a function of *call
frequency*, not just *content stability* — a distinction none of the sources found stated explicitly,
but which follows directly from the TTL-refresh mechanic.

## 6. Over-retrieval / under-retrieval failure modes, with evidence

**Over-retrieval (too much irrelevant context):**
- "Lost in the middle" (2023, still cited as current in 2025-2026 follow-ups found): accuracy
  degrades when relevant information sits in the middle of a long input, regardless of whether the
  model's advertised context window could technically hold it all.
- Chroma's "context rot" (2025, 18 models): degradation is monotonic with input length and begins
  well before the context-window ceiling; distractors (semantically similar but irrelevant content)
  compound the effect; models performed *better* on shuffled/unstructured haystacks than on
  logically-structured ones in some conditions, which is a genuinely counterintuitive finding worth
  flagging on its own (see contradiction #2 below).
- RULER (2024, COLM): only about half of 17 tested models hold "satisfactory" performance at 32K
  tokens despite advertising larger context windows — the effective retrieval length is smaller than
  the marketed context length.
- Graph-based over-retrieval has a distinct, measured failure mode: MS-GraphRAG's global search mode
  inflates to ~4×10⁴ tokens per query (vs ~900 for vanilla RAG), which the source explicitly frames
  as "introduces redundant information, degrading context relevance" — i.e., the failure is not just
  cost, it is *quality* degradation from the extra volume itself, echoing the lost-in-the-middle
  mechanism inside a graph-retrieval system specifically.

**Under-retrieval (too little context):** the sources found are asymmetric here — much more evidence
exists for over-retrieval's cost than for under-retrieval's failure shape. What was found:
- The "when retrieval succeeds and fails" survey names "knowledge boundary unawareness" as a RAG
  failure mode in the *opposite* direction — retrieving when the model already knows the answer,
  wasting cost without improving accuracy (adaptive triggering cut ~40% of unnecessary retrieval
  calls in one cited study) — this is retrieval miscalibration, not strictly under-retrieval, but it
  is the closest documented analogue to "the system didn't know it needed to look something up."
  No source in this pass directly measured hallucinated reconstruction *specifically caused by*
  under-retrieval in a code/decision-memory context (as opposed to general LLM hallucination
  literature, which was out of scope for a targeted pass). This is a real gap, not a finding —
  flagged explicitly in open questions.

## What becomes commodity / what stays hard in retrieval

- **Grep/glob/read as the retrieval substrate for code** — COMMODITY, OBSERVED TODAY. Converged
  across Anthropic, Cursor, and (per lane 05) Cline/Windsurf/Devin/Sourcegraph Amp; independently
  supported by an academic paper (source #15).
- **Progressive-disclosure metadata-first loading (skills, per-directory instructions)** —
  COMMODITY, OBSERVED TODAY at Anthropic; the underlying pattern (cheap-always-on + expensive-
  on-demand) is architecture-agnostic and cheap to replicate.
- **Graph/temporal retrieval for decision-and-supersession memory** — STAYS HARD. The one strong
  result (Zep) is vendor-authored, unreproduced by a third party in this pass, built for
  conversational memory not project/code decision memory, and construction cost/schema-specificity
  is a real, documented tax (source #12, #14).
- **Context-pack assembly that is simultaneously cache-friendly and retrieval-accurate** — STAYS
  HARD, and appears to be genuinely unaddressed in the literature found (see section 5 and problem
  #1 below), not merely difficult.

## 7. Contradictions with common belief

1. **"Embeddings/semantic search are necessary for retrieval over a large codebase."** Contradicted
   directly: Anthropic dropped RAG+vector-DB for Claude Code after finding agentic lexical search
   "generally works better," citing staleness, security, privacy, and reliability, not primarily
   retrieval accuracy (source #5) — and an independent academic paper found keyword search alone
   reaches >90% of vector-RAG performance in an agentic loop (source #15). This is a genuine
   contradiction of common belief, not a strawman: semantic codebase indexing was a heavily marketed
   feature (Cursor "made semantic codebase indexing famous," per lane 05) before being quietly
   retired.
2. **"A model with a huge (1M-token) context window doesn't need retrieval — just paste everything
   in."** Contradicted by the context-rot finding that degradation begins well before the advertised
   context ceiling and is present in every one of 18 tested frontier models regardless of vendor
   (source #9), and by RULER's finding that only about half of tested models hold satisfactory
   performance even at 32K tokens against larger claimed windows (source #10). Bigger context windows
   have not eliminated the need for retrieval; they have raised the token count at which the same
   problem recurs.
3. **"Models perform better on well-organized, logically-structured long context than on shuffled/
   messy context."** Chroma's context-rot study found the *opposite* in some tested conditions —
   models performed better on shuffled haystacks than on logically structured ones (source #9). This
   is counterintuitive enough, and specific enough to this lane's concerns (should a context pack be
   assembled in a "logical" narrative order, or does that actively hurt?), that it is worth flagging
   as its own contradiction rather than folding into #2.

## 8. Problems nobody is talking about

1. **Context-pack reassembly vs. prompt-caching economics is an unaddressed design tension.**
   Anthropic documents the caching mechanism and its anti-patterns in detail (section 5), and
   separately documents progressive-disclosure/just-in-time retrieval as the preferred agent design —
   but no source found in this pass addresses the two together. A retrieval system that legitimately
   needs to select a *different* subset of a multi-year project history on every call (the whole
   point of task-scoped relevance) is structurally in tension with a cache that rewards an *identical*
   prefix across calls. Nobody has published an ordering discipline (e.g., "stable identity layer,
   then stable constitution layer, then a small variable retrieved-context tail, always in that
   position") specifically justified against this trade-off. This is squarely inside this lane's
   scope and appears to be a real, load-bearing gap for Shelra's design.
2. **No benchmark measures retrieval over a corpus whose defining feature is supersession.** Every
   retrieval benchmark found (RepoBench, CodeRAG-Bench, RULER, LongMemEval, the QA sets in the
   long-context-vs-RAG study) tests either static code or a bounded conversation. None tests "retrieve
   the currently-valid decision when three prior, now-superseded decisions on the same topic exist in
   the corpus, and do not surface the stale ones as if current." Zep's temporal-edge model is the
   closest primitive, but it has not been benchmarked on this exact task. This is a genuine research
   gap directly on this mission's central concern, not a restatement of lane 05 or lane 11's territory
   — it's specifically a *retrieval evaluation methodology* gap.
3. **Nobody has published the failure boundary of agentic search itself, only its win.** Every source
   in this pass that documents the shift to agentic/lexical search documents the win (staleness,
   simplicity, >90% of RAG performance) but not the cost curve: how many tool round-trips, how much
   latency, how much token spend does agentic search need as the corpus being searched grows from a
   single repo (Claude Code's original use case) to a multi-year accumulation of decisions, code
   history, and external research (this mission's actual target)? The claims are all validated at
   "codebase" scale; none were found validated at "years of project knowledge" scale.
4. **Staleness is named as a reason to avoid indexing, but no source proposes how a *retrieval*
   system should represent its own staleness/confidence to the caller.** Cherny's stated reason
   includes staleness explicitly, and Generative Agents' scoring formula includes recency as a
   first-class term — but no source combines these into a formal answer to "when a grep-first
   retrieval returns a file or decision that has since been superseded or changed, how does the
   retrieval layer signal that, as opposed to just returning the current byte content silently?" For
   code this is less acute (the file you grep is definitionally current); for a decision ledger, a
   grep-style "return the matching text" retrieval has no native concept of superseded-ness at all —
   that has to come from whatever wrote the corpus (lane 11's territory), but the retrieval mechanism
   itself, as surveyed here, has no query-time mechanism to prefer the live version over a stale match
   unless the underlying data already encodes it structurally (as Zep's temporal edges do, and as flat
   grep over Markdown files does not).

## 9. Open questions for the second wave

1. **Does the grep-first, agentic-search result generalize from "one code repository" to "years of
   accumulated project knowledge across code + decisions + external research"?** All the strongest
   evidence for lexical/agentic retrieval winning (Cherny, Cursor, the Amazon Science paper) is scoped
   to codebases, which have a bounded size, a single canonical current state, and no supersession
   problem. The mission's actual target — a durable, multi-year, decision-laden store — does not share
   those properties. This is the single highest-leverage question for a second-wave lane to settle,
   ideally by finding (or running) a benchmark closer to the mission's real shape than RepoBench or
   LongMemEval.
2. **What is the actual cache-hit-rate cost of task-scoped context-pack reassembly, measured, not
   deduced?** Section 5's claim is a reasonable extrapolation from documented mechanics, not a
   measured number. A second-wave pass (or a cheap internal experiment against the live Anthropic API)
   could measure real cache-hit rates for a retrieval strategy that reselects content per task versus
   one with a stable ordering discipline, and quantify the dollar/latency delta directly rather than
   inferring it.
3. **Is there a published (even partial) benchmark or design for supersession-aware retrieval outside
   Zep's temporal-graph approach** — e.g., anything from the specification/versioning or software-
   configuration-management literature that lane 04 (representations/IR) or lane 11 (memory taxonomy)
   may have surfaced, that this lane's search terms (retrieval, RAG, agent memory) did not reach
   because it lives under a different keyword (e.g., "truth maintenance systems," "belief revision,"
   database temporal-validity literature)? This lane's search vocabulary was retrieval-research-
   centric and may have missed an adjacent, older field that already solved part of this.

## Second wave

(none yet — first-wave report)
