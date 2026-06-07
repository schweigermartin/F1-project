"""Inference core tests — synthetic model + features, no FastF1, no network."""

import logging

import numpy as np
import pandas as pd
import pytest
from pydantic import ValidationError

from f1pred.data import RACE_COLUMNS
from f1pred.inference import (
    DEFAULT_TOP_N,
    OUTPUT_COLUMNS,
    Prediction,
    build_race_features,
    predict_podium,
)
from f1pred.schema import FEATURE_NAMES
from f1pred.train import train_podium

TrainVal = tuple[pd.DataFrame, pd.Series, pd.DataFrame, pd.Series]


def _race_frame(x_val: pd.DataFrame, n: int = 3) -> pd.DataFrame:
    """Take n rows of validation features and attach driver identity columns."""
    feats = x_val.head(n).copy().reset_index(drop=True)
    feats.insert(0, "driver_number", list(range(1, n + 1)))
    feats.insert(1, "driver_code", [f"D{i:02d}" for i in range(1, n + 1)])
    return feats


def _fit(train_val: TrainVal) -> object:
    x_train, y_train, x_val, y_val = train_val
    return train_podium(x_train, y_train, x_val, y_val)


def test_predicts_one_prediction_per_driver_row(train_val: TrainVal) -> None:
    _, _, x_val, _ = train_val
    model = _fit(train_val)
    preds = predict_podium(model, _race_frame(x_val, n=4))

    assert len(preds) == 4
    assert all(isinstance(p, Prediction) for p in preds)
    assert [p.driver_number for p in preds] == [1, 2, 3, 4]
    assert [p.driver_code for p in preds] == ["D01", "D02", "D03", "D04"]


def test_probabilities_are_valid_and_come_from_the_model(train_val: TrainVal) -> None:
    _, _, x_val, _ = train_val
    model = _fit(train_val)
    feats = _race_frame(x_val)
    preds = predict_podium(model, feats)

    for p in preds:
        assert 0.0 <= p.podium_probability <= 1.0
    # AC-5: the probability is the model's, not a re-derivation here.
    expected = model.predict_proba(feats.loc[:, list(FEATURE_NAMES)].astype(float))[:, 1]
    assert [p.podium_probability for p in preds] == pytest.approx(list(expected))


def test_shap_top_is_top_n_known_features_sorted_by_magnitude(train_val: TrainVal) -> None:
    _, _, x_val, _ = train_val
    model = _fit(train_val)
    preds = predict_podium(model, _race_frame(x_val))

    for p in preds:
        assert len(p.shap_top) == DEFAULT_TOP_N
        assert all(c.feature in FEATURE_NAMES for c in p.shap_top)
        mags = [abs(c.contribution) for c in p.shap_top]
        assert mags == sorted(mags, reverse=True)


def test_top_n_is_configurable(train_val: TrainVal) -> None:
    _, _, x_val, _ = train_val
    model = _fit(train_val)
    preds = predict_podium(model, _race_frame(x_val), top_n=2)
    assert all(len(p.shap_top) == 2 for p in preds)


def test_empty_frame_yields_no_predictions(train_val: TrainVal) -> None:
    _, _, x_val, _ = train_val
    model = _fit(train_val)
    preds = predict_podium(model, _race_frame(x_val).iloc[0:0])
    assert preds == []


def test_missing_feature_column_fails_loudly(train_val: TrainVal) -> None:
    _, _, x_val, _ = train_val
    model = _fit(train_val)
    feats = _race_frame(x_val).drop(columns=["is_wet"])
    with pytest.raises(ValueError, match="feature columns missing"):
        predict_podium(model, feats)


def test_missing_identity_column_fails_loudly(train_val: TrainVal) -> None:
    _, _, x_val, _ = train_val
    model = _fit(train_val)
    feats = _race_frame(x_val).drop(columns=["driver_code"])
    with pytest.raises(ValueError, match="identity columns missing"):
        predict_podium(model, feats)


def test_out_of_range_feature_value_is_rejected(train_val: TrainVal) -> None:
    _, _, x_val, _ = train_val
    model = _fit(train_val)
    feats = _race_frame(x_val)
    feats.loc[0, "grid_position"] = 0  # invalid: pole is 1 (PodiumFeatures ge=1)
    with pytest.raises(ValidationError):
        predict_podium(model, feats)


# ─── build_race_features ─────────────────────────────────────────────────────


def _history() -> pd.DataFrame:
    """Five past rounds for VER + HAM on one circuit, so both have form + a
    track record by the upcoming race."""
    rows = []
    for rnd in range(1, 6):
        for driver, team, pts, fin in [("VER", "RB", 25.0, 1.0), ("HAM", "MER", 18.0, 2.0)]:
            rows.append(
                {
                    "year": 2026,
                    "round": rnd,
                    "driver": driver,
                    "constructor": team,
                    "circuit": "Spielberg",
                    "grid_position": 2,
                    "quali_gap_to_pole_s": 0.2,
                    "is_wet": False,
                    "points": pts,
                    "finish_position": fin,
                }
            )
    return pd.DataFrame(rows, columns=RACE_COLUMNS)


