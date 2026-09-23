"""
Generate a realistic seed dataset of historical industrial task executions.

The seed dataset is later used as the training reference for an SDV
synthesizer (see generate_sdv_dataset.py). All "hidden" simulation
variables (multipliers, base durations, etc.) used to compute
Actual Duration are internal to this script and are NEVER written to
the output CSV.

Output: data/seed_dataset.csv
Columns (exactly):
    Industry, Task Type, Task Complexity, Operator Skill,
    Operator Fatigue Score, Machine Age, Weather, Shift Type,
    Temperature, Actual Duration (minutes)
"""

import numpy as np
import pandas as pd
from pathlib import Path

RANDOM_SEED = 42
N_SEED_ROWS = 9000

# Scales down the two "pure noise" sources in the hidden duration formula
# (irreducible, feature-independent variance): the per-task baseline spread
# and the final multiplicative noise term. Lower values give baseline models
# a higher achievable R^2 / lower MAE; kept well above 0 so distributions
# still overlap realistically (see README "Known limitations").
TASK_STD_SCALE = 0.08
NOISE_SIGMA = 0.008

OUTPUT_PATH = Path(__file__).resolve().parent.parent / "data" / "seed_dataset.csv"

# ----------------------------------------------------------------------
# Task universe: task-specific baseline duration (minutes) and
# sensitivity flags used only internally to drive the hidden formula.
# ----------------------------------------------------------------------
TASKS = {
    "Mining": {
        "Drilling":              dict(mean=200, std=45, outdoor=True,  visibility=False, equip=True,  skill=True),
        "Hauling Ore":           dict(mean=95,  std=20, outdoor=True,  visibility=True,  equip=True,  skill=False),
        "Surface Excavation":    dict(mean=160, std=35, outdoor=True,  visibility=False, equip=True,  skill=True),
        "Aggregate Collection":  dict(mean=65,  std=15, outdoor=True,  visibility=False, equip=False, skill=False),
    },
    "Construction": {
        "Site Preparation":  dict(mean=140, std=30, outdoor=True, visibility=False, equip=True,  skill=False),
        "Excavation":        dict(mean=170, std=35, outdoor=True, visibility=False, equip=True,  skill=True),
        "Road Building":     dict(mean=240, std=50, outdoor=True, visibility=False, equip=True,  skill=True),
        "Foundation Work":   dict(mean=220, std=45, outdoor=True, visibility=False, equip=False, skill=True),
        "Material Loading":  dict(mean=60,  std=15, outdoor=True, visibility=False, equip=True,  skill=False),
        "Demolition":        dict(mean=180, std=40, outdoor=True, visibility=False, equip=True,  skill=True),
    },
    "Oil & Gas": {
        "Well Drilling":           dict(mean=320, std=60, outdoor=True,  visibility=False, equip=True, skill=True),
        "Well Servicing":          dict(mean=220, std=45, outdoor=True,  visibility=False, equip=True, skill=True),
        "Pipeline Pumping":        dict(mean=130, std=25, outdoor=False, visibility=False, equip=True, skill=False),
        "Gas Compression Service": dict(mean=170, std=35, outdoor=False, visibility=False, equip=True, skill=True),
    },
    "Data Center Power": {
        "Generator Maintenance":       dict(mean=110, std=20, outdoor=False, visibility=False, equip=True,  skill=True),
        "Backup Generator Testing":    dict(mean=70,  std=15, outdoor=False, visibility=False, equip=False, skill=False),
        "Emergency Power Deployment":  dict(mean=100, std=20, outdoor=False, visibility=False, equip=True,  skill=True),
        "Cooling System Inspection":   dict(mean=65,  std=12, outdoor=False, visibility=False, equip=False, skill=False),
    },
    "Marine & Rail": {
        "Freight Operations":      dict(mean=200, std=40, outdoor=True,  visibility=True, equip=False, skill=False),
        "Locomotive Maintenance":  dict(mean=210, std=40, outdoor=False, visibility=False, equip=True, skill=True),
        "Rail Network Inspection": dict(mean=150, std=30, outdoor=True,  visibility=True, equip=False, skill=False),
        "Tugboat Engine Service":  dict(mean=160, std=32, outdoor=False, visibility=True, equip=True, skill=True),
    },
}

