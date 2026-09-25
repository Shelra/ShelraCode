import type { NextConfig } from "next";
import { appEnabled } from "./src/lib/features";
import { siteUrl } from "./src/lib/site";

// The web app's routes while it is hidden (src/lib/features.ts). The pages refuse too; routing them away first
// gives the plain 404 page, whose title does not name what is behind it.
const hiddenAppRoutes = ["/login", "/signup", "/account", "/dashboard", "/dashboard/:path*", "/api/auth/:path*"];

const nextConfig: NextConfig = {
  // The frontend is nested in the shelra repository; keep Turbopack scoped to it.
  turbopack: {
    root: process.cwd(),
  },
  // The libSQL client loads a native binding; it must stay out of the server bundle.
  serverExternalPackages: ["@libsql/client", "libsql"],
  async headers() {
    return [
      {
        // The Windows installer (`irm https://www.shelra.dev/install.ps1 | iex`): served as text so PowerShell
        // pipes it as a string, and cached briefly so a new version reaches everyone within minutes.
        source: "/install.ps1",
        headers: [
          { key: "Content-Type", value: "text/plain; charset=utf-8" },
          { key: "Cache-Control", value: "public, max-age=300, must-revalidate" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
    ];
  },
  async rewrites() {
    if (appEnabled) return [];
    return {
      beforeFiles: hiddenAppRoutes.map((source) => ({ source, destination: "/__not-found" })),
      afterFiles: [],
      fallback: [],
    };
  },
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
