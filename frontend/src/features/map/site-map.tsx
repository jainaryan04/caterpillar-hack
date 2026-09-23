"use client";

import type { KeyboardEvent } from "react";
import { Siren } from "lucide-react";
import { cn } from "@/lib/utils";
import { SITE_BOUNDS, SITE_PLAN } from "@/lib/mock/site";
import { availabilityMeta, machineStatusMeta, type Tone } from "@/lib/status";
import type { LatLng, Machine, Operator, SafetyAlert, Zone } from "@/lib/types";
import { MachineIcon } from "@/components/shared/machine-icon";

/**
 * Google Maps placeholder — spec §13.
 *
 * Renders a schematic site plan as SVG using the same lat/lng data and marker
 * language the real map will use (status ring, heading chevron, hatched
 * restricted zones, pulsing SOS). Swap this component for a Google Maps
 * <FleetMap> with AdvancedMarkerElement markers in the integration phase;
 * the props contract stays the same.
 */

export type MapLayer = "machines" | "operators" | "work" | "restricted" | "sos";
export type MapSelection = { kind: "machine" | "operator" | "zone" | "sos"; id: string } | null;

interface SiteMapProps {
  machines: Machine[];
  operators: Operator[];
  zones: Zone[];
  alerts: SafetyAlert[];
  layers?: Record<MapLayer, boolean>;
  selection?: MapSelection;
  onSelect?: (selection: MapSelection) => void;
  /** Dashboard mini-map: no labels, no interaction chrome */
  compact?: boolean;
  className?: string;
}

const ALL_LAYERS: Record<MapLayer, boolean> = {
  machines: true,
  operators: true,
  work: true,
  restricted: true,
  sos: true,
};

const toneStroke: Record<Tone, string> = {
  success: "stroke-success",
  warning: "stroke-warning",
  danger: "stroke-danger",
  info: "stroke-info",
  neutral: "stroke-neutral",
};

export function toPlan({ lat, lng }: LatLng) {
  const { north, south, west, east } = SITE_BOUNDS;
  return {
    x: ((lng - west) / (east - west)) * SITE_PLAN.width,
    y: ((north - lat) / (north - south)) * SITE_PLAN.height,
  };
}

function polygonPoints(poly: LatLng[]) {
  return poly
    .map(toPlan)
    .map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(" ");
}

/** Label anchor: top-left of the polygon's bounding box, so labels don't sit under markers. */
function labelAnchor(poly: LatLng[]) {
  const pts = poly.map(toPlan);
  return { x: Math.min(...pts.map((p) => p.x)), y: Math.min(...pts.map((p) => p.y)) };
}

function activate(fn: () => void) {
  return (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fn();
    }
  };
}

/* Schematic haul roads between work areas */
const ROADS = [
  "M 300 250 L 380 305 L 740 350 L 840 350",
  "M 330 430 L 380 305",
  "M 560 240 L 560 300",
  "M 845 430 L 850 470",
];

/* Pit bench contours */
const CONTOURS = [
  { cx: 400, cy: 170, rx: 330, ry: 150 },
  { cx: 400, cy: 170, rx: 260, ry: 112 },
  { cx: 400, cy: 170, rx: 190, ry: 76 },
  { cx: 400, cy: 170, rx: 120, ry: 44 },
];

