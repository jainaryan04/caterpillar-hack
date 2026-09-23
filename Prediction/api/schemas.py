"""Request and response models.

The request models are strict on purpose. Every field the solver depends on is
validated here, at the edge, because the failure mode of a bad value is not an
exception -- it is a plausible-looking schedule built on a task that claims to
be SINGLE and splittable at the same time.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator


class TaskIn(BaseModel):
    task_id: str
    task_type: str
    industry: str
    task_priority: int = Field(ge=1, description="Stage within the industry; stages run in order")
    work_quantity: float = Field(gt=0)
    work_unit: str
    weather: str
    shift_type: str
    execution_mode: Literal["SINGLE", "PARALLEL"] = "SINGLE"
    max_parallel: int = Field(default=1, ge=1, le=4)
    required_machine_type: str

    @model_validator(mode="after")
    def _single_means_one(self):
        # Mirrors the CHECK constraint in the database. Catching it here gives a
        # 422 naming the field instead of a 500 out of psycopg.
        if self.execution_mode == "SINGLE" and self.max_parallel != 1:
            raise ValueError("a SINGLE task cannot have max_parallel > 1")
        return self


class WorkerIn(BaseModel):
    worker_id: str
    skills: list[str] = Field(min_length=1)
    skill_level: int = Field(ge=1, le=10)
    current_fatigue: float = Field(ge=0, le=100)
    available_from: int = Field(default=0, ge=0)
    available_until: int = Field(default=43200, gt=0)

    @model_validator(mode="after")
    def _window(self):
        if self.available_until <= self.available_from:
            raise ValueError("available_until must be after available_from")
        return self


class MachineIn(BaseModel):
    machine_id: str
    machine_type: str
    age_years: float = Field(ge=0, le=60)
    engine_temp_c: float = Field(ge=40, le=140)


class PlanOptionsIn(BaseModel):
    seconds: float = Field(default=20.0, gt=0, le=600,
                           description="Solver wall-clock budget; capped by SCHEDULER_SECONDS_LIMIT")
    bucket: int = Field(default=1, ge=1, le=15, description="Time granularity in minutes")
    two_pass: bool = Field(default=True,
                           description="Re-price durations against projected fatigue/temperature")
    parallel_efficiency: bool = Field(default=True,
                                      description="Two machines on one face do not add up linearly")
    task_continuity: bool = Field(default=True,
                                  description="A task cannot be abandoned half-done and resumed")
    precedence_mode: Literal["per_industry", "global"] = "per_industry"


class PlanRequest(BaseModel):
    """Plan everything. Rosters come from one of three places, and mixing them
    is allowed: anything supplied inline wins, the rest is read from `source`."""

    source: Literal["csv", "db"] = Field(
        default="csv", description="Where to read rosters not supplied inline")
    tasks: list[TaskIn] | None = None
    workers: list[WorkerIn] | None = None
    machines: list[MachineIn] | None = None

    horizon_start: datetime | None = Field(
        default=None, description="Calendar anchor for minute 0; defaults to now")
    label: str | None = None
    persist: bool = Field(default=True, description="Write the run to Postgres")
    publish: bool = Field(default=False,
                          description="Make it the live plan and reserve its resources")
    include: list[Literal["assignments", "tasks", "machines", "workers",
                          "bottlenecks", "gantt", "state"]] = Field(
        default=["assignments", "tasks", "machines", "workers", "bottlenecks"],
        description="Which sections to inline in the response; all are queryable by run_id")
    options: PlanOptionsIn = PlanOptionsIn()

    @field_validator("tasks")
    @classmethod
    def _unique_task_ids(cls, v):
        if v and len({t.task_id for t in v}) != len(v):
            raise ValueError("duplicate task_id in request")
        return v


class PredictRequest(BaseModel):
    """Duration for one specific pairing, without scheduling anything."""

    task: TaskIn
    workers: list[WorkerIn] = Field(min_length=1)
    machines: list[MachineIn] = Field(min_length=1)
    top_k: int = Field(default=5, ge=1, le=100)


class AssignmentUpdate(BaseModel):
    status: Literal["PLANNED", "IN_PROGRESS", "DONE", "CANCELLED"]
    actual_start_at: datetime | None = None
    actual_end_at: datetime | None = None


class RunSummary(BaseModel):
    """Headline numbers. `verified` is the one to read first: it is an
    independent re-derivation of every constraint from the roster, not the
    solver's own self-report."""

    run_id: str | None = None
    solver_status: str
    makespan_min: int
    makespan_days: float
    lower_bound_min: int
    greedy_makespan_min: int
    improvement_vs_greedy_pct: float
    optimality_gap_pct: float | None = None
    gap_vs_analytical_bound_pct: float | None = None
    total_busy_min: int
    n_tasks: int
    n_candidates: int
    n_portions: int
    n_split_tasks: int
    workers_used: int
    machines_used: int
    workers_total: int
    machines_total: int
    passes: int
    pass1_makespan_min: int
    verified: bool
    violations: list[str]
    solve_seconds: float
    wall_seconds: float
    state_drift: dict[str, Any] = {}
    options: dict[str, Any] = {}


class PlanResponse(BaseModel):
    run_id: str | None
    persisted: bool
    published: bool
    horizon_start: datetime
    summary: RunSummary
    bottlenecks: list[dict[str, Any]] | None = None
    assignments: list[dict[str, Any]] | None = None
    tasks: list[dict[str, Any]] | None = None
    machines: list[dict[str, Any]] | None = None
    workers: list[dict[str, Any]] | None = None
    gantt: list[dict[str, Any]] | None = None
    state: list[dict[str, Any]] | None = None
