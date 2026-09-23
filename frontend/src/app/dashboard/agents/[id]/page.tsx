import type { Metadata } from "next";
import { AgentDetailView } from "@/components/dashboard/views/AgentsView";

export const metadata: Metadata = { title: "Agent – ShelraCode" };

export default async function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AgentDetailView id={id} />;
}
