import {
  CircleCheck,
  Circle,
  CircleDot,
  CirclePause,
  Clock,
  Info,
  OctagonAlert,
  Siren,
  TriangleAlert,
  Wrench,
  WifiOff,
  ArrowUpRight,
  Coffee,
  Moon,
  Plane,
  Radio,
  Shovel,
  Truck,
  Container,
  Ruler,
  Tractor,
  ClipboardCheck,
  Drill,
  type LucideIcon,
} from "lucide-react";
import type {
  AlertCategory,
  AlertStatus,
  Availability,
  MachineStatus,
  MachineType,
  Severity,
  TaskComplexity,
  TaskStatus,
  TaskType,
} from "@/lib/types";

/**
 * Status is never color alone (spec §0.2): every entry pairs a tone with an
 * icon and a label. Brand yellow is never a status tone (spec §9.4).
 */
export type Tone = "success" | "warning" | "danger" | "info" | "neutral";

export interface StatusMeta {
  label: string;
  tone: Tone;
  icon: LucideIcon;
}

export const toneIcon: Record<Tone, LucideIcon> = {
  success: CircleCheck,
  warning: TriangleAlert,
  danger: OctagonAlert,
  info: Info,
  neutral: Circle,
};

export const machineStatusMeta: Record<MachineStatus, StatusMeta> = {
  operating: { label: "Operating", tone: "success", icon: CircleDot },
  idle: { label: "Idle", tone: "neutral", icon: CirclePause },
  fault: { label: "Fault", tone: "danger", icon: OctagonAlert },
  maintenance: { label: "Maintenance", tone: "info", icon: Wrench },
  offline: { label: "Offline", tone: "neutral", icon: WifiOff },
};

export const taskStatusMeta: Record<TaskStatus, StatusMeta> = {
  scheduled: { label: "Scheduled", tone: "info", icon: Clock },
  "in-progress": { label: "In progress", tone: "success", icon: CircleDot },
  delayed: { label: "Delayed", tone: "warning", icon: TriangleAlert },
  completed: { label: "Completed", tone: "neutral", icon: CircleCheck },
  cancelled: { label: "Cancelled", tone: "neutral", icon: Circle },
};

export const availabilityMeta: Record<Availability, StatusMeta> = {
  "on-task": { label: "On task", tone: "success", icon: CircleDot },
  available: { label: "Available", tone: "info", icon: CircleCheck },
  "on-break": { label: "On break", tone: "neutral", icon: Coffee },
  "off-shift": { label: "Off shift", tone: "neutral", icon: Moon },
  leave: { label: "Leave", tone: "neutral", icon: Plane },
};

export const severityMeta: Record<Severity, StatusMeta> = {
  critical: { label: "Critical", tone: "danger", icon: Siren },
  high: { label: "High", tone: "danger", icon: OctagonAlert },
  medium: { label: "Medium", tone: "warning", icon: TriangleAlert },
  low: { label: "Low", tone: "info", icon: Info },
};

export const alertStatusMeta: Record<AlertStatus, StatusMeta> = {
  open: { label: "Open", tone: "danger", icon: Radio },
  acknowledged: { label: "Acknowledged", tone: "warning", icon: CircleCheck },
  responding: { label: "Responding", tone: "info", icon: ArrowUpRight },
  resolved: { label: "Resolved", tone: "success", icon: CircleCheck },
  escalated: { label: "Escalated", tone: "danger", icon: ArrowUpRight },
};

export const alertCategoryLabel: Record<AlertCategory, string> = {
  emergency: "Emergency",
  assistance: "Assistance",
  "machine-failure": "Machine failure",
  incident: "Safety incident",
};

export const machineTypeLabel: Record<MachineType, string> = {
  excavator: "Excavator",
  dozer: "Dozer",
  "haul-truck": "Haul truck",
  "wheel-loader": "Wheel loader",
  "motor-grader": "Motor grader",
  "drill-rig": "Rotary drill rig",
};

/** Every task type the UI can filter or pick by. The Mining roster only uses
 * four of these; the rest exist because the model supports them. */
export const TASK_TYPES: TaskType[] = [
  "excavation",
  "hauling",
  "loading",
  "drilling",
  "grading",
  "dozing",
  "inspection",
  "maintenance",
];

export const taskTypeLabel: Record<TaskType, string> = {
  excavation: "Excavation",
  hauling: "Hauling",
  loading: "Loading",
  grading: "Grading",
  dozing: "Dozing",
  drilling: "Drilling",
  inspection: "Inspection",
  maintenance: "Maintenance",
};

export const taskTypeIcon: Record<TaskType, LucideIcon> = {
  excavation: Shovel,
  hauling: Truck,
  loading: Container,
  grading: Ruler,
  dozing: Tractor,
  drilling: Drill,
  inspection: ClipboardCheck,
  maintenance: Wrench,
};

