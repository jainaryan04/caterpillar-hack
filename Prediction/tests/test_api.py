"""API tests.

Two tiers, on purpose:

  * Everything up to `persist` runs against a three-task inline roster with a
    2-second solve. It needs no database and no CSV, so it runs anywhere in
    about the time it takes to load the model.
  * The persistence tier is skipped unless DATABASE_URL is set. A test suite
    that silently passes because it skipped the only part that touches Postgres
    is worse than no test, so the skip reason says exactly that.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient  # noqa: E402

from api.main import app  # noqa: E402
from api.settings import settings  # noqa: E402

needs_db = pytest.mark.skipif(
    not settings.has_db, reason="DATABASE_URL not set; persistence untested")


# Two Excavator tasks and one Inspection Kit task: small enough to solve in
# seconds, big enough to exercise precedence, parallelism and two machine types.
TASKS = [
    {"task_id": "A1", "task_type": "Surface Excavation", "industry": "Mining",
     "task_priority": 1, "work_quantity": 300.0, "work_unit": "m3",
     "weather": "Sunny", "shift_type": "Day", "execution_mode": "PARALLEL",
     "max_parallel": 2, "required_machine_type": "Excavator"},
    {"task_id": "A2", "task_type": "Surface Excavation", "industry": "Mining",
     "task_priority": 2, "work_quantity": 150.0, "work_unit": "m3",
     "weather": "Sunny", "shift_type": "Day", "execution_mode": "SINGLE",
     "max_parallel": 1, "required_machine_type": "Excavator"},
    {"task_id": "B1", "task_type": "Cooling System Inspection",
     "industry": "Data Center Power", "task_priority": 1, "work_quantity": 10.0,
     "work_unit": "units", "weather": "Cloudy", "shift_type": "Night",
     "execution_mode": "SINGLE", "max_parallel": 1,
     "required_machine_type": "Inspection Kit"},
]
WORKERS = [
    {"worker_id": "WA", "skills": ["Surface Excavation"], "skill_level": 8,
     "current_fatigue": 20.0, "available_from": 0, "available_until": 5000},
    {"worker_id": "WB", "skills": ["Surface Excavation"], "skill_level": 5,
     "current_fatigue": 45.0, "available_from": 0, "available_until": 5000},
    {"worker_id": "WC", "skills": ["Cooling System Inspection"], "skill_level": 7,
     "current_fatigue": 10.0, "available_from": 0, "available_until": 5000},
]
MACHINES = [
    {"machine_id": "MA", "machine_type": "Excavator", "age_years": 3.0, "engine_temp_c": 90.0},
    {"machine_id": "MB", "machine_type": "Excavator", "age_years": 9.0, "engine_temp_c": 104.0},
    {"machine_id": "MC", "machine_type": "Inspection Kit", "age_years": 1.0, "engine_temp_c": 78.0},
]


def payload(**over):
    body = {"tasks": TASKS, "workers": WORKERS, "machines": MACHINES,
            "persist": False, "options": {"seconds": 2, "two_pass": False}}
    body.update(over)
    return body


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c
        _purge_fixture_rosters()


def _purge_fixture_rosters():
    """Persisting a run registers the roster it used, because assignments carry
    foreign keys to it. That is correct behaviour, but it means these tests
    would otherwise leave three fake machines on the real fleet roster."""
    if not settings.has_db:
        return
    from api.store import store
    with store.pool.connection() as c:
        c.execute("delete from tasks    where task_id    = any(%s)",
                  ([t["task_id"] for t in TASKS],))
        c.execute("delete from workers  where worker_id  = any(%s)",
                  ([w["worker_id"] for w in WORKERS],))
        c.execute("delete from machines where machine_id = any(%s)",
                  ([m["machine_id"] for m in MACHINES],))


@pytest.fixture(scope="module")
def plan(client):
    r = client.post("/v1/plan", json=payload(
        include=["assignments", "tasks", "machines", "workers", "bottlenecks", "gantt"]))
    assert r.status_code == 200, r.text
    return r.json()


# ------------------------------------------------------------------ health ---

def test_health_reports_model_and_db(client):
    body = client.get("/health").json()
    assert body["status"] == "ok"
    assert body["model_loaded"] is True


# -------------------------------------------------------------------- plan ---

def test_plan_returns_a_verified_schedule(plan):
    s = plan["summary"]
    assert s["verified"] is True, s["violations"]
    assert s["n_tasks"] == 3
    assert s["n_portions"] >= 3


def test_plan_covers_every_task_exactly_once(plan):
    assert {t["task_id"] for t in plan["tasks"]} == {"A1", "A2", "B1"}


def test_makespan_respects_the_proven_lower_bound(plan):
    s = plan["summary"]
    # The bound is derived analytically. A schedule beating it means the bound
    # is unsound, which is a far worse bug than a slow schedule.
    assert s["makespan_min"] >= s["lower_bound_min"]


def test_cp_sat_is_never_worse_than_the_greedy_hint(plan):
    # Greedy is fed in as a hint, so the solver always has it available.
    s = plan["summary"]
    assert s["makespan_min"] <= s["greedy_makespan_min"]


def test_stage_precedence_holds_within_an_industry(plan):
    byid = {t["task_id"]: t for t in plan["tasks"]}
    assert byid["A2"]["start_min"] >= byid["A1"]["end_min"]


def test_single_task_is_never_split(plan):
    byid = {t["task_id"]: t for t in plan["tasks"]}
    assert byid["A2"]["n_portions"] == 1
    assert byid["B1"]["n_portions"] == 1


def test_assignments_are_internally_consistent(plan):
    for a in plan["assignments"]:
        assert a["end_min"] == a["start_min"] + a["busy_min"]
        assert a["busy_min"] > 0
        assert a["status"] == "PLANNED"


def test_no_machine_is_double_booked(plan):
    per_machine: dict = {}
    for a in plan["assignments"]:
        per_machine.setdefault(a["machine_id"], []).append(a)
    for items in per_machine.values():
        items.sort(key=lambda a: a["start_min"])
        for x, y in zip(items, items[1:]):
            assert y["start_min"] >= x["end_min"]


def test_machine_usage_lists_idle_machines_too(plan):
    # Every machine in the roster must appear, used or not -- an idle asset is
    # the most actionable row on the page and must not be filtered away.
    assert {m["machine_id"] for m in plan["machines"]} == {"MA", "MB", "MC"}


def test_utilization_is_measured_against_the_makespan(plan):
    mk = plan["summary"]["makespan_min"]
    for m in plan["machines"]:
        assert m["busy_min"] + m["idle_min"] == mk
        assert 0 <= m["utilization_pct"] <= 100


def test_worker_fatigue_accumulates_over_the_run(plan):
    used = [w for w in plan["workers"] if w["n_tasks"] > 0]
    assert used, "no worker was given any work"
    assert all(w["end_fatigue"] >= w["start_fatigue"] for w in used)


def test_gantt_events_carry_calendar_timestamps(client):
    r = client.post("/v1/plan", json=payload(
        horizon_start="2026-01-05T06:00:00Z", include=["gantt"]))
    assert r.status_code == 200, r.text
    events = r.json()["gantt"]
    assert events and all(str(e["start"]).startswith("2026-01-05") for e in events[:3])


def test_bottlenecks_name_one_critical_industry(plan):
    rows = plan["bottlenecks"]
    assert sum(1 for b in rows if b["is_critical"]) == 1


# -------------------------------------------------------------- validation ---

def test_single_task_cannot_be_splittable(client):
    bad = [dict(TASKS[1], max_parallel=3)]
    r = client.post("/v1/plan", json=payload(tasks=bad))
    assert r.status_code == 422
    assert "SINGLE" in r.text


def test_duplicate_task_ids_are_rejected(client):
    r = client.post("/v1/plan", json=payload(tasks=[TASKS[0], TASKS[0]]))
    assert r.status_code == 422
    assert "duplicate task_id" in r.text


def test_task_with_no_eligible_worker_is_a_422_not_a_500(client):
    # 'Drilling' is a real task type in Mining, but no worker in this roster
    # holds it, so no legal (task, worker, machine) triple exists.
    orphan = [dict(TASKS[0], task_id="Z1", task_type="Drilling",
                   required_machine_type="Drilling Rig")]
    r = client.post("/v1/plan", json=payload(tasks=orphan))
    assert r.status_code == 422
    assert "eligible" in r.text


def test_unknown_task_type_names_the_valid_ones(client):
    # A bare KeyError here would surface as a 404 naming nothing the caller
    # could act on.
    bogus = [dict(TASKS[0], task_id="Z2", task_type="Teleportation")]
    r = client.post("/v1/plan", json=payload(tasks=bogus))
    assert r.status_code == 422
    assert "unknown task type" in r.text and "known:" in r.text


def test_backwards_availability_window_is_rejected(client):
    bad = [dict(WORKERS[0], available_from=900, available_until=100)]
    r = client.post("/v1/plan", json=payload(workers=bad))
    assert r.status_code == 422


# ----------------------------------------------------------------- predict ---

def test_predict_ranks_pairings_without_scheduling(client):
    r = client.post("/v1/predict", json={
        "task": TASKS[0], "workers": WORKERS[:2], "machines": MACHINES[:2], "top_k": 4})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["n_candidates"] == 4      # 2 eligible workers x 2 excavators
    got = [c["predicted_duration_min"] for c in body["candidates"]]
    assert got == sorted(got)
    assert body["best_min"] <= body["median_min"] <= body["worst_min"]


# ------------------------------------------------------------- persistence ---

@needs_db
def test_persisted_run_reads_back_identically(client):
    r = client.post("/v1/plan", json=payload(persist=True, label="pytest",
                                             include=["assignments"]))
    assert r.status_code == 200, r.text
    body = r.json()
    run_id = body["run_id"]
    assert body["persisted"] is True
    try:
        stored = client.get(f"/v1/runs/{run_id}").json()
        assert stored["makespan_min"] == body["summary"]["makespan_min"]
        assert stored["status"] == "DRAFT"

        back = client.get(f"/v1/runs/{run_id}/assignments").json()["assignments"]
        assert len(back) == len(body["assignments"])

        machines = client.get(f"/v1/runs/{run_id}/machines").json()["machines"]
        assert sum(m["n_tasks"] for m in machines) >= 3
    finally:
        assert client.delete(f"/v1/runs/{run_id}").status_code == 200


@needs_db
def test_deleting_a_run_takes_its_assignments_with_it(client):
    run_id = client.post("/v1/plan", json=payload(persist=True)).json()["run_id"]
    client.delete(f"/v1/runs/{run_id}")
    assert client.get(f"/v1/runs/{run_id}").status_code == 404
    assert client.get(f"/v1/runs/{run_id}/assignments").status_code == 404


@needs_db
def test_marking_a_portion_done_moves_the_task_and_the_machine(client):
    run_id = client.post("/v1/plan", json=payload(persist=True)).json()["run_id"]
    try:
        # B1 is a SINGLE task, so its one portion finishing means the task is done.
        rows = client.get(f"/v1/runs/{run_id}/assignments").json()["assignments"]
        b1 = next(a for a in rows if a["task_id"] == "B1")

        r = client.patch(f"/v1/assignments/{b1['id']}", json={"status": "IN_PROGRESS"})
        assert r.status_code == 200 and r.json()["actual_start_at"]

        r = client.patch(f"/v1/assignments/{b1['id']}", json={"status": "DONE"})
        assert r.status_code == 200 and r.json()["actual_end_at"]

        done = client.get(f"/v1/runs/{run_id}/assignments?status=DONE").json()["assignments"]
        assert [a["task_id"] for a in done] == ["B1"]
    finally:
        client.delete(f"/v1/runs/{run_id}")


@needs_db
def test_unverified_runs_cannot_be_published(client):
    """The publish guard is the last line between a broken model and a crew."""
    from api.store import store
    run_id = client.post("/v1/plan", json=payload(persist=True)).json()["run_id"]
    try:
        with store.pool.connection() as c:
            c.execute("update schedule_runs set verified = false where id = %s", (run_id,))
        r = client.post(f"/v1/runs/{run_id}/publish")
        assert r.status_code == 409
        assert "verification" in r.text
    finally:
        client.delete(f"/v1/runs/{run_id}")


@needs_db
def test_unknown_run_id_is_a_404(client):
    missing = "00000000-0000-0000-0000-000000000000"
    assert client.get(f"/v1/runs/{missing}").status_code == 404