def _quali_frame() -> pd.DataFrame:
    """Upcoming round 6 quali: two drivers with history, one rookie (no history),
    one who set no time (NaN gap)."""
    return pd.DataFrame(
        {
            "driver_number": [1, 44, 99, 2],
            "driver_code": ["VER", "HAM", "ROO", "DNQ"],
            "driver": ["VER", "HAM", "ROO", "DNQ"],
            "constructor": ["RB", "MER", "RB", "MER"],
            "circuit": ["Spielberg"] * 4,
            "grid_position": [1, 3, 15, 20],
            "quali_gap_to_pole_s": [0.0, 0.3, 1.1, np.nan],
            "is_wet": [True, True, True, True],
            "quali_segment_reached": [3, 3, 1, 1],
            "quali_grid_delta": [0, 0, 0, 0],
            "quali_teammate_gap_s": [-0.2, 0.1, 0.3, 0.0],
        }
    )


def _practice_frame() -> pd.DataFrame:
    """Upcoming-weekend practice features for the drivers with quali times."""
    return pd.DataFrame(
        {
            "driver_code": ["VER", "HAM", "ROO"],
            "practice_best_pace_gap_s": [0.0, 0.25, 0.9],
            "practice_long_run_pace_s": [-0.3, 0.1, 0.5],
            "practice_laps_count": [62, 60, 58],
        }
    )


def test_build_race_features_returns_output_shape_for_drivers_with_history() -> None:
    feats = build_race_features(
        "2026-06-07", 6, load_quali=lambda _d, _r: _quali_frame(), history=_history()
    )
    assert list(feats.columns) == OUTPUT_COLUMNS
    # VER + HAM survive; ROO (no history) and DNQ (no quali time) do not.
    assert sorted(feats["driver_code"]) == ["HAM", "VER"]
    assert set(feats["driver_number"]) == {1, 44}


def test_build_race_features_passes_quali_values_through() -> None:
    feats = build_race_features(
        "2026-06-07", 6, load_quali=lambda _d, _r: _quali_frame(), history=_history()
    )
    ver = feats[feats["driver_code"] == "VER"].iloc[0]
    assert ver["grid_position"] == 1
    assert ver["quali_gap_to_pole_s"] == 0.0
    assert bool(ver["is_wet"]) is True
    assert ver["quali_segment_reached"] == 3
    assert ver["quali_teammate_gap_s"] == pytest.approx(-0.2)
    # Rolling features come from history (VER scored 25 every prior round).
    assert ver["driver_form"] == pytest.approx(25.0)


def test_build_race_features_merges_live_practice() -> None:
    feats = build_race_features(
        "2026-06-07",
        6,
        load_quali=lambda _d, _r: _quali_frame(),
        history=_history(),
        load_practice=lambda _d, _r: _practice_frame(),
    )
    ver = feats[feats["driver_code"] == "VER"].iloc[0]
    assert ver["practice_best_pace_gap_s"] == pytest.approx(0.0)
    assert ver["practice_long_run_pace_s"] == pytest.approx(-0.3)
    assert ver["practice_laps_count"] == 62


def test_build_race_features_fills_practice_when_absent() -> None:
    from f1pred.features import NEUTRAL_LONG_RUN_GAP, NEUTRAL_PRACTICE_PACE_GAP

    # No load_practice → practice columns missing → filled with neutral constants.
    feats = build_race_features(
        "2026-06-07", 6, load_quali=lambda _d, _r: _quali_frame(), history=_history()
    )
    ver = feats[feats["driver_code"] == "VER"].iloc[0]
    assert ver["practice_best_pace_gap_s"] == pytest.approx(NEUTRAL_PRACTICE_PACE_GAP)
    assert ver["practice_long_run_pace_s"] == pytest.approx(NEUTRAL_LONG_RUN_GAP)
    assert ver["practice_laps_count"] == 0


def test_build_race_features_skips_driver_without_quali_time(
    caplog: pytest.LogCaptureFixture,
) -> None:
    with caplog.at_level(logging.WARNING):
        feats = build_race_features(
            "2026-06-07", 6, load_quali=lambda _d, _r: _quali_frame(), history=_history()
        )
    assert "DNQ" not in set(feats["driver_code"])
    assert any(
        "DNQ" in rec.message and "no qualifying time" in rec.message for rec in caplog.records
    )


def test_build_race_features_logs_driver_without_history(caplog: pytest.LogCaptureFixture) -> None:
    with caplog.at_level(logging.WARNING):
        build_race_features(
            "2026-06-07", 6, load_quali=lambda _d, _r: _quali_frame(), history=_history()
        )
    assert any("ROO" in rec.message and "no prior history" in rec.message for rec in caplog.records)


def test_build_race_features_empty_quali_yields_empty_frame() -> None:
    feats = build_race_features(
        "2026-06-07", 6, load_quali=lambda _d, _r: None, history=_history()
    )
    assert feats.empty
    assert list(feats.columns) == OUTPUT_COLUMNS


def test_build_race_features_feeds_predict_podium(train_val: TrainVal) -> None:
    model = _fit(train_val)
    feats = build_race_features(
        "2026-06-07", 6, load_quali=lambda _d, _r: _quali_frame(), history=_history()
    )
    preds = predict_podium(model, feats)
    assert {p.driver_code for p in preds} == {"VER", "HAM"}
    assert all(0.0 <= p.podium_probability <= 1.0 for p in preds)
