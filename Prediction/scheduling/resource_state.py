"""Resource state over a tentative schedule: worker fatigue and machine engine
temperature.

The two are structurally the same thing -- a per-resource quantity that
accumulates with use, recovers while idle, and feeds back into the duration
model -- so one walk of the timeline produces both.

This closes the loop the ML model cannot close by itself: fatigue and engine
temperature are model INPUTS, but their values depend on when a task is
scheduled, which is a solver OUTPUT. See run_scheduler.py for how that
circularity is resolved (two passes, not a fixed point).
"""

from __future__ import annotations

from bisect import bisect_right

# Fatigue: ~24 points added over an 8-hour shift of average-complexity work,
# harder work costing more; recovery slower than accumulation; a long break
# (night) clears most of it.
FATIGUE_PER_MIN = 0.05
FATIGUE_COMPLEXITY_SCALE = 0.1   # multiplier = 0.5 + 0.1 * complexity
RECOVERY_PER_MIN = 0.03
OVERNIGHT_GAP_MIN = 480
OVERNIGHT_RETENTION = 0.3

# Engine temperature: rises while running, falls back toward the machine's
# baseline while idle, and never runs away beyond +15 C over baseline.
HEAT_PER_MIN = 0.02
COOL_PER_MIN = 0.05
MAX_RISE_OVER_BASELINE = 15.0
TEMP_FLOOR, TEMP_CEIL = 70.0, 115.0


class Timeline:
    """Piecewise state for one resource, queryable at any point in time."""

    def __init__(self, initial: float):
        self.times = [0]
        self.values = [initial]

    def add(self, t: int, value: float):
        self.times.append(t)
        self.values.append(value)

    def at(self, t: int) -> float:
        i = bisect_right(self.times, t) - 1
        return self.values[max(0, i)]

    def final(self) -> float:
        return self.values[-1]


def simulate(p, schedule):
    """Walk the schedule chronologically and return, for every worker and
    machine, a Timeline of its state.

    Returns (worker_fatigue, machine_temp) keyed by resource id.
    """
    complexity = dict(
        p.candidates.drop_duplicates("task_id")
        .set_index("task_id")["Task Complexity"]
    )

    fatigue = {w.worker_id: Timeline(float(w.current_fatigue))
               for w in p.workers.itertuples(index=False)}
    temp = {m.machine_id: Timeline(float(m.engine_temp_c))
            for m in p.machines.itertuples(index=False)}
    baseline = {m.machine_id: float(m.engine_temp_c)
                for m in p.machines.itertuples(index=False)}

    per_worker, per_machine = {}, {}
    for x in schedule.portions:
        per_worker.setdefault(x.worker_id, []).append(x)
        per_machine.setdefault(x.machine_id, []).append(x)

    for wid, items in per_worker.items():
        items.sort(key=lambda x: x.start)
        level = fatigue[wid].values[0]
        last_end = 0
        for x in items:
            gap = p.to_minutes(x.start - last_end)
            if gap >= OVERNIGHT_GAP_MIN:
                level *= OVERNIGHT_RETENTION
            elif gap > 0:
                level = max(0.0, level - RECOVERY_PER_MIN * gap)
            fatigue[wid].add(x.start, round(level, 1))   # state ENTERING the task

            worked = p.to_minutes(x.busy)
            mult = 0.5 + FATIGUE_COMPLEXITY_SCALE * float(complexity.get(x.task_id, 5))
            level = min(100.0, level + FATIGUE_PER_MIN * worked * mult)
            fatigue[wid].add(x.end, round(level, 1))
            last_end = x.end

    for mid, items in per_machine.items():
        items.sort(key=lambda x: x.start)
        level = temp[mid].values[0]
        base = baseline[mid]
        last_end = 0
        for x in items:
            gap = p.to_minutes(x.start - last_end)
            if gap > 0:
                level = max(base, level - COOL_PER_MIN * gap)
            temp[mid].add(x.start, round(level, 1))

            ran = p.to_minutes(x.busy)
            level = min(base + MAX_RISE_OVER_BASELINE, level + HEAT_PER_MIN * ran)
            level = min(TEMP_CEIL, max(TEMP_FLOOR, level))
            temp[mid].add(x.end, round(level, 1))
            last_end = x.end

    return fatigue, temp


def project_candidate_state(p, schedule, candidates):
    """Re-price the candidate table against the state each resource will
    actually be in when its task starts in the tentative schedule.

    For a candidate the tentative schedule did not use, state is read at that
    task's tentative start time -- which is exactly the question being asked:
    "if I moved this task to this pair, how tired would that operator be by
    then?"
    """
    fatigue, temp = simulate(p, schedule)
    task_start = {}
    for x in schedule.portions:
        task_start[x.task_id] = min(task_start.get(x.task_id, x.start), x.start)

    updated = candidates.copy()
    starts = updated["task_id"].map(task_start).fillna(0).astype(int)
    updated["Operator Fatigue Score"] = [
        fatigue[w].at(t) for w, t in zip(updated["worker_id"], starts)
    ]
    updated["Machine Temperature (C)"] = [
        temp[m].at(t) for m, t in zip(updated["machine_id"], starts)
    ]

    # Simulation can walk outside the range the model was fit on (fatigue to
    # 0 or 100). Tree models clamp to the training range internally anyway, so
    # clipping here changes no prediction -- it just stops us reporting an
    # extrapolation warning for a value the model already treats as the edge.
    from prediction_service.predict import load_model
    _, schema = load_model()
    for col in ("Operator Fatigue Score", "Machine Temperature (C)"):
        spec = schema["numerical_features"][col]
        updated[col] = updated[col].clip(spec["min"], spec["max"])
    return updated


def state_drift(before, after):
    """How far the two feature columns moved between passes."""
    f = (after["Operator Fatigue Score"] - before["Operator Fatigue Score"]).abs()
    t = (after["Machine Temperature (C)"] - before["Machine Temperature (C)"]).abs()
    return {
        "fatigue_mean": float(f.mean()), "fatigue_max": float(f.max()),
        "temp_mean": float(t.mean()), "temp_max": float(t.max()),
        "material": int(((f > 5) | (t > 5)).sum()),
    }
