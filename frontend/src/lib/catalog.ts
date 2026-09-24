/**
 * The prediction model's closed world, mirrored for the UI.
 *
 * `Prediction/models/feature_schema.json` lists the only Industry / Task Type /
 * Weather / Shift Type values the model was fit on; anything else makes
 * `check_schema()` reject the request with a 422 at POST /v1/plan or
 * /v1/predict time. Every picker that feeds a task to the backend reads its
 * options from here, so an out-of-schema value can't be selected, let alone
 * sent.
 *
 * Per-task-type volumes and difficulty come from
 * `Prediction/prediction_service/complexity.py` (VOLUME, TASK_DIFFICULTY) —
 * the same table the model derives Task Complexity from. The required machine
 * type and default execution mode per task type are the roster's own
 * (`/v1/rosters`: each task type maps to exactly one machine type and one
 * mode across all 110 tasks).
 */

export const INDUSTRIES = ["Mining", "Construction", "Oil & Gas", "Data Center Power", "Marine & Rail"] as const;
export type Industry = (typeof INDUSTRIES)[number];
export const DEFAULT_INDUSTRY: Industry = "Mining";

export const WEATHER = ["Sunny", "Cloudy", "Rainy", "Foggy"] as const;
export type Weather = (typeof WEATHER)[number];

export const SHIFT_TYPES = ["Day", "Night"] as const;
export type ShiftType = (typeof SHIFT_TYPES)[number];

export type ExecutionMode = "SINGLE" | "PARALLEL";

export interface TaskTypeSpec {
  industry: Industry;
  /** The only machine type the solver will pair this task with. */
  machineType: string;
  unit: string;
  /** complexity.py VOLUME: smallest / ordinary / largest single contract. */
  low: number;
  typical: number;
  high: number;
  /** complexity.py TASK_DIFFICULTY, 0..1. */
  difficulty: number;
  /** Roster default; the planner may override. */
  executionMode: ExecutionMode;
  maxParallel: number;
}

const spec = (
  industry: Industry,
  machineType: string,
  unit: string,
  [low, typical, high]: [number, number, number],
  difficulty: number,
  executionMode: ExecutionMode,
  maxParallel: number,
): TaskTypeSpec => ({ industry, machineType, unit, low, typical, high, difficulty, executionMode, maxParallel });

export const TASK_TYPE_SPECS = {
  // Mining
  "Surface Excavation": spec("Mining", "Excavator", "m3", [400, 1550, 6000], 0.6, "PARALLEL", 3),
  "Hauling Ore": spec("Mining", "Haul Truck", "tonnes", [150, 550, 2000], 0.3, "PARALLEL", 4),
  "Aggregate Collection": spec("Mining", "Wheel Loader", "tonnes", [80, 310, 1200], 0.25, "PARALLEL", 3),
  Drilling: spec("Mining", "Rotary Drill Rig", "m drilled", [40, 150, 500], 0.7, "PARALLEL", 3),
  // Construction
  "Site Preparation": spec("Construction", "Bulldozer", "m2", [800, 4000, 20000], 0.35, "PARALLEL", 3),
  Excavation: spec("Construction", "Excavator", "m3", [100, 500, 2500], 0.55, "PARALLEL", 3),
  "Road Building": spec("Construction", "Motor Grader", "km", [0.3, 1.35, 6], 0.65, "PARALLEL", 2),
  "Foundation Work": spec("Construction", "Mobile Crane", "m3", [15, 67, 300], 0.75, "PARALLEL", 2),
  "Material Loading": spec("Construction", "Wheel Loader", "tonnes", [50, 212, 900], 0.2, "PARALLEL", 3),
  Demolition: spec("Construction", "Excavator", "m3", [80, 346, 1500], 0.7, "PARALLEL", 2),
  // Oil & Gas
  "Well Drilling": spec("Oil & Gas", "Drilling Rig", "m drilled", [40, 155, 600], 0.9, "SINGLE", 1),
  "Well Servicing": spec("Oil & Gas", "Well Service Rig", "m tubing", [150, 600, 2400], 0.75, "SINGLE", 1),
  "Pipeline Pumping": spec("Oil & Gas", "Pipeline Pump", "m3", [100, 447, 2000], 0.35, "SINGLE", 1),
  "Gas Compression Service": spec("Oil & Gas", "Gas Compressor", "service pts", [4, 14, 50], 0.6, "SINGLE", 1),
  // Data Center Power
  "Generator Maintenance": spec("Data Center Power", "Service Truck", "service pts", [5, 17, 60], 0.55, "SINGLE", 1),
  "Backup Generator Testing": spec("Data Center Power", "Generator Test Unit", "kW tested", [200, 800, 3200], 0.35, "SINGLE", 1),
  "Emergency Power Deployment": spec("Data Center Power", "Emergency Generator", "kW deployed", [250, 1000, 4000], 0.8, "SINGLE", 1),
  "Cooling System Inspection": spec("Data Center Power", "Inspection Kit", "units", [2, 8, 30], 0.25, "SINGLE", 1),
  // Marine & Rail
  "Freight Operations": spec("Marine & Rail", "Locomotive", "tonnes", [250, 1225, 6000], 0.4, "PARALLEL", 2),
  "Locomotive Maintenance": spec("Marine & Rail", "Maintenance Vehicle", "service pts", [6, 20, 70], 0.65, "SINGLE", 1),
  "Rail Network Inspection": spec("Marine & Rail", "Rail Inspection Vehicle", "km track", [3, 14.5, 70], 0.35, "PARALLEL", 2),
  "Tugboat Engine Service": spec("Marine & Rail", "Marine Service Vessel", "service pts", [5, 16.6, 55], 0.6, "SINGLE", 1),
} satisfies Record<string, TaskTypeSpec>;

/** One of the 22 task types the model knows. */
export type TaskType = keyof typeof TASK_TYPE_SPECS;

const TASK_TYPE_LIST = Object.keys(TASK_TYPE_SPECS) as TaskType[];

export function isTaskType(value: string): value is TaskType {
  return value in TASK_TYPE_SPECS;
}

export function isIndustry(value: string | null | undefined): value is Industry {
  return (INDUSTRIES as readonly string[]).includes(value ?? "");
}

export function taskTypesFor(industry: Industry): TaskType[] {
  return TASK_TYPE_LIST.filter((t) => TASK_TYPE_SPECS[t].industry === industry);
}

/** Machine types an industry's tasks actually require — its equipment scope. */
export function machineTypesFor(industry: Industry): Set<string> {
  return new Set(taskTypesFor(industry).map((t) => TASK_TYPE_SPECS[t].machineType));
}

/** complexity.py COUNT_UNITS: quantities in these must be whole numbers. */
export const COUNT_UNITS = new Set(["service pts", "units"]);

/** Low/medium/high bucket of the model's own per-type difficulty weight. */
export function complexityBucket(taskType: string): "low" | "medium" | "high" {
  const d = isTaskType(taskType) ? TASK_TYPE_SPECS[taskType].difficulty : 0.5;
  if (d > 0.65) return "high";
  if (d >= 0.4) return "medium";
  return "low";
}
