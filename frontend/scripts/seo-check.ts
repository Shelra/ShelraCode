/**
 * SEO regression check: crawls a running build of the site and fails on the mistakes that cost
 * search visibility (accidental noindex, missing or wrong canonicals, a sitemap that disagrees with
 * the pages, broken internal links and anchors, invalid JSON-LD, missing titles or alt text).
 *
 *   bun run seo:check                                   (from frontend/, after `bun run build`)
 *   bun run scripts/seo-check.ts --origin http://localhost:3000
 *   bun run scripts/seo-check.ts --origin https://www.shelra.dev --json report.json
 *   bun run scripts/seo-check.ts --external          (also fetch outbound links; slower, network-dependent)
 *
 * Without --origin it serves the last production build on a free port and stops it afterwards.
 * Errors exit with status 1; warnings are printed but do not fail. The rules and their sources are
 * in docs/seo/README.md.
 */
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { noindexPrefixes, publicPages, siteName, siteUrl } from "../src/lib/site";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");

// The production origin every canonical, sitemap entry and social image must use.
const CANONICAL_ORIGIN = siteUrl;
// Private routes are always visited, linked or not, so a lost noindex is caught.
const PRIVATE_SEEDS = ["/login", "/signup", "/account", "/dashboard"];
const MISSING_PATH = "/__seo-check-missing__";
// Crawlers whose robots.txt rules must allow every public page: search and answer engines.
const CRAWLERS = ["googlebot", "bingbot", "applebot", "oai-searchbot", "claude-searchbot", "perplexitybot"];

type Severity = "error" | "warning";
interface Finding {
  severity: Severity;
  url: string;
  rule: string;
  message: string;
}

interface Heading {
  level: number;
  text: string;
}

interface Link {
  href: string;
  name: string;
}

interface PageFacts {
  url: string;
  status: number;
  redirectedTo: string | null;
  contentType: string;
  xRobotsTag: string | null;
  lang: string | null;
  titles: string[];
  descriptions: string[];
  robots: string[];
  robotsTags: { name: string; content: string }[];
  canonicals: string[];
  /** Canonical links found outside <head>, which Google ignores. */
  canonicalsOutsideHead: number;
  icons: string[];
  /** Every image URL the page loads: img src, source srcset. */
  assets: string[];
  meta: Record<string, string>;
  headings: Heading[];
  links: Link[];
  images: { src: string; alt: string | null }[];
  jsonLd: string[];
  ids: Set<string>;
  words: number;
  /** Words inside elements hidden by an inline style (opacity 0 or 0.001, visibility, display) or `hidden`. */
  hiddenWords: number;
  /** A <noscript> stylesheet that reveals animation start states for readers without JavaScript. */
  noscriptReveal: boolean;
  /** An element carries data-nosnippet. */
  dataNosnippet: boolean;
  /** A fragment of visible text that still contains **, ]( or backtick markup. */
  leftoverMarkup: string | null;
}

// --- HTML tokenizer (React's server output is well formed; this is enough to read it) ---

const VOID = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "source",
  "track",
  "wbr",
]);
const RAW_TEXT = new Set(["script", "style"]);
const NOT_CONTENT = new Set(["script", "style", "template", "noscript", "head", "title"]);

type Token =
  | { kind: "open"; tag: string; attrs: Record<string, string> }
  | { kind: "close"; tag: string }
  | { kind: "text"; text: string };

function decodeEntities(value: string): string {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return value.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const code =
        entity[1] === "x" || entity[1] === "X" ? Number.parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return named[entity.toLowerCase()] ?? match;
  });
}

