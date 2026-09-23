"""
Validate the final synthetic dataset (data/prediction_dataset.csv) against
the seed dataset (data/seed_dataset.csv).

Performs:
  - Schema / integrity checks (row count, columns, missing values, ranges,
    valid categories, valid Industry<->Task Type pairing, no impossible
    outliers).
  - Distribution comparisons (seed vs synthetic) for categorical and
    numerical columns.
  - Relationship validation (Pearson + Spearman correlations, grouped
    means/medians) to confirm the intended domain relationships survived
    synthesis.

Writes a full report to reports/dataset_validation.txt and also prints it
to stdout.
"""

import sys
import numpy as np
import pandas as pd
from pathlib import Path
from scipy import stats

BASE_DIR = Path(__file__).resolve().parent.parent
SEED_PATH = BASE_DIR / "data" / "seed_dataset.csv"
FINAL_PATH = BASE_DIR / "data" / "prediction_dataset.csv"
REPORT_PATH = BASE_DIR / "reports" / "dataset_validation.txt"

FINAL_COLUMNS = [
    "Industry", "Task Type", "Task Complexity", "Operator Skill",
    "Operator Fatigue Score", "Machine Age", "Weather", "Shift Type",
    "Machine Temperature (C)", "Actual Duration (minutes)",
]

CATEGORICAL_COLS = ["Industry", "Task Type", "Weather", "Shift Type"]
NUMERICAL_COLS = [
    "Task Complexity", "Operator Skill", "Operator Fatigue Score",
    "Machine Age", "Machine Temperature (C)", "Actual Duration (minutes)",
]

VALID_INDUSTRIES = {
    "Mining", "Construction", "Oil & Gas", "Data Center Power", "Marine & Rail",
}
VALID_WEATHER = {"Sunny", "Cloudy", "Rainy", "Foggy"}
VALID_SHIFT = {"Day", "Night"}

# Machine engine/coolant temperature, not site air temperature.
TEMP_HARD_BOUNDS = (70, 115)


class Report:
    def __init__(self):
        self.lines = []

    def add(self, text=""):
        self.lines.append(text)
        print(text)

    def save(self, path):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("\n".join(self.lines), encoding="utf-8")


def section(r, title):
    r.add("")
    r.add("=" * 70)
    r.add(title)
    r.add("=" * 70)


