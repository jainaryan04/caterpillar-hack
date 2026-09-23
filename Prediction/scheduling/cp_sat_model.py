"""CP-SAT flexible job-shop with divisible tasks.

A task is not "one worker + one machine". It is one or more concurrent
(worker, machine) *portions*, capped by max_parallel. SINGLE is not a separate
code path -- it is max_parallel = 1, which collapses the same formulation back
to one pair per task.

See PLAN.md 4.8 for the derivation.

Objective handling is LEXICOGRAPHIC IN TWO PHASES rather than a single weighted
sum. A weighted `BIG * makespan + sum(busy)` needs BIG larger than any
achievable total busy time (here ~80,000), and a coefficient that size degrades
CP-SAT's LP relaxation and propagation badly -- measured: a 106% optimality gap
after 60s. Two clean phases give a meaningful bound on makespan alone, and the
tie-break still happens, exactly.
"""

from __future__ import annotations

import math
import time

from ortools.sat.python import cp_model

from .bounds import chain_lower_bound
from .problem import (MIN_PORTION_MINUTES, PARALLEL_EFFICIENCY, SCALE,
                      Portion, Schedule)


def _build(p, horizon: int, precedence_mode: str,
           parallel_efficiency: bool = True, task_continuity: bool = True):
    """The full model, minus the objective. Returned vars let the caller pick
    an objective and re-solve without redefining the constraints."""
    m = cp_model.CpModel()

    start, end = {}, {}
    for t in p.cand_of_task:
        start[t] = m.NewIntVar(0, horizon, f"s_{t}")
        end[t] = m.NewIntVar(0, horizon, f"e_{t}")
        m.Add(start[t] <= end[t])

    x, busy, pstart, pend, interval = {}, {}, {}, {}, {}
    for t, pairs in p.cand_of_task.items():
        for (w, mc) in pairs:
            k = (t, w, mc)
            dur = p.dur[k]
            x[k] = m.NewBoolVar(f"x_{t}_{w}_{mc}")
            # Upper bound of `dur` is a real tightening and it is safe: a pair
            # never needs to work longer than it would take to do the whole
            # task alone, and working longer can never shorten anything.
            busy[k] = m.NewIntVar(0, dur, f"b_{t}_{w}_{mc}")
            pstart[k] = m.NewIntVar(0, horizon, f"ps_{t}_{w}_{mc}")
            pend[k] = m.NewIntVar(0, horizon, f"pe_{t}_{w}_{mc}")
            interval[k] = m.NewOptionalIntervalVar(
                pstart[k], busy[k], pend[k], x[k], f"i_{t}_{w}_{mc}"
            )

    for t, pairs in p.cand_of_task.items():
        keys = [(t, w, mc) for (w, mc) in pairs]

        cap = int(p.task_row[t].max_parallel)
        delivered = sum(p.rate[k] * busy[k] for k in keys)

        # 1. The task gets completed. The one constraint that makes
        #    divisibility work: linear, integer, precomputed rates.
        if parallel_efficiency and cap > 1:
            # Splitting k ways requires MORE total work delivered, because the
            # portions interfere with each other. eff(k) is a constant, so
            # SCALE / eff(k) is a constant and the constraint stays linear.
            # Reified on the NUMBER of portions used.
            n_used = sum(x[k] for k in keys)
            flags = []
            for kk in range(1, cap + 1):
                y = m.NewBoolVar(f"n_{t}_{kk}")
                flags.append(y)
                m.Add(n_used == kk).OnlyEnforceIf(y)
                required = math.ceil(SCALE / PARALLEL_EFFICIENCY.get(kk, 0.75))
                m.Add(delivered >= required).OnlyEnforceIf(y)
            m.AddExactlyOne(flags)
        else:
            m.Add(delivered >= SCALE)

        # 2. A portion is used iff it consumes time. Constraint 1 then forces
        #    at least one portion, so no explicit "at least one" is needed.
        for k in keys:
            # Capped at the candidate's own duration so a task whose whole
            # duration is under the minimum stays feasible as a single portion.
            floor_k = min(max(1, MIN_PORTION_MINUTES // p.bucket), p.dur[k])
            m.Add(busy[k] >= floor_k).OnlyEnforceIf(x[k])
            m.Add(busy[k] == 0).OnlyEnforceIf(x[k].Not())

        # 3. Parallelism cap. At max_parallel = 1 this plus constraint 1 gives
        #    exactly one portion -- the SINGLE behaviour, for free.
        m.Add(sum(x[k] for k in keys) <= cap)

        # 3b. No idle gap inside a task. Portions may still be staggered or
        #     concurrent, but the task cannot be abandoned half-done and picked
        #     up hours later: observed T102 sitting idle for 112 minutes
        #     mid-task. If the span exceeds the total worked time, there was a
        #     gap. Concurrency keeps span <= sum(busy), so this does not
        #     penalise genuine parallel work.
        if task_continuity:
            m.Add(end[t] - start[t] <= sum(busy[k] for k in keys))

        # 4. Portions sit inside the task's span. They may be staggered, not
        #    only simultaneous: one excavator can start at 08:00 and a second
        #    join at 10:00.
        for k in keys:
            m.Add(pstart[k] >= start[t]).OnlyEnforceIf(x[k])
            m.Add(pend[k] <= end[t]).OnlyEnforceIf(x[k])

        # 7. Symmetry breaking: one worker (or machine) must not take two
        #    portions of the SAME task. No-overlap would merely serialise them,
        #    which is a slower way to express one portion, and it bloats the
        #    search space.
        by_worker, by_machine = {}, {}
        for (w, mc) in pairs:
            by_worker.setdefault(w, []).append((t, w, mc))
            by_machine.setdefault(mc, []).append((t, w, mc))
        for ks in by_worker.values():
            if len(ks) > 1:
                m.AddAtMostOne(x[k] for k in ks)
        for ks in by_machine.values():
            if len(ks) > 1:
                m.AddAtMostOne(x[k] for k in ks)

    # 5 / 6. No worker and no machine double-booked, across all tasks.
    per_worker, per_machine = {}, {}
    for k in interval:
        per_worker.setdefault(k[1], []).append(interval[k])
        per_machine.setdefault(k[2], []).append(interval[k])
    for ivs in per_worker.values():
        m.AddNoOverlap(ivs)
    for ivs in per_machine.values():
        m.AddNoOverlap(ivs)

    # 8. Stage precedence.
    if precedence_mode == "per_industry":
        chains = {}
        for ind, stages in p.stages_of_industry.items():
            chains[ind] = [p.tasks_in[(ind, s)] for s in stages]
    elif precedence_mode == "global":
        all_stages = sorted({t.task_priority for t in p.task_row.values()})
        chains = {"__all__": [[t.task_id for t in p.task_row.values()
                               if t.task_priority == s] for s in all_stages]}
    else:
        raise ValueError(f"unknown precedence_mode {precedence_mode!r}")

    for label, stage_groups in chains.items():
        prev_end = None
        for i, ids in enumerate(stage_groups):
            stage_end = m.NewIntVar(0, horizon, f"se_{label}_{i}")
            for t in ids:
                m.Add(end[t] <= stage_end)
                if prev_end is not None:
                    m.Add(start[t] >= prev_end)
            prev_end = stage_end

    # 9. Worker availability, enforced only where the portion is used.
    #    (10. Machines have no availability constraint -- locked decision.)
    for k in x:
        w = k[1]
        m.Add(pstart[k] >= p.avail_from[w]).OnlyEnforceIf(x[k])
        m.Add(pend[k] <= p.avail_until[w]).OnlyEnforceIf(x[k])

    makespan = m.NewIntVar(0, horizon, "makespan")
    m.AddMaxEquality(makespan, [end[t] for t in end])

    # Valid analytical lower bound (see bounds.py). CP-SAT's own relaxation
    # cannot see the sequential-stages-under-scarce-resources structure, so
    # without this the reported gap is vacuous and the search prunes poorly.
    # Only applies to per-industry chains -- the global barrier is a different
    # (weaker) structure and the bound derivation does not hold for it.
    if precedence_mode == "per_industry":
        m.Add(makespan >= chain_lower_bound(p))

    return m, dict(x=x, busy=busy, pstart=pstart, pend=pend, makespan=makespan)


def _apply_hint(m, v, hint):
    used = {(z.task_id, z.worker_id, z.machine_id): z for z in hint.portions}
    for k in v["x"]:
        m.AddHint(v["x"][k], 1 if k in used else 0)
        m.AddHint(v["busy"][k], used[k].busy if k in used else 0)


def _extract(solver, v):
    return [
        Portion(k[0], k[1], k[2],
                solver.Value(v["pstart"][k]), solver.Value(v["busy"][k]),
                solver.Value(v["pend"][k]))
        for k in v["x"] if solver.Value(v["x"][k])
    ]


def _solver(max_seconds, workers, log):
    s = cp_model.CpSolver()
    s.parameters.max_time_in_seconds = max_seconds
    s.parameters.num_search_workers = workers
    s.parameters.log_search_progress = log
    return s


def solve(p, horizon: int, hint: Schedule | None = None,
          precedence_mode: str = "per_industry",
          max_seconds: float = 60.0, workers: int = 8,
          tiebreak: bool = True, log: bool = False,
          parallel_efficiency: bool = True, task_continuity: bool = True) -> Schedule:
    """Minimise makespan, then break ties by total resource time.

    precedence_mode:
      per_industry -- each industry's stage chain runs independently (correct)
      global       -- one barrier across all industries. Kept only to measure
                      what the naive reading costs; it is never better, because
                      sum-of-maxima >= maximum-of-sums.

    tiebreak: run the second phase. Phase 2 cannot worsen the makespan (it is
    constrained to phase 1's value) -- it only chooses a better member of the
    tie class: fewer resource-hours, which means the faster operator and the
    cooler machine, without any hand-written preference terms.
    """
    budget_1 = max_seconds * (0.6 if tiebreak else 1.0)
    t0 = time.time()

    opts = dict(parallel_efficiency=parallel_efficiency, task_continuity=task_continuity)
    m, v = _build(p, horizon, precedence_mode, **opts)
    m.Minimize(v["makespan"])
    if hint is not None:
        _apply_hint(m, v, hint)

    s1 = _solver(budget_1, workers, log)
    st1 = s1.Solve(m)
    if st1 not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return Schedule(portions=[], makespan=0, status=s1.StatusName(st1),
                        solve_seconds=time.time() - t0, source="cp-sat")

    best_makespan = s1.Value(v["makespan"])
    bound = s1.BestObjectiveBound()
    best = Schedule(portions=_extract(s1, v), makespan=best_makespan,
                    objective_bound=bound, status=s1.StatusName(st1),
                    solve_seconds=time.time() - t0,
                    source=f"cp-sat/{precedence_mode}")

    if not tiebreak:
        return best

    # Phase 2: same model, makespan pinned, minimise resource time.
    m2, v2 = _build(p, horizon, precedence_mode, **opts)
    m2.Add(v2["makespan"] <= best_makespan)
    m2.Minimize(sum(v2["busy"].values()))
    _apply_hint(m2, v2, best)

    s2 = _solver(max_seconds - (time.time() - t0), workers, log)
    st2 = s2.Solve(m2)
    if st2 in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        best = Schedule(
            portions=_extract(s2, v2), makespan=s2.Value(v2["makespan"]),
            objective_bound=bound,   # the makespan bound is still phase 1's
            status=f"{s1.StatusName(st1)}/{s2.StatusName(st2)}",
            solve_seconds=time.time() - t0,
            source=f"cp-sat/{precedence_mode}",
        )
    return best
