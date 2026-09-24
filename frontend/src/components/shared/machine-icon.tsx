import type { SVGProps } from "react";

/**
 * Machine silhouettes (Lucide has none) — spec §7.1. Drawn on a 24×24 grid
 * with Lucide's 1.5px stroke so they sit naturally next to Lucide icons.
 * Also used nested inside the map SVG.
 */
type Silhouette = "excavator" | "dozer" | "haul-truck" | "wheel-loader" | "motor-grader" | "drill-rig" | "vehicle" | "plant";

const paths: Record<Silhouette, React.ReactNode> = {
  excavator: (
    <>
      <path d="M3 17h11a2 2 0 0 1 0 4H3a2 2 0 0 1 0-4z" />
      <path d="M4 17v-5h6l1 5" />
      <path d="M10 13l6-7 5 4" />
      <path d="M21 10l-1 4h-3l1-3" />
    </>
  ),
  dozer: (
    <>
      <path d="M6 17h11a2 2 0 0 1 0 4H6a2 2 0 0 1 0-4z" />
      <path d="M7 17v-4h4V8h4l1 5v4" />
      <path d="M2.5 11v9" />
      <path d="M2.5 15.5H7" />
    </>
  ),
  "haul-truck": (
    <>
      <path d="M2 8h12l-1 7H3z" />
      <path d="M14 11h4l3 3v2h-7" />
      <circle cx="6" cy="18" r="2" />
      <circle cx="17" cy="18" r="2" />
    </>
  ),
  "wheel-loader": (
    <>
      <circle cx="8.5" cy="18" r="2.5" />
      <circle cx="18" cy="18" r="2.5" />
      <path d="M8 15.5h10.5V11H16V6.5h-4V11H8" />
      <path d="M8 12.5 5 14" />
      <path d="M2 11.5l3.5 1-1 4.5H2z" />
    </>
  ),
  "motor-grader": (
    <>
      <circle cx="4" cy="18" r="2" />
      <circle cx="15.5" cy="18" r="2" />
      <circle cx="20.5" cy="18" r="2" />
      <path d="M4 16l2-4h9v4.5" />
      <path d="M15 12V7.5h4.5V12" />
      <path d="M8 19.5h4" />
    </>
  ),
  "drill-rig": (
    <>
      <path d="M8 21V9" />
      <path d="M4 21h8" />
      <path d="M8 9l-2.5-5" />
      <path d="M8 9l2.5-5" />
      <path d="M4.5 4h7" />
      <path d="M12 21h9v-3l-3-2h-6" />
      <circle cx="16" cy="21" r="1.4" />
      <circle cx="20" cy="21" r="1.4" />
    </>
  ),
  // Road/rail/water service vehicles with no dedicated silhouette.
  vehicle: (
    <>
      <path d="M2 16V9h11v7" />
      <path d="M13 11h4.5l3.5 3.5V16h-8" />
      <circle cx="6" cy="17.5" r="2" />
      <circle cx="17" cy="17.5" r="2" />
    </>
  ),
  // Skid-mounted plant: pumps, compressors, generators, test units.
  plant: (
    <>
      <rect x="3" y="7" width="18" height="10" rx="1.5" />
      <path d="M7 11h4M7 13.5h4" />
      <circle cx="16" cy="12" r="2.5" />
      <path d="M4 20h16" />
    </>
  ),
};

/** Backend machine_type -> silhouette. Anything unlisted draws as a generic vehicle. */
const SILHOUETTE: Record<string, Silhouette> = {
  Excavator: "excavator",
  Bulldozer: "dozer",
  "Haul Truck": "haul-truck",
  "Wheel Loader": "wheel-loader",
  "Motor Grader": "motor-grader",
  "Rotary Drill Rig": "drill-rig",
  "Drilling Rig": "drill-rig",
  "Well Service Rig": "drill-rig",
  "Mobile Crane": "drill-rig",
  "Pipeline Pump": "plant",
  "Gas Compressor": "plant",
  "Generator Test Unit": "plant",
  "Emergency Generator": "plant",
};

interface MachineIconProps extends SVGProps<SVGSVGElement> {
  /** Backend machine_type, e.g. "Haul Truck". */
  type: string;
}

export function MachineIcon({ type, ...props }: MachineIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      width={16}
      height={16}
      {...props}
    >
      {paths[SILHOUETTE[type] ?? "vehicle"]}
    </svg>
  );
}
