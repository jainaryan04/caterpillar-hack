"use client";

import { useMemo, useState } from "react";
import { CircleCheck, CircleDot, Moon, OctagonAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ALL, FilterSelect } from "@/components/shared/filter-select";
import { MetaDot, PageHeader } from "@/components/shared/page-header";
import { PageContainer } from "@/components/shared/page-container";
import { SummaryStrip } from "@/components/shared/summary-strip";
import { useLookup, useOperators, useTasks } from "@/hooks/use-fleet-data";
import { useQueryParam } from "@/hooks/use-query-param";
import { FATIGUE } from "@/lib/thresholds";
import { availabilityMeta } from "@/lib/status";
import type { Availability, Operator } from "@/lib/types";
import { OperatorDrawer } from "./operator-drawer";
import { OperatorTable } from "./operator-table";

type Quick = "on-shift" | "available" | "high-fatigue" | "off";
type FatigueBand = "normal" | "elevated" | "high";

const quickMatch: Record<Quick, (o: Operator) => boolean> = {
  "on-shift": (o) => o.availability === "on-task" || o.availability === "on-break" || o.availability === "available",
  available: (o) => o.availability === "available",
  "high-fatigue": (o) => o.fatigue >= FATIGUE.high,
  off: (o) => o.availability === "off-shift" || o.availability === "leave",
};

const bandMatch: Record<FatigueBand, (o: Operator) => boolean> = {
  normal: (o) => o.fatigue < FATIGUE.elevated,
  elevated: (o) => o.fatigue >= FATIGUE.elevated && o.fatigue < FATIGUE.high,
  high: (o) => o.fatigue >= FATIGUE.high,
};

/** Operators — spec §5.3: who is working, who is available, who is at risk. */
export function OperatorsView() {
  const { data: operators } = useOperators();
  const { data: tasks } = useTasks();
  const lookup = useLookup();
  const [selectedId, setSelectedId] = useQueryParam("operator");
  const [quick, setQuick] = useState<Quick | null>(null);
  const [availability, setAvailability] = useState<Availability | typeof ALL>(ALL);
  const [band, setBand] = useState<FatigueBand | typeof ALL>(ALL);

  const filtered = useMemo(
    () =>
      operators?.filter(
        (o) =>
          (!quick || quickMatch[quick](o)) &&
          (availability === ALL || o.availability === availability) &&
          (band === ALL || bandMatch[band](o)),
      ),
    [operators, quick, availability, band],
  );

  const count = (q: Quick) => operators?.filter(quickMatch[q]).length ?? 0;
  const filtersActive = Boolean(quick) || availability !== ALL || band !== ALL;
  const clear = () => {
    setQuick(null);
    setAvailability(ALL);
    setBand(ALL);
  };

  return (
    <PageContainer className="flex flex-col gap-4">
      <PageHeader
        title="Operators"
        className="pb-1"
        description={
          operators ? (
            <>
              <span>{operators.length} rostered</span>
              <MetaDot />
              <span>Pit 3 North</span>
            </>
          ) : undefined
        }
      />

      <SummaryStrip
        active={quick}
        onSelect={(k) => setQuick(k as Quick | null)}
        items={[
          { key: "on-shift", label: "On shift", value: count("on-shift"), icon: CircleDot, tone: "success" },
          { key: "available", label: "Available", value: count("available"), icon: CircleCheck, tone: "info" },
          { key: "high-fatigue", label: "High fatigue", value: count("high-fatigue"), icon: OctagonAlert, tone: "danger" },
          { key: "off", label: "Off shift / leave", value: count("off"), icon: Moon, tone: "neutral" },
        ]}
      />

      <OperatorTable
        operators={filtered}
        tasks={tasks}
        selectedId={selectedId}
        onSelect={setSelectedId}
        filtersActive={filtersActive}
        onClearFilters={clear}
        toolbar={
          <>
            <FilterSelect
              label="Availability"
              value={availability}
              onChange={setAvailability}
              options={(Object.keys(availabilityMeta) as Availability[]).map((a) => ({
                value: a,
                label: availabilityMeta[a].label,
              }))}
            />
            <FilterSelect
              label="Fatigue"
              value={band}
              onChange={setBand}
              options={[
                { value: "normal", label: "Normal (<40)" },
                { value: "elevated", label: "Elevated (40–69)" },
                { value: "high", label: "High (70+)" },
              ]}
            />
            {filtersActive ? (
              <Button variant="ghost" size="sm" onClick={clear}>
                Clear filters
              </Button>
            ) : null}
          </>
        }
      />

      <OperatorDrawer
        operator={operators?.find((o) => o.id === selectedId)}
        tasks={tasks ?? []}
        lookup={lookup}
        onClose={() => setSelectedId(null)}
      />
    </PageContainer>
  );
}
