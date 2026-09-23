# Prediction + Scheduling — Implementation Plan

Status as of 2026-09-23. Originally written before implementation. **All six phases are now built**; see section 5b for measured results. Sections 4.x are kept as the design record and marked DONE.

---

## 1. Current state

**DONE and validated:**
- `data/seed_dataset.csv` — 9,000 rows, deterministic (seed 42), hidden duration formula. Complexity is derived from a hidden work quantity; `Machine Temperature (C)` has replaced ambient `Temperature`.
- `data/prediction_dataset.csv` — 30,000 rows, SDV `GaussianCopulaSynthesizer`, one sub-model per (Industry, Task Type) pair. Validation passes: integrity, distributions, relationships.
- `data/dataset_2_tasks.csv` — 110 tasks, 11 columns. `task_id, task_type, industry, task_priority, work_quantity, work_unit, weather, shift_type, execution_mode, max_parallel, required_machine_type`.
- `data/dataset_3_workers.csv` — 30 workers, 6 columns. `worker_id, skills, skill_level, current_fatigue, available_from, available_until`.
- `data/dataset_4_machines.csv` — 56 machines across 19 types. `machine_id, machine_type, age_years, engine_temp_c`.
- `prediction_service/complexity.py` — the volume table, difficulty tables and `derive_complexity()`. Shared by generation and inference.
- Baselines trained: Linear Regression, Random Forest, XGBoost. Best = XGBoost, test **MAE 11.56 min / RMSE 16.23 / R^2 0.9656**. Inside the agreed target (MAE <= 15, R^2 < 0.99). Was 13.71 / 19.19 / 0.9589 before Phase 2 — accuracy improved because complexity became a structured signal instead of pure noise.

**Deleted deliberately:** `machine_inventory.csv`. Machines are assumed always available; the availability-window model was dropped. The roster came back as `dataset_4_machines.csv` (4.1), without availability columns.

**Everything above is now built.** `python -m scheduling.run_scheduler` runs the whole chain end to end.

---

## 2. Locked architecture

Decided across the design discussion. Do not relitigate these.

```
Task intake (industry, task type, work quantity, weather, shift)
        |
        v
Complexity engine          quantity -> Task Complexity 1..10
        |
        v
Candidate generator        filter workers by skill, machines by type
        |
        v
Feature assembler          one full 9-feature row per (task, worker, machine)
        |
        v
Saved XGBoost pipeline     batch predict
        |
        v
Candidate duration table   duration[task][worker][machine]
        |                  = time for that pair to do the WHOLE task alone
        v
Rate conversion            rate = SCALE / duration        (divisible tasks)
        |
        v
CP-SAT                     choose portions + work split + timing,
                           minimise makespan
        |
        v
Tentative schedule
        |
        v
Resource-state simulation  worker fatigue + machine engine temp
        |
        v
Re-predict affected candidates -> CP-SAT again (ONE extra pass)
        |
        v
Final schedule
```

**Why this and not the alternative.** The rejected option was "ML predicts a base duration from task features only; the scheduler applies hand-written multipliers for skill / fatigue / machine age." Rejected because the hidden generator in `scripts/generate_seed.py` already produces those effects as *interaction* terms, not flat multipliers:

```python
fatigue_interaction = 0.20 + 0.35 * complexity_norm      # fatigue effect depends on complexity
machine_effect_size = np.where(equip_flag, 0.32, 0.14)   # machine effect depends on task type
```

A hand-picked constant cannot reproduce a coefficient that varies with another feature, and we have no domain-calibrated numbers to fit one from. Dropping those three columns from training would also push MAE back above the 15-minute ceiling, since the model would lose real signal it currently uses.

**Key point:** ML does not decide the schedule. ML prices every feasible assignment; CP-SAT picks. CP-SAT never calls the model — it receives a finished number table.

---

## 3. Open decisions

### 3.1 Is `task_priority` a total order or a stage number? — RESOLVED, stages. DONE.

`task_priority` is now a workflow **stage** number, 1-6, ties allowed. Stage sizes: 25 / 30 / 25 / 20 / 5 / 5 = 110.

The previous values were alphabetical order repeated five times (Aggregate Collection=1, Backup Generator Testing=2, ... +22 per round) and encoded nothing — Site Preparation sat at 18, *after* Excavation at 7, which is backwards. Stages are now derived from real per-industry workflow:

| Industry | Sequence |
|---|---|
| Construction | Demolition -> Site Preparation -> Excavation -> Material Loading -> Foundation Work -> Road Building |
| Mining | Surface Excavation (strip overburden) -> Drilling (blast holes) -> Aggregate Collection (load blasted rock) -> Hauling Ore |
| Oil & Gas | Well Drilling -> Well Servicing (completion/workover) -> Pipeline Pumping -> Gas Compression Service |
| Marine & Rail | Rail Network Inspection -> Locomotive Maintenance + Tugboat Engine Service (parallel) -> Freight Operations |
| Data Center Power | Cooling System Inspection -> Generator Maintenance -> Backup Generator Testing -> Emergency Power Deployment |

Each industry's phase *k* maps to global stage *k*, so the five chains run concurrently. Stages 5-6 are the Construction tail only.

**Two readings are available from this one column, and the scheduler picks:**
- *Global barrier* — all of stage `s` finishes before any of stage `s+1` starts. Simplest CP-SAT constraint. Slightly artificial cross-industry (Mining's haulage waits on Oil & Gas's pumping).
- *Per-industry chain* — precedence applies only within an industry. Semantically exact, more parallelism. Requires knowing each task's industry, which is derivable from `task_type` (all 22 names are globally unique) or from the `industry` column added in 4.3.

**Resolved: per-industry chains, and the barrier was never worth building first.** Both are implemented behind `precedence_mode`, and the barrier is kept only to measure what it costs. Measured: **+42.1%** makespan, against an analytically predicted floor increase of +40.4%. The two agree, which is the `sum(max) >= max(sum)` argument confirmed with real numbers.

---

*Original analysis, kept for context:*

Priorities were 1..110, all distinct, no ties. Read as a strict total order, that means `start[T(n+1)] >= end[T(n)]` for the whole chain, so **exactly one task runs at a time in the entire system**. Consequences:

- No resource contention ever. One worker and one machine busy at a time.
- Worker availability windows never bind except at the very start.
- Machine rotation is meaningless — a machine gets ~15 days of rest between uses.
- CP-SAT's only remaining decision is "per task, pick the cheapest candidate row." That is a greedy `min()` and it is provably optimal. A constraint solver is not needed to compute it.

**Recommendation (adopted):** make `task_priority` a *stage* number with ties allowed. Precedence semantics are preserved (a lower number still strictly precedes a higher one) and the scheduling problem becomes real.