def check_integrity(r, df, seed_df):
    section(r, "1. INTEGRITY CHECKS")
    ok = True

    n_rows = len(df)
    r.add(f"Row count: {n_rows} (expected 30000) -> {'PASS' if n_rows == 30000 else 'FAIL'}")
    ok &= n_rows == 30000

    cols_match = list(df.columns) == FINAL_COLUMNS
    r.add(f"Exactly 10 expected columns in exact order -> {'PASS' if cols_match else 'FAIL'}")
    r.add(f"  Columns: {list(df.columns)}")
    ok &= cols_match

    missing = df.isna().sum().sum()
    r.add(f"Missing values: {missing} -> {'PASS' if missing == 0 else 'FAIL'}")
    ok &= missing == 0

    bad_industry = ~df["Industry"].isin(VALID_INDUSTRIES)
    r.add(f"Invalid Industry values: {bad_industry.sum()} -> {'PASS' if bad_industry.sum() == 0 else 'FAIL'}")
    ok &= bad_industry.sum() == 0

    bad_weather = ~df["Weather"].isin(VALID_WEATHER)
    r.add(f"Invalid Weather values: {bad_weather.sum()} -> {'PASS' if bad_weather.sum() == 0 else 'FAIL'}")
    ok &= bad_weather.sum() == 0

    bad_shift = ~df["Shift Type"].isin(VALID_SHIFT)
    r.add(f"Invalid Shift Type values: {bad_shift.sum()} -> {'PASS' if bad_shift.sum() == 0 else 'FAIL'}")
    ok &= bad_shift.sum() == 0

    valid_pairs = seed_df.groupby("Industry")["Task Type"].unique().apply(set).to_dict()
    invalid_pair_count = 0
    for industry, group in df.groupby("Industry"):
        invalid = set(group["Task Type"].unique()) - valid_pairs.get(industry, set())
        invalid_pair_count += group["Task Type"].isin(invalid).sum()
    r.add(f"Task Type <-> Industry mismatches: {invalid_pair_count} -> "
          f"{'PASS' if invalid_pair_count == 0 else 'FAIL'}")
    ok &= invalid_pair_count == 0

    def in_range(col, lo, hi):
        bad = (~df[col].between(lo, hi)).sum()
        r.add(f"{col} within [{lo}, {hi}]: {bad} violations -> {'PASS' if bad == 0 else 'FAIL'}")
        return bad == 0

    ok &= in_range("Task Complexity", 1, 10)
    ok &= in_range("Operator Skill", 1, 10)
    ok &= in_range("Operator Fatigue Score", 0, 100)
    ok &= in_range("Machine Age", 0, 20)
    ok &= in_range("Machine Temperature (C)", *TEMP_HARD_BOUNDS)

    bad_duration = (df["Actual Duration (minutes)"] <= 0).sum()
    r.add(f"Actual Duration <= 0: {bad_duration} -> {'PASS' if bad_duration == 0 else 'FAIL'}")
    ok &= bad_duration == 0

    # Outlier sanity: values beyond ~6 std of the mean, or absurdly large durations
    dur = df["Actual Duration (minutes)"]
    z = (dur - dur.mean()) / dur.std()
    extreme_outliers = (z.abs() > 6).sum()
    r.add(f"Actual Duration extreme outliers (|z|>6): {extreme_outliers} -> "
          f"{'PASS' if extreme_outliers == 0 else 'WARN'}")
    max_dur = dur.max()
    r.add(f"Max Actual Duration: {max_dur:.1f} minutes ({max_dur/60:.1f} hours) -> "
          f"{'PASS' if max_dur < 1500 else 'WARN'}")

    duplicate_pct = df.duplicated().mean() * 100
    r.add(f"Duplicate row percentage: {duplicate_pct:.3f}% -> "
          f"{'PASS' if duplicate_pct < 1.0 else 'WARN'}")

    r.add("")
    r.add(f"OVERALL INTEGRITY: {'PASS' if ok else 'FAIL'}")
    return ok


def compare_distributions(r, df, seed_df):
    section(r, "2. DISTRIBUTION VALIDATION")

    for col in CATEGORICAL_COLS:
        r.add(f"\n--- {col} distribution ---")
        seed_dist = seed_df[col].value_counts(normalize=True).sort_index()
        final_dist = df[col].value_counts(normalize=True).sort_index()
        comp = pd.DataFrame({"seed_pct": seed_dist, "synthetic_pct": final_dist}).fillna(0) * 100
        r.add(comp.round(2).to_string())

    r.add("\n--- Numerical columns: seed vs synthetic ---")
    stats_rows = []
    for col in NUMERICAL_COLS:
        for label, source in [("seed", seed_df), ("synthetic", df)]:
            s = source[col]
            stats_rows.append({
                "column": col, "source": label,
                "mean": s.mean(), "median": s.median(), "std": s.std(),
                "min": s.min(), "max": s.max(),
                "q25": s.quantile(0.25), "q75": s.quantile(0.75),
            })
    stats_df = pd.DataFrame(stats_rows).round(2)
    r.add(stats_df.to_string(index=False))


