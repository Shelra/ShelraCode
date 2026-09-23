# Search (SEO) for www.shelra.dev

How the website makes itself findable, how that is checked, and what only the owner can do. The website is the
Next.js app in `frontend/` (see `frontend/CLAUDE.md`); production is `https://www.shelra.dev`, on Vercel behind
Cloudflare.

| File | What it holds |
| --- | --- |
| [strategy.md](strategy.md) | Positioning, the query clusters, the page that answers each, internal links, AI search |
| [search-rules.md](search-rules.md) | The rules the work follows, each with its primary source and date |
| [audit.md](audit.md) | The baseline, the issue register (P0–P3) and the three improvement rounds, with evidence |
| [roadmap.md](roadmap.md) | What comes next: now, next, later |

## The system

| Part | Where | Notes |
| --- | --- | --- |
| Canonical origin, indexable pages, private routes | `frontend/src/lib/site.ts` | `siteUrl` (override with `NEXT_PUBLIC_SITE_URL`), `publicPages` with the date each page's content last changed, `noindexPrefixes` |
| Page metadata | `frontend/src/lib/metadata.ts` | `pageMetadata()`: title, description, canonical, Open Graph and Twitter in one static object per page |
| Structured data | `frontend/src/lib/structured-data.ts`, `frontend/src/components/seo/JsonLd.tsx` | Schema.org graphs; only facts the page shows; no ratings or reviews (the site has none) |
| robots.txt, sitemap | `frontend/src/app/robots.ts`, `frontend/src/app/sitemap.ts` | Generated from `site.ts`; only `/api/` is disallowed |
| Guide pages | `frontend/src/lib/guides.ts` (copy), `frontend/src/components/doc/` (layout, tables) | `/memory`, `/local`, `/free-models`; copy sourced from the repository; measured numbers only from `bench-summary.json`, which `bun run bench:sync` derives from `bench/history` |
| Duplicate host | `frontend/next.config.ts` | In a Vercel production build, any `*.vercel.app` host answers 308 to `https://www.shelra.dev` (not behind Cloudflare, so it cannot loop) |
| Icons | `frontend/src/app/favicon.ico`, `frontend/public/images/icon-192.png`, `apple-icon.png` | Google's search favicon must be raster, not SVG |
| Images | `frontend/scripts/optimize-images.ts` | `bun run images` writes the WebP copies the pages serve |
| Regression check | `frontend/scripts/seo-check.ts` | `bun run seo:check` (below) |

## The regression check

`bun run seo:check` (from `frontend/`, after `bun run build`) serves the build on a free port, crawls it from the home
page, the sitemap, the private routes and every static route in the build's route manifest, and fails (exit 1) on:

- robots.txt missing, without the sitemap line, or blocking a public page for Googlebot, Bingbot, Applebot,
  OAI-SearchBot, Claude-SearchBot or PerplexityBot (groups selected and merged as RFC 9309 specifies, so a named
  group that shadows `*` is caught);
- a sitemap entry that is off the production origin, duplicated, dated in the future, blocked by robots.txt or
  noindex; an indexable page missing from the sitemap, or reachable from the home page by no link (orphan);
- a page route that is neither in `publicPages` nor under a private prefix (`src/lib/site.ts`);
- a public page with noindex, or a private route (`/dashboard`, `/login`, `/signup`, `/account`) without it; a
  snippet opt-out on a public page (`nosnippet`, `noarchive`, `max-snippet:0`, `data-nosnippet`), which would keep it
  out of snippets and AI answers;
- a public page whose text is more than half hidden until JavaScript runs (animation start states) with no
  `<noscript>` style that reveals it;
- a missing, empty, duplicated or doubled-brand `<title>`, a missing or duplicated description, no `<html lang>`;
- a canonical that is missing, relative, doubled, outside `<head>` or not the page's own production URL;
- missing Open Graph or Twitter tags, an `og:url` that differs from the canonical, a social image on another host,
  no raster favicon on the home page;
