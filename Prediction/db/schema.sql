-- Caterpillar fleet scheduler -- Supabase schema.
--
-- Idempotent: safe to re-run. Nothing here drops data.
--
-- Shape of the data
-- -----------------
-- Rosters (machines / workers / worker_skills / tasks) are the INPUT and live
-- for as long as the site does. A planning run is an immutable SNAPSHOT: every
-- planning table hangs off schedule_runs(id) and is deleted with it. Re-planning
-- never edits an old run, it writes a new one, so "what did we think last
-- Tuesday" stays answerable.
--
-- The one mutable thing inside a run is assignments.status plus the actual_*
-- timestamps -- that is the crew marking work as started and finished, which is
-- reality arriving, not a re-plan.
--
-- Time
-- ----
-- The solver works in MINUTES FROM THE START OF THE HORIZON, which is what the
-- *_min columns hold. schedule_runs.horizon_start anchors that to the calendar,
-- and the *_at columns carry the resolved timestamps so the UI never has to do
-- the arithmetic. Both are stored on purpose: the minutes are the source of
-- truth and survive a change of start date; the timestamps are what a calendar
-- component can bind to directly.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- rosters ---

create table if not exists machines (
    machine_id      text primary key,
    machine_type    text        not null,
    age_years       numeric(5,2) not null default 0,
    engine_temp_c   numeric(5,1) not null default 85,
    status          text        not null default 'AVAILABLE'
                    check (status in ('AVAILABLE', 'RESERVED', 'IN_USE', 'MAINTENANCE')),
    site            text,
    updated_at      timestamptz not null default now()
);

create table if not exists workers (
    worker_id           text primary key,
    skill_level         int         not null check (skill_level between 1 and 10),
    current_fatigue     numeric(5,1) not null default 0 check (current_fatigue between 0 and 100),
    -- Availability window, minutes from the horizon start. Kept in the same
    -- unit as everything else the solver sees.
    available_from_min  int         not null default 0,
    available_until_min int         not null default 43200,
    status              text        not null default 'AVAILABLE'
                        check (status in ('AVAILABLE', 'RESERVED', 'IN_USE', 'OFF_DUTY')),
    updated_at          timestamptz not null default now(),
    check (available_until_min > available_from_min)
);

-- A worker's skills are a set, not a delimited string: the roster CSV stores
-- 'Drilling; Hauling Ore' and every consumer had to remember to split and
-- strip it. In the database it is a join table, so eligibility is a JOIN.
create table if not exists worker_skills (
    worker_id  text not null references workers(worker_id) on delete cascade,
    skill      text not null,
    primary key (worker_id, skill)
);
create index if not exists worker_skills_skill_idx on worker_skills (skill);

create table if not exists tasks (
    task_id               text primary key,
    task_type             text not null,
    industry              text not null,
    -- Stage within the industry. Stages run strictly in order; industries run
    -- concurrently and are independent of each other.
    task_priority         int  not null check (task_priority >= 1),
    work_quantity         numeric(12,2) not null check (work_quantity > 0),
    work_unit             text not null,
    weather               text not null,
    shift_type            text not null,
    execution_mode        text not null check (execution_mode in ('SINGLE', 'PARALLEL')),
    max_parallel          int  not null default 1 check (max_parallel between 1 and 4),
    required_machine_type text not null,
    status                text not null default 'PENDING'
                          check (status in ('PENDING', 'SCHEDULED', 'IN_PROGRESS', 'DONE', 'CANCELLED')),
    created_at            timestamptz not null default now(),
    -- A SINGLE task that claims it can be split two ways is a contradiction the
    -- solver would silently resolve; reject it at the door instead.
    check (execution_mode = 'PARALLEL' or max_parallel = 1)
);
create index if not exists tasks_industry_stage_idx on tasks (industry, task_priority);
create index if not exists tasks_status_idx on tasks (status);

-- ------------------------------------------------------------------ runs ---

create table if not exists schedule_runs (
    id                          uuid primary key default gen_random_uuid(),
    created_at                  timestamptz not null default now(),
    label                       text,
    horizon_start               timestamptz not null default now(),
    status                      text not null default 'DRAFT'
                                check (status in ('DRAFT', 'PUBLISHED', 'ARCHIVED')),

    solver_status               text,
    makespan_min                int,
    makespan_days               numeric(6,2),
    -- Proven analytical floor: no schedule of this roster can finish sooner.
    lower_bound_min             int,
    greedy_makespan_min         int,
    improvement_vs_greedy_pct   numeric(6,2),
    -- Against CP-SAT's own proven bound for this solve.
    optimality_gap_pct          numeric(6,2),
    -- Against lower_bound_min, which is the meaningful one when the solver's
    -- internal LP bound is weak (it is, on this model).
    gap_vs_analytical_bound_pct numeric(6,2),

    total_busy_min              int,
    n_tasks                     int,
    -- Legal (task, worker, machine) pairings the model priced for this run.
    n_candidates                int,
    n_portions                  int,
    n_split_tasks               int,
    workers_used                int,
    machines_used               int,
    workers_total               int,
    machines_total              int,

    passes                      int,
    pass1_makespan_min          int,
    -- Independent re-derivation of every constraint from the roster, not the
    -- solver's own self-report. false here means do not dispatch this run.
    verified                    boolean not null default false,
    violations                  jsonb not null default '[]'::jsonb,
    options                     jsonb not null default '{}'::jsonb,
    state_drift                 jsonb not null default '{}'::jsonb,
    solve_seconds               numeric(8,2),
    wall_seconds                numeric(8,2)
);
alter table schedule_runs add column if not exists n_candidates int;