### 3.2 Weather and Shift Type still have a circularity — STILL OPEN

Both are inputs to the duration prediction, but both depend on *when* a task is scheduled — which is a CP-SAT output. Over a multi-day horizon this is the same problem as fatigue.

**Recommendation for the hackathon:** treat them as *declared at intake* ("this task is planned for day shift under clear conditions") and have CP-SAT respect that as a constraint rather than choose it. Enumerating shift as a fourth candidate dimension is the correct-but-expensive alternative; skip it.

---

## 4. Work items, in dependency order

### Phase 1 — Data layer — **DONE**

All three files were built by a single deterministic generator (seeds 401 machines / 402 workers / 403 tasks) and validated twice: once with pandas against every requirement below, once with independent shell tooling for structure, null/ragged rows and cross-file key coverage. 0 failures, 0 warnings. The generator was deleted after the run, as agreed.

#### 4.1 Machine roster — `data/dataset_4_machines.csv` — DONE

```
machine_id,machine_type,age_years,engine_temp_c
```

56 units across all 19 required types, no availability columns. Fleet size per type follows a stated rule rather than a flat 2-3:

```
units = max(2, max_parallel + 1 if max_parallel > 1 else 2) + (task types sharing the fleet - 1)
```

The `+1` headroom is what gives the solver a real choice between *parallelising one task* and *running two tasks concurrently* — with units exactly equal to `max_parallel`, one task saturates the fleet and the trade-off disappears. Shared fleets get one extra per additional task type (Excavator serves Demolition + Excavation + Surface Excavation, so 6; Wheel Loader serves two, so 5). Result: 2 units for the ten SINGLE-only types, 3-6 elsewhere.

- `age_years` — `beta(2, b) * 20` with `b` taken from the owning industry's `machine_age_b` in `generate_seed.py`, so ages sit inside Dataset 1's generated range. Mean 6.8 y, max inside Dataset 1's max (asserted).
- `engine_temp_c` — duty-class baseline (93 heavy / 87 medium / 80 light) `+ 0.55 * age + N(0, 5.5)`, clipped 70-115.
- **Degraded-cooling units are explicit, not incidental.** 12% of units take a further +8 to +16 C (fouled radiator, tired water pump, deferred service). A first attempt left the tail to the noise term and produced *zero* units above 105 C, so the thermal-derating band 4.5 exists to punish was never populated and machine rotation had nothing to rotate away from. Now 7 of 56 units sit above 105 C, spread across 5 machine types, and every type still retains a cooler alternative. This is structural, so it holds for any seed rather than depending on a lucky draw.
- `corr(age_years, engine_temp_c) = 0.45` — related but not collinear, as 4.5 requires. One unit is 3.2 y and 114.6 C, which is what breaks the age-implies-temperature shortcut.

> For non-engine equipment (Inspection Kit, Generator Test Unit, Rail Inspection Vehicle) read this column as *thermal load state* rather than literal coolant temperature. They are kept inside 70-115 anyway: a realistic ambient-ish value like 30 C would fall outside Dataset 1's range and XGBoost would silently clamp it.

#### 4.2 Worker roster — `data/dataset_3_workers.csv` — DONE

- `skill_level` — `beta(5,2) * 9 + 1`, matching Dataset 1's Operator Skill. Roster mean 7.6 vs Dataset 1's 7.4.
- `current_fatigue` — `beta(2,3.5) * 100`, right-skewed. Roster mean 35.8 vs Dataset 1's 36.1.

**Also fixed here: a worker-supply gap the plan had only written down for machines.** 4.3 notes that `max_parallel` is unreachable without enough machine units; the same is true of workers, and three PARALLEL task types failed it — Aggregate Collection, Material Loading and Site Preparation each had 2 eligible workers against `max_parallel = 3`. Rather than invent headcount, three existing operators were cross-trained within their own industry and equipment family:

| Worker | Added skill | Rationale |
|---|---|---|
| W006 | Aggregate Collection | Mining loader/haulage operator already runs Drilling + Hauling Ore |
| W010 | Material Loading | Already runs Site Preparation + Demolition; wheel-loader adjacent |
| W012 | Site Preparation | Already runs Excavation; same earthmoving cluster |

All 22 task types now reach their `max_parallel` on both the worker and the machine side — verified in the validation pass.

#### 4.3 Task list — `data/dataset_2_tasks.csv` — DONE

Fields for the task's ML representation:
- `industry` — derived from `task_type` (all 22 names are globally unique), so it cannot disagree with it
- `work_quantity` — the real physical number, sampled lognormally around the task type's `typical`
- `work_unit` — **added beyond the original plan.** The plan said units were "implied by task type", but this file stands in for a contract intake sheet, and a bare `422.0` that could be m³ or tonnes is exactly the kind of ambiguity that gets entered wrong later. It is derived from the same volume table, so it cannot drift from `work_quantity`.
- `weather`, `shift_type` — sampled from the owning industry's `weather_probs` and `night_prob` in `generate_seed.py`, so intake conditions match Dataset 1's distributions rather than being uniform

Execution-model fields (see 4.8):
- `execution_mode` — `SINGLE` | `PARALLEL` (`TEAM` is defined but deferred)
- `max_parallel` — integer cap on concurrent resource pairs; `1` for every `SINGLE` task

No temperature column (now a machine attribute), no predicted duration, no worker, no machine. **No complexity column either** — complexity is derived at runtime from `work_quantity` via `derive_complexity(..., jitter=False)`. Storing it would let it drift out of step with the quantity it is supposed to describe.

Countable units (`service pts`, `units`) are rounded to whole numbers; "8.58 service points" is not something anyone contracts for.

`execution_mode` and `max_parallel` per task type — assigned from whether the work is physically divisible across machines operating on different portions of the same job:

| Task type | Mode | max_parallel | Reasoning |
|---|---|---|---|
| Hauling Ore | PARALLEL | 4 | Truck fleet; the canonical divisible haulage cycle |
| Excavation | PARALLEL | 3 | Multiple excavators on different sections of the dig |
| Surface Excavation | PARALLEL | 3 | Overburden stripping is bulk earthmoving |
| Material Loading | PARALLEL | 3 | Multiple loaders, independent stockpiles |
| Aggregate Collection | PARALLEL | 3 | Loading blasted rock from separate faces |
| Drilling | PARALLEL | 3 | Several rigs working one blast pattern |
| Site Preparation | PARALLEL | 3 | Clearing and grading divide cleanly by area |
| Demolition | PARALLEL | 2 | Separate structures, but access is constrained |
| Road Building | PARALLEL | 2 | Segments can progress independently |
| Foundation Work | PARALLEL | 2 | Separate footings; conservative, pours are continuity-sensitive |
| Freight Operations | PARALLEL | 2 | Independent consists/loads |
| Rail Network Inspection | PARALLEL | 2 | Network splits into sections |
| Well Drilling | SINGLE | 1 | One bore, one rig. Adding rigs does not halve it |
| Well Servicing | SINGLE | 1 | One wellhead |
| Pipeline Pumping | SINGLE | 1 | Pumps in series do not divide the duty like parallel diggers |
| Gas Compression Service | SINGLE | 1 | One compressor unit |
| Generator Maintenance | SINGLE | 1 | One genset |
| Backup Generator Testing | SINGLE | 1 | One load-bank test |
| Cooling System Inspection | SINGLE | 1 | One system |
| Emergency Power Deployment | SINGLE | 1 | Coordinated cutover; arguably TEAM, keep at 1 for now |
| Locomotive Maintenance | SINGLE | 1 | One locomotive |
| Tugboat Engine Service | SINGLE | 1 | One engine |

