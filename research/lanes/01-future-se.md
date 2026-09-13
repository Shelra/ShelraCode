# Lane 01 — Future of software engineering, 2026 → 2056

Author: research lane 01 (future-se-historian). Written 2026-09-08. All sources accessed 2026-09-08.
Method: scoping review (literature-review skill), arXiv API + OpenAlex + primary document fetch.
Constraint note: this session's WebSearch budget was exhausted before this lane started, and the arXiv
Atom API was rate-limited for most of the run. Discovery therefore ran through the arXiv API where it
worked, OpenAlex (`api.openalex.org`), and direct document fetch. Anything not fetched is marked
UNVERIFIED in `research/sources/01-future-se.md`.

---

## 1. Summary

1. Implementation is already cheap; the evidence says the bottleneck moved to **review and verification**, not to specification.
2. Every prior abstraction shift that succeeded had a *checkable* target semantics; every one that stalled asked a human to specify the solution method, not the problem.
3. The two papers this lane was told to assess are weak evidence: one is a single-author thematic analysis of X posts and YouTube talks; the other is mis-titled in the brief and explicitly says the opposite of "the end of software engineering".
4. The strongest 2026 empirical signal is not "AI writes the code" but "AI writes *more* code": +12.8% LOC with no architectural gain (causal DiD, 151 Java repos).
5. Independent measurements converge on an **abstraction ratchet reversal**: duplication 8.3%→12.3%, refactoring 25%→<10% (GitClear, 211M lines), and models that "prefer to repeat existing code instead of making use of abstractions" (Gu et al.).
6. Trust is falling while adoption rises: Stack Overflow positive sentiment 70%+ (2023-24) → 60% (2025); 3.1% highly trust accuracy; 66% cite "almost right, but not quite".
7. Long-horizon autonomy is hard-capped today: best model fails after **6.2 turns** without a feedback loop; 57 turns with retries but only 25% pass (StaminaBench, AWS).
8. Specification-driven development is a *community forming*, not a validated practice: SpecOps 2026 is the **1st** such workshop; its leading papers state they are "not a validated theory" and that no instrument exists to measure specification effort.
9. The closest working analogue to the north-star loop is not the compiler — it is the **Kubernetes reconciliation loop**, whose official semantics explicitly abandon convergence: "potentially, your cluster never reaches a stable state".
10. The thirty-year claim I can defend: **intent capture becomes cheap, intent *verification* stays expensive**, and the durable asset is the executable acceptance oracle, not the specification prose.

---

## 2. Historical abstraction shifts

Adoption times run from first credible commercial availability to majority use in the shift's home
domain. Where a source does not state an adoption figure, the cell says NOT SOURCED.

| Shift | Year span | Enabling condition | What it cost | What leaked | Adoption time | Source |
|---|---|---|---|---|---|---|
| Machine code → high-level languages (FORTRAN) | 1954–1962 | Compiler output competitive with hand code on a narrow numeric domain | Loss of control over generated code; initial distrust | Machine model leaked: hand-tuning of inner loops persisted | NOT SOURCED (Backus HOPL metadata only) | Backus 1978 (metadata); Brooks 1986: HLLs credited with "at least a factor of five in productivity" |
| Naming the discipline ("software engineering") | 1968 | Large systems exceeded ad-hoc method | — | "a widening gap between ambitions and achievements" (David & Fraser) | Term coined deliberately, adopted immediately | NATO Garmisch report 1968: phrase "deliberately chosen as being provocative" |
| Automatic programming / 4GLs | 1980–1992 | Vendor claim of "application development without programmers" | Retreat to parameterisable domains (sorting, ODE integration) | Parnas: "automatic programming always has been a euphemism for programming with a higher-level language than was presently available to the programmer" | Never reached general adoption | Brooks 1986 §Automatic programming, quoting Parnas 1985; Martin 1981 (metadata) |
| CASE tools | 1985–1995 | Diagram-first method standardisation | Tool-imposed process | NOT SOURCED (Iivari 1996 paywalled) | Failed; the canonical paper is titled "Why are CASE tools not used?" | Iivari, CACM 1996 (metadata only — UNVERIFIED) |
| RTL → gates (logic synthesis) | 1987–1995 | Semantics-preserving translation with a **decidable** equivalence check (SAT-based combinational equivalence checking) | Loss of gate-level hand optimisation | Timing closure and physical effects still human-driven | ~8 years to near-total in the ASIC flow (NOT SOURCED as a figure) | Goldberg/Prasad/Brayton 2001; Mishchenko et al. 2006 (metadata) |
| C → RTL (high-level synthesis) | 1995–2026, ongoing | None sufficient | Restricted input language | "none of the existing tools can deploy general high-level code without manual intervention"; no dynamic memory, recursion, generic pointers; pragmas required | 30+ years, still partial | Numan et al., IEEE Access 2020 |
| UML / MDA / MDE | 1994–2015 | OMG standardisation; MDA 2001 | Training + organisational change | No consistency/completeness check on models; generated code so unreadable that one case saw **certification costs rise ×8** | Never reached wholehearted use: **0/50** wholehearted, 35/50 no UML at all | Petre, ICSE 2013; Whittle/Hutchinson/Rouncefield, IEEE Software 2013 (N=450 + 22 interviews) |
| Declarative query (SQL + optimiser) | 1974–1990 | Fixed relational semantics; **failure mode is slowness, not wrongness** | Loss of plan control | Cardinality misestimation: "for all systems we routinely observe misestimates by a factor of 1000 or more", errors "quickly grow as the number of joins increases" — still true in 2015 | ~15 years to dominance (NOT SOURCED as a figure) | Leis et al., PVLDB 2015 |
| Cloud → declarative infrastructure (Kubernetes) | 2006–2020 | Desired state as data + non-terminating reconciliation | YAML/config complexity | Convergence explicitly not guaranteed: "potentially, your cluster never reaches a stable state" | ~10 years; CNCF 2024 survey N=750 | kubernetes.io controller docs; CNCF Annual Survey 2024 |
| AI-assisted coding | 2021–2026 | Transformer scaling; inference cost for GPT-3.5-level performance fell **280×** Nov 2022 → Oct 2024 | Review burden, trust decline, duplication | "AI solutions that are almost right, but not quite" — 66% of developers | 90% of technology professionals use AI at work by 2025 | Stanford HAI AI Index 2025; Stack Overflow 2025; DORA 2025 (N=4,867); Octoverse 2025 |

### The pattern that actually predicts success

Across the ten rows, the shifts that reached majority adoption (HLL, logic synthesis, SQL, declarative
infrastructure) share one property the failures (4GL, CASE, MDE, HLS) lack: **the target semantics were
fixed and machine-checkable, and the residual gap was a performance gap rather than a correctness gap.**
SQL's optimiser is wrong by 1000× routinely and SQL still won, because a bad plan is slow, not
incorrect. Logic synthesis won because Boolean equivalence between RTL and gates is decidable and was
industrialised. HLS stalled for thirty years because turning C into RTL requires *inventing a
micro-architecture* — a design decision, not a translation. That is precisely Parnas's 1985 point,
quoted by Brooks: "in most cases it is the solution method, not the problem, whose specification has to
be given."

Intent → code sits on the failure side of that line today: the residual gap is a correctness gap, and
no decidable check exists between an English intent and a program.

---

## 3. Analogies outside software