export function SiteMap({
  machines,
  operators,
  zones,
  alerts,
  layers = ALL_LAYERS,
  selection,
  onSelect,
  compact,
  className,
}: SiteMapProps) {
  const interactive = Boolean(onSelect) && !compact;
  const select = (s: MapSelection) => onSelect?.(selection?.id === s?.id ? null : s);
  const isSelected = (id: string) => selection?.id === id;

  const sos = alerts.filter(
    (a) => a.category === "emergency" && a.position && a.status !== "resolved",
  );
  const loose = operators.filter((o) => o.position && !o.machineId);

  return (
    <svg
      viewBox={`0 0 ${SITE_PLAN.width} ${SITE_PLAN.height}`}
      preserveAspectRatio="xMidYMid meet"
      className={cn("block h-full w-full select-none", className)}
      role="img"
      aria-label="Site map"
    >
      <defs>
        <pattern id="restricted-hatch" patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="8" className="stroke-danger" strokeWidth="2" strokeOpacity="0.35" />
        </pattern>
      </defs>

      {/* Base: land, pit contours, haul roads */}
      <rect width={SITE_PLAN.width} height={SITE_PLAN.height} className="fill-(--map-land)" />
      {CONTOURS.map((c, i) => (
        <ellipse key={i} {...c} fill="none" className="stroke-(--map-contour)" strokeWidth="1.5" />
      ))}
      {ROADS.map((d, i) => (
        <path key={i} d={d} fill="none" className="stroke-(--map-road)" strokeWidth="14" strokeLinecap="round" strokeLinejoin="round" />
      ))}

      {/* Work sites */}
      {layers.work
        ? zones
            .filter((z) => z.kind === "work")
            .map((z) => {
              const c = labelAnchor(z.polygon);
              return (
                <g
                  key={z.id}
                  onClick={interactive ? () => select({ kind: "zone", id: z.id }) : undefined}
                  className={interactive ? "cursor-pointer" : undefined}
                >
                  <polygon
                    points={polygonPoints(z.polygon)}
                    className={cn(
                      "fill-foreground/[0.04] stroke-foreground-secondary/60",
                      isSelected(z.id) && "fill-foreground/[0.08] stroke-foreground",
                    )}
                    strokeWidth="1"
                  />
                  {!compact ? (
                    <text x={c.x + 10} y={c.y + 24} className="fill-muted-foreground font-sans text-[13px] font-medium">
                      {z.name}
                    </text>
                  ) : null}
                </g>
              );
            })
        : null}

      {/* Restricted zones — hatch reads as restricted without color */}
      {layers.restricted
        ? zones
            .filter((z) => z.kind === "restricted")
            .map((z) => {
              const c = labelAnchor(z.polygon);
              return (
                <g
                  key={z.id}
                  onClick={interactive ? () => select({ kind: "zone", id: z.id }) : undefined}
                  className={interactive ? "cursor-pointer" : undefined}
                >
                  <polygon
                    points={polygonPoints(z.polygon)}
                    fill="url(#restricted-hatch)"
                    className="stroke-danger"
                    strokeWidth={isSelected(z.id) ? 3 : 2}
                  />
                  {!compact ? (
                    <text x={c.x} y={Math.max(12, c.y - 6)} className="fill-danger font-sans text-[11px] font-semibold">
                      {z.name}
                      {z.activeWindow ? ` · ${z.activeWindow}` : ""}
                    </text>
                  ) : null}
                </g>
              );
            })
        : null}

      {/* Operators on foot (operators in a machine are shown on the machine) */}
      {layers.operators
        ? loose.map((o) => {
            const p = toPlan(o.position!);
            const tone = availabilityMeta[o.availability].tone;
            const label = `${o.name}, ${availabilityMeta[o.availability].label}`;
            return (
              <g
                key={o.id}
                transform={`translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`}
                role={interactive ? "button" : undefined}
                tabIndex={interactive ? 0 : undefined}
                aria-label={interactive ? label : undefined}
                onClick={interactive ? () => select({ kind: "operator", id: o.id }) : undefined}
                onKeyDown={interactive ? activate(() => select({ kind: "operator", id: o.id })) : undefined}
                className={cn(interactive && "cursor-pointer outline-none [&:focus-visible>circle]:stroke-brand")}
              >
                <title>{label}</title>
                {isSelected(o.id) ? <circle r="14" fill="none" className="stroke-foreground" strokeDasharray="3 3" /> : null}
                <circle r={compact ? 5 : 9} className={cn("fill-overlay", toneStroke[tone])} strokeWidth="2" />
                {!compact ? (
                  <text y="3" textAnchor="middle" className="fill-foreground-secondary font-sans text-[8px] font-semibold">
                    {o.initials}
                  </text>
                ) : null}
              </g>
            );
          })
        : null}

      {/* Machines */}
      {layers.machines
        ? machines.map((m) => {
            const p = toPlan(m.position);
            const meta = machineStatusMeta[m.status];
            const stale = m.status === "offline";
            const size = compact ? 18 : 28;
            const half = size / 2;
            const label = `${m.id} ${m.model}, ${meta.label}`;
            return (
              <g
                key={m.id}
                transform={`translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`}
                role={interactive ? "button" : undefined}
                tabIndex={interactive ? 0 : undefined}
                aria-label={interactive ? label : undefined}
                onClick={interactive ? () => select({ kind: "machine", id: m.id }) : undefined}
                onKeyDown={interactive ? activate(() => select({ kind: "machine", id: m.id })) : undefined}
                className={cn(
                  stale && "opacity-50",
                  interactive && "cursor-pointer outline-none [&:focus-visible>rect]:stroke-brand",
                )}
              >
                <title>{label}</title>
                {m.velocityKph > 0 ? (
                  <path
                    d={`M 0 ${-half - 9} L 5 ${-half - 3} L -5 ${-half - 3} Z`}
                    transform={`rotate(${m.heading})`}
                    className="fill-foreground-secondary"
                  />
                ) : null}
                {isSelected(m.id) ? (
                  <rect
                    x={-half - 5}
                    y={-half - 5}
                    width={size + 10}
                    height={size + 10}
                    rx="8"
                    fill="none"
                    className="stroke-foreground"
                    strokeDasharray="4 3"
                  />
                ) : null}
                <rect
                  x={-half}
                  y={-half}
                  width={size}
                  height={size}
                  rx="6"
                  className={cn("fill-overlay", toneStroke[meta.tone])}
                  strokeWidth="2"
                  strokeDasharray={stale ? "4 3" : undefined}
                />
                <MachineIcon
                  type={m.type}
                  x={-half + 4}
                  y={-half + 4}
                  width={size - 8}
                  height={size - 8}
                  className="text-foreground-secondary"
                />
                {m.operatorId && !compact ? (
                  <circle cx={half - 1} cy={-half + 1} r="4" className="fill-foreground-secondary stroke-overlay" strokeWidth="1.5" />
                ) : null}
                {!compact ? (
                  <text y={half + 13} textAnchor="middle" className="fill-foreground-secondary font-mono text-[10px]">
                    {m.id.replace("MCH-", "")}
                  </text>
                ) : null}
              </g>
            );
          })
        : null}

      {/* SOS — always on top, never clustered, pulses until acknowledged */}
      {layers.sos
        ? sos.map((a) => {
            const p = toPlan(a.position!);
            const unacked = a.status === "open";
            const r = compact ? 9 : 14;
            return (
              <g
                key={a.id}
                transform={`translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`}
                role={interactive ? "button" : undefined}
                tabIndex={interactive ? 0 : undefined}
                aria-label={interactive ? `SOS: ${a.title}` : undefined}
                onClick={interactive ? () => select({ kind: "sos", id: a.id }) : undefined}
                onKeyDown={interactive ? activate(() => select({ kind: "sos", id: a.id })) : undefined}
                className={cn(interactive && "cursor-pointer outline-none")}
              >
                <title>{`SOS: ${a.title}`}</title>
                {unacked ? (
                  <>
                    <circle r={r} className="origin-center animate-sos-pulse fill-danger [transform-box:fill-box]" />
                    <circle r={r} className="origin-center animate-sos-pulse fill-danger [animation-delay:0.75s] [transform-box:fill-box]" />
                  </>
                ) : (
                  <circle r={r + 5} fill="none" className="stroke-danger" strokeWidth="2" />
                )}
                <circle r={r} className="fill-danger stroke-white" strokeWidth={isSelected(a.id) ? 3 : 1.5} />
                <Siren x={-r * 0.6} y={-r * 0.6} width={r * 1.2} height={r * 1.2} className="text-white" strokeWidth={2.25} />
              </g>
            );
          })
        : null}
    </svg>
  );
}
