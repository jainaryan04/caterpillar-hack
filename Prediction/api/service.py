"""Orchestration: rosters in, persisted plan out.

This is the only place that knows the whole sequence -- resolve rosters,
predict, solve, verify, persist, publish. The routes below it do HTTP; the
engine above it does mathematics; neither knows about the other.

Everything CPU-bound runs in a worker thread (see main.py): a 20-second solve
on the event loop would block every other request, including the health check.
"""

from __future__ import annotations

from datetime import datetime, timezone

import pandas as pd

from prediction_service.candidates import generate_candidates
from prediction_service.loaders import load_all, parse_skills
from prediction_service.predict import predict_durations
from scheduling import summary as S
from scheduling.engine import PlanOptions, plan

from .schemas import PlanRequest, PredictRequest
from .settings import settings
from .store import store


class PlanningError(RuntimeError):
    """The request cannot produce a schedule -- bad rosters, or no solution."""


# ------------------------------------------------------------------ rosters ---

def _tasks_frame(rows) -> pd.DataFrame:
    df = pd.DataFrame([r.model_dump() for r in rows])
    df["max_parallel"] = df["max_parallel"].astype(int)
    df["task_priority"] = df["task_priority"].astype(int)
    return df


def _workers_frame(rows) -> pd.DataFrame:
    df = pd.DataFrame([r.model_dump() for r in rows])
    # Inline skills arrive as a list; the rest of the system expects both the
    # delimited string and the parsed set, exactly as the CSV loader produces.
    df["skills"] = df["skills"].map("; ".join)
    df["skill_set"] = df["skills"].map(parse_skills)
    return df


def _machines_frame(rows) -> pd.DataFrame:
    return pd.DataFrame([r.model_dump() for r in rows])


def resolve_rosters(req: PlanRequest):
    """Inline rosters win field by field; whatever is missing comes from
    `source`. This is what makes "same site, but these three tasks" a one-field
    request instead of a full payload."""
    need_base = not (req.tasks and req.workers and req.machines)
    if need_base:
        base = store.read_rosters() if req.source == "db" else load_all()
    else:
        base = (None, None, None)

    tasks = _tasks_frame(req.tasks) if req.tasks else base[0]
    workers = _workers_frame(req.workers) if req.workers else base[1]
    machines = _machines_frame(req.machines) if req.machines else base[2]

    for name, df in (("tasks", tasks), ("workers", workers), ("machines", machines)):
        if df is None or df.empty:
            raise PlanningError(f"no {name} to plan with")
    return tasks, workers, machines


# --------------------------------------------------------------- the plan ---

def run_plan(req: PlanRequest) -> dict:
    tasks, workers, machines = resolve_rosters(req)

    opts = PlanOptions(
        # A caller cannot buy unlimited solver time; one long request would
        # otherwise occupy a thread and starve everything queued behind it.
        seconds=min(req.options.seconds, settings.max_seconds_limit),
        bucket=req.options.bucket,
        two_pass=req.options.two_pass,
        parallel_efficiency=req.options.parallel_efficiency,
        task_continuity=req.options.task_continuity,
        precedence_mode=req.options.precedence_mode,
    )

    try:
        res = plan(tasks, workers, machines, opts)
    except ValueError as e:
        # generate_candidates raises this when a task has no eligible worker or
        # machine. That is a roster problem the caller can fix, not a bug.
        raise PlanningError(str(e)) from e

    if not res.schedule.portions:
        raise PlanningError(
            f"no feasible schedule within {opts.seconds:.0f}s (solver said "
            f"{res.schedule.status or 'UNKNOWN'}); try raising options.seconds"
        )

    start_at = req.horizon_start or datetime.now(timezone.utc)
    summary = S.run_summary(res, opts)
    sections = {
        "assignments": S.assignments(res, start_at),
        "tasks": S.task_summary(res, start_at),
        "machines": S.machine_usage(res),
        "workers": S.worker_usage(res),
        "bottlenecks": S.bottlenecks(res),
    }

    run_id, persisted, published = None, False, False
    if req.persist:
        if not store.enabled:
            raise PlanningError("persist=true but DATABASE_URL is not configured")
        # The rosters this run references must exist before the run does:
        # assignments carry foreign keys to tasks, workers and machines.
        store.sync_rosters(tasks, workers, machines)
        run_id = store.save_run(
            summary=summary, assignments=sections["assignments"],
            tasks=sections["tasks"], machines=sections["machines"],
            workers=sections["workers"], bottlenecks=sections["bottlenecks"],
            samples=S.state_samples(res), horizon_start=start_at, label=req.label)
        persisted = True
        if req.publish:
            store.publish_run(run_id)
            published = True

    summary["run_id"] = run_id
    out = {"run_id": run_id, "persisted": persisted, "published": published,
           "horizon_start": start_at, "summary": summary}
    for key in req.include:
        if key == "gantt":
            out["gantt"] = S.gantt(res, start_at)
        elif key == "state":
            out["state"] = S.state_samples(res)
        else:
            out[key] = sections[key]
    return out


# --------------------------------------------------------------- predict ---

def run_predict(req: PredictRequest) -> dict:
    """Rank the legal pairings for one task by predicted duration.

    Returns every legal pair, sorted, plus the spread -- because the spread is
    the honest part. When the top ten candidates sit inside the model's error
    bar they are interchangeable, and picking between them is a scheduling
    decision, not a prediction one.
    """
    tasks = _tasks_frame([req.task])
    workers = _workers_frame(req.workers)
    machines = _machines_frame(req.machines)

    try:
        cand = predict_durations(generate_candidates(tasks, workers, machines),
                                 verbose=False)
    except ValueError as e:
        raise PlanningError(str(e)) from e

    cand = cand.sort_values("predicted_duration")
    # to_dict, not itertuples: the feature columns have spaces in their names
    # and itertuples silently renames them to positional placeholders.
    rows = [{
        "worker_id": r["worker_id"], "machine_id": r["machine_id"],
        "predicted_duration_min": round(float(r["predicted_duration"]), 1),
        "operator_skill": int(r["Operator Skill"]),
        "operator_fatigue": float(r["Operator Fatigue Score"]),
        "machine_age_years": float(r["Machine Age"]),
        "machine_temp_c": float(r["Machine Temperature (C)"]),
    } for r in cand.head(req.top_k).to_dict("records")]

    d = cand["predicted_duration"]
    return {
        "task_id": req.task.task_id,
        "task_complexity": int(cand["Task Complexity"].iloc[0]),
        "n_candidates": len(cand),
        "best_min": round(float(d.min()), 1),
        "worst_min": round(float(d.max()), 1),
        "median_min": round(float(d.median()), 1),
        # The model's held-out MAE is ~11.6 min. Candidates within that of the
        # best are not meaningfully slower -- they are ties.
        "within_model_error_of_best": int((d <= d.min() + 11.6).sum()),
        "model_mae_min": 11.6,
        "candidates": rows,
    }