`max_parallel` is an upper bound only. Actual parallelism is also capped by how many eligible machines of the required type exist, which is why 4.1 insists on 2-3 units per type — with one unit per type the PARALLEL mode is unreachable and the whole mechanism is dead code.

### Phase 2 — Regenerate Dataset 1 — **DONE**

Both changes touched `scripts/generate_seed.py`, so they shipped as one regeneration. Final result, all four stages re-run:

| | before | after |
|---|---|---|
| XGBoost test MAE | 13.71 | **11.56** |
| RMSE | 19.19 | **16.23** |
| R^2 | 0.9589 | **0.9656** |

**No retune was needed** — and deliberately none was applied. 4.6 predicted R^2 would rise and the noise knobs would need loosening; R^2 rose only 0.9589 -> 0.9656, still far under the 0.99 ceiling, while MAE *improved* past the <= 15 target. `TASK_STD_SCALE = 0.08` and `NOISE_SIGMA = 0.008` stay untouched. Deliberately degrading a model that already meets its target to hit a specific MAE number would be backwards.

The accuracy gain is the expected consequence of the change: complexity used to be `normal(5.5, 2.2)` noise, which the model could not predict from. It is now a deterministic function of quantity, task type and industry — real signal, so the same features explain more of the variance.

Complexity distribution after synthesis: min 1, max 10, mean 5.71, sd 1.55, and **the per-task-type structure survived the copula** — Well Drilling 6.85 / Well Servicing 6.59 at the top, Material Loading 4.52 / Cooling System Inspection 4.87 at the bottom. That ordering is semantically right and is the thing that would have been destroyed by a single joint synthesiser.

Serving ranges all sit strictly inside training ranges, so nothing clamps:

| | roster | training |
|---|---|---|
| machine age | 1.47-13.79 | 0.04-19.00 |
| engine temp | 79.4-115.0 | 70.0-115.0 |
| skill level | 4-10 | 2-10 |
| fatigue | 2.5-73.3 | 0.9-93.6 |

#### 4.4 Complexity derived from work quantity

Replace line ~145 of `generate_seed.py`. Today complexity is `np.clip(np.round(rng.normal(5.5, 2.2, size=n)), 1, 10)` — pure noise, identical for every industry and every task type. A Well Drilling job and a Cooling System Inspection draw from the same bell curve.

**The engine itself is already built** — `prediction_service/complexity.py`, written during Phase 1 because 4.3's `work_quantity` could not be sampled without it. It holds `VOLUME` (22 task types x `unit`/`low`/`typical`/`high`), `TASK_DIFFICULTY`, `INDUSTRY_DIFFICULTY`, `size_score()`, `derive_complexity()`, `sample_quantity()` and `check_volume_table()`. What remains for Phase 2 is wiring it into `generate_seed.py` and tuning the weights.

Units are genuinely per task type: m3 for excavation/foundation/pumping, m2 for site prep, km for roads and track, metres drilled or metres of tubing for wells, tonnes for haulage and freight, kW for load-bank testing and power deployment, service points or unit counts for maintenance and inspection. A raw quantity is meaningless across task types and only becomes comparable after `size_score` normalises it against its own range.

**The `typical` = geometric mean invariant.** Every VOLUME row places `typical` at (approximately) `sqrt(low * high)`. Since `size_score` is a log-scale position, that puts a typical-sized job at `size_score ≈ 0.5` — mid-complexity *for its own task type*. `check_volume_table()` asserts it within a 0.12 tolerance, so a later hand-edit cannot quietly skew one task type's whole complexity range.

`sample_quantity()` draws lognormally around `typical` with `sigma = log(high/low) / 4`, i.e. ±2σ spans the contracted range, giving `size_score ≈ Normal(0.5, 0.25)` before clipping.

> **Measured baseline for the Phase 2 tuning, taken over the 110 real tasks:**
> derived complexity **min 3, max 10, mean 5.82, sd 1.50** — against Dataset 1's current **min 1, max 10, mean 5.49, sd 2.13**.
>
> The mean lands almost on target; the **spread is the gap**. It is structural, not sampling noise: size contributes at most `0.60 * 9 * 0.25 ≈ 1.35` of sd, and the task/industry terms are near-constant within a task type. To widen it, raise `W_SIZE`, or widen `sample_quantity`'s sigma toward `log(high/low)/3` and accept more clipping at the ends. Do this jointly with the `TASK_STD_SCALE` / `NOISE_SIGMA` retune in 4.6 rather than separately — they all move MAE. Whether sd must reach 2.13 at all is itself a question: 2.13 came from a pure-noise complexity, and a *structured* complexity has no obligation to reproduce the spread of a meaningless one.

> **BUG TO AVOID — `jitter` must be False at inference time.** The residual noise term belongs to *data generation* only. If it runs at serve time the same contract input returns a different complexity, and therefore a different predicted duration, on every run. Demo it twice, get 180 min then 195 min for identical input, and it looks broken. Generation calls with `jitter=True`; the prediction service calls with `jitter=False`.

Seed generation samples `work_quantity` from a right-skewed distribution anchored on `qty_typical` (reuse the existing `sample_gamma_from_mean_std` helper), then derives complexity from it. `work_quantity` stays an internal generator variable — it is **not** written to Dataset 1. The final schema keeps its ten columns.

#### 4.5 Replace ambient temperature with machine temperature

Rename the column `Temperature` -> `Machine Temperature (C)` and change its meaning from site air temperature to the machine's engine/coolant operating temperature.

Why this is an improvement, not just a swap: ambient temperature had the same "depends on when it's scheduled" circularity as weather. Engine temperature is a *machine* attribute, so it lands cleanly in the machine dimension of the candidate table and is known at candidate-generation time.

