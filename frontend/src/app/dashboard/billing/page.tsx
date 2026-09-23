import type { Metadata } from "next";
import { BillingView } from "@/components/dashboard/views/BillingView";

export const metadata: Metadata = { title: "Billing – ShelraCode" };

export default function BillingPage() {
  return <BillingView />;
}
