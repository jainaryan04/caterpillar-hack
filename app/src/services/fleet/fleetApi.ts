import { config } from '@/config';
import { request } from '../http';
import type {
  AssignmentRow,
  AssignmentsResponse,
  AssignmentStatus,
  HealthResponse,
  RostersResponse,
  WorkerWorkloadResponse,
} from './fleetTypes';

/** Thin, typed wrappers over the Fleet Scheduler endpoints the operator app uses. */
const base = () => config.fleetApiUrl;

export const fleetApi = {
  health: () => request<HealthResponse>(base(), '/health', { timeoutMs: 5000 }),

  rosters: (source: 'db' | 'csv') => request<RostersResponse>(base(), `/v1/rosters?source=${source}`, { timeoutMs: 15000 }),

  /** `active` = the currently PUBLISHED run. 404 when nothing is published. */
  myAssignments: (workerId: string) =>
    request<AssignmentsResponse>(
      base(),
      `/v1/runs/active/assignments?worker_id=${encodeURIComponent(workerId)}`,
      { timeoutMs: 15000 },
    ),

  activeWorkers: () => request<WorkerWorkloadResponse>(base(), '/v1/runs/active/workers', { timeoutMs: 15000 }),

  /** Stamps actual start/end server-side and moves machine + operator status. */
  updateAssignment: (assignmentId: number | string, status: AssignmentStatus) =>
    request<AssignmentRow>(base(), `/v1/assignments/${assignmentId}`, { method: 'PATCH', body: { status } }),
};
