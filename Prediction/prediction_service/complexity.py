"""Work quantity -> Task Complexity.

This module is the single definition of the quantity->complexity mapping. It is
imported by BOTH sides of the system:

  * data generation  (scripts/generate_seed.py, PLAN.md 4.4) -- jitter=True
  * inference        (the prediction service)                -- jitter=False

Keeping one definition is the whole point: if generation and serving derive
complexity differently, the model is trained on a feature the runtime cannot
reproduce.

Units are per (Industry, Task Type) and are NOT interchangeable across task
types. A raw quantity is therefore meaningless on its own -- it is only
comparable after normalisation against its own task type's range, which is what
size_score does.

VOLUME invariant
----------------
For every entry, "typical" sits at (approximately) the geometric mean of "low"
and "high". That is deliberate: size_score is a log-scale position between low
and high, so a geometric-mean typical lands at size_score ~ 0.5, i.e. a
typical-sized job scores mid-complexity for its own task type.
check_volume_table() asserts this holds.
"""

from __future__ import annotations

import math

import numpy as np

# ----------------------------------------------------------------------
# Per (Industry, Task Type) work volume ranges.
#   low     smallest job normally contracted
#   typical the ordinary job -- roughly the base duration used in TASKS
#   high    largest job normally contracted as a single task
# ----------------------------------------------------------------------
VOLUME = {
    "Mining": {
        "Drilling":             dict(unit="m drilled", low=40,  typical=150,  high=500),
        "Hauling Ore":          dict(unit="tonnes",    low=150, typical=550,  high=2000),
        "Surface Excavation":   dict(unit="m3",        low=400, typical=1550, high=6000),
        "Aggregate Collection": dict(unit="tonnes",    low=80,  typical=310,  high=1200),
    },
    "Construction": {
        "Site Preparation": dict(unit="m2",     low=800, typical=4000, high=20000),
        "Excavation":       dict(unit="m3",     low=100, typical=500,  high=2500),
        "Road Building":    dict(unit="km",     low=0.3, typical=1.35, high=6.0),
        "Foundation Work":  dict(unit="m3",     low=15,  typical=67,   high=300),
        "Material Loading": dict(unit="tonnes", low=50,  typical=212,  high=900),
        "Demolition":       dict(unit="m3",     low=80,  typical=346,  high=1500),
    },
    "Oil & Gas": {
        "Well Drilling":           dict(unit="m drilled",   low=40,  typical=155, high=600),
        "Well Servicing":          dict(unit="m tubing",    low=150, typical=600, high=2400),
        "Pipeline Pumping":        dict(unit="m3",          low=100, typical=447, high=2000),
        "Gas Compression Service": dict(unit="service pts", low=4,   typical=14,  high=50),
    },
    "Data Center Power": {
        "Generator Maintenance":      dict(unit="service pts", low=5,   typical=17,   high=60),
        "Backup Generator Testing":   dict(unit="kW tested",   low=200, typical=800,  high=3200),
        "Emergency Power Deployment": dict(unit="kW deployed", low=250, typical=1000, high=4000),
        "Cooling System Inspection":  dict(unit="units",       low=2,   typical=8,    high=30),
    },
    "Marine & Rail": {
        "Freight Operations":      dict(unit="tonnes",      low=250, typical=1225, high=6000),
        "Locomotive Maintenance":  dict(unit="service pts", low=6,   typical=20,   high=70),
        "Rail Network Inspection": dict(unit="km track",    low=3,   typical=14.5, high=70),
        "Tugboat Engine Service":  dict(unit="service pts", low=5,   typical=16.6, high=55),
    },
}

# Intrinsic difficulty of the task itself, independent of how much of it there
# is. Scaled 0..1. Tracks the skill-sensitivity and equipment intensity encoded
# in the skill / equip flags of TASKS in generate_seed.py.
TASK_DIFFICULTY = {
    "Mining": {
        "Drilling": 0.70, "Hauling Ore": 0.30,
        "Surface Excavation": 0.60, "Aggregate Collection": 0.25,
    },
    "Construction": {
        "Site Preparation": 0.35, "Excavation": 0.55, "Road Building": 0.65,
        "Foundation Work": 0.75, "Material Loading": 0.20, "Demolition": 0.70,
    },
    "Oil & Gas": {
        "Well Drilling": 0.90, "Well Servicing": 0.75,
        "Pipeline Pumping": 0.35, "Gas Compression Service": 0.60,
    },
    "Data Center Power": {
        "Generator Maintenance": 0.55, "Backup Generator Testing": 0.35,
        "Emergency Power Deployment": 0.80, "Cooling System Inspection": 0.25,
    },
    "Marine & Rail": {
        "Freight Operations": 0.40, "Locomotive Maintenance": 0.65,
        "Rail Network Inspection": 0.35, "Tugboat Engine Service": 0.60,
    },
}

# Baseline operating difficulty of the industry: regulatory load, hazard class,
# consequence of error. Scaled 0..1, weighted lightly (0.10).
INDUSTRY_DIFFICULTY = {
    "Oil & Gas": 0.85,
    "Data Center Power": 0.65,
    "Mining": 0.60,
    "Marine & Rail": 0.55,
    "Construction": 0.50,
}

