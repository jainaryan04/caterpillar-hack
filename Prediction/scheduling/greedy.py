"""Greedy list scheduler.

Two jobs, both necessary:

 1. **Baseline.** "CP-SAT optimised the schedule" is unfalsifiable without
    something to beat. This gives the comparison number.
 2. **Hint and horizon.** Its solution seeds CP-SAT via AddHint, so a solve
    that hits the time limit can never return something worse than greedy, and
    its makespan becomes the horizon, which collapses every variable domain
    from the 30-day roster window down to something achievable.

It honours the same rules as the CP-SAT model -- per-industry stage
precedence, no resource overlap, worker availability. A greedy that cheated on
those would produce both a meaningless comparison and an infeasible hint.

It assigns ONE (worker, machine) pair per task: no parallel splitting. That is
deliberate. Parallelism is part of what CP-SAT is supposed to buy us, so
leaving it out of the baseline keeps the comparison honest about where the
improvement comes from.
"""

from __future__ import annotations

import time

from .problem import Portion, Schedule


def greedy_schedule(p, precedence_mode: str = "per_industry") -> Schedule:
    worker_free: dict[str, int] = {w: 0 for w in p.worker_row}
    machine_free: dict[str, int] = {m: 0 for m in p.machine_row}
    # (industry, stage) -> when every task of that stage has finished
    stage_done: dict[tuple, int] = {}

    t0 = time.time()
    portions: list[Portion] = []

    # Stage order globally ensures an industry's stage s-1 is placed before its
    # stage s. Across industries the order is irrelevant -- their chains are
    # independent, and they interact only through shared machines.
    ordered = sorted(
        p.task_row.values(),
        key=lambda t: (t.task_priority, t.industry, t.task_id),
    )

    all_stages = sorted({z.task_priority for z in p.task_row.values()})

    for t in ordered:
        if precedence_mode == "global":
            pos = all_stages.index(t.task_priority)
            ready = stage_done.get(("__all__", all_stages[pos - 1]), 0) if pos > 0 else 0
            key = ("__all__", t.task_priority)
        else:
            stages = p.stages_of_industry[t.industry]
            pos = stages.index(t.task_priority)
            ready = stage_done.get((t.industry, stages[pos - 1]), 0) if pos > 0 else 0
            key = (t.industry, t.task_priority)

        best = None
        for (w, m) in p.cand_of_task[t.task_id]:
            dur = p.dur[(t.task_id, w, m)]
            start = max(ready, worker_free[w], machine_free[m], p.avail_from[w])
            end = start + dur
            if end > p.avail_until[w]:
                continue  # cannot fit inside this worker's window
            if best is None or end < best[0]:
                best = (end, start, dur, w, m)

        if best is None:
            raise RuntimeError(
                f"greedy could not place {t.task_id} ({t.task_type}) inside any "
                f"eligible worker's availability window"
            )

        end, start, dur, w, m = best
        worker_free[w] = end
        machine_free[m] = end
        portions.append(Portion(t.task_id, w, m, start, dur, end))

        stage_done[key] = max(stage_done.get(key, 0), end)

    makespan = max(x.end for x in portions)
    return Schedule(
        portions=portions,
        makespan=makespan,
        objective_bound=0.0,
        status="GREEDY",
        solve_seconds=time.time() - t0,
        source="greedy",
    )
