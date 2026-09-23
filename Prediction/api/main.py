"""HTTP surface for the fleet scheduler.

    uvicorn api.main:app --reload --port 8000
    http://localhost:8000/docs

One call does the whole job:

    POST /v1/plan   ->  predict durations for every legal (task, worker, machine)
                        pairing, schedule them, verify the result independently,
                        write it to Postgres, and hand back the plan.

Everything after that is reading the stored run back in the shape a particular
screen needs, plus the two writes that reality requires: publishing a plan and
marking work done.
"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware

from .schemas import (AssignmentUpdate, PlanRequest, PlanResponse,
                      PredictRequest)
from .service import PlanningError, run_plan, run_predict
from .settings import settings
from .store import StoreUnavailable, store


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Warm the model at startup. Loading a 1.8 MB joblib inside the first
    # request makes that request look slow for a reason that has nothing to do
    # with it, and hides a missing-model deployment error until traffic
    # arrives.
    try:
        from prediction_service.predict import load_model
        load_model()
    except FileNotFoundError:
        pass
    yield
    store.close()


app = FastAPI(
    title="Fleet Scheduler API",
    version="1.0.0",
    description=__doc__,
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.cors_origins),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _need_db():
    if not store.enabled:
        raise HTTPException(503, "DATABASE_URL is not configured; stored runs unavailable")


def _run_or_404(run_id: str) -> dict:
    _need_db()
    run = store.get_run(run_id)
    if run is None:
        raise HTTPException(404, f"no run {run_id}")
    return run


def _resolve(run_id: str) -> str:
    """'active' is an alias for whichever run is currently PUBLISHED, so a
    dashboard can bookmark one URL instead of chasing the newest id."""
    if run_id != "active":
        return run_id
    _need_db()
    run = store.published_run()
    if run is None:
        raise HTTPException(404, "no published run; POST /v1/runs/{id}/publish first")
    return str(run["id"])


# ------------------------------------------------------------------ health ---

@app.get("/health", tags=["meta"])
def health():
    from prediction_service.predict import MODEL_PATH
    return {
        "status": "ok",
        "model_loaded": MODEL_PATH.exists(),
        "database": "connected" if (store.enabled and store.ping())
                    else "configured-but-unreachable" if store.enabled else "not-configured",
        "solver_seconds_limit": settings.max_seconds_limit,
    }


# ------------------------------------------------------------------- plan ---

@app.post("/v1/plan", response_model=PlanResponse, tags=["planning"],
          summary="Predict, schedule, verify and store in one call")
async def create_plan(req: PlanRequest):
    """The endpoint. Give it tasks (or let it read the roster) and it returns a
    dispatchable plan.

    The solve is CPU-bound and runs in a worker thread, so a 20-second plan
    does not block the rest of the API.
    """
    try:
        return await run_in_threadpool(run_plan, req)
    except PlanningError as e:
        raise HTTPException(422, str(e)) from e
    except StoreUnavailable as e:
        raise HTTPException(503, str(e)) from e
    except LookupError as e:
        raise HTTPException(404, str(e)) from e


@app.post("/v1/predict", tags=["planning"],
          summary="Rank operator/machine pairings for one task, without scheduling")
async def predict(req: PredictRequest):
    try:
        return await run_in_threadpool(run_predict, req)
    except PlanningError as e:
        raise HTTPException(422, str(e)) from e


# ---------------------------------------------------------------- rosters ---

@app.get("/v1/rosters", tags=["rosters"], summary="Tasks, workers and machines in play")
def get_rosters(source: str = Query("csv", pattern="^(csv|db)$")):
    from prediction_service.loaders import load_all
    try:
        tasks, workers, machines = store.read_rosters() if source == "db" else load_all()
    except (StoreUnavailable, LookupError) as e:
        raise HTTPException(503 if isinstance(e, StoreUnavailable) else 404, str(e)) from e
    return {
        "source": source,
        "counts": {"tasks": len(tasks), "workers": len(workers), "machines": len(machines)},
        "tasks": tasks.to_dict("records"),
        "workers": [{k: (sorted(v) if k == "skill_set" else v) for k, v in w.items()}
                    for w in workers.drop(columns=["skills"]).to_dict("records")],
        "machines": machines.to_dict("records"),
    }


@app.post("/v1/rosters/sync", tags=["rosters"],
          summary="Push the CSV rosters into Postgres")
def sync_rosters():
    _need_db()
    from prediction_service.loaders import load_all
    tasks, workers, machines = load_all()
    return {"synced": store.sync_rosters(tasks, workers, machines)}


# ------------------------------------------------------------------- runs ---

@app.get("/v1/runs", tags=["runs"])
def list_runs(limit: int = Query(20, ge=1, le=100)):
    _need_db()
    return {"runs": store.list_runs(limit)}


@app.get("/v1/runs/{run_id}", tags=["runs"], summary="Headline numbers for one run")
def get_run(run_id: str):
    return _run_or_404(_resolve(run_id))


@app.get("/v1/runs/{run_id}/assignments", tags=["runs"],
         summary="Every dispatched portion: who, what, which machine, when")
def get_assignments(run_id: str, status: str | None = None,
                    machine_id: str | None = None, worker_id: str | None = None):
    rid = _resolve(run_id)
    _run_or_404(rid)
    return {"run_id": rid,
            "assignments": store.get_assignments(rid, status, machine_id, worker_id)}


@app.get("/v1/runs/{run_id}/tasks", tags=["runs"], summary="Per-task start, end and span")
def get_run_tasks(run_id: str):
    rid = _resolve(run_id)
    _run_or_404(rid)
    return {"run_id": rid, "tasks": store.get_run_tasks(rid)}


@app.get("/v1/runs/{run_id}/machines", tags=["resources"],
         summary="What each machine did, how hard, and how hot it got")
def get_machines(run_id: str):
    rid = _resolve(run_id)
    _run_or_404(rid)
    return {"run_id": rid, "machines": store.get_machine_workload(rid)}


@app.get("/v1/runs/{run_id}/workers", tags=["resources"],
         summary="What each operator did, and where their fatigue ended up")
def get_workers(run_id: str):
    rid = _resolve(run_id)
    _run_or_404(rid)
    return {"run_id": rid, "workers": store.get_worker_workload(rid)}


@app.get("/v1/runs/{run_id}/utilization", tags=["resources"],
         summary="Machines and operators in one utilisation table")
def get_utilization(run_id: str):
    rid = _resolve(run_id)
    run = _run_or_404(rid)
    rows = store.utilization(rid)
    used = [r for r in rows if r["busy_min"] > 0]
    return {
        "run_id": rid,
        "makespan_min": run["makespan_min"],
        "summary": {
            "resources_total": len(rows),
            "resources_used": len(used),
            "resources_idle": len(rows) - len(used),
            "mean_utilization_pct": round(
                sum(float(r["utilization_pct"]) for r in rows) / max(1, len(rows)), 1),
            "mean_utilization_of_used_pct": round(
                sum(float(r["utilization_pct"]) for r in used) / max(1, len(used)), 1),
        },
        "resources": rows,
    }


@app.get("/v1/runs/{run_id}/bottlenecks", tags=["runs"],
         summary="Why the makespan is what it is, per industry")
def get_bottlenecks(run_id: str):
    rid = _resolve(run_id)
    run = _run_or_404(rid)
    rows = store.get_bottlenecks(rid)
    critical = next((r for r in rows if r["is_critical"]), None)
    return {
        "run_id": rid,
        "makespan_min": run["makespan_min"],
        "lower_bound_min": run["lower_bound_min"],
        "critical_industry": critical["industry"] if critical else None,
        # The share of the schedule that is forced by the roster rather than
        # chosen by the solver. When this is high, buy equipment; when it is
        # low, spend solver time.
        "floor_share_pct": round(100 * run["lower_bound_min"] / run["makespan_min"], 1)
                           if run["makespan_min"] else None,
        "industries": rows,
    }


@app.get("/v1/runs/{run_id}/gantt", tags=["runs"],
         summary="Calendar-shaped events, one per portion, keyed by machine")
def get_gantt(run_id: str):
    rid = _resolve(run_id)
    run = _run_or_404(rid)
    rows = store.get_assignments(rid)
    return {
        "run_id": rid,
        "horizon_start": run["horizon_start"],
        "resources": [{"id": m["machine_id"], "title": m["machine_id"],
                       "machine_type": m["machine_type"]}
                      for m in store.get_machine_workload(rid) if m["n_tasks"]],
        "events": [{
            "id": str(a["id"]),
            "resourceId": a["machine_id"],
            "title": f"{a['task_id']} {a['task_type']}",
            "start": a["start_at"], "end": a["end_at"],
            "extendedProps": {k: a[k] for k in
                              ("task_id", "worker_id", "machine_id", "industry",
                               "stage", "busy_min", "work_share_pct", "status")},
        } for a in rows],
    }


@app.get("/v1/runs/{run_id}/state", tags=["resources"],
         summary="Fatigue and engine-temperature curves over the run")
def get_state(run_id: str, kind: str | None = Query(None, pattern="^(worker|machine)$")):
    rid = _resolve(run_id)
    _run_or_404(rid)
    return {"run_id": rid, "kind": kind or "both",
            "samples": store.get_state_samples(rid, kind)}


# --------------------------------------------------------------- dispatch ---

@app.post("/v1/runs/{run_id}/publish", tags=["dispatch"],
          summary="Make this the live plan and reserve its machines and crew")
def publish(run_id: str):
    _run_or_404(run_id)
    try:
        return store.publish_run(run_id)
    except ValueError as e:
        # The verifier rejected this schedule. Publishing it would reserve
        # resources against a plan known to be inconsistent.
        raise HTTPException(409, str(e)) from e


@app.patch("/v1/assignments/{assignment_id}", tags=["dispatch"],
           summary="Mark a portion started, finished or cancelled")
def update_assignment(assignment_id: int, body: AssignmentUpdate):
    _need_db()
    try:
        return store.update_assignment(
            assignment_id, status=body.status,
            actual_start_at=body.actual_start_at, actual_end_at=body.actual_end_at)
    except LookupError:
        raise HTTPException(404, f"no assignment {assignment_id}") from None


@app.delete("/v1/runs/{run_id}", tags=["runs"])
def delete_run(run_id: str):
    _need_db()
    if not store.delete_run(run_id):
        raise HTTPException(404, f"no run {run_id}")
    return {"deleted": run_id}
