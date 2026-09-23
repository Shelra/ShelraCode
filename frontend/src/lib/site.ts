// Where the website lives and which of its pages search engines may index: the single source for
// canonical URLs, the sitemap, structured data and the SEO check (scripts/seo-check.ts).
import bench from "./bench-summary.json";

/**
 * The production origin (the repository's homepage; `shelra.dev` redirects to it). Every canonical URL,
 * sitemap entry and social image points here, whichever host served the page, so a deployment's own
 * `*.vercel.app` address never competes with it.
 */
export const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.shelra.dev").replace(/\/+$/, "");

export const siteName = "ShelraCode";

/** Paths that must never be indexed: the app, the sign-in pages and the API. */
export const noindexPrefixes = ["/dashboard", "/login", "/signup", "/account", "/api"];

export type PublicPage = {
  path: string;
  /** Date of the last substantive change to the page's content (ISO), for the sitemap's lastmod. */
  updated: string;
};

// Pages that show run data change when `bun run bench:sync` imports new runs: their date follows the data.
const latest = (...dates: string[]) => [...dates].sort().at(-1) as string;

/** Every indexable page. The sitemap lists exactly these and the SEO check fails on any other. */
export const publicPages: PublicPage[] = [
  { path: "/", updated: latest("2026-09-23", bench.updatedAt) },
  { path: "/memory", updated: latest("2026-09-23", bench.updatedAt) },
  { path: "/local", updated: "2026-09-23" },
  { path: "/free-models", updated: latest("2026-09-23", bench.updatedAt) },
];

/** The absolute URL of a path on the production origin. */
export function absoluteUrl(path: string): string {
  return path === "/" ? `${siteUrl}/` : `${siteUrl}${path}`;
}
