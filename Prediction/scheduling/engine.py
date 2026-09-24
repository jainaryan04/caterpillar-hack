"""One planning entry point, shared by the CLI and the HTTP API.

Before this module the two-pass loop lived inside run_scheduler.py, tangled up
with the report formatting, so the API could not reuse it without either
importing a printer or copying the loop. Copying it would have been the worse
bug: the two would drift, and the number on the dashboard would stop being the
number in the report.

`plan()` computes; run_scheduler.py formats; api/service.py serialises. None of
them duplicates the other.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field

import pandas as pd

from prediction_service.candidates import generate_candidates
from prediction_service.predict import predict_durations

from .bounds import chain_lower_bound
from .cp_sat_model import solve
from .greedy import greedy_schedule
from .problem import Problem, Schedule, build_problem
from .resource_state import project_candidate_state, simulate, state_drift
from .verify import verify


@dataclass
class PlanOptions:
    seconds: float = 20.0
    bucket: int = 1
    two_pass: bool = True
    parallel_efficiency: bool = True
    task_continuity: bool = True
    precedence_mode: str = "per_industry"
    solver_workers: int = 8


@dataclass
class PlanResult:
    """Everything a caller could want, already computed. Deliberately holds the
    Problem it belongs to: every figure is in buckets, and only the Problem
    knows how many minutes a bucket is."""

    problem: Problem
    schedule: Schedule            # the one to act on
    greedy: Schedule              # deterministic baseline, for the comparison
    lower_bound: int              # buckets
    chains: dict                  # industry -> chain bound in buckets
    violations: list
    fatigue: dict                 # worker_id -> Timeline
    temp: dict                    # machine_id -> Timeline
    drift: dict = field(default_factory=dict)
    passes: int = 1
    n_candidates: int = 0
    pass1_makespan: int = 0
    wall_seconds: float = 0.0

    @property
    def ok(self) -> bool:
        return bool(self.schedule.portions) and not self.violations


def plan(tasks: pd.DataFrame,
         workers: pd.DataFrame,
         machines: pd.DataFrame,
         opts: PlanOptions | None = None) -> PlanResult:
    """predict -> solve -> simulate -> re-predict -> solve.

    Pass 2 is a heuristic, not a fixed point: fatigue and engine temperature
    are model INPUTS whose values depend on the schedule, which is a solver
    OUTPUT. If pass 2 comes back worse than pass 1 (it can -- the durations it
    was given are different ones), pass 1 is kept.
    """
    opts = opts or PlanOptions()
    t0 = time.time()
    solver_kw = dict(precedence_mode=opts.precedence_mode,
                     max_seconds=opts.seconds,
                     workers=opts.solver_workers,
                     parallel_efficiency=opts.parallel_efficiency,
                     task_continuity=opts.task_continuity)

    cand1 = predict_durations(generate_candidates(tasks, workers, machines),
                              verbose=False)
    p1 = build_problem(tasks, workers, machines, cand1, bucket=opts.bucket)
    lb, chains = chain_lower_bound(p1, detail=True)

    g1 = greedy_schedule(p1, precedence_mode=opts.precedence_mode)
    s1 = solve(p1, horizon=g1.makespan, hint=g1, **solver_kw)
    if not s1.portions:
        return PlanResult(problem=p1, schedule=s1, greedy=g1, lower_bound=lb,
                          chains=chains, violations=["no feasible schedule found"],
                          fatigue={}, temp={}, n_candidates=len(cand1),
                          wall_seconds=time.time() - t0)

    best_p, best_s, best_g, drift, passes = p1, s1, g1, {}, 1

    if opts.two_pass:
        cand2 = project_candidate_state(p1, s1, cand1)
        drift = state_drift(cand1, cand2)
        cand2 = predict_durations(cand2, verbose=False)
        p2 = build_problem(tasks, workers, machines, cand2, bucket=opts.bucket)
        g2 = greedy_schedule(p2, precedence_mode=opts.precedence_mode)
        s2 = solve(p2, horizon=max(g2.makespan, s1.makespan), hint=g2, **solver_kw)
        # Compare in minutes, not buckets: both problems share a bucket size,
        # but making that assumption implicit is how unit bugs start.
        if s2.portions and p2.to_minutes(s2.makespan) <= p1.to_minutes(s1.makespan):
            best_p, best_s, best_g, passes = p2, s2, g2, 2

    fatigue, temp = simulate(best_p, best_s)
    return PlanResult(
        problem=best_p, schedule=best_s, greedy=best_g,
        lower_bound=lb, chains=chains,
        violations=verify(best_p, best_s),
        fatigue=fatigue, temp=temp, drift=drift, passes=passes,
        n_candidates=len(cand1),
        pass1_makespan=p1.to_minutes(s1.makespan),
        wall_seconds=time.time() - t0,
    )
