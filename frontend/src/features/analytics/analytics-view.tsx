"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CHART, ChartLegend } from "@/components/charts/chart-primitives";
import { KpiCard } from "@/components/shared/kpi-card";
import { PageHeader } from "@/components/shared/page-header";
import { PageContainer } from "@/components/shared/page-container";
import { SectionCard } from "@/components/shared/section-card";
import { SegmentedControl } from "@/components/shared/segmented-control";
import { useOperators } from "@/hooks/use-fleet-data";
import {
  completionByComplexity,
  dailySeries,
  durationStats,
  operatorProductivity,
  tasksByType,
  utilizationByMachineType,
} from "@/lib/mock/analytics";
import { formatDuration } from "@/lib/format";
import { complexityLabel, machineTypeLabel, taskTypeLabel } from "@/lib/status";
import {
  CompletionChart,
  DurationChart,
  ProductivityChart,
  UtilizationHoursChart,
  UtilizationTrendChart,
} from "./analytics-charts";
import { BreakdownList } from "./breakdown-list";

type Range = "7" | "14" | "30";

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const avg = (xs: number[]) => (xs.length ? sum(xs) / xs.length : 0);

function TabLayout({ kpis, chart, breakdown, footer }: { kpis: ReactNode; chart: ReactNode; breakdown: ReactNode; footer?: ReactNode }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">{kpis}</div>
      <div className="grid gap-4 xl:grid-cols-12">
        <div className="xl:col-span-8">{chart}</div>
        <div className="xl:col-span-4">{breakdown}</div>
      </div>
      {footer}
    </div>
  );
}

