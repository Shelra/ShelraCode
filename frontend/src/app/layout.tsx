import type { Metadata, Viewport } from "next";
import { SessionProvider } from "next-auth/react";
import type { ReactNode } from "react";
import { seo } from "@/lib/content";
import "./globals.css";

export const metadata: Metadata = {
  title: seo.title,
  description: seo.description,
  robots: "max-image-preview:large",
  icons: { icon: "/images/favicon.svg" },
  openGraph: {
    type: "website",
    title: seo.title,
    description: seo.description,
    images: [{ url: seo.socialImage, width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: seo.title,
    description: seo.description,
    images: [seo.socialImage],
  },
};

export const viewport: Viewport = {
  width: "device-width",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-US">
      <body>
        {/* The session is fetched on the client so the marketing pages stay static. */}
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