| Analogy | What transfers to "intent → implementation" | What breaks | Evidence |
|---|---|---|---|
| **SQL + query optimiser** | Declaring *what* while a search procedure picks *how* is viable at industrial scale for decades even when the search is badly calibrated; escape hatches (EXPLAIN, hints, indexes) are load-bearing, not embarrassing | The failure mode is asymmetric. A mis-estimated plan is slow; a misread intent is *wrong*. SQL has a fixed denotational semantics that makes the compiler's output verifiably equivalent to the query; English has none | Leis et al. 2015: routine 1000× misestimates, errors grow with joins, "the contribution of the cost model to the overall query performance is limited" |
| **RTL → gates (logic synthesis)** | An abstraction level can be abandoned completely and permanently within ~8 years when the translation is semantics-preserving and independently checkable | Requires a decidable equivalence relation between the two levels. There is no analogue of combinational equivalence checking between a prompt and a program | Goldberg et al. 2001; Mishchenko et al. 2006 (metadata) |
| **C → RTL (high-level synthesis)** | The *closest* structural analogue to intent→code: a higher-level, human-readable input compiled down by a tool that must invent structure | Thirty years in, it still needs restricted subsets, pragmas and manual partitioning. "None of the existing tools can deploy general high-level code without manual intervention." This is the strongest single argument that abstraction shifts requiring *design invention* stall indefinitely | Numan et al., IEEE Access 2020 |
| **UML / MDE** | Modelling delivers real value — but the value was **forced architecture articulation**, not code generation: "code generation is a red herring" | Notation illegible to stakeholders killed it: "How much is UML worth if a business user (the customer) can not understand the result of your modelling effort?" NL specs fix exactly this. But UML's other fatal flaw transfers *intact*: "There is no check on consistency, redundancy, completeness or quality of the model what so ever." NL specs inherit this unchanged | Petre ICSE 2013; Whittle et al. IEEE Software 2013 |
| **Kubernetes controllers** | The best working model of the north-star loop. Desired state is data; a non-terminating controller continuously reduces the gap to observed state; **convergence is explicitly not required** — "As long as the controllers for your cluster are running and able to make useful changes, it doesn't matter if the overall state is stable or not" | Kubernetes controllers act on a closed, typed, machine-observable resource model. "Reality still matches intent" for a business requirement is not observable through an API server. The last arrow of the north-star hypothesis has no analogue here | kubernetes.io/docs/concepts/architecture/controller |
| **Control engineering (Conant–Ashby)** | The theoretical spine: "Every good regulator of a system must be a model of that system." Any system that keeps software aligned to intent must *contain a model of the intent*, and that model's fidelity bounds achievable regulation. This is why the specification cannot be eliminated — only relocated | The theorem says a model is *necessary*, not that a natural-language model is *sufficient*. It also says nothing about who authors the model, which is the actual open question | Conant & Ashby 1970, Int. J. Systems Science (metadata verified via OpenAlex, 1,055 citations; full text UNVERIFIED) |
| **CAD/CAM** | NOT RESEARCHED in this pass — no source fetched. Listed for the second wave rather than asserted | — | NOT FOUND |
| **4GL / "automatic programming"** | The historical control case for the current discourse. The 1980s promise was verbatim the 2026 promise, down to the phrasing | Brooks's 1986 diagnosis already explained why it worked only where "the problems are readily characterized by relatively few parameters" and "extensive analysis has led to explicit rules for selecting solution techniques" | Brooks 1986; Martin 1981 (metadata) |

---

## 4. Current trajectories — claim blocks

### 4.1 The two papers I was asked to assess

```
CLAIM: arXiv:2606.05608 is not "The End of Software Engineering"; it is "Agentic Software: How AI
Agents Are Restructuring the Software Paradigm" by Zhenfeng Cao, and it explicitly rejects the
end-of-SE thesis.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: The arXiv abstract page and HTML full text both give the title as "Agentic Software: How AI
Agents Are Restructuring the Software Paradigm", sole author Zhenfeng Cao, v1 2026-06-04, v2
2026-06-10. The paper states: "Agentic Engineering does not replace software engineering but expands
it." An exact-phrase arXiv search for "end of software engineering" from 2025-06-01 onward returned one
result, an unrelated requirements-elicitation paper (2507.14969). Cao's four-stage roadmap is
Tool-Augmented (2023–2025), Single-Task Autonomous (2025–2027), Multi-Agent Teams (2026–2029),
Self-Evolving Ecosystems (2028+). It reports EvoClaw performance falling from ">80%" on isolated tasks
to "at most 38% in continuous settings", and calls full autonomy "a multi-year research challenge".
SOURCE: Agentic Software: How AI Agents Are Restructuring the Software Paradigm — Zhenfeng Cao —
2026-06-04 — https://arxiv.org/abs/2606.05608 — accessed 2026-09-08
COUNTEREVIDENCE: A paper with that title may exist off arXiv; I could not run a general web search
(session budget exhausted). Treat "no such paper" as "not found on arXiv", not "does not exist".
OPEN QUESTION: Did the brief conflate a blog post or conference talk with an arXiv identifier?
```

```
CLAIM: arXiv:2605.11027 ("From Code-Centric to Intent-Centric Software Engineering") is a
single-author qualitative analysis of public discourse — including X posts and YouTube talks — with
7–25 supporting artifacts per theme, and cannot bear the weight of an empirical claim about the
profession's direction.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: Sole author Elyson De La Cruz, no affiliation in arXiv metadata, comments field "24 pages, 6
tables", v1 only, no journal reference, cs.SE primary with cs.AI cross-list. The corpus has three
layers: peer-reviewed papers, preprints, and "public thought-leadership — YouTube talks, podcasts,
essays, product announcements, X posts". Named priority figures include Karpathy, Ng, Özkaya, Willison,
Dohmke. Theme support counts run 7–25 artifacts; the paper states "Support counts do not imply
statistical weight". Its own limitations: "YouTube interviews and X posts may be partial, performative,
edited, promotional, or unstable over time" and "Productivity evidence remains mixed across tasks and
contexts." Its Table 6 horizons are "approximate and should not be read as predictions". Its central
claim is deliberately modest: "unlikely to produce a simple substitution of developers by agents. A
more plausible trajectory is a reallocation of engineering effort."
SOURCE: From Code-Centric to Intent-Centric Software Engineering — Elyson De La Cruz — 2026-05-10 —
https://arxiv.org/abs/2605.11027 — accessed 2026-09-08
COUNTEREVIDENCE: The paper's conclusion (effort reallocates toward intent, verification and governance)
is independently supported by better sources — Gu et al. 2503.22625, DORA 2025, GitClear. The thesis is
probably right; this paper is not why.
OPEN QUESTION: Is any large-N practitioner study of intent-centric practice under way, as opposed to
discourse coding?
```

