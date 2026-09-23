import type { Metadata } from "next";
import { MissionsView } from "@/components/dashboard/views/MissionsView";

export const metadata: Metadata = { title: "Missions – ShelraCode" };

export default function MissionsPage() {
  return <MissionsView />;
}
