import numpy as np
import pandas as pd

from f1pred.pipeline import run_pipeline


def _synthetic_races(seed: int = 7) -> pd.DataFrame:
    """Three seasons, 10 drivers / 5 teams, circuits repeat so track_history exists."""
    rng = np.random.default_rng(seed)
    drivers = [f"D{i:02d}" for i in range(10)]
    teams = {d: f"T{i // 2}" for i, d in enumerate(drivers)}
    circuits = ["BHR", "JED", "MEL", "IMO", "MIA"]
    rows = []
    for year in (2022, 2023, 2024):
        for rnd in range(1, 11):
            grid = rng.permutation(len(drivers)) + 1  # 1..10
            for d, g in zip(drivers, grid, strict=True):
                finish = int(np.clip(g + rng.integers(-2, 3), 1, len(drivers)))
                rows.append(
                    {
                        "year": year,
                        "round": rnd,
                        "driver": d,
                        "constructor": teams[d],
                        "circuit": circuits[rnd % len(circuits)],
                        "grid_position": int(g),
                        "quali_gap_to_pole_s": float(max(0.0, (g - 1) * 0.15)),
                        "is_wet": bool(rng.integers(0, 2)),
                        "points": float(max(0, 11 - finish)),
                        "finish_position": finish,
                    }
                )
    return pd.DataFrame(rows)


def test_run_pipeline_produces_metrics_and_card() -> None:
    result = run_pipeline(
        _synthetic_races(),
        train_max_year=2022,
        val_year=2023,
        test_year=2024,
        version="0.1.0",
        early_stopping_rounds=10,
    )
    assert result.n_train > 0
    assert result.n_test > 0
    assert 0.0 <= result.metrics["accuracy"] <= 1.0
    assert "Podium Predictor `0.1.0`" in result.card_text
    assert set(result.importance.index)  # importance computed


def test_run_pipeline_is_deterministic() -> None:
    kwargs = {
        "train_max_year": 2022,
        "val_year": 2023,
        "test_year": 2024,
        "version": "0.1.0",
        "early_stopping_rounds": 10,
    }
    a = run_pipeline(_synthetic_races(), **kwargs)  # type: ignore[arg-type]
    b = run_pipeline(_synthetic_races(), **kwargs)  # type: ignore[arg-type]
    assert a.metrics == b.metrics
