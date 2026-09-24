/**
 * Data access seam. Every screen reads through these functions via React
 * Query hooks (src/hooks/use-fleet-data.ts) — this file is the only place
 * that knows the backend's shape.
 *
 * Backend split (Prediction/api, see API.md):
 *  - `/v1/*` is the existing scheduling engine (plan, predict, runs,
 *    assignments) — untouched, called here exactly as any other client would.
 *  - `/v2/*` is a new, additive layer (routes_live.py) exposing live GPS,
 *    zones and safety alerts, tables no v1 route reads.
 * Nothing here duplicates a v1 route's logic; task creation and completion
 * both go straight through the existing POST /v1/plan and
 * PATCH /v1/assignments/{id} rather than inventing a second path to the same
 * effect.
 *
 * Scope: this roster spans five industries (it is the prediction model's
 * benchmark dataset); this dashboard represents ONE Mining site, so reads
 * here filter to `industry: "Mining"` and machine types that site actually
 * operates. See API.md and PLAN.md for the full roster.
 */
import type {
  AppNotification,
  Availability,
  Machine,
  MachineStatus,
  Operator,
  SafetyAlert,
  AlertCategory,
  AlertStatus,
  Severity,
  Task,
  TaskStatus,
  Zone,
} from "@/lib/types";
import {
  BACKEND_MACHINE_TYPE,
  BACKEND_TASK_TYPE,
  FRONTEND_MACHINE_TYPE,
  FRONTEND_TASK_TYPE,
  TASK_TYPE_MACHINE,
  TASK_TYPE_QUANTITY,
} from "@/lib/status";
import type { TaskType } from "@/lib/types";

const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000").replace(/\/$/, "");
const MINING_MACHINE_TYPES = new Set(Object.values(BACKEND_MACHINE_TYPE));

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// The backend's DB connection pool has its own ~30s timeout when Postgres is
// unreachable (Prediction/api/store.py, unchanged, shared by every DB route).
// Waiting that out on every poll is how a DB outage turns into a UI that
// looks frozen with zero explanation. Reads here fail fast instead; the
// solver-backed plan endpoint gets a much longer budget since a real 20s
// solve is not a hang.
const DEFAULT_TIMEOUT_MS = 10_000;
const PLAN_TIMEOUT_MS = 45_000;
// Polled every 5s (use-fleet-data.ts) -- this must stay under that interval,
// or react-query's next refetch cancels this one before it ever gets to fail,
// and the offline banner never has a settled error to show (it flickers back
// to "reconnecting" every cycle instead of staying up).
const HEALTH_TIMEOUT_MS = 4_000;

