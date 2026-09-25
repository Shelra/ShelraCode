import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { DashboardShell } from "@/components/dashboard/Shell";
import { appEnabled } from "@/lib/features";

export const metadata: Metadata = {
  title: "Dashboard",
  robots: { index: false, follow: false },
};

// Every /dashboard page shares the shell; the data is simulated in the browser (see lib/demo).
export default function DashboardLayout({ children }: { children: ReactNode }) {
  if (!appEnabled) notFound();
  return <DashboardShell>{children}</DashboardShell>;
}