- Range: roughly 70-115 C. Normal diesel operating band is ~80-105; above that is thermal derating.
- **The generated range must cover what the roster actually contains**, or XGBoost clamps at serve time. `dataset_4_machines.csv` spans 79.4-115.0 C, mean 95.1, with 12% of units above 105. Generate at least that span, and make sure the derating band is populated in training too — a model that never saw a 110 C machine cannot price one.
- Sample it per row with a mild positive correlation to machine age and to equipment-intensive task types (older, harder-working machines run hotter). Keep the correlation mild — it should not become collinear with Machine Age.
- Rewrite `temp_mult`. Current code anchors a comfort point at `temp_min + 0.2 * range` and applies `1 + 0.0020 * dev ** 1.4`. The new version should be flat through the normal band and then rise: hotter engine -> thermal throttling, forced cooldown pauses -> longer duration.

> **CRITICAL — keep the effect monotonic.** This was learned the hard way. The original ambient-temperature effect was a symmetric U-shape (both heat and cold slowed work). It survived in the seed data but was almost completely destroyed by SDV synthesis, because `GaussianCopulaSynthesizer` can only preserve monotonic / rank dependence. It had to be redesigned as monotonic heat-stress-only. Engine temperature is naturally monotonic (a working machine is never too cold), so this is a better fit than ambient ever was — but do not reintroduce a two-sided penalty.

#### 4.6 Re-run the pipeline and re-tune

```
python scripts/generate_seed.py
python scripts/generate_sdv_dataset.py
python scripts/validate_dataset.py
python scripts/train_baselines.py
```

- Update the relationship checks in `validate_dataset.py` for the new temperature semantics (correlation direction is still "hotter -> longer", so the existing directional test should hold once the column is renamed).
- Re-tune `TASK_STD_SCALE` (currently 0.08) and `NOISE_SIGMA` (currently 0.008) to land back at **MAE <= 15 min with R^2 comfortably under 0.99**. Complexity is about to become a much stronger, more structured signal, so R^2 will likely rise and the knobs will need loosening, not tightening.
- Confirm the row count is still exactly 30,000.

### Phase 3 — Persist the model — **DONE**

#### 4.7 Save the fitted pipeline

`scripts/train_baselines.py` currently trains, writes a text report, and lets the fitted model go out of scope. Nothing is saved, so there is no object any runtime code could call `.predict()` on.

Wrap the preprocessing and the estimator in a single `sklearn.pipeline.Pipeline` and save that one object:

```
models/duration_model.joblib     # ColumnTransformer + XGBoost together
models/feature_schema.json       # column order, dtypes, valid ranges, category levels
```

Saving them as one Pipeline (rather than two files) is what prevents train/serve encoding drift. The schema file lets the candidate builder assert its rows match what the model was fit on, instead of discovering a mismatch through silently wrong predictions.

### Phase 4 — Prediction service — **DONE**

New package `prediction_service/`:

- `complexity.py` — **DONE** (built in Phase 1, see 4.4). The volume table, `TASK_DIFFICULTY`, `INDUSTRY_DIFFICULTY`, `derive_complexity()`. **Still to do: import it from `generate_seed.py`** so generation and inference share one definition — that shared definition is the whole point of the design, and it is not yet wired up.
- `candidates.py` — `eligible_workers(task, workers)`, `eligible_machines(task, machines)`, `generate_candidates(tasks, workers, machines)`. Filter *before* prediction, never after: a worker who cannot operate the machine should never reach the model.
- `features.py` — `build_candidate_frame(candidates)` returning a DataFrame whose columns exactly match `feature_schema.json`.
- `predict.py` — load the pipeline once, predict the **entire candidate frame in a single batched call**. Do not loop row by row; that is orders of magnitude slower for no benefit.

Expected table size: 110 tasks x 2-5 eligible workers x 2-3 eligible machines is roughly 500-1,500 rows. One batch predict, milliseconds.

### Phase 5 — CP-SAT scheduler — **DONE**

New package `scheduling/`.

#### 4.8 Model formulation (`scheduling/cp_sat_model.py`)

A flexible job-shop with **divisible tasks**. A task is not "one worker + one machine" — it is one or more concurrent `(worker, machine)` *portions*, capped by `max_parallel`. `SINGLE` is not a separate code path: it is simply `max_parallel = 1`, which collapses the model back to one-pair-per-task. One formulation covers both modes.

##### 4.8.1 From durations to rates

The ML model predicts, for each candidate, **how long that one pair would take to do the entire task alone**. That is exactly what it was trained on, so no retraining is needed. For a divisible task we reinterpret that as a production rate.

Normalise every task to `SCALE` abstract work units (use `SCALE = 100_000`); the real physical quantity never enters the solver, which sidesteps all unit handling:

```python
SCALE = 100_000
rate[t][w][m] = ceil(SCALE / duration[t][w][m])   # work units per minute, integer
```

A pair working `b` minutes completes `rate * b` work units. The task is done when the units sum to `SCALE`.

> **Rounding note.** `ceil` makes each rate at most one unit-per-minute optimistic, i.e. the solver believes the work finishes up to ~0.1% sooner than the ML model said (at `SCALE = 100_000` and durations of 60-500 min). That direction is deliberate — `floor` would make a single full-duration portion fail to complete its own task by a rounding sliver, which is far worse than a 0.1% optimism. Do not shrink `SCALE` below ~10,000 or this stops being negligible.

##### 4.8.2 Variables

Per task `t`:

```python
start[t] = model.NewIntVar(0, HORIZON, f"start_{t}")
end[t]   = model.NewIntVar(0, HORIZON, f"end_{t}")
model.Add(start[t] <= end[t])
```

Per feasible candidate `(t, w, m)` — worker holds the skill, machine is the required type:

```python
x[t,w,m]      = model.NewBoolVar(...)                      # this portion is used
busy[t,w,m]   = model.NewIntVar(0, HORIZON, ...)           # minutes this pair works on t
pstart[t,w,m] = model.NewIntVar(0, HORIZON, ...)
pend[t,w,m]   = model.NewIntVar(0, HORIZON, ...)
opt[t,w,m]    = model.NewOptionalIntervalVar(
                    pstart[t,w,m], busy[t,w,m], pend[t,w,m], x[t,w,m], ...)
```

##### 4.8.3 Constraints

**1. The task gets completed.** The one constraint that makes divisibility work — linear, integer coefficients, precomputed rates:

```python
model.Add(sum(rate[t][w][m] * busy[t,w,m] for w, m in cand[t]) >= SCALE)
```

**2. A portion is used iff it consumes time.**

```python
model.Add(busy[t,w,m] >= 1).OnlyEnforceIf(x[t,w,m])
model.Add(busy[t,w,m] == 0).OnlyEnforceIf(x[t,w,m].Not())
```

Constraint 1 then guarantees at least one portion is used, so no explicit "at least one" is needed.

**3. Parallelism cap.**