async function apiFetch<T>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...rest } = init ?? {};
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...rest,
      signal: controller.signal,
      headers: { "Content-Type": "application/json", ...(rest.headers ?? {}) },
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      throw new ApiError(0, `${rest.method ?? "GET"} ${path} timed out after ${timeoutMs}ms`);
    }
    throw new ApiError(0, `${rest.method ?? "GET"} ${path} failed: ${String(e)}`);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ApiError(res.status, `${rest.method ?? "GET"} ${path} failed (${res.status}): ${body.slice(0, 300)}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** GET /v1/runs/active/* 404s when nothing has been published yet — that is
 * a real, expected state (fresh database), not an error. */
async function getActiveOr<T>(path: string, fallback: T): Promise<T> {
  try {
    return await apiFetch<T>(path);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return fallback;
    throw e;
  }
}

// ------------------------------------------------------------- health ---

export interface HealthStatus {
  status: string;
  model_loaded: boolean;
  database: "connected" | "configured-but-unreachable" | "not-configured";
}

export const health = () => apiFetch<HealthStatus>("/health", { timeoutMs: HEALTH_TIMEOUT_MS });

// ------------------------------------------------------------- backend row shapes ---

interface BackendMachine {
  machine_id: string;
  machine_type: string;
  reservation_status: string;
  telemetry_status: string;
  lat: number | string;
  lng: number | string;
  heading_deg: number | string;
  velocity_kph: number | string;
  position_updated_at: string | null;
}

interface BackendAssignment {
  id: number;
  task_id: string;
  task_type: string;
  worker_id: string;
  machine_id: string;
  start_at: string;
  end_at: string;
  busy_min: number;
  status: "PLANNED" | "IN_PROGRESS" | "DONE" | "CANCELLED";
}

interface BackendRosterTask {
  task_id: string;
  task_type: string;
  industry: string;
  task_priority: number;
  work_quantity: number;
  work_unit: string;
  weather: string;
  shift_type: string;
  execution_mode: "SINGLE" | "PARALLEL";
  max_parallel: number;
  required_machine_type: string;
}

interface BackendWorker {
  worker_id: string;
  skills: string;
  skill_level: number;
  current_fatigue: number;
  available_from_min: number;
  available_until_min: number;
  status?: string;
}

interface BackendZone {
  id: string;
  site_id: string;
  name: string;
  kind: "work" | "restricted";
  polygon: { lat: number; lng: number }[];
  active_window: string | null;
  rule: string | null;
}

interface BackendAlert {
  id: number;
  event_type: "PROXIMITY" | "TILT" | "ROLLOVER" | "FALL" | "GEOFENCE_EXIT" | "RESTRICTED_ZONE";
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  status: "OPEN" | "ACKNOWLEDGED" | "RESOLVED";
  machine_id: string;
  machine_type: string;
  other_machine_id: string | null;
  lat: number | null;
  lng: number | null;
  distance_m: number | null;
  threshold_m: number | null;
  tilt_deg: number | null;
  threshold_deg: number | null;
  zone_id: string | null;
  detected_at: string;
  last_confirmed_at: string;
  acknowledged_at: string | null;
  resolved_at: string | null;
  notes: string | null;
}

const num = (v: number | string | null | undefined): number => (v == null ? 0 : Number(v));

// --------------------------------------------------------------- shared reads ---

const activeAssignments = () =>
  getActiveOr<{ assignments: BackendAssignment[] }>("/v1/runs/active/assignments", { assignments: [] })
    .then((r) => r.assignments);

const rosterTasks = () =>
  apiFetch<{ tasks: BackendRosterTask[] }>("/v1/rosters?source=db").then((r) =>
    r.tasks.filter((t) => t.industry === "Mining"),
  );

// ----------------------------------------------------------------- machines ---

const telemetryToStatus: Record<string, MachineStatus> = {
  OPERATING: "operating",
  IDLE: "idle",
  FAULT: "fault",
  MAINTENANCE: "maintenance",
  OFFLINE: "offline",
};

async function machines(): Promise<Machine[]> {
  const [{ machines: rows }, assignments] = await Promise.all([
    apiFetch<{ machines: BackendMachine[] }>("/v2/machines"),
    activeAssignments(),
  ]);

  const now = Date.now();
  const current = new Map<string, BackendAssignment>();
  for (const a of assignments) {
    if (a.status === "CANCELLED" || a.status === "DONE") continue;
    const start = new Date(a.start_at).getTime();
    const end = new Date(a.end_at).getTime();
    if (a.status === "IN_PROGRESS" || (now >= start && now <= end)) current.set(a.machine_id, a);
  }

  return rows
    .filter((m) => MINING_MACHINE_TYPES.has(m.machine_type))
    .map((m) => {
      const type = FRONTEND_MACHINE_TYPE[m.machine_type] ?? "excavator";
      const assignment = current.get(m.machine_id);
      return {
        id: m.machine_id,
        model: `${m.machine_type} ${m.machine_id}`,
        type,
        status: telemetryToStatus[m.telemetry_status] ?? "offline",
        operatorId: assignment?.worker_id ?? null,
        taskId: assignment ? String(assignment.id) : null,
        velocityKph: num(m.velocity_kph),
        engineTempC: 0, // filled in by machinesWithTelemetry from the roster row
        position: { lat: num(m.lat), lng: num(m.lng) },
        heading: num(m.heading_deg),
        lastSeen: m.position_updated_at ?? new Date().toISOString(),
      } satisfies Machine;
    });
}

/** engine_temp_c/age_years live on the plain `machines` roster row (not the
 * GPS view), and today's runtime lives on the active run's machine_usage --
 * merged in here rather than adding more backend routes. */
async function machinesWithTelemetry(): Promise<Machine[]> {
  const [base, roster, usage] = await Promise.all([
    machines(),
    apiFetch<{ machines: { machine_id: string; engine_temp_c: number }[] }>("/v1/rosters?source=db"),
    getActiveOr<{ machines: { machine_id: string; busy_min: number }[] }>(
      "/v1/runs/active/machines", { machines: [] },
    ),
  ]);
  const tempById = new Map(roster.machines.map((m) => [m.machine_id, m.engine_temp_c]));
  const busyById = new Map(usage.machines.map((m) => [m.machine_id, m.busy_min]));
  return base.map((m) => ({
    ...m,
    engineTempC: tempById.has(m.id) ? Number(tempById.get(m.id)) : m.engineTempC,
    runtimeTodayMin: busyById.get(m.id),
  }));
}

// ----------------------------------------------------------------- operators ---

/** available_from/until are minutes from the plan's own horizon, not a
 * wall-clock window this adapter can check against "now" -- so shift state
 * comes from the resource's live reservation status, and off-shift/leave
 * (which the backend has no field for at all) simply never occur here. */
function deriveAvailability(status: string | undefined): Availability {
  if (status === "IN_USE" || status === "RESERVED") return "on-task";
  return "available";
}

async function operators(): Promise<Operator[]> {
  const [rosterRes, assignments, usage] = await Promise.all([
    apiFetch<{ workers: BackendWorker[] }>("/v1/rosters?source=db"),
    activeAssignments(),
    getActiveOr<{ workers: { worker_id: string; busy_min: number }[] }>(
      "/v1/runs/active/workers", { workers: [] },
    ),
  ]);

  const now = Date.now();
  const current = new Map<string, BackendAssignment>();
  for (const a of assignments) {
    if (a.status === "CANCELLED" || a.status === "DONE") continue;
    const start = new Date(a.start_at).getTime();
    const end = new Date(a.end_at).getTime();
    if (a.status === "IN_PROGRESS" || (now >= start && now <= end)) current.set(a.worker_id, a);
  }
  const busyById = new Map(usage.workers.map((w) => [w.worker_id, w.busy_min]));

  return rosterRes.workers.map((w) => {
    const skills = w.skills ? w.skills.split(";").map((s) => s.trim()).filter(Boolean) : [];
    const certifications = Array.from(
      new Set(skills.map((s) => FRONTEND_TASK_TYPE[s]).filter(Boolean).map((t) => TASK_TYPE_MACHINE[t])),
    )
      .map((backendType) => FRONTEND_MACHINE_TYPE[backendType])
      .filter(Boolean);
    const assignment = current.get(w.worker_id);
    // busy_min is scoped to today's published run, not a weekly total the
    // backend has no history for -- "this week" is honestly the same number.
    const hoursWorked = Math.round(((busyById.get(w.worker_id) ?? 0) / 60) * 10) / 10;

    return {
      id: w.worker_id,
      name: `Operator ${w.worker_id}`,
      initials: w.worker_id.replace(/\D/g, "").slice(-2).padStart(2, "0"),
      role: "Equipment Operator",
      certifications,
      shift: {
        name: w.available_from_min < 720 ? "Day" : "Night",
        start: `${String(Math.floor((w.available_from_min / 60) % 24)).padStart(2, "0")}:00`,
        end: `${String(Math.floor((w.available_until_min / 60) % 24)).padStart(2, "0")}:00`,
      },
      hoursWorked,
      plannedHours: Math.round(((w.available_until_min - w.available_from_min) / 60) * 10) / 10,
      hoursThisWeek: hoursWorked,
      fatigue: Math.round(num(w.current_fatigue)),
      availability: deriveAvailability(w.status),
      machineId: assignment?.machine_id ?? null,
      position: null, // no foot-position telemetry exists for workers
    } satisfies Operator;
  });
}

// -------------------------------------------------------------------- tasks ---

const assignmentToStatus: Record<BackendAssignment["status"], TaskStatus> = {
  PLANNED: "scheduled",
  IN_PROGRESS: "in-progress",
  DONE: "completed",
  CANCELLED: "cancelled",
};

async function tasks(): Promise<Task[]> {
  const [assignments, roster] = await Promise.all([activeAssignments(), rosterTasks()]);

  const seen = new Set<string>();
  const scheduled: Task[] = assignments
    .filter((a) => {
      const r = roster.find((t) => t.task_id === a.task_id);
      return r !== undefined; // scope to this Mining site's own tasks
    })
    .map((a) => {
      seen.add(a.task_id);
      const type = FRONTEND_TASK_TYPE[a.task_type] ?? "maintenance";
      return {
        id: String(a.id),
        title: `${a.task_type} — ${a.task_id}`,
        type,
        complexity: MINING_COMPLEXITY[type] ?? "medium",
        operatorId: a.worker_id,
        machineId: a.machine_id,
        start: a.start_at,
        durationMin: a.busy_min,
        status: assignmentToStatus[a.status],
        notes: undefined,
      } satisfies Task;
    });

  const unscheduled: Task[] = roster
    .filter((t) => !seen.has(t.task_id))
    .map((t) => {
      const type = FRONTEND_TASK_TYPE[t.task_type] ?? "maintenance";
      return {
        id: t.task_id,
        title: `${t.task_type} — ${t.task_id}`,
        type,
        complexity: MINING_COMPLEXITY[type] ?? "medium",
        operatorId: null,
        machineId: null,
        start: null,
        durationMin: 0,
        status: "scheduled",
        notes: "Not yet included in the published plan.",
      } satisfies Task;
    });

  return [...scheduled, ...unscheduled];
}

/** Difficulty weights from prediction_service/complexity.py TASK_DIFFICULTY["Mining"]
 * (0.7/0.6/0.3/0.25), bucketed -- the real model's own notion of complexity,
 * not a guess. */
const MINING_COMPLEXITY: Partial<Record<TaskType, "low" | "medium" | "high">> = {
  drilling: "high",
  excavation: "medium",
  hauling: "low",
  loading: "low",
};

export interface CreateTaskInput {
  type: TaskType;
  priority: number;
  quantity: number;
  weather: "Sunny" | "Cloudy" | "Rainy";
  shiftType: "Day" | "Night";
}

/** Adds a new Mining task and re-runs the full plan so it is actually
 * scheduled -- reuses POST /v1/plan exactly as any other caller would; there
 * is no separate "create task" endpoint. */
async function createTask(input: CreateTaskInput) {
  const existing = await rosterTasks();
  const task_id = `TNEW-${Date.now().toString(36).toUpperCase()}`;
  const newTask = {
    task_id,
    task_type: BACKEND_TASK_TYPE[input.type],
    industry: "Mining",
    task_priority: input.priority,
    work_quantity: input.quantity,
    work_unit: TASK_TYPE_QUANTITY[input.type].unit,
    weather: input.weather,
    shift_type: input.shiftType,
    execution_mode: "PARALLEL" as const,
    max_parallel: 3,
    required_machine_type: TASK_TYPE_MACHINE[input.type],
  };
  return apiFetch("/v1/plan", {
    method: "POST",
    timeoutMs: PLAN_TIMEOUT_MS,
    body: JSON.stringify({
      source: "db",
      tasks: [...existing, newTask],
      persist: true,
      publish: true,
      options: { seconds: 20 },
    }),
  });
}

/** Re-runs the plan against the roster as it stands (e.g. after adding a task
 * without changing anything else). Same route as createTask's second step. */
async function replan() {
  return apiFetch("/v1/plan", {
    method: "POST",
    timeoutMs: PLAN_TIMEOUT_MS,
    body: JSON.stringify({ source: "db", persist: true, publish: true, options: { seconds: 20 } }),
  });
}

/** A frontend "task" is one assignment (portion) once scheduled, so
 * completing it is exactly PATCH /v1/assignments/{id} -- no new route. */
async function completeTask(taskId: string) {
  if (!/^\d+$/.test(taskId)) throw new Error(`${taskId} is not yet scheduled -- nothing to complete`);
  return apiFetch(`/v1/assignments/${taskId}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "DONE" }),
  });
}