INDUSTRY_META = {
    "Mining": dict(
        temp_mean=18, temp_std=12, temp_min=-10, temp_max=42,
        machine_age_b=4.0,
        weather_probs={"Sunny": 0.45, "Cloudy": 0.25, "Rainy": 0.25, "Foggy": 0.05},
        night_prob=0.30,
    ),
    "Construction": dict(
        temp_mean=20, temp_std=10, temp_min=-5, temp_max=40,
        machine_age_b=4.5,
        weather_probs={"Sunny": 0.45, "Cloudy": 0.25, "Rainy": 0.25, "Foggy": 0.05},
        night_prob=0.25,
    ),
    "Oil & Gas": dict(
        temp_mean=25, temp_std=13, temp_min=-15, temp_max=48,
        machine_age_b=3.8,
        weather_probs={"Sunny": 0.50, "Cloudy": 0.25, "Rainy": 0.20, "Foggy": 0.05},
        night_prob=0.35,
    ),
    "Data Center Power": dict(
        temp_mean=21, temp_std=3, temp_min=12, temp_max=32,
        machine_age_b=6.5,
        weather_probs={"Sunny": 0.55, "Cloudy": 0.30, "Rainy": 0.12, "Foggy": 0.03},
        night_prob=0.38,
    ),
    "Marine & Rail": dict(
        temp_mean=17, temp_std=9, temp_min=-10, temp_max=38,
        machine_age_b=3.5,
        weather_probs={"Sunny": 0.45, "Cloudy": 0.25, "Rainy": 0.15, "Foggy": 0.15},
        night_prob=0.38,
    ),
}

WEATHER_CATEGORIES = ["Sunny", "Cloudy", "Rainy", "Foggy"]


def sample_gamma_from_mean_std(rng, mean, std, size):
    """Sample a positive, right-tailed distribution matching a target mean/std."""
    shape = (mean / std) ** 2
    scale = (std ** 2) / mean
    return rng.gamma(shape, scale, size=size)