```
CLAIM: A large share of the 2026 "AI-native / intent-centric software engineering" literature is
single-author position papers, several by the same author, recycling the same handful of empirical
studies.
LABEL: OBSERVED TODAY
CONFIDENCE: medium
EVIDENCE: Of the arXiv papers in this corpus framing AI-native SE, three are by Mamdouh Alenezi (SDAIA,
Riyadh): 2606.12986, 2607.16680, 2606.28791. Two more are single-author (2605.11027 De La Cruz;
2606.05608 Cao). All five are explicitly position or review papers with no original empirical data. The
quantitative claims they carry are the same studies repeated: Peng et al. 55.8% faster, Cui et al.
+26.1% across 4,867 developers, METR −19%, Pearce et al. ~40% vulnerable Copilot programs.
SOURCE: arXiv metadata and full texts of 2605.11027, 2606.05608, 2606.12986, 2606.28791, 2607.16680 —
accessed 2026-09-08
COUNTEREVIDENCE: Multi-author, institutionally grounded work does exist and is better: Gu et al.
(MIT/Berkeley/Cornell/Stanford, 2503.22625); Díaz et al. (UPM, 2609.00252); Larsen & Moghaddam (SDU,
2606.13298); Paltenghi & Chandra (Meta, 2607.09900); Taivalsaari, Mikkonen & Pautasso
(Nokia/Jyväskylä/USI, 2508.19834); Vir et al. (Columbia, 2608.28880); Sobal et al. (AWS, 2606.19613).
OPEN QUESTION: Does the citation graph of "intent-centric SE" have any empirical root, or does every
path terminate at METR, Cui et al., Peng et al. and Pearce et al.?
```

### 4.2 What is actually measured in 2026

```
CLAIM: Agentic AI adoption causally increases code volume without improving architectural quality.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: Staggered difference-in-differences (Borusyak imputation, Sun-Abraham robustness) over 151
Java repositories (74 adopters, 77 matched controls), 13 months each, 1,811 monthly snapshots, Arcan
tool, treatment detected via .cursorrules / copilot-instructions.md / Co-Authored-By trailers. Lines of
code +12.8% [4.2%, 19.9%], p=0.003. Architectural smell density −6.7% [−11.7%, −2.3%], p=0.004, but raw
smell counts +1.1% [−8.5%, +10.6%], p=0.825. Hub-like dependency density −5.0% (p=0.003). The authors
call the density improvement a "composition effect": adopters "grew code volume substantially without
proportionally increasing architectural violations", and warn that "density-normalized outcomes can
mislead when treatment affects system size."
SOURCE: Mining Architectural Quality Under Agentic AI Adoption: A Causal Study of Java Repositories —
Larsen & Moghaddam, University of Southern Denmark — 2026-06-11 — https://arxiv.org/abs/2606.13298 —
accessed 2026-09-08
COUNTEREVIDENCE: Differential attrition of 16.1%; Lee bounds bracket the effect at [−9.9%, −2.3%] with
the upper bound including zero (p=0.239). Aggressive filtering of stale observations (N=94) attenuates
to non-significance. Mature Java OSS only; 8.9% of controls showed AI markers (corrected effect −7.4%).
OPEN QUESTION: Does the LOC increase persist at 24–36 months, and does maintenance cost scale with it?
```

```
CLAIM: The abstraction ratchet is running backwards: AI-assisted development is measurably increasing
duplication and decreasing refactoring.
LABEL: STRONG TREND
CONFIDENCE: medium-high
EVIDENCE: GitClear, 211 million changed lines from Google/Microsoft/Meta and enterprise repositories,
Jan 2020 – Dec 2024: duplicated ("copy/paste") lines rose from 8.3% of changed lines (2021) to 12.3%
(2024); "moved" lines — the refactoring proxy — fell from 25% (2021) to under 10% (2024); copy/paste
exceeded moved code "for the first time in history". Independently, Gu et al. report that "LLM written
solutions are often more complex than human-written counterparts" and that models prefer "to repeat
existing code instead of making use of abstractions". Independently again, Larsen & Moghaddam measure
+12.8% LOC with flat raw smell counts. Taivalsaari et al. observe that AI-generated code "tends toward
flat, monolithic structures lacking traditional subsystem boundaries".
SOURCE: GitClear AI Code Quality Research 2025 —
https://www.gitclear.com/ai_assistant_code_quality_2025_research — accessed 2026-09-08; Gu et al.
arXiv:2503.22625; Larsen & Moghaddam arXiv:2606.13298; Taivalsaari, Mikkonen & Pautasso
arXiv:2508.19834 — all accessed 2026-09-08
COUNTEREVIDENCE: GitClear is a vendor with a commercial interest in code-quality tooling and its
methodology is not peer-reviewed. "Moved lines" is a proxy for refactoring, not a measure of it. The
2021–2024 window also spans a hiring contraction and a shift in the repository mix.
OPEN QUESTION: Is duplication rising because models cannot abstract, or because cheap code removes the
economic pressure that historically forced humans to abstract? These have opposite remedies.
```

```
CLAIM: Adoption and trust are moving in opposite directions.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: Stack Overflow Developer Survey 2025: 84% using or planning to use AI tools, up from 76% in
2024 — while positive sentiment fell from "70%+ in 2023 and 2024 to just 60% this year". Only 3.1%
"highly trust" the accuracy of AI output; 45.7% distrust it (26.1% somewhat + 19.6% highly). Top
frustration: "AI solutions that are almost right, but not quite" — 66%. Second: "debugging AI-generated
code is more time-consuming" — 45.2%. 16.2% report "No, and I don't plan to" use AI tools. Agents
remain minority practice: 14.1% daily use, 37.9% "not using, no plans", 52% "either don't use agents or
stick to simpler AI tools"; 57.1% strongly agree they are concerned about agent accuracy. DORA 2025
(N=4,867): 90% use AI at work, more than 80% believe it increased their productivity, yet trust is
distributed A great deal 4% / A lot 20% / Somewhat 46% / A little 23% / Not at all 7%.
SOURCE: Stack Overflow Developer Survey 2025 — https://survey.stackoverflow.co/2025/ai — accessed
2026-09-08; DORA State of AI-assisted Software Development 2025 —
https://services.google.com/fh/files/misc/2025_state_of_ai_assisted_software_development.pdf — accessed
2026-09-08
COUNTEREVIDENCE: Falling sentiment is consistent with expectation correction rather than capability
decline — 2023 respondents were rating a demo, 2025 respondents are rating a colleague. The two surveys
also disagree in tone: DORA's 70% "some degree of confidence" versus Stack Overflow's 46% active
distrust. DORA's "AI adoption" factor is built from reliance + trust + reflexive use, so trust sits
inside the independent variable, making "adopters report better outcomes" partly circular.
OPEN QUESTION: Does the "almost right, but not quite" rate fall with model capability, or is it
structural — a property of underspecified intent rather than of the generator?
```

```
CLAIM: Long-horizon autonomous coding is hard-capped today at single-digit turns without an external
feedback loop.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: StaminaBench (AWS Agentic AI) runs coding agents over up to 100 sequential change requests on
REST API servers reaching about 6,000 lines, with tests generated programmatically rather than by an
LLM. Without a feedback loop (R=0) the best model, GLM-5, "failed after just after 6.2 turns on average
with the best harness". With retry feedback (R=2): GLM-5 on OpenCode reaches 57.0 turns at a 25% pass
rate; Qwen3.5-122B on Mini-SWE 33.1 turns at 15%; Kimi K2.5 on OpenCode 26.8 turns at 0%; Nemotron
Super 2.9 turns at 0%; Devstral models 4.8–5.5 turns. Detailed feedback yields "6–12× more turns
completed than minimal feedback"; GLM-5 falls from 57 to 10.7 turns under minimal feedback. Harness
choice accounts for up to a 6× gap. Most retry gains come from the first 3–5 attempts, then plateau.
Failure modes include hallucinating unrequested features, ignoring explicit instructions as context
grows, and self-killing processes via overly broad pkill patterns.
SOURCE: StaminaBench: Stress-Testing Coding Agents over 100 Interaction Turns — Sobal, Yang, Zhang, Xia
& Soatto (AWS Agentic AI) — 2026-06-17 — https://arxiv.org/abs/2606.19613 — accessed 2026-09-08
COUNTEREVIDENCE: Procedurally generated REST-API tasks are narrow and may understate performance where
semantic structure is richer. Frontier closed models were not fully evaluated on cost grounds
(approximately $13,600–$22,700 per configuration), so the true ceiling may be higher than reported.
OPEN QUESTION: Is the turn limit a context/memory problem (solvable by engineering) or a
compounding-error problem (not solvable by scaling)? The 6–12× feedback effect suggests the former; the
plateau after 3–5 retries suggests the latter.
```

