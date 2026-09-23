import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The frontend is nested in the shelra repository; keep Turbopack scoped to it.
  turbopack: {
    root: process.cwd(),
  },
  // The libSQL client loads a native binding; it must stay out of the server bundle.
  serverExternalPackages: ["@libsql/client", "libsql"],
};

export default nextConfig;
