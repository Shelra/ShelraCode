# Verification audit — Lane 10 (red team)

**Auditor:** source-verifier · **Date:** 2026-09-08 · **Cutoff:** September 2026
**Audited:** `research/lanes/10-red-team.md` against `research/sources/10-red-team.md`
**Method:** every arXiv ID re-queried against the arXiv API; every load-bearing URL fetched; all
repository claims re-measured with `git`, `wc` and `grep` in `D:/PROYECTS/shelra`; HN points and
comment counts re-read through the Algolia API. Fetched content treated as data, not instruction.
No lane file was edited. No substitute source was invented for any failing claim.

---

## 1. Counts

| Rating | Count |
|---|---|
| **VERIFIED** | 46 |
| **PLAUSIBLE** | 6 |
| **DISPUTED** | 7 |
| **FABRICATION RISK** | 4 |
| **OVER-LABELLED** | 5 |

**Headline:** the lane is unusually well sourced. All eleven cited arXiv preprints exist with the
titles, author lists and dates given; every headline number in the ETH AGENTS.md ablation, the
vericoding benchmark, SWE-Gate, the semantic-collapse paper, "Judging Is Not Enumerating",
SWE-rebench, Stack Overflow 2025, DORA 2025, the Gemini terms, OpenRouter, Tessl's Series A, the
Tessl homepage pivot, harness-bench, Vercel, Micron/GamingOnLinux and every quoted practitioner
passage (Zaninotto, Böckeler, Brooker, Isoform, Kleppmann) checked out verbatim. Every repository
measurement was re-derived within rounding except two small ones. The failures are concentrated and
specific: one misattributed CI statistic, one quotation that does not exist in its source, one
unsourced statistic in the commodity table, and a "community reading" built on a 3-point HN thread.

---

## 2. Every non-VERIFIED item

### DISPUTED — the source says something different

| # | Claim (lane location) | Cited source | What I found | Rating | Suggested fix |
|---|---|---|---|---|---|
| D1 | "feature-branch throughput +59% YoY while main-branch throughput is −7% for the median team" (§4.8 EVIDENCE; §2 C1 row; §5 item 1: "main-branch throughput is down 7% while feature-branch throughput is up 59%") | Codacy 2026-06-08 | The article says *"overall throughput grew 59% year over year"* and, separately, *"throughput on feature branches increased **15%** for the median team while main-branch throughput fell nearly 7%"*. The +59% is **overall** throughput, not feature-branch. The lane welds two different statistics into one contrast. All other Codacy figures verified verbatim (28M+ workflows, 22K+ orgs, 70.8% main-branch success, LinearB 5.3× and 2.47×, Faros 31%). | **DISPUTED** | Restate as "overall CI throughput +59% YoY; feature-branch +15% for the median team; main-branch −7%, success 70.8%". The ~66-point spread the lane implies is really ~22 points. |
| D2 | "Gemini 2.5 Pro plus a long list of 3.x Flash and Flash-Lite models remain on the free tier as of this date" (§4.10 COUNTEREVIDENCE) | ai.google.dev/gemini-api/docs/pricing | The pricing page lists Gemini 3.8 / 3.7 / 3.6 / 3.5 Flash, 3.5 Flash-Lite and 3.1 Flash-Lite as free. **Gemini 2.5 Pro is paid-tier only.** | **DISPUTED** | Drop Gemini 2.5 Pro from the free-tier list. The counterevidence survives on the Flash family but is weaker: no Pro-class model is free. |
| D3 | "Tracked TypeScript: 31,189 lines" (§4.11) | this repository | Re-measured 2026-09-08: tracked `.ts` 25,017 + `.tsx` 7,264 = **32,281** repo-wide (32,274 under `src/`). Off by ~1,090. | **DISPUTED** | Use 32,281 or state the measurement basis. Does not touch the 11,577-untracked figure, which is exact. |
| D4 | "exactly one TODO/FIXME marker across ~43,600 lines" (§4.11 COUNTEREVIDENCE; §5 item 5) | this repository | Case-sensitive grep for TODO / FIXME / HACK over `src/**/*.ts(x)` returns **zero** matches. The nine case-insensitive hits are substring artefacts (`turnPre`**`fix`**`Messages`, `au`**`toDo`**`wnloadModel`). | **DISPUTED** | "Zero TODO/FIXME markers." The error is conservative — it understates the codebase — but it is still a wrong count. |
| D5 | Sources E6: "173 commits total, **321 by the upstream author**" | this repository | Internally impossible. `git shortlog -sn` gives Ismail Pelaseyed **135** of 173; total confirmed at 173. | **DISPUTED** | Correct to 135 / 173 (78%). Not used in the lane body, so no downstream effect. |
| D6 | Sources tally: "**Sources listed: 62**" | the sources file itself | Row count: A = 12, B = 25, C = 16, D = 6, E = 11 → **70**. | **DISPUTED** | Correct the tally to 70. |
| D7 | Sources E2: `@vibe-kit/grok-cli` "33 versions" | registry.npmjs.org | Registry returns latest 0.0.34 and modified 2025-11-27 (both correct) with **34** versions. | **DISPUTED** | Off by one; correct to 34. |

