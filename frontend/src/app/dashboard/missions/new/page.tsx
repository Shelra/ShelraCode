import type { Metadata } from "next";
import { Suspense } from "react";
import { NewMissionView } from "@/components/dashboard/views/NewMissionView";

export const metadata: Metadata = { title: "New mission – ShelraCode" };

// The view reads the query string (prefilled prompt), which needs a Suspense boundary.
export default function NewMissionPage() {
  return (
    <Suspense fallback={null}>
      <NewMissionView />
    </Suspense>
  );
}
