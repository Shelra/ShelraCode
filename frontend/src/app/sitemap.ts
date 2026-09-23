import type { MetadataRoute } from "next";
import { absoluteUrl, publicPages } from "@/lib/site";

// Exactly the indexable pages, with the date their content last changed. No priority or changefreq: Google
// ignores both.
export default function sitemap(): MetadataRoute.Sitemap {
  return publicPages.map((page) => ({ url: absoluteUrl(page.path), lastModified: page.updated }));
}
