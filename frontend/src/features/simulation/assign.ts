import type { DraftTask, PredictResult, Roster } from "@/lib/api/client";
import type { SimTask } from "@/stores/sim-store";

/**
 * Pick who does a task, and when. The model (POST /v1/predict) has already
 * ranked every legal worker + machine pairing by predicted duration; this
 * takes the pairing that would *finish* earliest given what the sandbox has
 * already queued on each worker and machine — so a slightly slower pair
 * that is free now beats a faster one that is busy for hours.
 *
 * Workers whose roster status is AVAILABLE are preferred; only if none of
 * them is skilled for the task does it fall back to the rest of the crew.
 */
export function assign(task: DraftTask, result: PredictResult, roster: Roster, queued: SimTask[]): SimTask {
  const workerFree = new Map<string, number>();
  const machineFree = new Map<string, number>();
  for (const q of queued) {
    workerFree.set(q.worker_id, Math.max(workerFree.get(q.worker_id) ?? 0, q.end_min));
    machineFree.set(q.machine_id, Math.max(machineFree.get(q.machine_id) ?? 0, q.end_min));
  }

  const available = new Set(roster.workers.filter((w) => w.status === "AVAILABLE").map((w) => w.worker_id));
  const preferred = result.candidates.filter((c) => available.has(c.worker_id));
  const pool = preferred.length ? preferred : result.candidates;
  if (!pool.length) throw new Error(`No worker and ${task.required_machine_type} pairing for ${task.task_type}.`);

  let best = pool[0];
  let bestStart = 0;
  let bestEnd = Infinity;
  for (const c of pool) {
    const start = Math.max(workerFree.get(c.worker_id) ?? 0, machineFree.get(c.machine_id) ?? 0);
    const end = start + c.predicted_duration_min;
    if (end < bestEnd) {
      best = c;
      bestStart = start;
      bestEnd = end;
    }
  }

  return {
    id: task.task_id,
    task,
    worker_id: best.worker_id,
    worker_skill: best.operator_skill,
    worker_fatigue: best.operator_fatigue,
    machine_id: best.machine_id,
    machine_type: task.required_machine_type,
    predicted_min: best.predicted_duration_min,
    start_min: Math.round(bestStart),
    end_min: Math.round(bestEnd),
  };
}
