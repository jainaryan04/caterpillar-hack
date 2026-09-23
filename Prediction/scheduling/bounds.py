"""An analytical lower bound on the makespan.

CP-SAT's own LP relaxation is very weak on this model -- measured 628 min
against a schedule of 2,777, i.e. it could prove almost nothing. The structure
it cannot see is that each industry's stages are strictly sequential while its
resources are strictly limited, which is exactly the thing that is easy to
reason about by hand.

Feeding this back in as `makespan >= LB` does two jobs: it prunes the search,
and it makes the reported optimality gap meaningful instead of vacuous.

Validity of each step (all of it must be a genuine lower bound, or we would cut
off the true optimum):

  * A task needs at least `min_dur` of total resource-time. Work conservation
    says sum(rate * busy) >= SCALE, and rate is largest for the fastest
    candidate, so sum(busy) >= SCALE / max_rate = min_dur. Splitting the task
    does not reduce the total; it only spreads it.
  * A group of same-type tasks in one stage can run at most
    `min(#eligible workers, #eligible machines)` at a time, so its elapsed time
    is at least total-work / that concurrency.
  * One task can be split at most `max_parallel` ways, so it alone takes at
    least `min_dur / max_parallel`.
  * Within a stage, taking the MAX across task types is a lower bound: ignoring
    the contention between types can only make the estimate smaller.
  * Stages within an industry are strictly sequential, so their bounds add.
  * Industries run concurrently, so the overall bound is the largest chain.

Every division floors, so rounding can only ever weaken the bound, never make
it invalid.
"""

from __future__ import annotations


def _group_bound(p, task_ids, n_workers, n_machines) -> int:
    """Lower bound for one set of same-task-type tasks inside one stage."""
    mins = [min(p.dur[(t, w, m)] for (w, m) in p.cand_of_task[t]) for t in task_ids]
    concurrency = max(1, min(n_workers, n_machines))
    cap = min(int(p.task_row[task_ids[0]].max_parallel), concurrency)

    by_throughput = sum(mins) // concurrency      # all the work, spread as wide as allowed
    by_longest = max(mins) // max(1, cap)         # the single biggest job, split as wide as allowed
    return max(by_throughput, by_longest)


def chain_lower_bound(p, detail: bool = False):
    """Lower bound on makespan in buckets. With detail=True also returns the
    per-industry chain bounds, which is what identifies the bottleneck."""
    n_workers: dict[str, int] = {}
    for w in p.workers.itertuples(index=False):
        for skill in w.skill_set:
            n_workers[skill] = n_workers.get(skill, 0) + 1
    n_machines = p.machines.machine_type.value_counts().to_dict()

    chains: dict[str, int] = {}
    for industry, stages in p.stages_of_industry.items():
        total = 0
        for s in stages:
            ids = p.tasks_in[(industry, s)]
            by_type: dict[str, list] = {}
            for t in ids:
                by_type.setdefault(p.task_row[t].task_type, []).append(t)
            total += max(
                _group_bound(p, group,
                             n_workers.get(tt, 0),
                             n_machines.get(p.task_row[group[0]].required_machine_type, 0))
                for tt, group in by_type.items()
            )
        chains[industry] = total

    lb = max(chains.values()) if chains else 0
    return (lb, chains) if detail else lb


def barrier_lower_bound(p) -> int:
    """Lower bound if ALL industries share one global stage barrier.

    Under the barrier, stage s+1 waits for every industry's stage s, so the
    makespan is at least sum-over-stages of the slowest industry in that stage.
    Per-industry chains give max-over-industries of sum-over-stages. Since
    sum(max) >= max(sum), the barrier can never be better -- this quantifies
    by how much, without paying for a second full solve.
    """
    n_workers: dict[str, int] = {}
    for w in p.workers.itertuples(index=False):
        for skill in w.skill_set:
            n_workers[skill] = n_workers.get(skill, 0) + 1
    n_machines = p.machines.machine_type.value_counts().to_dict()

    all_stages = sorted({t.task_priority for t in p.task_row.values()})
    total = 0
    for s in all_stages:
        worst = 0
        for industry, stages in p.stages_of_industry.items():
            if s not in stages:
                continue
            ids = p.tasks_in[(industry, s)]
            by_type: dict[str, list] = {}
            for t in ids:
                by_type.setdefault(p.task_row[t].task_type, []).append(t)
            worst = max(worst, max(
                _group_bound(p, group, n_workers.get(tt, 0),
                             n_machines.get(p.task_row[group[0]].required_machine_type, 0))
                for tt, group in by_type.items()))
        total += worst
    return total