```python
model.Add(sum(x[t,w,m] for w, m in cand[t]) <= max_parallel[t])
```

With `max_parallel = 1` this is `AddAtMostOne`, and combined with constraint 1 it becomes exactly one — the original SINGLE behaviour, for free.

**4. Portions sit inside the task's span.**

```python
model.Add(pstart[t,w,m] >= start[t]).OnlyEnforceIf(x[t,w,m])
model.Add(pend[t,w,m]   <= end[t]).OnlyEnforceIf(x[t,w,m])
```

Portions may be *staggered*, not just simultaneous — one excavator can start at 08:00 and a second join at 10:00. The task ends when the last portion ends. Minimising makespan keeps `end[t]` tight.

**5. No worker double-booked** — across every task and machine:

```python
for w in workers:
    model.AddNoOverlap([opt[t,w,m] for all t, m])
```

**6. No machine double-booked:**

```python
for m in machines:
    model.AddNoOverlap([opt[t,w,m] for all t, w])
```

**7. Symmetry breaking.** A worker (or machine) must not take two portions of the *same* task — no-overlap would only serialise them, which is just a slower way to express one portion, and it bloats the search space:

```python
for t, w: model.AddAtMostOne(x[t,w,m] for m in machines_for(t))
for t, m: model.AddAtMostOne(x[t,w,m] for w in workers_for(t))
```

**8. Stage precedence** (decision 3.1, stages 1-6):

```python
stage_end[s] = model.NewIntVar(0, HORIZON, f"stage_end_{s}")
for t in tasks_in_stage(s):
    model.Add(end[t] <= stage_end[s])
    if s > 1:
        model.Add(start[t] >= stage_end[s-1])
```

For the per-industry reading instead, build one `stage_end` chain per industry and apply it only to that industry's tasks.

**9. Worker availability** — enforced only where the portion is actually used:

```python
model.Add(pstart[t,w,m] >= avail_from[w]).OnlyEnforceIf(x[t,w,m])
model.Add(pend[t,w,m]   <= avail_until[w]).OnlyEnforceIf(x[t,w,m])
```

**10. Machines** — no availability constraint (locked decision). If battery/runtime returns later, use `model.AddReservoirConstraint`: a level that falls while running and rises while charging, bounded between 0 and capacity. Machine rotation then falls out of the solver rather than being hand-coded.

##### 4.8.4 Objective

```python
makespan = model.NewIntVar(0, HORIZON, "makespan")
model.AddMaxEquality(makespan, [end[t] for t in tasks])
model.Minimize(makespan)
```

Always set `solver.parameters.max_time_in_seconds` — a divisible-task model has a far larger search space than the one-pair-per-task version, and a demo must not hang. Also set `solver.parameters.num_search_workers = 8`.

##### 4.8.5 Assumptions and honest limits

- **Linear divisibility.** Half the work is assumed to take half the time. Real jobs have setup, mobilisation and teardown that do not halve. To model it, give each used portion a fixed overhead: `busy >= SETUP` when `x` is true, and subtract `SETUP` from its productive time. Not in v1.
- **No parallel efficiency loss.** Two machines at 200 and 180 units/min are assumed to give 380, ignoring congestion, shared haul roads and loading bottlenecks. Real effective rates are lower. Adding a factor that depends on the *number* of concurrent portions makes the constraint non-linear, but since `max_parallel <= 4` it can be done by reifying "exactly k portions used" and selecting a different rate constant per k. Deliberately deferred — document the assumption rather than hiding it.
- **`TEAM` mode is defined but not implemented.** TEAM means several resources are required *simultaneously for the same indivisible operation* (crane + operator + spotter), which is structurally different from splitting work: one shared interval, one `AddExactlyOne` per required role, and every chosen resource gets an optional interval identical to the task's. None of the current 22 task types clearly need it. Keep the enum value, leave the branch unimplemented.
- **Rates come from a model that never saw partial work.** Dataset 1 contains complete tasks only, so a rate is an extrapolation from a whole-task duration. Reasonable for bulk earthmoving and haulage; it is the reason the SINGLE list above stays conservative.

##### 4.8.6 Solution quality — how good will the schedule actually be?

The question "will it always be top 2 or 3?" has a better answer available than a rank, and the answer splits cleanly in two.

**The solver is not the weak link.** CP-SAT does not return a guess it hopes is good — it returns a solution *and a bound on how far from optimal that solution could possibly be*. Call `solver.ObjectiveValue()` and `solver.BestObjectiveBound()` and the gap is a proven fact: "this schedule is within 2.4% of the best schedule that exists." That is strictly stronger than "top 3", because "top 3" is unverifiable (nobody enumerates all schedules) while the gap is a certificate. If it solves to completion the gap is 0% and the schedule *is* optimal. **Report the gap on every solve** — it is two lines of code and it converts a vague quality claim into a number.

**The weak link is upstream.** The durations CP-SAT optimises against carry MAE 11.56 min on a mean of ~188, so roughly 6%. A schedule that is provably optimal for slightly-wrong durations is only near-optimal for true durations. Two things soften that, and both are worth stating rather than glossing:
- Errors are largely independent across candidates, so they partly cancel over a 110-task schedule rather than compounding.
- The decisions with the most regret are the ones the model is most confident about. Choosing between two candidates predicted 40 minutes apart is a decision worth getting right and the model is unlikely to be 40 minutes wrong; choosing between two predicted 5 minutes apart is nearly free to get wrong. Low-confidence decisions are low-stakes decisions.

So: near-optimal for the durations given, with a measured gap, and the durations are ~6% off. That is an honest and defensible claim, and it is a better position than most hackathon schedulers are in.

**Five changes that raise real quality. In priority order.**

**1. Use per-industry precedence chains, not the global barrier.** This is the single biggest makespan lever in the entire system — larger than anything the solver does. Under the global barrier the makespan is `sum over stages of (slowest industry's work in that stage)`; under per-industry chains it is `max over industries of (that industry's total chain)`. Since `Σ max >= max Σ` always, the barrier is *never* better and is usually much worse. It also makes Mining's haulage wait on Oil & Gas's pumping, which is nonsense. Build the barrier first only because it is three lines and proves the pipeline runs; switch immediately after, and report both makespans — "the naive global barrier costs X%" is a genuine result.

**2. Add a secondary objective.** Pure makespan minimisation leaves an enormous tie class: only the critical path affects the objective, so every off-critical-path assignment is arbitrary and CP-SAT will return whichever it found first. In practice that means it may hand a task to a 115 °C machine while an 85 °C one sits idle, because makespan did not care. Fix lexicographically — minimise makespan, then minimise a weighted sum of total busy-time and hot-machine/high-fatigue usage:

```python
model.Minimize(BIG * makespan + sum(busy[t, w, m] for t, w, m in cand))
```

