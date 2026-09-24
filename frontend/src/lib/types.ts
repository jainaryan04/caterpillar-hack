/** Domain model shared by the UI. Mirrors docs/DESIGN_SPEC.md §1.1. */

import type { Industry, TaskType } from "@/lib/catalog";

export type { Industry, TaskType };

export type LatLng = { lat: number; lng: number };

/** The backend's own machine_type string, e.g. "Haul Truck" — the roster
 * spans 19 of them across five industries, so there is no local enum to
 * drift out of sync with it. */
export type MachineType = string;

export type MachineStatus = "operating" | "idle" | "fault" | "maintenance" | "offline";

export interface Machine {
  id: string;
  model: string;
  type: MachineType;
  status: MachineStatus;
  /** Not a single backend field -- a machine can be geofenced to several
   * zones at once (see Prediction/db/schema.sql machine_zone_assignments).
   * Computed on demand from position + zone polygons (lib/geo.ts) where a
   * single "current zone" is genuinely useful, e.g. the map drawer. */
  zoneId?: string;
  operatorId: string | null;
  taskId: string | null;
  /** Engine-on minutes this shift. Only known once a run has been published. */
  runtimeTodayMin?: number;
  /** Not tracked by the backend roster -- omitted, not fabricated, when absent. */
  engineHours?: number;
  velocityKph: number;
  engineTempC: number;
  fuelPct?: number;
  position: LatLng;
  /** Degrees clockwise from north */
  heading: number;
  lastSeen: string;
}

export type Availability = "on-task" | "available" | "on-break" | "off-shift" | "leave";

export interface Shift {
  name: "Day" | "Night";
  start: string;
  end: string;
}

export interface Operator {
  /** The real worker_id (e.g. "W019"). The backend roster has no personal
   * names, so this doubles as the display identity — inventing one would
   * misrepresent who is actually on the roster. */
  id: string;
  initials: string;
  /** 1–10, straight from the roster. */
  skillLevel: number;
  /** Raw backend skill strings, e.g. "Surface Excavation". */
  skills: string[];
  certifications: MachineType[];
  shift: Shift | null;
  hoursWorked: number;
  plannedHours: number;
  /** 0–100; bands: <40 normal, 40–69 elevated, ≥70 high */
  fatigue: number;
  availability: Availability;
  machineId: string | null;
  position: LatLng | null;
}

export type TaskComplexity = "low" | "medium" | "high";

export type TaskStatus =
  | "scheduled"
  | "in-progress"
  | "delayed"
  | "completed"
  | "cancelled";

export interface Task {
  /** Assignment id once scheduled; the roster task_id while unscheduled. */
  id: string;
  /** The roster task this row belongs to (several portions can share one). */
  taskId: string;
  industry: Industry;
  title: string;
  type: TaskType;
  complexity: TaskComplexity;
  operatorId: string | null;
  machineId: string | null;
  /** null = unscheduled */
  start: string | null;
  durationMin: number;
  status: TaskStatus;
  /** Not tracked by the backend `tasks` table -- present only when derivable
   * from the assigned machine's own zone assignment. */
  zoneId?: string;
  notes?: string;
}

export type AlertCategory = "emergency" | "assistance" | "machine-failure" | "incident";
export type Severity = "critical" | "high" | "medium" | "low";
export type AlertStatus = "open" | "acknowledged" | "responding" | "resolved" | "escalated";

export interface TimelineEntry {
  at: string;
  actor: string;
  action: string;
}

export interface SafetyAlert {
  id: string;
  category: AlertCategory;
  severity: Severity;
  status: AlertStatus;
  title: string;
  description: string;
  operatorId?: string;
  machineId?: string;
  otherMachineId?: string;
  /** Not every real event is zone-scoped (only RESTRICTED_ZONE always is). */
  zoneId?: string;
  position?: LatLng;
  raisedAt: string;
  assignee?: string;
  timeline: TimelineEntry[];
}

export type ZoneKind = "work" | "restricted";

export interface Zone {
  id: string;
  name: string;
  kind: ZoneKind;
  polygon: LatLng[];
  /** For restricted zones with an active window, e.g. blasting */
  activeWindow?: string;
  rule?: string;
}

export type NotificationTier = "p1" | "p2" | "p3";

export interface AppNotification {
  id: string;
  tier: NotificationTier;
  title: string;
  detail: string;
  at: string;
  read: boolean;
  href: string;
}
