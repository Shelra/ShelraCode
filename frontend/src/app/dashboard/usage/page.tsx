import type { Metadata } from "next";
import { UsageView } from "@/components/dashboard/views/UsageView";

export const metadata: Metadata = { title: "Usage – ShelraCode" };

export default function UsagePage() {
  return <UsageView />;
}
