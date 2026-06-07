"""Shared synthetic fixtures for the model tests (no FastF1, deterministic)."""

import numpy as np
import pandas as pd
import pytest

from f1pred.schema import FEATURE_NAMES


def _make(n: int, seed: int) -> tuple[pd.DataFrame, pd.Series]:
    rng = np.random.default_rng(seed)
    grid = rng.integers(1, 21, n)
    quali_gap = np.abs(rng.normal(0.5, 0.4, n))
    driver_form = rng.uniform(0, 25, n)
    constructor_form = rng.uniform(0, 30, n)
    track_history = rng.uniform(1, 20, n)
    is_wet = rng.integers(0, 2, n).astype(bool)
    # 0.2.0 features (Phase 006).
    quali_segment = rng.integers(1, 4, n)
    grid_delta = rng.integers(-5, 6, n)
    teammate_gap = rng.normal(0, 0.3, n)
    best_pace_gap = np.abs(rng.normal(0.4, 0.3, n))
    long_run_pace = rng.normal(0, 0.4, n)
    laps_count = rng.integers(20, 70, n)
    x = pd.DataFrame(
        {
            "grid_position": grid,
            "quali_gap_to_pole_s": quali_gap,
            "driver_form": driver_form,
            "constructor_form": constructor_form,
            "track_history": track_history,
            "is_wet": is_wet,
            "quali_segment_reached": quali_segment,
            "quali_grid_delta": grid_delta,
            "quali_teammate_gap_s": teammate_gap,
            "practice_best_pace_gap_s": best_pace_gap,
            "practice_long_run_pace_s": long_run_pace,
            "practice_laps_count": laps_count,
        },
        columns=list(FEATURE_NAMES),
    )
    # Podium signal: front of the grid + strong form + good practice pace, noise.
    score = -grid + driver_form / 5 - best_pace_gap * 2 + rng.normal(0, 1.5, n)
    y = pd.Series((score > np.quantile(score, 0.85)).astype(int))
    return x, y


@pytest.fixture
def train_val() -> tuple[pd.DataFrame, pd.Series, pd.DataFrame, pd.Series]:
    x_train, y_train = _make(300, seed=1)
    x_val, y_val = _make(120, seed=2)
    return x_train, y_train, x_val, y_val
