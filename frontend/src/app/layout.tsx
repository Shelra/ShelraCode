import type { Metadata, Viewport } from "next";
import { SessionProvider } from "next-auth/react";
import type { ReactNode } from "react";
import { seo } from "@/lib/content";
import { socialImage } from "@/lib/metadata";
import { siteName, siteUrl } from "@/lib/site";
import "./globals.css";

// Search engine ownership checks, set per deployment (see docs/seo/README.md); a DNS record works too.
const verification: Metadata["verification"] = {
  google: process.env.GOOGLE_SITE_VERIFICATION || undefined,
  other: process.env.BING_SITE_VERIFICATION ? { "msvalidate.01": process.env.BING_SITE_VERIFICATION } : undefined,
};

// Defaults for every route. Indexable pages replace them with lib/metadata's pageMetadata; the private
// routes (dashboard, sign-in) set their own titles and noindex.
export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: seo.title, template: `%s – ${siteName}` },
  description: seo.description,
  applicationName: siteName,
  // A Google-only directive, so it never adds a second robots tag beside a page's noindex.
  robots: { googleBot: { "max-image-preview": "large" } },
  // With app/favicon.ico (16–256 px). Google's search favicon needs a raster at a multiple of 48 px: not the SVG.
  icons: {
    icon: [
      { url: "/images/favicon.svg", type: "image/svg+xml" },
      { url: "/images/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: "/images/apple-icon.png",
  },
  verification,
  openGraph: {
    type: "website",
    siteName,
    locale: "en_US",
    title: seo.title,
    description: seo.description,
    images: [socialImage],
  },
  twitter: {
    card: "summary_large_image",
    title: seo.title,
    description: seo.description,
    images: [socialImage.url],
  },
};

// Without JavaScript the entrance animations never run, so their starting styles (inline opacity 0 or 0.001, a
// transform, a blur) would hide most of the home page. Only then: show everything, open the FAQ answers and lay out
// every use case. Visitors with JavaScript are unaffected.
const noScriptStyle = `[style*="opacity:0;"],[style*="opacity:0.001"],[style$="opacity:0"]{opacity:1!important;transform:none!important;filter:none!important}[role="region"][inert]{height:auto!important}[role="tabpanel"][hidden]{display:grid!important}`;

export const viewport: Viewport = {
  width: "device-width",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <noscript>
          {/* biome-ignore lint/security/noDangerouslySetInnerHtml: a constant stylesheet, no user input */}
          <style dangerouslySetInnerHTML={{ __html: noScriptStyle }} />
        </noscript>
      </head>
      <body>
        {/* The session is fetched on the client so the marketing pages stay static. */}
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
