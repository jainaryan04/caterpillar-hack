import { cn } from "@/lib/utils";

/** Marker legend — shape + ring color, readable without color (spec §13). */
export function MapLegend({ compact, className }: { compact?: boolean; className?: string }) {
  const items = [
    { label: "Operating", swatch: "rounded-[3px] border-2 border-success" },
    { label: "Idle / offline", swatch: "rounded-[3px] border-2 border-neutral" },
    { label: "Fault", swatch: "rounded-[3px] border-2 border-danger" },
    { label: "Maintenance", swatch: "rounded-[3px] border-2 border-info" },
    { label: "Operator", swatch: "rounded-full border-2 border-success" },
    { label: "Restricted", swatch: "hatch-danger rounded-[2px] border border-danger" },
    { label: "SOS", swatch: "rounded-full bg-danger" },
  ];
  return (
    <ul className={cn("flex flex-wrap items-center gap-x-4 gap-y-1.5 text-caption text-foreground-secondary", className)}>
      {(compact ? items.filter((i) => i.label !== "Maintenance") : items).map((i) => (
        <li key={i.label} className="flex items-center gap-1.5">
          <span className={cn("size-3 shrink-0 bg-overlay", i.swatch)} aria-hidden />
          {i.label}
        </li>
      ))}
    </ul>
  );
}
