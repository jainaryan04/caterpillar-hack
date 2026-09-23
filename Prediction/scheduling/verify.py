"""Independent schedule checker (PLAN.md 4.11).

Re-reads the emitted schedule and re-derives every property from the problem
data. It does NOT consult the solver's own report -- a solver that believes it
satisfied a constraint it actually mis-modelled will report success either way.
The point is to catch a wrong MODEL, not a wrong solve.

Work conservation is the check most worth having: it is what catches a broken
divisibility formulation, including the rate/bucket unit mismatch that would
otherwise declare every task finished after a fraction of its work.
"""

from __future__ import annotations

from .problem import SCALE


def verify(p, schedule) -> list[str]:
    """Return a list of violations. Empty list means the schedule is sound."""
    bad: list[str] = []
    by_task = schedule.by_task()

    if not schedule.portions:
        return ["schedule contains no portions at all"]

    missing = set(p.cand_of_task) - set(by_task)
    if missing:
        bad.append(f"{len(missing)} tasks have no portion: {sorted(missing)[:5]}")

    for task_id, portions in by_task.items():
        t = p.task_row[task_id]
        cap = int(t.max_parallel)

        if len(portions) > cap:
            bad.append(f"{task_id}: {len(portions)} portions exceeds max_parallel {cap}")
        if t.execution_mode == "SINGLE" and len(portions) != 1:
            bad.append(f"{task_id}: SINGLE task has {len(portions)} portions")

        # Work conservation -- the load-bearing check.
        delivered = sum(p.rate[(task_id, x.worker_id, x.machine_id)] * x.busy
                        for x in portions)
        if delivered < SCALE:
            bad.append(f"{task_id}: only {delivered} of {SCALE} work units delivered "
                       f"({100 * delivered / SCALE:.1f}%)")

        for x in portions:
            if x.end != x.start + x.busy:
                bad.append(f"{task_id}/{x.worker_id}: end != start + busy")
            if x.busy < 1:
                bad.append(f"{task_id}/{x.worker_id}: portion used with zero time")
            if (task_id, x.worker_id, x.machine_id) not in p.rate:
                bad.append(f"{task_id}: {x.worker_id}+{x.machine_id} is not a legal candidate")

        # A resource must not take two portions of the same task.
        for field, label in (("worker_id", "worker"), ("machine_id", "machine")):
            seen = [getattr(x, field) for x in portions]
            if len(seen) != len(set(seen)):
                bad.append(f"{task_id}: same {label} used twice within the task")

        # Skill and machine-type eligibility, re-derived from the rosters.
        for x in portions:
            w = p.worker_row[x.worker_id]
            if t.task_type not in w.skill_set:
                bad.append(f"{task_id}: {x.worker_id} lacks skill {t.task_type}")
            if p.machine_row[x.machine_id].machine_type != t.required_machine_type:
                bad.append(f"{task_id}: {x.machine_id} is the wrong machine type")
            if x.start < p.avail_from[x.worker_id] or x.end > p.avail_until[x.worker_id]:
                bad.append(f"{task_id}: {x.worker_id} portion outside availability window")

    # No resource overlaps itself anywhere in the schedule.
    for field, label in (("worker_id", "worker"), ("machine_id", "machine")):
        streams: dict = {}
        for x in schedule.portions:
            streams.setdefault(getattr(x, field), []).append(x)
        for rid, items in streams.items():
            items.sort(key=lambda x: x.start)
            for a, b in zip(items, items[1:]):
                if b.start < a.end:
                    bad.append(
                        f"{label} {rid} double-booked: {a.task_id} ends {a.end}, "
                        f"{b.task_id} starts {b.start}"
                    )

    # Stage precedence, per industry.
    task_end = {tid: max(x.end for x in ps) for tid, ps in by_task.items()}
    task_start = {tid: min(x.start for x in ps) for tid, ps in by_task.items()}
    for industry, stages in p.stages_of_industry.items():
        for prev_s, next_s in zip(stages, stages[1:]):
            prev_ids = p.tasks_in[(industry, prev_s)]
            next_ids = p.tasks_in[(industry, next_s)]
            if not prev_ids or not next_ids:
                continue
            latest_prev = max(task_end[t] for t in prev_ids if t in task_end)
            earliest_next = min(task_start[t] for t in next_ids if t in task_start)
            if earliest_next < latest_prev:
                bad.append(
                    f"{industry}: stage {next_s} starts at {earliest_next} before "
                    f"stage {prev_s} finishes at {latest_prev}"
                )

    stated = max(x.end for x in schedule.portions)
    if schedule.makespan != stated:
        bad.append(f"reported makespan {schedule.makespan} != actual last end {stated}")

    return bad
