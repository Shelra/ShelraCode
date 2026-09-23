import type { Metadata } from "next";
import { DocPage } from "@/components/doc/DocPage";
import { localGuide } from "@/lib/guides";
import { pageMetadata } from "@/lib/metadata";

export const metadata: Metadata = pageMetadata({
  path: localGuide.path,
  title: localGuide.title,
  description: localGuide.description,
});

export default function Page() {
  return <DocPage guide={localGuide} />;
}
