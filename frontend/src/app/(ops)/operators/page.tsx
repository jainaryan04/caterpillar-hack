import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/shared/loading-skeleton";
import { OperatorsView } from "@/features/operators/operators-view";

export const metadata: Metadata = { title: "Operators" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <OperatorsView />
    </Suspense>
  );
}