with `BIG` larger than the maximum possible total busy-time so the primary objective can never be traded away. Cheap, and it is the difference between a schedule that is optimal and a schedule that also *looks* sensible when someone reads it.

**3. Greedy baseline, used twice.** Write a simple greedy (per stage, assign each task its fastest available candidate). Use it (a) as the comparison number for the demo — "CP-SAT beat greedy by X%" is the headline, and a solver with no baseline to beat is an unfalsifiable claim; and (b) as a solution hint via `model.AddHint(...)`, so CP-SAT starts from a decent incumbent and can never time out into something worse than greedy.

**4. Keep the model small enough to actually close the gap.** A 43,200-minute horizon over ~1,270 optional intervals gives enormous variable domains, and a large gap at the time limit is a quality problem even though it looks like a performance one. Two fixes: derive `HORIZON` from the greedy solution's makespan rather than from the 30-day worker window, and discretise time into 5-minute buckets (durations run 60-500 min, so the precision loss is ~2% and the domain shrinks 5x). Do this before concluding the model is too slow.

**5. Optionally, return the top 3 explicitly.** If the literal ask is three options to choose between, add `makespan <= best * 1.05` and collect several distinct solutions, or re-solve with different secondary weights. That yields three genuinely near-optimal schedules with different trade-offs — fastest, coolest-running, least-fatiguing — which is a better product than one number, and directly answers "top 2 or 3" in the user's own terms.

Items 1-3 are the ones that change the output quality materially. Item 4 is insurance. Item 5 is presentation.

##### 4.8.7 Reconciled build order (reviewed 2026-09-23)

A review of 4.8.6 came back proposing a six-phase build order. It agrees with the architecture and is adopted, with four corrections recorded here so they are not lost.

**Adopted improvement — name the alternatives by their trade-off.** 4.8.6 item 5 said "collect several distinct solutions". Sharper version: fix `makespan <= best * 1.05` and re-solve with a *different secondary objective* each time, then label the results by what they optimise — **Fastest / Balanced / Low-fatigue** — rather than "Schedule #1, #2, #3". The user then understands *why* the options differ instead of picking blind. Costs one extra solve beyond the three (the first solve establishes `best`).

**Correction 1 — machine availability is not a constraint.** The proposed phase 1 listed "worker availability, machine availability" together. Machine availability was removed by explicit decision; `machine_inventory.csv` was deleted and constraint 10 in 4.8.3 records the removal. Machines are always available. Do not reintroduce a machine time window.

**Correction 2 — minimising total busy time does not balance load; it does the opposite, and that is what we want.** The review motivated the secondary objective with an example preferring `W1 600 / W2 500 / W3 400` (total 1,500) over `W1 900 / W2 100 / W3 0` (total 1,000) — but `BIG * makespan + sum(busy)` picks the 1,000 one. The example argues for load balancing while the formula minimises resource usage. They are opposite objectives and only one can be primary.

Take **total busy time**, deliberately. Because the completion constraint is `sum(rate * busy) >= SCALE`, a faster pair needs less busy time for the same work, so minimising `sum(busy)`:
- prefers the skilled operator and the newer, cooler machine on its own, with no hand-written penalty terms;
- makes parallel splitting *cost* something, so a task only splits when the split actually buys makespan — which is exactly the trade-off we want the solver making, not a thing to be nudged.

An idle worker is not a problem to be fixed; the work being done sooner with fewer resource-hours is the goal. If fairness across workers is ever wanted it is `minimise max worker load`, it conflicts with the above, and it must be chosen instead of, not alongside.

**Correction 3 — time bucketing must convert the rates, not just the time axis.** Switching to 5-minute buckets rescales `start`, `end` and `busy`. `rate` is currently *work units per minute*; left unchanged while `busy` is counted in buckets, the completion constraint is wrong by 5x and every task is declared finished after a fifth of the work. Recompute in bucket units:

```python
BUCKET = 5
dur_buckets  = ceil(duration_min / BUCKET)          # round the duration UP (pessimistic)
rate[t][w][m] = ceil(SCALE / dur_buckets)           # round the rate UP (see 4.8.1)
```

The two roundings pull in opposite directions, which is intentional and keeps the error small and one-sided per 4.8.1. Verify with the work-conservation check in 4.11 *after* bucketing, not before.

**Correction 4 — the review's phase list drops two things we already have.** It does not mention the resource-state simulation and two-pass re-prediction (4.9, 4.10) or the independent schedule checker (4.11). Those stay. The checker in particular is what catches a broken divisibility model, and it is worth more than any of the tuning items.

**Minor:** the global barrier is not worth a build phase of its own. Per-industry chains are a handful of lines more, so implement the chains and keep the barrier behind a `precedence_mode = "global" | "per_industry"` flag — it then exists purely to generate the comparison number, rather than being built wrong first and fixed later.

**Also worth knowing when building the greedy baseline:** it must honour the same stage precedence, `max_parallel`, no-overlap and worker-availability rules, otherwise the comparison number is meaningless and the `AddHint()` it feeds CP-SAT is near-useless. A hint does not have to be complete, but an infeasible one buys nothing.

Resulting order inside Phase 5: per-industry chains + makespan -> greedy baseline + hint + derived horizon -> optimality-gap reporting -> secondary objective -> bucketing only if the gap is still large -> named alternatives last.

#### 4.9 Resource-state simulation (`scheduling/resource_state.py`)

Worker fatigue and machine engine temperature are now structurally the same thing: a per-resource state that accumulates with use, recovers with idle time, and feeds back into the duration model. One function handles both.

```python
def simulate(schedule, workers, machines):
    """Walk the schedule chronologically; return updated fatigue per worker
    and engine temp per machine at the moment each task starts."""
```

- Fatigue: rises with minutes worked, scaled by task complexity; decays during idle gaps and resets across an overnight break.
- Engine temp: rises with continuous run time, decays toward ambient while idle.

#### 4.10 Two-pass orchestration (`scheduling/run_scheduler.py`)

```
Pass 1  use each worker's current_fatigue and each machine's engine_temp_c as given
        -> predict candidate durations
        -> solve
        -> tentative schedule

Simulate resource state over the tentative schedule

Pass 2  re-predict only candidates whose fatigue or engine temp moved materially
        (> 5 points / > 5 C)
        -> solve again
        -> final schedule

Stop. One reoptimisation pass only.
```

Report both passes' makespan. The refinement is worth showing, and it is honest about what it is.

> Be accurate about this in any write-up: the two-pass result is a **heuristic**, not a proven optimum. Each pass is solved to optimality for the durations it was given, but the durations themselves depend on the schedule, so the fixed point is not guaranteed. Do not call the output "the optimal schedule."

### Phase 6 — Verification — **DONE**