create index if not exists schedule_runs_created_idx on schedule_runs (created_at desc);

-- At most one run can be the live plan. Without this, two PUBLISHED runs would
-- both claim the same machines and every utilisation figure would double-count.
create unique index if not exists schedule_runs_one_published
    on schedule_runs (status) where status = 'PUBLISHED';

-- --------------------------------------------------------------- results ---

-- One row per PORTION: a contiguous block of one task worked by one
-- (worker, machine) pair. A SINGLE task has exactly one; a PARALLEL task has up
-- to max_parallel, and they may overlap in time -- that is the point.
create table if not exists assignments (
    id                     bigserial primary key,
    run_id                 uuid not null references schedule_runs(id) on delete cascade,
    seq                    int  not null,
    task_id                text not null references tasks(task_id) on delete cascade,
    task_type              text not null,
    industry               text not null,
    stage                  int  not null,
    execution_mode         text not null,
    worker_id              text not null references workers(worker_id),
    machine_id             text not null references machines(machine_id),
    machine_type           text not null,

    start_min              int  not null,
    end_min                int  not null,
    busy_min               int  not null check (busy_min > 0),
    start_at               timestamptz,
    end_at                 timestamptz,
    -- Share of the task's total work this portion delivers. Portions of one
    -- task sum to >= 100: the solver may overshoot by up to one time bucket,
    -- and a parallel split has to deliver MORE than 100% of the nominal work
    -- to cover the efficiency loss of machines working the same face.
    work_share_pct         numeric(5,1) not null,
    predicted_duration_min int  not null,

    status                 text not null default 'PLANNED'
                           check (status in ('PLANNED', 'IN_PROGRESS', 'DONE', 'CANCELLED')),
    actual_start_at        timestamptz,
    actual_end_at          timestamptz,
    notes                  text,

    check (end_min = start_min + busy_min),
    -- One machine cannot take two portions of the same task.
    unique (run_id, task_id, machine_id)
);
create index if not exists assignments_run_idx      on assignments (run_id, start_min);
create index if not exists assignments_machine_idx  on assignments (run_id, machine_id, start_min);
create index if not exists assignments_worker_idx   on assignments (run_id, worker_id, start_min);
create index if not exists assignments_status_idx   on assignments (run_id, status);

create table if not exists run_tasks (
    run_id                uuid not null references schedule_runs(id) on delete cascade,
    task_id               text not null references tasks(task_id) on delete cascade,
    task_type             text not null,
    industry              text not null,
    stage                 int  not null,
    execution_mode        text not null,
    max_parallel          int  not null,
    work_quantity         numeric(12,2),
    work_unit             text,
    required_machine_type text,
    weather               text,
    shift_type            text,
    start_min             int  not null,
    end_min               int  not null,
    span_min              int  not null,
    busy_min              int  not null,
    start_at              timestamptz,
    end_at                timestamptz,
    n_portions            int  not null,
    workers               text[] not null default '{}',
    machines              text[] not null default '{}',
    -- What this task would have taken on its single best pair with nothing in
    -- the way. span_min / fastest_solo_min is how much the queue cost it.
    fastest_solo_min      int,
    status                text not null default 'PLANNED',
    primary key (run_id, task_id)
);

create table if not exists machine_usage (
    run_id          uuid not null references schedule_runs(id) on delete cascade,
    machine_id      text not null references machines(machine_id) on delete cascade,
    machine_type    text not null,
    age_years       numeric(5,2),
    n_tasks         int  not null default 0,
    busy_min        int  not null default 0,
    idle_min        int  not null default 0,
    -- Measured against the whole makespan, not against the machine's own span.
    -- A machine that runs 60 minutes then sits for 900 is 6% utilised.
    utilization_pct numeric(5,1) not null default 0,
    first_start_min int,
    last_end_min    int,
    start_temp_c    numeric(5,1),
    end_temp_c      numeric(5,1),
    peak_temp_c     numeric(5,1),
    primary key (run_id, machine_id)
);

create table if not exists worker_usage (
    run_id              uuid not null references schedule_runs(id) on delete cascade,
    worker_id           text not null references workers(worker_id) on delete cascade,
    skill_level         int,
    n_tasks             int  not null default 0,
    busy_min            int  not null default 0,
    idle_min            int  not null default 0,
    utilization_pct     numeric(5,1) not null default 0,
    start_fatigue       numeric(5,1),
    end_fatigue         numeric(5,1),
    peak_fatigue        numeric(5,1),
    available_from_min  int,
    available_until_min int,
    primary key (run_id, worker_id)
);

-- Why the makespan is what it is. One row per industry; the critical one sets
-- the floor, and its cause is almost always the roster rather than the solver.
create table if not exists run_bottlenecks (
    run_id                 uuid not null references schedule_runs(id) on delete cascade,
    industry               text not null,
    chain_bound_min        int  not null,
    is_critical            boolean not null default false,
    share_of_makespan_pct  numeric(5,1),
    primary key (run_id, industry)
);

-- Fatigue and engine-temperature curves over the run, for charting. Sampled at
-- portion boundaries, which is where the value actually changes.
create table if not exists resource_state_samples (
    id            bigserial primary key,
    run_id        uuid not null references schedule_runs(id) on delete cascade,
    resource_kind text not null check (resource_kind in ('worker', 'machine')),
    resource_id   text not null,
    t_min         int  not null,
    value         numeric(6,2) not null
);
create index if not exists state_samples_idx
    on resource_state_samples (run_id, resource_kind, resource_id, t_min);

