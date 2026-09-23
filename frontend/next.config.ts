import type { NextConfig } from "next";
import { siteUrl } from "./src/lib/site";

const nextConfig: NextConfig = {
  // The frontend is nested in the shelra repository; keep Turbopack scoped to it.
  turbopack: {
    root: process.cwd(),
  },
  // The libSQL client loads a native binding; it must stay out of the server bundle.
  serverExternalPackages: ["@libsql/client", "libsql"],
  async redirects() {
    // Only in a Vercel production build: previews and local builds keep their own addresses.
    if (process.env.VERCEL_ENV !== "production") return [];
    return [
      {
        // A deployment's *.vercel.app addresses serve the same pages as the site, as duplicates search engines
        // would have to choose between; send them to it. Requests that came through Cloudflare, which fronts
        // www.shelra.dev, carry cf-ray and are never redirected, so a proxy forwarding that host cannot loop.
        source: "/:path*",
        has: [{ type: "host", value: ".*\\.vercel\\.app" }],
        missing: [{ type: "header", key: "cf-ray" }],
        destination: `${siteUrl}/:path*`,
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
