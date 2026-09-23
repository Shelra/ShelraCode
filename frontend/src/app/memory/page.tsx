import type { Metadata } from "next";
import { DocPage } from "@/components/doc/DocPage";
import { memoryGuide } from "@/lib/guides";
import { pageMetadata } from "@/lib/metadata";

export const metadata: Metadata = pageMetadata({
  path: memoryGuide.path,
  title: memoryGuide.title,
  description: memoryGuide.description,
});

export default function Page() {
  return <DocPage guide={memoryGuide} />;
}
