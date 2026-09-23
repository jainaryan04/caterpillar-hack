"""PlanResult -> plain rows (minutes, JSON-safe).

Everything downstream -- the HTTP response, the Postgres tables, the CSV --
reads these functions, so a figure is computed once and cannot disagree with
itself between the dashboard and the database.

Two conventions hold throughout:
  * every *_min field is MINUTES from the start of the horizon, never buckets;
  * utilisation is measured against the makespan, not against each resource's
    own span -- a machine that works 60 minutes and then sits idle for 900 is
    6% utilised, not 100%.
"""

from __future__ import annotations

from datetime import datetime, timedelta

from .problem import SCALE


def _iso(start_at: datetime | None, minutes: int) -> str | None:
    return (start_at + timedelta(minutes=int(minutes))).isoformat() if start_at else None


def run_summary(res, opts=None) -> dict:
    p, s, g = res.problem, res.schedule, res.greedy
    mk = p.to_minutes(s.makespan)
    gm = p.to_minutes(g.makespan)
    lb = p.to_minutes(res.lower_bound)
    return {
        "solver_status": s.status,
        "makespan_min": mk,
        "makespan_days": round(mk / 1440, 2),
        "lower_bound_min": lb,
        "greedy_makespan_min": gm,
        "improvement_vs_greedy_pct": round(100 * (gm - mk) / gm, 2) if gm else 0.0,
        # Distance from the bound CP-SAT itself proved during this solve.
        "optimality_gap_pct": round(s.gap_pct(), 2) if s.objective_bound else None,
        # Distance from the analytical bound, which is what makes the number
        # mean something when the solver's own bound is weak.
        "gap_vs_analytical_bound_pct": round(100 * (mk - lb) / lb, 2) if lb else None,
        "total_busy_min": p.to_minutes(s.total_busy()),
        "n_tasks": len(s.by_task()),
        # Legal (task, worker, machine) pairings the model priced.
        "n_candidates": res.n_candidates,
        "n_portions": len(s.portions),
        "n_split_tasks": sum(1 for v in s.by_task().values() if len(v) > 1),
        "workers_used": len({x.worker_id for x in s.portions}),
        "machines_used": len({x.machine_id for x in s.portions}),
        "workers_total": len(p.worker_row),
        "machines_total": len(p.machine_row),
        "passes": res.passes,
        "pass1_makespan_min": res.pass1_makespan,
        "verified": not res.violations,
        "violations": list(res.violations),
        "solve_seconds": round(s.solve_seconds, 2),
        "wall_seconds": round(res.wall_seconds, 2),
        "state_drift": res.drift,
        "options": dict(opts.__dict__) if opts else {},
    }


def assignments(res, start_at: datetime | None = None) -> list[dict]:
    """One row per portion -- the unit of work actually dispatched."""
    p = res.problem
    rows = []
    for i, x in enumerate(sorted(res.schedule.portions,
                                 key=lambda z: (z.start, z.task_id, z.machine_id))):
        t = p.task_row[x.task_id]
        key = (x.task_id, x.worker_id, x.machine_id)
        rows.append({
            "seq": i,
            "task_id": x.task_id,
            "task_type": t.task_type,
            "industry": t.industry,
            "stage": int(t.task_priority),
            "execution_mode": t.execution_mode,
            "worker_id": x.worker_id,
            "machine_id": x.machine_id,
            "machine_type": p.machine_row[x.machine_id].machine_type,
            "start_min": p.to_minutes(x.start),
            "end_min": p.to_minutes(x.end),
            "busy_min": p.to_minutes(x.busy),
            "start_at": _iso(start_at, p.to_minutes(x.start)),
            "end_at": _iso(start_at, p.to_minutes(x.end)),
            # Share of the task this portion delivers. Portions of one task sum
            # to >= 100%: the solver may overshoot by up to one bucket, and
            # under parallel-efficiency losses the target itself exceeds 100%.
            "work_share_pct": round(100 * p.rate[key] * x.busy / SCALE, 1),
            "predicted_duration_min": p.to_minutes(p.dur[key]),
            "status": "PLANNED",
        })
    return rows


def task_summary(res, start_at: datetime | None = None) -> list[dict]:
    p = res.problem
    rows = []
    for tid, portions in res.schedule.by_task().items():
        t = p.task_row[tid]
        start = min(x.start for x in portions)
        end = max(x.end for x in portions)
        fastest = min(p.dur[(tid, w, m)] for (w, m) in p.cand_of_task[tid])
        rows.append({
            "task_id": tid,
            "task_type": t.task_type,
            "industry": t.industry,
            "stage": int(t.task_priority),
            "execution_mode": t.execution_mode,
            "max_parallel": int(t.max_parallel),
            "work_quantity": float(t.work_quantity),
            "work_unit": t.work_unit,
            "required_machine_type": t.required_machine_type,
            "weather": t.weather,
            "shift_type": t.shift_type,
            "start_min": p.to_minutes(start),
            "end_min": p.to_minutes(end),
            "span_min": p.to_minutes(end - start),
            "busy_min": p.to_minutes(sum(x.busy for x in portions)),
            "start_at": _iso(start_at, p.to_minutes(start)),
            "end_at": _iso(start_at, p.to_minutes(end)),
            "n_portions": len(portions),
            "workers": sorted({x.worker_id for x in portions}),
            "machines": sorted({x.machine_id for x in portions}),
            # What this task would have taken on its single best pair, alone.
            "fastest_solo_min": p.to_minutes(fastest),
            "status": "PLANNED",
        })
    return sorted(rows, key=lambda r: (r["start_min"], r["task_id"]))


