"""Reproducible results for the scheduler.

    python scripts/experiments.py --only AB --seconds 20 --repeats 3
    python scripts/experiments.py --only C  --seconds 20 --repeats 3

  A. What the realism constraints cost (parallel efficiency, task continuity)
  B. Headline: greedy vs CP-SAT vs a proven lower bound
  C. The bottleneck: add Oil & Gas rigs and watch the schedule shorten

EVERY CP-SAT number here is a median over `repeats` runs, with the range shown.
CP-SAT with 8 threads under a wall-clock limit is nondeterministic: measured
spread on identical runs is ~65 min (2,779-2,844), which is LARGER than most of
the effects being compared. A single run cannot distinguish these
configurations, and quoting one would be cherry-picking.

Greedy is deterministic, so it needs no repeats.

Writes reports/experiments.txt
"""

import argparse
import statistics
import sys
from pathlib import Path

import pandas as pd

BASE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE))

from prediction_service.candidates import generate_candidates          # noqa: E402
from prediction_service.loaders import load_all                        # noqa: E402
from prediction_service.predict import predict_durations               # noqa: E402
from scheduling.bounds import chain_lower_bound                        # noqa: E402
from scheduling.cp_sat_model import solve                              # noqa: E402
from scheduling.greedy import greedy_schedule                          # noqa: E402
from scheduling.problem import build_problem                           # noqa: E402
from scheduling.verify import verify                                   # noqa: E402

OIL_GAS_TYPES = ["Drilling Rig", "Well Service Rig", "Pipeline Pump", "Gas Compressor"]
REPORT = BASE / "reports" / "experiments.txt"


class Out:
    def __init__(self):
        self.lines = []

    def __call__(self, text=""):
        self.lines.append(text)
        print(text)

    def save(self):
        REPORT.parent.mkdir(parents=True, exist_ok=True)
        REPORT.write_text("\n".join(self.lines), encoding="utf-8")


def add_units(machines: pd.DataFrame, types, n: int) -> pd.DataFrame:
    """Extra machines, with varied age/temperature so they are not symmetric
    clones (identical units make CP-SAT explore interchangeable solutions)."""
    if n <= 0:
        return machines
    extra = []
    for i, mt in enumerate(types):
        proto = machines[machines.machine_type == mt].iloc[0]
        for j in range(n):
            extra.append(dict(
                machine_id=f"X{i}{j}", machine_type=mt,
                age_years=round(float(proto.age_years) * (0.7 + 0.2 * j), 2),
                engine_temp_c=round(float(proto.engine_temp_c) - 3 - 2 * j, 1),
            ))
    return pd.concat([machines, pd.DataFrame(extra)], ignore_index=True)


def setup(tasks, workers, machines):
    cand = predict_durations(generate_candidates(tasks, workers, machines), verbose=False)
    return build_problem(tasks, workers, machines, cand)


