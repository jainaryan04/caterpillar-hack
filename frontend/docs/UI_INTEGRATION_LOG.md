# UI Integration & Simulation — Decision Log

Working log for the "real-truth UI + CP-SAT schedule replay" effort. Read this
before touching anything related to fabricated data, run analytics, task
planning, or the simulation replay — it records *why* things are shaped the
way they are, not just what changed. Full original plan (context, phases,
verification checklist) lives at the path the planning tool wrote it to:
`C:\Users\santh\.claude\plans\melodic-purring-sprout.md` (outside the repo —
copy the parts that matter into this file if that plan file ever disappears).

---

## Why this effort exists

The dashboard was wired to a live Supabase DB in an earlier pass, but a large
fraction of what was on screen was still fabricated, and the backend already
returns far more real analytics than the UI used. Goals, in order:

1. Every number on screen must trace to a real DB row — delete, don't paper
   over, anything invented.
2. Tasks get staged and reviewed before publishing (today's flow silently
   re-solves and auto-publishes on every task add).
3. The CP-SAT schedule gets demonstrated via a compressed client-side replay
   — not a real-time wait (the real makespan is ~2,814 minutes ≈ 2 days).

## Locked decisions (do not re-litigate without asking)

- **Sites = industries.** The roster spans 5 industries (Mining, Oil & Gas,
  Data Center Power, Marine & Rail, +1) across 110 tasks / 30 workers / 56
  machines. The site switcher becomes real: each industry is a "site." All
  machines share one physical `site_id`/geofence — that's honest, industry is
  a logical grouping, not a second pit.
- **Simulation = frontend visual replay only.** Normalize the real makespan
  into ~15s of animation via `requestAnimationFrame` over real
  `start_min`/`end_min`. **No DB mutation, no virtual clock on the backend, no
  WebSocket, no backend sim engine.** The published run's data is read-only
  input to the replay.
- **Task entry = stage → predict → solve once → review diff → publish.**
  Never auto-publish on task creation again. `POST /v1/predict` (instant, no
  solver) previews ranked operator/machine candidates while staging.
- **Explainability = medium.** Show who got assigned and why (skill match,
  fatigue, predicted duration). Skip solver-internals analytics
  (optimality-gap/bottleneck-chain UI) — those stay in `/v1/runs/*` for anyone
  who wants to `curl` them, but the UI doesn't surface them.
- **Analytics page:** the *entire* page was 100% mock (day-range picker,
  compare toggle, all 4 tabs). The backend has no multi-day history — only
  one published run at a time plus `/v1/runs` history (a list of *runs*, not
  *days*). The rebuilt page must not imply daily history that doesn't exist:
  no "last 7/14/30 days" selector, no "vs. previous period." Real trend =
  compare across published *runs*, not across days.

## What was fabricated (the audit that started this) — for reference

Kept here so nobody re-introduces the same shape of fake data by accident.

