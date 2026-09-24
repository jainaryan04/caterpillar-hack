"""Tests for the complexity engine, the rate conversion and the scheduler.

Built on a tiny hand-made instance rather than the real 110-task problem, so
the whole suite runs in seconds and the expected answer is known by hand.
Nothing here loads the trained model: durations are supplied directly, which
keeps these tests about the SCHEDULING logic rather than about ML accuracy.
"""

import math
import sys
from pathlib import Path

import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from prediction_service import complexity as cx
from prediction_service.candidates import eligible_machines, eligible_workers
from prediction_service.loaders import parse_skills
from scheduling.bounds import barrier_lower_bound, chain_lower_bound
from scheduling.cp_sat_model import solve
from scheduling.greedy import greedy_schedule
from scheduling.problem import MIN_PORTION_MINUTES, SCALE, Portion, build_problem
from scheduling.verify import verify

FEATURES = {
    "Weather": "Sunny", "Shift Type": "Day", "Task Complexity": 5,
    "Operator Skill": 7, "Operator Fatigue Score": 20.0,
    "Machine Age": 5.0, "Machine Temperature (C)": 90.0,
}


def make_problem(tasks_spec, workers_spec, machines_spec, durations, bucket=1):
    """Build a Problem from plain dicts. `durations` maps
    (task_id, worker_id, machine_id) -> predicted minutes."""
    tasks = pd.DataFrame(tasks_spec)
    workers = pd.DataFrame(workers_spec)
    workers["skill_set"] = workers["skills"].map(parse_skills)
    machines = pd.DataFrame(machines_spec)

    rows = []
    for (tid, wid, mid), dur in durations.items():
        t = tasks[tasks.task_id == tid].iloc[0]
        rows.append({
            "task_id": tid, "worker_id": wid, "machine_id": mid,
            "Industry": t.industry, "Task Type": t.task_type,
            **FEATURES, "predicted_duration": float(dur),
        })
    return build_problem(tasks, workers, machines, pd.DataFrame(rows), bucket=bucket)


def two_stage_problem(bucket=1, max_parallel=1):
    """Mining: Surface Excavation (stage 1) then Hauling Ore (stage 2).
    Two workers, two machines of each type."""
    tasks = [
        dict(task_id="T1", task_type="Surface Excavation", industry="Mining",
             task_priority=1, work_quantity=1550.0, work_unit="m3",
             weather="Sunny", shift_type="Day",
             execution_mode="PARALLEL" if max_parallel > 1 else "SINGLE",
             max_parallel=max_parallel, required_machine_type="Excavator"),
        dict(task_id="T2", task_type="Hauling Ore", industry="Mining",
             task_priority=2, work_quantity=550.0, work_unit="tonnes",
             weather="Sunny", shift_type="Day", execution_mode="SINGLE",
             max_parallel=1, required_machine_type="Haul Truck"),
    ]
    workers = [
        dict(worker_id="W1", skills="Surface Excavation; Hauling Ore",
             skill_level=8, current_fatigue=10.0, available_from=0, available_until=100000),
        dict(worker_id="W2", skills="Surface Excavation; Hauling Ore",
             skill_level=6, current_fatigue=10.0, available_from=0, available_until=100000),
    ]
    machines = [
        dict(machine_id="E1", machine_type="Excavator", age_years=3.0, engine_temp_c=90.0),
        dict(machine_id="E2", machine_type="Excavator", age_years=9.0, engine_temp_c=99.0),
        dict(machine_id="H1", machine_type="Haul Truck", age_years=4.0, engine_temp_c=92.0),
    ]
    durations = {
        ("T1", "W1", "E1"): 200, ("T1", "W1", "E2"): 240,
        ("T1", "W2", "E1"): 260, ("T1", "W2", "E2"): 300,
        ("T2", "W1", "H1"): 100, ("T2", "W2", "H1"): 130,
    }
    return make_problem(tasks, workers, machines, durations, bucket=bucket)


# ----------------------------------------------------------------------
# Complexity engine
# ----------------------------------------------------------------------

def test_complexity_is_deterministic_at_serve_time():
    """The same contract must price identically every time. Jitter left on at
    inference would return a different duration on every call."""
    a = cx.derive_complexity("Construction", "Excavation", 500, jitter=False)
    b = cx.derive_complexity("Construction", "Excavation", 500, jitter=False)
    assert a == b


def test_complexity_rises_with_quantity():
    vals = [cx.derive_complexity("Construction", "Excavation", q, jitter=False)
            for q in (110, 500, 2400)]
    assert vals == sorted(vals)
    assert vals[0] < vals[-1]


def test_complexity_stays_in_range_across_every_task_type():
    for industry, types in cx.VOLUME.items():
        for tt, spec in types.items():
            for q in (spec["low"], spec["typical"], spec["high"]):
                c = cx.derive_complexity(industry, tt, q, jitter=False)
                assert 1 <= c <= 10, f"{industry}/{tt} at {q} gave {c}"