function parseAttrs(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const pattern = /([^\s"'=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  for (const match of source.matchAll(pattern)) {
    attrs[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attrs;
}

function* tokenize(html: string): Generator<Token> {
  let at = 0;
  while (at < html.length) {
    const lt = html.indexOf("<", at);
    if (lt === -1) {
      yield { kind: "text", text: decodeEntities(html.slice(at)) };
      return;
    }
    if (lt > at) yield { kind: "text", text: decodeEntities(html.slice(at, lt)) };
    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt + 4);
      at = end === -1 ? html.length : end + 3;
      continue;
    }
    if (html[lt + 1] === "!" || html[lt + 1] === "?") {
      const end = html.indexOf(">", lt);
      at = end === -1 ? html.length : end + 1;
      continue;
    }
    const end = html.indexOf(">", lt);
    if (end === -1) return;
    const body = html.slice(lt + 1, end);
    at = end + 1;
    if (body[0] === "/") {
      yield { kind: "close", tag: body.slice(1).trim().toLowerCase() };
      continue;
    }
    const name = /^[^\s/>]+/.exec(body)?.[0].toLowerCase() ?? "";
    if (!name) continue;
    yield { kind: "open", tag: name, attrs: parseAttrs(body.slice(name.length)) };
    if (VOID.has(name) || body.endsWith("/")) {
      yield { kind: "close", tag: name };
      continue;
    }
    if (RAW_TEXT.has(name)) {
      const close = html.toLowerCase().indexOf(`</${name}`, at);
      const stop = close === -1 ? html.length : close;
      yield { kind: "text", text: html.slice(at, stop) };
      yield { kind: "close", tag: name };
      const closeEnd = html.indexOf(">", stop);
      at = closeEnd === -1 ? html.length : closeEnd + 1;
    }
  }
}

function readPage(html: string): Omit<PageFacts, "url" | "status" | "redirectedTo" | "contentType" | "xRobotsTag"> {
  const facts = {
    lang: null as string | null,
    titles: [] as string[],
    descriptions: [] as string[],
    robots: [] as string[],
    robotsTags: [] as { name: string; content: string }[],
    canonicals: [] as string[],
    canonicalsOutsideHead: 0,
    icons: [] as string[],
    assets: [] as string[],
    meta: {} as Record<string, string>,
    headings: [] as Heading[],
    links: [] as Link[],
    images: [] as { src: string; alt: string | null }[],
    jsonLd: [] as string[],
    ids: new Set<string>(),
    words: 0,
    hiddenWords: 0,
    noscriptReveal: /<noscript>[\s\S]*?opacity:1!important[\s\S]*?<\/noscript>/.test(html),
    dataNosnippet: /\sdata-nosnippet(=|\s|>)/.test(html),
    leftoverMarkup: null as string | null,
  };
  // Open elements: whether each hides its content from assistive technology (aria-hidden), and whether it is
  // invisible on arrival (an inline style an animation starts from, or the hidden attribute).
  const stack: { tag: string; hidden: boolean; invisible: boolean }[] = [];
  const invisibleStyle = /(^|;)\s*(opacity:\s*0(\.0*1)?\s*(;|$)|visibility:\s*hidden|display:\s*none)/;
  let skipDepth = 0; // inside script/style/template/head/title: not page content
  let title: string | null = null;
  let jsonLd: string | null = null;
  let heading: Heading | null = null;
  let anchor: (Link & { label: string | null }) | null = null;

  for (const token of tokenize(html)) {
    if (token.kind === "open") {
      const { tag, attrs } = token;
      if (attrs.id) facts.ids.add(attrs.id);
      if (tag === "html") facts.lang = attrs.lang ?? null;
      if (tag === "title" && !stack.some((open) => open.tag === "svg")) title = "";
      if (tag === "script" && attrs.type === "application/ld+json") jsonLd = "";
      if (tag === "meta") {
        const key = (attrs.name ?? attrs.property ?? "").toLowerCase();
        const content = attrs.content ?? "";
        if (key === "description") facts.descriptions.push(content);
        else if (key === "robots" || key === "googlebot") {
          facts.robots.push(content.toLowerCase());
          facts.robotsTags.push({ name: key, content: content.toLowerCase() });
        } else if (key) facts.meta[key] = content;
      }
      const rel = (attrs.rel ?? "").toLowerCase().split(/\s+/);
      if (tag === "link" && rel.includes("canonical")) {
        facts.canonicals.push(attrs.href ?? "");
        if (!stack.some((open) => open.tag === "head")) facts.canonicalsOutsideHead++;
      }
      if (tag === "link" && rel.includes("icon")) facts.icons.push(attrs.href ?? "");
      if (/^h[1-6]$/.test(tag)) heading = { level: Number(tag[1]), text: "" };
      if (tag === "a") anchor = { href: attrs.href ?? "", name: "", label: attrs["aria-label"] ?? attrs.title ?? null };
      if (tag === "source" && attrs.srcset) {
        for (const candidate of attrs.srcset.split(",")) facts.assets.push(candidate.trim().split(/\s+/)[0]);
      }
      if (tag === "img") {
        facts.images.push({ src: attrs.src ?? "", alt: "alt" in attrs ? attrs.alt : null });
        if (attrs.src) facts.assets.push(attrs.src);
        if (anchor && attrs.alt) anchor.name += ` ${attrs.alt}`;
      }
      if (anchor && tag !== "a" && attrs["aria-label"] && attrs.role === "img")
        anchor.name += ` ${attrs["aria-label"]}`;
      if (NOT_CONTENT.has(tag)) skipDepth++;
      if (!VOID.has(tag)) {
        stack.push({
          tag,
          hidden: attrs["aria-hidden"] === "true",
          invisible: "hidden" in attrs || invisibleStyle.test(attrs.style ?? ""),
        });
      }
    } else if (token.kind === "close") {
      const { tag } = token;
      const index = stack.findLastIndex((open) => open.tag === tag);
      if (index !== -1) stack.length = index;
      if (NOT_CONTENT.has(tag) && skipDepth > 0) skipDepth--;
      if (tag === "title" && title !== null) {
        facts.titles.push(title.trim());
        title = null;
      }
      if (tag === "script" && jsonLd !== null) {
        facts.jsonLd.push(jsonLd);
        jsonLd = null;
      }
      if (/^h[1-6]$/.test(tag) && heading) {
        facts.headings.push({ level: heading.level, text: heading.text.replace(/\s+/g, " ").trim() });
        heading = null;
      }
      if (tag === "a" && anchor) {
        const name = (anchor.label ?? anchor.name).replace(/\s+/g, " ").trim();
        facts.links.push({ href: anchor.href, name });
        anchor = null;
      }
    } else {
      if (title !== null) title += token.text;
      if (jsonLd !== null) jsonLd += token.text;
      if (skipDepth > 0) continue;
      if (heading) heading.text += token.text;
      if (anchor && !stack.some((open) => open.hidden)) anchor.name += token.text;
      const wordCount = token.text.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
      facts.words += wordCount;
      if (stack.some((open) => open.invisible)) facts.hiddenWords += wordCount;
      const markup = /\*\*\S|\]\(|`[^`\s]/.exec(token.text);
      if (markup && !facts.leftoverMarkup)
        facts.leftoverMarkup = token.text.slice(Math.max(0, markup.index - 20), markup.index + 20);
    }
  }
  return facts;
}

