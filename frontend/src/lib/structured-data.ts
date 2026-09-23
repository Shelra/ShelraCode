import { links, seo } from "./content";
import { socialImage } from "./metadata";
import { absoluteUrl, siteName, siteUrl } from "./site";

// Schema.org entities for search engines and answer engines. Only facts the pages show: no ratings, reviews or
// numbers (Google's structured data policies; the site has no real reviews to mark up).

const ids = {
  website: `${siteUrl}/#website`,
  software: `${siteUrl}/#software`,
  source: `${siteUrl}/#source`,
  author: `${siteUrl}/#author`,
};

const mitLicense = "https://opensource.org/license/mit";

/** The home page's graph: the website (its name in results), the software, its source code and its author. */
export function homeGraph() {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": ids.website,
        url: absoluteUrl("/"),
        name: siteName,
        alternateName: ["Shelra", "Shelra Code"],
        description: seo.description,
        inLanguage: "en",
        publisher: { "@id": ids.author },
        about: { "@id": ids.software },
      },
      {
        "@type": "SoftwareApplication",
        "@id": ids.software,
        name: siteName,
        alternateName: "shelra",
        description: seo.description,
        url: absoluteUrl("/"),
        applicationCategory: "DeveloperApplication",
        applicationSubCategory: "AI coding agent",
        operatingSystem: "Windows, macOS, Linux",
        softwareRequirements: "Bun",
        isAccessibleForFree: true,
        license: mitLicense,
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
        installUrl: links.install,
        image: absoluteUrl(socialImage.url),
        screenshot: absoluteUrl("/images/tui-hero.png"),
        author: { "@id": ids.author },
        sameAs: [links.github],
      },
      {
        "@type": "SoftwareSourceCode",
        "@id": ids.source,
        name: `${siteName} source code`,
        codeRepository: links.github,
        programmingLanguage: "TypeScript",
        runtimePlatform: "Bun",
        license: mitLicense,
        targetProduct: { "@id": ids.software },
        author: { "@id": ids.author },
      },
      {
        "@type": "Person",
        "@id": ids.author,
        name: "yosoyjavieruiz",
        url: links.author,
        sameAs: [links.author],
      },
    ],
  };
}

/**
 * A guide page's graph: the page, its breadcrumb (the one the page shows), and a minimal node for the site.
 */
export function guideGraph(guide: { path: string; name: string; title: string; description: string }) {
  const url = absoluteUrl(guide.path);
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        "@id": `${url}#webpage`,
        url,
        name: `${guide.title} – ${siteName}`,
        description: guide.description,
        inLanguage: "en",
        isPartOf: { "@id": ids.website },
        about: { "@id": ids.software },
        breadcrumb: { "@id": `${url}#breadcrumb` },
      },
      {
        "@type": "BreadcrumbList",
        "@id": `${url}#breadcrumb`,
        itemListElement: [
          { "@type": "ListItem", position: 1, name: siteName, item: absoluteUrl("/") },
          { "@type": "ListItem", position: 2, name: guide.name, item: url },
        ],
      },
      // The site node only: a SoftwareApplication node here would be judged for the software rich result, which it
      // cannot meet (no ratings exist); `about` above references the full node on the home page by its @id.
      { "@type": "WebSite", "@id": ids.website, url: absoluteUrl("/"), name: siteName },
    ],
  };
}
