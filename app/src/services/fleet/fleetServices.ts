import type { Operator } from '@/types/domain';
import { selectMyTasks } from '@/utils/schedule';
import { ApiError } from '../http';
import {
  NoPublishedPlanError,
  type ConnectionService,
  type ConnectionState,
  type OperatorService,
  type TaskService,
} from '../types';
import { fleetApi } from './fleetApi';
import { assignmentToTask, statusToApi, workerToOperator } from './fleetMappers';
import type { RostersResponse, RosterTask } from './fleetTypes';

// Rosters change rarely (a CSV sync), so they are fetched once per session.
let rostersPromise: Promise<RostersResponse> | null = null;

function rosters(): Promise<RostersResponse> {
  if (!rostersPromise) {
    // Postgres holds statuses; fall back to the CSV roster if the DB is unavailable.
    rostersPromise = fleetApi.rosters('db').catch(() => fleetApi.rosters('csv'));
    rostersPromise.catch(() => {
      rostersPromise = null;
    });
  }
  return rostersPromise;
}

async function rosterTaskIndex(): Promise<Map<string, RosterTask>> {
  try {
    const r = await rosters();
    return new Map(r.tasks.map((t) => [t.task_id, t]));
  } catch {
    // Task cards still render without weather / quantity.
    return new Map();
  }
}

function isNoPlan(e: unknown) {
  return e instanceof ApiError && e.status === 404;
}

export const fleetOperatorService: OperatorService = {
  async listOperators() {
    const [r, workload] = await Promise.all([
      rosters(),
      fleetApi.activeWorkers().catch(() => null),
    ]);
    const planned = new Map((workload?.workers ?? []).map((w) => [w.worker_id, w.work_done?.length ?? w.n_tasks]));
    return r.workers
      .map((w) => workerToOperator(w, planned.get(w.worker_id)))
      .sort((a, b) => a.id.localeCompare(b.id));
  },

  async getOperator(workerId) {
    const list = await fleetOperatorService.listOperators();
    const found = list.find((o: Operator) => o.id === workerId);
    if (!found) throw new ApiError(`Worker ${workerId} is not on the roster.`, 404);
    return found;
  },
};

/** The worker's rows in the live plan, with "nothing published" as its own error. */
async function myRows(workerId: string) {
  try {
    const [{ assignments }, index] = await Promise.all([fleetApi.myAssignments(workerId), rosterTaskIndex()]);
    return { assignments, index };
  } catch (e) {
    if (isNoPlan(e)) throw new NoPublishedPlanError();
    throw e;
  }
}

export const fleetTaskService: TaskService = {
  async getMyTasks(workerId) {
    const { assignments, index } = await myRows(workerId);
    return selectMyTasks(assignments.map((a) => assignmentToTask(a, index.get(a.task_id))));
  },

  async getTask(workerId, taskId) {
    const { assignments, index } = await myRows(workerId);
    const row = assignments.find((a) => String(a.id) === taskId);
    if (!row) throw new ApiError('This task is no longer in your plan. It may have been re-planned.', 404);
    return assignmentToTask(row, index.get(row.task_id));
  },

  async updateTaskStatus(taskId, status) {
    const apiStatus = statusToApi[status];
    if (!apiStatus) throw new ApiError(`Cannot set a task to ${status} from the app.`, 400);
    const [row, index] = await Promise.all([fleetApi.updateAssignment(taskId, apiStatus), rosterTaskIndex()]);
    return assignmentToTask(row, index.get(row.task_id));
  },
};

/** Polls /health. `degraded` = the API is up but its database is not. */
const POLL_MS = 20000;
let state: ConnectionState = 'online';
const listeners = new Set<(s: ConnectionState) => void>();
let timer: ReturnType<typeof setInterval> | null = null;

async function check() {
  let next: ConnectionState;
  try {
    const h = await fleetApi.health();
    next = h.database === 'connected' ? 'online' : 'degraded';
  } catch {
    next = 'offline';
  }
  if (next !== state) {
    state = next;
    listeners.forEach((l) => l(state));
  }
}

export const fleetConnectionService: ConnectionService = {
  getState: () => state,
  subscribe(listener) {
    listeners.add(listener);
    if (!timer) {
      check();
      timer = setInterval(check, POLL_MS);
    }
    return () => {
      listeners.delete(listener);
      if (!listeners.size && timer) {
        clearInterval(timer);
        timer = null;
      }
    };
  },
};
