import { PageContainer } from "@/components/shared/page-container";
import { PageSkeleton } from "@/components/shared/loading-skeleton";

export default function Loading() {
  return (
    <PageContainer>
      <PageSkeleton />
    </PageContainer>
  );
}
