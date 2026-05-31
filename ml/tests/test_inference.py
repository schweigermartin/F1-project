"""Inference core tests — synthetic model + features, no FastF1, no network."""

import pandas as pd
import pytest
from pydantic import ValidationError

from f1pred.inference import DEFAULT_TOP_N, Prediction, predict_podium
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