| Fake thing | File | Replaced with |
|---|---|---|
| Every KPI sparkline + delta ("+2 vs. yesterday") | `dashboard/kpi-row.tsx` | Deleted. No real day-over-day history exists. |
| Fleet Utilization KPI *value itself* | `dashboard/kpi-row.tsx` | `/v1/runs/active/utilization` → `summary.mean_utilization_pct` |
| Both dashboard charts (`UtilizationChart`, `ThroughputChart`) | `dashboard/dashboard-charts.tsx` | `UtilizationChart` (real, per machine-type) + `WorkloadChart` (real portion-concurrency profile) |
| Machine "Engine temp — last 2h" | `machines/machine-temp-chart.tsx` | Real `/v1/runs/active/state?kind=machine` thermal projection over the plan horizon |
| Operator 14-day fatigue sparkline | `operators/operator-drawer.tsx` | Real `/v1/runs/active/state?kind=worker` fatigue curve over the plan horizon |
| "Consecutive shifts" (`hoursThisWeek / 11`) | `operators/operator-drawer.tsx` | Deleted — no backing data, formula was invented |
| "Night shifts (wk)" (hardcoded `3`/`0`) | `operators/operator-drawer.tsx` | Deleted — no backing data |
| Operator `name` (`"Operator W019"`), `role` (always "Equipment Operator"), `phone` | `lib/api/client.ts`, `lib/types.ts` | Removed from the `Operator` type entirely. Identity is the real `worker_id`. Added real `skillLevel` (1–10) and `skills` (real skill_set strings) instead. |
| `hoursThisWeek` (silently equal to today's hours) | `lib/api/client.ts` | Removed. Operator drawer now shows real per-run `usage.n_tasks`/`utilization_pct` from `/v1/runs/active/workers`. |
| Entire Analytics page (all 4 tabs) | `features/analytics/*` | **In progress** — see Status below. |
| `config/site.ts` `CURRENT_USER`/`CURRENT_SHIFT` | `config/site.ts` | **Not started** — still fake, see Remaining Work. |

## Real backend surface this UI now leans on

Confirmed live against the running backend (`Prediction/api`), not assumed:

- `GET /v1/runs/active` (alias for whichever run has `status=PUBLISHED`) →
  `RunSummary`: makespan, lower bound, greedy comparison, verified flag,
  solve seconds, counts.
- `GET /v1/runs/active/utilization` → per-resource `busy_min`/`idle_min`/
  `utilization_pct`, plus a fleet-wide `summary`.
- `GET /v1/runs/active/state?kind=worker|machine` → time-series samples
  (`resource_id`, `t_min`, `value`) — fatigue for workers, engine temp for
  machines. Confirmed: 250 real worker samples / 526 total across the current
  run, 114 distinct `t_min` points spanning `0..makespan_min`.
- `GET /v1/runs/active/workers` / `/machines` → per-resource start/peak/end
  fatigue or temp, `n_tasks`, `utilization_pct`.
- `GET /v1/runs/active/assignments` → every scheduled *portion* with real
  `start_min`/`end_min` (integer minutes from horizon), `worker_id`,
  `machine_id`, `status`. **This is the exact input the simulation replay
  will run on** — do not reshape it, the replay's correctness depends on
  these being the solver's literal output.
- `GET /v1/runs?limit=` → run history — the real substitute for "trend over
  time" now that day-level history doesn't exist.
- `POST /v1/predict` → ranks (worker, machine) pairings for one task by
  predicted duration, **no solver wait**. Not yet wired into any UI — this is
  Phase 3's centerpiece (instant candidate preview while staging a task).

All of the above were added to `frontend/src/lib/api/client.ts` as
`runSummary`, `runList`, `runUtilization`, `runStateSamples`, `runWorkers`,
`runMachines`, `runPortions` — each wrapped in the existing `getActiveOr()`
pattern, so a fresh database with no published run yet degrades to `null`/`[]`
rather than fabricating a zero. Corresponding hooks are in
`frontend/src/hooks/use-fleet-data.ts` (`useRunSummary`, `useRunUtilization`,
etc.), all gated through `useGatedQuery` like every other real-data hook.

Every mutation that can change the schedule (`useCreateTask`, `useReplan`,
`useCompleteTask`) now invalidates the `["run"]` query prefix in addition to
the entity lists, via a new shared `useScheduleInvalidator()` helper in
`use-fleet-data.ts` — otherwise the run-analytics panels would go stale after
a replan.

## Status — what's actually done vs. still open

### Done (Phase 1, partial)
- [x] `lib/thresholds.ts` created (`ENGINE_TEMP`, `FATIGUE` — legitimate
      constants relocated out of `lib/mock/`).
- [x] `lib/site-plan.ts` created (`SITE_BOUNDS`, `SITE_PLAN` — real geometry
      relocated out of `lib/mock/`). Note: `pt()` (mock coordinate generator)
      was **not** carried over — it's dead now that nothing fabricates
      coordinates.
- [x] `TASK_TYPES` moved into `lib/status.ts` (was `lib/mock/tasks.ts`).
- [x] Run-analytics adapter functions + types added to `lib/api/client.ts`
      (see surface list above).
- [x] Run-analytics hooks added to `hooks/use-fleet-data.ts`, mutations wired
      to invalidate `["run"]`.
- [x] Dashboard charts rebuilt on real data (`UtilizationChart`,
      `WorkloadChart` — see table above). Both handle the "no published
      plan" case with `EmptyState`, not a fabricated zero-chart.
- [x] KPI row rebuilt: five tiles now show live counts with no delta/
      sparkline; the sixth ("Plan utilisation") reads the real
      `mean_utilization_pct`.
- [x] Machine temp chart rebuilt on real `/state?kind=machine` samples.
- [x] Operator drawer rebuilt: real fatigue curve from `/state?kind=worker`,
      real `usage` stats from `/workers` (start/peak/end fatigue, n_tasks,
      utilization_pct) replacing the two invented "Consecutive shifts"/"Night
      shifts" stats. Phone/call button removed (no `phone` field exists).
- [x] `Operator` type cleaned up in `lib/types.ts`: removed `name`, `role`,
      `phone`, `hoursThisWeek`; added `skillLevel`, `skills`.
- [x] Every UI reference to the removed `Operator.name` fixed across the
      codebase (command palette, sidebar SOS banner, machine card/table, map
      panels/drawer/site-map, operator table, safety event row/detail,
      task calendar/list) — all now show the real `worker_id` instead of a
      fabricated name. `OperatorChip` shared component now shows ID + real
      skill level instead of ID + fake name.
- [x] `entity-chip.tsx`'s `OperatorChip` prop type updated to
      `Pick<Operator, "id" | "initials" | "skillLevel">`.
- [x] `npx tsc --noEmit` clean as of the operator-identity change (verified
      right before this log was written — re-run before assuming it still is,
      since Analytics work is unfinished).

### Done (session 2 — 2026-09-24): Phase 1 finish, Phases 2–4

- [x] Analytics rewrite and `lib/mock/` deletion were already in commit
      40d0467; verified `grep -r "lib/mock" src` is empty and tsc/eslint clean.
- [x] `config/site.ts`: `CURRENT_USER`, `CURRENT_SHIFT`, `SITES` deleted. User
      menu says "Operations · Not signed in"; alert-store actor is
      "Operations"; dashboard header shows site + real plan horizon/makespan.
      Settings: fake profile and per-Cat-model threshold table replaced by the
      one real read-only set from `lib/thresholds.ts`.
- [x] **Bug fixed:** `/v1/rosters` returns workers with `skill_set` (array)
      and `available_from`/`available_until`; the adapter read `skills`/
      `*_min`, so every operator had empty skills and NaN shift times. Shift is
      now shown only when a worker's window is < 24 h (most span the 30-day
      horizon — not a shift).
