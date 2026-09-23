# Search strategy for www.shelra.dev

What the site should be found for, which page answers each search, and why. Evidence was gathered on 2026-09-23 and
is re-checked quarterly (the `shelra-seo` Claude Code skill has the method): Google, Bing and DuckDuckGo autocomplete
(real queries, no volumes), the result pages of about 40 queries through a search tool (not Google rankings), the
repositories and sites of the agents that compete for them, and the product's own documents. No keyword tool with
volumes was available, and none of the figures below is a volume, a ranking or traffic.

## What ShelraCode is, for search

- **The entity**: ShelraCode, an open-source (MIT) coding agent for the terminal; the command is `shelra`; built by
  yosoyjavieruiz; code at github.com/yosoyjavieruiz/ShelraCode. "Shelra" alone collides with an unrelated product at
  shelra.com and returns no autocomplete at all, so pages say **ShelraCode**, and structured data lists "Shelra" and
  "Shelra Code" only as alternate names.
- **For whom**: developers who work in a terminal and want an agent that runs on free models, their own key or their
  own hardware.
- **The problem it solves**: coding agents cost money per task and tend to call work done without checking it.
  ShelraCode runs on OpenRouter's free models by default, never picks a paid model without consent, runs a real check
  before it may call a change done, keeps project memory behind a write gate, and has a one-flag local mode.
- **Why choose it** (only what the repository backs): free-first routing with caps and fallbacks; a harness that
  keeps working through provider failures; memory with a deterministic write gate; managed llama.cpp local mode with
  no configuration; a public run history with failures kept. Not claimed: quality superior to any named agent, unique
  memory (persistent memory is common: Claude Code's is on by default), unlimited free use, the decision ledger
  (planned, `PRODUCT.md`).

## Demand, and who holds it

| Cluster | Real queries (autocomplete) | Who ranks today | Intent | Realistic for ShelraCode |
| --- | --- | --- | --- | --- |
| Brand | none for "shelra", "shelracode", "shelra code", "shelra cli" | the GitHub repository first for every Shelra query; the site has no indexed pages | navigational | own it: the site's pages indexed, the entity consistent |
| Terminal / CLI agent | "terminal coding agents", "best terminal coding agent", "cli coding agent open source", "free cli coding agents", "open source coding agent" | directories (Terminal Trove), awesome lists, OpenRouter's CLI-agent ranking, publisher listicles | commercial investigation | be **listed** where the results are (off-site); the home page answers the category |
| Free alternative to Claude Code | "claude code alternatives free", "free claude code alternative", "open source claude code alternative", "claude code alternative for local llm" | year-stamped listicles (DigitalOcean, DataCamp, XDA), vendor lists, AlternativeTo, OpenAlternative | commercial investigation | head terms no; listings yes; an honest comparison page is the owner's call |
| OpenRouter free models for coding | "openrouter free models for coding", "openrouter free models limit / rate limit", "best free model for coding agent", "free coding models on openrouter" | openrouter.ai's own pages, then thin month-stamped listicles (several quote wrong limits and dead model ids) | informational | the long tail on limits and behavior (**/free-models**); no model ranking until runs exist |
| Local coding agent | "local coding agent", "local llm coding agent", "llama.cpp coding agent", "offline coding assistant" | essays with small evals, repositories, Hugging Face's llama.cpp docs, setup tutorials | informational, how-to | the zero-configuration long tail (**/local**); stay out of "best local llm…" |
| Coding agent memory | "coding agent memory", "coding agent memory system", "persistent memory for coding agents", "claude code memory" | memory vendors, plugins, Anthropic's docs, arXiv | informational | the write-gate angle (**/memory**); stay out of "claude code persistent memory" |
| Benchmarks and harness | "coding agent benchmark(s)", "coding agent harness benchmark", "coding agent harness", "harness engineering for coding agent users" | arXiv, Artificial Analysis, Martin Fowler, Microsoft Learn | informational | head terms no; a methodology and history page after clean re-runs (roadmap) |
| False "done" | "coding agent says done without running tests" (result set) | dev.to posts | informational | a page on the completion gate with its limits (roadmap, after the contract work lands) |

## The page map (one primary intent per URL)

| Page | Primary intent | Topic and entities | Links in | Links out | Conversion |
| --- | --- | --- | --- | --- | --- |
| `/` | brand + category: open-source terminal coding agent | ShelraCode, terminal, OpenRouter free models, local mode, memory, verification, benchmark | every page (logo, breadcrumb, footer) | the three guides (feature titles, FAQ answers, pricing, footer), GitHub | install (GitHub) |
| `/free-models` | how an agent runs on OpenRouter's free tier: limits, routing, fallbacks, caps | OpenRouter, free models, rate limits, `openrouter/free`, spend caps, field case 001 | home (feature 0.1, FAQ ×2, footer), the other guides | `/local`, OpenRouter's limits doc, the run history | install |
| `/local` | run a coding agent offline with llama.cpp, no configuration | llama.cpp, GGUF, Qwen2.5 Coder 1.5B/7B, CUDA, Hugging Face, `SHELRA_LOCAL_ENDPOINT` | home (pricing Local plan, FAQ, footer), the other guides | `/memory`, the README | install |
| `/memory` | what a coding agent should keep between sessions and what it must refuse | project memory, write gate, retrieval, reflection, skills, the proof suite | home (feature 0.2, FAQ, footer), the other guides | the design document, the run history | install |

No two pages target the same cluster. The home page keeps the category; each guide owns one problem. Titles:
"ShelraCode – open-source terminal coding agent, free models first" (home), then "<topic> – ShelraCode" through the
title template.

## Internal links

- Every page links to every other page from the footer's Resources column, and each guide ends with the other guides.
- The home page links to each guide from the section that introduces the topic, with anchor text that names it:
  the feature titles ("OpenRouter Free by default", "It remembers your project"), three FAQ answers ("What the free
  tier allows", "How local mode works", "What it keeps and what it refuses") and the Local pricing plan.
- Section links are `/#section`, so they work from every page; each guide has a breadcrumb back to the home page.
- The regression check fails on an orphan: an indexable page no link path reaches from the home page.

## Content that only ShelraCode can publish

The durable advantage is first-party evidence, not copy: the run history with failures kept (`bench/history`), the
field cases set against a reference agent, the memory proof suite, and documented behavior at the level of source
files. Pages render measured numbers from `bench-summary.json`, never by hand, and state their sample sizes. Topics
worth building next, in order of evidence available: the completion gate and its known limits; a benchmark
methodology and history page once runs exist on public commits; free models measured in a real agent loop once
completed free runs exist.

## AI search

Established: Google's AI Overviews and AI Mode use the normal index and snippet controls and need no special markup or
file; ChatGPT search uses `OAI-SearchBot`, Claude `Claude-SearchBot`, Perplexity `PerplexityBot`; all are allowed by
the site's robots.txt; Bing's Copilot favors crawlable, single-topic pages with clear headings and consistent entity
names. So: server-rendered text, one topic per URL, the answer early, tables for facts, sources cited, consistent
entity names. Speculative, not done: llms.txt (Google ignores it), FAQ markup for AI citations, "chunking".

## Authority

Being included where the results already are matters more than any on-page change for the category clusters:
Terminal Trove, OpenAlternative, AlternativeTo, the awesome lists (bradAGI/awesome-cli-coding-agents,
RyanAlberts/best-of-Agent-Harnesses), OpenRouter's app directory and rankings (they need the `HTTP-Referer` header,
which ShelraCode does not send today). Each is outward-facing and the owner's to do or approve; listings must state
only what the code does. See [roadmap.md](roadmap.md).