// -------------------------------------------------------------------- zones ---

async function zones(): Promise<Zone[]> {
  const { zones: rows } = await apiFetch<{ zones: BackendZone[] }>("/v2/zones");
  return rows.map((z) => ({
    id: z.id,
    name: z.name,
    kind: z.kind,
    polygon: z.polygon,
    activeWindow: z.active_window ?? undefined,
    rule: z.rule ?? undefined,
  }));
}

// ------------------------------------------------------------------- alerts ---

const alertCategory: Record<BackendAlert["event_type"], AlertCategory> = {
  TILT: "machine-failure",
  ROLLOVER: "machine-failure",
  FALL: "machine-failure",
  PROXIMITY: "incident",
  GEOFENCE_EXIT: "incident",
  RESTRICTED_ZONE: "incident",
};

const alertTitle: Record<BackendAlert["event_type"], (a: BackendAlert) => string> = {
  PROXIMITY: (a) => `Machines too close: ${a.machine_id} & ${a.other_machine_id}`,
  TILT: (a) => `${a.machine_id} tilt above warning (${Number(a.tilt_deg).toFixed(0)}°)`,
  ROLLOVER: (a) => `${a.machine_id} critical tilt — possible rollover`,
  FALL: (a) => `${a.machine_id} sudden orientation change detected`,
  GEOFENCE_EXIT: (a) => `${a.machine_id} left its assigned work zone`,
  RESTRICTED_ZONE: (a) => `${a.machine_id} entered a restricted zone`,
};

