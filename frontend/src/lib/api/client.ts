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
 *
 * Scope: the roster spans five industries (it is the prediction model's
 * benchmark dataset), and each industry is one "site" in this UI. Entity
 * reads take the industry and filter to it: its own tasks, the machine types
 * those tasks require (lib/catalog.ts), the workers skilled for them, and the
 * alerts raised by those machines. All machines share one physical site and
 * geofence, so industry is a logical grouping, not a second pit.
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
  complexityBucket,
  isIndustry,
  isTaskType,
  machineTypesFor,
  taskTypesFor,
  type ExecutionMode,
  type Industry,
  type ShiftType,
  type TaskType,
  type Weather,
} from "@/lib/catalog";

const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000").replace(/\/$/, "");

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// The backend's DB connection pool has its own ~30s timeout when Postgres is
// unreachable (Prediction/api/store.py, unchanged, shared by every DB route).
// Waiting that out on every poll is how a DB outage turns into a UI that
// looks frozen with zero explanation. Reads here fail fast instead.
const DEFAULT_TIMEOUT_MS = 10_000;
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
  execution_mode: ExecutionMode;
  max_parallel: number;
  required_machine_type: string;
}

/** /v1/rosters worker row. Note the roster returns `skill_set` (a sorted
 * list) and `available_from`/`available_until` — not the CSV's `skills`
 * string or `*_min` names. */
interface BackendWorker {
  worker_id: string;
  skill_set: string[];
  skill_level: number;
  current_fatigue: number;
  available_from: number;
  available_until: number;
  status?: string;
}