def test_jitter_without_rng_is_rejected():
    """Silently skipping the noise would make generation quietly wrong."""
    with pytest.raises(ValueError):
        cx.derive_complexity("Mining", "Drilling", 150, jitter=True)


def test_volume_table_invariant_holds():
    cx.check_volume_table()


def test_a_broken_volume_row_is_caught():
    """The invariant check has to actually fail on a bad row, or it is decoration."""
    original = cx.VOLUME["Mining"]["Drilling"].copy()
    cx.VOLUME["Mining"]["Drilling"]["typical"] = 480   # nearly at `high`
    try:
        with pytest.raises(AssertionError):
            cx.check_volume_table()
    finally:
        cx.VOLUME["Mining"]["Drilling"] = original


# ----------------------------------------------------------------------
# Rate conversion -- the divisibility mechanism
# ----------------------------------------------------------------------

@pytest.mark.parametrize("bucket", [1, 5, 15])
def test_one_full_duration_portion_always_completes_its_task(bucket):
    """rate * duration >= SCALE for every candidate, at every bucket size.

    This is the check that catches the rate/bucket unit mismatch: a rate left
    in units-per-MINUTE while busy counts buckets would fail here instead of
    silently declaring tasks finished after a fraction of their work.
    """
    p = two_stage_problem(bucket=bucket)
    for key, dur in p.dur.items():
        assert p.rate[key] * dur >= SCALE, f"{key} cannot finish itself at bucket={bucket}"


def test_rate_rounding_is_optimistic_but_only_slightly():
    p = two_stage_problem()
    for key, dur in p.dur.items():
        over = p.rate[key] * dur - SCALE
        assert 0 <= over / SCALE < 0.01, f"{key} rounding error {over / SCALE:.4f}"


def test_bucketing_never_invents_worker_availability():
    workers = [dict(worker_id="W1", skills="Drilling", skill_level=5,
                    current_fatigue=0.0, available_from=7, available_until=993)]
    tasks = [dict(task_id="T1", task_type="Drilling", industry="Mining",
                  task_priority=1, work_quantity=150.0, work_unit="m drilled",
                  weather="Sunny", shift_type="Day", execution_mode="SINGLE",
                  max_parallel=1, required_machine_type="Rotary Drill Rig")]
    machines = [dict(machine_id="D1", machine_type="Rotary Drill Rig",
                     age_years=2.0, engine_temp_c=90.0)]
    p = make_problem(tasks, workers, machines, {("T1", "W1", "D1"): 200}, bucket=10)
    assert p.to_minutes(p.avail_from["W1"]) >= 7     # rounded up, never earlier
    assert p.to_minutes(p.avail_until["W1"]) <= 993  # rounded down, never later


# ----------------------------------------------------------------------
# Candidate filtering
# ----------------------------------------------------------------------

def test_unskilled_workers_and_wrong_machines_never_become_candidates():
    p = two_stage_problem()
    t1 = p.task_row["T1"]
    ws = eligible_workers(t1, p.workers)
    ms = eligible_machines(t1, p.machines)
    assert set(ws.worker_id) == {"W1", "W2"}
    assert set(ms.machine_id) == {"E1", "E2"}      # H1 is a Haul Truck
    assert "H1" not in set(ms.machine_id)


# ----------------------------------------------------------------------
# The solver
# ----------------------------------------------------------------------

def test_single_task_gets_exactly_one_portion_and_the_fastest_pair():
    p = two_stage_problem()
    s = solve(p, horizon=1000, max_seconds=10)
    assert s.portions, s.status
    assert not verify(p, s)

    by_task = s.by_task()
    assert len(by_task["T1"]) == 1, "SINGLE task must not split"
    assert len(by_task["T2"]) == 1
    # T1's options are 200/240/260/300 -- with no contention it must take 200.
    assert (by_task["T1"][0].worker_id, by_task["T1"][0].machine_id) == ("W1", "E1")


def test_stage_precedence_is_respected():
    p = two_stage_problem()
    s = solve(p, horizon=1000, max_seconds=10)
    t1_end = max(x.end for x in s.by_task()["T1"])
    t2_start = min(x.start for x in s.by_task()["T2"])
    assert t2_start >= t1_end, "stage 2 started before stage 1 finished"
    # 200 (T1 best) + 100 (T2 best) with a strict barrier between them.
    assert s.makespan == 300


def test_a_parallel_task_actually_splits_when_that_is_faster():
    """max_parallel=2 with two usable pairs should beat the single-pair time."""
    p = two_stage_problem(max_parallel=2)
    s = solve(p, horizon=1000, max_seconds=15)
    assert not verify(p, s)
    t1 = s.by_task()["T1"]
    assert len(t1) == 2, f"expected a 2-way split, got {len(t1)}"
    assert max(x.end for x in t1) < 200, "splitting did not beat the 200-min solo time"


