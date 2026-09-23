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
    Machine Temperature (C), Actual Duration (minutes)

Task Complexity is derived from a hidden work quantity via
prediction_service.complexity -- the SAME function the prediction service
calls at inference time. work_quantity itself is never written out; it is a
generator-internal variable, exactly like the duration multipliers.
"""

import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from prediction_service.complexity import derive_complexity, sample_quantity  # noqa: E402

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
# `duty` is the thermal duty class of the machine this task type runs on. It
# mirrors DUTY_BASE in the dataset_4_machines roster (keyed there by machine
# type, here by the task type that requires it) so a task type's generated
# Machine Temperature distribution matches the machines it will actually be
# paired with at scheduling time. Mismatch here means XGBoost clamping later.
TASKS = {
    "Mining": {
        "Drilling":              dict(mean=200, std=45, outdoor=True,  visibility=False, equip=True,  skill=True,  duty="heavy"),
        "Hauling Ore":           dict(mean=95,  std=20, outdoor=True,  visibility=True,  equip=True,  skill=False, duty="heavy"),
        "Surface Excavation":    dict(mean=160, std=35, outdoor=True,  visibility=False, equip=True,  skill=True,  duty="heavy"),
        "Aggregate Collection":  dict(mean=65,  std=15, outdoor=True,  visibility=False, equip=False, skill=False, duty="heavy"),
    },
    "Construction": {
        "Site Preparation":  dict(mean=140, std=30, outdoor=True, visibility=False, equip=True,  skill=False, duty="heavy"),
        "Excavation":        dict(mean=170, std=35, outdoor=True, visibility=False, equip=True,  skill=True,  duty="heavy"),
        "Road Building":     dict(mean=240, std=50, outdoor=True, visibility=False, equip=True,  skill=True,  duty="heavy"),
        "Foundation Work":   dict(mean=220, std=45, outdoor=True, visibility=False, equip=False, skill=True,  duty="medium"),
        "Material Loading":  dict(mean=60,  std=15, outdoor=True, visibility=False, equip=True,  skill=False, duty="heavy"),
        "Demolition":        dict(mean=180, std=40, outdoor=True, visibility=False, equip=True,  skill=True,  duty="heavy"),
    },
    "Oil & Gas": {
        "Well Drilling":           dict(mean=320, std=60, outdoor=True,  visibility=False, equip=True, skill=True,  duty="heavy"),
        "Well Servicing":          dict(mean=220, std=45, outdoor=True,  visibility=False, equip=True, skill=True,  duty="medium"),
        "Pipeline Pumping":        dict(mean=130, std=25, outdoor=False, visibility=False, equip=True, skill=False, duty="medium"),
        "Gas Compression Service": dict(mean=170, std=35, outdoor=False, visibility=False, equip=True, skill=True,  duty="heavy"),
    },
    "Data Center Power": {
        "Generator Maintenance":       dict(mean=110, std=20, outdoor=False, visibility=False, equip=True,  skill=True,  duty="medium"),
        "Backup Generator Testing":    dict(mean=70,  std=15, outdoor=False, visibility=False, equip=False, skill=False, duty="light"),
        "Emergency Power Deployment":  dict(mean=100, std=20, outdoor=False, visibility=False, equip=True,  skill=True,  duty="medium"),
        "Cooling System Inspection":   dict(mean=65,  std=12, outdoor=False, visibility=False, equip=False, skill=False, duty="light"),
    },
    "Marine & Rail": {
        "Freight Operations":      dict(mean=200, std=40, outdoor=True,  visibility=True, equip=False, skill=False, duty="heavy"),
        "Locomotive Maintenance":  dict(mean=210, std=40, outdoor=False, visibility=False, equip=True, skill=True,  duty="medium"),
        "Rail Network Inspection": dict(mean=150, std=30, outdoor=True,  visibility=True, equip=False, skill=False, duty="light"),
        "Tugboat Engine Service":  dict(mean=160, std=32, outdoor=False, visibility=True, equip=True, skill=True,  duty="medium"),
    },
}

# ----------------------------------------------------------------------
# Machine (engine/coolant) temperature. Replaces the old ambient site
# temperature: ambient depended on WHEN a task was scheduled, which is a
# scheduler output, so it was circular. Engine temperature is a property of
# the machine, known at candidate-generation time.
#
# These constants are deliberately identical to the ones used to build
# data/dataset_4_machines.csv. Training range must cover serving range.
# ----------------------------------------------------------------------
DUTY_BASE = {"heavy": 93.0, "medium": 87.0, "light": 80.0}
AGE_TEMP_COEF = 0.55
TEMP_NOISE_SD = 5.5
DEGRADED_COOLING_RATE = 0.12
DEGRADED_COOLING_BUMP = (8.0, 16.0)
MACHINE_TEMP_BOUNDS = (70.0, 115.0)

INDUSTRY_META = {
    "Mining": dict(
        machine_age_b=4.0,
        weather_probs={"Sunny": 0.45, "Cloudy": 0.25, "Rainy": 0.25, "Foggy": 0.05},
        night_prob=0.30,
    ),
    "Construction": dict(
        machine_age_b=4.5,
        weather_probs={"Sunny": 0.45, "Cloudy": 0.25, "Rainy": 0.25, "Foggy": 0.05},
        night_prob=0.25,
    ),
    "Oil & Gas": dict(
        machine_age_b=3.8,
        weather_probs={"Sunny": 0.50, "Cloudy": 0.25, "Rainy": 0.20, "Foggy": 0.05},
        night_prob=0.35,
    ),
    "Data Center Power": dict(
        machine_age_b=6.5,
        weather_probs={"Sunny": 0.55, "Cloudy": 0.30, "Rainy": 0.12, "Foggy": 0.03},
        night_prob=0.38,
    ),
    "Marine & Rail": dict(
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

        # Task Complexity: derived from a hidden work quantity, NOT drawn as
        # noise. Two jobs of the same task type now differ in complexity
        # because they differ in size, which is the whole point -- a 2,400 m3
        # excavation is not the same job as a 120 m3 one.
        # work_quantity stays internal and is never written to the CSV.
        work_quantity = np.empty(n)
        complexity = np.empty(n, dtype=int)
        for i in range(n):
            tt = chosen_tasks[i]
            q = sample_quantity(rng, industry, tt)
            work_quantity[i] = q
            complexity[i] = derive_complexity(industry, tt, q, rng=rng, jitter=True)

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

        # Machine Temperature: engine/coolant operating temperature of the
        # machine running the task. Duty class comes from the task type (which
        # determines the machine type); older machines run hotter, mildly.
        duty_base = np.empty(n)
        for t in task_names:
            t_idx = np.where(chosen_tasks == t)[0]
            if len(t_idx):
                duty_base[t_idx] = DUTY_BASE[TASKS[industry][t]["duty"]]

        machine_temp = duty_base + AGE_TEMP_COEF * machine_age + rng.normal(0, TEMP_NOISE_SD, size=n)
        # A minority of the fleet has degraded cooling. Modelled explicitly so
        # the thermal-derating band above ~105 C is populated in training --
        # the model cannot price a 110 C machine it has never seen, and the
        # roster in dataset_4_machines.csv definitely contains some.
        degraded = rng.random(n) < DEGRADED_COOLING_RATE
        machine_temp = machine_temp + degraded * rng.uniform(*DEGRADED_COOLING_BUMP, size=n)
        machine_temp = np.clip(machine_temp, *MACHINE_TEMP_BOUNDS)

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

        # Thermal effect of the machine's own operating temperature.
        # Two-piece and strictly monotonic increasing:
        #   80-100 C  normal band -- a hotter engine is marginally less
        #             efficient, so a gentle linear slope (not flat, because a
        #             flat region carries no rank information and the Gaussian
        #             copula has nothing to preserve there).
        #   >100 C    thermal derating -- the ECU pulls power and the operator
        #             takes cooldown pauses, so the penalty accelerates.
        # Monotonic by construction. The old ambient version was a symmetric
        # U-shape (cold AND hot both slowed work) and copula synthesis
        # destroyed it; an engine is never "too cold", so this shape is a
        # natural fit rather than a workaround.
        temp_mult = (
            1
            + 0.0012 * np.clip(machine_temp - 80.0, 0, None)
            + 0.0045 * np.clip(machine_temp - 100.0, 0, None) ** 1.35
        )

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
            "Machine Temperature (C)": np.round(machine_temp, 1),
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
