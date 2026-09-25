import type { Metadata } from "next";
import { NotFoundView } from "@/components/layout/NotFoundView";
import { SiteFrame } from "@/components/layout/SiteFrame";

// Next adds noindex to every 404; the title says what the page is instead of repeating the home page's.
export const metadata: Metadata = {
  title: "Page not found",
  description: "This page does not exist on the ShelraCode website.",
};

export default function NotFound() {
  return (
    <SiteFrame showFinalCta={false}>
      <NotFoundView />
    </SiteFrame>
  );
}
