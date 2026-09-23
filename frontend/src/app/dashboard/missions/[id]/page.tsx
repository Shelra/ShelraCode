import type { Metadata } from "next";
import { MissionDetailView } from "@/components/dashboard/views/MissionDetailView";

export const metadata: Metadata = { title: "Mission" };

export default async function MissionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <MissionDetailView id={id} />;
}