```
CLAIM: Real-world agent contribution acceptance is far below benchmark success rates.
LABEL: OBSERVED TODAY
CONFIDENCE: medium-high
EVIDENCE: The AIDev dataset covers 456,535 pull requests from five agents (OpenAI Codex, Devin, GitHub
Copilot, Cursor, Claude Code) across 47,303 developers and 61,453 repositories. Acceptance rates:
OpenAI Codex 65.3% (88.6% for documentation), Devin 48.9%, GitHub Copilot 38.2% — against synthetic
benchmarks exceeding 70%. GitHub Copilot completes 75% of PRs within 18.5 minutes; Codex review
turnaround is 0.3h median versus 3.9h for human-authored PRs. Only 9.1% of Codex PRs introduced
cyclomatic complexity changes versus 23.3% for human-authored PRs.
SOURCE: The Rise of AI Teammates in Software Engineering (SE) 3.0 — Li, Zhang & Hassan, Queen's
University — 2025-07-20 — https://arxiv.org/abs/2507.15003 — accessed 2026-09-08
COUNTEREVIDENCE: Acceptance rate conflates agent quality with maintainer policy and with the difficulty
mix agents are assigned. The low complexity-change rate can be read as "agents do easy work", which
would inflate acceptance rather than depress it. The paper also quotes an industry prediction that has
since failed (see 8.5).
OPEN QUESTION: What is the acceptance rate conditioned on task difficulty and repository maturity?
```

```
CLAIM: Recovering a durable specification from an ephemeral coding session is feasible at industrial
scale but lossy — roughly a third of regenerations still miss ground truth.
LABEL: OBSERVED TODAY
CONFIDENCE: medium
EVIDENCE: AfterVibe (Meta) was evaluated on 72 real vibe-coded tasks from an internal company monorepo,
filtered from 122 candidates. Mean regeneration score 5.06/6.0 at baseline, 5.74/6.0 after iterative
specification strengthening; 26/31 tasks (84%) improved by strengthening. Verification-condition pass
rate 86.8%; flex test pass rate 72.1%; ground-truth alignment pass rate 66.2%. Specification
compression 5.69×; code leakage (token overlap) 38.6%; regeneration diversity chrF 0.89. Negative
controls: the VC grader drops to 47% on partially degraded code, 1.4% on unrelated code, 0% on the
pre-change state. Extracted specifications beat human-authored commit summaries by +0.82 points. The
paper's framing: developer intent lives "ephemerally in a chat transcript" and specifications should
become "the source of record — the canonical artifact from which an implementation can be
reconstructed."
SOURCE: AfterVibe: What Remains When the Conversation Ends — Paltenghi & Chandra (Meta) — 2026-07-10 —
https://arxiv.org/abs/2607.09900 — accessed 2026-09-08
COUNTEREVIDENCE: 66.2% ground-truth alignment means a third of regenerations from a recovered
specification do not match what was actually meant. 38.6% code leakage suggests the "specification" is
partly a paraphrase of the implementation, which would inflate regeneration scores.
OPEN QUESTION: Does specification-driven regeneration beat editing existing code on cost, not just on
fidelity? No source in this corpus measures both sides.
```

```
CLAIM: Specification-driven development in 2026 is a community forming around a hypothesis, not a
validated practice, and its own proponents say so.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: SpecOps 2026 is billed as the "1st International Workshop on Specification-Driven Development
Life Cycle", co-located with ISSTA 2026 on 6 October 2026 in Oakland, California; its scope is to
"foster dialogue on how AI-powered tools and autonomous agents can transform specifications from static
documentation into living, executable, and lifecycle-spanning drivers of modern software and AI system
development." Díaz et al. (UPM) present an SDD framework with no empirical evaluation, describing their
work as "a first step toward an academic–industrial consensus, rather than as a validated theory", and
list five expected risks: talent bifurcation, cultural fracture, cost spiral, specification drift,
platform lock-in. Their durability argument is that the "technical harness" around the model
"depreciates quickly" while the "methodological harness" of team practices and specifications
"appreciates over time". Alenezi's SGRM paper concedes that "the discipline lacks measurement
instruments for specification effort comparable to those it has for code" and that "designing languages
simultaneously human-authorable, machine-verifiable, and LLM-legible" remains "an open design problem".
SOURCE: SpecOps 2026 — https://conf.researchr.org/home/splash-issta-2026/specops-2026 — accessed
2026-09-08; Díaz, Gayoso, Cimminio & Pérez arXiv:2609.00252 — accessed 2026-09-08; Alenezi
arXiv:2607.16680 — accessed 2026-09-08
COUNTEREVIDENCE: Alenezi reports a banking-microservices case with "73% reduction in security defects",
"50% reduction in time-to-market", "90% first-review acceptance rate" for AI-generated code and one
engineer with four agents delivering work scoped for a four-person squad — but the same paper states
these "require replication across organizations". Single-case, unreplicated, author-reported.
OPEN QUESTION: Will SpecOps produce a shared benchmark for specification quality, or will SDD repeat
MDE's trajectory — real but narrow value, oversold as code generation?
```

```
CLAIM: The named bottleneck in credible AI-for-SE research is not generation but the abstraction gap
between English and code, compounded by models that do not ask.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: Gu, Jain, Li, Shetty, Shao, Li, Yang, Ellis, Sen & Solar-Lezama name nine bottlenecks. On
intent: "there is a gap in the level of abstraction between English and code, leading to incomplete or
ambiguous specifications"; "programmers often seek specific functionality, yet they lack reliable ways
to steer LLMs toward generating precisely the desired code", forcing a "trial-and-error approach,
repeatedly sampling outputs"; and critically "LLMs rarely defer to humans for clarification, while
developers often ask questions", which they describe as "the top-reported challenge in human-agent
collaboration". Implicit constraints — style guides, codes of conduct, the unstated
serializer/deserializer pair — are inferred incorrectly. Trade-offs between performance, readability
and security "rarely" appear in initial prompts. On planning: models cannot "perform this level of
sophisticated planning" needed to "design and structure code to best support future functionalities".
On evaluation: performance "on competitive programming and SWE-Bench tasks has been shown to degrade
over time, indicating the possibility of older problems being contaminated."
SOURCE: Challenges and Paths Towards AI for Software Engineering — Gu et al. (MIT, Berkeley, Cornell,
Stanford) — 2025-03-28 — https://arxiv.org/abs/2503.22625 — accessed 2026-09-08
COUNTEREVIDENCE: This is a position paper dated March 2025; some bottlenecks (context length, tool use)
have measurably moved since. The clarification-deferral finding is corroborated by the mission-brief
evidence on semantic collapse (arXiv:2607.01953) and clarification benchmarks (ClarEval 2603.00187,
ClarifyCodeBench 2607.00711) — see lane 02.
OPEN QUESTION: Is "rarely defers" a training-objective artefact (models are rewarded for answering) or
a capability limit? If the former it is a cheap fix and the intent bottleneck partly dissolves.
```

