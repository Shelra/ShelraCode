import type { Metadata } from "next";
import { IntegrationsView } from "@/components/dashboard/views/IntegrationsView";

export const metadata: Metadata = { title: "Integrations – ShelraCode" };

export default function IntegrationsPage() {
  return <IntegrationsView />;
}