function toSafetyAlert(a: BackendAlert): SafetyAlert {
  const timeline = [
    { at: a.detected_at, actor: a.machine_id, action: "Detected" },
    ...(a.last_confirmed_at !== a.detected_at
      ? [{ at: a.last_confirmed_at, actor: a.machine_id, action: "Still active" }]
      : []),
    ...(a.acknowledged_at ? [{ at: a.acknowledged_at, actor: "Operations", action: "Acknowledged" }] : []),
    ...(a.resolved_at ? [{ at: a.resolved_at, actor: "Operations", action: "Resolved" }] : []),
    ...(a.notes ? [{ at: a.last_confirmed_at, actor: "Operations", action: a.notes }] : []),
  ];
  return {
    id: `EVT-${a.id}`,
    category: alertCategory[a.event_type],
    severity: a.severity.toLowerCase() as Severity,
    status: a.status.toLowerCase() as AlertStatus,
    title: alertTitle[a.event_type](a),
    description:
      a.event_type === "PROXIMITY"
        ? `${a.distance_m?.toFixed?.(0) ?? a.distance_m} m apart, threshold ${a.threshold_m} m.`
        : a.event_type === "TILT" || a.event_type === "ROLLOVER"
          ? `Tilt ${Number(a.tilt_deg).toFixed(1)}°, threshold ${a.threshold_deg}°.`
          : a.event_type === "FALL"
            ? "Angle changed sharply within one tick."
            : a.event_type === "RESTRICTED_ZONE"
              ? `Inside restricted zone ${a.zone_id}.`
              : "Outside every zone this machine is assigned to.",
    machineId: a.machine_id,
    otherMachineId: a.other_machine_id ?? undefined,
    zoneId: a.zone_id ?? undefined,
    position: a.lat != null && a.lng != null ? { lat: Number(a.lat), lng: Number(a.lng) } : undefined,
    raisedAt: a.detected_at,
    timeline,
  };
}

