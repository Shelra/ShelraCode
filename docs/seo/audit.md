# SEO audit: www.shelra.dev

The evidence record of the website's search work: the baseline, every issue found with its priority and proof,
what was changed about it, the check that shows the result, and what is still open. Strategy (intents, pages,
entity) is in [strategy.md](strategy.md), the plan in [roadmap.md](roadmap.md), how to run the checks in
[README.md](README.md).

Priorities: **P0** blocks crawling or indexing, or seriously damages search; **P1** a major positioning
opportunity; **P2** an optimization; **P3** optional.

## Baseline (2026-09-23, before any change)

Production is `https://www.shelra.dev` (the repository's homepage field; `shelra.dev` answers 308 to it), served by
Vercel behind Cloudflare. The local production build of the same commit (`frontend/` at `origin/main`, `7af3593`)
was measured beside it.

### URL map

| URL | Status | Directive | Class |
| --- | --- | --- | --- |
| `/` | 200, prerendered | none (indexable) | INDEX: the only indexable page |
| `/login`, `/signup` | 200, dynamic | `noindex, nofollow` | PRIVATE |
| `/account` | 307 → `/login?callbackUrl=%2Faccount` | — | PRIVATE, REDIRECT |
| `/dashboard` and 11 static sub-routes | 200, prerendered | `noindex, nofollow` | PRIVATE (demo data) |
| `/dashboard/agents/[id]`, `/dashboard/missions/[id]` | 200 for any id | `noindex, nofollow` | PRIVATE, DYNAMIC |
| `/api/auth/*` | 200 (`session` → `null`), 503 elsewhere (`AUTH_SECRET` unset) | — | PRIVATE, API |
| any unknown path | 404 | `noindex` (plus a stray `max-image-preview:large`) | correct 404 |
| `/login/` (trailing slash) | 308 → `/login` | — | REDIRECT |
| `http://www.shelra.dev/` | 308 → `https://` | — | REDIRECT |
| `https://shelra.dev/` | 308 → `https://www.shelra.dev/` | — | REDIRECT |
| `https://shelra-code.vercel.app/*` | 200, byte-identical (same build id) | none | DUPLICATE HOST |
| `/?anything` | 200, same content | — | needs a canonical |
| `/robots.txt` | 200 on www (Cloudflare's managed file: comments only), 404 on the vercel.app host | — | no rules, no sitemap |
| `/sitemap.xml` | 404 | — | missing |

### Measurements

`bun run scripts/seo-check.ts` (the regression check written for this work, [README.md](README.md)):

| Target | Pages crawled | Indexable | Errors | Warnings |
| --- | --- | --- | --- | --- |
| production | 1 | 1 | 6 | 2 |
| local build | 1 | 1 | 5 | 2 |

Lighthouse 13.5.0, lab. Production: one run each, over the network. Local build: the median of three runs, from a
worktree of the same commit, measured back to back with each later round on the same machine:

| Target | Perf | A11y | Best pr. | SEO | FCP | LCP | TBT | CLS | Bytes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| production, mobile | 45 | 90 | 100 | 100 | 2.8 s | 7.7 s | 670 ms | 0.186 | 1,192 KB |
| production, desktop | 85 | 92 | 100 | 100 | 0.7 s | 2.0 s | 110 ms | 0.002 | 1,108 KB |
| local, mobile | 52 | 90 | 100 | 100 | 2.3 s | 6.6 s | 482 ms | 0.190 | 1,164 KB |
| local, desktop | 98 | 92 | 100 | 100 | 0.5 s | 1.0 s | 71 ms | 0.002 | 1,081 KB |

Lighthouse's SEO category scores 100 while the site has no canonical, no sitemap and one indexable URL: it
checks a handful of tags, not search architecture, so it is not used as the measure of this work.

Rendered audit (Playwright, 390 and 1440 px, local build): no horizontal overflow, no console errors, 27 requests
and 732 KB of images on a phone for the home page; small tap targets are inline text links, which pass WCAG 2.5.8
through its spacing exception.

Demand (autocomplete of Google, Bing and DuckDuckGo, 2026-09-23; lists real queries, no volumes): no suggestion
for `shelra`, `shelracode`, `shelra code` or `shelra cli` (Google completes `shelra` to an unrelated pet brand);
`shelra.com` is an unrelated product also named Shelra. Demand exists for the category and problem queries the
product answers; see [strategy.md](strategy.md).

## Issue register

Status after each round; the rounds below say what was done and how it was checked.

| ID | P | Issue | Evidence (baseline) | Status |
| --- | --- | --- | --- | --- |
| SEO-001 | P0 | No canonical on any page while `shelra-code.vercel.app` serves the same bytes, indexable | curl: identical build id `yoPBpoqFjcyCz6WmzOIsr`, no `<link rel=canonical>` | fixed R1 (canonical + host redirect); live since 2026-09-23: the vercel.app host answers 308 to `www` |
| SEO-002 | P0 | No sitemap | `/sitemap.xml` 404 | fixed R1 |
| SEO-003 | P0 | No robots.txt of our own; production shows Cloudflare's comment-only file, no `Sitemap:` | curl of `/robots.txt` on both hosts | fixed R1 |
| SEO-004 | P1 | Social images and `metadataBase` on the vercel.app host | `og:image` = `https://shelra-code.vercel.app/images/og-shelra.png` | fixed R1 |
| SEO-005 | P1 | Content crawlers never see: 6 FAQ answers and 2 of 3 use cases render only after a click | absent from the server HTML (`grep` of the live page) | fixed R1 |
| SEO-006 | P1 | One indexable URL for every intent: fragment-only navigation, no page to target any query cluster, no internal links | seo-check: 1 page crawled | fixed R2: 4 indexable pages, one intent each, 9 links from the home page |
| SEO-007 | P1 | No structured data: no site name, software or author entity; the name collides with shelra.com | no `application/ld+json` | fixed R1 (home graph) |
| SEO-008 | P1 | Mobile LCP 7.7 s: the hero's still image switches to the phone variant only after hydration; phones also download the 363 KB desktop variant, preloaded | Lighthouse LCP element `Bug1g…png`; `useBreakpoint` renders desktop on the server | partly fixed R1: 6.6 → 4.5 s lab; the rest is JavaScript (SEO-022) |
| SEO-009 | P1 | Mobile CLS 0.186: the hero heading re-wraps when Geist Mono replaces the `monospace` fallback | Lighthouse culprit: web font `or3nQ6H…woff2`; Geist Mono 0.600 em per glyph, Consolas 0.550 em | fixed R1: 0.190 → 0.004 |
| SEO-010 | P1 | Title and description do not match the intents the page can win; description 245 characters | seo-check warning | fixed R2 |
| SEO-011 | P2 | Heading outline: two prices (`$0`) are `<h2>`; card, use-case and FAQ titles are not headings | seo-check outline | fixed R1 |
| SEO-012 | P2 | Product screenshots marked decorative (`alt=""`) | seo-check / Lighthouse | fixed R1 |
| SEO-013 | P2 | Accessibility faults that also weaken semantics: no `<main>`; GitHub icon link without a name; footer logo label ≠ visible text; pricing switch without a name; FAQ and use-case tabs are `div`s with `onClick` (no keyboard) | Lighthouse a11y 90; component code | fixed R1: a11y 100 |
| SEO-014 | P2 | Render-blocking CSS (~1 s mobile lab), all images PNG without responsive sizes, below-the-fold images preloaded | Lighthouse insights; React preloads every server-rendered `<img>` | images and preloads fixed R1; CSS inlining tested and rejected (no gain) |
| SEO-015 | P2 | The 404 page carries two robots meta tags | curl | fixed R1 |
| SEO-016 | P2 | Template leftovers: links named "Cap it" and "BYOK" point at the repository root | seo-check link list | fixed R1 |
| SEO-017 | P3 | No web app manifest or apple-touch-icon | curl 404 | apple-touch-icon added R1; a manifest brings no search value (not a PWA) |
| SEO-018 | P1 | No measurement wired: no Search Console or Bing verification in code, no sitemap to submit; Cloudflare Web Analytics is present (its beacon loads) | response bodies | prepared R1 (env-based verification, sitemap); owner steps in README |
| SEO-019 | P2 | Found in R1: on phones the pricing switch does nothing when tapped (the switch and its row both toggle) | Playwright on production: one tap leaves `aria-checked=false` | fixed R1 |
| SEO-020 | P1 | Found in R1: the only favicons Google could use are the ICO's; the site advertised an SVG, which Google Search does not support | Google favicon docs (2026-08-28) | fixed R1: PNG 192 px + ICO |
| SEO-021 | P2 | Found in R1: the use-case images declare a 2016×1408 box for 1944×1400 captures | image headers | kept on purpose: the box is the approved crop; documented in content.ts |
| SEO-022 | P1 | Remaining mobile lab LCP (4.5 s) and TBT (~500 ms) come from JavaScript evaluated before the first paints (motion, Lenis, the session provider, every section a client component) | Lighthouse bootup and main-thread breakdown | open, roadmap (performance); the server-rendered guide pages show the gap: TBT 75 ms. Home page JavaScript, gzip: ~281 KB in 12 chunks, of which React DOM ~72 KB, motion ~48–60 KB, two unlabelled runtime chunks ~84 KB (the Next.js runtime, by inference), Lenis and the WebGL shader ~32 KB, next-auth ~6 KB |
| SEO-023 | P1 | Found in R2: the site linked to `npmjs.com/package/shelra` and named it in `sameAs`, but the package is not published (registry 404) while the README says `bun add -g shelra` | `registry.npmjs.org/shelra` → 404 | site fixed R2; publishing or reserving the name is the owner's (roadmap) |
| SEO-024 | P1 | Found in R2: the Free plan said "$0 /forever" without OpenRouter's limit (50 requests a day, 1,000 with $10 of credits); the pages that rank for the question quote wrong limits | OpenRouter limits doc, checked 2026-09-23 | fixed R2: the plan, a FAQ answer and `/free-models` state it, with the source |
| SEO-025 | P2 | Found in R2: section links were bare `#fragments`, so they break on any page but the home page; the footer prefixed its own `/` | code | fixed R2: `/#section` everywhere |
| SEO-026 | P2 | Found in R2: the mobile menu renders each link as an `<h1>` (seven `h1`s when open) | code | fixed R2: paragraphs with the same style |
| SEO-027 | P1 | Found in R3 (R3-01): `/memory` promised that a web page cannot plant a standing order and that entries record "the web" as a source; no live code records `source: "web"`, so the gate's web rule never runs | `git grep` of `source: "web"` in `src/`: tests only | page fixed R3 (states what runs); tagging writes from turns that used web tools is a product decision (roadmap) |
| SEO-028 | P1 | Found in R3 (R3-02): "nothing leaves your machine" in local mode (the `/local` H1 and description, a home FAQ answer, the Local plan) while `search_web` and `open_web` stay available under `--local` | `src/toolset/tools.ts`: no local-mode gate on the web tools | fixed R3: "the model on your own hardware", with what can still reach the network; switching the web tools off under `--local` is the owner's product call |
| SEO-029 | P1 | Found in R3 (R3-03): `/local` gave "32K tokens" of context; the managed server loads 8K on a CPU and 16K on an NVIDIA GPU unless raised | `src/runtimes/managed-llama.ts` context caps | fixed R3, with the two variables that raise it |
| SEO-030 | P2 | Found in R3 (R3-04): without JavaScript the home page is blank below the nav, 96% of its words at inline `opacity:0`; accessibility scans skip invisible sections, so the rounds' "a11y 100" hid a contrast failure (SEO-044) | Playwright with JavaScript off | fixed R3: a `<noscript>` stylesheet reveals everything, 0% hidden; the check now fails on it |
| SEO-031 | P2 | Found in R3 (R3-05): on phones the guides' tables and code blocks scroll sideways but cannot be reached by keyboard (WCAG 2.1.1) | axe `scrollable-region-focusable`, 6 elements on 3 pages at 390 px | fixed R3: focusable, named regions; axe 0 |
| SEO-032 | P2 | Found in R3 (R3-06, R3-07): `/memory` mechanics wrong or stale: reflection budget, promotion rule, what is listed, the near-duplicate rule, the log format, and deletion (not gated) left out | code on `origin/main` | fixed R3 on the page and in `docs/design/shelra-memory-engine.md`, checked against `origin/main` `c533fcf` |
| SEO-033 | P2 | Found in R3 (R3-08): `/local` said the cloud path never starts a local model, then called local mode its last fallback, and merged two different fallback chains | `src/index.ts` credential fallbacks | fixed R3: one chain per case |
| SEO-034 | P2 | Found in R3 (R3-09, R3-16): `/free-models` said the policy filters on context, vision and reasoning (only tool calling is filtered) and that an unpriced request waits (it is blocked) | `src/index.ts` routing, `src/agent/agent.ts` budget check | fixed R3 |
| SEO-035 | P2 | Found in R3 (R3-10): `/local` gave the 7B download as 5.0 GB; the pinned file is 4.7 GB. The product's size is an estimate, and its exact-size check never recognizes an installed 7B | Hugging Face `X-Linked-Size: 4683073536`; `src/models/huggingface.ts` | page fixed R3; the product fix is on the roadmap |
| SEO-036 | P2 | Found in R3 (R3-11): the benchmark said "cost as billed by the provider" while both rows are estimates, and a typed field note said $1.33 beside the table's $1.32 | `bench/history` `costKind` | fixed R3: the method line and the field notes are derived from `bench-summary.json` |
| SEO-037 | P2 | Found in R3 (R3-12 to R3-14): the check passed a mock site with 10 planted defects (blank without JavaScript, snippet opt-outs, blocked answer engines, broken assets, redirecting links, JSON-LD and og:url mismatches) | mock run: exit 0, 0 errors | fixed R3: all 10 caught, 30 errors, exit 1 ([README.md](README.md) lists the rules) |
| SEO-038 | P3 | Found in R3 (R3-15): each guide declared a typed `SoftwareApplication` stub without price or rating, three invalid items for Google's Software apps report | served JSON-LD | fixed R3: a bare `@id` reference |
| SEO-039 | P3 | Found in R3 (R3-17): the guides' H1s did not name their subject ("Run it offline."), and the `/local` description ended in a fragment | raw HTML | fixed R3 |
| SEO-040 | P3 | Found in R3 (R3-18): the `/memory` evidence table left out two runs of the suite (#27 interrupted, #29 failed) without saying so | `bench/history` | fixed R3: the note names them; moving the runs' classification into the history is on the roadmap |
| SEO-041 | P3 | Found in R3 (R3-19): every 404 carried the home page's title | curl | fixed R3: "Page not found – ShelraCode" |
| SEO-042 | P3 | Found in R3 (R3-20): `http://shelra.dev/` takes two redirects to reach `https://www.shelra.dev/` | curl | owner: one Cloudflare redirect rule |
| SEO-043 | P3 | Found in R3 (R3-21): `/free-models` repeats the home page's head-to-head field-case sentence (a free model in 1 try, Claude Sonnet 5 in 3), while comparison content is the owner's decision | rendered page | owner: keep, or link to the scoreboard instead |
| SEO-044 | P3 | Found in R3 (R3-22): the benchmark's "being recorded" rows render at 2.4:1 contrast at 12 px (WCAG 1.4.3 needs 4.5:1) | axe after scrolling | owner: it is the approved design |

## Round 1: foundation (technical SEO engineer)

Perspective: can search engines crawl, index and understand every public URL correctly, and is the page fast and
stable? Changes (all in `frontend/`):

- **One source of truth for the site's identity**: `src/lib/site.ts` (the canonical origin, the indexable pages, the
  private prefixes) feeds `robots.ts`, `sitemap.ts`, every page's metadata, the structured data and the check.
- **Canonical and host**: `metadataBase` is the production origin; every indexable page gets an absolute
  self-canonical, `og:url` and social images on `www.shelra.dev` (`src/lib/metadata.ts`); a production-only 308
  redirect sends any `*.vercel.app` host to `https://www.shelra.dev`, skipped for requests that came through
  Cloudflare (`cf-ray`) so it cannot loop (`next.config.ts`).
- **robots.txt and sitemap** of our own: everything crawlable except `/api/`, private routes kept crawlable so their
  noindex is read; the sitemap lists exactly the indexable pages with the date their content changed.
- **Structured data** on the home page: `WebSite` (site name ShelraCode, alternate names), `SoftwareApplication`
  (free, MIT, Windows/macOS/Linux, no ratings), `SoftwareSourceCode` (the repository) and `Person` (the author).
- **Everything in the server HTML**: all six FAQ answers (an accordion of `<h3><button aria-expanded>` with collapsed,
  inert regions) and all three use cases (WAI-ARIA tabs with arrow keys; hidden panels stay in the DOM).
- **Semantics and accessibility**: a `<main>` landmark; card, step, benefit, plan and field-case titles as `<h3>`;
  prices no longer headings; named icon link, switch and logo; the pricing switch is a real button (fixes SEO-019).
- **Performance**: the hero's still image is a `<picture>` the browser resolves per breakpoint from the HTML (no
  swap after hydration, no wasted desktop image on phones); a metric-matched "Geist Mono Placeholder" fallback (no
  heading re-wrap); lossless WebP captures and lossy WebP shader stills (`bun run images`, 1,675 → 607 KB);
  below-the-fold images lazy, the hero screenshot `fetchpriority="high"`.
- **Titles**: a `%s – ShelraCode` template; private pages no longer repeat the site name.
- **Icons**: ICO (16–256 px), PNG 192×192, Apple touch icon.

Checked (local production build, `next start`):

| Check | Baseline | Round 1 |
| --- | --- | --- |
| seo-check errors / warnings | 5 / 2 | 0 / 1 (description length, R2) |
| Pages crawled / indexable / private checked | 1 / 1 / 0 | 4 / 1 / 3 |
| Words of text in the home page's server HTML | 1,211 | 1,526 |
| Structured data types | none | WebSite, SoftwareApplication, SoftwareSourceCode, Person |
| Lighthouse mobile perf / a11y (median of 3) | 52 / 90 | 68 / 100 |
| Mobile LCP / CLS / TBT (lab) | 6.6 s / 0.190 / 482 ms | 4.5 s / 0.004 / 532 ms |
| Desktop perf / a11y / LCP | 98 / 92 / 1.0 s | 98 / 100 / 0.9 s |
| Bytes, mobile / desktop | 1,164 / 1,081 KB | 525 / 629 KB |
| Images on a phone (rendered audit) | 732 KB | 145 KB |

Also verified: the host redirect with forged `Host` headers (vercel.app → 308 with path and query kept; with
`cf-ray` → 200; localhost and www → 200); FAQ, tabs and switch by mouse and keyboard at 1440 and 390 px, with clean
accessible names; every interaction state screenshot-identical to production except the fixed bug; full-page height
unchanged at 1440 px. CSS inlining (`experimental.inlineCss`) was measured and rejected: mobile perf 66 vs 68,
LCP unchanged, more bytes.

Not verified: anything on production. These changes are in the working tree and reach `www.shelra.dev` only when
deployed.

## Round 2: search intelligence (search strategist and content architect)

Perspective: which searches can this site answer better than what ranks, and does each page own one intent? Evidence:
autocomplete of Google, Bing and DuckDuckGo; the result pages of about 40 queries and the sites that hold them;
Google's, Bing's and the AI vendors' documentation ([strategy.md](strategy.md) has the map and what not to chase).

What the evidence changed: a "free models, measured" page, a benchmark page and a comparison page were each planned
and then held back. No core-suite run on a free model has completed on a public commit, the benchmark's headline runs
cannot be replayed from public commits, and naming a competitor is the owner's decision. The three pages built each
pass the page test: a real question in the evidence, first-party substance, and numbers that stay true on their own.

Changes (all in `frontend/`):

- **Three guide pages**, server-rendered, no entrance animations, in the site's visual language (`src/lib/guides.ts`
  for the copy, `src/components/doc/`): `/memory` (what the memory keeps and what its gate refuses, with the proof
  suite's nine runs), `/local` (the zero-configuration llama.cpp mode, which model on which hardware, honest limits),
  `/free-models` (OpenRouter's limits with their source, how the free policy picks and falls back, spending caps, every
  free-model run on record).
- **Numbers from the history only**: `bun run bench:sync` now also writes the memory suite per arm, every core-suite
  run on a free model and each field case's tool calls; the pages render them, and their notes change with the data.
  The rest of `bench-summary.json` is byte-identical.
- **Home page**: title "ShelraCode – open-source terminal coding agent, free models first" and a 157-character
  description; a new FAQ answer on the free tier's limits; links from the feature titles, three FAQ answers and the
  Local plan to the guides; the Free plan states its daily limit.
- **Site structure**: section links as `/#section`; the footer's "Resources" column lists the guides beside GitHub;
  breadcrumbs with `BreadcrumbList` and `WebPage` data on each guide; each guide links to the others.
- **Truth fixes found on the way**: the unpublished npm package removed from the footer and from `sameAs`
  (SEO-023); the Free plan's missing limit (SEO-024).

Checked (local production build):

| Check | Round 1 | Round 2 |
| --- | --- | --- |
| seo-check errors / warnings | 0 / 1 | 0 / 0 |
| Indexable pages (sitemap entries) | 1 | 4 |
| Query clusters with a destination page | 1 | 4 |
| Links from the home page to other indexable pages | 0 | 9 (feature titles 2, FAQ 3, pricing 1, footer 3) |
| Words in the server HTML across indexable pages | 1,526 | 4,038 |
| Lighthouse home, mobile perf / a11y / LCP / CLS (median of 3) | 68 / 100 / 4.5 s / 0.004 | 69 / 100 / 4.4 s / 0.004 |
| Lighthouse `/memory`, mobile / desktop perf (median of 3) | — | 87 / 100 (TBT 75 ms, CLS 0.014) |

Also verified: no horizontal overflow and no console errors on the four pages at 390 and 1440 px; the FAQ link opens
its answer and navigates, and links inside closed answers are inert; features, pricing and footer keep their exact
size against production at 1440 and 390 px, and the FAQ grows by one question (+67 px). One regression was caught and
fixed: a link line under the feature cards squeezed their fixed-height illustrations, so the titles carry the links
instead.

Not verified: production (not deployed), and anything about indexing or rankings (no Search Console access).

## Round 3: adversarial review (senior SEO auditor)

Perspective: assume rounds 1 and 2 are wrong somewhere and prove it. A separate reviewer audited the Round 2 build with
no stake in it: every claim on the public pages traced to the code on `origin/main`, the pages rendered with
JavaScript off, axe-core (WCAG 2.x A and AA) at 390 and 1440 px, a mock site with ten planted defects run through
the check, crawler parity for ten user agents, and every outbound link. It found 22 issues (R3-01 to R3-22, now
SEO-027 to SEO-044) and no P0. The largest class was truth: eleven findings where a public page said something the
code or the run history contradicts, three of them P1. Those count as search problems too: a page that ranks for
"run a coding agent locally" and says "nothing leaves your machine" when the agent's web research still reaches
the network misleads the searcher it attracted.

Changes (in `frontend/`, plus `docs/design/shelra-memory-engine.md`, which the `/memory` page cites):

- **Copy the code backs**: every correction in SEO-027 to SEO-036, each re-checked against `origin/main` at `c533fcf`
  (the version the deploy ships with); the memory design doc corrected where it had drifted from the code too.
- **No typed numbers**: the benchmark's method line reads each row's `costKind`, and the three field notes render
  their commits, minutes, tool calls, tries and cost from `bench-summary.json`, so `bun run bench:sync` keeps them true.
- **Readable without JavaScript**: a `<noscript>` stylesheet in the root layout shows everything the entrance
  animations start hidden, opens the FAQ answers and lays out every use case; nothing changes with JavaScript on.
- **Keyboard**: tables and code blocks that scroll sideways are focusable (tables are named `<section>` regions),
  with the site's focus ring.
- **Structured data and titles**: the guides reference the software entity by `@id` instead of declaring an invalid
  stub; the H1s name their subject; 404s have their own title (a server `not-found.tsx` around the animated view).
- **Sitemap dates** of the pages that show run data follow the summary's date.
- **The check** (SEO-037): hidden-text share without a noscript reveal, snippet opt-outs, robots.txt evaluated for
  six search and answer crawlers with RFC 9309 group merging, every image, icon and structured-data image fetched,
  internal links requested as written (a redirect fails), `WebPage` and breadcrumb URLs against the canonical,
  `og:url` mismatch as an error, every route in the build manifest declared public or private, and `--external` for
  outbound links.

Checked (local production build of the final tree):

| Check | Round 2 | Round 3 |
| --- | --- | --- |
| seo-check on the build | 0 errors, 0 warnings, 7 pages crawled | 0 errors, 0 warnings under the stricter check, 18 pages crawled (4 indexable, 14 private) |
| seo-check on the mock with 10 planted defects | exit 0: 0 errors, 1 warning | exit 1: 30 errors, all 10 caught |
| Public statements the code or history contradicts | 11 findings (3 P1) | none known; each corrected claim re-traced to `origin/main` |
| Home page words hidden with JavaScript off (1440 / 390 px) | 96% / 96% | 0% / 0.4% (the benchmark table's column labels, hidden on phones by design) |
| axe violations, 4 pages at 390 and 1440 px | home: contrast, 4 elements; guides at 390: 6 unfocusable scroll boxes on 3 pages | home: contrast, 4 elements (SEO-044, the owner's call); guides: 0 |
| Invalid Software-app items in structured data | 3 | 0 |
| Lighthouse `/memory`, mobile perf / TBT (median of 3) | 87 / 75 ms | 87 / 37 ms |
| Lighthouse home, mobile perf / LCP / TBT | 69 / 4.4 s / 526 ms (median of 3) | 66 / 4.5 s / 661 ms (median of 5, perf 54–69 across runs) |

The home page's lab numbers did not move beyond noise: the page does the same work (main-thread 3,370 ms against
3,308 ms, bootup 1,581 against 1,627 ms, JavaScript 241 against 242 KB, medians), and the spread between runs on this
machine is wider than the difference. SEO-022 remains the performance item. Lighthouse's accessibility score of 100
on the home page is also not evidence on its own: it scans before the sections animate in (SEO-030), which is how the
contrast failure hid in rounds 1 and 2; the axe runs above scroll first.

Also verified: the scroll boxes are reached with Tab, show the focus ring and scroll with the arrow keys (390 px);
the four pages at 1440, 1000 and 390 px have no horizontal overflow and no console errors; the FAQ, the use-case tabs
and the pricing switch work by mouse and keyboard at 390 px; all 103 image and font URLs the build references are in
the repository; `bench-summary.json` regenerates byte-identically from `bench/history`.

Production, after the deploy of 2026-09-23 (`1b214d9`, CI and security scan green): `bun run seo:check --origin
https://www.shelra.dev --external` reports 0 errors and 1 warning (GitHub rate-limited one outbound link during the
crawl; requested alone it answers 200). robots.txt and the sitemap are the site's own, with no Cloudflare block in
front, and `https://shelra-code.vercel.app/memory?x=1` answers 308 to `https://www.shelra.dev/memory?x=1`.
Lighthouse on the live home page, median of three over the network (runs spread widely, mobile perf 50 to 82),
against the baseline's single run: mobile perf 45 → 56, LCP 7.7 → 4.9 s, TBT 670 → 562 ms, CLS 0.186 → 0.000, bytes
1,192 → 556 KB; desktop perf 85 → 96, LCP 2.0 → 1.2 s.

Not verified: anything about indexing or rankings (no Search Console data yet). Google's Rich Results Test was not
run; SEO-038 rests on Google's documented required properties.
