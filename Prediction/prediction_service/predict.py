"""Load the persisted pipeline once and price the whole candidate table in one
batched call.

Row-by-row prediction would be orders of magnitude slower for no benefit: the
model is a tree ensemble behind a ColumnTransformer, and both amortise almost
perfectly over a batch.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

import joblib
import pandas as pd

MODEL_DIR = Path(__file__).resolve().parent.parent / "models"
MODEL_PATH = MODEL_DIR / "duration_model.joblib"
SCHEMA_PATH = MODEL_DIR / "feature_schema.json"


@lru_cache(maxsize=1)
def load_model():
    """The fitted Pipeline (ColumnTransformer + estimator) and its schema."""
    if not MODEL_PATH.exists():
        raise FileNotFoundError(
            f"no persisted model at {MODEL_PATH}. Run scripts/train_baselines.py first."
        )
    return joblib.load(MODEL_PATH), json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))


def check_schema(frame: pd.DataFrame, schema: dict) -> list[str]:
    """Compare a candidate frame against what the model was fit on.

    Missing columns and unknown categories are hard errors -- they produce
    silently wrong predictions rather than exceptions. Out-of-range numerics
    are warnings: XGBoost clamps them, so the prediction is defined but is an
    extrapolation the model cannot actually make.
    """
    warnings: list[str] = []

    missing = [c for c in schema["feature_order"] if c not in frame.columns]
    if missing:
        raise ValueError(f"candidate frame is missing model features: {missing}")

    for col, levels in schema["categorical_features"].items():
        unknown = sorted(set(frame[col].astype(str)) - set(levels))
        if unknown:
            raise ValueError(
                f"{col} contains categories the model never saw: {unknown}. "
                f"One-hot encoding would drop these to all-zeros and the "
                f"prediction would be meaningless."
            )

    for col, spec in schema["numerical_features"].items():
        below = int((frame[col] < spec["min"]).sum())
        above = int((frame[col] > spec["max"]).sum())
        if below or above:
            warnings.append(
                f"{col}: {below} below / {above} above the training range "
                f"[{spec['min']:.2f}, {spec['max']:.2f}] -- tree models clamp, "
                f"so these are extrapolations"
            )
    return warnings


def predict_durations(candidates: pd.DataFrame, verbose: bool = True) -> pd.DataFrame:
    """Add `predicted_duration` (minutes) to the candidate table.

    Returns a copy; the input is not mutated.
    """
    model, schema = load_model()

    warnings = check_schema(candidates, schema)
    if verbose:
        for w in warnings:
            print(f"  WARN  {w}")

    X = candidates[schema["feature_order"]]
    out = candidates.copy()
    out["predicted_duration"] = model.predict(X)

    # A non-positive or absurd duration would break the rate conversion
    # (division by zero, or a rate so large the solver treats the task as free).
    bad = out["predicted_duration"] <= 0
    if bad.any():
        raise ValueError(f"{int(bad.sum())} candidates predicted a non-positive duration")

    return out