/** Machine types that can perform each task type — narrows the machine picker. */
export const taskMachineTypes: Record<TaskType, MachineType[] | "any"> = {
  excavation: ["excavator"],
  hauling: ["haul-truck"],
  loading: ["wheel-loader", "excavator"],
  grading: ["motor-grader"],
  dozing: ["dozer"],
  drilling: ["drill-rig"],
  inspection: "any",
  maintenance: "any",
};

/** Real backend task_type string (Mining industry) -> frontend TaskType, and back.
 * The backend's roster spans five industries for the prediction model, but this
 * dashboard is scoped to the Mining site it represents (see API.md) -- these are
 * the only four task types that site actually schedules. */
export const BACKEND_TASK_TYPE: Record<TaskType, string> = {
  excavation: "Surface Excavation",
  hauling: "Hauling Ore",
  loading: "Aggregate Collection",
  drilling: "Drilling",
  grading: "Grading",
  dozing: "Dozing",
  inspection: "Inspection",
  maintenance: "Maintenance",
};
export const FRONTEND_TASK_TYPE: Record<string, TaskType> = Object.fromEntries(
  Object.entries(BACKEND_TASK_TYPE).map(([k, v]) => [v, k as TaskType]),
);

/** Real backend machine_type string -> frontend MachineType, for the machine
 * types this Mining site actually operates (API.md §"design decisions"). */
export const BACKEND_MACHINE_TYPE: Record<MachineType, string> = {
  excavator: "Excavator",
  dozer: "Bulldozer",
  "haul-truck": "Haul Truck",
  "wheel-loader": "Wheel Loader",
  "motor-grader": "Motor Grader",
  "drill-rig": "Rotary Drill Rig",
};
export const FRONTEND_MACHINE_TYPE: Record<string, MachineType> = Object.fromEntries(
  Object.entries(BACKEND_MACHINE_TYPE).map(([k, v]) => [v, k as MachineType]),
);

/** required_machine_type for a Mining task_type -- deterministic in the
 * roster (each type has exactly one), used when creating a new task. */
export const TASK_TYPE_MACHINE: Record<TaskType, string> = {
  excavation: "Excavator",
  hauling: "Haul Truck",
  loading: "Wheel Loader",
  drilling: "Rotary Drill Rig",
  grading: "Motor Grader",
  dozing: "Bulldozer",
  inspection: "Inspection Kit",
  maintenance: "Maintenance Vehicle",
};

/** work_unit and a sane work_quantity range for each Mining task_type,
 * taken from the real roster (Prediction/db backend), not invented. */
export const TASK_TYPE_QUANTITY: Record<TaskType, { unit: string; min: number; max: number; default: number }> = {
  excavation: { unit: "m3", min: 1280, max: 2760, default: 2000 },
  hauling: { unit: "tonnes", min: 252, max: 1390, default: 900 },
  loading: { unit: "tonnes", min: 108, max: 337, default: 200 },
  drilling: { unit: "m drilled", min: 100, max: 158, default: 130 },
  grading: { unit: "m", min: 200, max: 2000, default: 800 },
  dozing: { unit: "m3", min: 200, max: 2000, default: 800 },
  inspection: { unit: "checks", min: 1, max: 20, default: 5 },
  maintenance: { unit: "hours", min: 1, max: 12, default: 4 },
};

export const complexityLevel: Record<TaskComplexity, number> = { low: 1, medium: 2, high: 3 };
export const complexityLabel: Record<TaskComplexity, string> = { low: "Low", medium: "Medium", high: "High" };

/** Tone-keyed class sets. Tailwind needs literal class names, so no interpolation. */
export const toneClasses: Record<Tone, { text: string; bg: string; border: string; solid: string }> = {
  success: { text: "text-success", bg: "bg-success/12", border: "border-success/40", solid: "bg-success" },
  warning: { text: "text-warning", bg: "bg-warning/12", border: "border-warning/40", solid: "bg-warning" },
  danger: { text: "text-danger", bg: "bg-danger/12", border: "border-danger/40", solid: "bg-danger" },
  info: { text: "text-info", bg: "bg-info/12", border: "border-info/40", solid: "bg-info" },
  neutral: { text: "text-muted-foreground", bg: "bg-neutral/16", border: "border-neutral/40", solid: "bg-neutral" },
};

export function engineTempTone(tempC: number, thresholds: { elevated: number; critical: number }): Tone | null {
  if (tempC > thresholds.critical) return "danger";
  if (tempC >= thresholds.elevated) return "warning";
  return null;
}

export function fatigueTone(score: number): Tone {
  if (score >= 70) return "danger";
  if (score >= 40) return "warning";
  return "success";
}

export function fatigueLabel(score: number): string {
  if (score >= 70) return "High";
  if (score >= 40) return "Elevated";
  return "Normal";
}