// --- Crawling ---

const canonicalHost = new URL(CANONICAL_ORIGIN).host;

function isNoindexPath(path: string): boolean {
  return noindexPrefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/** The canonical form of a path on the production origin: no query, no fragment, no trailing slash. */
function canonicalFor(path: string): string {
  const clean = path.length > 1 ? path.replace(/\/+$/, "") : path;
  return clean === "/" ? `${CANONICAL_ORIGIN}/` : `${CANONICAL_ORIGIN}${clean}`;
}

function sameUrl(a: string, b: string): boolean {
  const normalize = (value: string) => {
    const url = new URL(value);
    const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, "") : url.pathname;
    return `${url.protocol}//${url.host}${path}${url.search}`;
  };
  return normalize(a) === normalize(b);
}

async function fetchPage(origin: string, path: string): Promise<{ facts: PageFacts; html: string }> {
  const url = new URL(path, origin).toString();
  const response = await fetch(url, { redirect: "manual", headers: { "user-agent": "shelra-seo-check" } });
  const location = response.headers.get("location");
  const contentType = response.headers.get("content-type") ?? "";
  const html = contentType.includes("text/html") ? await response.text() : "";
  const facts: PageFacts = {
    url,
    status: response.status,
    redirectedTo: location ? new URL(location, url).toString() : null,
    contentType,
    xRobotsTag: response.headers.get("x-robots-tag"),
    ...readPage(html),
  };
  return { facts, html };
}

function isNoindex(facts: PageFacts): boolean {
  const directives = [...facts.robots, (facts.xRobotsTag ?? "").toLowerCase()].join(",");
  return /(^|[\s,])(noindex|none)([\s,]|$)/.test(directives);
}

function parseRobotsTxt(text: string) {
  const groups: { agents: string[]; allow: string[]; disallow: string[] }[] = [];
  const sitemaps: string[] = [];
  let current: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const match = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1].toLowerCase();
    const value = match[2].trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], allow: [], disallow: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (key === "sitemap") sitemaps.push(value);
    else if (current && key === "allow" && value) current.allow.push(value);
    else if (current && key === "disallow" && value) current.disallow.push(value);
  }
  return { groups, sitemaps };
}

/** The rules one crawler follows: every group naming it, combined; otherwise every `*` group, combined. */
function groupFor(groups: { agents: string[]; allow: string[]; disallow: string[] }[], crawler: string) {
  const named = groups.filter((group) => group.agents.includes(crawler));
  const chosen = named.length ? named : groups.filter((group) => group.agents.includes("*"));
  if (!chosen.length) return undefined;
  return { allow: chosen.flatMap((group) => group.allow), disallow: chosen.flatMap((group) => group.disallow) };
}

/** Longest-match robots.txt evaluation (RFC 9309) for one path under one group. */
function robotsAllows(group: { allow: string[]; disallow: string[] } | undefined, path: string): boolean {
  if (!group) return true;
  const matches = (rule: string) => {
    const pattern = rule
      .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*")
      .replace(/\\\$$/, "$");
    return new RegExp(`^${pattern}`).test(path);
  };
  const allow = Math.max(-1, ...group.allow.filter(matches).map((rule) => rule.length));
  const disallow = Math.max(-1, ...group.disallow.filter(matches).map((rule) => rule.length));
  return allow >= disallow;
}

