import math

import pandas as pd
from matplotlib.figure import Figure

from f1pred.evaluate import (
    Metrics,
    baseline_grid_top3,
    calibration_figure,
    confusion_figure,
    evaluate,
    rollout_gate,
)
from f1pred.train import train_podium

TrainVal = tuple[pd.DataFrame, pd.Series, pd.DataFrame, pd.Series]


def _metrics(roc_auc: float, log_loss: float) -> Metrics:
    return {
        "accuracy": 0.8,
        "log_loss": log_loss,
        "roc_auc": roc_auc,
        "confusion_matrix": [[1, 0], [0, 1]],
    }


def test_gate_passes_when_candidate_beats_on_both() -> None:
    g = rollout_gate(_metrics(0.95, 0.25), _metrics(0.93, 0.28))
    assert g["passes"] is True
    assert g["roc_auc_delta"] > 0
    assert g["log_loss_delta"] > 0


def test_gate_fails_when_log_loss_worse() -> None:
    # Better AUC but worse (higher) log-loss → no roll-out.
    g = rollout_gate(_metrics(0.95, 0.30), _metrics(0.93, 0.28))
    assert g["passes"] is False
    assert "log-loss" in g["reason"]


def test_gate_fails_when_auc_not_better() -> None:
    g = rollout_gate(_metrics(0.93, 0.25), _metrics(0.93, 0.28))
    assert g["passes"] is False
    assert "ROC-AUC" in g["reason"]


def test_gate_fails_on_nan_auc() -> None:
    g = rollout_gate(_metrics(float("nan"), 0.25), _metrics(0.93, 0.28))
    assert g["passes"] is False
    assert "undefined" in g["reason"]


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