-- ----------------------------------------------------------------- views ---

drop view if exists v_run_overview;
create view v_run_overview as
select r.*,
       (select b.industry from run_bottlenecks b
         where b.run_id = r.id and b.is_critical limit 1) as critical_industry,
       (select count(*) from assignments a
         where a.run_id = r.id and a.status = 'DONE')     as assignments_done,
       (select count(*) from assignments a
         where a.run_id = r.id)                            as assignments_total
from schedule_runs r;

-- "What has each machine done" -- one row per machine per run, with the task
-- list inlined so the dashboard needs no second query.
create or replace view v_machine_workload as
select u.run_id,
       u.machine_id,
       u.machine_type,
       m.status as machine_status,
       u.n_tasks,
       u.busy_min,
       u.idle_min,
       u.utilization_pct,
       u.start_temp_c,
       u.end_temp_c,
       u.peak_temp_c,
       coalesce((
           select jsonb_agg(jsonb_build_object(
                      'task_id',   a.task_id,
                      'task_type', a.task_type,
                      'industry',  a.industry,
                      'worker_id', a.worker_id,
                      'start_min', a.start_min,
                      'end_min',   a.end_min,
                      'busy_min',  a.busy_min,
                      'status',    a.status)
                  order by a.start_min)
           from assignments a
           where a.run_id = u.run_id and a.machine_id = u.machine_id
       ), '[]'::jsonb) as work_done
from machine_usage u
join machines m using (machine_id);

create or replace view v_worker_workload as
select u.run_id,
       u.worker_id,
       w.status as worker_status,
       u.skill_level,
       u.n_tasks,
       u.busy_min,
       u.utilization_pct,
       u.start_fatigue,
       u.end_fatigue,
       u.peak_fatigue,
       coalesce((select array_agg(s.skill order by s.skill)
                   from worker_skills s where s.worker_id = u.worker_id), '{}') as skills,
       coalesce((
           select jsonb_agg(jsonb_build_object(
                      'task_id',    a.task_id,
                      'task_type',  a.task_type,
                      'machine_id', a.machine_id,
                      'start_min',  a.start_min,
                      'end_min',    a.end_min,
                      'busy_min',   a.busy_min,
                      'status',     a.status)
                  order by a.start_min)
           from assignments a
           where a.run_id = u.run_id and a.worker_id = u.worker_id
       ), '[]'::jsonb) as work_done
from worker_usage u
join workers w using (worker_id);

-- Machines and workers side by side in one utilisation table.
create or replace view v_resource_utilization as
select run_id, 'machine' as kind, machine_id as resource_id, machine_type as detail,
       n_tasks, busy_min, idle_min, utilization_pct
from machine_usage
union all
select run_id, 'worker', worker_id, 'skill ' || skill_level::text,
       n_tasks, busy_min, idle_min, utilization_pct
from worker_usage;

-- The live plan, ready to dispatch.
drop view if exists v_active_assignments;
create view v_active_assignments as
select a.*, r.horizon_start, r.label as run_label
from assignments a
join schedule_runs r on r.id = a.run_id
where r.status = 'PUBLISHED'
order by a.start_min, a.task_id;

-- ------------------------------------------------------------------- rls ---
-- The API talks to Postgres directly as the owner, so these policies exist for
-- anything hitting PostgREST with an anon key -- read the plan, never write it.
-- Writes go through the API, which is where the verifier runs.

do $$
declare t text;
begin
    foreach t in array array['machines', 'workers', 'worker_skills', 'tasks',
                             'schedule_runs', 'assignments', 'run_tasks',
                             'machine_usage', 'worker_usage', 'run_bottlenecks',
                             'resource_state_samples']
    loop
        execute format('alter table %I enable row level security', t);
        execute format('drop policy if exists %I on %I', t || '_read', t);
        execute format(
            'create policy %I on %I for select to anon, authenticated using (true)',
            t || '_read', t);
    end loop;
end $$;