function sitemapLocs(xml: string): { loc: string; lastmod: string | null }[] {
  return [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((entry) => ({
    loc: decodeEntities(/<loc>\s*([^<]+?)\s*<\/loc>/.exec(entry[1])?.[1] ?? ""),
    lastmod: /<lastmod>\s*([^<]+?)\s*<\/lastmod>/.exec(entry[1])?.[1] ?? null,
  }));
}

// --- Rules ---

function checkPage(facts: PageFacts, add: (severity: Severity, rule: string, message: string) => void) {
  const path = new URL(facts.url).pathname;
  const noindex = isNoindex(facts);
  const expectNoindex = isNoindexPath(path);

  if (!facts.lang) add("error", "html-lang", "The <html> element has no lang attribute.");
  if (facts.titles.length !== 1 || !facts.titles[0]) {
    add("error", "title", `Expected one non-empty <title>, found ${facts.titles.length}.`);
  } else if ((facts.titles[0].match(new RegExp(siteName, "g")) ?? []).length > 1) {
    add("error", "title", `The site name appears twice: "${facts.titles[0]}".`);
  }
  for (const name of ["robots", "googlebot"]) {
    const tags = facts.robotsTags.filter((tag) => tag.name === name);
    if (tags.length > 1) {
      add(
        "warning",
        "robots-meta",
        `${tags.length} ${name} meta tags (${tags.map((tag) => tag.content).join(" | ")}).`,
      );
    }
  }
  if (expectNoindex && !noindex) add("error", "noindex", "A private route is indexable; it must carry noindex.");
  if (!expectNoindex && noindex) add("error", "noindex", "A public page carries noindex.");
  if (noindex) return;

  // Snippet opt-outs keep a page out of snippets, AI Overviews and Copilot answers: never on a public page.
  const directives = [...facts.robots, (facts.xRobotsTag ?? "").toLowerCase()].join(",");
  const optOut = /(^|[\s,])(nosnippet|noarchive|max-snippet:\s*0)([\s,]|$)/.exec(directives);
  if (optOut) add("error", "robots-meta", `A public page opts out of snippets: "${optOut[2]}".`);
  if (facts.dataNosnippet) add("error", "robots-meta", "An element carries data-nosnippet on a public page.");

  // Text a reader without JavaScript cannot see (animation start states), unless a <noscript> style reveals it.
  const hiddenShare = facts.words ? facts.hiddenWords / facts.words : 0;
  if (hiddenShare > 0.5 && !facts.noscriptReveal) {
    add(
      "error",
      "rendering",
      `${Math.round(hiddenShare * 100)}% of the text is hidden until JavaScript runs, with no <noscript> reveal.`,
    );
  }

  const title = facts.titles[0] ?? "";
  // Google sets no length limit; it cuts titles and snippets to the device width, so long ones lose their end.
  if (title.length > 65) add("warning", "title", `Title is ${title.length} characters; the end may be cut in results.`);
  if (title.length < 15) add("warning", "title", `Title is only ${title.length} characters.`);
  if (facts.descriptions.length !== 1 || !facts.descriptions[0]) {
    add("error", "description", `Expected one meta description, found ${facts.descriptions.length}.`);
  } else {
    const length = facts.descriptions[0].length;
    if (length > 165)
      add("warning", "description", `Description is ${length} characters; the end may be cut in results.`);
    if (length < 70) add("warning", "description", `Description is only ${length} characters.`);
  }

  const expected = canonicalFor(path);
  if (facts.canonicals.length !== 1) {
    add("error", "canonical", `Expected one canonical link, found ${facts.canonicals.length}.`);
  } else if (!/^https:\/\//.test(facts.canonicals[0])) {
    add("error", "canonical", `Canonical is not an absolute https URL: ${facts.canonicals[0]}`);
  } else if (!sameUrl(facts.canonicals[0], expected)) {
    add("error", "canonical", `Canonical ${facts.canonicals[0]} should be ${expected}.`);
  }
  if (facts.canonicalsOutsideHead)
    add("error", "canonical", "A canonical link outside <head> (Google ignores it there).");

  for (const key of ["og:title", "og:description", "og:image", "og:url", "og:type", "twitter:card"]) {
    if (!facts.meta[key]) add("error", "social", `Missing ${key}.`);
  }
  const ogImage = facts.meta["og:image"];
  if (ogImage && new URL(ogImage, facts.url).host !== canonicalHost) {
    add("error", "social", `og:image is served from another host: ${ogImage}`);
  }
  const ogUrl = facts.meta["og:url"];
  if (ogUrl && !sameUrl(new URL(ogUrl, facts.url).toString(), expected)) {
    add("error", "social", `og:url ${ogUrl} differs from the canonical ${expected}.`);
  }

  // Google Search shows raster favicons only (a multiple of 48 px); an SVG alone leaves the result without one.
  if (path === "/" && !facts.icons.some((href) => /\.(png|ico)(\?|$)/i.test(href))) {
    add("error", "favicon", "No PNG or ICO icon link on the home page (Google does not use SVG favicons).");
  }

  const h1s = facts.headings.filter((heading) => heading.level === 1);
  // Project convention (one clear main title, accessible outline); Google itself sets no heading rules.
  if (h1s.length !== 1 || !h1s[0].text) add("error", "h1", `Expected one non-empty <h1>, found ${h1s.length}.`);
  let previous = 0;
  for (const heading of facts.headings) {
    if (!heading.text) add("warning", "headings", `Empty <h${heading.level}>.`);
    if (previous && heading.level > previous + 1) {
      add(
        "warning",
        "headings",
        `<h${heading.level}> "${heading.text.slice(0, 40)}" skips a level after <h${previous}>.`,
      );
    }
    previous = heading.level;
  }
  // Not a length rule: a page this empty in its server HTML usually renders its content only in the browser.
  if (facts.words < 150)
    add("warning", "content", `Only ${facts.words} words in the server HTML; is the content client-only?`);
  if (facts.leftoverMarkup) add("error", "content", `Unrendered inline markup in the text: "${facts.leftoverMarkup}".`);

  for (const image of facts.images) {
    if (image.alt === null) add("error", "img-alt", `<img src="${image.src}"> has no alt attribute.`);
  }
  for (const link of facts.links) {
    if (!link.href || /^(javascript:|#$)/i.test(link.href)) {
      add("warning", "links", `A link without a crawlable href ("${link.name.slice(0, 40)}").`);
    } else if (!link.name) {
      add("error", "links", `Link to ${link.href} has no accessible name.`);
    }
  }

  const types: string[] = [];
  for (const block of facts.jsonLd) {
    let data: unknown;
    try {
      data = JSON.parse(block);
    } catch (error) {
      add("error", "json-ld", `Invalid JSON-LD: ${(error as Error).message}`);
      continue;
    }
    const context = JSON.stringify((data as { "@context"?: unknown })["@context"] ?? "");
    if (!context.includes("schema.org")) add("error", "json-ld", "JSON-LD without a schema.org @context.");
    const nodes = ((data as { "@graph"?: unknown[] })["@graph"] ?? [data]) as Record<string, unknown>[];
    for (const node of nodes) {
      const type = String(node["@type"] ?? "");
      if (!type) add("error", "json-ld", "A JSON-LD node has no @type.");
      types.push(type);
      if (["Organization", "WebSite", "SoftwareApplication", "WebPage"].includes(type) && !node.name) {
        add("error", "json-ld", `${type} has no name.`);
      }
      if (type === "BreadcrumbList" && !Array.isArray(node.itemListElement)) {
        add("error", "json-ld", "BreadcrumbList has no itemListElement.");
      }
      // The page node and the breadcrumb's last item must name this page's canonical URL.
      if (type === "WebPage" && typeof node.url === "string" && !sameUrl(node.url, expected)) {
        add("error", "json-ld", `WebPage url ${node.url} should be ${expected}.`);
      }
      if (type === "BreadcrumbList" && Array.isArray(node.itemListElement)) {
        const last = node.itemListElement.at(-1) as { item?: unknown } | undefined;
        if (typeof last?.item === "string" && !sameUrl(last.item, expected)) {
          add("error", "json-ld", `The breadcrumb ends at ${last.item}, not at ${expected}.`);
        }
      }
    }
    // Ratings and reviews must come from real users; the site has none, so any is fabricated.
    if (/"(aggregateRating|review)"\s*:/.test(block)) {
      add("error", "json-ld", "JSON-LD declares ratings or reviews; the site has no real ones to mark up.");
    }
    for (const match of block.matchAll(/"(?:url|@id|item|logo|image)"\s*:\s*"(https?:\/\/[^"]+)"/g)) {
      const host = new URL(match[1]).host;
      if (host.endsWith("shelra.dev") && host !== canonicalHost) {
        add("error", "json-ld", `JSON-LD URL on a non-canonical host: ${match[1]}`);
      }
    }
  }
  return types;
}

// --- Server for the local build ---

async function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const server = createServer();
    server.once("error", fail);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => done(typeof address === "object" && address ? address.port : 0));
    });
  });
}

