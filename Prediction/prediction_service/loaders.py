"""Read the three roster CSVs into normalised frames.

One place that knows the on-disk shape, so the rest of the system never parses
a CSV field by hand. In particular the `skills` column carries a leading space
after each ';' -- parsed once here so no caller has to remember to .strip().
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd

DATA_DIR = Path(__file__).resolve().parent.parent / "data"

TASKS_PATH = DATA_DIR / "dataset_2_tasks.csv"
WORKERS_PATH = DATA_DIR / "dataset_3_workers.csv"
MACHINES_PATH = DATA_DIR / "dataset_4_machines.csv"


def parse_skills(raw: str) -> frozenset[str]:
    """'A; B; C' -> {'A', 'B', 'C'}. The strip is load-bearing."""
    return frozenset(s.strip() for s in str(raw).split(";") if s.strip())


def load_tasks(path: Path = TASKS_PATH) -> pd.DataFrame:
    df = pd.read_csv(path)
    df["max_parallel"] = df["max_parallel"].astype(int)
    df["task_priority"] = df["task_priority"].astype(int)
    return df


def load_workers(path: Path = WORKERS_PATH) -> pd.DataFrame:
    df = pd.read_csv(path)
    df["skill_set"] = df["skills"].map(parse_skills)
    return df


def load_machines(path: Path = MACHINES_PATH) -> pd.DataFrame:
    return pd.read_csv(path)


def load_all():
    """tasks, workers, machines."""
    return load_tasks(), load_workers(), load_machines()
