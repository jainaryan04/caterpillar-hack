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
  Building2,
  Hammer,
  Droplets,
  Gauge,
  Zap,
  TrainFront,
  Ship,
  type LucideIcon,
} from "lucide-react";
import { isTaskType, type TaskType } from "@/lib/catalog";
import type {
  AlertCategory,
  AlertStatus,
  Availability,
  MachineStatus,
  Severity,
  TaskComplexity,
  TaskStatus,
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

/** Icon per real task type (catalog.ts). Types read as text first — the
 * icon only reinforces it — so an unmapped type falls back to a neutral glyph
 * rather than borrowing another type's. */
const TASK_TYPE_ICON: Record<TaskType, LucideIcon> = {
  "Surface Excavation": Shovel,
  "Hauling Ore": Truck,
  "Aggregate Collection": Container,
  Drilling: Drill,
  "Site Preparation": Tractor,
  Excavation: Shovel,
  "Road Building": Ruler,
  "Foundation Work": Building2,
  "Material Loading": Container,
  Demolition: Hammer,
  "Well Drilling": Drill,
  "Well Servicing": Wrench,
  "Pipeline Pumping": Droplets,
  "Gas Compression Service": Gauge,
  "Generator Maintenance": Wrench,
  "Backup Generator Testing": Zap,
  "Emergency Power Deployment": Zap,
  "Cooling System Inspection": ClipboardCheck,
  "Freight Operations": TrainFront,
  "Locomotive Maintenance": Wrench,
  "Rail Network Inspection": ClipboardCheck,
  "Tugboat Engine Service": Ship,
};

export function taskTypeIcon(type: string): LucideIcon {
  return isTaskType(type) ? TASK_TYPE_ICON[type] : ClipboardCheck;
}

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
