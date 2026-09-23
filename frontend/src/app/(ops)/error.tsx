"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/shared/error-state";
import { PageContainer } from "@/components/shared/page-container";

export default function OpsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <PageContainer>
      <div className="rounded-lg border bg-panel">
        <ErrorState
          title="This page couldn't be loaded"
          description="Something went wrong while rendering this screen. The rest of the app is still available."
          errorId={error.digest}
          onRetry={reset}
        />
        <div className="flex justify-center pb-8">
          <Button asChild variant="ghost" size="sm">
            <Link href="/dashboard">Go to Dashboard</Link>
          </Button>
        </div>
      </div>
    </PageContainer>
  );
}
