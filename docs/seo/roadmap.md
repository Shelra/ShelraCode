# Search roadmap for www.shelra.dev

What to do next, in order of leverage, after the three rounds recorded in [audit.md](audit.md). Each item names who
can do it: **owner** (outward-facing, spending or product decisions), **site** (code in `frontend/`), **product**
(the CLI or its benchmark). Dates are targets from 2026-09-23, not commitments.

## Now (the next two weeks): make the work visible and measurable

| Track | Item | Who | Why |
| --- | --- | --- | --- |
| Technical | After every deploy, run `bun run seo:check --origin https://www.shelra.dev --external` and fix anything production shows that the local build did not (Cloudflare's managed robots.txt block, redirects, assets) | site | the local build cannot show what the CDN adds |
| Technical | One Cloudflare redirect rule from `http://shelra.dev/*` straight to `https://www.shelra.dev/*` (today two hops, SEO-042) | owner | each hop costs crawl time and link equity |
| Measurement | Search Console: Domain property by DNS TXT, submit the sitemap, URL Inspection on the four pages, keep "Search generative AI" on Include | owner | the first real data on indexing, queries, clicks and AI Overviews |
| Measurement | Bing Webmaster Tools: import from Search Console, submit the sitemap; turn on Cloudflare Crawler Hints (IndexNow) | owner | Bing also feeds Copilot and other answer engines |
| Technical | Cloudflare AI crawler setting stays at *Allow* or *Disallow AI Training*, never *Block* (since 2026-09-15 it blocks Googlebot and Bingbot too); check `/robots.txt` after any change | owner | one dashboard toggle can deindex the site |
| Accessibility | The benchmark's "being recorded" rows render at 2.4:1 contrast (WCAG needs 4.5:1, SEO-044); raise their opacity or colour. And decide whether `/free-models` keeps the head-to-head field-case sentence (SEO-043) | owner | the approved design and naming a competitor are the owner's calls |
| Authority | Claim or publish the npm name `shelra` (the README tells people to `bun add -g shelra`; the name is unregistered and anyone could take it) | owner | a broken install path and a squatting risk |
| Authority | Submit to the directories that hold the category results: Terminal Trove, OpenAlternative, AlternativeTo; pull requests to bradAGI/awesome-cli-coding-agents and RyanAlberts/best-of-Agent-Harnesses. State only what the code does (no "autonomous", no ledger) | owner | the "terminal / free / open-source coding agent" results are lists, not vendor pages |
| Authority | OpenRouter attribution: send `HTTP-Referer: https://www.shelra.dev` and `X-OpenRouter-Categories: cli-agent` (`src/providers/openrouter.ts`), which creates an app page and a place in OpenRouter's CLI-agent ranking; a PR to OpenRouterTeam/awesome-openrouter for its works-with directory | owner decides, product builds | openrouter.ai holds "cli coding agent open source" and "openrouter coding agent"; it publishes usage, hence the owner's call |

## Next (one to three months): earn the content clusters with evidence

| Track | Item | Who | Why |
| --- | --- | --- | --- |
| Content | Re-run the core suite on public commits, including free models, and import the runs; then publish a benchmark methodology and history page (every run, failures kept, n and spread, how to reproduce), and let `/free-models` show measured results | product, then site | the harness-effect long tail has no current leaderboard; today's headline pair cannot be replayed from public commits |
| Content | A page on the completion gate ("verified, or it says so") with its known limits, once the contract module (`src/contract/`) lands | site | "coding agent says done without running tests" is held by a handful of blog posts |
| Content | An honest "ShelraCode and Claude Code" comparison, in the format of the pages that rank (quick comparison, where each is stronger, how to switch), dated, sourced from each vendor's docs, with field-case data and no superiority claim beyond the runs | owner decides, site builds | the largest commercial-investigation cluster; naming a competitor is the owner's decision |
| Content | Feature documentation on the site (hooks, MCP servers, skills, sub-agents, headless `-p`, the Telegram bridge), generated or adapted from the README rather than duplicated by hand | site | the site has no page for most of what the CLI does; directories compare these features |
| Product | Make the pages' limits disappear rather than document them: tag memory writes from a turn that used `search_web` or `open_web` as `web`, so the gate's web rule runs (SEO-027); decide whether `--local` turns the web tools off (SEO-028); give the 7B model its real size, 4,683,073,536 bytes, so an installed copy is recognized (SEO-035) | owner decides, product builds | each is a sentence on `/memory` or `/local` today; fix it in the product, then update the page |
| Content | Record why a run is excluded or classified (the memory suite's #12, #13, #15, #16) as a note in `bench/history`, so `bench:sync` renders it instead of typed text (SEO-040) | product, then site | every number and verdict on the site should come from the history |
| Performance | Hydrate less on the home page: static sections as server components, motion only where something moves, Lenis and the session provider off the critical path; measure mobile TBT and LCP before and after (SEO-022) | site | lab mobile LCP 4.4 s and TBT ~530 ms on the home page against 75 ms on the server-rendered guides |
| Technical | Per-page social images (`opengraph-image` per guide) so shared links show their topic | site | every page shares the home card today |
| Measurement | A monthly export of Search Console data (API) into the repository's evidence, and a quarterly re-run of the demand probe and result scan (`shelra-seo` skill) | site | Search Console keeps 16 months; strategy changes need dated evidence |

## Later (three months and beyond): scale what the evidence supports

| Track | Item | Who | Why |
| --- | --- | --- | --- |
| Content | A live "free models in a real agent loop" table generated from the run history, once enough completed free runs exist to say something (not a ranking of models by opinion) | product, site | what ranks for "best free model for coding" is opinion and stale model ids |
| Content | Field cases as pages: each real problem, the run, the reference agent, the re-runs | site | first-party, non-commodity evidence, the kind answer engines cite |
| Authority | Write-ups where the audience reads: the harness effect, the memory write gate, free-tier engineering (Hacker News, dev.to, the r/LocalLLaMA and r/ChatGPTCoding communities) | owner | links and mentions come from people, not from the site |
| Technical | Localized pages only if a real audience appears in the data (the site is English-only by product decision) | owner | no machine-made translations |
| Measurement | Field Core Web Vitals from Search Console once traffic qualifies, replacing the lab numbers as the performance target | site | Google ranks on field data at the 75th percentile |

## Not doing, and why

Programmatic pages per model or per competitor, llms.txt, FAQ markup for rich results (retired), ratings or reviews in
structured data, and any page whose only purpose is a query: each fails Google's spam policies or has no documented
effect ([search-rules.md](search-rules.md)).