/** Analytics — spec §5.8: trends for planning decisions. */
export function AnalyticsView() {
  const { data: operators } = useOperators();
  const [range, setRange] = useState<Range>("30");
  const [compare, setCompare] = useState(false);

  const data = useMemo(() => dailySeries.slice(-Number(range)), [range]);
  const completed = sum(data.map((d) => d.tasksCompleted));
  const prevCompleted = sum(data.map((d) => d.prevTasksCompleted));
  const late = sum(data.map((d) => d.late));
  const cancelled = sum(data.map((d) => d.cancelled));
  const utilization = avg(data.map((d) => d.utilization));
  const prevUtil = avg(data.map((d) => d.prevUtilization));
  const onTimeRate = completed ? ((completed - late) / completed) * 100 : 0;
  const pct = (a: number, b: number) => (b ? Math.round(((a - b) / b) * 100) : 0);

  return (
    <PageContainer className="flex flex-col gap-4">
      <PageHeader
        title="Analytics"
        className="pb-1"
        description={`Pit 3 North · last ${range} days`}
        actions={
          <>
            <SegmentedControl
              ariaLabel="Date range"
              value={range}
              onChange={setRange}
              options={[
                { value: "7", label: "7d" },
                { value: "14", label: "14d" },
                { value: "30", label: "30d" },
              ]}
            />
            <div className="flex h-9 items-center gap-2 rounded-md border bg-inset px-3">
              <Switch id="compare" checked={compare} onCheckedChange={setCompare} />
              <Label htmlFor="compare" className="text-small">
                Compare
              </Label>
            </div>
            <Button variant="secondary" onClick={() => toast.info("Export arrives with the analytics API")}>
              <Download /> Export
            </Button>
          </>
        }
      />

      <Tabs defaultValue="productivity" className="gap-4">
        <TabsList variant="line" className="h-10 w-full justify-start gap-4 overflow-x-auto rounded-none border-b p-0">
          {[
            ["productivity", "Productivity"],
            ["utilization", "Utilization"],
            ["completion", "Completion"],
            ["durations", "Durations"],
          ].map(([v, l]) => (
            <TabsTrigger
              key={v}
              value={v}
              className="h-10 flex-none rounded-none border-0 px-1 text-body data-[state=active]:bg-transparent data-[state=active]:shadow-none"
            >
              {l}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="productivity">
          <TabLayout
            kpis={
              <>
                <KpiCard label="Tasks completed" value={completed} delta={{ text: `${pct(completed, prevCompleted)}% vs. prev.`, direction: completed >= prevCompleted ? "up" : "down", good: completed >= prevCompleted }} />
                <KpiCard label="Tasks / operator-hour" value={avg(data.map((d) => d.tasksPerOperatorHour)).toFixed(2)} info="Completed tasks ÷ operator hours on shift." />
                <KpiCard label="Productive hours" value={sum(data.map((d) => d.productiveHours))} unit="h" />
                <KpiCard label="Avg per day" value={Math.round(completed / data.length)} unit="tasks" />
              </>
            }
            chart={
              <SectionCard
                title="Tasks completed per day"
                action={
                  <ChartLegend
                    items={[
                      { label: "This period", color: CHART.series[0] },
                      ...(compare ? [{ label: "Previous period", color: CHART.reference, dashed: true }] : []),
                    ]}
                  />
                }
              >
                <ProductivityChart data={data} compare={compare} />
              </SectionCard>
            }
            breakdown={
              <SectionCard title="By task type" subtitle="Completed, last 30 days" className="h-full">
                <BreakdownList items={tasksByType.map((t) => ({ label: taskTypeLabel[t.type], value: t.completed }))} />
              </SectionCard>
            }
            footer={
              <SectionCard title="Top operators" subtitle="Last 30 days" bodyClassName="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-small">
                    <thead>
                      <tr className="border-b">
                        <th className="eyebrow px-4 py-2 text-left">Operator</th>
                        <th className="eyebrow px-4 py-2 text-right">Tasks</th>
                        <th className="eyebrow px-4 py-2 text-right">Hours</th>
                        <th className="eyebrow px-4 py-2 text-right">Tasks / h</th>
                        <th className="eyebrow px-4 py-2 text-right">On-time</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {operatorProductivity.map((p) => (
                        <tr key={p.operatorId} className="hover:bg-raised">
                          <td className="px-4 py-2">{operators?.find((o) => o.id === p.operatorId)?.name ?? p.operatorId}</td>
                          <td className="px-4 py-2 text-right font-mono tabular-nums">{p.tasks}</td>
                          <td className="px-4 py-2 text-right font-mono tabular-nums">{p.hours}</td>
                          <td className="px-4 py-2 text-right font-mono tabular-nums">{(p.tasks / p.hours).toFixed(2)}</td>
                          <td className={`px-4 py-2 text-right font-mono tabular-nums ${p.onTimeRate < 85 ? "text-warning" : ""}`}>{p.onTimeRate}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </SectionCard>
            }
          />
        </TabsContent>

        <TabsContent value="utilization">
          <TabLayout
            kpis={
              <>
                <KpiCard
                  label="Fleet utilization"
                  value={Math.round(utilization)}
                  unit="%"
                  tone={utilization < 75 ? "warning" : "brand"}
                  delta={{ text: `${Math.round(utilization - prevUtil)} pts vs. prev.`, direction: utilization >= prevUtil ? "up" : "down", good: utilization >= prevUtil }}
                  info="Engine-on productive hours ÷ scheduled available hours. Target 75%."
                />
                <KpiCard label="Idle hours" value={sum(data.map((d) => d.idleH))} unit="h" />
                <KpiCard label="Fault downtime" value={sum(data.map((d) => d.faultH))} unit="h" tone="warning" />
                <KpiCard label="Maintenance" value={sum(data.map((d) => d.maintenanceH))} unit="h" />
              </>
            }
            chart={
              <div className="flex flex-col gap-4">
                <SectionCard
                  title="Fleet hours by state"
                  action={
                    <ChartLegend
                      items={[
                        { label: "Operating", color: CHART.status.success },
                        { label: "Idle", color: CHART.series[5] },
                        { label: "Maintenance", color: CHART.status.info },
                        { label: "Fault", color: CHART.status.danger },
                      ]}
                      className="hidden md:flex"
                    />
                  }
                >
                  <UtilizationHoursChart data={data} />
                </SectionCard>
                <SectionCard title="Utilization trend" subtitle="Target 75%">
                  <UtilizationTrendChart data={data} compare={compare} />
                </SectionCard>
              </div>
            }
            breakdown={
              <SectionCard title="By machine type" subtitle="Below 60% highlighted" className="h-full">
                <BreakdownList
                  max={100}
                  warnBelow={60}
                  items={utilizationByMachineType.map((u) => ({ label: machineTypeLabel[u.type], value: u.utilization, display: `${u.utilization}%` }))}
                />
              </SectionCard>
            }
          />
        </TabsContent>

        <TabsContent value="completion">
          <TabLayout
            kpis={
              <>
                <KpiCard label="Completion rate" value={Math.round(((completed) / (completed + cancelled)) * 100)} unit="%" info="Completed ÷ (completed + cancelled)." />
                <KpiCard label="On-time rate" value={Math.round(onTimeRate)} unit="%" tone={onTimeRate < 85 ? "warning" : "default"} info="Finished at or before planned end ÷ completed." />
                <KpiCard label="Late" value={late} tone={late > 0 ? "warning" : "success"} />
                <KpiCard label="Cancelled" value={cancelled} />
              </>
            }
            chart={
              <SectionCard
                title="Completion per day"
                action={
                  <ChartLegend
                    items={[
                      { label: "On time", color: CHART.series[1] },
                      { label: "Late", color: CHART.status.warning },
                      { label: "Cancelled", color: CHART.series[5] },
                    ]}
                  />
                }
              >
                <CompletionChart data={data} />
              </SectionCard>
            }
            breakdown={
              <SectionCard title="On-time by complexity" className="h-full">
                <BreakdownList
                  max={100}
                  warnBelow={80}
                  items={completionByComplexity.map((c) => ({ label: `${complexityLabel[c.complexity]} complexity`, value: c.onTime, display: `${c.onTime}%` }))}
                />
              </SectionCard>
            }
          />
        </TabsContent>

        <TabsContent value="durations">
          <TabLayout
            kpis={
              <>
                <KpiCard label="Median duration" value={formatDuration(avg(durationStats.map((d) => d.median)))} />
                <KpiCard label="P90 duration" value={formatDuration(avg(durationStats.map((d) => d.p90)))} />
                <KpiCard
                  label="Planned vs actual"
                  value={`+${Math.round(avg(durationStats.map((d) => (d.median - d.planned) / d.planned)) * 100)}`}
                  unit="%"
                  tone="warning"
                  info="(median actual − planned) ÷ planned, averaged across task types."
                />
                <KpiCard label="Overrunning types" value={durationStats.filter((d) => d.median > d.planned).length} denominator={durationStats.length} />
              </>
            }
            chart={
              <SectionCard
                title="Duration by task type"
                subtitle="Minutes"
                action={
                  <ChartLegend
                    items={[
                      { label: "Planned", color: CHART.series[5] },
                      { label: "Median", color: CHART.series[0] },
                      { label: "P90", color: CHART.series[3] },
                    ]}
                  />
                }
              >
                <DurationChart />
              </SectionCard>
            }
            breakdown={
              <SectionCard title="Largest overruns" subtitle="Median vs planned" className="h-full">
                <BreakdownList
                  items={[...durationStats]
                    .map((d) => ({ label: taskTypeLabel[d.type], value: Math.max(0, d.median - d.planned) }))
                    .sort((a, b) => b.value - a.value)
                    .map((d) => ({ ...d, display: `+${d.value} min` }))}
                />
              </SectionCard>
            }
          />
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
}