-- =====================================================================
-- Phase 7 -- GPS position, routes and safety telemetry
-- =====================================================================
-- Scope of this section: the DATA needed to know where every machine is,
-- where it is going, and whether it is too close to another machine or
-- tipping over. No detector or simulator runs yet -- that is application
-- code, deliberately built after the schema so it has a stable target.
--
-- Two status columns on `machines`, on purpose
-- ---------------------------------------------
-- `status` (added in Phase 1) is a SCHEDULING concept: has this run's solver
-- reserved the machine. `telemetry_status` below is a PHYSICAL concept: what
-- the machine is doing right now, as reported by its own sensors. A machine
-- can be RESERVED by the scheduler and simultaneously IDLE (crew has not yet
-- started it) -- collapsing these into one column would make one of the two
-- questions unanswerable.
--
-- Why `sites` exists
-- ------------------
-- A latitude/longitude is meaningless without a frame: nothing stops a
-- machine reporting a position on the other side of the planet. `sites`
-- gives every machine a bounding box, which both a simulator and an input
-- validator can check against. The seeded box matches
-- frontend/src/lib/mock/site.ts SITE_BOUNDS exactly, so demo positions plot
-- straight into the existing map placeholder with no coordinate conversion
-- on either side.
--
-- Why pitch/roll instead of one "tilt" number
-- --------------------------------------------
-- Real IMUs report pitch (nose up/down) and roll (side to side) separately,
-- and a rollover reads very differently on the two axes than driving up a
-- grade does. `tilt_deg` is kept too, as a GENERATED column
-- (sqrt(pitch^2 + roll^2)), because most alert logic only needs the
-- magnitude and computing it in application code twice would be how the two
-- copies eventually disagree.
--
-- TILT vs ROLLOVER vs FALL
-- ------------------------
-- Three different physical signatures, not three names for one thing:
--   TILT      sustained tilt above the machine type's warning angle --
--             "this is parked or working on a grade steeper than normal".
--   ROLLOVER  sustained tilt above the CRITICAL angle -- "this machine is on
--             its side or close to it".
--   FALL      a large angle CHANGE within one minute, regardless of the
--             resulting angle -- "this happened suddenly", which a slow
--             climb up a haul road never does.
-- Thresholds are per machine type (`machine_type_specs`): a mobile crane
-- rolls over at a far shallower angle than a bulldozer, and a stationary
-- generator skid should alarm at almost no tilt at all.
--
-- Why the partial unique indexes on machine_safety_events
-- ---------------------------------------------------------
-- Without them, a detector re-run every simulation tick inserts a fresh
-- PROXIMITY row for the same pair of machines every single tick they stay
-- close, and the alert list becomes unusable noise. The index makes "this
-- pair, this type, still open" a conflict the detector's UPSERT resolves by
-- extending the existing event (see `last_confirmed_at`), not by duplicating
-- it. Machine order does not matter for a pair, hence least/greatest.

-- ------------------------------------------------------------------ sites ---

create table if not exists sites (
    id       text primary key,
    name     text not null,
    lat_min  numeric(9,6) not null,
    lat_max  numeric(9,6) not null,
    lng_min  numeric(9,6) not null,
    lng_max  numeric(9,6) not null,
    check (lat_max > lat_min and lng_max > lng_min)
);

insert into sites (id, name, lat_min, lat_max, lng_min, lng_max)
values ('SITE-01', 'Demo site (matches frontend mock bounds)',
        40.818, 40.842, -115.79, -115.75)
on conflict (id) do nothing;

-- ------------------------------------------------------- machine specs -----

create table if not exists machine_type_specs (
    machine_type              text primary key,
    proximity_threshold_m     numeric(6,1) not null default 12,
    tilt_warning_deg          numeric(4,1) not null default 10,
    tilt_critical_deg         numeric(4,1) not null default 25,
    sudden_change_deg_per_min numeric(5,1) not null default 18,
    check (tilt_critical_deg > tilt_warning_deg)
);

insert into machine_type_specs
    (machine_type, proximity_threshold_m, tilt_warning_deg, tilt_critical_deg, sudden_change_deg_per_min)
values
    ('*',                       12, 10, 25, 18),
    ('Excavator',               12, 12, 25, 20),
    ('Bulldozer',               12, 15, 30, 20),
    ('Haul Truck',              20, 10, 22, 20),
    ('Wheel Loader',            10, 12, 25, 20),
    ('Motor Grader',            10,  8, 20, 18),
    ('Rotary Drill Rig',        15,  6, 15, 12),
    ('Mobile Crane',            20,  4, 10, 10),
    ('Drilling Rig',            20,  5, 12, 10),
    ('Well Service Rig',        20,  5, 12, 10),
    ('Locomotive',              25,  6, 15, 15),
    ('Rail Inspection Vehicle', 15,  6, 15, 15),
    ('Marine Service Vessel',   25,  8, 20, 15),
    ('Pipeline Pump',           10, 10, 22, 18),
    ('Gas Compressor',          10,  8, 20, 15),
    ('Emergency Generator',      8,  8, 20, 15),
    ('Generator Test Unit',      8,  8, 20, 15),
    ('Service Truck',            8, 12, 25, 20),
    ('Maintenance Vehicle',      8, 12, 25, 20),
    ('Inspection Kit',           5, 30, 60, 40)
on conflict (machine_type) do update set
    proximity_threshold_m = excluded.proximity_threshold_m,
    tilt_warning_deg = excluded.tilt_warning_deg,
    tilt_critical_deg = excluded.tilt_critical_deg,
    sudden_change_deg_per_min = excluded.sudden_change_deg_per_min;

-- --------------------------------------------------- machines: live state --

alter table machines drop column if exists site;
alter table machines add column if not exists site_id text references sites(id);

alter table machines add column if not exists lat numeric(9,6);
alter table machines add column if not exists lng numeric(9,6);
alter table machines add column if not exists heading_deg numeric(5,1) not null default 0
    check (heading_deg >= 0 and heading_deg < 360);
alter table machines add column if not exists pitch_deg numeric(5,1) not null default 0
    check (pitch_deg between -90 and 90);
alter table machines add column if not exists roll_deg numeric(5,1) not null default 0
    check (roll_deg between -90 and 90);
alter table machines add column if not exists velocity_kph numeric(5,1) not null default 0
    check (velocity_kph between 0 and 120);
alter table machines add column if not exists telemetry_status text not null default 'OFFLINE'
    check (telemetry_status in ('OPERATING', 'IDLE', 'FAULT', 'MAINTENANCE', 'OFFLINE'));
alter table machines add column if not exists position_updated_at timestamptz;

do $$ begin
    alter table machines add column tilt_deg numeric(5,1)
        generated always as (sqrt(pitch_deg * pitch_deg + roll_deg * roll_deg)) stored;
