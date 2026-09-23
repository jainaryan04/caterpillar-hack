"use client";

import { useMemo, useState } from "react";
import { ClipboardList, HandHelping, OctagonAlert, Plus, Siren } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { TableSkeleton } from "@/components/shared/loading-skeleton";
import { PageHeader } from "@/components/shared/page-header";
import { PageContainer } from "@/components/shared/page-container";
import { SegmentedControl } from "@/components/shared/segmented-control";
import { SummaryStrip } from "@/components/shared/summary-strip";
import { useAlerts, useLookup, useZones } from "@/hooks/use-fleet-data";
import { useQueryParam } from "@/hooks/use-query-param";
import type { AlertCategory, SafetyAlert, Severity } from "@/lib/types";
import { useAlertStore } from "@/stores/alert-store";
import { EventDetailPanel } from "./event-detail-panel";
import { EventRow } from "./event-row";
import { IncidentFormDialog } from "./incident-form-dialog";
import { IncidentTable } from "./incident-table";
import { ResolutionWorkflow } from "./resolution-workflow";

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

/** Safety & SOS — spec §5.7: respond fast, keep a complete record. */
export function SafetyView() {
  const { data: alerts } = useAlerts();
  const { data: zones } = useZones();
  const lookup = useLookup();
  const setStatus = useAlertStore((s) => s.setStatus);
  const [selectedId, setSelectedId] = useQueryParam("event");
  const [tab, setTab] = useState<"active" | "log">("active");
  const [category, setCategory] = useState<AlertCategory | null>(null);
  const [logOpen, setLogOpen] = useState(false);

  const active = useMemo(
    () =>
      (alerts ?? [])
        .filter((a) => a.status !== "resolved" && (!category || a.category === category))
        .sort(
          (a, b) =>
            Number(b.status === "open") - Number(a.status === "open") ||
            SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
            a.raisedAt.localeCompare(b.raisedAt),
        ),
    [alerts, category],
  );

  const openCount = (c: AlertCategory) => alerts?.filter((a) => a.category === c && a.status !== "resolved").length ?? 0;
  const incidents24h =
    alerts?.filter((a) => a.category === "incident" && Date.now() - new Date(a.raisedAt).getTime() < 86_400_000).length ?? 0;
  const selected = alerts?.find((a) => a.id === selectedId) ?? (tab === "active" ? active[0] : undefined);

  const acknowledge = (a: SafetyAlert) => {
    setStatus(a.id, "acknowledged", "Acknowledged");
    toast.success(`${a.id} acknowledged`, { description: a.title });
  };

  return (
    <PageContainer className="flex flex-col gap-4">
      <PageHeader
        title="Safety & SOS"
        className="pb-1"
        description="Emergencies, assistance requests, machine failures and incidents"
        actions={
          <>
            <SegmentedControl
              ariaLabel="View"
              value={tab}
              onChange={setTab}
              options={[
                { value: "active", label: "Active board" },
                { value: "log", label: "Incident log" },
              ]}
            />
            <Button onClick={() => setLogOpen(true)}>
              <Plus /> Log incident
            </Button>
          </>
        }
      />

      <SummaryStrip
        active={category}
        onSelect={(k) => {
          setCategory(k as AlertCategory | null);
          setTab("active");
        }}
        items={[
          { key: "emergency", label: "Active emergencies", value: openCount("emergency"), icon: Siren, tone: "danger" },
          { key: "assistance", label: "Assistance requests", value: openCount("assistance"), icon: HandHelping, tone: "warning" },
          { key: "machine-failure", label: "Machine failures", value: openCount("machine-failure"), icon: OctagonAlert, tone: "danger" },
          { key: "incident", label: "Incidents (24 h)", value: incidents24h, icon: ClipboardList, tone: "info" },
        ]}
      />

      {tab === "active" ? (
        <>
          {alerts ? <ResolutionWorkflow alerts={alerts} onSelect={setSelectedId} /> : null}
          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_400px] 2xl:grid-cols-[minmax(0,1fr)_460px]">
            <section className="overflow-hidden rounded-lg border bg-panel" aria-label="Open events">
              <div className="flex items-center justify-between border-b px-4 py-2.5">
                <h2 className="text-h3">Open events</h2>
                <span className="text-caption text-muted-foreground">Unacknowledged first, then severity and age</span>
              </div>
              {!alerts ? (
                <TableSkeleton rows={5} columns={3} />
              ) : active.length === 0 ? (
                <EmptyState
                  variant={category ? "filtered" : "clear"}
                  title={category ? "No open events in this category" : "No active emergencies"}
                  description={category ? undefined : "New SOS and assistance requests will appear here instantly."}
                  action={
                    category ? (
                      <Button variant="secondary" size="sm" onClick={() => setCategory(null)}>
                        Clear filter
                      </Button>
                    ) : undefined
                  }
                />
              ) : (
                <ul className="divide-y">
                  {active.map((a) => (
                    <EventRow
                      key={a.id}
                      alert={a}
                      lookup={lookup}
                      selected={a.id === selected?.id}
                      onSelect={setSelectedId}
                      onAcknowledge={acknowledge}
                    />
                  ))}
                </ul>
              )}
            </section>
            <div className="lg:sticky lg:top-4">
              <EventDetailPanel alert={selected} lookup={lookup} onClose={() => setSelectedId(null)} />
            </div>
          </div>
        </>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_400px] 2xl:grid-cols-[minmax(0,1fr)_460px]">
          <IncidentTable alerts={alerts} lookup={lookup} onSelect={setSelectedId} selectedId={selectedId} />
          <div className="lg:sticky lg:top-4">
            <EventDetailPanel alert={selected} lookup={lookup} onClose={() => setSelectedId(null)} />
          </div>
        </div>
      )}

      {logOpen && zones ? <IncidentFormDialog open onOpenChange={setLogOpen} zones={zones} /> : null}
    </PageContainer>
  );
}