async function alerts(): Promise<SafetyAlert[]> {
  const { alerts: rows } = await apiFetch<{ alerts: BackendAlert[] }>("/v2/alerts");
  return rows.filter((a) => MINING_MACHINE_TYPES.has(a.machine_type)).map(toSafetyAlert);
}

async function setAlertStatus(id: string, status: "ACKNOWLEDGED" | "RESOLVED", note?: string) {
  const numericId = id.replace(/^EVT-/, "");
  return apiFetch(`/v2/alerts/${numericId}`, {
    method: "PATCH",
    body: JSON.stringify({ status, note }),
  });
}

async function notifications(): Promise<AppNotification[]> {
  const rows = await alerts();
  return rows
    .filter((a) => a.status !== "resolved")
    .slice(0, 12)
    .map(
      (a) =>
        ({
          id: `N-${a.id}`,
          tier: a.severity === "critical" ? "p1" : a.severity === "high" ? "p2" : "p3",
          title: a.title,
          detail: a.machineId ?? "",
          at: a.raisedAt,
          read: false,
          href: `/safety?event=${a.id}`,
        }) satisfies AppNotification,
    );
}

export const api = {
  machines: machinesWithTelemetry,
  operators,
  tasks,
  alerts,
  notifications,
  zones,
};

export const mutations = {
  createTask,
  completeTask,
  replan,
  acknowledgeAlert: (id: string, note?: string) => setAlertStatus(id, "ACKNOWLEDGED", note),
  resolveAlert: (id: string, note?: string) => setAlertStatus(id, "RESOLVED", note),
};

export const queryKeys = {
  machines: ["machines"] as const,
  operators: ["operators"] as const,
  tasks: ["tasks"] as const,
  alerts: ["alerts"] as const,
  notifications: ["notifications"] as const,
  zones: ["zones"] as const,
  health: ["health"] as const,
};
