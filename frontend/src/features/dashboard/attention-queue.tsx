"use client";

import Link from "next/link";
import { ArrowRight, OctagonAlert, Siren, Thermometer, TriangleAlert, UserRound } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { RelativeTime } from "@/components/shared/relative-time";
import { SectionCard } from "@/components/shared/section-card";
import { TableSkeleton } from "@/components/shared/loading-skeleton";
import { useAlertStore } from "@/stores/alert-store";
import type { EntityLookup } from "@/hooks/use-fleet-data";
import { ENGINE_TEMP } from "@/lib/mock/machines";
import { FATIGUE } from "@/lib/mock/operators";
import { addMinutes } from "@/lib/format";
import type { Machine, Operator, SafetyAlert, Task } from "@/lib/types";

type Rank = 0 | 1 | 2 | 3;

interface Item {
  key: string;
  rank: Rank;
  icon: typeof Siren;
  iconClass: string;
  title: string;
  detail: string;
  at?: string;
  action: { label: string; href?: string; onClick?: () => void; critical?: boolean };
}

interface AttentionQueueProps {
  machines?: Machine[];
  operators?: Operator[];
  tasks?: Task[];
  alerts?: SafetyAlert[];
  lookup: EntityLookup;
}

/**
 * "What needs me" — spec §5.1. SOS first, then failures, delays and threshold
 * breaches. Inline actions so common responses don't need a page change.
 */
export function AttentionQueue({ machines, operators, tasks, alerts, lookup }: AttentionQueueProps) {
  const setStatus = useAlertStore((s) => s.setStatus);
  const loading = !machines || !operators || !tasks || !alerts;

  const items: Item[] = loading
    ? []
    : [
        ...alerts
          .filter((a) => a.status !== "resolved" && a.category !== "incident")
          .map<Item>((a) => {
            const open = a.status === "open";
            const sos = a.category === "emergency";
            return {
              key: a.id,
              rank: sos && open ? 0 : sos ? 1 : a.severity === "high" || a.severity === "critical" ? 1 : 2,
              icon: sos ? Siren : a.severity === "high" ? OctagonAlert : TriangleAlert,
              iconClass: sos || a.severity === "high" ? "text-danger" : "text-warning",
              title: `${sos ? "SOS · " : ""}${a.title}`,
              detail: [lookup.operator(a.operatorId)?.name, a.machineId, lookup.zone(a.zoneId)?.name]
                .filter(Boolean)
                .join(" · "),
              at: a.raisedAt,
              action:
                open && sos
                  ? {
                      label: "Acknowledge",
                      critical: true,
                      onClick: () => {
                        setStatus(a.id, "acknowledged", "Acknowledged");
                        toast.success(`${a.id} acknowledged`);
                      },
                    }
                  : { label: "View", href: `/safety?event=${a.id}` },
            };
          }),
        ...tasks
          .filter((t) => t.status === "delayed")
          .map<Item>((t) => ({
            key: t.id,
            rank: 2,
            icon: TriangleAlert,
            iconClass: "text-warning",
            title: `${t.id} delayed · ${t.title}`,
            detail: [t.machineId, lookup.operator(t.operatorId)?.name, t.notes].filter(Boolean).join(" · "),
            at: t.start ? addMinutes(t.start, t.durationMin) : undefined,
            action: { label: "Reschedule", href: `/tasks?task=${t.id}` },
          })),
        ...machines
          .filter((m) => m.engineTempC >= ENGINE_TEMP.elevated && m.status !== "fault")
          .map<Item>((m) => ({
            key: `temp-${m.id}`,
            rank: 2,
            icon: Thermometer,
            iconClass: m.engineTempC > ENGINE_TEMP.critical ? "text-danger" : "text-warning",
            title: `${m.id} engine ${m.engineTempC} °C`,
            detail: `${m.model} · threshold ${ENGINE_TEMP.elevated} °C`,
            at: m.lastSeen,
            action: { label: "View", href: `/machines?machine=${m.id}` },
          })),
        ...operators
          .filter((o) => o.fatigue >= FATIGUE.high)
          .map<Item>((o) => ({
            key: `fatigue-${o.id}`,
            rank: 3,
            icon: UserRound,
            iconClass: "text-danger",
            title: `${o.name} fatigue ${o.fatigue}`,
            detail: `${o.hoursWorked.toFixed(1)} h this shift · ${o.hoursThisWeek} h this week`,
            action: { label: "View", href: `/operators?operator=${o.id}` },
          })),
      ]
        .filter((it) => !(it.key.startsWith("temp-") && alerts.some((a) => `temp-${a.machineId}` === it.key)))
        .sort((a, b) => a.rank - b.rank || (a.at ?? "").localeCompare(b.at ?? ""));

  const visible = items.slice(0, 7);

  return (
    <SectionCard
      title="Needs attention"
      subtitle={loading ? undefined : `${items.length} open items, most severe first`}
      action={
        <Button asChild variant="ghost" size="sm">
          <Link href="/safety">
            View all <ArrowRight />
          </Link>
        </Button>
      }
      bodyClassName="p-0"
      className="h-full"
    >
      {loading ? (
        <TableSkeleton rows={6} columns={2} />
      ) : visible.length === 0 ? (
        <EmptyState variant="clear" title="All clear" description="No open alerts, delays or threshold breaches." />
      ) : (
        <ul className="divide-y">
          {visible.map((it) => (
            <li
              key={it.key}
              className={cn(
                "flex items-center gap-3 px-4 py-2.5",
                it.rank === 0 && "border-l-2 border-l-danger bg-danger/[0.06] pl-3.5",
              )}
            >
              <it.icon className={cn("size-4 shrink-0", it.iconClass)} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="truncate text-small font-medium">{it.title}</p>
                <p className="truncate text-caption text-muted-foreground">{it.detail}</p>
              </div>
              {it.at ? <RelativeTime iso={it.at} className="hidden shrink-0 text-caption text-muted-foreground sm:block" /> : null}
              {it.action.href ? (
                <Button asChild variant="secondary" size="sm" className="shrink-0">
                  <Link href={it.action.href}>{it.action.label}</Link>
                </Button>
              ) : (
                <Button
                  variant={it.action.critical ? "critical" : "secondary"}
                  size="sm"
                  className="shrink-0"
                  onClick={it.action.onClick}
                >
                  {it.action.label}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