```
CLAIM: Deterministic checking of user-authored intent constraints outperforms LLM judging of the same
constraints.
LABEL: OBSERVED TODAY
CONFIDENCE: medium
EVIDENCE: FlowCheck (Columbia DAPLab) lets end-users express intent by clicking UI components, compiles
the result into a constraint language of the form P(event | action) = 0 or 1, lowers that to CodeQL
control-flow and data-flow queries, and checks statically without executing the app. Against 30
injected behavioural violations across four applications (Amazon-, Twitter-, Airbnb-, Slack-like, with
14–21 constraints each): FlowCheck caught 30/30 with 0 false positives; the best LLM-prompt
configurations reached 26/30 (Claude Opus 4.7, 87%), 24/30 (DeepSeek V3), 24/30 (Gemini Pro). Models
struggled with universal-quantifier constraints and cross-handler data flows. The target failure class
is "silent behavioral failures... especially difficult to detect when the application compiles, renders
normally, and produces plausible feedback."
SOURCE: FlowCheck: Helping End-Users Specify and Verify Intent in Vibe-Coded Web Apps — Vir, Chilton,
Zhang & Wu (Columbia University) — 2026-08-28 — https://arxiv.org/abs/2608.28880 — accessed 2026-09-08
COUNTEREVIDENCE: 30 injected violations is a small, researcher-authored evaluation set, and the
comparison is against LLMs prompted for the same task rather than against a tuned judge. Static
analysis cannot see runtime-only properties, race conditions, or dynamically generated HTML;
virtual-DOM frameworks are explicitly a problem. No user study with actual vibe coders was run.
OPEN QUESTION: How much of intent is expressible as control/data-flow constraints on visible UI
elements? This answers "does the information flow"; it says nothing about "is this the right
information".
```

```
CLAIM: The industry-scale telemetry picture is "more output, more review, more instability" — not
"faster delivery".
LABEL: STRONG TREND
CONFIDENCE: medium-high
EVIDENCE: DORA 2024 measured "an estimated 1.5% reduction in software delivery throughput and an
estimated 7.2% increase in software delivery instability for every 25% increase in AI adoption". DORA
2025 (N=4,867) reports throughput has flipped positive but instability remains: "AI adoption now
improves software delivery throughput, a key shift from last year. However, it still increases delivery
instability." Friction and burnout show no relationship; all 2025 standardized effects sit between 0.00
and roughly 0.20. Faros AI telemetry, reported via Díaz et al. and the vibe-coding review: +21%
individual task completion, +98% merged pull requests, +91% PR review time, +9% defects; a second
reading gives +33.7% tasks with +441% review time, +54% bugs per developer, +242.7% incidents per PR.
METR's RCT: 16 experienced maintainers on repositories averaging "22k+ stars and 1M+ lines of code",
246 issues, took 19% longer with AI, having predicted a 24% speedup and still believing afterwards they
were 20% faster. GitHub Octoverse 2025: 1 billion commits (+25.1%), 43.2M PRs merged monthly (+23%),
1M+ PRs from the Copilot coding agent May–September 2025, 180M+ developers, 80% of new developers use
Copilot in their first week.
SOURCE: DORA 2025 report PDF; METR — 2025-07-10 —
https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/; GitHub Octoverse 2025 —
https://github.blog/news-insights/octoverse/; Vibe Coding: Practice, Performance, Productivity, and
Risk — arXiv:2608.20446 — all accessed 2026-09-08
COUNTEREVIDENCE: METR's authors explicitly refuse the generalisation, listing among claims they do NOT
support: "AI systems do not currently speed up many or most software developers". DORA's outcomes are
all self-reported by the same respondent, and its "AI adoption" factor is built from reliance + trust +
reflexive use, so trust is inside the independent variable. The Faros figures reach me only through
secondary sources; the primary is UNVERIFIED.
OPEN QUESTION: Nobody in this corpus stratifies productivity by codebase age. The vibe-coding review
names this as its own primary limitation: "No study in the corpus stratifies AI-assisted productivity
by codebase age."
```

```
CLAIM: Software reuse is not disappearing; it is mutating into "generative reuse", which reuses
knowledge without reusing artifacts — and therefore loses the compounding benefit that made reuse
valuable.
LABEL: STRONG TREND
CONFIDENCE: medium
EVIDENCE: Taivalsaari, Mikkonen & Pautasso argue that where classic opportunistic reuse selected
existing components, "in the AI driven approach the bulk of the system is generated automatically",
producing code that "tends toward flat, monolithic structures lacking traditional subsystem boundaries
that enable maintainability", plus hallucinated library references and the "slopsquatting"
supply-chain risk. Tërnava's "variability by regeneration" pushes this to its logical end: the LLM
becomes "the derivation engine, generating a dedicated, free of dead code binary for each variant", the
specification is "the evolution log" and code is a "regenerated by-product". Her exploratory analysis
of 10 vibe-coded C/C++ projects (201–14,077 lines) found they collectively exposed only 45 CLI options
(median 0) and 27 preprocessor variables, versus x264's 184 CLI options and 117 preprocessor variables
across 2,201 directives — i.e. vibe-coded software carries almost no explicit variability.
SOURCE: On the Future of Software Reuse in the Era of AI Native Software Engineering — Taivalsaari
(Nokia), Mikkonen (Jyväskylä), Pautasso (USI) — 2025-08-27 — https://arxiv.org/abs/2508.19834; Where
Did the Variability Go? From Vibe Coding to Product Lines by Regeneration — Tërnava (Télécom Paris) —
2026-06-17 — https://arxiv.org/abs/2606.19042 — both accessed 2026-09-08
COUNTEREVIDENCE: Tërnava's own limitations: LLM non-determinism, no formal correctness guarantees, lost
reuse across variants ("two variants including the same feature may receive different
implementations"), and a single small case study (a `wc` family, six features, three variants). The
10-project sample is tiny and selected.
OPEN QUESTION: If every variant is independently generated, what replaces the security-patch
propagation that shared libraries provide today?
```

---

## 5. Timeline 2026 → 2056

Every horizon carries three tiers. Per the mission brief, thirty-year claims are almost never above
REASONABLE EXTRAPOLATION, and nothing below exceeds that.

### 2026 — where we actually are

- **High-confidence trajectory (OBSERVED TODAY).** 90% of technology professionals use AI at work; 84%
  of developers use or plan to use AI tools; agents remain minority practice (14.1% daily, 52% not
  using agents at all). Agent PR acceptance runs 38–65% in the wild against >70% on benchmarks.
  Autonomy breaks at ~6 turns without feedback and reaches ~57 turns at a 25% pass rate with retries.
  Throughput up, instability up, review time up sharply, duplication up, refactoring down, trust down.
  No 2026 DORA report exists yet. The first specification-driven-lifecycle workshop happens next month.