- [x] **Bug fixed:** old `createTask` sent only Mining tasks inline, so every
      task-add re-planned *without the other four industries*. Planning now
      always sends the full roster + drafts.
- [x] **Phase 2 — sites = industries.** `lib/catalog.ts` mirrors the model's
      closed world (5 industries, 22 task types with VOLUME/difficulty from
      `complexity.py`, required machine type, default mode). `TaskType` /
      `MachineType` are now the backend strings — the old slug enums (and the
      invented `grading`/`inspection`/`maintenance`, which would 422) are gone.
      `useSite()` validates the persisted id (falls back to Mining). Scoping:
      tasks by industry; machines by the machine types the industry's tasks
      require; workers by skill overlap; alerts by machine type. Excavator /
      Wheel Loader legitimately appear under both Mining and Construction.
      Run-wide numbers (`RunSummary`) stay whole-plan; `useRunMachines` /
      `useRunPortions` narrow client-side.
- [x] **Phase 3 — `/planning`.** `stores/plan-draft-store.ts` (persisted tray),
      `features/planning/*`: schema-constrained form incl. execution mode and
      max-parallel; stage defaults to the roster's stage for that type; live
      `/v1/predict` preview (debounced, ~2 s, "effectively tied" within MAE);
      crew panel; one solve with `publish: false`; diff vs live (headline +
      per-task added/removed/reassigned/re-timed, timing compared as offset
      from each run's own horizon); explicit publish dialog listing side
      effects; discard = `DELETE /v1/runs/{id}`. `/tasks` no longer publishes
      anything — "Plan tasks" links here.
      **Known backend behaviour:** `POST /v1/plan` with `persist: true`
      upserts inline tasks into the roster (`sync_rosters`) even when not
      published, so a proposed-then-discarded draft task stays on the roster
      as unscheduled. The tray dedupes by task_id and says so; there is no
      delete-task endpoint.
      Measured: a 10 s solver budget = ~38 s wall (two passes + predict +
      persist); client timeout is 45 s + 3 × budget.
- [x] **Phase 4 — `/simulation`.** `hooks/use-replay-clock.ts` (rAF, anchor-
      based, seekable), `features/simulation/replay.ts` (pure state-at-t),
      `resource-lanes.tsx` (custom flex, machines/workers, click-to-seek),
      counters, event ticker (portion start/end + recorded safety events at
      their offset from `horizon_start`), `replay-map.tsx` (last GPS fix →
      assigned work-zone centroid while running, persistent "Replay" badge).
      New additive backend read: `GET /v2/zone-assignments`.
      Verified against the live run: bar offsets = start/end ÷ makespan;
      state flips exactly at start_min/end_min; peak 13 concurrent portions;
      no lane overlaps; scrubbing back reproduces identical counters; end
      utilisation 13.67% = total_busy_min 19238 ÷ (50 × 2814). Replay issues
      only GETs (no mutation hooks are imported in `features/simulation`).

### Still open

- [ ] In-browser click-through (browser automation was unavailable this
      session): planning form → preview → run scheduler → review → publish,
      and replay playback at 5/15/30 s.
- [ ] Publish was **not** exercised end to end (it would replace the live
      plan); propose → inspect → discard was, against the real backend.

### Session 3 (2026-09-24): simplified to a quick sandbox — user direction

The user asked for a minimal, fast flow and **no solver/greedy/CP-SAT
comparison data in the UI**. Changes:

- `/planning` (propose → diff → publish, 40–100 s solves) **removed**, with
  `plan-draft-store`, `proposePlan`/`publishRun`/`discardRun`/`runById`.
- `/simulation` is now **Simulate**: pick task type, quantity, weather,
  shift → `POST /v1/predict` (~2–4 s) ranks pairings → `features/simulation/
  assign.ts` takes the pairing that finishes earliest given what is already
  queued (prefers roster-AVAILABLE workers) → plays back on the map in 5 s.
  Task list shows worker, skill, fatigue, machine, predicted duration,
  start → finish. **Clear all** empties it. Sandbox lives in
  `stores/sim-store.ts` (localStorage); the only backend calls are predict
  POSTs — nothing is written to the database (verified in a headless run).
- Analytics: "Solver check" tile and "Improvement vs greedy" column removed.
- Map: `site-scenery.tsx` basemap art (pit terraces, ramp, crusher +
  conveyor, dump mounds, workshop, fuel tanks, trees, north arrow, scale);
  operators shown as a hard-hat badge on their assigned machine.

## Constraints that keep biting — don't relearn these the hard way

- **`getActiveOr()` pattern is mandatory for any new `/v1/runs/active/*`
  read.** It treats a 404 (no published run yet) as "empty," not an error.
  Skipping it means a fresh database throws instead of showing an honest
  empty state.
- **`useGatedQuery()` wrapping is mandatory for any new query hook** in
  `use-fleet-data.ts` — without it, the query cache can fill before a page
  segment hydrates, producing a hydration mismatch (server HTML shows a
  skeleton, client immediately shows data).
- **Design spec constraints** (`frontend/docs/DESIGN_SPEC.md`) still apply to
  everything new: status is never color alone (§0.2); brand yellow means "act
  here," never a status/chart-series/map-marker color (§9.4); no shadows, 6px
  card radius, 1px borders (§10); pulse reserved for unacknowledged critical
  events (§7.1); never re-skeleton already-shown data on background refresh
  (§18).
- **The model's schema is closed-world.** `Prediction/models/feature_schema.json`
  defines the only valid `Industry`/`Task Type`/`Weather`/`Shift Type` values.
  Any UI that lets a user type or select outside that list will 422 at
  `POST /v1/plan` or `/v1/predict` time — always constrain to the schema's
  categories, never free text, for any task-creation UI (Phase 3).
- **Simultaneous work in the replay must actually render simultaneously.**
  The whole point of demoing CP-SAT is showing the solver's own overlaps
  (multiple machines working at once); don't let the lane-chart layout
  algorithm accidentally serialize what the solver parallelized.

## Verification checklist (from the approved plan — re-run before calling any phase done)

1. `grep -r "lib/mock" frontend/src` → nothing (only passes once Analytics is
   rewritten and the mock folder is deleted).
2. `grep -rn "vs. yesterday" frontend/src` → nothing.
3. Every dashboard/analytics number matches its `/v1/runs/active/*` source —
   spot-check with `curl`.
4. Stop uvicorn → offline banner, no stale/invented numbers linger. Delete the
   published run → honest empty states, not zeros presented as fact.
5. Site switcher (once Phase 2 lands) re-scopes counts to match
   `/v1/rosters` filtered by that industry.
6. Planning flow (Phase 3): stage 2 tasks → `/v1/predict` returns ranked
   pairings fast → "Run scheduler" produces a new run with `published:
   false` → diff lists exactly the staged tasks as added → Publish →
   `/v1/runs/active` returns the new run id, machines flip to `RESERVED`.
7. Model guard: an out-of-schema task type is blocked client-side, never
   reaches the backend as a 422.
8. Replay correctness (Phase 4, most important): pick 3 real assignments,
   confirm bar positions match their real minute offsets, confirm solver-
   concurrent work animates concurrently, confirm scrubbing backward
   recomputes correctly, confirm zero network writes during playback.
9. `npx tsc --noEmit` and `npx eslint src --max-warnings=0` clean; manually
   verified in-browser at `localhost:3000`.

## Session 4 — Monitoring, Turbopack, plan-a-day simulate

- **Monitoring** (`/monitoring`): CCTV wall of the CV clips in `public/cameras/`
  (worker-safety, thermal-distance, sleep-detection), muted loop, "No signal"
  for missing clips. `<video>` renders after mount — a video-speed browser
  extension injected DOM into it and broke hydration.
- **Dev speed**: `npm run dev` is now `next dev --turbopack` (first compile per
  route 3–18 s → <1 s); `npm run dev:webpack` keeps the old path.
  `turbopack.root` pinned because a stray `~/package-lock.json` made Next infer
  the home folder as the workspace root.
- **Simulate** is now plan → run → review, per calendar day:
  - date picker + Day/Night shift; tasks placed from shift start (06:00/18:00).
  - "Run the day" (`features/simulation/day.ts` `runDay`): each actual duration
    = prediction + normal noise whose mean |error| is the model MAE (11.6 min),
    floored at half the prediction, seeded by date; tasks run in planned order
    and wait for their worker/machine, so overruns cascade.
  - Report: tasks done, ran late (> 5 min past plan), day finished vs planned,
    crew time, then a planned-vs-actual table. Days list = history.
  - Playback controls removed; playback auto-runs on add and on run.
  - "Prefer AVAILABLE workers" now applies only when planning today — a live
    plan's RESERVED status says nothing about tomorrow.
  - Store `cat-fleet-sim` v2 (days keyed by date); v1 data is dropped.
- **Superseded same session:** the run-the-day / actuals / report flow was
  removed at the user's request. The page is now **Schedule** (still
  `/simulation`): inputs (date, shift, task, quantity, weather) → Gantt by
  worker on clock times → Assignments table (who, which machine, start,
  finish, duration). Candidate pairings are deliberately not shown. Map
  playback, `replay*.ts(x)`, `resource-lanes.tsx`, `day-report.tsx` and
  `use-replay-clock.ts` deleted.