- not exactly one `<h1>`; an `<img>` without `alt`; a link without an accessible name; unrendered inline markup in
  the text; an internal link or `#fragment` that leads nowhere, or an internal link that redirects (links are
  requested exactly as written);
- an image, icon or structured-data image that does not answer 200 with an image type;
- invalid JSON-LD, a node without `@type`, a `WebPage` url or last breadcrumb item that is not the canonical, or any
  rating or review markup;
- an unknown URL that does not answer 404 with noindex.

It warns (without failing) on long titles and descriptions, skipped heading levels, near-empty server HTML and
duplicate robots tags. `--external` also requests every outbound link (a 404 or 410 fails; a 403 or 429 is reported
as unverifiable). `--origin <url>` audits any running deployment (for example production, where Cloudflare's
managed robots.txt block is part of what is evaluated); `--json <file>` writes the full report. The route manifest
is read only when auditing a local build. `/api/` is disallowed in robots.txt and never crawled. Rules and their
sources: [search-rules.md](search-rules.md).

Run it with every change to public pages, together with `bunx tsc --noEmit`, `bun run build` and Biome
(`frontend/CLAUDE.md`).

## Measurement

What exists: Cloudflare Web Analytics runs on production (its beacon loads on every page), which reports real-user
Core Web Vitals in the Cloudflare dashboard. What is prepared: a sitemap to submit, and verification tags that
render when `GOOGLE_SITE_VERIFICATION` or `BING_SITE_VERIFICATION` is set on the deployment (a DNS record is the
better method, below). What does not exist yet: any Search Console or Bing Webmaster data; nothing in these documents
reports clicks, impressions or positions, because none has been collected.

Once Search Console is connected, the numbers that matter:

| Question | Where |
| --- | --- |
| Is every page in `publicPages` indexed with our canonical? | Search Console › Pages, and URL Inspection per page |
| Which queries show the site, and at what position? | Search Console › Performance (clicks, impressions, CTR, position), filtered by page |
| Do AI Overviews and AI Mode show it? | Search Console › Generative AI performance (impressions) |
| Copilot and Bing citations | Bing Webmaster Tools › AI Performance |
| Real-user LCP, INP and CLS | Cloudflare Web Analytics › Core Web Vitals; Search Console › Core Web Vitals once there is enough traffic |

Search Console keeps 16 months of data; export monthly through its API if a longer history is wanted.

## What only the owner can do

1. **Deploy.** A push to `main` deploys through Vercel; the work in [audit.md](audit.md) went live on 2026-09-23.
   After each deploy, run the check against production (`--origin https://www.shelra.dev --external`).
2. **Search Console.** Add a *Domain* property for `shelra.dev` with the DNS TXT record (in Cloudflare DNS); it covers
   `www` and survives every redeploy. Submit `https://www.shelra.dev/sitemap.xml`; inspect `/` and request indexing;
   keep Settings › Search generative AI at *Include* (the default) so AI Overviews may cite the site.
3. **Bing Webmaster Tools.** Import the site from Search Console, submit the sitemap, and watch AI Performance.
4. **Cloudflare.** Keep the AI crawler setting at *Allow* or *Disallow AI Training*; since 2026-09-15 *Block* also
   blocks Googlebot and Bingbot. Turning on Crawler Hints sends IndexNow pings to Bing and others on content changes.
   With its managed robots.txt on, Cloudflare prepends its own block to ours (on 2026-09-23 production served ours
   alone); check `curl https://www.shelra.dev/robots.txt` after changing either setting.
5. **Vercel** (optional; the code already redirects): the project's Domains page can also redirect
   `shelra-code.vercel.app` to `www.shelra.dev`.
6. **npm.** The site no longer links to `npmjs.com/package/shelra`: that package is not published (the registry
   answers 404), although the README offers `bun add -g shelra`. Publishing it, or dropping that line, is the
   owner's call; once published, add it back to `links` and to the `sameAs` list in the structured data.
