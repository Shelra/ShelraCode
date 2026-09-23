# Search rules for www.shelra.dev

The rules the website's search work follows, each with the primary source it comes from. Condensed on 2026-09-23 from
a read of about 140 pages of Google Search Central, web.dev, Bing Webmaster, OpenAI, Anthropic, Perplexity, Apple,
Cloudflare, Vercel, Next.js and Schema.org documentation, all fetched that day. Search guidance changes every few
months: before relying on a rule older than six months, re-read its source; when a source and this file disagree,
the source wins and this file gets fixed. Ranking weights are never documented; nothing here promises rankings.

## Crawling and indexing

- Google's only technical requirements: Googlebot is not blocked, the page answers 200, the content is indexable.
  Meeting them does not guarantee indexing ([Search Essentials](https://developers.google.com/search/docs/essentials/technical), 2025-12-18).
- robots.txt manages crawling, not indexing: a disallowed URL can still be indexed from links, without its content.
  Keep noindexed pages crawlable so the noindex is seen ([robots.txt intro](https://developers.google.com/search/docs/crawling-indexing/robots/intro), 2025-12-10).
  Google reads only `user-agent`, `allow`, `disallow` and `sitemap`; a named group does not inherit `*` rules
  ([robots.txt spec](https://developers.google.com/crawling/docs/robots-txt/robots-txt-spec), 2026-08-31).
- Conflicting robots directives: the most restrictive wins. `nosnippet` and `max-snippet` also limit what AI Overviews
  and AI Mode may use ([robots meta](https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag), 2026-03-24).
- 301/308 are strong canonical signals; 5xx and 429 slow crawling of the whole host; 404 and 410 drop URLs. An
  error-looking page answering 200 is a soft 404 ([HTTP status codes](https://developers.google.com/crawling/docs/troubleshooting/http-status-codes), 2026-02-04).
- Fragments (`#section`) are not separate URLs for Google: navigation by fragment gives a single-page site one
  indexable URL ([URL structure](https://developers.google.com/search/docs/crawling-indexing/url-structure), 2025-12-10).
- Googlebot reads the first 2 MB of an HTML file ([Googlebot](https://developers.google.com/search/docs/crawling-indexing/googlebot), 2026-02-03).

## Canonical URLs and duplicate hosts

- Signals stack: redirects and `rel=canonical` are strong, sitemap inclusion is weak. Put an absolute, self-referencing
  canonical in the `<head>` of every indexable page; never a fragment; never `noindex` to pick a canonical
  ([consolidate duplicate URLs](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls), 2026-07-10).
- Several hosts serving the same pages: pick one and redirect the others permanently
  ([site moves and redirects](https://developers.google.com/search/docs/crawling-indexing/301-redirects), 2026-04-14).
  For a Vercel project that means a host-scoped permanent redirect from `*.vercel.app` to the custom domain, keeping
  path and query ([Vercel: canonical production domain](https://vercel.com/docs/routing/redirects#choose-a-canonical-production-domain), 2026-08-11).
  Vercel already sends `X-Robots-Tag: noindex` on previews and outdated production deployments
  ([Vercel KB](https://vercel.com/kb/guide/are-vercel-preview-deployment-indexed-by-search-engines), 2026-08-03).
- Bing: duplicates "reduce Bing's confidence in selecting a URL for grounding results or citations"
  ([Bing guidelines](https://www.bing.com/webmasters/help/webmaster-guidelines-30fba23a)).

## Sitemaps

- List canonical, indexable URLs only, absolute. Google ignores `priority` and `changefreq`; it uses `lastmod` only
  when it is consistently accurate: the date of the last significant change, never the build time
  ([build a sitemap](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap), 2026-07-08).
  The ping endpoint is gone; submit in Search Console and name the sitemap in robots.txt.
- Bing treats `lastmod` as "a key signal" and also ignores priority and changefreq
  ([Bing blog](https://blogs.bing.com/webmaster/July-2025/Keeping-Content-Discoverable-with-Sitemaps-in-AI-Powered-Search), 2025-07-31).

## Titles, descriptions, site name, favicon

- Titles: unique, descriptive, concise; site name at the start or end with a separator. No length limit exists; Google
  cuts to the device width. Google builds title links from `<title>`, the main heading, `og:title`, anchor text and
  `WebSite` data ([title links](https://developers.google.com/search/docs/appearance/title-link), 2025-12-10).
- Descriptions: unique per page, no length limit; the snippet usually comes from page content
  ([snippets](https://developers.google.com/search/docs/appearance/snippet), 2026-04-20).
- Site name: `WebSite` structured data on the home page (`name`, `url`, `alternateName`), consistent with the home
  page's `<title>`, `og:site_name` and headings ([site names](https://developers.google.com/search/docs/appearance/site-names), 2025-12-10).
- Favicon: a `<link rel="icon">` on the home page to a square raster file (BMP, GIF, ICO, PNG, JPEG), larger than
  48×48; **SVG is not supported** ([favicon](https://developers.google.com/search/docs/appearance/favicon-in-search), 2026-08-28).

## Content and spam policies

- People-first content; no writing to a word count; no changing dates to look fresh
  ([helpful content](https://developers.google.com/search/docs/fundamentals/creating-helpful-content), 2025-12-10).
- Scaled content abuse: many pages made mainly to rank, however they are produced. Doorway abuse: similar pages aimed at
  similar queries. Hidden text includes "opacity to 0" when done to manipulate; accordions and tabs are not violations.
  Keyword stuffing includes unnatural repetition ([spam policies](https://developers.google.com/search/docs/essentials/spam-policies), 2026-08-28).
- Appropriate use of AI is fine; "it's just content" ([AI content](https://developers.google.com/search/blog/2023/02/google-search-and-ai-content), 2023-02-08).
  Pages made for fan-out query variants to manipulate AI responses are scaled content abuse
  ([AI optimization guide](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide), 2026-07-10).
- E-E-A-T is not a ranking factor; rater data is not used directly in ranking
  ([SEO Starter Guide](https://developers.google.com/search/docs/fundamentals/seo-starter-guide), 2025-12-10).

## Rendering and links

- Google renders JavaScript, but server HTML is faster and "not all bots can run JavaScript". Only `<a href>` links are
  reliably followed ([JavaScript SEO](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics), 2026-03-04;
  [crawlable links](https://developers.google.com/search/docs/crawling-indexing/links-crawlable), 2025-12-10).
- Google does not click: content loaded on interaction is not indexed
  ([mobile-first indexing](https://developers.google.com/search/docs/crawling-indexing/mobile/mobile-sites-mobile-first-indexing), 2025-12-10).
  Collapsed content that is in the HTML is indexed, but "read more" deep links need visible content, and Microsoft
  warns AI systems may not render hidden content ([Microsoft Advertising](https://about.ads.microsoft.com/en/blog/post/october-2025/optimizing-your-content-for-inclusion-in-ai-search-answers), 2025-10-08).
- Next.js: async `generateMetadata` may stream tags into `<body>` for bots outside `htmlLimitedBots`; Google accepts a
  canonical only in `<head>`. Public pages here use static `metadata` exports, which render in the head
  ([generateMetadata](https://nextjs.org/docs/app/api-reference/functions/generate-metadata), 2026-08-25).
- Anchor text: descriptive and concise; every page you care about needs a link from another page
  ([crawlable links](https://developers.google.com/search/docs/crawling-indexing/links-crawlable), 2025-12-10).

## Structured data

- Markup must describe content visible on the page, be accurate and current; valid markup guarantees nothing
  ([structured data policies](https://developers.google.com/search/docs/appearance/structured-data/sd-policies), 2026-07-10).
  No special schema is needed for AI features ([AI optimization guide](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide), 2026-07-10).
- Software app rich result requires `name`, `offers.price` (0 allowed) and a rating or review shown on the page
  ([software app](https://developers.google.com/search/docs/appearance/structured-data/software-app), 2026-09-08).
  Ratings may not come from other sites (GitHub stars are not ratings) and fake reviews are banned
  ([review snippets](https://developers.google.com/search/docs/appearance/structured-data/review-snippet), 2026-09-08):
  this site has no reviews, so its `SoftwareApplication` markup describes the entity and earns no rich result.
- FAQ rich results stopped appearing on 2026-05-07; HowTo ended in 2023; the sitelinks search box in 2024
  ([Search Central changelog](https://developers.google.com/search/updates), 2026-09-18).
- `Dataset` markup feeds only Google Dataset Search since 2025-11-05. Breadcrumbs show on desktop results only since
  2025-01-22 ([changelog](https://developers.google.com/search/updates), 2026-09-18).
- `SoftwareSourceCode` (with `targetProduct`) is valid Schema.org but not a Google rich result
  ([schema.org](https://schema.org/SoftwareSourceCode), V30.1).

## AI search and crawlers

- Google AI Overviews and AI Mode: an indexed page eligible for a snippet, and the site included under Search
  Console › Settings › Search generative AI (the default). The Generative AI performance report shows impressions.
  Google Search ignores llms.txt ([AI optimization guide](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide), 2026-07-10;
  [Search Console help](https://support.google.com/webmasters/answer/16908024)).
- `Google-Extended` controls Gemini training and grounding, not Search inclusion
  ([Google crawlers](https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers), 2026-07-14).
- ChatGPT search inclusion is `OAI-SearchBot`; `GPTBot` is training only ([OpenAI bots](https://developers.openai.com/api/docs/bots)).
  Anthropic: `ClaudeBot` trains, `Claude-SearchBot` indexes for search, `Claude-User` fetches for users
  ([Anthropic](https://support.claude.com/en/articles/8896518)). `PerplexityBot` is search
  ([Perplexity](https://docs.perplexity.ai/docs/resources/perplexity-crawlers), 2026-01-29). `Applebot` is search,
  `Applebot-Extended` training ([Apple](https://support.apple.com/en-us/119829), 2026-09-04).
- Bing and Copilot: `NOARCHIVE` keeps a page out of Copilot answers, `NOCACHE` limits them to URL, title and snippet;
  Bing Webmaster Tools has an AI Performance report ([Bing guidelines](https://www.bing.com/webmasters/help/webmaster-guidelines-30fba23a)).
- Cloudflare prepends its managed robots.txt block to the origin's file. Since 2026-09-15 its "Block" and "Block on
  pages with ads" AI settings also block Googlebot, Bingbot and Applebot; use "Disallow AI Training" or "Allow"
  ([Cloudflare blog](https://blog.cloudflare.com/accountable-mixed-use-ai-crawlers/), 2026-09-15;
  [managed robots.txt](https://developers.cloudflare.com/bots/additional-configurations/managed-robots-txt/), 2026-08-03).

## Performance

- Core Web Vitals at the 75th percentile of real visits: LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1. They are used in
  ranking; other page-experience aspects "don't directly help" ([page experience](https://developers.google.com/search/docs/appearance/page-experience), 2026-09-22;
  [web.dev vitals](https://web.dev/articles/vitals), 2024-10-31). Lighthouse is a lab diagnostic; field data decides.
- LCP: discoverable in the initial HTML, `fetchpriority="high"` on one or two images, never lazy-loaded
  ([optimize LCP](https://web.dev/articles/optimize-lcp), 2025-03-31). LCP ignores elements at opacity 0.
- CLS: dimensions on images; fallback fonts matched with `size-adjust` and the ascent/descent overrides
  ([optimize CLS](https://web.dev/articles/optimize-cls), 2025-02-07).

## Images

- `<img src>` (also inside `<picture>`, with a fallback `src`); CSS background images are not indexed. Alt text is the
  most important attribute; decorative images take `alt=""`
  ([Google Images](https://developers.google.com/search/docs/appearance/google-images), 2026-03-02).

## Language

- Google detects language from visible content, not `lang` or hreflang; hreflang only for real language or region
  variants ([localized versions](https://developers.google.com/search/docs/specialty/international/localized-versions), 2026-09-21).
  Keep `lang` for accessibility (WCAG 2.2 SC 3.1.1).

## Measurement

- Search Console: verify a Domain property with a DNS TXT record (it survives redeploys); data is kept 16 months, so
  export through the API to keep more ([verification](https://support.google.com/webmasters/answer/9008080);
  [Search Analytics API](https://developers.google.com/webmaster-tools/v1/searchanalytics/query), 2026-08-11).
- Bing Webmaster Tools can import a verified Search Console site. IndexNow feeds Bing, Yandex and others, not Google;
  Cloudflare Crawler Hints sends it automatically ([IndexNow](https://www.indexnow.org/); [Crawler Hints](https://developers.cloudflare.com/cache/advanced-configuration/crawler-hints/), 2026-08-14).

## Myths this project rejects

Meta keywords; ideal word counts; E-E-A-T as a ranking factor; a duplicate-content penalty; heading order as a ranking
signal; title or description character limits; sitemap priority and changefreq; the sitemap ping; robots.txt as an
index control; noindex for canonicalization; FAQ markup for rich results; llms.txt or "chunking" for AI Overviews;
blocking `Google-Extended` to leave AI Overviews; blocking `GPTBot` to leave ChatGPT search; chasing a Lighthouse 100;
SVG favicons in Google Search. Each is refuted by the sources above.