- **Medium-confidence possibility (STRONG TREND).** The bottleneck has already moved from writing to
  reviewing. The scarce artifact is a trustworthy acceptance oracle, not a specification document.
- **Speculative frontier.** That any organisation has a working closed loop from business intent to
  production behaviour and back. I found no such report in this corpus.

### 2030

- **High-confidence trajectory (REASONABLE EXTRAPOLATION from STRONG TREND).** Specifications become
  first-class version-controlled artifacts with review discipline, because the review bottleneck forces
  it — the one prediction on which every source in this corpus agrees, from Meta's AfterVibe to UPM's
  SDD framework to Gu et al. Expect specification-quality benchmarks and spec-diff tooling to exist and
  matter. Expect agent turn limits to move by an order of magnitude through harness engineering rather
  than model scaling, since the observed 6–12× feedback effect is already engineering, not scale.
- **Medium-confidence possibility (REASONABLE EXTRAPOLATION).** Regeneration-instead-of-maintenance
  becomes real practice for small, leaf-level, high-variability components — precisely where MDE's DSLs
  succeeded: narrow, well-understood domains, built in about two weeks. It does not touch the core.
- **Speculative frontier.** A decidable-enough equivalence check between a natural-language intent and
  a program, analogous to combinational equivalence checking in hardware. Nothing here makes this look
  close; Vericoding's 82% Dafny / 44% Verus / 27% Lean verified-synthesis rates (mission brief) argue
  against, as does its finding that natural-language descriptions did not help.

### 2035

- **High-confidence trajectory (REASONABLE EXTRAPOLATION).** The primary engineering activity is
  **oracle engineering**: designing, maintaining and evolving the executable checks that decide whether
  a generated system matches intent. Three independent lines converge on this. Conant–Ashby: the
  regulator must contain a model of the system. FlowCheck: deterministic checks beat LLM judges 30/30
  versus 26/30. And the mission brief's finding that LLMs judge membership far better than they
  enumerate sets (F1 0.60–0.77 versus 0.26–0.48, arXiv:2608.01000) — which says the machine is good at
  *checking* and bad at *specifying*, exactly inverting the popular division of labour.
- **Medium-confidence possibility.** Codebases bifurcate into a small hand-maintained *kernel* carrying
  the invariants and a large regenerated *shell*. This is the high-level-synthesis outcome transposed:
  abstraction rises where structure can be derived and stalls where structure must be invented.
- **Speculative frontier.** Natural language stops being the primary intent medium in favour of a
  constraint-plus-example hybrid, because "almost right, but not quite" proves structural rather than
  capability-limited.

### 2040

- **High-confidence trajectory (REASONABLE EXTRAPOLATION).** The intent→reality loop closes for
  *observable* properties — latency, cost, error rates, data-flow reachability — because those already
  have a telemetry substrate (OpenTelemetry graduated CNCF in May 2026; see lane 07). It stays open for
  *interpretive* properties: whether the thing built was the right thing.
- **Medium-confidence possibility.** Specification drift becomes the dominant maintenance cost, the way
  dependency management became the dominant cost of the package era. Díaz et al. already name it as an
  expected risk in 2026, with no detection method.
- **Speculative frontier.** Regulatory or contractual regimes that make the specification, not the
  code, the legally binding artifact. There is no evidence for this today; I flag it because it is the
  single change that would most alter the economics of everything above.

### 2045

- **High-confidence trajectory (REASONABLE EXTRAPOLATION).** Someone still has to decide what the
  system is *for* and adjudicate conflicts between stakeholders. Brooks's 1986 claim has survived forty
  years of tooling: "The hardest single part of building a software system is deciding precisely what
  to build... For the truth is, the clients do not know what they want. They usually do not know what
  questions must be answered, and they almost never have thought of the problem in the detail that must
  be specified." Nothing in the 2026 evidence base contradicts it; the Specification Paradox paper
  restates it in AI terms.
- **Medium-confidence possibility.** "Software engineer" splits the way "engineer" split in the 19th
  century — into an intent-and-verification profession and an operations profession — with the middle,
  implementation, largely gone. Díaz et al.'s "talent bifurcation" risk is the 2026 seed of this.
- **Speculative frontier.** Systems that negotiate their own specifications with stakeholders and
  surface only the conflicts to humans. Requires clarification behaviour that today's models
  demonstrably lack: "LLMs rarely defer to humans for clarification."

### 2050

- **High-confidence trajectory (REASONABLE EXTRAPOLATION, low confidence).** One thing only:
  verification cost does not go to zero, because verification is where the human's model of the world
  enters the system, and Conant–Ashby says that model cannot be eliminated, only relocated.
- **Medium-confidence possibility.** Software is maintained the way infrastructure is maintained today:
  continuously reconciled toward a declared state nobody expects to fully reach — the Kubernetes
  semantics generalised, with "your cluster never reaches a stable state" as the normal condition.
- **Speculative frontier.** Everything else. I decline to specify.

### 2056

- **High-confidence trajectory.** NONE, and claiming one would be a defect. Thirty years back from 2026
  is 1996: the web was four years old, Java was one, and the confident forecasts were CORBA and CASE
  tools. The only structural claim I will make is that an intent gap will still exist, because intent is
  generated by humans changing their minds, and no amount of derivation closes a gap whose source keeps
  moving.
- **Medium-confidence possibility.** NOT FORECASTABLE from this evidence base.
- **Speculative frontier.** NOT FORECASTABLE from this evidence base.

---

## 6. What becomes cheap / scarce / human / machine

### Becomes cheap

| Item | Label | Evidence |
|---|---|---|
| Producing plausible code | OBSERVED TODAY | 1M+ Copilot agent PRs May–Sept 2025; 1B commits in 2025 (+25.1%) |
| Inference | OBSERVED TODAY | Inference cost for GPT-3.5-level performance fell 280× Nov 2022 → Oct 2024 (AI Index 2025) |
| Model choice as a differentiator | OBSERVED TODAY | Top-vs-10th model gap fell 11.9% → 5.4% in a year; top two separated by 0.7% (AI Index 2025) |
| First drafts, boilerplate, scaffolding, documentation | OBSERVED TODAY | Codex documentation PR acceptance 88.6%; 86.5% of AI docs rated equivalent or better than human-written |
| Producing many *variants* of one system | STRONG TREND | Variability by regeneration (Tërnava); generative reuse (Taivalsaari et al.) |
| Recovering a specification from a session transcript | OBSERVED TODAY | AfterVibe: 5.69× compression, +0.82 over human commit summaries |

### Stays scarce

| Item | Label | Evidence |
|---|---|---|
| Knowing what to build | OBSERVED TODAY (unchanged since 1986) | Brooks 1986; Specification Paradox 2026: "AI does not eliminate ambiguity; it transforms ambiguity into executable behavior" |
| Trustworthy acceptance oracles | OBSERVED TODAY | FlowCheck 30/30 vs best LLM 26/30; AfterVibe ground-truth alignment 66.2% |
| Review capacity | OBSERVED TODAY | +91% to +441% PR review time against +21% to +33.7% task completion (Faros, via secondary sources) |
| Coherence over long horizons | OBSERVED TODAY | StaminaBench: 6.2 turns unassisted; 25% pass at 57 turns |
| The invention of new abstractions | STRONG TREND | Models "prefer to repeat existing code instead of making use of abstractions" (Gu et al.); duplication 8.3%→12.3%, refactoring 25%→<10% (GitClear) |
| Institutional memory of *why* | REASONABLE EXTRAPOLATION | Intent lives "ephemerally in a chat transcript" (AfterVibe); UML's unsolved consistency problem transfers intact to NL specs |
| Human attention | STRONG TREND | 30% little or no trust (DORA); 66% "almost right, but not quite" — every output needs a human pass |