def relationship_validation(r, df):
    section(r, "3. RELATIONSHIP VALIDATION")

    target = df["Actual Duration (minutes)"]

    r.add("\n--- Correlations with Actual Duration (raw, dataset-wide) ---")
    for col in ["Task Complexity", "Operator Skill", "Operator Fatigue Score", "Machine Age", "Machine Temperature (C)"]:
        pearson = df[col].corr(target)
        spearman = df[col].corr(target, method="spearman")
        r.add(f"{col:28s} Pearson={pearson:+.3f}  Spearman={spearman:+.3f}")

    r.add("\n--- Correlations net of Task Type baseline (residualized) ---")
    r.add("(Task Type sets a strong baseline duration; these show the marginal")
    r.add(" effect of each feature after removing that baseline effect.)")
    resid = df.groupby("Task Type")["Actual Duration (minutes)"].transform(lambda x: x - x.mean())
    for col in ["Task Complexity", "Operator Skill", "Operator Fatigue Score", "Machine Age", "Machine Temperature (C)"]:
        pearson = df[col].corr(resid)
        spearman = df[col].corr(resid, method="spearman")
        r.add(f"{col:28s} Pearson={pearson:+.3f}  Spearman={spearman:+.3f}")

    r.add("\n--- Grouped mean / median Actual Duration by Industry ---")
    g = df.groupby("Industry")["Actual Duration (minutes)"].agg(["mean", "median", "std", "count"]).round(1)
    r.add(g.to_string())

    r.add("\n--- Grouped mean / median Actual Duration by Task Type ---")
    g = df.groupby(["Industry", "Task Type"])["Actual Duration (minutes)"].agg(["mean", "median", "count"]).round(1)
    r.add(g.to_string())

    r.add("\n--- Grouped mean Actual Duration by Weather ---")
    r.add(df.groupby("Weather")["Actual Duration (minutes)"].mean().round(1).to_string())

    r.add("\n--- Grouped mean Actual Duration by Shift Type ---")
    r.add(df.groupby("Shift Type")["Actual Duration (minutes)"].mean().round(1).to_string())

    r.add("\n--- Relationship direction summary ---")
    checks = [
        ("Task Complexity ^ -> Duration ^", df["Task Complexity"].corr(resid) > 0.05),
        ("Operator Skill ^ -> Duration v", df["Operator Skill"].corr(resid) < -0.05),
        ("Operator Fatigue ^ -> Duration ^", df["Operator Fatigue Score"].corr(resid) > 0.02),
        ("Machine Age ^ -> Duration ^", df["Machine Age"].corr(resid) > 0.02),
        ("Hotter machine -> Duration ^", df["Machine Temperature (C)"].corr(resid) > 0.02),
        ("Foggy > Sunny mean duration",
         df.loc[df.Weather == "Foggy", "Actual Duration (minutes)"].mean() >
         df.loc[df.Weather == "Sunny", "Actual Duration (minutes)"].mean()),
        ("Rainy > Sunny mean duration",
         df.loc[df.Weather == "Rainy", "Actual Duration (minutes)"].mean() >
         df.loc[df.Weather == "Sunny", "Actual Duration (minutes)"].mean()),
        ("Night > Day mean duration",
         df.loc[df["Shift Type"] == "Night", "Actual Duration (minutes)"].mean() >
         df.loc[df["Shift Type"] == "Day", "Actual Duration (minutes)"].mean()),
    ]
    all_pass = True
    for name, passed in checks:
        r.add(f"  {name}: {'PASS' if passed else 'FAIL'}")
        all_pass &= passed

    r.add("")
    r.add(f"OVERALL RELATIONSHIP VALIDATION: {'PASS' if all_pass else 'FAIL'}")
    return all_pass


def main():
    seed_df = pd.read_csv(SEED_PATH)
    df = pd.read_csv(FINAL_PATH)

    r = Report()
    r.add("DATASET VALIDATION REPORT")
    r.add(f"Seed dataset: {SEED_PATH} ({len(seed_df)} rows)")
    r.add(f"Synthetic dataset: {FINAL_PATH} ({len(df)} rows)")

    integrity_ok = check_integrity(r, df, seed_df)
    compare_distributions(r, df, seed_df)
    relationships_ok = relationship_validation(r, df)

    section(r, "FINAL VERDICT")
    verdict = integrity_ok and relationships_ok
    r.add(f"Integrity checks: {'PASS' if integrity_ok else 'FAIL'}")
    r.add(f"Relationship checks: {'PASS' if relationships_ok else 'FAIL'}")
    r.add(f"DATASET VALID: {'YES' if verdict else 'NO'}")

    r.save(REPORT_PATH)
    print(f"\nFull report written to {REPORT_PATH}")

    if not verdict:
        sys.exit(1)


if __name__ == "__main__":
    main()
