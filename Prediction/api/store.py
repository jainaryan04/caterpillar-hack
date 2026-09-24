"""Postgres persistence (Supabase), over a direct connection.

Direct SQL rather than PostgREST because a planning run is not a row, it is
~500 rows across seven tables that are only meaningful together. One
transaction writes all of it or none of it: a half-written run -- assignments
present, utilisation missing -- would render as a dashboard full of zeroes with
no indication anything was wrong.

The reads are deliberately thin. Aggregation that belongs to the database
(what a machine did, who is busiest) lives in the views in db/schema.sql, so
the shape of an answer is defined once and the API only forwards it.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

import pandas as pd
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from psycopg_pool import ConnectionPool

from .settings import settings


class StoreUnavailable(RuntimeError):
    """No DATABASE_URL configured."""


class Store:
    def __init__(self, url: str | None = None):
        self.url = url or settings.database_url
        self._pool: ConnectionPool | None = None

    @property
    def enabled(self) -> bool:
        return bool(self.url)

    @property
    def pool(self) -> ConnectionPool:
        if not self.url:
            raise StoreUnavailable(
                "DATABASE_URL is not set -- planning works, persistence does not"
            )
        if self._pool is None:
            # open=True connects eagerly so a bad URL fails at startup rather
            # than on the first user request.
            self._pool = ConnectionPool(self.url, min_size=1, max_size=4,
                                        kwargs={"row_factory": dict_row}, open=True)
        return self._pool

    def close(self):
        if self._pool is not None:
            self._pool.close()
            self._pool = None

    def ping(self) -> bool:
        try:
            with self.pool.connection() as c:
                c.execute("select 1")
            return True
        except Exception:
            return False

    # ------------------------------------------------------------- rosters ---

    def sync_rosters(self, tasks: pd.DataFrame, workers: pd.DataFrame,
                     machines: pd.DataFrame) -> dict:
        """Upsert the three rosters. Existing rows keep their operational
        `status` -- only the descriptive fields are refreshed, because status is
        owned by the crew marking work, not by a CSV reload."""
        with self.pool.connection() as c, c.transaction(), c.cursor() as cur:
            cur.executemany(
                """insert into machines (machine_id, machine_type, age_years, engine_temp_c)
                   values (%s, %s, %s, %s)
                   on conflict (machine_id) do update set
                     machine_type = excluded.machine_type,
                     age_years = excluded.age_years,
                     engine_temp_c = excluded.engine_temp_c,
                     updated_at = now()""",
                [(m.machine_id, m.machine_type, float(m.age_years), float(m.engine_temp_c))
                 for m in machines.itertuples(index=False)])

            cur.executemany(
                """insert into workers (worker_id, skill_level, current_fatigue,
                                        available_from_min, available_until_min)
                   values (%s, %s, %s, %s, %s)
                   on conflict (worker_id) do update set
                     skill_level = excluded.skill_level,
                     current_fatigue = excluded.current_fatigue,
                     available_from_min = excluded.available_from_min,
                     available_until_min = excluded.available_until_min,
                     updated_at = now()""",
                [(w.worker_id, int(w.skill_level), float(w.current_fatigue),
                  int(w.available_from), int(w.available_until))
                 for w in workers.itertuples(index=False)])

            skills = [(w.worker_id, s)
                      for w in workers.itertuples(index=False) for s in w.skill_set]
            # Replace wholesale: a worker who LOST a certification must not keep
            # matching tasks, and an upsert alone would never remove the row.
            cur.execute("delete from worker_skills where worker_id = any(%s)",
                      ([w.worker_id for w in workers.itertuples(index=False)],))
            cur.executemany("insert into worker_skills (worker_id, skill) values (%s, %s)"
                          " on conflict do nothing", skills)

            cur.executemany(
                """insert into tasks (task_id, task_type, industry, task_priority,
                        work_quantity, work_unit, weather, shift_type,
                        execution_mode, max_parallel, required_machine_type)
                   values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                   on conflict (task_id) do update set
                     task_type = excluded.task_type, industry = excluded.industry,
                     task_priority = excluded.task_priority,
                     work_quantity = excluded.work_quantity, work_unit = excluded.work_unit,
                     weather = excluded.weather, shift_type = excluded.shift_type,
                     execution_mode = excluded.execution_mode,
                     max_parallel = excluded.max_parallel,
                     required_machine_type = excluded.required_machine_type""",
                [(t.task_id, t.task_type, t.industry, int(t.task_priority),
                  float(t.work_quantity), t.work_unit, t.weather, t.shift_type,
                  t.execution_mode, int(t.max_parallel), t.required_machine_type)
                 for t in tasks.itertuples(index=False)])

        return {"machines": len(machines), "workers": len(workers),
                "worker_skills": len(skills), "tasks": len(tasks)}

    # ---------------------------------------------------------------- runs ---

    def save_run(self, *, summary: dict, assignments: list[dict], tasks: list[dict],
                 machines: list[dict], workers: list[dict], bottlenecks: list[dict],
                 samples: list[dict], horizon_start: datetime,
                 label: str | None = None) -> str:
        """Write one complete run. All of it, or none of it."""
        with self.pool.connection() as c, c.transaction(), c.cursor() as cur:
            run_id = cur.execute(
                """insert into schedule_runs (
                     label, horizon_start, solver_status, makespan_min, makespan_days,
                     lower_bound_min, greedy_makespan_min, improvement_vs_greedy_pct,
                     optimality_gap_pct, gap_vs_analytical_bound_pct, total_busy_min,
                     n_tasks, n_candidates, n_portions, n_split_tasks,
                     workers_used, machines_used,
                     workers_total, machines_total, passes, pass1_makespan_min,
                     verified, violations, options, state_drift,
                     solve_seconds, wall_seconds)
                   values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,
                           %s,%s,%s,%s,%s,%s,%s,%s,%s)
                   returning id""",
                (label, horizon_start, summary["solver_status"], summary["makespan_min"],
                 summary["makespan_days"], summary["lower_bound_min"],
                 summary["greedy_makespan_min"], summary["improvement_vs_greedy_pct"],
                 summary["optimality_gap_pct"], summary["gap_vs_analytical_bound_pct"],
                 summary["total_busy_min"], summary["n_tasks"],
                 summary["n_candidates"], summary["n_portions"],
                 summary["n_split_tasks"], summary["workers_used"],
                 summary["machines_used"], summary["workers_total"],
                 summary["machines_total"], summary["passes"],
                 summary["pass1_makespan_min"], summary["verified"],
                 Jsonb(summary["violations"]), Jsonb(summary["options"]),
                 Jsonb(summary["state_drift"]), summary["solve_seconds"],
                 summary["wall_seconds"])
            ).fetchone()["id"]

            cur.executemany(
                """insert into assignments (run_id, seq, task_id, task_type, industry,
                        stage, execution_mode, worker_id, machine_id, machine_type,
                        start_min, end_min, busy_min, start_at, end_at,
                        work_share_pct, predicted_duration_min, status)
                   values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                [(run_id, a["seq"], a["task_id"], a["task_type"], a["industry"],
                  a["stage"], a["execution_mode"], a["worker_id"], a["machine_id"],
                  a["machine_type"], a["start_min"], a["end_min"], a["busy_min"],
                  a["start_at"], a["end_at"], a["work_share_pct"],
                  a["predicted_duration_min"], a["status"]) for a in assignments])

            cur.executemany(
                """insert into run_tasks (run_id, task_id, task_type, industry, stage,
                        execution_mode, max_parallel, work_quantity, work_unit,
                        required_machine_type, weather, shift_type, start_min, end_min,
                        span_min, busy_min, start_at, end_at, n_portions, workers,
                        machines, fastest_solo_min, status)
                   values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,
                           %s,%s,%s,%s)""",
                [(run_id, t["task_id"], t["task_type"], t["industry"], t["stage"],
                  t["execution_mode"], t["max_parallel"], t["work_quantity"],
                  t["work_unit"], t["required_machine_type"], t["weather"],
                  t["shift_type"], t["start_min"], t["end_min"], t["span_min"],
                  t["busy_min"], t["start_at"], t["end_at"], t["n_portions"],
                  t["workers"], t["machines"], t["fastest_solo_min"], t["status"])
                 for t in tasks])

            cur.executemany(
                """insert into machine_usage (run_id, machine_id, machine_type,
                        age_years, n_tasks, busy_min, idle_min, utilization_pct,
                        first_start_min, last_end_min, start_temp_c, end_temp_c,
                        peak_temp_c)
                   values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                [(run_id, m["machine_id"], m["machine_type"], m["age_years"],
                  m["n_tasks"], m["busy_min"], m["idle_min"], m["utilization_pct"],
                  m["first_start_min"], m["last_end_min"], m["start_temp_c"],
                  m["end_temp_c"], m["peak_temp_c"]) for m in machines])

            cur.executemany(
                """insert into worker_usage (run_id, worker_id, skill_level, n_tasks,
                        busy_min, idle_min, utilization_pct, start_fatigue, end_fatigue,
                        peak_fatigue, available_from_min, available_until_min)
                   values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                [(run_id, w["worker_id"], w["skill_level"], w["n_tasks"], w["busy_min"],
                  w["idle_min"], w["utilization_pct"], w["start_fatigue"],
                  w["end_fatigue"], w["peak_fatigue"], w["available_from_min"],
                  w["available_until_min"]) for w in workers])

            cur.executemany(
                """insert into run_bottlenecks (run_id, industry, chain_bound_min,
                        is_critical, share_of_makespan_pct)
                   values (%s,%s,%s,%s,%s)""",
                [(run_id, b["industry"], b["chain_bound_min"], b["is_critical"],
                  b["share_of_makespan_pct"]) for b in bottlenecks])

            if samples:
                cur.executemany(
                    """insert into resource_state_samples (run_id, resource_kind,
                            resource_id, t_min, value) values (%s,%s,%s,%s,%s)""",
                    [(run_id, s["resource_kind"], s["resource_id"], s["t_min"],
                      s["value"]) for s in samples])

        return str(run_id)

    def _rows(self, sql: str, params: tuple = ()) -> list[dict]:
        with self.pool.connection() as c:
            return c.execute(sql, params).fetchall()

    def _row(self, sql: str, params: tuple = ()) -> dict | None:
        with self.pool.connection() as c:
            return c.execute(sql, params).fetchone()

    def list_runs(self, limit: int = 20) -> list[dict]:
        return self._rows(
            "select * from v_run_overview order by created_at desc limit %s", (limit,))

    def get_run(self, run_id: str) -> dict | None:
        return self._row("select * from v_run_overview where id = %s", (run_id,))

    def published_run(self) -> dict | None:
        return self._row("select * from v_run_overview where status = 'PUBLISHED'")

    def get_assignments(self, run_id: str, status: str | None = None,
                        machine_id: str | None = None,
                        worker_id: str | None = None) -> list[dict]:
        sql = "select * from assignments where run_id = %s"
        params: list[Any] = [run_id]
        for col, val in (("status", status), ("machine_id", machine_id),
                         ("worker_id", worker_id)):
            if val:
                sql += f" and {col} = %s"
                params.append(val)
        return self._rows(sql + " order by start_min, task_id", tuple(params))

    def get_run_tasks(self, run_id: str) -> list[dict]:
        return self._rows(
            "select * from run_tasks where run_id = %s order by start_min, task_id",
            (run_id,))

    def get_machine_workload(self, run_id: str) -> list[dict]:
        return self._rows(
            "select * from v_machine_workload where run_id = %s"
            " order by utilization_pct desc", (run_id,))

    def get_worker_workload(self, run_id: str) -> list[dict]:
        return self._rows(
            "select * from v_worker_workload where run_id = %s"
            " order by utilization_pct desc", (run_id,))

    def get_bottlenecks(self, run_id: str) -> list[dict]:
        return self._rows(
            "select * from run_bottlenecks where run_id = %s"
            " order by chain_bound_min desc", (run_id,))

    def get_state_samples(self, run_id: str, kind: str | None = None) -> list[dict]:
        sql = "select resource_kind, resource_id, t_min, value" \
              " from resource_state_samples where run_id = %s"
        params: list[Any] = [run_id]
        if kind:
            sql += " and resource_kind = %s"
            params.append(kind)
        return self._rows(sql + " order by resource_id, t_min", tuple(params))

    def utilization(self, run_id: str) -> list[dict]:
        return self._rows(
            "select * from v_resource_utilization where run_id = %s"
            " order by kind, utilization_pct desc", (run_id,))

    # ------------------------------------------------------------ dispatch ---

    def publish_run(self, run_id: str) -> dict:
        """Make a run the live plan and reserve everything it commits.

        Refuses to publish a run the verifier rejected. A schedule that fails
        its own consistency check is exactly the one that must not reach a crew,
        and 'the API let me' is not a defence anyone wants to give.
        """
        with self.pool.connection() as c, c.transaction(), c.cursor() as cur:
            run = cur.execute("select id, verified from schedule_runs where id = %s",
                            (run_id,)).fetchone()
            if run is None:
                raise LookupError(run_id)
            if not run["verified"]:
                raise ValueError("run failed independent verification; refusing to publish")

            cur.execute("update schedule_runs set status = 'ARCHIVED'"
                      " where status = 'PUBLISHED' and id <> %s", (run_id,))
            cur.execute("update schedule_runs set status = 'PUBLISHED' where id = %s",
                      (run_id,))

            # Reserve exactly the resources this plan uses; release the rest so a
            # machine dropped by a re-plan does not stay reserved forever.
            cur.execute("""update machines set status = case
                             when machine_id in (select distinct machine_id
                                                   from assignments where run_id = %s)
                             then 'RESERVED' else 'AVAILABLE' end,
                           updated_at = now()
                         where status in ('AVAILABLE', 'RESERVED')""", (run_id,))
            cur.execute("""update workers set status = case
                             when worker_id in (select distinct worker_id
                                                  from assignments where run_id = %s)
                             then 'RESERVED' else 'AVAILABLE' end,
                           updated_at = now()
                         where status in ('AVAILABLE', 'RESERVED')""", (run_id,))
            cur.execute("""update tasks set status = 'SCHEDULED'
                         where status = 'PENDING'
                           and task_id in (select task_id from assignments
                                            where run_id = %s)""", (run_id,))

            counts = cur.execute(
                """select count(distinct machine_id) as machines,
                          count(distinct worker_id)  as workers,
                          count(distinct task_id)    as tasks
                     from assignments where run_id = %s""", (run_id,)).fetchone()
        return {"run_id": run_id, "status": "PUBLISHED", "reserved": counts}

    def update_assignment(self, assignment_id: int, *, status: str,
                          actual_start_at: datetime | None = None,
                          actual_end_at: datetime | None = None) -> dict:
        """Mark one portion started/finished and carry the consequence through
        to the resources and the task.

        A task is only DONE when every portion of it is -- a parallel task with
        one rig still digging is not finished, however keen the other crew is.
        """
        now = datetime.now().astimezone()
        with self.pool.connection() as c, c.transaction(), c.cursor() as cur:
            row = cur.execute("select * from assignments where id = %s",
                            (assignment_id,)).fetchone()
            if row is None:
                raise LookupError(assignment_id)

            start = actual_start_at or (row["actual_start_at"]
                                        or (now if status in ("IN_PROGRESS", "DONE") else None))
            end = actual_end_at or (now if status == "DONE" else row["actual_end_at"])
            updated = cur.execute(
                """update assignments set status = %s, actual_start_at = %s,
                        actual_end_at = %s where id = %s returning *""",
                (status, start, end, assignment_id)).fetchone()

            res_status = {"IN_PROGRESS": "IN_USE", "DONE": "AVAILABLE",
                          "CANCELLED": "AVAILABLE", "PLANNED": "RESERVED"}[status]
            cur.execute("update machines set status = %s, updated_at = now()"
                      " where machine_id = %s", (res_status, row["machine_id"]))
            cur.execute("update workers set status = %s, updated_at = now()"
                      " where worker_id = %s",
                      (res_status, row["worker_id"]))

            remaining = cur.execute(
                """select count(*) as n from assignments
                    where run_id = %s and task_id = %s and status <> 'DONE'""",
                (row["run_id"], row["task_id"])).fetchone()["n"]
            task_status = ("DONE" if remaining == 0
                           else "IN_PROGRESS" if status == "IN_PROGRESS" else None)
            if task_status:
                cur.execute("update tasks set status = %s where task_id = %s",
                          (task_status, row["task_id"]))
                cur.execute("update run_tasks set status = %s"
                          " where run_id = %s and task_id = %s",
                          (task_status, row["run_id"], row["task_id"]))
        return dict(updated)

    def read_rosters(self, only_pending: bool = False):
        """Rosters back out of Postgres in exactly the frame shape the CSV
        loader produces, so the planner cannot tell the two sources apart.

        The `skills` string is rebuilt as well as `skill_set`: the model's
        feature builder never touches it, but keeping both means a frame from
        the database and a frame from disk are interchangeable everywhere,
        including in the tests.
        """
        from prediction_service.loaders import parse_skills

        with self.pool.connection() as c:
            task_sql = "select * from tasks"
            if only_pending:
                task_sql += " where status in ('PENDING', 'SCHEDULED')"
            tasks = pd.DataFrame(c.execute(task_sql + " order by task_id").fetchall())
            workers = pd.DataFrame(c.execute(
                """select w.*, coalesce(string_agg(s.skill, '; ' order by s.skill), '')
                            as skills
                     from workers w left join worker_skills s using (worker_id)
                    group by w.worker_id order by w.worker_id""").fetchall())
            machines = pd.DataFrame(
                c.execute("select * from machines order by machine_id").fetchall())

        if tasks.empty or workers.empty or machines.empty:
            raise LookupError("rosters in the database are empty -- POST /v1/rosters/sync first")

        for col in ("work_quantity",):
            tasks[col] = tasks[col].astype(float)
        tasks["max_parallel"] = tasks["max_parallel"].astype(int)
        tasks["task_priority"] = tasks["task_priority"].astype(int)

        workers = workers.rename(columns={"available_from_min": "available_from",
                                          "available_until_min": "available_until"})
        workers["skill_set"] = workers["skills"].map(parse_skills)
        workers["current_fatigue"] = workers["current_fatigue"].astype(float)
        workers["skill_level"] = workers["skill_level"].astype(int)

        machines["age_years"] = machines["age_years"].astype(float)
        machines["engine_temp_c"] = machines["engine_temp_c"].astype(float)
        return tasks, workers, machines

    def delete_run(self, run_id: str) -> bool:
        with self.pool.connection() as c:
            n = c.execute("delete from schedule_runs where id = %s",
                          (run_id,)).rowcount
        return bool(n)

    # --------------------------------------------------- live telemetry ---
    # Added for the frontend's map/alerts screens (Phase 7/8 tables). Purely
    # additive reads/writes over tables no v1 route touches -- nothing above
    # this line changes.

    def list_live_machines(self) -> list[dict]:
        return self._rows("select * from v_machine_positions order by machine_id")

    def list_zones(self) -> list[dict]:
        return self._rows(
            "select id, site_id, name, kind, polygon, active_window, rule"
            " from zones order by id")

    def list_alerts(self, status: str | None = None, limit: int = 300) -> list[dict]:
        sql = """select e.*, a.machine_type as machine_type,
                        b.machine_type as other_machine_type
                   from machine_safety_events e
                   join machines a on a.machine_id = e.machine_id
                   left join machines b on b.machine_id = e.other_machine_id"""
        params: list[Any] = []
        if status:
            sql += " where e.status = %s"
            params.append(status)
        sql += " order by e.severity desc, e.detected_at desc limit %s"
        params.append(limit)
        return self._rows(sql, tuple(params))

    def set_alert_status(self, alert_id: int, status: str, note: str | None = None) -> dict:
        """Acknowledge or resolve one safety event. `note` is appended to the
        event's own `notes` column rather than a separate table -- the schema
        already has a free-text field for exactly this."""
        ts_col = {"ACKNOWLEDGED": "acknowledged_at", "RESOLVED": "resolved_at"}.get(status)
        now = datetime.now().astimezone()
        with self.pool.connection() as c, c.transaction(), c.cursor() as cur:
            row = cur.execute("select id from machine_safety_events where id = %s",
                              (alert_id,)).fetchone()
            if row is None:
                raise LookupError(alert_id)
            sets, params = ["status = %s"], [status]
            if ts_col:
                sets.append(f"{ts_col} = %s")
                params.append(now)
            if note:
                sets.append("notes = coalesce(notes || '; ', '') || %s")
                params.append(note)
            params.append(alert_id)
            updated = cur.execute(
                f"update machine_safety_events set {', '.join(sets)} where id = %s"
                " returning *", tuple(params)).fetchone()
        return dict(updated)


store = Store()
