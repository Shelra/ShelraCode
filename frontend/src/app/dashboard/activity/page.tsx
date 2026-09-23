import type { Metadata } from "next";
import { ActivityView } from "@/components/dashboard/views/ActivityView";

export const metadata: Metadata = { title: "Activity – ShelraCode" };

export default function ActivityPage() {
  return <ActivityView />;
}
