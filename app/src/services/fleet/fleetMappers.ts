import { procedureFor, videosFor } from '@/content/procedures';
import type { Operator, Task, TaskStatus, WorkerStatus } from '@/types/domain';
import type { AssignmentRow, AssignmentStatus, RosterTask, RosterWorker } from './fleetTypes';

const toNumber = (v: number | string | null | undefined) => (v == null ? undefined : Number(v));

const hhmm = (iso: string | null) => {
  if (!iso) return '--:--';
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export const statusFromApi: Record<AssignmentStatus, TaskStatus> = {
  PLANNED: 'pending',
  IN_PROGRESS: 'in_progress',
  DONE: 'completed',
  CANCELLED: 'cancelled',
};

/** The only transitions an operator can make from the phone. */
export const statusToApi: Partial<Record<TaskStatus, AssignmentStatus>> = {
  pending: 'PLANNED',
  in_progress: 'IN_PROGRESS',
  completed: 'DONE',
};

/**
 * PARALLEL only means the task *may* be split. It was split when this portion
 * carries less than the whole job (split portions each deliver < 100%).
 */
function isSplit(a: AssignmentRow, share: number | undefined): share is number {
  return a.execution_mode === 'PARALLEL' && share !== undefined && share < 100;
}

function describe(a: AssignmentRow, t: RosterTask | undefined, share: number | undefined): string {
  const qty = t ? `${Number(t.work_quantity)} ${t.work_unit}` : undefined;
  const parts = [
    `${a.task_type} for ${a.industry}, stage ${a.stage}${qty ? `: ${qty} in total` : ''}.`,
    isSplit(a, share)
      ? `This task is shared between crews. Your portion on ${a.machine_id} is about ${Math.round(share)}% of the work.`
      : undefined,
    t ? `Planned conditions: ${t.weather}, ${t.shift_type.toLowerCase()} shift.` : undefined,
    `Estimated ${a.busy_min} min on ${a.machine_type} ${a.machine_id} (task ${a.task_id}).`,
  ];
  return parts.filter(Boolean).join(' ');
}

/** One assignment (portion) becomes one Task card. Its id is the assignment id. */
export function assignmentToTask(a: AssignmentRow, rosterTask?: RosterTask): Task {
  const share = toNumber(a.work_share_pct);
  const procedure = procedureFor(a.task_type, rosterTask?.weather, rosterTask?.shift_type);
  const videos = videosFor(a.machine_type);
  return {
    id: String(a.id),
    title: a.task_type,
    machineId: a.machine_id,
    machine: `${a.machine_type} · ${a.machine_id}`,
    location: `${a.industry} · Stage ${a.stage}`,
    estimatedMinutes: a.busy_min,
    status: statusFromApi[a.status],
    // Stage 1 work gates everything after it in the same industry.
    priority: a.stage === 1 ? 'high' : 'normal',
    scheduledStart: hhmm(a.start_at),
    completedAt: a.actual_end_at ? hhmm(a.actual_end_at) : undefined,
    blockedReason: a.status === 'CANCELLED' ? 'Cancelled by the supervisor' : undefined,
    description: describe(a, rosterTask, share),
    safetyChecklist: procedure.safetyChecklist,
    steps: procedure.steps,
    tutorialVideoId: videos.tutorialVideoId,
    relatedVideoIds: videos.relatedVideoIds,
    taskCode: a.task_id,
    industry: a.industry,
    stage: a.stage,
    scheduledStartAt: a.start_at ?? undefined,
    scheduledEndAt: a.end_at ?? undefined,
    weather: rosterTask?.weather,
    shiftType: rosterTask?.shift_type,
    workQuantity: toNumber(rosterTask?.work_quantity),
    workUnit: rosterTask?.work_unit,
    workSharePct: share,
    parallel: isSplit(a, share),
  };
}

const WORKER_STATUSES: WorkerStatus[] = ['AVAILABLE', 'RESERVED', 'IN_USE', 'OFF_DUTY'];

export function workerToOperator(w: RosterWorker, plannedAssignments?: number): Operator {
  return {
    id: w.worker_id,
    name: w.worker_id,
    skills: w.skill_set ?? [],
    skillLevel: w.skill_level,
    fatigue: toNumber(w.current_fatigue) ?? 0,
    status: WORKER_STATUSES.includes(w.status as WorkerStatus) ? (w.status as WorkerStatus) : 'AVAILABLE',
    plannedAssignments,
  };
}