### What humans still decide

- Which conflicts between stakeholders get resolved which way. **OBSERVED TODAY** — no source in this
  corpus proposes automating this; Kohl & Carro name "human discernment" as the residual scarcity:
  "What remains scarce is not implementation capacity, but human discernment."
- What counts as acceptable failure, and for whom. **OBSERVED TODAY** — DORA's persistent instability
  finding is exactly an unresolved risk-appetite question, not a technical one.
- When to stop regenerating and start understanding. **STRONG TREND** — the vibe-coding literature's
  central unmeasured quantity: "the point at which accumulated debt makes such a codebase cheaper to
  replace than to maintain is not visible in any dataset."
- Whether the system that satisfies the specification is the system that was wanted. **OBSERVED
  TODAY** — the Specification Paradox names this failure "specification overfitting": implementations
  that satisfy explicit specifications while failing "to address the broader problem, business needs,
  user expectations, or scenarios omitted during requirements elicitation."

### What machines derive

- Implementation from a sufficiently constrained specification. **OBSERVED TODAY**, with the
  qualification that "sufficiently constrained" is doing all the work in that sentence.
- Test scaffolding, documentation, migration mechanics, refactor execution. **OBSERVED TODAY.**
- Deterministic conformance checks from user-expressed constraints. **OBSERVED TODAY** (FlowCheck's
  UI-click → CodeQL pipeline).
