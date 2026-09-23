"""
Synthesize the final 30,000-row Dataset 1 from the seed dataset using SDV.

Model choice
------------
GaussianCopulaSynthesizer is used. Rationale:
  - The schema is mixed (categorical + integer + continuous numerical)
    but with only ~9 features and no complex multi-modal structure per
    column, which is exactly the regime GaussianCopula handles well.
  - It fits marginal distributions per column plus a Gaussian copula for
    the dependency structure, which preserves rank (Spearman) correlations
    between numeric features and the target well -- this is what the
    downstream relationship validation checks for.
  - CTGAN/TVAE (GAN/VAE-based) are better suited to datasets with many
    complex multi-modal continuous distributions or large row/column
    counts where deep generative capacity pays off. For a 9-feature seed
    of ~9k rows, they cost far more compute for no meaningful fidelity
    gain here, and are more prone to mode collapse on the smaller
    categorical groups (e.g. rarer Task Types within an industry).

Industry/Task Type validity AND task-specific baselines
--------------------------------------------------------
Two problems must be solved together:
  1. A single joint synthesizer does not guarantee that sampled
     (Industry, Task Type) pairs are valid combinations.
  2. GaussianCopula models a categorical column jointly with numeric
     columns via a single pairwise-correlation structure. When one
     categorical column (Task Type) has several categories that each
     shift the mean of a numeric column (Actual Duration) very
     differently, a single joint copula tends to regress those
     category-specific means toward the overall mean -- an early version
     of this pipeline that fit one synthesizer per Industry (with Task
     Type as an in-model categorical column) measurably flattened the
     task-specific baseline durations required by the spec.

Both are solved by fitting a SEPARATE synthesizer per (Industry, Task
Type) pair on that pair's subset of the seed data. Each sub-model only
ever sees rows from one task type, so it reproduces that task type's
duration distribution (and its correlations with complexity, skill,
fatigue, machine age, weather, shift, temperature) directly -- by
construction, not by chance. Industry and Task Type are re-attached as
constant columns after sampling, so every generated row has a valid,
task-specific pairing.

Output: data/prediction_dataset.csv (exactly 30,000 rows, 10 columns)
"""

import numpy as np
import pandas as pd
from pathlib import Path

from sdv.metadata import SingleTableMetadata
from sdv.single_table import GaussianCopulaSynthesizer

RANDOM_SEED = 42
N_FINAL_ROWS = 30000

BASE_DIR = Path(__file__).resolve().parent.parent
SEED_PATH = BASE_DIR / "data" / "seed_dataset.csv"
OUTPUT_PATH = BASE_DIR / "data" / "prediction_dataset.csv"

FINAL_COLUMNS = [
    "Industry",
    "Task Type",
    "Task Complexity",
    "Operator Skill",
    "Operator Fatigue Score",
    "Machine Age",
    "Weather",
    "Shift Type",
    "Machine Temperature (C)",
    "Actual Duration (minutes)",
]

# Realistic bounds used to clip synthesized values (same domain bounds
# used during seed generation).
#
# Machine temperature is a property of the MACHINE, not of the site, so unlike
# the ambient temperature it replaced it has one global bound rather than a
# per-industry one. Must match MACHINE_TEMP_BOUNDS in generate_seed.py.
MACHINE_TEMP_BOUNDS = (70.0, 115.0)

WEATHER_CATEGORIES = {"Sunny", "Cloudy", "Rainy", "Foggy"}
SHIFT_CATEGORIES = {"Day", "Night"}


def build_metadata(df_subset: pd.DataFrame) -> SingleTableMetadata:
    metadata = SingleTableMetadata()
    metadata.detect_from_dataframe(df_subset)

    metadata.update_column(column_name="Weather", sdtype="categorical")
    metadata.update_column(column_name="Shift Type", sdtype="categorical")

    metadata.update_column(column_name="Task Complexity", sdtype="numerical", computer_representation="Int64")
    metadata.update_column(column_name="Operator Skill", sdtype="numerical", computer_representation="Int64")
    metadata.update_column(column_name="Operator Fatigue Score", sdtype="numerical", computer_representation="Float")
    metadata.update_column(column_name="Machine Age", sdtype="numerical", computer_representation="Float")
    metadata.update_column(column_name="Machine Temperature (C)", sdtype="numerical", computer_representation="Float")
    metadata.update_column(column_name="Actual Duration (minutes)", sdtype="numerical", computer_representation="Float")

    return metadata


