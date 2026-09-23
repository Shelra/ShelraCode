import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/site";

// Every crawler may read every page. The private routes stay crawlable on purpose: they carry noindex, and a
// crawler blocked here could never read it. Only the API is closed.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: "/api/" },
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}
