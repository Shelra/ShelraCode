import type { Metadata } from "next";
import { TeamView } from "@/components/dashboard/views/TeamView";

export const metadata: Metadata = { title: "Team" };

export default function TeamPage() {
  return <TeamView />;
}