### FABRICATION RISK — the cited source does not contain the claim

| # | Claim (lane location) | Cited source | What I found | Rating | Suggested fix |
|---|---|---|---|---|---|
| F1 | Gavran "concedes that fully automatic verification, **'once deemed impossible, now approaches feasibility through LLM-powered tools.'**" (§4.7 EVIDENCE) | Ivan Gavran, *The Case Against Formal Verification, 50 Years Later*, 2026-08-15 | Page exists; title, author and date correct. Two independent fetches: the phrases "once deemed impossible" and "approaches feasibility" **do not appear**. Nearest actual text: *"there has been some [progress] in developing automatic verifiers, though human effort … remains crucial. However, LLM-powered tools are closing this gap quickly."* The other Gavran quote the lane uses — *"a lot can be lost or misinterpreted"* — **is** verbatim. | **FABRICATION RISK** (quotation) | Replace the quotation marks with the real sentence, or paraphrase without quoting. The substantive point survives; the quote does not. |
| F2 | Sources C7 evidence: verification is **"one tool among many"** | same page | Phrase **not found**. | **FABRICATION RISK** (quotation) | Remove, or replace with the verified closing line about verification giving coding agents "a way to close the loop". |
| F3 | "Agent-to-agent payment rails · OBSERVED TODAY · x402 (Coinbase, Cloudflare Monetization Gateway Jul 2026); **3.1M transactions in 30 days reported Jun 2026**" (§9 commodity table) | *none* | Grep for `x402`, `coinbase`, `cloudflare`, `monetization` over the sources file returns **nothing**. A precise statistic, a vendor launch and two dates, with no citation anywhere in the lane's own source register. | **FABRICATION RISK** (unsourced precise statistic) | Cite a primary source (x402 spec, Cloudflare announcement, on-chain data) or delete the row. Do not carry the 3.1M figure into synthesis. |
| F4 | "a critic in Oct 2025 called it **'Vanity Metric 2.0'**" (§4.2 COUNTEREVIDENCE, on Lovable's ARR) | *none* | No matching entry in the sources file; no author, outlet or URL anywhere. | **FABRICATION RISK** (unsourced quotation) | Attribute it or drop it. The counterevidence stands without it — undisclosed churn is enough. |

### PLAUSIBLE — not contradicted, but I could not confirm it

| # | Claim (lane location) | Cited source | What I found | Rating | Suggested fix |
|---|---|---|---|---|---|
| P1 | npm version counts: opencode-ai **12,089**; `@anthropic-ai/claude-code` **507** with **13** maintainers; `@openai/codex` **4,330** with 18; `@charmland/crush` **186** (§4.6, §4.11, §9) | npm registry API | WebFetch truncates large registry documents, so these are unverifiable through my channel: `@charmland/crush` returned 47 versions against a claimed 186, and `@anthropic-ai/claude-code` returned 65 versions / 11 maintainers against a claimed 507 / 13. Both patterns are consistent with truncation, **not** with contradiction — the small package `@vibe-kit/grok-cli` verified exactly. | **PLAUSIBLE** | Re-derive with a recorded command (`npm view <pkg> versions --json`, count the array). This is the sole evidence for "ship velocity two to three orders of magnitude below competitors" and should not be left unreproducible. |
| P2 | *"Nowadays though, it seems like all the SDD tools have kinda fallen off but all of the complaints remain."* (§4.3 closing; §7 item 1) | Ask HN 49182353 | Thread exists (2026-08-05, author vivekyyy). The fragment *"all of the complaints remain"* is confirmed as vivekyyy's own text; the full sentence including "kinda fallen off" was not returned verbatim by either the page fetch or the Algolia comment tree — it is almost certainly the Ask HN submission body, which neither channel rendered in full. | **PLAUSIBLE** | Quote only the confirmed fragment, or re-fetch the story body and quote it exactly. |
| P3 | "with preview models given 2–3 months' notice" (§4.10 EVIDENCE (c)) | Gemini API changelog | All five retirement dates verified exactly (3.1-flash-lite-preview 2026-05-25, 3.1-flash-image-preview 2026-06-25, 2.0 Flash family 2026-06-01, Imagen 4 2026-08-17, robotics-er-1.6-preview 2026-08-31). The changelog contains **no statement** of a notice period; 2–3 months is the lane's inference from deprecation-to-shutdown gaps. | **PLAUSIBLE** (inference stated as fact) | Mark it as an inference from the observed gaps, not a stated policy. |
| P4 | Breunig: *"the act of implementing code generates new decisions. Those decisions inform the spec"* (§4.4 EVIDENCE) | dbreunig.com, 2026-03-04 | Not fetched in this pass; not contradicted. Every other practitioner quotation in the lane checked out verbatim, so the prior is good. | **PLAUSIBLE** | Spot-check before the quote is reused in synthesis. |
| P5 | "Micron has signed **16 five-year** strategic customer agreements **running through 2031**" (§4.10, §7 item 4, §8.5) | GamingOnLinux 2026-06-26 | Verified: *"We have now signed 16 strategic customer agreements"*; headline states five years; *"Tight conditions to persist beyond calendar 2027"*; Crucial consumer business shuttered December 2025. **"through 2031"** is the lane's arithmetic (2026 + 5), not a figure in the source. | **PLAUSIBLE** (arithmetic, not quoted) | Say "five-year agreements signed in 2026" and let the reader do the arithmetic. |
| P6 | Hardware price figures: "RAM at 2007-normalized prices" (§2 C5 row); "Samsung and SK Hynix … roughly 80% and 100% QoQ"; "Raspberry Pi raised prices up to 70% in February 2026" (§4.10 EVIDENCE, §8.5) | C11 Tom's Hardware, C12 TrendForce, C13 Liliputing | The sources file **itself marks all three UNVERIFIED** (headline-only, bodies not fetched). I did not fetch them either, and I did not substitute other sources. They are used as evidence inside a block labelled OBSERVED TODAY / CONFIDENCE high. | **PLAUSIBLE** | Either fetch the bodies or downgrade that block's confidence — see O2. |

### OVER-LABELLED — the evidence supports a weaker label

| # | Label as given | Where | Evidence actually available | Rating | Suggested fix |
|---|---|---|---|---|---|
| O1 | **OBSERVED TODAY / CONFIDENCE medium** — "The circular-specification problem is **now stated by practitioners** as the structural reason SDD stalls"; and §4.3's "**By August 2026 the community reading** is that the tool category faded" | §4.4; §4.3 closing; §7 item 1 | Both rest on Ask HN **49182353**, re-read through the Algolia item API: **3 points, 4 comments, two substantive commenters** (mikgp, thiago_fm) plus the submitter's own reply. Every quoted line is genuine — the assembly/determinism argument, the vivekyyy reply, thiago_fm's "agents are already too good". But four comments on a 3-point thread is not "practitioners" and is not "the community reading". | **OVER-LABELLED** | Keep the quotes as illustrative; drop the "community reading" / "practitioners" framing, or re-label the block SPECULATIVE. The Marmelab post (225 points / 191 comments, verified) and Böckeler are the real community signal and are already cited. |
| O2 | **OBSERVED TODAY / CONFIDENCE high** — "The local-inference escape hatch is closing from the hardware side, not the model side" | §4.10, second block | The model-side half is solid (SWE-rebench 31.2% ±1.68 vs 64.5% ±1.41, verified exactly). The hardware half rests on one verified source (Micron/GamingOnLinux), **three sources the lane's own file marks UNVERIFIED** (C11/C12/C13), and a **2-point, 13-comment** HN thread for the "64gb threshold" and BYOLLM quotes — both quotes genuine (giwook, jonahbenton), the thread thin. | **OVER-LABELLED** | Split the block: model side = OBSERVED TODAY / high; hardware side = REASONABLE EXTRAPOLATION until C11–C13 bodies are read. |
| O3 | **STRONG TREND** — "Getting a human to answer a decision list · organisational incentive, not capability; unchanged since DeMillo–Lipton–Perlis 1979" | §9 "Stays hard" table | One HN comment (FrankWilhoit, 9-point thread — quote verified verbatim) plus a 1979 essay. No measurement and no multiple independent 2025–26 sources. STRONG TREND requires the latter. It also contradicts §8.1, which says "no benchmark measures it". | **OVER-LABELLED** | Re-label SPECULATIVE, or "unmeasured — see §8.1". |
| O4 | **OBSERVED TODAY** — "Agent-to-agent payment rails" | §9 "Becomes commodity" table | No source at all (see F3). OBSERVED TODAY requires a dated primary source. | **OVER-LABELLED** | Delete the row or supply a dated primary source. |
| O5 | "Models judge membership far better than they enumerate sets (**F1 0.60–0.77 vs 0.26–0.48**)", stated as a general property of models | §1 summary; §9 "Stays hard" table | Both ranges are real and in the paper — Table 2, Execution F1 0.599–0.769 vs Authoring F1 0.259–0.483 — but they come from **one algorithmic-construction task across a Qwen2.5 parameter sweep**, not a cross-model result. The paper's cross-model executable-code numbers are judge F1 **0.74–0.90** against authored suites admitting **19–42%** of correct solutions. Gaps of +0.25 to +0.34 hold at every scale, so the direction is safe. | **OVER-LABELLED** (scope) | Keep the direction — it is the lane's best finding — but attribute the 0.60–0.77 / 0.26–0.48 pair to the Qwen2.5 scale sweep and lead with 0.74–0.90 / 19–42% for the general claim. |

---

## 3. Precision notes (verified, but stated imprecisely)

- **Kleppmann "827 HN points and 434 comments (2025-12-08)"** — points and comments verified exactly,
  but they belong to the **2025-12-16** submission; the 2025-12-08 submission drew 10 points. The
  article date is right; a reader may infer the points were same-day.
- **Star counts** — spec-kit 134,096 / claude-code 144,441 / llama.cpp 127,506 re-read hours later as
  134,105 / 144,442 / 127,507. Ordinary drift; treat as verified. OpenSpec 67,659, aider 48,832
  (pushed 2026-05-22) and superagent-ai/grok-cli 3,461 with 420 forks (pushed 2026-07-06, not
  archived) matched to the digit.
- **Böckeler title** — the lane capitalises "Spec-Kit"; the article says "spec-kit". Immaterial.
- **HN quote hygiene** — the lane silently repairs a typo in mikgp's comment ("now way" → "no way")
  and adds punctuation to thiago_fm's. Both faithful in substance.
- **Amazon/Kiro** — correctly flagged as secondary throughout; the Tessl retelling verified verbatim
  (roughly 13 hours, mid-December, "high blast radius", juniors and mids barred from pushing
  AI-assisted code without senior approval). The FT original remains unread, and §6 says so.
- **§6 self-declared gaps** (Terminal-Bench, swebench.com, DORA ROI, Groq free tier, The New Stack,
  CACM, pivot-to-ai) are honest and match what I found; none is load-bearing in the lane body.
- **Fully verified and worth keeping intact:** the ETH AGENTS.md ablation down to both p-values
  (87% and 37%) and the "although popular and recommended by model providers, are not helpful"
  sentence; SWE-Gate's 221 of 644 across 303 instances / 75 repos; vericoding's 12,504 specs,
  82/44/27% and the 68% → 96% Dafny figure plus "adding natural-language descriptions does not
  significantly improve performance"; the semantic-collapse paper's 3% / 10–16% / 18–32%, 23–55%,
  11–49.7% and 37.3–76.5%; Tessl's $125M and a homepage that today contains no occurrence of "spec";
  the Claude Code Channels line quoted verbatim from the docs; `/speckit.converge`'s description; the
  Gemini unpaid-services and human-reviewer clauses; OpenRouter's 50/day and 1,000/day; harness-bench
  in full; Vercel's 53/53/79/100; and every one of the repository measurements in §4.11 except D3/D4.

---

## 4. The three findings most likely to change the synthesis if wrong

**1. The +59% throughput misattribution (D1).**
This is the most-repeated statistic in the lane and it sits in the one place the lane concedes the
thesis *wins*: §5 item 1, "the problem statement survives", repeated in §7 item 5. As written it
reads as a 66-point spread between feature-branch and main-branch throughput — a delivery system
generating work faster than it can integrate it. The real Codacy numbers are +15% feature-branch for
the median team against −7% main-branch, with +59% being *overall* throughput YoY: a spread of about
22 points, not 66. If the synthesis leans on "the bottleneck has moved to integration and review" —
and §5 says that is the thesis's strongest surviving ground — it leans on a gap three times smaller
than stated, in a lane that simultaneously cites DORA 2025 reversing itself toward *higher*
throughput. Fix before the problem statement is carried forward.

**2. The Gavran quotation does not exist in its source (F1, F2).**
§4.7 is the one attack the lane reports as FAILED, labelled STRONG TREND — the synthesis is being
told to *keep* "verification cost is collapsing" as a sound premise (§5 item 4). Two legs of that
block are solid: the vericoding benchmark (every figure verified, including 68% → 96% on pure Dafny)
and Kleppmann (verified, 827 points). The third is a quotation absent from the document it is
attributed to. That does not overturn the finding — Gavran does write "LLM-powered tools are closing
this gap quickly" — but a fabricated quotation inside the lane's most load-bearing *positive*
conclusion is precisely the failure that discredits an entire corpus when one reader checks one link.
Correct it before publication, not after.

**3. "The community reading" is a 3-point Hacker News thread (O1).**
The narrative that spec-driven development *peaked and receded* is the lane's central market claim:
it drives §4.3, §4.4, §7 item 1 and the framing of the Tessl pivot. The Tessl evidence is genuinely
strong and fully verified ($125M, Index / Accel / GV / boldstart, and a homepage that today contains
no occurrence of "spec"). The community evidence is not: Ask HN 49182353 has 3 points and 4 comments.
If the synthesis converts "one Ask HN thread with two substantive commenters" into "the category is
dead", it overstates a real but weaker signal — and the lane's own counterevidence ("ubiquity is not
adoption… wide free tooling can indicate an unsolved problem rather than a solved one") cuts both
ways. Rank the Tessl pivot first and the HN threads as anecdote.

---

## 5. Limitations of this verification

- Verification accelerates human checking; it does not replace it. VERIFIED means a supporting source
  was found and read, not that the source is correct.
- npm version and maintainer counts (P1) could not be verified through WebFetch, which truncates
  large registry documents. Neither confirmed nor refuted.
- Three hardware sources (C11–C13) were left unfetched because the lane's own file already marks them
  UNVERIFIED. I did not rescue them with substitute sources.
- Paywalled and client-rendered sources the lane declares in §6 (FT original, Terminal-Bench,
  swebench.com, DORA ROI, Groq) remain unread by me as well.
- Repository claims were measured on the working tree as it stood on 2026-09-08; a single commit or
  `git add` changes several of them immediately.
