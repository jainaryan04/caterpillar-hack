"use client";

import Link from "next/link";
import { Map } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MetaDot, PageHeader } from "@/components/shared/page-header";
import { PageContainer } from "@/components/shared/page-container";
import { formatDate, formatDuration } from "@/lib/format";
import {
  useAlerts,
  useLookup,
  useMachines,
  useOperators,
  useRunSummary,
  useSite,
  useTasks,
  useZones,
} from "@/hooks/use-fleet-data";
import { AttentionQueue } from "./attention-queue";
import { UtilizationChart, WorkloadChart } from "./dashboard-charts";
import { FleetOverview } from "./fleet-overview";
import { KpiRow } from "./kpi-row";
import { MachineStatusPanel } from "./machine-status-panel";
import { RecentActivity } from "./recent-activity";
import { SchedulePanel } from "./schedule-panel";

/** Operations overview — spec §5.1: "Is my operation healthy, and what needs me?" */
export function DashboardView() {
  const { data: machines } = useMachines();
  const { data: operators } = useOperators();
  const { data: tasks } = useTasks();
  const { data: alerts } = useAlerts();
  const { data: zones } = useZones();
  const { data: run } = useRunSummary();
  const lookup = useLookup();
  const site = useSite();

  return (
    <PageContainer className="flex flex-col gap-4 lg:gap-5">
      <PageHeader
        title="Operations overview"
        className="pb-0"
        description={
          <>
            <span>{site}</span>
            {run ? (
              <>
                <MetaDot />
                <span>
                  Plan from {formatDate(run.horizon_start)} ·{" "}
                  <span className="tabular-nums">{formatDuration(run.makespan_min)}</span> makespan
                </span>
              </>
            ) : null}
          </>
        }
        actions={
          <Button asChild variant="secondary">
            <Link href="/map">
              <Map /> Live map
            </Link>
          </Button>
        }
      />

      <KpiRow machines={machines} operators={operators} tasks={tasks} alerts={alerts} />

      <div className="grid gap-4 lg:gap-5 xl:grid-cols-12">
        <div className="min-w-0 xl:col-span-7">
          <AttentionQueue machines={machines} operators={operators} tasks={tasks} alerts={alerts} lookup={lookup} />
        </div>
        <div className="min-w-0 xl:col-span-5">
          <FleetOverview machines={machines} operators={operators} zones={zones} alerts={alerts} />
        </div>

        <div className="min-w-0 xl:col-span-12">
          <SchedulePanel tasks={tasks} operators={operators} />
        </div>

        <div className="min-w-0 xl:col-span-8">
          <UtilizationChart />
        </div>
        <div className="min-w-0 xl:col-span-4">
          <MachineStatusPanel machines={machines} />
        </div>

        <div className="min-w-0 xl:col-span-5">
          <RecentActivity alerts={alerts} tasks={tasks} />
        </div>
        <div className="min-w-0 xl:col-span-7">
          <WorkloadChart />
        </div>
      </div>
    </PageContainer>
  );
}
