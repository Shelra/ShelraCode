import type { Metadata } from "next";
import { DocPage } from "@/components/doc/DocPage";
import { freeModelsGuide } from "@/lib/guides";
import { pageMetadata } from "@/lib/metadata";

export const metadata: Metadata = pageMetadata({
  path: freeModelsGuide.path,
  title: freeModelsGuide.title,
  description: freeModelsGuide.description,
});

export default function Page() {
  return <DocPage guide={freeModelsGuide} />;
}
