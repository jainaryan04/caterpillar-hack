"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { MachineChip } from "@/components/shared/entity-chip";
import { SectionCard } from "@/components/shared/section-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { TableSkeleton } from "@/components/shared/loading-skeleton";
import { engineTempTone, machineStatusMeta, toneClasses } from "@/lib/status";
import { ENGINE_TEMP } from "@/lib/mock/machines";
import type { Machine, MachineStatus } from "@/lib/types";

const ORDER: MachineStatus[] = ["operating", "idle", "fault", "maintenance", "offline"];

/**
 * Fleet status distribution + machines needing a look — spec §5.1.
 * Segments are links that filter the machines list.
 */
export function MachineStatusPanel({ machines }: { machines?: Machine[] }) {
  const counts = ORDER.map((s) => ({ status: s, count: machines?.filter((m) => m.status === s).length ?? 0 }));
  const total = machines?.length ?? 0;

  const watch = (machines ?? [])
    .filter((m) => m.status === "fault" || m.engineTempC >= ENGINE_TEMP.elevated || m.status === "maintenance")
    .sort((a, b) => b.engineTempC - a.engineTempC)
    .slice(0, 5);

  let offset = 0;

  return (
    <SectionCard
      title="Machine status"
      subtitle={machines ? `${total} machines on site` : undefined}
      action={
        <Button asChild variant="ghost" size="sm">
          <Link href="/machines">
            All machines <ArrowRight />
          </Link>
        </Button>
      }
      className="h-full"
      bodyClassName="flex flex-col gap-4"
    >
      {!machines ? (
        <TableSkeleton rows={5} columns={2} />
      ) : (
        <>
          <svg viewBox="0 0 100 4" preserveAspectRatio="none" className="h-2.5 w-full overflow-hidden rounded-sm" role="img" aria-label="Machine status distribution">
            {counts.map(({ status, count }) => {
              const w = total ? (count / total) * 100 : 0;
              const x = offset;
              offset += w;
              const tone = machineStatusMeta[status].tone;
              return (
                <rect
                  key={status}
                  x={x}
                  y={0}
                  width={Math.max(0, w - 0.4)}
                  height={4}
                  className={cn(
                    toneClasses[tone].text,
                    status === "offline" ? "fill-disabled-foreground" : "fill-current",
                  )}
                />
              );
            })}
          </svg>

          <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3 xl:grid-cols-2 2xl:grid-cols-3">
            {counts.map(({ status, count }) => (
              <li key={status}>
                <Link
                  href={`/machines?status=${status}`}
                  className="flex items-center justify-between gap-2 rounded-md px-1.5 py-1 hover:bg-raised"
                >
                  <StatusBadge meta={machineStatusMeta[status]} variant="plain" size="sm" />
                  <span className="font-mono text-small tabular-nums">{count}</span>
                </Link>
              </li>
            ))}
          </ul>

          <div className="flex flex-col gap-1">
            <h3 className="eyebrow">Watch list</h3>
            <ul className="divide-y">
              {watch.map((m) => {
                const tempTone = engineTempTone(m.engineTempC, ENGINE_TEMP);
                return (
                  <li key={m.id}>
                    <Link
                      href={`/machines?machine=${m.id}`}
                      className="flex items-center justify-between gap-3 py-2 hover:bg-raised/50"
                    >
                      <MachineChip machine={m} size="sm" />
                      <span className="flex items-center gap-3">
                        {tempTone ? (
                          <span className={cn("font-mono text-small tabular-nums", toneClasses[tempTone].text)}>
                            {m.engineTempC} °C
                          </span>
                        ) : null}
                        <StatusBadge meta={machineStatusMeta[m.status]} size="sm" />
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      )}
    </SectionCard>
  );
}