- Membership judgements ("is this output acceptable?") far better than enumeration ("list all
  acceptable outputs"). **OBSERVED TODAY** — mission brief, arXiv:2608.01000, F1 0.60–0.77 versus
  0.26–0.48. This asymmetry is the most actionable fact in this lane: build checkers, not generators of
  requirement sets.

---

## 7. Contradictions with common belief

**7.1. "AI is making software engineering faster." The measured story is that it is making it
*bigger*, and volume is not velocity.**
DORA 2024 measured a 1.5% *reduction* in throughput and a 7.2% *increase* in instability per 25%
increase in AI adoption; DORA 2025 flipped throughput positive but instability stayed. METR's RCT found
experienced maintainers 19% slower while believing they were 20% faster — a 39-point gap between
perception and measurement. Faros telemetry shows +98% merged PRs against +91% review time. Larsen &
Moghaddam's causal study shows +12.8% LOC with flat raw architectural smell counts. Octoverse shows
+25.1% commits. Every one of these is consistent with "more artifacts, same delivery" and inconsistent
with "faster delivery". The common belief survives because more than 80% of DORA respondents *believe*
AI increased their productivity — which is precisely the belief METR measured as wrong.

**7.2. "Rising abstraction is the direction of history, so intent-level programming is inevitable."
Inside hardware design, the identical bet has been stalled for thirty years.**
Logic synthesis (RTL→gates) went from introduction to near-total dominance in under a decade and
permanently retired an abstraction level. The very next step up — C→RTL high-level synthesis — has been
worked on since the mid-1990s, and a 2020 survey concludes "none of the existing tools can deploy
general high-level code without manual intervention", still requiring restricted subsets without
dynamic memory, recursion or generic pointers, plus pragmas and manual partitioning. Same industry,
same incentives, same talent, thirty years, no ratchet. The difference is not effort: one step was a
semantics-preserving translation with a decidable check, and the other requires inventing structure.
Intent→code sits on the second side of that line. Anyone forecasting "abstraction always rises" owes an
explanation of why HLS did not.

**7.3. "Specifications will become the durable artifact and code will become disposable." UML made
exactly this bet and lost, and the specific reason it lost has not been fixed.**
Petre's 50-company interview study found 35/50 using no UML at all and **0/50** using it wholeheartedly,
nineteen years after UML's introduction. Whittle et al. (N=450 + 22 interviews) found MDE productivity
gains of 20–30% that were "not considered significant enough to drive an MDE adoption effort", and
concluded "code generation is a red herring". One documented case saw code certification costs rise
**eightfold** because generated code was unreadable. Two of UML's three fatal flaws are genuinely fixed
by natural language: stakeholder illegibility ("How much is UML worth if a business user (the customer)
can not understand the result of your modelling effort?") and notation intruding on reasoning. The third
is not fixed at all. Petre's informant: "There is no check on consistency, redundancy, completeness or
quality of the model what so ever." That sentence describes a Markdown specification in 2026 exactly as
well as it described a UML model in 2013. Meanwhile Whittle's *positive* finding — that MDE's real value
was forcing explicit architecture, not generating code — is the finding the 2026 SDD literature has not
yet noticed it is repeating.

**7.4. "The literature says software engineering is ending." It says the opposite, and the paper cited
for that claim says the opposite most explicitly of all.**
arXiv:2606.05608, handed to me as "The End of Software Engineering", is Zhenfeng Cao's "Agentic
Software", which states: "Agentic Engineering does not replace software engineering but expands it."
The intent-centric paper concludes with "a reallocation of engineering effort", not substitution. The
SIGSOFT community perspective makes no predictions at all and is mostly about publication models.
Informatics Europe's position paper argues SE is being *under*-recognised and is at risk of "being
perceived as a commodity". The "end of software engineering" is a discourse artifact that neither the
peer-reviewed nor the preprint literature supports.

**7.5. "Better models will close the intent gap." Trust fell while capability rose.**
Between 2023 and 2025 model capability rose steeply on every benchmark (SWE-bench +67.3 percentage
points in one year per AI Index), while Stack Overflow developer sentiment fell from 70%+ to 60%, active
distrust of accuracy reached 45.7%, and the top frustration — "almost right, but not quite" — hit 66%.
If the intent gap were a capability gap, this pattern would be inverted. The most parsimonious reading
is that capability gains move the *location* of the residual error without shrinking the human's
obligation to check.

---

## 8. Problems nobody is talking about (lane-specific)

**8.1. The abstraction ratchet may be running backwards, and nobody is measuring it as such.**
Four sources point the same way and none of them cite each other: GitClear's duplication 8.3%→12.3% and
refactoring 25%→<10%; Gu et al.'s observation that models prefer "to repeat existing code instead of
making use of abstractions"; Larsen & Moghaddam's +12.8% LOC with flat raw smell counts; Taivalsaari et
al.'s "flat, monolithic structures lacking traditional subsystem boundaries". Every prior abstraction
shift in section 2 was driven by humans inventing abstractions under cost pressure. Cheap generation
removes the cost pressure and the generator does not supply the invention. If that holds, 2026–2035 is
the first period in computing history in which the abstraction level of working code *falls* while
tooling capability rises. Nobody has framed it that way and nobody is running the longitudinal study
that would settle it.

**8.2. Specification drift has no measurement instrument, and the field knows this and has not acted.**
Alenezi states plainly that "the discipline lacks measurement instruments for specification effort
comparable to those it has for code". Díaz et al. list specification drift as an expected risk with no
detection method. We have fifty years of code metrics — cyclomatic complexity, coupling, churn, smell
density, and now Arcan-style architectural smells — and effectively zero specification metrics. Everyone
proposing that specifications become the source of truth is proposing to make the unmeasured artifact
load-bearing. Historically that is how MDE failed: models had no consistency check, so they rotted
silently.

**8.3. Nobody is studying regeneration economics, only regeneration fidelity.**
AfterVibe measures whether regeneration reproduces behaviour (66.2% ground-truth alignment). Tërnava
proposes regeneration as the derivation mechanism. Neither measures the *cost* of regenerating versus
editing, and the vibe-coding review names the missing quantity exactly: "The point at which accumulated
debt makes such a codebase cheaper to replace than to maintain is not visible in any dataset." The
entire "code becomes ephemeral" future rests on an unmeasured crossover point. For a solo bootstrapped
builder this is the decisive number, and it does not exist.

**8.4. Security-patch propagation in a regenerated world.**
Shared libraries give a single-point fix for a vulnerability across every consumer. If each variant is
independently generated — Tërnava's explicit design, and the direction generative reuse points — a CVE
has no propagation path at all. Tërnava names the loss of reuse ("two variants including the same
feature may receive different implementations") but treats it as an efficiency issue. Taivalsaari et al.
raise hallucinated dependencies and slopsquatting but not the inverse problem. I found nobody addressing
patch propagation for regenerated software, and it is the most obvious way the regeneration future
fails in production.

**8.5. Forecast calibration in this field is terrible and nobody keeps score.**
In July 2025 the lead engineer on Claude Code was quoted predicting "There's a good chance that by the
end of the year, people aren't using IDEs anymore". Fourteen months later, Stack Overflow 2025 shows
37.9% of developers not using agents at all with no plans to. Klarna's February 2024 claim of AI doing
the work of 700 FTEs was walked back fifteen months later with rehiring, citing lower quality. Cao's
roadmap places "Self-Evolving Ecosystems" at 2028+ while the best measured agent fails after 6.2
unassisted turns. Nobody in this literature maintains a public, dated prediction ledger, so the same
confident horizons get restated each year with the dates shifted forward.

**8.6. The evidence base for "intent-centric SE" is thinner than its citation count suggests.**
Five of the papers framing this shift are single-author position pieces, three by the same author, and
their quantitative content reduces to four studies (Peng, Cui, METR, Pearce) recycled. Meanwhile the
strongest 2026 empirical results — Larsen & Moghaddam's causal DiD, AfterVibe's industrial evaluation,
StaminaBench's turn limits, FlowCheck's deterministic-vs-judge comparison — are not the papers being
cited in the discourse. A field whose narrative papers and whose measurement papers do not overlap is a
field about to be surprised.

---

## 9. What becomes commodity / what stays hard (this lane)

**Becomes commodity**
- Code generation from a well-scoped, well-constrained task. **OBSERVED TODAY.**
- Frontier model access as a differentiator — the top-10 spread collapsed to 5.4% in a year, top two to
  0.7%. **OBSERVED TODAY.**
- Agent harnesses and scaffolding patterns — StaminaBench shows a 6× harness gap today, exactly the
  shape of a gap that closes as patterns diffuse. **REASONABLE EXTRAPOLATION.**
- Spec-to-code pipelines: three frameworks already exist (GitHub Spec Kit, Alenezi's SGRM, the UPM SDD
  framework) with no moat between them. **STRONG TREND.**
- Post-hoc specification extraction from transcripts — AfterVibe demonstrates it works and Meta
  published it. **OBSERVED TODAY.**

**Stays hard**
- Deciding what to build. **OBSERVED TODAY** — unchanged since Brooks 1986 and restated in 2026.
- Constructing an oracle that is cheaper to trust than the artifact it checks. **OBSERVED TODAY** —
  this is the actual bottleneck and the actual product opportunity.
- Detecting silent, self-consistent failures. **OBSERVED TODAY** — FlowCheck's "silent behavioral
  failures... the application compiles, renders normally, and produces plausible feedback"; and the
  mission brief's semantic collapse, where models unanimously converge on one wrong reading in 3–32% of
  tasks, invisible to disagreement-based detectors.
- Keeping a specification honest as the world moves. **REASONABLE EXTRAPOLATION** — no instrument
  exists.
- Inventing abstractions. **STRONG TREND** — the ratchet-reversal evidence in 8.1.
- Long-horizon architectural coherence. **OBSERVED TODAY** — StaminaBench, plus Gu et al.'s finding that
  models cannot "perform this level of sophisticated planning".

---

## 10. Open questions for the second wave

1. **Does the HLS analogy hold or break?** The decisive test: is there any documented case where a
   generative tool reliably *invented* a structure — an architecture, a micro-architecture, an
   abstraction — that a competent human would have chosen, as opposed to translating one that was
   supplied? I found none. A single well-documented counterexample would substantially weaken this
   lane's central argument, and finding one should be wave two's first job.
2. **Where is the regeneration-versus-maintenance cost crossover?** No dataset in this corpus measures
   it. Without it, "code becomes ephemeral" is unfalsifiable.
3. **Is "almost right, but not quite" (66%) structural or capability-limited?** If it falls with model
   capability the intent gap is temporary; if it is flat across the 2023→2026 capability curve it is a
   property of underspecification and the verification market is durable. The Stack Overflow time series
   can answer this; I could not retrieve prior years' figures for this exact item.
4. **Does the duplication trend continue past 2024?** GitClear's series ends December 2024. A 2025–2026
   extension is the single highest-value measurement for the ratchet-reversal hypothesis, and a
   non-vendor replication would be better still.
5. **What is agent PR acceptance conditioned on repository maturity and task difficulty?** The AIDev
   dataset (456,535 PRs) can answer this; the published analysis does not stratify.
6. **Does Whittle's MDE finding transfer?** If specification-driven development's real value turns out
   to be forced architecture articulation rather than code generation — as MDE's was — then the product
   to build is a specification *review* tool, not a specification *compilation* tool. This is testable
   now and cheaply, by asking SDD adopters what they actually got.
7. **Is there a decidable-enough check between intent and program?** Lane 03 owns formal methods, but
   this lane's historical analysis says the whole question of whether intent-centric SE succeeds reduces
   to it. Vericoding's 82%/44%/27% by language is the current answer and it is not encouraging.
8. **Who is keeping score on forecasts?** A public, dated prediction ledger for this field does not
   appear to exist. Building one is cheap and would be immediately useful — including to this mission.
9. **Two numeric coincidences worth resolving.** DORA 2025 reports "a total of 4,867 respondents"; Cui
   et al.'s multi-firm field experiment is repeatedly cited as covering 4,867 developers. These are
   presented as independent studies. Either it is coincidence or a transcription error has propagated;
   wave two should check both primaries.
10. **Unretrieved sources that could change this lane's conclusions.** Pezzè et al., "A 2030 Roadmap for
    Software Engineering" (ACM TOSEM 2025) — the flagship community roadmap, paywalled and unread here;
    Iivari, "Why are CASE tools not used?" (CACM 1996); Lahti et al., "Are We There Yet? A Study on the
    State of High-Level Synthesis" (IEEE TCAD 2018) — the quantitative HLS-versus-RTL comparison that
    would sharpen section 3; Conant & Ashby 1970 full text; Martin & Smith, "High-Level Synthesis: Past,
    Present, and Future" (IEEE D&T 2009). All five should be obtained in wave two, most likely through
    institutional access rather than open fetch.