interface BackendRosterMachine {
  machine_id: string;
  machine_type: string;
  age_years: number;
  engine_temp_c: number;
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

export interface Roster {
  tasks: BackendRosterTask[];
  workers: BackendWorker[];
  machines: BackendRosterMachine[];
}

const roster = () => apiFetch<Roster>("/v1/rosters?source=db");

/** Workers who hold at least one skill this industry's tasks need. */
function workerServes(w: BackendWorker, industry: Industry) {
  const needed = new Set<string>(taskTypesFor(industry));
  return w.skill_set.some((s) => needed.has(s));
}

/** Assignments running right now, keyed by the resource they occupy. */
function currentBy(assignments: BackendAssignment[], key: "machine_id" | "worker_id") {
  const now = Date.now();
  const current = new Map<string, BackendAssignment>();
  for (const a of assignments) {
    if (a.status === "CANCELLED" || a.status === "DONE") continue;
    const start = new Date(a.start_at).getTime();
    const end = new Date(a.end_at).getTime();
    if (a.status === "IN_PROGRESS" || (now >= start && now <= end)) current.set(a[key], a);
  }
  return current;
}

export interface SiteOption {
  id: Industry;
  name: string;
  tasks: number;
}

/** Sites = the industries actually present on the roster, in catalog order. */
async function sites(): Promise<SiteOption[]> {
  const { tasks } = await roster();
  const counts = new Map<string, number>();
  for (const t of tasks) counts.set(t.industry, (counts.get(t.industry) ?? 0) + 1);
  return [...counts.entries()]
    .filter((e): e is [Industry, number] => isIndustry(e[0]))
    .map(([id, n]) => ({ id, name: id, tasks: n }));
}

// ----------------------------------------------------------------- machines ---

const telemetryToStatus: Record<string, MachineStatus> = {
  OPERATING: "operating",
  IDLE: "idle",
  FAULT: "fault",
  MAINTENANCE: "maintenance",
  OFFLINE: "offline",
};

async function machines(industry: Industry): Promise<Machine[]> {
  const [{ machines: rows }, assignments, rosterRes, usage] = await Promise.all([
    apiFetch<{ machines: BackendMachine[] }>("/v2/machines"),
    activeAssignments(),
    roster(),
    getActiveOr<{ machines: { machine_id: string; busy_min: number }[] }>("/v1/runs/active/machines", {
      machines: [],
    }),
  ]);

  const scope = machineTypesFor(industry);
  const current = currentBy(assignments, "machine_id");
  // engine_temp_c lives on the plain roster row (not the GPS view), and
  // runtime on the active run's machine usage — merged in here rather than
  // adding more backend routes.
  const tempById = new Map(rosterRes.machines.map((m) => [m.machine_id, Number(m.engine_temp_c)]));
  const busyById = new Map(usage.machines.map((m) => [m.machine_id, m.busy_min]));

  return rows
    .filter((m) => scope.has(m.machine_type))
    .map((m) => {
      const assignment = current.get(m.machine_id);
      return {
        id: m.machine_id,
        model: `${m.machine_type} ${m.machine_id}`,
        type: m.machine_type,
        status: telemetryToStatus[m.telemetry_status] ?? "offline",
        operatorId: assignment?.worker_id ?? null,
        taskId: assignment ? String(assignment.id) : null,
        velocityKph: num(m.velocity_kph),
        engineTempC: tempById.get(m.machine_id) ?? 0,
        runtimeTodayMin: busyById.get(m.machine_id),
        position: { lat: num(m.lat), lng: num(m.lng) },
        heading: num(m.heading_deg),
        lastSeen: m.position_updated_at ?? new Date().toISOString(),
      } satisfies Machine;
    });
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

async function operators(industry: Industry): Promise<Operator[]> {
  const [rosterRes, assignments, usage] = await Promise.all([
    roster(),
    activeAssignments(),
    getActiveOr<{ workers: { worker_id: string; busy_min: number }[] }>(
      "/v1/runs/active/workers", { workers: [] },
    ),
  ]);

  const machineFor = new Map(rosterRes.tasks.map((t) => [t.task_type, t.required_machine_type]));
  const current = currentBy(assignments, "worker_id");
  const busyById = new Map(usage.workers.map((w) => [w.worker_id, w.busy_min]));

  return rosterRes.workers
    .filter((w) => workerServes(w, industry))
    .map((w) => {
      const skills = [...w.skill_set];
      // Certification = the machine types this worker's skills are paired
      // with on the roster; a skill with no roster task certifies nothing.
      const certifications = Array.from(
        new Set(skills.map((s) => machineFor.get(s)).filter((m): m is string => Boolean(m))),
      );
      const assignment = current.get(w.worker_id);
      const hoursWorked = Math.round(((busyById.get(w.worker_id) ?? 0) / 60) * 10) / 10;

      return {
        id: w.worker_id,
        initials: w.worker_id.replace(/\D/g, "").slice(-2).padStart(2, "0"),
        skillLevel: w.skill_level,
        skills,
        certifications,
        // available_from/until are real minute offsets from the plan horizon.
        // Most workers are available across the whole 30-day horizon, which
        // is not a shift -- only a window shorter than a day is shown as one.
        shift:
          w.available_until - w.available_from < 24 * 60
            ? {
                name: w.available_from % (24 * 60) < 720 ? "Day" : "Night",
                start: `${String(Math.floor((w.available_from / 60) % 24)).padStart(2, "0")}:00`,
                end: `${String(Math.floor((w.available_until / 60) % 24)).padStart(2, "0")}:00`,
              }
            : null,
        hoursWorked,
        plannedHours: Math.round(((w.available_until - w.available_from) / 60) * 10) / 10,
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

async function tasks(industry: Industry): Promise<Task[]> {
  const [assignments, rosterRes] = await Promise.all([activeAssignments(), roster()]);
  const own = rosterRes.tasks.filter((t) => t.industry === industry && isTaskType(t.task_type));
  const byId = new Map(own.map((t) => [t.task_id, t]));

  const seen = new Set<string>();
  const scheduled: Task[] = assignments
    .filter((a) => byId.has(a.task_id))
    .map((a) => {
      seen.add(a.task_id);
      const type = a.task_type as TaskType;
      return {
        id: String(a.id),
        taskId: a.task_id,
        industry,
        title: `${a.task_type} — ${a.task_id}`,
        type,
        complexity: complexityBucket(type),
        operatorId: a.worker_id,
        machineId: a.machine_id,
        start: a.start_at,
        durationMin: a.busy_min,
        status: assignmentToStatus[a.status],
        notes: undefined,
      } satisfies Task;
    });

  const unscheduled: Task[] = own
    .filter((t) => !seen.has(t.task_id))
    .map((t) => {
      const type = t.task_type as TaskType;
      return {
        id: t.task_id,
        taskId: t.task_id,
        industry,
        title: `${t.task_type} — ${t.task_id}`,
        type,
        complexity: complexityBucket(type),
        operatorId: null,
        machineId: null,
        start: null,
        durationMin: 0,
        status: "scheduled",
        notes: "On the roster but not in the published plan.",
      } satisfies Task;
    });

  return [...scheduled, ...unscheduled];
}

// --------------------------------------------------------------- prediction ---

/** A task to be assigned, in the backend's own vocabulary. */
export interface DraftTask {
  task_id: string;
  task_type: TaskType;
  industry: Industry;
  task_priority: number;
  work_quantity: number;
  work_unit: string;
  weather: Weather;
  shift_type: ShiftType;
  execution_mode: ExecutionMode;
  max_parallel: number;
  required_machine_type: string;
}

export interface PredictCandidate {
  worker_id: string;
  machine_id: string;
  predicted_duration_min: number;
  operator_skill: number;
  operator_fatigue: number;
  machine_age_years: number;
  machine_temp_c: number;
}

export interface PredictResult {
  task_id: string;
  task_complexity: number;
  n_candidates: number;
  best_min: number;
  worst_min: number;
  median_min: number;
  within_model_error_of_best: number;
  model_mae_min: number;
  candidates: PredictCandidate[];
}

/** Rank every legal (worker, machine) pairing for one task by
 * predicted duration — the model only, no solver, so it answers in ~2 s. */
async function predict(task: DraftTask, top_k = 5): Promise<PredictResult> {
  const r = await roster();
  // PredictRequest's WorkerIn/MachineIn ranges (fatigue 0..100, engine temp
  // 40..140) are the roster's own, so rows pass through unchanged.
  const workers = r.workers
    .filter((w) => w.skill_set.includes(task.task_type))
    .map((w) => ({
      worker_id: w.worker_id,
      skills: w.skill_set,
      skill_level: w.skill_level,
      current_fatigue: Number(w.current_fatigue),
      available_from: w.available_from,
      available_until: w.available_until,
    }));
  const machines = r.machines
    .filter((m) => m.machine_type === task.required_machine_type)
    .map((m) => ({
      machine_id: m.machine_id,
      machine_type: m.machine_type,
      age_years: Number(m.age_years),
      engine_temp_c: Number(m.engine_temp_c),
    }));
  if (!workers.length) throw new Error(`No worker on the roster is skilled for ${task.task_type}.`);
  if (!machines.length) throw new Error(`No ${task.required_machine_type} on the roster.`);
  return apiFetch<PredictResult>("/v1/predict", {
    method: "POST",
    body: JSON.stringify({ task, workers, machines, top_k }),
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

async function alerts(industry: Industry): Promise<SafetyAlert[]> {
  const scope = machineTypesFor(industry);
  const { alerts: rows } = await apiFetch<{ alerts: BackendAlert[] }>("/v2/alerts");
  return rows.filter((a) => scope.has(a.machine_type)).map(toSafetyAlert);
}

/** machine_zone_assignments: the work zones each machine is geofenced to. */
const zoneAssignments = () =>
  apiFetch<{ assignments: { machine_id: string; zone_id: string }[] }>("/v2/zone-assignments").then(
    (r) => r.assignments,
  );

export interface LiveMachine {
  machine_id: string;
  machine_type: string;
  lat: number;
  lng: number;
}

/** Every machine's last reported GPS fix, unscoped. The replay parks idle
 * machines here — it is the one real position each machine has. */
const liveMachines = () =>
  apiFetch<{ machines: BackendMachine[] }>("/v2/machines").then((r) =>
    r.machines.map((m) => ({ machine_id: m.machine_id, machine_type: m.machine_type, lat: num(m.lat), lng: num(m.lng) })),
  );

async function setAlertStatus(id: string, status: "ACKNOWLEDGED" | "RESOLVED", note?: string) {
  const numericId = id.replace(/^EVT-/, "");
  return apiFetch(`/v2/alerts/${numericId}`, {
    method: "PATCH",
    body: JSON.stringify({ status, note }),
  });
}

async function notifications(industry: Industry): Promise<AppNotification[]> {
  const rows = await alerts(industry);
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

// ------------------------------------------------------------ run analytics ---
// The published run is the schedule the solver actually produced, and the
// backend already derives every headline number from it. These reads are the
// real source for the charts and trends that used to be generated client-side.
// Each degrades to null/[] when nothing is published yet (getActiveOr), so a
// fresh database shows an honest empty state instead of a fabricated zero.

export interface RunSummary {
  id: string;
  created_at: string;
  label: string | null;
  horizon_start: string;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  solver_status: string;
  makespan_min: number;
  makespan_days: number;
  lower_bound_min: number;
  greedy_makespan_min: number;
  improvement_vs_greedy_pct: number;
  optimality_gap_pct: number;
  total_busy_min: number;
  n_tasks: number;
  n_portions: number;
  workers_used: number;
  machines_used: number;
  workers_total: number;
  machines_total: number;
  verified: boolean;
  solve_seconds: number;
  assignments_done: number;
  assignments_total: number;
}

export interface UtilizationResource {
  kind: "machine" | "worker";
  resource_id: string;
  detail: string;
  n_tasks: number;
  busy_min: number;
  idle_min: number;
  utilization_pct: number;
}

export interface RunUtilization {
  makespan_min: number;
  summary: {
    resources_total: number;
    resources_used: number;
    resources_idle: number;
    mean_utilization_pct: number;
    mean_utilization_of_used_pct: number;
  };
  resources: UtilizationResource[];
}

/** One point on a resource's fatigue (worker) or engine-temperature (machine)
 * curve, in minutes from the run's horizon start. */
export interface StateSample {
  resource_kind: "machine" | "worker";
  resource_id: string;
  t_min: number;
  value: number;
}

export interface RunWorker {
  worker_id: string;
  worker_status: string;
  skill_level: number;
  n_tasks: number;
  busy_min: number;
  utilization_pct: number;
  start_fatigue: number;
  end_fatigue: number;
  peak_fatigue: number;
  skills: string[];
}

export interface RunMachine {
  machine_id: string;
  machine_type: string;
  machine_status: string;
  n_tasks: number;
  busy_min: number;
  idle_min: number;
  utilization_pct: number;
  start_temp_c: number;
  end_temp_c: number;
  peak_temp_c: number;
}

/**
 * One scheduled portion, keeping the solver's own integer minute offsets.
 * The replay works off start_min/end_min rather than start_at/end_at: the
 * whole point is to compress the horizon onto a different time axis, and
 * minutes-from-zero normalise without any date arithmetic.
 */
export interface ScheduledPortion {
  id: number;
  task_id: string;
  task_type: string;
  industry: string;
  worker_id: string;
  machine_id: string;
  machine_type: string;
  start_min: number;
  end_min: number;
  busy_min: number;
  start_at: string;
  end_at: string;
  status: "PLANNED" | "IN_PROGRESS" | "DONE" | "CANCELLED";
  predicted_duration_min: number | null;
  work_share_pct: number | null;
}

const runSummary = () => getActiveOr<RunSummary | null>("/v1/runs/active", null);

const runList = (limit = 10) =>
  apiFetch<{ runs: RunSummary[] }>(`/v1/runs?limit=${limit}`).then((r) => r.runs);

const runUtilization = () => getActiveOr<RunUtilization | null>("/v1/runs/active/utilization", null);

const runStateSamples = (kind: "worker" | "machine") =>
  getActiveOr<{ samples: StateSample[] }>(`/v1/runs/active/state?kind=${kind}`, { samples: [] }).then(
    (r) => r.samples,
  );

const runWorkers = () =>
  getActiveOr<{ workers: RunWorker[] }>("/v1/runs/active/workers", { workers: [] }).then((r) => r.workers);

const runMachines = () =>
  getActiveOr<{ machines: RunMachine[] }>("/v1/runs/active/machines", { machines: [] }).then(
    (r) => r.machines,
  );

/** Every portion of the published schedule, with solver minute offsets intact. */
const runPortions = () =>
  getActiveOr<{ assignments: ScheduledPortion[] }>("/v1/runs/active/assignments", {
    assignments: [],
  }).then((r) => r.assignments);

export const api = {
  sites,
  roster,
  machines,
  operators,
  tasks,
  alerts,
  notifications,
  zones,
  zoneAssignments,
  liveMachines,
  runSummary,
  runList,
  runUtilization,
  runWorkers,
  runMachines,
  runPortions,
  workerState: () => runStateSamples("worker"),
  machineState: () => runStateSamples("machine"),
  predict,
};

export const mutations = {
  completeTask,
  acknowledgeAlert: (id: string, note?: string) => setAlertStatus(id, "ACKNOWLEDGED", note),
  resolveAlert: (id: string, note?: string) => setAlertStatus(id, "RESOLVED", note),
};

/** Entity keys take the site (industry) as their second element; invalidating
 * by the one-element prefix still reaches every site's cache. */
export const queryKeys = {
  sites: ["sites"] as const,
  roster: ["roster"] as const,
  machines: ["machines"] as const,
  operators: ["operators"] as const,
  tasks: ["tasks"] as const,
  alerts: ["alerts"] as const,
  notifications: ["notifications"] as const,
  zones: ["zones"] as const,
  zoneAssignments: ["zones", "assignments"] as const,
  liveMachines: ["machines", "live-all"] as const,
  health: ["health"] as const,
  runSummary: ["run", "summary"] as const,
  runList: ["run", "list"] as const,
  runUtilization: ["run", "utilization"] as const,
  runWorkers: ["run", "workers"] as const,
  runMachines: ["run", "machines"] as const,
  runPortions: ["run", "portions"] as const,
  workerState: ["run", "state", "worker"] as const,
  machineState: ["run", "state", "machine"] as const,
};