def synthesize_task(industry: str, task_type: str, seed_subset: pd.DataFrame, n_rows: int, seed: int) -> pd.DataFrame:
    model_columns = [c for c in FINAL_COLUMNS if c not in ("Industry", "Task Type")]
    subset = seed_subset[model_columns].copy()

    metadata = build_metadata(subset)
    synthesizer = GaussianCopulaSynthesizer(metadata, enforce_min_max_values=True)
    np.random.seed(seed)
    synthesizer.fit(subset)

    sampled = synthesizer.sample(num_rows=n_rows)
    sampled.insert(0, "Task Type", task_type)
    sampled.insert(0, "Industry", industry)
    return sampled


def postprocess(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()

    df["Task Complexity"] = df["Task Complexity"].round().clip(1, 10).astype(int)
    df["Operator Skill"] = df["Operator Skill"].round().clip(1, 10).astype(int)
    df["Operator Fatigue Score"] = df["Operator Fatigue Score"].clip(0, 100).round(1)
    df["Machine Age"] = df["Machine Age"].clip(0, 20).round(2)

    df["Machine Temperature (C)"] = (
        df["Machine Temperature (C)"].clip(*MACHINE_TEMP_BOUNDS).round(1)
    )

    df["Actual Duration (minutes)"] = df["Actual Duration (minutes)"].clip(lower=5).round(1)

    df["Weather"] = df["Weather"].where(df["Weather"].isin(WEATHER_CATEGORIES), "Sunny")
    df["Shift Type"] = df["Shift Type"].where(df["Shift Type"].isin(SHIFT_CATEGORIES), "Day")

    return df


def main():
    seed_df = pd.read_csv(SEED_PATH)

    pair_counts = seed_df.groupby(["Industry", "Task Type"]).size()
    pair_proportions = pair_counts / pair_counts.sum()
    pairs = pair_proportions.index.tolist()

    raw_targets = {pair: pair_proportions[pair] * N_FINAL_ROWS for pair in pairs}
    row_targets = {pair: int(round(v)) for pair, v in raw_targets.items()}

    diff = N_FINAL_ROWS - sum(row_targets.values())
    if diff != 0:
        largest_pair = max(row_targets, key=row_targets.get)
        row_targets[largest_pair] += diff

    print(f"Synthesizing {len(pairs)} (Industry, Task Type) sub-models:")
    for pair, n in row_targets.items():
        print(f"  {pair}: {n}")

    synthesized_parts = []
    for i, (industry, task_type) in enumerate(pairs):
        subset = seed_df[(seed_df["Industry"] == industry) & (seed_df["Task Type"] == task_type)]
        n_rows = row_targets[(industry, task_type)]
        print(f"\nFitting GaussianCopulaSynthesizer for '{industry} / {task_type}' "
              f"on {len(subset)} seed rows -> sampling {n_rows} rows...")
        sampled = synthesize_task(industry, task_type, subset, n_rows, seed=RANDOM_SEED + i)
        synthesized_parts.append(sampled)

    final_df = pd.concat(synthesized_parts, ignore_index=True)
    final_df = postprocess(final_df)
    final_df = final_df[FINAL_COLUMNS]

    # Re-validate Task Type <-> Industry mapping post-hoc (should already be guaranteed).
    valid_pairs = seed_df.groupby("Industry")["Task Type"].unique().apply(set).to_dict()
    for industry, group in final_df.groupby("Industry"):
        invalid = set(group["Task Type"].unique()) - valid_pairs[industry]
        if invalid:
            raise ValueError(f"Invalid Task Types generated for {industry}: {invalid}")

    final_df = final_df.sample(frac=1.0, random_state=RANDOM_SEED).reset_index(drop=True)

    assert len(final_df) == N_FINAL_ROWS, f"Expected {N_FINAL_ROWS} rows, got {len(final_df)}"
    assert list(final_df.columns) == FINAL_COLUMNS

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    final_df.to_csv(OUTPUT_PATH, index=False)

    print(f"\nFinal synthetic dataset generated: {len(final_df)} rows -> {OUTPUT_PATH}")
    print(final_df.head())


if __name__ == "__main__":
    main()
