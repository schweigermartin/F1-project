import pandas as pd
from matplotlib.figure import Figure

from f1pred.explain import (
    global_importance,
    importance_figure,
    one_prediction_figure,
    one_prediction_shap,
)
from f1pred.schema import FEATURE_NAMES
from f1pred.train import train_podium

TrainVal = tuple[pd.DataFrame, pd.Series, pd.DataFrame, pd.Series]


def test_global_importance_covers_all_features_non_negative(train_val: TrainVal) -> None:
    x_train, y_train, x_val, y_val = train_val
    model = train_podium(x_train, y_train, x_val, y_val)
    imp = global_importance(model, x_val)
    assert set(imp.index) == set(FEATURE_NAMES)
    assert (imp >= 0).all()


def test_one_prediction_shap_has_one_value_per_feature(train_val: TrainVal) -> None:
    x_train, y_train, x_val, y_val = train_val
    model = train_podium(x_train, y_train, x_val, y_val)
    contrib = one_prediction_shap(model, x_val)
    assert list(contrib.index) == list(FEATURE_NAMES)
    assert contrib.notna().all()


def test_figures_build(train_val: TrainVal) -> None:
    x_train, y_train, x_val, y_val = train_val
    model = train_podium(x_train, y_train, x_val, y_val)
    assert isinstance(importance_figure(global_importance(model, x_val)), Figure)
    assert isinstance(one_prediction_figure(one_prediction_shap(model, x_val)), Figure)