# Complexity decomposition weights. See PLAN.md 4.4.
W_SIZE = 0.60
W_TASK = 0.30
W_INDUSTRY = 0.10
JITTER_SIGMA = 0.045

# Task Type -> Industry. All 22 task-type names are globally unique, so this
# inverts VOLUME unambiguously.
TASK_TYPE_INDUSTRY = {
    task_type: industry
    for industry, tasks in VOLUME.items()
    for task_type in tasks
}


def industry_of(task_type: str) -> str:
    """Industry owning a task type."""
    try:
        return TASK_TYPE_INDUSTRY[task_type]
    except KeyError:
        raise KeyError(f"unknown task type: {task_type!r}") from None


def volume_spec(industry: str, task_type: str) -> dict:
    """The (unit, low, typical, high) record for one task type."""
    try:
        return VOLUME[industry][task_type]
    except KeyError:
        raise KeyError(f"no volume spec for ({industry!r}, {task_type!r})") from None


def size_score(industry: str, task_type: str, quantity: float) -> float:
    """Where quantity sits between low and high, on a log scale, in 0..1.

    Log rather than linear because job sizes span an order of magnitude or
    more: 100 -> 200 m3 is a far bigger step in effort terms than
    2300 -> 2400 m3.
    """
    spec = volume_spec(industry, task_type)
    lo, hi = spec["low"], spec["high"]
    if quantity <= 0:
        raise ValueError(f"quantity must be positive, got {quantity}")
    return float(np.clip(math.log(quantity / lo) / math.log(hi / lo), 0.0, 1.0))


def derive_complexity(industry, task_type, quantity, rng=None, jitter=True) -> int:
    """Task Complexity 1..10 from how much work there is, what the work is, and
    where it is being done.

    jitter MUST be False at inference time. The noise term models unmodelled
    site-to-site variation during DATA GENERATION only; left on at serve time
    the same contract returns a different complexity -- and therefore a
    different predicted duration -- on every call.
    """
    if jitter and rng is None:
        raise ValueError("jitter=True requires an rng")

    if industry not in TASK_DIFFICULTY:
        raise ValueError(
            f"unknown industry {industry!r}; known: {sorted(TASK_DIFFICULTY)}")
    if task_type not in TASK_DIFFICULTY[industry]:
        raise ValueError(
            f"unknown task type {task_type!r} for industry {industry!r}; "
            f"known: {sorted(TASK_DIFFICULTY[industry])}")

    raw = (
        W_SIZE * size_score(industry, task_type, quantity)
        + W_TASK * TASK_DIFFICULTY[industry][task_type]
        + W_INDUSTRY * INDUSTRY_DIFFICULTY[industry]
    )
    if jitter:
        raw = raw + rng.normal(0, JITTER_SIGMA)
    return int(np.clip(round(1 + 9 * raw), 1, 10))


def sample_quantity(rng, industry: str, task_type: str) -> float:
    """Draw a plausible job size for a task type.

    Lognormal centred on typical, with sigma set so +/-2 sigma spans
    [low, high]. That puts ~95% of draws inside the contracted range and makes
    size_score approximately Normal(0.5, 0.25) before clipping.
    """
    spec = volume_spec(industry, task_type)
    lo, hi, typ = spec["low"], spec["high"], spec["typical"]
    sigma = math.log(hi / lo) / 4.0
    q = math.exp(rng.normal(math.log(typ), sigma))
    return float(np.clip(q, lo, hi))


# Units that count discrete things. A quantity in one of these must be a whole
# number -- "8.58 service points" is not a quantity anyone can contract for.
COUNT_UNITS = {"service pts", "units"}


def round_quantity(quantity: float, unit: str | None = None) -> float:
    """Present a quantity at a sane precision for its unit and magnitude."""
    if unit in COUNT_UNITS:
        return float(max(1, round(quantity)))
    if quantity >= 1000:
        return float(round(quantity, -1))
    if quantity >= 100:
        return float(round(quantity))
    if quantity >= 10:
        return float(round(quantity, 1))
    return float(round(quantity, 2))


def check_volume_table(tolerance: float = 0.12) -> None:
    """Assert the geometric-mean invariant, so a hand-edited row cannot quietly
    skew its task type's complexity."""
    problems = []
    for industry, tasks in VOLUME.items():
        for task_type, spec in tasks.items():
            lo, typ, hi = spec["low"], spec["typical"], spec["high"]
            if not lo < typ < hi:
                problems.append(f"{industry}/{task_type}: not low < typical < high")
                continue
            observed = math.log(typ / lo) / math.log(hi / lo)
            if abs(observed - 0.5) > tolerance:
                problems.append(
                    f"{industry}/{task_type}: typical sits at size_score "
                    f"{observed:.3f}, expected ~0.50"
                )
    if problems:
        raise AssertionError(
            "VOLUME table invariant violated:\n  " + "\n  ".join(problems)
        )


if __name__ == "__main__":
    check_volume_table()
    print(
        f"VOLUME table OK: {len(TASK_TYPE_INDUSTRY)} task types "
        f"across {len(VOLUME)} industries."
    )
