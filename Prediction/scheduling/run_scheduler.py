"""Command-line scheduler: predict -> solve -> simulate -> re-predict -> solve.

    python -m scheduling.run_scheduler [--seconds 60] [--bucket 1] [--compare-barrier]

Output: reports/schedule_report.txt and reports/schedule.csv

The planning itself lives in scheduling/engine.py, which the HTTP API calls
too. This file only formats -- so the number printed here and the number on the
dashboard are the same number, not two implementations that agree today.

> The two-pass loop is a HEURISTIC, not a proven optimum. Each pass is solved to
> a measured distance from optimality for the durations it was given, but the
> durations themselves depend on the schedule, so the fixed point is not
> guaranteed. The output is not "the optimal schedule" and must not be
> described as one.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import pandas as pd

from prediction_service.candidates import generate_candidates
from prediction_service.loaders import load_all
from prediction_service.predict import predict_durations

from . import summary as S
from .bounds import barrier_lower_bound, chain_lower_bound
from .cp_sat_model import solve
from .engine import PlanOptions, plan
from .greedy import greedy_schedule
from .problem import build_problem

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


def write_schedule_csv(res, path) -> pd.DataFrame:
    df = pd.DataFrame(S.assignments(res))
    # No calendar anchor on the CLI, so the resolved timestamps are all null.
    # A column of Nones in a CSV is noise a reader has to rule out.
    df = df.drop(columns=["start_at", "end_at"])
    path.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(path, index=False)
    return df


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seconds", type=float, default=60.0)
    ap.add_argument("--bucket", type=int, default=1)
    ap.add_argument("--single-pass", action="store_true",
                    help="skip the fatigue/temperature re-pricing pass")
    ap.add_argument("--compare-barrier", action="store_true",
                    help="also solve with the naive global stage barrier, to "
                         "measure what that reading costs")
    args = ap.parse_args()

    r = Report()
    section(r, "SCHEDULER")

    tasks, workers, machines = load_all()
    r.add(f"{len(tasks)} tasks | {len(workers)} workers | {len(machines)} machines")
    r.add(f"time bucket: {args.bucket} min")

    opts = PlanOptions(seconds=args.seconds, bucket=args.bucket,
                       two_pass=not args.single_pass)
    res = plan(tasks, workers, machines, opts)
    p = res.problem

    section(r, "LOWER BOUND")
    r.add("Per-industry chain bounds (stages are sequential, resources are finite):")
    for row in S.bottlenecks(res):
        mark = "  <- critical" if row["is_critical"] else ""
        r.add(f"  {row['industry']:20} {row['chain_bound_min']:>6} min{mark}")
    r.add(f"\nNo schedule can finish before {p.to_minutes(res.lower_bound)} min.")

    if not res.schedule.portions:
        r.add("\nno feasible schedule found; stopping")
        r.save(REPORT_DIR / "schedule_report.txt")
        return

    s = S.run_summary(res, opts)
    section(r, "RESULT")
    r.add(f"  greedy baseline   {s['greedy_makespan_min']:>7} min")
    r.add(f"  CP-SAT            {s['makespan_min']:>7} min "
          f"({s['makespan_days']} days)  {s['improvement_vs_greedy_pct']:+.1f}% vs greedy")
    r.add(f"  proven bound      {s['lower_bound_min']:>7} min "
          f"-> {s['gap_vs_analytical_bound_pct']:.1f}% above the floor")
    r.add(f"  total resource    {s['total_busy_min']:>7} min")
    r.add(f"  portions          {s['n_portions']:>7} over {s['n_tasks']} tasks "
          f"({s['n_split_tasks']} split)")
    r.add(f"  pairings priced   {s['n_candidates']:>7}")
    r.add(f"  status            {s['solver_status']}  "
          f"({s['solve_seconds']}s solve, {s['wall_seconds']}s wall, "
          f"{s['passes']} pass(es))")
    r.add(f"  verifier          {'CLEAN' if s['verified'] else 'VIOLATIONS'}")
    for v in s["violations"][:5]:
        r.add(f"      ! {v}")

    if res.drift:
        section(r, "RESOURCE STATE SIMULATION")
        d = res.drift
        r.add(f"fatigue moved: mean {d['fatigue_mean']:.1f} / max {d['fatigue_max']:.1f} points")
        r.add(f"engine temp moved: mean {d['temp_mean']:.1f} / max {d['temp_max']:.1f} C")
        r.add(f"candidates that moved materially (>5 pts or >5 C): {d['material']}")
        r.add(f"pass 1 makespan {res.pass1_makespan} min -> "
              f"pass {res.passes} kept {s['makespan_min']} min")

    if args.compare_barrier:
        section(r, "WHAT THE NAIVE GLOBAL STAGE BARRIER COSTS")
        cand = predict_durations(generate_candidates(tasks, workers, machines),
                                 verbose=False)
        p1 = build_problem(tasks, workers, machines, cand, bucket=args.bucket)
        lb = chain_lower_bound(p1)
        blb = barrier_lower_bound(p1)
        r.add(f"  lower bound, global barrier : {p1.to_minutes(blb)} min")
        r.add(f"  lower bound, per-industry   : {p1.to_minutes(lb)} min")
        r.add(f"  the barrier raises the FLOOR by {100 * (blb - lb) / lb:+.1f}% "
              f"before any solving happens")
        gb = greedy_schedule(p1, precedence_mode="global")
        sb = solve(p1, horizon=gb.makespan, hint=gb, precedence_mode="global",
                   max_seconds=args.seconds)
        if sb.portions:
            r.add(f"  global barrier : {p1.to_minutes(sb.makespan)} min")
            r.add(f"  per-industry   : {s['makespan_min']} min")
            r.add(f"  measured cost of the barrier: "
                  f"{100 * (p1.to_minutes(sb.makespan) - s['makespan_min']) / s['makespan_min']:+.1f}%")
        else:
            r.add(f"  global barrier: no solution within the time limit ({sb.status})")

    section(r, "FINAL SCHEDULE")
    df = write_schedule_csv(res, REPORT_DIR / "schedule.csv")
    r.add(f"{len(df)} portions -> {REPORT_DIR / 'schedule.csv'}")
    r.add(f"workers used: {s['workers_used']} of {s['workers_total']} | "
          f"machines used: {s['machines_used']} of {s['machines_total']}")

    mu = S.machine_usage(res)
    r.add(f"\nBusiest machines:")
    for m in mu[:5]:
        r.add(f"  {m['machine_id']:6} {m['machine_type']:22} "
              f"{m['utilization_pct']:>5.1f}% over {m['n_tasks']} tasks, "
              f"engine {m['start_temp_c']:.0f} -> {m['end_temp_c']:.0f} C")
    r.add(f"  {sum(1 for m in mu if m['n_tasks'] == 0)} machines never used")

    wu = S.worker_usage(res)
    end_f = [w["end_fatigue"] for w in wu]
    r.add(f"end-of-schedule fatigue: mean {sum(end_f) / len(end_f):.1f}, max {max(end_f):.1f}")

    r.add("\nFirst 10 portions:")
    r.add(df.head(10).to_string(index=False))

    section(r, "HONEST SUMMARY")
    r.add(f"Makespan {s['makespan_min']} min against a proven lower bound of "
          f"{s['lower_bound_min']} min -- {100 * s['lower_bound_min'] / s['makespan_min']:.0f}% "
          f"of the schedule is forced by the roster, not chosen by the solver.")
    r.add(f"Optimality gap for the durations given: {s['optimality_gap_pct']}%.")
    r.add("The durations themselves carry the model's ~11.6 min MAE, so this is")
    r.add("near-optimal FOR THE ESTIMATES, not a guaranteed real-world optimum.")
    r.add("The two-pass fatigue loop is a heuristic; no fixed point is proven.")
    r.add(f"Independent verification: {'PASS' if s['verified'] else 'FAIL'}")

    r.save(REPORT_DIR / "schedule_report.txt")
    print(f"\nReport -> {REPORT_DIR / 'schedule_report.txt'}")


if __name__ == "__main__":
    main()