async function startBuild(): Promise<{ origin: string; child: ChildProcess }> {
  const port = await freePort();
  const child = spawn(
    process.execPath.includes("bun") ? "node" : process.execPath,
    [resolve(root, "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(port)],
    { cwd: root, stdio: "ignore", detached: process.platform !== "win32" },
  );
  const origin = `http://localhost:${port}`;
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      const response = await fetch(origin, { redirect: "manual" });
      if (response.status < 500) return { origin, child };
    } catch {}
    await new Promise((wait) => setTimeout(wait, 250));
  }
  stopBuild(child);
  throw new Error("The production server did not start; run `bun run build` first.");
}

function stopBuild(child: ChildProcess) {
  if (!child.pid) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  else {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {}
  }
}

// --- Main ---

async function main() {
  const args = process.argv.slice(2);
  const option = (name: string) => {
    const index = args.indexOf(name);
    return index === -1 ? undefined : args[index + 1];
  };
  const maxPages = Number(option("--max-pages") ?? 300);
  const jsonPath = option("--json");
  let origin = option("--origin")?.replace(/\/+$/, "");
  let child: ChildProcess | null = null;
  if (!origin) ({ origin, child } = await startBuild());

  const findings: Finding[] = [];
  const pages: (Omit<PageFacts, "ids"> & { indexable: boolean; jsonLdTypes: string[] })[] = [];
  try {
    const toTested = (url: string) => {
      const parsed = new URL(url, origin);
      return parsed.origin === CANONICAL_ORIGIN ? `${origin}${parsed.pathname}${parsed.search}` : parsed.toString();
    };
    const isInternal = (url: URL) => url.origin === origin || url.origin === CANONICAL_ORIGIN;

    // robots.txt
    const robotsResponse = await fetch(`${origin}/robots.txt`);
    const robotsText = robotsResponse.ok ? await robotsResponse.text() : "";
    const robots = parseRobotsTxt(robotsText);
    const starGroup = robots.groups.find((group) => group.agents.includes("*"));
    const googleGroup = groupFor(robots.groups, "googlebot");
    if (!robotsResponse.ok) {
      findings.push({
        severity: "error",
        url: "/robots.txt",
        rule: "robots-txt",
        message: `Status ${robotsResponse.status}.`,
      });
    } else {
      if (!starGroup) {
        findings.push({
          severity: "error",
          url: "/robots.txt",
          rule: "robots-txt",
          message: "No `User-agent: *` group.",
        });
      }
      for (const crawler of CRAWLERS) {
        const group = groupFor(robots.groups, crawler);
        const paths = [...new Set(["/", ...publicPages.map((page) => page.path)])];
        const blocked = paths.filter((path) => !robotsAllows(group, path));
        if (blocked.length) {
          findings.push({
            severity: "error",
            url: "/robots.txt",
            rule: "robots-txt",
            message: `${crawler} may not crawl ${blocked.join(", ")}.`,
          });
        }
      }
      if (!robots.sitemaps.some((url) => sameUrl(url, `${CANONICAL_ORIGIN}/sitemap.xml`))) {
        findings.push({
          severity: "error",
          url: "/robots.txt",
          rule: "robots-txt",
          message: `No \`Sitemap: ${CANONICAL_ORIGIN}/sitemap.xml\` line.`,
        });
      }
    }

    // sitemap.xml
    const sitemapResponse = await fetch(`${origin}/sitemap.xml`);
    const sitemap = sitemapResponse.ok ? sitemapLocs(await sitemapResponse.text()) : [];
    if (!sitemapResponse.ok) {
      findings.push({
        severity: "error",
        url: "/sitemap.xml",
        rule: "sitemap",
        message: `Status ${sitemapResponse.status}.`,
      });
    }
    const listed = new Set<string>();
    for (const { loc, lastmod } of sitemap) {
      const add = (message: string) =>
        findings.push({ severity: "error", url: "/sitemap.xml", rule: "sitemap", message });
      if (!loc.startsWith(`${CANONICAL_ORIGIN}/`)) add(`${loc} is not on ${CANONICAL_ORIGIN}.`);
      if (/[#?]/.test(loc)) add(`${loc} has a query or fragment.`);
      const key = canonicalFor(new URL(loc).pathname);
      if (listed.has(key)) add(`${loc} is listed twice.`);
      listed.add(key);
      if (lastmod && (Number.isNaN(Date.parse(lastmod)) || Date.parse(lastmod) > Date.now() + 86_400_000)) {
        add(`${loc} has an invalid or future lastmod (${lastmod}).`);
      }
      if (!robotsAllows(googleGroup, new URL(loc).pathname)) add(`${loc} is disallowed by robots.txt.`);
    }

    // The build's own route list, when the tested server runs this build: every page route must be declared as
    // public (site.ts publicPages) or private (noindexPrefixes), and every static private route is visited.
    const manifestPath = resolve(root, ".next", "server", "app-paths-manifest.json");
    const builtRoutes: string[] = [];
    if (/^http:\/\/(localhost|127\.0\.0\.1)[:/]/.test(`${origin}/`) && existsSync(manifestPath)) {
      for (const key of Object.keys(JSON.parse(readFileSync(manifestPath, "utf8")))) {
        if (!key.endsWith("/page") || key.includes("[") || key.startsWith("/_")) continue;
        builtRoutes.push(key.slice(0, -"/page".length) || "/");
      }
      const declared = new Set(publicPages.map((page) => page.path));
      for (const route of builtRoutes) {
        if (!declared.has(route) && !isNoindexPath(route)) {
          findings.push({
            severity: "error",
            url: route,
            rule: "routes",
            message: "A page route is neither in publicPages nor under a noindex prefix (src/lib/site.ts).",
          });
        }
      }
    }

    // Crawl from the home page, following links; then the sitemap, the private routes and every built route.
    const queue = ["/", ...sitemap.map(({ loc }) => new URL(toTested(loc)).pathname), ...PRIVATE_SEEDS, ...builtRoutes];
    const seen = new Set<string>();
    const edges = new Map<string, Set<string>>(); // internal links between indexable pages
    const linkTargets = new Set<string>(); // every internal path some crawled page links to
    const idsByPath = new Map<string, Set<string>>();
    const fragmentLinks: { from: string; path: string; id: string }[] = [];
    const statusByPath = new Map<string, number>();
    const hrefs = new Map<string, string>(); // internal href as written (no fragment) → a page that has it
    const outbound = new Map<string, string>(); // external URL → a page that links to it
    while (queue.length && seen.size < maxPages) {
      const path = queue.shift() as string;
      if (seen.has(path)) continue;
      seen.add(path);
      const { facts } = await fetchPage(origin, path);
      statusByPath.set(path, facts.status);
      idsByPath.set(path, facts.ids);
      const add = (severity: Severity, rule: string, message: string) =>
        findings.push({ severity, url: path, rule, message });
      if (facts.status >= 300 && facts.status < 400) {
        if (facts.redirectedTo) {
          const target = new URL(facts.redirectedTo);
          if (isInternal(target) && !seen.has(target.pathname)) queue.push(target.pathname);
        }
        continue;
      }
      if (facts.status !== 200) {
        add("error", "status", `Status ${facts.status}.`);
        continue;
      }
      if (!facts.contentType.includes("text/html")) continue;
      const jsonLdTypes = checkPage(facts, add) ?? [];
      const indexable = !isNoindex(facts);
      const { ids: _ids, ...rest } = facts;
      pages.push({ ...rest, indexable, jsonLdTypes });
      if (indexable && !listed.has(canonicalFor(path)) && sitemap.length) {
        add("error", "sitemap", "An indexable page is missing from the sitemap.");
      }
      if (!indexable) continue; // Do not crawl onward from private pages.
      const targets = new Set<string>();
      edges.set(path, targets);
      for (const link of facts.links) {
        if (!link.href || /^(mailto:|tel:|javascript:)/i.test(link.href)) continue;
        const target = new URL(link.href, facts.url);
        if (!isInternal(target)) {
          if (/^https?:$/.test(target.protocol)) outbound.set(target.href.replace(/#.*$/, ""), path);
          continue;
        }
        const written = `${target.pathname}${target.search}`;
        if (!hrefs.has(written)) hrefs.set(written, path);
        const targetPath = target.pathname.length > 1 ? target.pathname.replace(/\/+$/, "") : target.pathname;
        if (target.hash.length > 1) {
          fragmentLinks.push({ from: path, path: targetPath, id: decodeURIComponent(target.hash.slice(1)) });
        }
        targets.add(targetPath);
        linkTargets.add(targetPath);
        if (!seen.has(targetPath)) queue.unshift(targetPath);
      }
    }

    for (const { from, path, id } of fragmentLinks) {
      const ids = idsByPath.get(path);
      if (ids && !ids.has(id)) {
        findings.push({
          severity: "error",
          url: from,
          rule: "links",
          message: `Link to ${path}#${id}: no element has that id.`,
        });
      }
    }
    // Every indexable page must be reachable from the home page through links, not only through the sitemap.
    const reachable = new Set<string>(["/"]);
    for (const path of reachable) for (const target of edges.get(path) ?? []) reachable.add(target);
    for (const page of pages.filter((candidate) => candidate.indexable)) {
      const path = new URL(page.url).pathname;
      if (!reachable.has(path)) {
        findings.push({
          severity: "error",
          url: path,
          rule: "links",
          message: "Orphan: no link path from the home page.",
        });
      }
    }
    for (const [path, status] of statusByPath) {
      if (status >= 400 && linkTargets.has(path)) {
        findings.push({
          severity: "error",
          url: path,
          rule: "links",
          message: `An internal link leads to status ${status}.`,
        });
      }
    }
    for (const { loc } of sitemap) {
      const path = new URL(loc).pathname;
      const page = pages.find((candidate) => new URL(candidate.url).pathname === path);
      if (page && !page.indexable) {
        findings.push({ severity: "error", url: "/sitemap.xml", rule: "sitemap", message: `${loc} is noindex.` });
      }
    }

    // Internal links must point at final URLs: a link that redirects costs a hop and a weaker signal.
    for (const [href, from] of hrefs) {
      const response = await fetch(`${origin}${href}`, { redirect: "manual" }).catch(() => null);
      if (response && response.status >= 300 && response.status < 400) {
        findings.push({
          severity: "error",
          url: from,
          rule: "links",
          message: `Link to ${href} redirects (${response.status}) to ${response.headers.get("location")}.`,
        });
      }
    }

    // Every image the public pages load must answer 200 with an image type: page images, icons, social and
    // structured-data images. An untracked file left out of a commit shows up here as a 404.
    const images = new Set(
      pages
        .filter((page) => page.indexable)
        .flatMap((page) => [
          page.meta["og:image"],
          page.meta["twitter:image"],
          ...page.assets,
          ...page.icons,
          ...page.jsonLd.flatMap((block) =>
            [...block.matchAll(/"(?:image|logo|screenshot)"\s*:\s*"(https?:\/\/[^"]+)"/g)].map((match) => match[1]),
          ),
        ])
        .map((url) => (url ? new URL(url, `${origin}/`).toString() : url)),
    );
    for (const image of images) {
      if (!image) continue;
      const response = await fetch(toTested(image), { method: "GET" }).catch(() => null);
      const type = response?.headers.get("content-type") ?? "";
      if (!response?.ok || !type.startsWith("image/")) {
        findings.push({
          severity: "error",
          url: image,
          rule: "images",
          message: `Image answered ${response?.status ?? "no response"} ${type}.`,
        });
      }
    }

    // Outbound links (with --external): a 404 or 410 is broken; bot protection (403, 429) cannot be judged.
    if (args.includes("--external")) {
      for (const [url, from] of outbound) {
        const response = await fetch(url, {
          headers: {
            "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36",
          },
          signal: AbortSignal.timeout(15_000),
        }).catch(() => null);
        const status = response?.status ?? 0;
        if (status === 404 || status === 410) {
          findings.push({ severity: "error", url: from, rule: "external", message: `${url} answered ${status}.` });
        } else if (!response || status >= 400) {
          findings.push({
            severity: "warning",
            url: from,
            rule: "external",
            message: `${url} could not be verified (${status || "no response"}).`,
          });
        }
      }
    }

    // Duplicate titles and descriptions across indexable pages.
    for (const key of ["titles", "descriptions"] as const) {
      const byValue = new Map<string, string[]>();
      for (const page of pages.filter((candidate) => candidate.indexable)) {
        const value = page[key][0];
        if (value) byValue.set(value, [...(byValue.get(value) ?? []), new URL(page.url).pathname]);
      }
      for (const [value, paths] of byValue) {
        if (paths.length > 1) {
          findings.push({
            severity: "error",
            url: paths.join(", "),
            rule: key === "titles" ? "title" : "description",
            message: `Duplicate ${key === "titles" ? "title" : "description"}: "${value.slice(0, 60)}".`,
          });
        }
      }
    }

    // An unknown URL must answer 404 with noindex, not a soft 404.
    const missing = await fetchPage(origin, MISSING_PATH);
    if (missing.facts.status !== 404) {
      findings.push({
        severity: "error",
        url: MISSING_PATH,
        rule: "status",
        message: `Unknown URL answered ${missing.facts.status}, not 404.`,
      });
    } else if (!isNoindex(missing.facts)) {
      findings.push({
        severity: "warning",
        url: MISSING_PATH,
        rule: "noindex",
        message: "The 404 page is not noindex.",
      });
    }
  } finally {
    if (child) stopBuild(child);
  }

  const errors = findings.filter((finding) => finding.severity === "error");
  const warnings = findings.filter((finding) => finding.severity === "warning");
  const indexable = pages.filter((page) => page.indexable);
  console.log(`SEO check · ${origin} · canonical ${CANONICAL_ORIGIN}`);
  console.log(
    `${pages.length} HTML pages crawled, ${indexable.length} indexable, ${pages.length - indexable.length} noindex`,
  );
  for (const page of indexable) {
    const path = new URL(page.url).pathname;
    const h1 = page.headings.find((heading) => heading.level === 1)?.text ?? "—";
    console.log(
      `  ${path}  "${page.titles[0] ?? ""}"  h1: "${h1.slice(0, 60)}"  ${page.words} words  ld: ${page.jsonLdTypes.join(", ") || "—"}`,
    );
  }
  for (const finding of [...errors, ...warnings]) {
    console.log(
      `${finding.severity === "error" ? "ERROR" : "warn "} ${finding.rule.padEnd(12)} ${finding.url}  ${finding.message}`,
    );
  }
  console.log(`${errors.length} errors, ${warnings.length} warnings`);
  if (jsonPath) {
    writeFileSync(jsonPath, `${JSON.stringify({ origin, canonical: CANONICAL_ORIGIN, pages, findings }, null, 2)}\n`);
  }
  process.exit(errors.length ? 1 : 0);
}

await main();
