import numpy as np
import pandas as pd

from f1pred.schema import FEATURE_NAMES
from f1pred.train import scale_pos_weight, train_podium


def test_scale_pos_weight_is_neg_over_pos() -> None:
    y = pd.Series([1] * 30 + [0] * 170)
    assert scale_pos_weight(y) == 170 / 30


def test_scale_pos_weight_handles_no_positives() -> None:
    assert scale_pos_weight(pd.Series([0, 0, 0])) == 1.0


def test_trains_and_predicts_on_the_feature_columns(
    train_val: tuple[pd.DataFrame, pd.Series, pd.DataFrame, pd.Series],
) -> None:
    x_train, y_train, x_val, y_val = train_val
    model = train_podium(x_train, y_train, x_val, y_val)
    proba = model.predict_proba(x_val.loc[:, list(FEATURE_NAMES)].astype(float))
    assert proba.shape == (len(x_val), 2)


def test_same_seed_gives_the_same_model(
    train_val: tuple[pd.DataFrame, pd.Series, pd.DataFrame, pd.Series],
) -> None:
    x_train, y_train, x_val, y_val = train_val
    feats = x_val.loc[:, list(FEATURE_NAMES)].astype(float)
    a = train_podium(x_train, y_train, x_val, y_val).predict_proba(feats)
    b = train_podium(x_train, y_train, x_val, y_val).predict_proba(feats)
    assert np.array_equal(a, b)
