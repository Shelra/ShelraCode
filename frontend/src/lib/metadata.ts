import type { Metadata } from "next";
import { siteName } from "./site";

// Metadata segments merge shallowly: a page that sets `openGraph` replaces the layout's whole object, and a
// page that does not inherits the home page's title. Every public page therefore builds its complete set here.

export const socialImage = {
  url: "/images/og-shelra.png",
  width: 1200,
  height: 630,
  alt: "ShelraCode, the terminal coding agent",
};

type PageMeta = {
  /** Path on the site, used for the canonical URL and og:url. */
  path: string;
  /** Page title without the site name, unless `absoluteTitle` is set. */
  title: string;
  description: string;
  /** Use `title` as the whole title (the home page), not "title – ShelraCode". */
  absoluteTitle?: boolean;
};

/** Title, description, canonical URL and social cards for an indexable page. */
export function pageMetadata({ path, title, description, absoluteTitle = false }: PageMeta): Metadata {
  const fullTitle = absoluteTitle ? title : `${title} – ${siteName}`;
  return {
    title: { absolute: fullTitle },
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      url: path,
      siteName,
      locale: "en_US",
      title: fullTitle,
      description,
      images: [socialImage],
    },
    twitter: { card: "summary_large_image", title: fullTitle, description, images: [socialImage.url] },
  };
}
