import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/shared/loading-skeleton";
import { SafetyView } from "@/features/safety/safety-view";

export const metadata: Metadata = { title: "Safety & SOS" };

export default function SafetyPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <SafetyView />
    </Suspense>
  );
}
