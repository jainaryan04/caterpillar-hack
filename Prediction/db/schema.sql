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

create or replace view v_run_overview as
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
create or replace view v_active_assignments as
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
