import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/shared/loading-skeleton";
import { MachinesView } from "@/features/machines/machines-view";

export const metadata: Metadata = { title: "Machines" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <MachinesView />
    </Suspense>
  );
}
