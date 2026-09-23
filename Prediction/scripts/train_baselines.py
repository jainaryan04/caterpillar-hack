"""
Train baseline ML models on the final synthetic dataset (data/prediction_dataset.csv)
purely to validate that the dataset contains learnable, realistic signal --
NOT to build the production duration-prediction model.

Models: Linear Regression, Random Forest, XGBoost (if available).
Split: 80% train / 10% validation / 10% test.
Metrics: MAE (primary), RMSE, R^2.
Also reports feature importance for the best model.

Writes reports/model_validation.txt and prints the full final project
summary (dataset + distribution + relationship + ML) required by the spec.
"""

import numpy as np
import pandas as pd
from pathlib import Path

from sklearn.model_selection import train_test_split
from sklearn.compose import ColumnTransformer
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from sklearn.linear_model import LinearRegression
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score

try:
    from xgboost import XGBRegressor
    HAS_XGBOOST = True
except ImportError:
    HAS_XGBOOST = False

RANDOM_SEED = 42

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_PATH = BASE_DIR / "data" / "prediction_dataset.csv"
REPORT_PATH = BASE_DIR / "reports" / "model_validation.txt"

TARGET = "Actual Duration (minutes)"
CATEGORICAL_FEATURES = ["Industry", "Task Type", "Weather", "Shift Type"]
NUMERICAL_FEATURES = ["Task Complexity", "Operator Skill", "Operator Fatigue Score", "Machine Age", "Temperature"]


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


def build_preprocessor():
    return ColumnTransformer(
        transformers=[
            ("cat", OneHotEncoder(handle_unknown="ignore"), CATEGORICAL_FEATURES),
            ("num", StandardScaler(), NUMERICAL_FEATURES),
        ]
    )


def evaluate(model, X, y):
    preds = model.predict(X)
    mae = mean_absolute_error(y, preds)
    rmse = np.sqrt(mean_squared_error(y, preds))
    r2 = r2_score(y, preds)
    return {"MAE": mae, "RMSE": rmse, "R2": r2}


def suspicious_r2_note(r2):
    if r2 > 0.99:
        return "  ** SUSPICIOUS: R2 > 0.99 -- investigate for leakage / overly deterministic generation **"
    return ""


def get_feature_importance(model, preprocessor, model_name):
    """Return a Series of importance aggregated back to original column names."""
    cat_names = list(preprocessor.named_transformers_["cat"].get_feature_names_out(CATEGORICAL_FEATURES))
    all_names = cat_names + NUMERICAL_FEATURES

    if model_name == "Linear Regression":
        raw = np.abs(model.coef_)
    else:
        raw = model.feature_importances_

    importance = pd.Series(raw, index=all_names)

    # Aggregate one-hot columns back to their original categorical feature
    agg = {}
    for feat in CATEGORICAL_FEATURES:
        agg[feat] = importance[[c for c in all_names if c.startswith(feat + "_")]].sum()
    for feat in NUMERICAL_FEATURES:
        agg[feat] = importance[feat]

    agg_series = pd.Series(agg).sort_values(ascending=False)
    agg_series = agg_series / agg_series.sum()
    return agg_series


