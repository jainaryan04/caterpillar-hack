/** Domain model shared by the UI. Mirrors docs/DESIGN_SPEC.md §1.1. */

export type LatLng = { lat: number; lng: number };

export type MachineType =
  | "excavator"
  | "dozer"
  | "haul-truck"
  | "wheel-loader"
  | "motor-grader"
  | "articulated-truck";

export type MachineStatus = "operating" | "idle" | "fault" | "maintenance" | "offline";

export interface Machine {
  id: string;
  model: string;
  type: MachineType;
  status: MachineStatus;
  zoneId: string;
  operatorId: string | null;
  taskId: string | null;
  /** Engine-on minutes this shift */
  runtimeTodayMin: number;
  engineHours: number;
  velocityKph: number;
  engineTempC: number;
  fuelPct: number;
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
  id: string;
  name: string;
  initials: string;
  role: "Equipment Operator" | "Site Supervisor" | "Safety Officer";
  certifications: MachineType[];
  shift: Shift | null;
  hoursWorked: number;
  plannedHours: number;
  hoursThisWeek: number;
  /** 0–100; bands: <40 normal, 40–69 elevated, ≥70 high */
  fatigue: number;
  availability: Availability;
  machineId: string | null;
  position: LatLng | null;
  phone: string;
}

export type TaskType =
  | "excavation"
  | "hauling"
  | "loading"
  | "grading"
  | "dozing"
  | "inspection"
  | "maintenance";

export type TaskComplexity = "low" | "medium" | "high";

export type TaskStatus =
  | "scheduled"
  | "in-progress"
  | "delayed"
  | "completed"
  | "cancelled";

export interface Task {
  id: string;
  title: string;
  type: TaskType;
  complexity: TaskComplexity;
  operatorId: string | null;
  machineId: string | null;
  /** null = unscheduled */
  start: string | null;
  durationMin: number;
  status: TaskStatus;
  zoneId: string;
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
  zoneId: string;
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

export interface Manual {
  id: string;
  title: string;
  model: string;
  docType: "Operation & Maintenance" | "Parts" | "Safety";
  pages: number;
}
