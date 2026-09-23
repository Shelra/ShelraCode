import type { Metadata } from "next";
import { ApiKeysView } from "@/components/dashboard/views/ApiKeysView";

export const metadata: Metadata = { title: "API keys – ShelraCode" };

export default function ApiKeysPage() {
  return <ApiKeysView />;
}
