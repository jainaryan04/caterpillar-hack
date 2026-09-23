"""End-to-end scheduler: predict -> solve -> simulate -> re-predict -> solve.

    python -m scheduling.run_scheduler [--seconds 60] [--bucket 1] [--compare-barrier]

Output: reports/schedule_report.txt and reports/schedule.csv

The two-pass structure exists because fatigue and engine temperature are model
INPUTS whose values depend on the schedule, which is a solver OUTPUT. Pass 1
uses each resource's state as it stands today; the tentative schedule is then
simulated forward, and pass 2 re-prices every candidate against the state its
resources will actually be in.

> This is a HEURISTIC, not a proven optimum. Each pass is solved to (a measured
> distance from) optimality for the durations it was given, but the durations
> themselves depend on the schedule, so the fixed point is not guaranteed. The
> output is not "the optimal schedule" and must not be described as one.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import pandas as pd

from prediction_service.candidates import candidate_summary, generate_candidates
from prediction_service.loaders import load_all
from prediction_service.predict import predict_durations

from .bounds import barrier_lower_bound, chain_lower_bound
from .cp_sat_model import solve
from .greedy import greedy_schedule
from .problem import build_problem
from .resource_state import project_candidate_state, simulate, state_drift
from .verify import verify

REPORT_DIR = Path(__file__).resolve().parent.parent / "reports"


class Report:
    def __init__(self):
        self.lines = []

    def add(self, text=""):
        self.lines.append(text)
        print(text)

    def save(self, path):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("\n".join(self.lines), encoding="utf-8")


def section(r, title):
    r.add("")
    r.add("=" * 70)
    r.add(title)
    r.add("=" * 70)


def describe(r, p, label, sched, lb):
    v = verify(p, sched)
    r.add(f"\n{label}")
    r.add(f"  makespan        {p.to_minutes(sched.makespan):>7} min "
          f"({p.to_minutes(sched.makespan) / 1440:.2f} days)")
    r.add(f"  total resource  {p.to_minutes(sched.total_busy()):>7} min")
    r.add(f"  portions        {len(sched.portions):>7} over {len(sched.by_task())} tasks")
    if sched.objective_bound:
        r.add(f"  proven bound    {p.to_minutes(sched.objective_bound):>7} min "
              f"-> within {sched.gap_pct():.1f}% of optimal")
    r.add(f"  status          {sched.status}  ({sched.solve_seconds:.1f}s)")
    r.add(f"  verifier        {'CLEAN' if not v else f'{len(v)} VIOLATIONS'}")
    for x in v[:5]:
        r.add(f"      ! {x}")
    return v


def write_schedule_csv(p, sched, path):
    rows = []
    for x in sorted(sched.portions, key=lambda z: (z.start, z.task_id)):
        t = p.task_row[x.task_id]
        rows.append({
            "task_id": x.task_id, "task_type": t.task_type, "industry": t.industry,
            "stage": t.task_priority, "execution_mode": t.execution_mode,
            "worker_id": x.worker_id, "machine_id": x.machine_id,
            "start_min": p.to_minutes(x.start), "end_min": p.to_minutes(x.end),
            "busy_min": p.to_minutes(x.busy),
            "work_share_pct": round(
                100 * p.rate[(x.task_id, x.worker_id, x.machine_id)] * x.busy / 100_000, 1),
        })
    df = pd.DataFrame(rows)
    df.to_csv(path, index=False)
    return df


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seconds", type=float, default=60.0)
    ap.add_argument("--bucket", type=int, default=1)
    ap.add_argument("--compare-barrier", action="store_true",
                    help="also solve with the naive global stage barrier, to "
                         "measure what that reading costs")
    args = ap.parse_args()

    r = Report()
    section(r, "SCHEDULER")

    tasks, workers, machines = load_all()
    r.add(f"{len(tasks)} tasks | {len(workers)} workers | {len(machines)} machines")

    cand1 = predict_durations(generate_candidates(tasks, workers, machines))
    r.add(candidate_summary(cand1))
    p1 = build_problem(tasks, workers, machines, cand1, bucket=args.bucket)
    r.add(f"time bucket: {args.bucket} min")

    lb, chains = chain_lower_bound(p1, detail=True)
    section(r, "LOWER BOUND")
    r.add("Per-industry chain bounds (stages are sequential, resources are finite):")
    for ind, val in sorted(chains.items(), key=lambda kv: -kv[1]):
        r.add(f"  {ind:20} {p1.to_minutes(val):>6} min")
    r.add(f"\nNo schedule can finish before {p1.to_minutes(lb)} min. "
          f"Bottleneck: {max(chains, key=chains.get)}.")

    section(r, "PASS 1 -- resources as they stand today")
    g = greedy_schedule(p1)
    describe(r, p1, "Greedy baseline", g, lb)
    s1 = solve(p1, horizon=g.makespan, hint=g, max_seconds=args.seconds)
    describe(r, p1, "CP-SAT", s1, lb)
    if not s1.portions:
        r.add("\nno feasible schedule found; stopping")
        r.save(REPORT_DIR / "schedule_report.txt")
        return
    r.add(f"\n  CP-SAT vs greedy: {100 * (g.makespan - s1.makespan) / g.makespan:+.1f}% makespan, "
          f"{100 * (g.total_busy() - s1.total_busy()) / g.total_busy():+.1f}% resource time")

    section(r, "RESOURCE STATE SIMULATION")
    cand2 = project_candidate_state(p1, s1, cand1)
    drift = state_drift(cand1, cand2)
    r.add(f"fatigue moved: mean {drift['fatigue_mean']:.1f} / max {drift['fatigue_max']:.1f} points")
    r.add(f"engine temp moved: mean {drift['temp_mean']:.1f} / max {drift['temp_max']:.1f} C")
    r.add(f"candidates that moved materially (>5 pts or >5 C): {drift['material']} "
          f"of {len(cand2)}")

    section(r, "PASS 2 -- re-priced against projected state")
    cand2 = predict_durations(cand2)
    shift = (cand2["predicted_duration"] - cand1["predicted_duration"])
    r.add(f"duration change: mean {shift.mean():+.1f} min, max {shift.max():+.1f} min")
    p2 = build_problem(tasks, workers, machines, cand2, bucket=args.bucket)
    g2 = greedy_schedule(p2)
    s2 = solve(p2, horizon=max(g2.makespan, s1.makespan), hint=g2, max_seconds=args.seconds)
    v2 = describe(r, p2, "CP-SAT (final)", s2, lb)

    final, pf = (s2, p2) if s2.portions else (s1, p1)

    if args.compare_barrier:
        section(r, "WHAT THE NAIVE GLOBAL STAGE BARRIER COSTS")
        blb = barrier_lower_bound(p1)
        r.add(f"  lower bound, global barrier : {p1.to_minutes(blb)} min")
        r.add(f"  lower bound, per-industry   : {p1.to_minutes(lb)} min")
        r.add(f"  the barrier raises the FLOOR by "
              f"{100 * (blb - lb) / lb:+.1f}% before any solving happens")
        gb = greedy_schedule(p1, precedence_mode="global")
        sb = solve(p1, horizon=gb.makespan, hint=gb,
                   precedence_mode="global", max_seconds=args.seconds)
        if sb.portions:
            r.add(f"  global barrier : {p1.to_minutes(sb.makespan)} min")
            r.add(f"  per-industry   : {p1.to_minutes(s1.makespan)} min")
            r.add(f"  measured cost of the barrier: "
                  f"{100 * (sb.makespan - s1.makespan) / s1.makespan:+.1f}%")
        else:
            r.add(f"  global barrier: no solution within the time limit ({sb.status})")

    section(r, "FINAL SCHEDULE")
    df = write_schedule_csv(pf, final, REPORT_DIR / "schedule.csv")
    r.add(f"{len(df)} portions -> {REPORT_DIR / 'schedule.csv'}")

    split = df.groupby("task_id").size()
    r.add(f"tasks run in parallel: {int((split > 1).sum())} of {split.size} "
          f"(max {int(split.max())} concurrent portions)")
    r.add(f"workers used: {df.worker_id.nunique()} of {len(workers)} | "
          f"machines used: {df.machine_id.nunique()} of {len(machines)}")

    fat, tmp = simulate(pf, final)
    end_f = [t.final() for t in fat.values()]
    r.add(f"end-of-schedule fatigue: mean {sum(end_f) / len(end_f):.1f}, max {max(end_f):.1f}")

    r.add("\nFirst 10 portions:")
    r.add(df.head(10).to_string(index=False))

    section(r, "HONEST SUMMARY")
    r.add(f"Makespan {pf.to_minutes(final.makespan)} min against a proven lower bound of "
          f"{pf.to_minutes(lb)} min.")
    r.add(f"Optimality gap for the durations given: {final.gap_pct():.1f}%.")
    r.add("The durations themselves carry the model's ~11.5 min MAE, so this is")
    r.add("near-optimal FOR THE ESTIMATES, not a guaranteed real-world optimum.")
    r.add("The two-pass fatigue loop is a heuristic; no fixed point is proven.")
    r.add(f"Independent verification: {'PASS' if not v2 else 'FAIL'}")

    r.save(REPORT_DIR / "schedule_report.txt")
    print(f"\nReport -> {REPORT_DIR / 'schedule_report.txt'}")


if __name__ == "__main__":
    main()
