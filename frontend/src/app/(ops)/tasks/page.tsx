import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/shared/loading-skeleton";
import { TasksView } from "@/features/tasks/tasks-view";

export const metadata: Metadata = { title: "Tasks" };

export default function TasksPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <TasksView />
    </Suspense>
  );
}
