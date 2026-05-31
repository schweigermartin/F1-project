import math

import pandas as pd
from matplotlib.figure import Figure

from f1pred.evaluate import (
    baseline_grid_top3,
    calibration_figure,
    confusion_figure,
    evaluate,
)
from f1pred.train import train_podium

TrainVal = tuple[pd.DataFrame, pd.Series, pd.DataFrame, pd.Series]


def test_evaluate_reports_all_metrics(train_val: TrainVal) -> None:
    x_train, y_train, x_val, y_val = train_val
    model = train_podium(x_train, y_train, x_val, y_val)
    m = evaluate(model, x_val, y_val)
    assert 0.0 <= m["accuracy"] <= 1.0
    assert m["log_loss"] >= 0.0
    assert 0.0 <= m["roc_auc"] <= 1.0
    assert len(m["confusion_matrix"]) == 2


def test_baseline_predicts_podium_for_grid_top3(train_val: TrainVal) -> None:
    _, _, x_val, y_val = train_val
    m = baseline_grid_top3(x_val, y_val)
    assert 0.0 <= m["accuracy"] <= 1.0
    assert not math.isnan(m["log_loss"])


def test_figures_build_without_a_display(train_val: TrainVal) -> None:
    x_train, y_train, x_val, y_val = train_val
    model = train_podium(x_train, y_train, x_val, y_val)
    m = evaluate(model, x_val, y_val)
    assert isinstance(confusion_figure(m), Figure)
    assert isinstance(calibration_figure(model, x_val, y_val), Figure)