def generate_seed(n_rows=N_SEED_ROWS, seed=RANDOM_SEED):
    rng = np.random.default_rng(seed)

    # Build flattened task list with industry weights (roughly even across industries,
    # slight variation so the dataset is not perfectly balanced).
    industries = list(TASKS.keys())
    industry_weights = np.array([0.22, 0.24, 0.19, 0.16, 0.19])
    industry_weights = industry_weights / industry_weights.sum()

    rows = []

    industry_choices = rng.choice(industries, size=n_rows, p=industry_weights)

    for industry in industries:
        idx = np.where(industry_choices == industry)[0]
        n = len(idx)
        if n == 0:
            continue

        task_names = list(TASKS[industry].keys())
        # Slight non-uniform weighting across task types within an industry
        base_w = np.linspace(1.3, 0.7, num=len(task_names))
        rng.shuffle(base_w)
        task_w = base_w / base_w.sum()
        chosen_tasks = rng.choice(task_names, size=n, p=task_w)

        meta = INDUSTRY_META[industry]

        # Task Complexity: covers full 1-10 range, centered, not uniform
        complexity = np.clip(np.round(rng.normal(5.5, 2.2, size=n)), 1, 10).astype(int)

        # Operator Skill: right-skewed toward 6-9, low values rarer
        skill_raw = rng.beta(5, 2, size=n)
        skill = np.clip(np.round(skill_raw * 9 + 1), 1, 10).astype(int)

        # Operator Fatigue: right-skewed, moderate typical, long tail to high fatigue
        fatigue = np.clip(rng.beta(2, 3.5, size=n) * 100, 0, 100)

        # Machine Age: right-skewed (newer machines more common), industry-dependent tail
        machine_age = np.clip(rng.beta(2.0, meta["machine_age_b"], size=n) * 20, 0, 20)

        # Weather: industry-specific categorical distribution
        w_probs = [meta["weather_probs"][c] for c in WEATHER_CATEGORIES]
        weather = rng.choice(WEATHER_CATEGORIES, size=n, p=w_probs)

        # Shift Type: industry-specific night-shift probability
        night_prob = meta["night_prob"]
        shift = np.where(rng.random(n) < night_prob, "Night", "Day")

        # Temperature: industry-specific normal distribution, clipped to plausible bounds
        temperature = np.clip(
            rng.normal(meta["temp_mean"], meta["temp_std"], size=n),
            meta["temp_min"], meta["temp_max"],
        )

        # ---- Hidden duration generation (never exposed as columns) ----
        base_duration = np.empty(n)
        outdoor_flag = np.empty(n, dtype=bool)
        visibility_flag = np.empty(n, dtype=bool)
        equip_flag = np.empty(n, dtype=bool)
        skill_flag = np.empty(n, dtype=bool)

        for t in task_names:
            t_idx = np.where(chosen_tasks == t)[0]
            if len(t_idx) == 0:
                continue
            spec = TASKS[industry][t]
            base_duration[t_idx] = sample_gamma_from_mean_std(
                rng, spec["mean"], spec["std"] * TASK_STD_SCALE, size=len(t_idx)
            )
            outdoor_flag[t_idx] = spec["outdoor"]
            visibility_flag[t_idx] = spec["visibility"]
            equip_flag[t_idx] = spec["equip"]
            skill_flag[t_idx] = spec["skill"]

        complexity_norm = (complexity - 5.5) / 4.5
        skill_norm = (skill - 5.5) / 4.5
        fatigue_norm = fatigue / 100.0
        machine_norm = machine_age / 20.0

        complexity_mult = 1 + 0.30 * complexity_norm

        skill_effect_size = np.where(skill_flag, 0.35, 0.18)
        skill_mult = 1 - skill_effect_size * skill_norm

        fatigue_interaction = 0.20 + 0.35 * np.clip(complexity_norm, 0, None)
        fatigue_mult = 1 + fatigue_interaction * fatigue_norm

        machine_effect_size = np.where(equip_flag, 0.32, 0.14)
        machine_mult = 1 + machine_effect_size * machine_norm

        weather_mult = np.ones(n)
        rainy_idx = weather == "Rainy"
        foggy_idx = weather == "Foggy"
        cloudy_idx = weather == "Cloudy"
        weather_mult[rainy_idx] = 1 + np.where(outdoor_flag[rainy_idx], 0.15, 0.03)
        weather_mult[foggy_idx] = 1 + np.where(visibility_flag[foggy_idx], 0.22, 0.05)
        weather_mult[cloudy_idx] = 1.02

        shift_mult = np.where(shift == "Night", 1.08, 1.0)

        # Monotonic, accelerating heat-stress effect: comfort point set near the
        # industry's low end so nearly the whole realistic range sits above it
        # (hotter conditions -> modestly longer duration, more so at extremes).
        # Kept monotonic per industry (rather than a symmetric U-shape) so the
        # rank relationship survives Gaussian-copula-based synthesis, which
        # can only preserve monotonic dependencies.
        comfort_point = meta["temp_min"] + 0.2 * (meta["temp_max"] - meta["temp_min"])
        dev = np.clip(temperature - comfort_point, 0, None)
        dev = np.minimum(dev, 40)
        temp_mult = 1 + 0.0020 * dev ** 1.4

        noise = rng.lognormal(mean=0.0, sigma=NOISE_SIGMA, size=n)

        duration = (
            base_duration
            * complexity_mult
            * skill_mult
            * fatigue_mult
            * machine_mult
            * weather_mult
            * shift_mult
            * temp_mult
            * noise
        )
        duration = np.round(np.clip(duration, 5, None), 1)

        industry_df = pd.DataFrame({
            "Industry": industry,
            "Task Type": chosen_tasks,
            "Task Complexity": complexity,
            "Operator Skill": skill,
            "Operator Fatigue Score": np.round(fatigue, 1),
            "Machine Age": np.round(machine_age, 2),
            "Weather": weather,
            "Shift Type": shift,
            "Temperature": np.round(temperature, 1),
            "Actual Duration (minutes)": duration,
        })
        rows.append(industry_df)

    seed_df = pd.concat(rows, ignore_index=True)
    seed_df = seed_df.sample(frac=1.0, random_state=seed).reset_index(drop=True)
    return seed_df


if __name__ == "__main__":
    df = generate_seed()
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(OUTPUT_PATH, index=False)
    print(f"Seed dataset generated: {len(df)} rows -> {OUTPUT_PATH}")
    print(df.head())
    print("\nColumn dtypes:")
    print(df.dtypes)