def machine_usage(res) -> list[dict]:
    """What each machine did: hours on the clock, what it worked on, and how
    hot it ended up. Machines not used at all are still listed -- an idle asset
    is the most actionable row on the page."""
    p, s = res.problem, res.schedule
    mk = max(1, p.to_minutes(s.makespan))
    by_machine: dict = {}
    for x in s.portions:
        by_machine.setdefault(x.machine_id, []).append(x)

    rows = []
    for m in p.machines.itertuples(index=False):
        items = sorted(by_machine.get(m.machine_id, []), key=lambda z: z.start)
        busy = p.to_minutes(sum(x.busy for x in items))
        tl = res.temp.get(m.machine_id)
        span_start = p.to_minutes(items[0].start) if items else None
        span_end = p.to_minutes(items[-1].end) if items else None
        rows.append({
            "machine_id": m.machine_id,
            "machine_type": m.machine_type,
            "age_years": float(m.age_years),
            "n_tasks": len({x.task_id for x in items}),
            "busy_min": busy,
            "idle_min": mk - busy,
            "utilization_pct": round(100 * busy / mk, 1),
            "first_start_min": span_start,
            "last_end_min": span_end,
            "start_temp_c": float(m.engine_temp_c),
            "end_temp_c": round(tl.final(), 1) if tl else float(m.engine_temp_c),
            "peak_temp_c": round(max(tl.values), 1) if tl else float(m.engine_temp_c),
            "tasks": [
                {"task_id": x.task_id,
                 "task_type": p.task_row[x.task_id].task_type,
                 "worker_id": x.worker_id,
                 "start_min": p.to_minutes(x.start),
                 "end_min": p.to_minutes(x.end),
                 "busy_min": p.to_minutes(x.busy)}
                for x in items
            ],
        })
    return sorted(rows, key=lambda r: -r["utilization_pct"])


def worker_usage(res) -> list[dict]:
    p, s = res.problem, res.schedule
    mk = max(1, p.to_minutes(s.makespan))
    by_worker: dict = {}
    for x in s.portions:
        by_worker.setdefault(x.worker_id, []).append(x)

    rows = []
    for w in p.workers.itertuples(index=False):
        items = sorted(by_worker.get(w.worker_id, []), key=lambda z: z.start)
        busy = p.to_minutes(sum(x.busy for x in items))
        tl = res.fatigue.get(w.worker_id)
        rows.append({
            "worker_id": w.worker_id,
            "skills": sorted(w.skill_set),
            "skill_level": int(w.skill_level),
            "n_tasks": len({x.task_id for x in items}),
            "busy_min": busy,
            "idle_min": mk - busy,
            "utilization_pct": round(100 * busy / mk, 1),
            "start_fatigue": float(w.current_fatigue),
            "end_fatigue": round(tl.final(), 1) if tl else float(w.current_fatigue),
            "peak_fatigue": round(max(tl.values), 1) if tl else float(w.current_fatigue),
            "available_from_min": p.to_minutes(p.avail_from[w.worker_id]),
            "available_until_min": p.to_minutes(p.avail_until[w.worker_id]),
            "tasks": [
                {"task_id": x.task_id,
                 "task_type": p.task_row[x.task_id].task_type,
                 "machine_id": x.machine_id,
                 "start_min": p.to_minutes(x.start),
                 "end_min": p.to_minutes(x.end),
                 "busy_min": p.to_minutes(x.busy)}
                for x in items
            ],
        })
    return sorted(rows, key=lambda r: -r["utilization_pct"])


def bottlenecks(res) -> list[dict]:
    """Per-industry chain bounds. The largest one IS the makespan floor, and
    the reason it is large is almost always the roster, not the solver."""
    p = res.problem
    if not res.chains:
        return []
    worst = max(res.chains.values())
    mk = p.to_minutes(res.schedule.makespan) or 1
    rows = []
    for industry, val in res.chains.items():
        minutes = p.to_minutes(val)
        rows.append({
            "industry": industry,
            "chain_bound_min": minutes,
            "is_critical": val == worst,
            # How much of the achieved makespan this chain alone forces.
            "share_of_makespan_pct": round(100 * minutes / mk, 1),
        })
    return sorted(rows, key=lambda r: -r["chain_bound_min"])


def state_samples(res, kind: str = "both") -> list[dict]:
    """Flattened fatigue / temperature timelines, for charting."""
    p = res.problem
    out = []
    if kind in ("both", "worker"):
        for wid, tl in res.fatigue.items():
            for t, v in zip(tl.times, tl.values):
                out.append({"resource_kind": "worker", "resource_id": wid,
                            "t_min": p.to_minutes(t), "value": round(float(v), 2)})
    if kind in ("both", "machine"):
        for mid, tl in res.temp.items():
            for t, v in zip(tl.times, tl.values):
                out.append({"resource_kind": "machine", "resource_id": mid,
                            "t_min": p.to_minutes(t), "value": round(float(v), 2)})
    return out


def gantt(res, start_at: datetime | None = None) -> list[dict]:
    """FullCalendar-shaped rows: one event per portion, grouped by machine."""
    return [{
        "id": f"{a['task_id']}:{a['machine_id']}",
        "resourceId": a["machine_id"],
        "title": f"{a['task_id']} {a['task_type']}",
        "start": a["start_at"] or a["start_min"],
        "end": a["end_at"] or a["end_min"],
        "extendedProps": {
            "task_id": a["task_id"], "worker_id": a["worker_id"],
            "machine_id": a["machine_id"], "industry": a["industry"],
            "stage": a["stage"], "busy_min": a["busy_min"],
            "work_share_pct": a["work_share_pct"], "status": a["status"],
        },
    } for a in assignments(res, start_at)]