def test_no_portion_is_shorter_than_the_minimum_dispatch():
    """Without this floor the tie-break generates 1-minute slivers."""
    p = two_stage_problem(max_parallel=2)
    s = solve(p, horizon=1000, max_seconds=15)
    for x in s.portions:
        assert p.to_minutes(x.busy) >= min(MIN_PORTION_MINUTES, p.to_minutes(p.dur[
            (x.task_id, x.worker_id, x.machine_id)]))


def test_greedy_is_feasible_and_never_beats_the_lower_bound():
    p = two_stage_problem()
    g = greedy_schedule(p)
    assert not verify(p, g)
    assert g.makespan >= chain_lower_bound(p)


def test_cpsat_is_at_least_as_good_as_greedy():
    p = two_stage_problem()
    g = greedy_schedule(p)
    s = solve(p, horizon=g.makespan, hint=g, max_seconds=10)
    assert s.makespan <= g.makespan


def test_global_barrier_can_never_beat_per_industry_chains():
    """sum-of-maxima >= maximum-of-sums, checked on the real problem shape."""
    p = two_stage_problem()
    assert barrier_lower_bound(p) >= chain_lower_bound(p)


# ----------------------------------------------------------------------
# The verifier must actually catch things
# ----------------------------------------------------------------------

def solved():
    p = two_stage_problem()
    return p, solve(p, horizon=1000, max_seconds=10)


def test_verifier_passes_a_good_schedule():
    p, s = solved()
    assert verify(p, s) == []


def test_verifier_catches_unfinished_work():
    p, s = solved()
    s.portions[0].busy -= 10          # deliver less than SCALE
    s.portions[0].end -= 10
    assert any("work units delivered" in v for v in verify(p, s))


def test_verifier_catches_a_double_booked_resource():
    p, s = solved()
    for x in s.portions:              # drag every portion onto the same instant
        x.start, x.end = 0, x.busy
    assert any("double-booked" in v for v in verify(p, s))


def test_verifier_catches_a_broken_stage_order():
    p, s = solved()
    for x in s.by_task()["T2"]:       # move stage 2 to time zero
        x.start, x.end = 0, x.busy
    assert any("before" in v and "stage" in v for v in verify(p, s))


def test_verifier_catches_an_unskilled_assignment():
    p, s = solved()
    bad = Portion("T1", "W1", "E1", 0, p.dur[("T1", "W1", "E1")],
                  p.dur[("T1", "W1", "E1")])
    p.worker_row["W1"] = p.worker_row["W1"]._replace(skill_set=frozenset({"Hauling Ore"}))
    s.portions = [bad] + [x for x in s.portions if x.task_id != "T1"]
    assert any("lacks skill" in v for v in verify(p, s))


def test_verifier_catches_an_inconsistent_makespan():
    p, s = solved()
    s.makespan += 500
    assert any("makespan" in v for v in verify(p, s))


# ----------------------------------------------------------------------
# Parallelism must not be free
# ----------------------------------------------------------------------

def test_splitting_a_task_requires_more_total_work_than_doing_it_alone():
    """Two machines rated 200 and 180 do not give 380. If the solver splits,
    the delivered work must clear the HIGHER bar set by the efficiency table,
    otherwise parallel work is free and the solver will over-use it."""
    from scheduling.problem import PARALLEL_EFFICIENCY
    p = two_stage_problem(max_parallel=2)
    s = solve(p, horizon=1000, max_seconds=15, parallel_efficiency=True)
    t1 = s.by_task()["T1"]
    assert len(t1) == 2, "test needs a split to be meaningful"

    delivered = sum(p.rate[(x.task_id, x.worker_id, x.machine_id)] * x.busy for x in t1)
    required = SCALE / PARALLEL_EFFICIENCY[2]
    assert delivered >= required, (
        f"split delivered {delivered} but a 2-way split must deliver "
        f"{required:.0f} -- parallelism is being treated as free")


def test_efficiency_loss_makes_splitting_slower_than_the_ideal_halving():
    """A 2-way split of a 200-minute job must not approach 100 minutes."""
    p = two_stage_problem(max_parallel=2)
    s = solve(p, horizon=1000, max_seconds=15, parallel_efficiency=True)
    t1 = s.by_task()["T1"]
    span = max(x.end for x in t1) - min(x.start for x in t1)
    assert span > 100, f"2-way split took {span} min -- that is free parallelism"


def test_a_task_cannot_be_abandoned_and_resumed_later():
    """Portions may be concurrent or staggered, but a task must not sit idle
    mid-way. Observed before this constraint: a task idle for 112 minutes."""
    p = two_stage_problem(max_parallel=2)
    s = solve(p, horizon=1000, max_seconds=15, task_continuity=True)
    for task_id, portions in s.by_task().items():
        span = max(x.end for x in portions) - min(x.start for x in portions)
        worked = sum(x.busy for x in portions)
        assert span <= worked, (
            f"{task_id} spans {span} min but only {worked} min of work "
            f"happened -- it was left idle mid-task")
