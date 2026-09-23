# Fleet Scheduler — API and database

One call predicts every task's duration, schedules the whole site, checks the
result independently, and stores it. Everything else reads that stored run back
in whatever shape a given screen needs.

```bash
pip install -r requirements.txt
cp .env.example .env          # fill in DATABASE_URL
psql "$DATABASE_URL" -f db/schema.sql      # idempotent, safe to re-run
uvicorn api.main:app --reload --port 8000
# http://localhost:8000/docs
```

---

## The one endpoint

```http
POST /v1/plan
```

```jsonc
{
  "source": "db",              // or "csv"; ignored for rosters supplied inline
  "label": "monday morning",
  "horizon_start": "2026-01-05T06:00:00Z",   // anchors minute 0; defaults to now
  "persist": true,
  "publish": true,             // make it the live plan and reserve its resources
  "include": ["assignments", "tasks", "machines", "workers", "bottlenecks"],
  "options": { "seconds": 20, "two_pass": true }
}
```

Rosters come from three places and they mix: anything you send inline wins,
anything you leave out is read from `source`. "Same site, but these three extra
tasks" is a one-field request, not a full payload.

What happens inside, in order:

1. **Candidates** — every legal `(task, worker, machine)` triple. Illegal pairs
   are filtered *before* prediction, never after: predicting a duration for an
   assignment that can never happen invites someone downstream to use the number.
2. **Predict** — one batched call through the persisted pipeline. ~3,300 pairings
   for the 110-task roster.
3. **Solve** — CP-SAT minimises makespan, then breaks ties on total resource time.
   A greedy schedule is computed first and fed in as a hint and a horizon.
4. **Simulate and re-solve** — fatigue and engine temperature are model *inputs*
   whose values depend on the schedule, which is a solver *output*. Pass 2
   re-prices every candidate against the state its resources will actually be in.
   Pass 1 is kept if pass 2 comes back worse. This is a heuristic, not a proven
   fixed point.
5. **Verify** — an independent checker re-derives every constraint from the
   roster: work conservation, no double-booking, skills, machine types,
   availability windows, `max_parallel`, stage precedence. It never consults the
   solver's own report, because the bug worth catching is a *mis-modelled*
   constraint, which the solver would report as satisfied either way.
6. **Persist** — one transaction across seven tables.

### Reading the summary

```jsonc
{
  "makespan_min": 2814,        // the schedule
  "lower_bound_min": 2322,     // proven: nothing can beat this on this roster
  "greedy_makespan_min": 2977,
  "improvement_vs_greedy_pct": 5.48,
  "gap_vs_analytical_bound_pct": 21.19,
  "verified": true,            // read this one first
  "violations": []
}
```

`verified: false` means do not dispatch. `POST /publish` refuses such a run
outright — a schedule that fails its own consistency check must not reach a crew.

`lower_bound_min / makespan_min` is the number worth putting on a slide: **82%
of this schedule is forced by the roster, not chosen by the solver.** The floor
comes from Oil & Gas, where every stage is single-rig work with two rigs
covering five tasks.

---

## Everything else

`{run_id}` accepts the literal string **`active`**, which resolves to whichever
run is currently `PUBLISHED` — so a dashboard can bookmark one URL instead of
chasing the newest id.

| Method | Path | What it answers |
|---|---|---|
| `GET` | `/health` | Is the model loaded, is the database reachable |
| `POST` | `/v1/plan` | The whole job |
| `POST` | `/v1/predict` | Rank operator/machine pairings for one task, no scheduling |
| `GET` | `/v1/rosters?source=csv\|db` | What's in play |
| `POST` | `/v1/rosters/sync` | Push the CSV rosters into Postgres |
| `GET` | `/v1/runs` | Recent runs, newest first |
| `GET` | `/v1/runs/{id}` | Headline numbers |
| `GET` | `/v1/runs/{id}/assignments` | Every dispatched portion — filterable by `status`, `machine_id`, `worker_id` |
| `GET` | `/v1/runs/{id}/tasks` | Per-task start, end, span, who worked it |
| `GET` | `/v1/runs/{id}/machines` | **What each machine did**, how hard, how hot |
| `GET` | `/v1/runs/{id}/workers` | What each operator did, where fatigue ended up |
| `GET` | `/v1/runs/{id}/utilization` | Machines and crew in one table |
| `GET` | `/v1/runs/{id}/bottlenecks` | Why the makespan is what it is |
| `GET` | `/v1/runs/{id}/gantt` | Calendar events keyed by machine |
| `GET` | `/v1/runs/{id}/state?kind=machine` | Fatigue / temperature curves |
| `POST` | `/v1/runs/{id}/publish` | Make it live, reserve its machines and crew |
| `PATCH` | `/v1/assignments/{id}` | Mark a portion started, finished, cancelled |
| `DELETE` | `/v1/runs/{id}` | Drop a run and everything hanging off it |