#### 4.11 Independent schedule checker

Re-read the emitted schedule and assert:
- every task has at least one portion, and no more than its `max_parallel`;
- **work conservation** — for each task, `sum(rate[t][w][m] * busy[t][w][m]) >= SCALE`. This is the check that actually catches a broken divisibility model, and it is the one most worth writing first;
- a `SINGLE` task has exactly one portion;
- no worker and no machine overlaps itself in time, across all portions of all tasks;
- no worker and no machine appears twice within the same task;
- every assigned worker holds the required skill, every machine is the required type;
- stage precedence holds — every portion of a stage-`s` task starts at or after every stage-`s-1` task ended;
- every portion runs inside its worker's availability window;
- each portion's `pend == pstart + busy`, and the task's `end` is the max of its portions' `pend`.

Do not trust the solver's own report for this — check the artifact.

---

## 5. Gotchas worth carrying forward

- **Copula synthesis only preserves monotonic relationships.** Any new feature effect in `generate_seed.py` must be monotonic or it will not survive `generate_sdv_dataset.py`. Cost a full redesign cycle once already.
- **Per-(Industry, Task Type) sub-models are load-bearing.** An earlier version fitted one synthesiser per Industry with Task Type as an in-model column; task baselines regressed to the mean badly (Material Loading went 80 -> 169 min). Do not consolidate the sub-models.
- **XGBoost does not extrapolate.** Roster values for skill, machine age and engine temp must sit inside Dataset 1's generated ranges or predictions clamp silently.
- **Dataset 3's `skills` column has a leading space after each `;`.** Parse with `[s.strip() for s in skills.split(";")]` — an exact-match lookup without `.strip()` fails silently.
- **Complexity will now correlate with Task Type** (the task-difficulty term is near-constant per task type). That is expected and is not leakage — Task Type is legitimately known before the task runs. It does mean complexity's *marginal* importance beyond Task Type comes mostly from the size term; keep that in mind when reading the feature-importance report.
- **Scripts resolve paths as `Path(__file__).resolve().parent.parent`.** Everything must stay inside `Prediction/`. Moving `scripts/` without moving `data/` broke this once already.
- **A parallelism cap is only as high as its scarcest resource.** `max_parallel` needs enough eligible *workers* as well as enough machine units. The plan originally stated this for machines only, and three task types silently failed it on the worker side. Any change to skills, headcount or `max_parallel` should be re-checked against both.
- **Leaving a feature's interesting range to a random tail does not populate it.** The engine-temperature derating band came out empty at 56 draws, because a ~7% tail over 36 heavy units rolls zero often enough. If a band has to exist for a feature to do any work, generate it structurally.
- **Dataset 2 carries no complexity column by design.** It is derived from `work_quantity` at runtime. Anyone adding it as a stored column reintroduces exactly the drift the shared `complexity.py` exists to prevent.

---

## 5b. Implementation results (built 2026-09-23)

Run it with:

```
python -m scheduling.run_scheduler --seconds 45 --compare-barrier
```

Outputs `reports/schedule_report.txt` and `reports/schedule.csv`.

### Numbers

| | value |
|---|---|
| Persisted model | XGBoost pipeline, test **MAE 11.50 / R^2 0.9659** |
| Candidate table | **1,270** rows (110 tasks x eligible workers x eligible machines), one batch predict, ~1.2 s |
| Duration spread within a task | median **34.5%** between fastest and slowest candidate |
| Analytical lower bound | **2,322 min**, bottleneck **Oil & Gas** |
| Greedy baseline | 2,864 min |
| CP-SAT pass 1 | median **2,844 min**, 0.3-0.9% better than greedy, gap ~23% |
| CP-SAT pass 2 (final) | ~2,830 min, gap ~**19.3%** |
| Global barrier | **+42.1%** makespan vs per-industry chains |
| Independent verifier | **CLEAN** on greedy, pass 1 and pass 2 |

### What the numbers actually say

**The makespan is set by the roster, not by the solver.** The analytical bound of 2,322 min comes almost entirely from Oil & Gas, where every stage is a SINGLE task type with **2 machines and 5 tasks** — Well Drilling alone forces ~922 min of pure serialisation. No amount of solving beats that; it is a fleet-sizing decision. Adding a third Drilling Rig and Well Service Rig is the single highest-value change available, and it is a data change, not a code change.

**That also explains the small CP-SAT-vs-greedy margin.** 3% looks unimpressive until you notice the critical path is all SINGLE tasks on scarce machines, where there is nothing to optimise — no parallelism is legal and the candidate choice barely moves the total. The solver's value shows up in the 42% it saves over the naive barrier, not against greedy.

**Parallelism is barely used, and that is correct.** Only ~7 of 110 tasks split. Splitting costs resource-hours and cannot help a critical path made of indivisible work, so the solver declines it. A scheduler that split everything would be optimising the wrong thing.

**The optimality gap is real but conservative.** 19.3% is measured against the analytical bound, because CP-SAT's own relaxation is far weaker (628 min — effectively vacuous). Doubling the time budget moved the makespan by 1 minute, so the residual gap is bound looseness rather than a poor schedule.

### Correction: CP-SAT's margin over greedy was overstated

An earlier version of this section quoted **3.0% better than greedy** from a
single run. That number does not survive scrutiny, for two reasons:

1. **CP-SAT with 8 threads under a wall-clock limit is nondeterministic.**
   Four identical runs gave 2,779 / 2,844 / 2,836 / 2,779 min -- a 65-minute
   spread, i.e. 0.7% to 3.0% "improvement" from the solver's own randomness.
   3.0% was the luckiest of four. Longer solves do not fix it (60s x4 gave
   2,777-2,834).
2. It was measured **before** parallel efficiency and task continuity were
   added, so it was partly buying time with parallelism that would not exist.

Corrected figure, median of 3 runs with both realism constraints on:
**0.3% (range 0.3-0.9%)** at the current roster. Every CP-SAT number in this
document is now a median with its range, produced by `scripts/experiments.py`.
Greedy is deterministic and needs no repeats.

This does not change the architecture's standing -- see the bottleneck sweep,
where the margin reaches 5.3% once equipment stops being the binding
constraint. It changes what may honestly be claimed at the current roster.

### Robustness to prediction error

The scheduler consumes *comparisons*, not absolute durations. Absolute error
moves the makespan estimate; only **rank** error changes decisions. Measured by
injecting realistic error (sd 14.4 min, matching MAE 11.5) and re-solving:

| seed | makespan | assignments unchanged |
|---|---|---|
| 1 | -4.4% | 25% |
| 2 | -1.4% | 27% |
| 3 | +0.8% | 32% |

