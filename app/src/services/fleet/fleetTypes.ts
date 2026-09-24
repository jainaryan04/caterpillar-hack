/**
 * Raw response shapes of the Fleet Scheduler API (Prediction/api), as returned
 * by FastAPI. Only the fields the app reads are listed. See Prediction/API.md
 * and Prediction/db/schema.sql.
 */

export type AssignmentStatus = 'PLANNED' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';

/** One row of `assignments`: a contiguous block of one task on one worker + machine. */
export interface AssignmentRow {
  id: number;
  run_id: string;
  task_id: string;
  task_type: string;
  industry: string;
  stage: number;
  execution_mode: 'SINGLE' | 'PARALLEL';
  worker_id: string;
  machine_id: string;
  machine_type: string;
  start_min: number;
  end_min: number;
  busy_min: number;
  start_at: string | null;
  end_at: string | null;
  /** numeric -> may arrive as a string */
  work_share_pct: number | string;
  predicted_duration_min: number;
  status: AssignmentStatus;
  actual_start_at: string | null;
  actual_end_at: string | null;
  notes: string | null;
}

export interface AssignmentsResponse {
  run_id: string;
  assignments: AssignmentRow[];
}

export interface RosterTask {
  task_id: string;
  task_type: string;
  industry: string;
  task_priority: number;
  work_quantity: number | string;
  work_unit: string;
  weather: string;
  shift_type: string;
  execution_mode: 'SINGLE' | 'PARALLEL';
  max_parallel: number;
  required_machine_type: string;
}

export interface RosterWorker {
  worker_id: string;
  skill_set?: string[];
  skill_level: number;
  current_fatigue: number | string;
  status?: string;
}

export interface RosterMachine {
  machine_id: string;
  machine_type: string;
  age_years: number | string;
  engine_temp_c: number | string;
}

export interface RostersResponse {
  source: 'csv' | 'db';
  tasks: RosterTask[];
  workers: RosterWorker[];
  machines: RosterMachine[];
}

export interface WorkerWorkloadResponse {
  run_id: string;
  workers: { worker_id: string; n_tasks?: number; work_done?: unknown[] }[];
}

export interface HealthResponse {
  status: string;
  model_loaded: boolean;
  database: 'connected' | 'configured-but-unreachable' | 'not-configured';
}