### Marking resources

`POST /v1/runs/{id}/publish` archives any previously published run, sets the run
live, and moves every machine and operator it uses to `RESERVED` — releasing any
that a re-plan dropped, so nothing stays reserved against a plan that no longer
exists. Its tasks go `PENDING → SCHEDULED`.

`PATCH /v1/assignments/{id}` with `{"status": "IN_PROGRESS"}` stamps
`actual_start_at` and moves the machine and operator to `IN_USE`. `"DONE"`
stamps `actual_end_at` and releases them. The **task** only becomes `DONE` when
every portion of it is — a parallel task with one rig still digging is not
finished, however keen the other crew is.

---

## Database

Eleven tables, five views. `db/schema.sql` is idempotent.

### Rosters — the input, long-lived

| Table | Notes |
|---|---|
| `machines` | `status`: `AVAILABLE / RESERVED / IN_USE / MAINTENANCE` |
| `workers` | Availability as minutes from the horizon start, same unit as everything else |
| `worker_skills` | A join table, not a delimited string — eligibility becomes a `JOIN` |
| `tasks` | `CHECK` forbids `SINGLE` with `max_parallel > 1` |

A roster sync refreshes descriptive fields but **never** overwrites `status`:
that column is owned by the crew marking work, not by a CSV reload.

### Runs — immutable snapshots

Everything hangs off `schedule_runs(id)` and cascades on delete. Re-planning
never edits an old run, so "what did we think last Tuesday" stays answerable.

| Table | One row per |
|---|---|
| `schedule_runs` | Run. Makespan, bound, gaps, `verified`, `violations`, options |
| `assignments` | **Portion** — one contiguous block of one task on one (worker, machine) pair |
| `run_tasks` | Task within a run: span, busy time, which resources |
| `machine_usage` | Machine within a run: busy, idle, utilisation, temperature |
| `worker_usage` | Operator within a run: busy, utilisation, fatigue |
| `run_bottlenecks` | Industry within a run: its chain bound, whether it is critical |
| `resource_state_samples` | Fatigue / temperature sample, for charting |

A partial unique index allows **at most one `PUBLISHED` run**. Without it two
live plans would claim the same machines and every utilisation figure would
double-count.

### Views

`v_run_overview`, `v_machine_workload`, `v_worker_workload`,
`v_resource_utilization`, `v_active_assignments`.

`v_machine_workload` inlines each machine's task list as JSON, so "what has this
machine done" is one row and no second query.

### Time

The solver works in **minutes from the start of the horizon** — that is what
every `*_min` column holds. `schedule_runs.horizon_start` anchors it to the
calendar and the `*_at` columns carry the resolved timestamps. Both are stored
deliberately: the minutes are the source of truth and survive a change of start
date, the timestamps are what a calendar component binds to directly.

### Row-level security

RLS is on for every table with a read-only policy for `anon` and
`authenticated`. The API connects as the owner and bypasses it. Anything hitting
PostgREST with the anon key can read the plan and cannot write it — writes go
through the API, which is where the verifier runs.

---

## Notes

- **`work_share_pct` sums to more than 100 across a task's portions.** Two
  machines rated 200 and 180 units/min do not give 380: they share haul roads
  and get in each other's way. Splitting `k` ways requires delivering
  `1 / eff(k)` of the work, `eff = {1: 1.00, 2: 0.90, 3: 0.82, 4: 0.75}`.
- **CP-SAT is nondeterministic** under a wall-clock limit with 8 threads.
  Measured spread on identical runs of the full roster is ~65 minutes, which is
  larger than most effects worth comparing. `scripts/experiments.py` reports
  medians over repeated runs for exactly this reason; a single run is not a
  measurement.
- **Durations carry the model's ~11.6 min MAE.** The schedule is near-optimal
  *for the estimates*, not a guaranteed real-world optimum.
- **The two-pass fatigue loop is a heuristic.** No fixed point is proven.