exception when duplicate_column then null;
end $$;

with placed as (
    select machine_id,
           row_number() over (order by machine_id) - 1 as rn,
           count(*) over ()                            as n
    from machines
    where lat is null
)
update machines m
set site_id = 'SITE-01',
    lat = s.lat_min + (s.lat_max - s.lat_min) * (0.5 + (p.rn % 8)) / 8,
    lng = s.lng_min + (s.lng_max - s.lng_min) * (0.5 + (p.rn / 8)) / ceil(p.n / 8.0),
    telemetry_status = case m.status
                          when 'IN_USE'      then 'OPERATING'
                          when 'MAINTENANCE' then 'MAINTENANCE'
                          else 'IDLE'
                        end,
    position_updated_at = now()
from placed p, sites s
where m.machine_id = p.machine_id and s.id = 'SITE-01';

create index if not exists machines_site_idx on machines (site_id);

-- ---------------------------------------------------- position history -----

create table if not exists machine_position_history (
    id           bigserial primary key,
    machine_id   text not null references machines(machine_id) on delete cascade,
    t            timestamptz not null default now(),
    lat          numeric(9,6) not null,
    lng          numeric(9,6) not null,
    heading_deg  numeric(5,1) not null default 0,
    pitch_deg    numeric(5,1) not null default 0,
    roll_deg     numeric(5,1) not null default 0,
    velocity_kph numeric(5,1) not null default 0,
    source       text not null default 'simulated' check (source in ('simulated', 'live')),
    run_id       uuid references schedule_runs(id) on delete set null
);
create index if not exists position_history_machine_t_idx
    on machine_position_history (machine_id, t desc);

-- ------------------------------------------------------------------ routes -

create table if not exists machine_routes (
    id         uuid primary key default gen_random_uuid(),
    machine_id text not null references machines(machine_id) on delete cascade,
    run_id     uuid references schedule_runs(id) on delete cascade,
    task_id    text references tasks(task_id) on delete set null,
    label      text,
    status     text not null default 'PLANNED'
               check (status in ('PLANNED', 'ACTIVE', 'DONE', 'CANCELLED')),
    created_at timestamptz not null default now()
);
create index if not exists machine_routes_machine_idx on machine_routes (machine_id, status);
create index if not exists machine_routes_run_idx on machine_routes (run_id);

create table if not exists route_waypoints (
    route_id           uuid not null references machine_routes(id) on delete cascade,
    seq                int  not null,
    lat                numeric(9,6) not null,
    lng                numeric(9,6) not null,
    planned_offset_min int,
    primary key (route_id, seq)
);

create or replace view v_route_geometry as
select r.id as route_id, r.machine_id, r.run_id, r.task_id, r.label, r.status,
       jsonb_agg(
           jsonb_build_object('seq', w.seq, 'lat', w.lat, 'lng', w.lng,
                              'planned_offset_min', w.planned_offset_min)
           order by w.seq
       ) as waypoints
from machine_routes r
join route_waypoints w on w.route_id = r.id
group by r.id, r.machine_id, r.run_id, r.task_id, r.label, r.status;

-- -------------------------------------------------------- safety events ----

