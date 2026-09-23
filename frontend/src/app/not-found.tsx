import Link from "next/link";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas p-6">
      <div className="w-full max-w-md rounded-lg border bg-panel">
        <EmptyState
          title="Page not found"
          description="This page doesn't exist or was moved."
          action={
            <Button asChild>
              <Link href="/dashboard">Go to Dashboard</Link>
            </Button>
          }
        />
      </div>
    </div>
  );
}
