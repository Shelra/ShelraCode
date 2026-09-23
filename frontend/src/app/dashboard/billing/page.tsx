import type { Metadata } from "next";
import { BillingView } from "@/components/dashboard/views/BillingView";

export const metadata: Metadata = { title: "Billing" };

export default function BillingPage() {
  return <BillingView />;
}