create table if not exists machine_safety_events (
    id                bigserial primary key,
    event_type        text not null check (event_type in ('PROXIMITY', 'TILT', 'ROLLOVER', 'FALL')),
    severity          text not null default 'MEDIUM'
                      check (severity in ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
    status            text not null default 'OPEN'
                      check (status in ('OPEN', 'ACKNOWLEDGED', 'RESOLVED')),

    machine_id        text not null references machines(machine_id) on delete cascade,
    other_machine_id  text references machines(machine_id) on delete cascade,

    lat               numeric(9,6),
    lng               numeric(9,6),

    distance_m        numeric(7,1),
    threshold_m       numeric(6,1),

    pitch_deg         numeric(5,1),
    roll_deg          numeric(5,1),
    tilt_deg          numeric(5,1),
    threshold_deg     numeric(4,1),

    detected_at       timestamptz not null default now(),
    last_confirmed_at timestamptz not null default now(),
    acknowledged_at   timestamptz,
    resolved_at       timestamptz,
    notes             text,

    check (machine_id <> other_machine_id),
    check (event_type <> 'PROXIMITY' or other_machine_id is not null),
    check (event_type = 'PROXIMITY' or other_machine_id is null)
);
create index if not exists safety_events_machine_idx on machine_safety_events (machine_id, status);
create index if not exists safety_events_open_idx on machine_safety_events (status, detected_at desc);

create unique index if not exists safety_events_open_proximity_pair
    on machine_safety_events (event_type, least(machine_id, other_machine_id),
                              greatest(machine_id, other_machine_id))
    where status = 'OPEN' and event_type = 'PROXIMITY';

create unique index if not exists safety_events_open_orientation
    on machine_safety_events (event_type, machine_id)
    where status = 'OPEN' and event_type in ('TILT', 'ROLLOVER', 'FALL');

-- -------------------------------------------------------------- views ------

create or replace view v_machine_positions as
select m.machine_id, m.machine_type, m.site_id,
       m.status as reservation_status, m.telemetry_status,
       m.lat, m.lng, m.heading_deg, m.pitch_deg, m.roll_deg, m.tilt_deg,
       m.velocity_kph, m.position_updated_at,
       coalesce(spec.proximity_threshold_m, dflt.proximity_threshold_m) as proximity_threshold_m,
       coalesce(spec.tilt_warning_deg, dflt.tilt_warning_deg)           as tilt_warning_deg,
       coalesce(spec.tilt_critical_deg, dflt.tilt_critical_deg)         as tilt_critical_deg,
       (select count(*) from machine_safety_events e
         where e.status = 'OPEN'
           and (e.machine_id = m.machine_id or e.other_machine_id = m.machine_id)) as open_alerts
from machines m
left join machine_type_specs spec on spec.machine_type = m.machine_type
cross join lateral (select * from machine_type_specs where machine_type = '*') dflt;

drop view if exists v_open_safety_events;
create view v_open_safety_events as
select e.*, a.machine_type as machine_type, b.machine_type as other_machine_type
from machine_safety_events e
join machines a on a.machine_id = e.machine_id
left join machines b on b.machine_id = e.other_machine_id
where e.status = 'OPEN'
order by e.severity desc, e.detected_at desc;

-- ------------------------------------------------------------------- rls ---

do $$
declare t text;
begin
    foreach t in array array['sites', 'machine_type_specs', 'machine_position_history',
                             'machine_routes', 'route_waypoints', 'machine_safety_events']
    loop
        execute format('alter table %I enable row level security', t);
        execute format('drop policy if exists %I on %I', t || '_read', t);
        execute format(
            'create policy %I on %I for select to anon, authenticated using (true)',
            t || '_read', t);
    end loop;
end $$;

-- =====================================================================
-- Phase 8 -- Geofencing
-- =====================================================================
-- Two independent conditions, both against the same `zones` table:
--
--   GEOFENCE_EXIT   a machine's current position is outside EVERY zone it
--                   is assigned to. Assignment is many-to-many
--                   (`machine_zone_assignments`) because a haul truck's
--                   normal working area legitimately spans several zones --
--                   pit, haul road AND crusher pad -- and it must not
--                   trip an alert crossing between them.
--   RESTRICTED_ZONE a machine (assigned or not -- assignment is irrelevant
--                   here) is physically inside a zone marked `restricted`.
--                   A blast zone excludes everyone, not just machines that
--                   were never supposed to be there.
--
-- Polygons are stored as the plain [{"lat","lng"}, ...] vertex list the
-- frontend already uses (Zone.polygon in lib/types.ts), not a geometry type
-- -- that keeps a zone a small, human-editable JSON value and avoids taking
-- a PostGIS dependency for a handful of low-vertex-count site polygons.
-- Containment is a hand-written ray-casting function instead, tested below
-- against known points before anything is seeded on top of it.
--
-- Zone geometry matches frontend/src/lib/mock/site.ts's pt() output exactly
-- (recomputed from the same SITE_BOUNDS/SITE_PLAN constants), plus one extra
-- zone, Z-PERIMETER, covering the whole site: the fallback geofence for
-- machine types that do not correspond to a mining bench (a locomotive, a
-- drilling rig, a marine vessel) so that no machine ships without geofence
-- coverage.

-- --------------------------------------------------------------- zones ----

create table if not exists zones (
    id            text primary key,
    site_id       text not null references sites(id),
    name          text not null,
    kind          text not null default 'work' check (kind in ('work', 'restricted')),
    -- Ordered ring of {"lat":..,"lng":..} vertices, not closed (first vertex
    -- is implicitly connected back to the last by point_in_polygon()).
    polygon       jsonb not null,
    active_window text,
    rule          text,
    check (jsonb_array_length(polygon) >= 3)
);

create table if not exists machine_zone_assignments (
    machine_id  text not null references machines(machine_id) on delete cascade,
    zone_id     text not null references zones(id) on delete cascade,
    assigned_at timestamptz not null default now(),
    primary key (machine_id, zone_id)
);

-- Seed geometry recomputed from frontend/src/lib/mock/site.ts's own pt()
-- transform over its SITE_BOUNDS/SITE_PLAN constants -- these vertices are
-- pixel-for-pixel identical to what the map placeholder already draws, plus
-- Z-PERIMETER (the whole site), which has no frontend counterpart yet.
insert into zones (id, site_id, name, kind, polygon, active_window, rule) values
    ('Z-B4', 'SITE-01', 'Bench 4', 'work', '[{"lat": 40.837875, "lng": -115.7852}, {"lat": 40.838625, "lng": -115.7748}, {"lat": 40.833, "lng": -115.7732}, {"lat": 40.831875, "lng": -115.784}]'::jsonb, null, null),
    ('Z-B5', 'SITE-01', 'Bench 5', 'work', '[{"lat": 40.838437, "lng": -115.772}, {"lat": 40.839, "lng": -115.7636}, {"lat": 40.833375, "lng": -115.7624}, {"lat": 40.832625, "lng": -115.7712}]'::jsonb, null, null),
    ('Z-HR2', 'SITE-01', 'Haul Road 2', 'work', '[{"lat": 40.831312, "lng": -115.7748}, {"lat": 40.829625, "lng": -115.7604}, {"lat": 40.82805, "lng": -115.7604}, {"lat": 40.829738, "lng": -115.7748}]'::jsonb, null, null),
    ('Z-CR', 'SITE-01', 'Crusher Pad', 'work', '[{"lat": 40.8315, "lng": -115.7596}, {"lat": 40.8318, "lng": -115.7532}, {"lat": 40.82625, "lng": -115.7528}, {"lat": 40.8258, "lng": -115.7592}]'::jsonb, null, null),
    ('Z-WD', 'SITE-01', 'Waste Dump North', 'work', '[{"lat": 40.8285, "lng": -115.7864}, {"lat": 40.829062, "lng": -115.7768}, {"lat": 40.821, "lng": -115.776}, {"lat": 40.820062, "lng": -115.7856}]'::jsonb, null, null),
    ('Z-WS', 'SITE-01', 'Workshop & Fuel Bay', 'work', '[{"lat": 40.824075, "lng": -115.7596}, {"lat": 40.824375, "lng": -115.7538}, {"lat": 40.81905, "lng": -115.75352}, {"lat": 40.818825, "lng": -115.7592}]'::jsonb, null, null),
    ('Z-BLAST', 'SITE-01', 'Blast Zone B7', 'restricted', '[{"lat": 40.837425, "lng": -115.767}, {"lat": 40.83765, "lng": -115.7638}, {"lat": 40.8351, "lng": -115.76352}, {"lat": 40.834875, "lng": -115.76672}]'::jsonb, '12:30-13:30', 'No entry during blast window. Clearance by shot-firer only.'),
    ('Z-HW', 'SITE-01', 'High-wall Exclusion', 'restricted', '[{"lat": 40.8405, "lng": -115.7868}, {"lat": 40.841175, "lng": -115.7728}, {"lat": 40.839675, "lng": -115.77256}, {"lat": 40.83885, "lng": -115.78632}]'::jsonb, null, 'Permanent exclusion -- unstable high-wall.'),
    ('Z-FUEL', 'SITE-01', 'Fuel Farm', 'restricted', '[{"lat": 40.824375, "lng": -115.753}, {"lat": 40.824525, "lng": -115.7508}, {"lat": 40.82235, "lng": -115.75068}, {"lat": 40.8222, "lng": -115.75288}]'::jsonb, null, 'Authorised fuel personnel only. No ignition sources.'),
    ('Z-PERIMETER', 'SITE-01', 'Site Perimeter (fallback geofence)', 'work', '[{"lat": 40.842, "lng": -115.79}, {"lat": 40.842, "lng": -115.75}, {"lat": 40.818, "lng": -115.75}, {"lat": 40.818, "lng": -115.79}]'::jsonb, null, 'Default geofence for machine types with no bench-specific assignment.')
on conflict (id) do update set
    name = excluded.name, kind = excluded.kind, polygon = excluded.polygon,
    active_window = excluded.active_window, rule = excluded.rule;

-- Assignment only makes sense for a zone a machine is meant to work inside;
-- assigning one to a restricted zone (as its "home area") would be a
-- contradiction the geofence check could never satisfy.
create or replace function check_zone_assignment_kind() returns trigger
language plpgsql as $$
declare k text;
begin
    select kind into k from zones where id = new.zone_id;
    if k <> 'work' then
        raise exception 'cannot assign a machine to non-work zone % (kind=%)', new.zone_id, k;
    end if;
    return new;
end;
$$;

drop trigger if exists zone_assignment_kind_check on machine_zone_assignments;
create trigger zone_assignment_kind_check
    before insert or update on machine_zone_assignments
    for each row execute function check_zone_assignment_kind();

-- Default assignment by machine type. Earthmoving/mining types get real
-- bench/road/pad zones; anything with no natural mining-site home (rail,
-- marine, oil & gas, data-centre, stationary skids) falls back to
-- Z-PERIMETER so every machine has geofence coverage from day one. A
-- multi-zone type (e.g. Haul Truck: road + crusher + dump) is genuinely
-- allowed to range across all of them -- that is what the many-to-many
-- table is for.
insert into machine_zone_assignments (machine_id, zone_id)
select m.machine_id, z.zone_id
from machines m
join (values
    ('Excavator',               'Z-B4'), ('Excavator',               'Z-B5'),
    ('Bulldozer',               'Z-WD'),
    ('Haul Truck',              'Z-HR2'), ('Haul Truck',             'Z-CR'), ('Haul Truck', 'Z-WD'),
    ('Wheel Loader',            'Z-CR'),  ('Wheel Loader',           'Z-B4'),
    ('Motor Grader',            'Z-HR2'),
    ('Rotary Drill Rig',        'Z-B4'),  ('Rotary Drill Rig',       'Z-B5'),
    ('Mobile Crane',            'Z-PERIMETER'),
    ('Service Truck',           'Z-WS'),
    ('Maintenance Vehicle',     'Z-WS'),
    ('Locomotive',              'Z-PERIMETER'),
    ('Rail Inspection Vehicle', 'Z-PERIMETER'),
    ('Marine Service Vessel',   'Z-PERIMETER'),
    ('Pipeline Pump',           'Z-PERIMETER'),
    ('Gas Compressor',          'Z-PERIMETER'),
    ('Drilling Rig',            'Z-PERIMETER'),
    ('Well Service Rig',        'Z-PERIMETER'),
    ('Inspection Kit',          'Z-PERIMETER'),
    ('Emergency Generator',     'Z-PERIMETER'),
    ('Generator Test Unit',     'Z-PERIMETER')
) as z(machine_type, zone_id) on z.machine_type = m.machine_type
on conflict (machine_id, zone_id) do nothing;

-- --------------------------------------------------------------- geometry --

-- Even-odd ray-casting point-in-polygon test. Good to well under a metre of
-- error at site scale (polygons here are hundreds of metres across, not
-- degrees) -- lat/lng is treated as a flat plane, which is the standard,
-- correct simplification at this scale. NOT valid for polygons spanning a
-- meaningful fraction of the globe.
create or replace function point_in_polygon(pt_lat numeric, pt_lng numeric, polygon jsonb)
returns boolean
language plpgsql immutable as $$
declare
    n int := jsonb_array_length(polygon);
    i int; j int;
    xi double precision; yi double precision;
    xj double precision; yj double precision;
    inside boolean := false;
    x double precision := pt_lng::double precision;
    y double precision := pt_lat::double precision;
begin
    if n < 3 then
        return false;
    end if;
    j := n - 1;
    for i in 0 .. n - 1 loop
        xi := (polygon->i->>'lng')::double precision;
        yi := (polygon->i->>'lat')::double precision;
        xj := (polygon->j->>'lng')::double precision;
        yj := (polygon->j->>'lat')::double precision;
        if (yi > y) <> (yj > y) then
            if x < (xj - xi) * (y - yi) / (yj - yi) + xi then
                inside := not inside;
            end if;
        end if;
        j := i;
    end loop;
    return inside;
end;
$$;

-- Great-circle distance in metres (haversine). Used for the PROXIMITY check;
-- accurate to well under a metre at the distances (tens of metres) this
-- system cares about.
create or replace function haversine_m(lat1 numeric, lng1 numeric, lat2 numeric, lng2 numeric)
returns numeric
language sql immutable as $$
    select 6371000.0 * 2 * asin(least(1.0, sqrt(
        sin(radians(lat2 - lat1) / 2) ^ 2
        + cos(radians(lat1)) * cos(radians(lat2)) * sin(radians(lng2 - lng1) / 2) ^ 2
    )));
$$;

-- Whether `mid` currently sits inside at least one of its assigned zones.
-- A machine with NO assignments is vacuously "inside" -- geofencing is opt
-- in per machine, not a trap for machines nobody has configured yet.
create or replace function machine_in_geofence(mid text)
returns boolean
language sql stable as $$
    select not exists (select 1 from machine_zone_assignments where machine_id = mid)
        or exists (
            select 1
            from machine_zone_assignments a
            join zones z on z.id = a.zone_id
            join machines m on m.machine_id = a.machine_id
            where a.machine_id = mid
              and point_in_polygon(m.lat, m.lng, z.polygon)
        );
$$;

-- ------------------------------------------------- safety_events: extend --

alter table machine_safety_events add column if not exists zone_id text references zones(id);

do $$
declare cname text;
begin
    select conname into cname from pg_constraint
     where conrelid = 'machine_safety_events'::regclass
       and pg_get_constraintdef(oid) like 'CHECK ((event_type = ANY%';
    if cname is not null then
        execute format('alter table machine_safety_events drop constraint %I', cname);
    end if;
end $$;

alter table machine_safety_events drop constraint if exists machine_safety_events_event_type_check;
alter table machine_safety_events add constraint machine_safety_events_event_type_check
    check (event_type in ('PROXIMITY', 'TILT', 'ROLLOVER', 'FALL', 'GEOFENCE_EXIT', 'RESTRICTED_ZONE'));

-- zone_id: REQUIRED for RESTRICTED_ZONE (which zone was entered), OPTIONAL
-- context for GEOFENCE_EXIT (which assigned zone it's nearest/relevant to,
-- if the caller wants to record one), and forbidden for every other type.
alter table machine_safety_events drop constraint if exists machine_safety_events_zone_id_check;
alter table machine_safety_events add constraint machine_safety_events_zone_id_check
    check (
        (event_type = 'RESTRICTED_ZONE' and zone_id is not null)
        or (event_type = 'GEOFENCE_EXIT')
        or (event_type not in ('RESTRICTED_ZONE', 'GEOFENCE_EXIT') and zone_id is null)
    );

-- GEOFENCE_EXIT joins the "one open event per machine" group; RESTRICTED_ZONE
-- gets its own group keyed by (machine, zone), since a machine can overlap
-- more than one restricted zone at once if they abut.
drop index if exists safety_events_open_orientation;
create unique index safety_events_open_orientation
    on machine_safety_events (event_type, machine_id)
    where status = 'OPEN' and event_type in ('TILT', 'ROLLOVER', 'FALL', 'GEOFENCE_EXIT');

create unique index if not exists safety_events_open_restricted_zone
    on machine_safety_events (machine_id, zone_id)
    where status = 'OPEN' and event_type = 'RESTRICTED_ZONE';

-- ------------------------------------------------------------------ views --

create or replace view v_machine_geofence_status as
select m.machine_id, m.machine_type, m.lat, m.lng,
       array_remove(array_agg(a.zone_id order by a.zone_id), null) as assigned_zones,
       machine_in_geofence(m.machine_id) as in_geofence,
       (select array_agg(z.id order by z.id) from zones z
         where z.kind = 'restricted' and point_in_polygon(m.lat, m.lng, z.polygon)
       ) as in_restricted_zones
from machines m
left join machine_zone_assignments a on a.machine_id = m.machine_id
group by m.machine_id, m.machine_type, m.lat, m.lng;

-- ------------------------------------------------------------------- rls ---

do $$
declare t text;
begin
    foreach t in array array['zones', 'machine_zone_assignments']
    loop
        execute format('alter table %I enable row level security', t);
        execute format('drop policy if exists %I on %I', t || '_read', t);
        execute format(
            'create policy %I on %I for select to anon, authenticated using (true)',
            t || '_read', t);
    end loop;
end $$;
