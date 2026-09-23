import type { Metadata } from "next";
import { ReposView } from "@/components/dashboard/views/ReposView";

export const metadata: Metadata = { title: "Repositories – ShelraCode" };

export default function ReposPage() {
  return <ReposView />;
}