~70% of assignments change while the makespan barely moves. **60% of candidate
pairs sit within one error-sd of each other** -- the model cannot rank them, but
they are interchangeable, so swapping them costs nothing. Uncertain decisions
are low-stakes decisions; the high-stakes ones are far enough apart to call.

Two consequences:
- Quote the makespan as **~2,780 min +/- 4%**. The precision is not there, and
  stating the tolerance is stronger than implying precision that is not.
- This is the validation claim to make, because it holds on synthetic data:
  the schedule is robust to the model's own error, whatever that error turns
  out to be against real-world durations. Accuracy-against-reality is a
  separate question that only real data can answer, and it is out of scope.

### Two bugs found by building it

**1. The tie-break created 1-minute portions.** Minimising total busy time rewards *attaching a sliver to a faster pair*: because completion is `sum(rate * busy) >= SCALE`, one minute on a high-rate pair removes more than a minute from a low-rate one. The first end-to-end run produced a portion of **1 minute delivering 0.8% of a task**. Fixed with `MIN_PORTION_MINUTES = 30` (the cheap form of the mobilisation cost deferred in 4.8.5), capped at each candidate's own duration so short tasks stay feasible. Verified: minimum portion is now 30 min, minimum work share 9.2%.

**2. CP-SAT could not bound this model.** Its relaxation reported 628 min against a 2,777-min schedule — a 342% gap that says nothing. The structure it cannot see is *sequential stages under fixed resources*, which is straightforward to bound by hand. `scheduling/bounds.py` derives it and feeds it back as `makespan >= LB`, which both prunes the search and makes the reported gap meaningful. Every step of that derivation floors its divisions, so rounding can only weaken the bound, never invalidate it.

Also confirmed along the way: the weighted `BIG * makespan + sum(busy)` objective from 4.8.6 **is worse than two lexicographic phases**. BIG had to be ~80,000, and a coefficient that size degraded propagation badly. Two clean phases give exact lexicographic behaviour and a usable bound.

### Files

```
prediction_service/  complexity.py  loaders.py  candidates.py  predict.py
scheduling/          problem.py  bounds.py  greedy.py  cp_sat_model.py
                     resource_state.py  verify.py  run_scheduler.py
models/              duration_model.joblib  feature_schema.json
tests/               test_scheduling.py      (25 tests, ~3 s, no model needed)
```

### Tests

`python -m pytest tests -q` — 25 tests on a hand-built 2-task instance whose
answer is known by hand, so they run in seconds and test the *scheduling*
logic rather than ML accuracy.

Six of them corrupt a valid schedule and assert the verifier catches it
(unfinished work, double-booked resource, broken stage order, unskilled
assignment, inconsistent makespan). A checker that cannot fail is decoration.

Confirmed by mutation testing that the suite has teeth:

| injected bug | result |
|---|---|
| rate left in per-MINUTE units while `busy` counts buckets | fails at bucket 5 and 15, passes at bucket 1 — exactly right, the two formulas coincide at bucket 1 |
| `floor` instead of `ceil` in the rate conversion | fails at every bucket size |

### Still open

- Named alternatives (Fastest / Balanced / Low-fatigue) — parked deliberately; the balanced default runs now, and we agreed to look at numbers first.
- 5-minute bucketing is implemented (`--bucket 5`) but is not the default: it did not improve the gap, because the binding constraint is resource scarcity rather than search-space size.
- Decision 3.2 (weather/shift declared at intake) is still a simplification.

---

## 6. Suggested order of attack

1. ~~Answer 3.1 (stages vs total order)~~ — **DONE**, stages 1-6 written to `data/dataset_2_tasks.csv`.
2. ~~Phase 1 (machine roster, worker columns, task-list columns)~~ — **DONE**, plus `prediction_service/complexity.py`.
3. ~~Phase 2 (regenerate Dataset 1)~~ — **DONE**. MAE 11.56 / R^2 0.9656, no retune needed.
4. ~~Phase 3 (persist the pipeline)~~ — **DONE**, after Phase 2 as planned so the schema matched.
5. ~~Phase 4, Phase 5, Phase 6~~ — **DONE**. 4.8.6 items 1-4 went in with the first working solver, as intended. See section 5b for results.

> Ordering note: the original plan put Phase 3 second, on the grounds that it works against the model that exists today. That was true but saved nothing — Phase 2 changed the feature schema (complexity semantics, `Temperature` -> `Machine Temperature (C)`), so any pipeline persisted before it would have been stale on arrival.

---

## 6. Serving layer (built)

Full reference: **API.md**. Schema: **db/schema.sql** (applied to Supabase
project `uecmsueagxwukkivcxiv`).

### 6.1 Why the engine was extracted

The two-pass loop used to live inside `run_scheduler.py`, interleaved with the
report formatting. The API could not reuse it without importing a printer, and
copying it would have been worse: the two would drift and the number on the
dashboard would stop being the number in the report. `scheduling/engine.py`
computes, `run_scheduler.py` formats, `api/service.py` serialises.
`scheduling/summary.py` is the single definition of every derived figure, so the
HTTP response, the Postgres rows and the CSV cannot disagree.

### 6.2 Decisions taken while building it

- **Direct SQL, not PostgREST.** A run is ~900 rows across seven tables that are
  only meaningful together. One transaction writes all of it or none. A
  half-written run renders as a dashboard of zeroes with nothing indicating a
  problem.
- **Persisting implies registering the roster.** `assignments` carries foreign
  keys to `tasks`, `workers` and `machines`. A run built from an inline roster
  must register that roster first or the write fails on a constraint the caller
  never saw.
- **At most one `PUBLISHED` run**, enforced by a partial unique index. Two live
  plans would claim the same machines and double-count every utilisation figure.
- **`publish` refuses an unverified run** (409). The verifier is the last line
  between a mis-modelled constraint and a crew; "the API let me" is not a
  defence.
- **Utilisation is measured against the makespan**, not each resource's own
  span. A machine that runs 60 minutes and then sits for 900 is 6% utilised.
- **Idle machines stay in the response.** An unused asset is the most actionable
  row on the page and must not be filtered away.

### 6.3 Bugs this shook out

- Unknown `(industry, task_type)` raised a bare `KeyError`, which the route
  turned into a 404 naming nothing. `derive_complexity` now names the valid
  options and the caller gets a 422.
- `itertuples()` renames columns that are not valid identifiers, so
  `_asdict()["Operator Skill"]` never existed. The predict endpoint reads
  `to_dict("records")`.
- `candidate_summary()` became dead on the refactor and was deleted; the count
  it printed now travels on `PlanResult.n_candidates` and reaches the API.

### 6.4 Still open

- Oil & Gas roster change (add rigs) — measured payoff in §5b, not authorised.
- Named alternatives (Fastest / Balanced / Low-fatigue) — parked.
- Decision 3.2 (weather/shift circularity).