def main():
    df = pd.read_csv(DATA_PATH)
    r = Report()

    section(r, "BASELINE MODEL VALIDATION")
    r.add(f"Dataset: {DATA_PATH} ({len(df)} rows)")

    X = df[CATEGORICAL_FEATURES + NUMERICAL_FEATURES]
    y = df[TARGET]

    # 80/10/10 split: first split off 20%, then split that 20% into two 10% halves.
    X_train, X_temp, y_train, y_temp = train_test_split(X, y, test_size=0.20, random_state=RANDOM_SEED)
    X_val, X_test, y_val, y_test = train_test_split(X_temp, y_temp, test_size=0.50, random_state=RANDOM_SEED)

    r.add(f"Train: {len(X_train)} ({len(X_train)/len(df):.1%})  "
          f"Val: {len(X_val)} ({len(X_val)/len(df):.1%})  "
          f"Test: {len(X_test)} ({len(X_test)/len(df):.1%})")

    preprocessor = build_preprocessor()
    X_train_t = preprocessor.fit_transform(X_train)
    X_val_t = preprocessor.transform(X_val)
    X_test_t = preprocessor.transform(X_test)

    models = {
        "Linear Regression": LinearRegression(),
        "Random Forest": RandomForestRegressor(
            n_estimators=300, max_depth=14, min_samples_leaf=3,
            random_state=RANDOM_SEED, n_jobs=-1,
        ),
    }
    if HAS_XGBOOST:
        models["XGBoost"] = XGBRegressor(
            n_estimators=400, max_depth=6, learning_rate=0.05,
            subsample=0.8, colsample_bytree=0.8,
            random_state=RANDOM_SEED, n_jobs=-1,
        )
    else:
        r.add("\nXGBoost not available -- skipping (install with `pip install xgboost`).")

    section(r, "MODEL RESULTS")

    results = {}
    fitted_models = {}
    for name, model in models.items():
        model.fit(X_train_t, y_train)
        fitted_models[name] = model

        val_metrics = evaluate(model, X_val_t, y_val)
        test_metrics = evaluate(model, X_test_t, y_test)
        results[name] = {"val": val_metrics, "test": test_metrics}

        r.add(f"\n--- {name} ---")
        r.add(f"  Validation: MAE={val_metrics['MAE']:.2f}  RMSE={val_metrics['RMSE']:.2f}  R2={val_metrics['R2']:.4f}")
        r.add(f"  Test:       MAE={test_metrics['MAE']:.2f}  RMSE={test_metrics['RMSE']:.2f}  R2={test_metrics['R2']:.4f}"
              + suspicious_r2_note(test_metrics["R2"]))

    best_model_name = min(results, key=lambda k: results[k]["test"]["MAE"])
    r.add(f"\nBest model by test MAE: {best_model_name}")

    section(r, f"FEATURE IMPORTANCE ({best_model_name})")
    importance = get_feature_importance(fitted_models[best_model_name], preprocessor, best_model_name)
    r.add(importance.round(4).to_string())

    expected_important = {"Task Type", "Task Complexity", "Operator Skill", "Operator Fatigue Score", "Machine Age"}
    top_features = set(importance.head(5).index)
    overlap = expected_important & top_features
    r.add(f"\nExpected important features found in top 5: {sorted(overlap)}")
    r.add(f"Domain-sense check: {'PASS' if len(overlap) >= 3 else 'WARN'} "
          f"({len(overlap)}/{len(expected_important)} expected features in top 5)")

    # ------------------------------------------------------------------
    # FINAL PROJECT SUMMARY (spec-required)
    # ------------------------------------------------------------------
    section(r, "FINAL PROJECT SUMMARY")

    r.add("\nDataset:")
    r.add(f"  rows: {len(df)}")
    r.add(f"  columns: {len(df.columns)}")
    r.add(f"  missing values: {int(df.isna().sum().sum())}")
    r.add(f"  duplicate percentage: {df.duplicated().mean() * 100:.3f}%")

    r.add("\nDistribution:")
    r.add("  Industries:")
    for k, v in df["Industry"].value_counts(normalize=True).round(4).items():
        r.add(f"    {k}: {v:.2%}")
    r.add("  Task Types (top 5 by frequency):")
    for k, v in df["Task Type"].value_counts(normalize=True).round(4).head(5).items():
        r.add(f"    {k}: {v:.2%}")
    r.add("  Weather:")
    for k, v in df["Weather"].value_counts(normalize=True).round(4).items():
        r.add(f"    {k}: {v:.2%}")
    r.add("  Shift Type:")
    for k, v in df["Shift Type"].value_counts(normalize=True).round(4).items():
        r.add(f"    {k}: {v:.2%}")

    r.add("\nRelationships (Pearson corr with Actual Duration, net of Task Type baseline):")
    resid = df.groupby("Task Type")[TARGET].transform(lambda x: x - x.mean())
    for col in ["Task Complexity", "Operator Skill", "Operator Fatigue Score", "Machine Age"]:
        r.add(f"  {col} -> Duration: {df[col].corr(resid):+.3f}")

    r.add("\nML (test set):")
    for name in results:
        m = results[name]["test"]
        r.add(f"  {name}: MAE={m['MAE']:.2f}  RMSE={m['RMSE']:.2f}  R2={m['R2']:.4f}")

    r.add(f"\nFinal dataset saved at: {DATA_PATH}")
    r.add("\nSUCCESS: Dataset 1 generated, validated, and ML-checked.")

    r.save(REPORT_PATH)
    print(f"\nFull report written to {REPORT_PATH}")


if __name__ == "__main__":
    main()
