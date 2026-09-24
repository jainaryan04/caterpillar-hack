"""The scheduling problem instance: durations -> rates, plus every index the
solver and the checker both need.

Time is handled in BUCKETS throughout. BUCKET_MINUTES = 1 means no bucketing;
raising it shrinks every variable domain proportionally. Whatever it is set to,
`rate` is recomputed in the same unit -- a rate left in work-units-per-MINUTE
while `busy` counts buckets makes the completion constraint wrong by exactly
that factor, and every task is declared finished after a fraction of its work.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import pandas as pd

# Abstract work units per task. The real physical quantity never enters the
# solver, which sidesteps all unit handling: a task is done when its portions
# have delivered SCALE units between them.
SCALE = 100_000

BUCKET_MINUTES = 1

# Shortest slice of a task worth dispatching a crew and machine for.
# Without this the tie-break produces degenerate slivers: because completion is
# sum(rate * busy) >= SCALE, spending one minute on a FASTER pair removes more
# than a minute from a slower one, so minimising total busy time actively
# rewards attaching a 1-minute portion to every task. Observed in the first
# end-to-end run: a portion of 1 minute delivering 0.8% of a task.
# This is the cheap form of the mobilisation cost deferred in PLAN 4.8.5.
MIN_PORTION_MINUTES = 30

# Efficiency of running k portions of one task concurrently.
# Two machines rated 200 and 180 units/min do NOT give 380: they share haul
# roads, loading faces and spotters, and they get in each other's way. Without
# this, parallelism is free and the solver will over-use it. Keyed by the
# NUMBER of concurrent portions, which keeps the constraint linear -- the work
# a task needs becomes SCALE / eff(k), a constant per k.
PARALLEL_EFFICIENCY = {1: 1.00, 2: 0.90, 3: 0.82, 4: 0.75}


@dataclass
class Problem:
    tasks: pd.DataFrame
    workers: pd.DataFrame
    machines: pd.DataFrame
    candidates: pd.DataFrame
    bucket: int = BUCKET_MINUTES

    # (task_id, worker_id, machine_id) -> duration in buckets / rate
    dur: dict = field(default_factory=dict)
    rate: dict = field(default_factory=dict)
    cand_of_task: dict = field(default_factory=dict)

    task_row: dict = field(default_factory=dict)
    worker_row: dict = field(default_factory=dict)
    machine_row: dict = field(default_factory=dict)

    # industry -> ordered list of stage numbers present
    stages_of_industry: dict = field(default_factory=dict)
    tasks_in: dict = field(default_factory=dict)      # (industry, stage) -> [task_id]

    avail_from: dict = field(default_factory=dict)
    avail_until: dict = field(default_factory=dict)

    def to_minutes(self, buckets: int) -> int:
        return int(buckets) * self.bucket


def build_problem(tasks, workers, machines, candidates, bucket=BUCKET_MINUTES) -> Problem:
    p = Problem(tasks=tasks, workers=workers, machines=machines,
                candidates=candidates, bucket=bucket)

    p.task_row = {t.task_id: t for t in tasks.itertuples(index=False)}
    p.worker_row = {w.worker_id: w for w in workers.itertuples(index=False)}
    p.machine_row = {m.machine_id: m for m in machines.itertuples(index=False)}

    for c in candidates.itertuples(index=False):
        key = (c.task_id, c.worker_id, c.machine_id)
        # Round the duration UP to a whole number of buckets (pessimistic), then
        # the rate UP (optimistic). The two roundings pull against each other,
        # which keeps the residual error small and one-sided -- see PLAN 4.8.1:
        # rounding the rate DOWN would leave a single full-duration portion
        # unable to finish its own task by a sliver.
        dur_buckets = max(1, math.ceil(c.predicted_duration / bucket))
        p.dur[key] = dur_buckets
        p.rate[key] = math.ceil(SCALE / dur_buckets)
        p.cand_of_task.setdefault(c.task_id, []).append((c.worker_id, c.machine_id))

    for t in tasks.itertuples(index=False):
        p.stages_of_industry.setdefault(t.industry, set()).add(t.task_priority)
        p.tasks_in.setdefault((t.industry, t.task_priority), []).append(t.task_id)
    p.stages_of_industry = {k: sorted(v) for k, v in p.stages_of_industry.items()}

    for w in workers.itertuples(index=False):
        # available_from rounds UP and available_until rounds DOWN, so bucketing
        # can only ever shrink a window, never invent availability.
        p.avail_from[w.worker_id] = math.ceil(w.available_from / bucket)
        p.avail_until[w.worker_id] = math.floor(w.available_until / bucket)

    return p


@dataclass
class Portion:
    task_id: str
    worker_id: str
    machine_id: str
    start: int   # buckets
    busy: int    # buckets
    end: int     # buckets


@dataclass
class Schedule:
    portions: list
    makespan: int                 # buckets
    objective_bound: float = 0.0  # buckets; best possible makespan per the solver
    status: str = ""
    solve_seconds: float = 0.0
    source: str = ""

    def gap_pct(self) -> float:
        """How far from the proven optimum this schedule could possibly be."""
        if self.makespan <= 0 or self.objective_bound <= 0:
            return float("nan")
        return 100.0 * (self.makespan - self.objective_bound) / self.objective_bound

    def total_busy(self) -> int:
        return sum(p.busy for p in self.portions)

    def by_task(self) -> dict:
        out = {}
        for p in self.portions:
            out.setdefault(p.task_id, []).append(p)
        return out
