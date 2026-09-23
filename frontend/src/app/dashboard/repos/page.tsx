import type { Metadata } from "next";
import { ReposView } from "@/components/dashboard/views/ReposView";

export const metadata: Metadata = { title: "Repositories" };

export default function ReposPage() {
  return <ReposView />;
}
