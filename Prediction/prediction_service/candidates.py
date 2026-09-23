"""Candidate generation: every (task, worker, machine) triple that is legal.

Filtering happens BEFORE prediction, never after. A worker who cannot operate
the required machine should never reach the model -- predicting a duration for
an assignment that can never happen wastes work and, worse, invites someone
downstream to use the number.
"""

from __future__ import annotations

import pandas as pd

from .complexity import derive_complexity


def eligible_workers(task, workers: pd.DataFrame) -> pd.DataFrame:
    """Workers holding the skill this task type requires."""
    mask = workers["skill_set"].map(lambda s: task.task_type in s)
    return workers[mask]


def eligible_machines(task, machines: pd.DataFrame) -> pd.DataFrame:
    """Machines of the required type. Machines have no availability window --
    they are assumed always available (locked decision)."""
    return machines[machines["machine_type"] == task.required_machine_type]


def task_complexity(task) -> int:
    """Complexity for a task, derived from its contracted work quantity.

    jitter=False, always. The noise term belongs to data generation; at serve
    time it would make the same contract return a different duration on every
    call, which looks like a broken system.
    """
    return derive_complexity(
        task.industry, task.task_type, task.work_quantity, jitter=False
    )


def generate_candidates(tasks: pd.DataFrame,
                        workers: pd.DataFrame,
                        machines: pd.DataFrame) -> pd.DataFrame:
    """One row per legal (task, worker, machine), carrying every field the
    feature builder needs. Complexity is derived once per task, not per
    candidate -- it depends only on the task."""
    rows = []
    for task in tasks.itertuples(index=False):
        complexity = task_complexity(task)
        ws = eligible_workers(task, workers)
        ms = eligible_machines(task, machines)

        if ws.empty or ms.empty:
            raise ValueError(
                f"{task.task_id} ({task.task_type}) has no eligible "
                f"{'workers' if ws.empty else 'machines'} -- the schedule "
                f"cannot be built"
            )

        for w in ws.itertuples(index=False):
            for m in ms.itertuples(index=False):
                rows.append({
                    "task_id": task.task_id,
                    "worker_id": w.worker_id,
                    "machine_id": m.machine_id,
                    "Industry": task.industry,
                    "Task Type": task.task_type,
                    "Weather": task.weather,
                    "Shift Type": task.shift_type,
                    "Task Complexity": complexity,
                    "Operator Skill": w.skill_level,
                    "Operator Fatigue Score": w.current_fatigue,
                    "Machine Age": m.age_years,
                    "Machine Temperature (C)": m.engine_temp_c,
                })

    return pd.DataFrame(rows)


def candidate_summary(candidates: pd.DataFrame) -> str:
    per_task = candidates.groupby("task_id").size()
    return (f"{len(candidates)} candidates over {per_task.size} tasks "
            f"(min {per_task.min()}, median {int(per_task.median())}, "
            f"max {per_task.max()} per task)")