def bench(p, seconds, repeats, **kw):
    """Greedy (deterministic) plus `repeats` CP-SAT runs. Returns the greedy
    schedule, the median run, and the (min, max) makespan seen."""
    g = greedy_schedule(p)
    runs = [solve(p, horizon=g.makespan, hint=g, max_seconds=seconds, **kw)
            for _ in range(repeats)]
    runs = [r for r in runs if r.portions]
    if not runs:
        return g, None, (0, 0)
    runs.sort(key=lambda s: s.makespan)
    return g, runs[len(runs) // 2], (runs[0].makespan, runs[-1].makespan)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seconds", type=float, default=20.0)
    ap.add_argument("--repeats", type=int, default=3)
    ap.add_argument("--only", default="ABC")
    args = ap.parse_args()
    o = Out()

    tasks, workers, machines = load_all()
    p = setup(tasks, workers, machines)
    lb = chain_lower_bound(p)
    o(f"110 tasks | 30 workers | {len(machines)} machines | "
      f"{args.repeats} runs x {args.seconds:.0f}s per configuration")
    o("All CP-SAT figures are MEDIAN [min-max] over repeated identical runs.")

    if "A" in args.only:
        o("")
        o("=" * 74)
        o("A. WHAT THE REALISM CONSTRAINTS COST")
        o("=" * 74)
        o("parallel efficiency : 2 machines rated 200 and 180 do NOT give 380")
        o("task continuity     : a task cannot be abandoned half-done and resumed")
        o("")
        o(f"{'configuration':32}{'makespan (median)':>20}{'split tasks':>13}{'verify':>9}")
        for label, kw in [
            ("neither (parallelism free)", dict(parallel_efficiency=False, task_continuity=False)),
            ("+ task continuity", dict(parallel_efficiency=False, task_continuity=True)),
            ("+ parallel efficiency", dict(parallel_efficiency=True, task_continuity=False)),
            ("both (shipped default)", dict(parallel_efficiency=True, task_continuity=True)),
        ]:
            g, s, (lo, hi) = bench(p, args.seconds, args.repeats, **kw)
            split = sum(1 for v in s.by_task().values() if len(v) > 1)
            o(f"{label:32}{p.to_minutes(s.makespan):>8} "
              f"[{p.to_minutes(lo)}-{p.to_minutes(hi)}]".ljust(20)
              + f"{split:>10}{'CLEAN' if not verify(p, s) else 'FAIL':>12}")
        o("")
        o("Read the SPLIT column, not the makespan column. The makespan")
        o("differences sit inside the run-to-run spread and mean nothing here.")
        o("Splitting collapses once parallelism stops being free -- which is the")
        o("constraint doing its job.")

    if "B" in args.only:
        o("")
        o("=" * 74)
        o("B. HEADLINE -- GREEDY vs CP-SAT vs PROVEN BOUND")
        o("=" * 74)
        g, s, (lo, hi) = bench(p, args.seconds, args.repeats)
        o("")
        o(f"  {'Lower bound (proven -- nothing can beat it)':46}{p.to_minutes(lb):>8} min")
        o(f"  {'Greedy baseline (deterministic)':46}{p.to_minutes(g.makespan):>8} min")
        o(f"  {'CP-SAT (median)':46}{p.to_minutes(s.makespan):>8} min "
          f"[{p.to_minutes(lo)}-{p.to_minutes(hi)}]")
        o("")
        o(f"  Improvement over greedy   {100 * (g.makespan - s.makespan) / g.makespan:>5.1f}%"
          f"   (range {100 * (g.makespan - hi) / g.makespan:.1f}% to "
          f"{100 * (g.makespan - lo) / g.makespan:.1f}%)")
        o(f"  Best bound                {p.to_minutes(s.objective_bound):>5} min")
        o(f"  Optimality gap            {s.gap_pct():>5.1f}%")
        o(f"  Independent verification: {'PASS' if not verify(p, s) else 'FAIL'}")

    if "C" in args.only:
        o("")
        o("=" * 74)
        o("C. THE BOTTLENECK -- ADD OIL & GAS RIGS")
        o("=" * 74)
        o("Every Oil & Gas stage is single-rig work with 2 machines for 5 tasks,")
        o("so those tasks queue. That is a roster decision, not a solver limit.")
        o("")
        o(f"{'rigs/type':>10}{'machines':>10}{'bound':>8}{'greedy':>9}"
          f"{'CP-SAT (median)':>22}{'vs greedy':>11}")
        for extra in (0, 1, 2, 4):
            mm = add_units(machines, OIL_GAS_TYPES, extra)
            pp = setup(tasks, workers, mm)
            gg, ss, (lo, hi) = bench(pp, args.seconds, args.repeats)
            if ss is None:
                o(f"{2 + extra:>10}{len(mm):>10}   no solution within the time limit")
                continue
            o(f"{2 + extra:>10}{len(mm):>10}{pp.to_minutes(chain_lower_bound(pp)):>8}"
              f"{pp.to_minutes(gg.makespan):>9}"
              + f"{pp.to_minutes(ss.makespan)} [{pp.to_minutes(lo)}-{pp.to_minutes(hi)}]".rjust(22)
              + f"{100 * (gg.makespan - ss.makespan) / gg.makespan:>10.1f}%")
        o("")
        o("This is the real result: equipment, not optimisation, sets the floor.")

    o.save()
    print(f"\nSaved -> {REPORT}")


if __name__ == "__main__":
    main()
