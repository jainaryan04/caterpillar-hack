import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

/** Layout-matching skeletons — spec §18. Never a full-page spinner. */

export function KpiRowSkeleton({ count = 6, className }: { count?: number; className?: string }) {
  return (
    <div className={cn("grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6", className)}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex min-h-28 flex-col justify-between rounded-lg border bg-panel p-4">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-3 w-full" />
        </div>
      ))}
    </div>
  );
}

export function TableSkeleton({ rows = 8, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div className="divide-y" aria-busy aria-label="Loading table">
      <div className="flex h-9 items-center gap-6 px-3">
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={i} className="h-2.5 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex h-11 items-center gap-6 px-3">
          {Array.from({ length: columns }).map((_, c) => (
            <Skeleton key={c} className={cn("h-3 flex-1", c === 0 && "flex-[1.6]")} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function ChartSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("relative h-64 overflow-hidden rounded-md bg-inset", className)} aria-busy aria-label="Loading chart">
      <div className="absolute inset-x-4 top-1/4 border-t border-dashed" />
      <div className="absolute inset-x-4 top-2/4 border-t border-dashed" />
      <div className="absolute inset-x-4 top-3/4 border-t border-dashed" />
      <Skeleton className="absolute inset-x-4 bottom-4 h-1/3 opacity-60" />
    </div>
  );
}

export function CardGridSkeleton({ count = 6, className }: { count?: number; className?: string }) {
  return (
    <div className={cn("grid gap-4 sm:grid-cols-2 xl:grid-cols-3", className)}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex h-44 flex-col gap-3 rounded-lg border bg-panel p-4">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-3 w-1/3" />
          <div className="mt-auto grid grid-cols-3 gap-3">
            <Skeleton className="h-8" />
            <Skeleton className="h-8" />
            <Skeleton className="h-8" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy aria-label="Loading page">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-80" />
      </div>
      <KpiRowSkeleton count={4} className="xl:grid-cols-4" />
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="rounded-lg border bg-panel p-4 xl:col-span-2">
          <ChartSkeleton />
        </div>
        <div className="rounded-lg border bg-panel">
          <TableSkeleton rows={5} columns={2} />
        </div>
      </div>
    </div>
  );
}
