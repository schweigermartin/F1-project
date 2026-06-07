"""Evaluation metrics + the grid-top-3 baseline + plot figures (AC-5).

The model only earns its keep if it beats "podium = started in the top 3", so
every metric is reported for both. Figures are built via the object-oriented
matplotlib API (no pyplot global state / display needed).
"""

import math
from typing import Any, TypedDict

import numpy as np
import pandas as pd
from matplotlib.figure import Figure
from sklearn.calibration import calibration_curve
from sklearn.metrics import accuracy_score, confusion_matrix, log_loss, roc_auc_score

from f1pred.schema import FEATURE_NAMES

_EPS = 1e-6


class Metrics(TypedDict):
    accuracy: float
    log_loss: float
    roc_auc: float
    confusion_matrix: list[list[int]]


class GateResult(TypedDict):
    passes: bool
    roc_auc_delta: float  # candidate - incumbent (higher is better)
    log_loss_delta: float  # incumbent - candidate (positive = candidate better)
    reason: str


def _metrics(y_true: pd.Series, y_pred: Any, y_proba: Any) -> Metrics:
    proba = np.clip(y_proba, _EPS, 1 - _EPS)
    n_classes = len(np.unique(y_true))
    return {
        "accuracy": float(accuracy_score(y_true, y_pred)),
        "log_loss": float(log_loss(y_true, proba, labels=[0, 1])),
        # AUC is undefined with a single class present (e.g. a tiny test slice).
        "roc_auc": float(roc_auc_score(y_true, y_proba)) if n_classes == 2 else float("nan"),
        "confusion_matrix": confusion_matrix(y_true, y_pred, labels=[0, 1]).tolist(),
    }


def _features(x: pd.DataFrame) -> pd.DataFrame:
    return x.loc[:, list(FEATURE_NAMES)].astype(float)


def evaluate(model: Any, x_test: pd.DataFrame, y_test: pd.Series) -> Metrics:
    """Metrics for the trained model on the test fold."""
    proba = model.predict_proba(_features(x_test))[:, 1]
    pred = (proba >= 0.5).astype(int)
    return _metrics(y_test, pred, proba)


def baseline_grid_top3(x_test: pd.DataFrame, y_test: pd.Series) -> Metrics:
    """Baseline: predict podium iff the driver started in the top 3."""
    pred = (x_test["grid_position"] <= 3).astype(int)
    return _metrics(y_test, pred, pred.astype(float))


def rollout_gate(candidate: Metrics, incumbent: Metrics) -> GateResult:
    """Roll-out gate (AC-4): the candidate model (0.2.0) goes live only if it beats
    the incumbent (0.1.0) on the **same test fold** at **both** ROC-AUC (higher is
    better) **and** log-loss (lower is better). More features must earn their keep;
    a NaN AUC (single-class slice) never passes.

    Returns the deltas and a human-readable reason for the notebook + model card.
    """
    roc_delta = candidate["roc_auc"] - incumbent["roc_auc"]
    log_loss_delta = incumbent["log_loss"] - candidate["log_loss"]

    auc_valid = not (math.isnan(candidate["roc_auc"]) or math.isnan(incumbent["roc_auc"]))
    auc_better = auc_valid and roc_delta > 0
    log_loss_better = log_loss_delta > 0
    passes = bool(auc_better and log_loss_better)

    if not auc_valid:
        reason = "ROC-AUC undefined (single-class fold) — gate fails by default"
    elif passes:
        reason = (
            f"candidate wins: ROC-AUC +{roc_delta:.4f}, log-loss -{log_loss_delta:.4f}"
        )
    else:
        parts = []
        if not auc_better:
            parts.append(f"ROC-AUC {roc_delta:+.4f}")
        if not log_loss_better:
            parts.append(f"log-loss {-log_loss_delta:+.4f}")
        reason = "candidate does not beat incumbent on " + " and ".join(parts) + " — keep incumbent"

    return {
        "passes": passes,
        "roc_auc_delta": roc_delta,
        "log_loss_delta": log_loss_delta,
        "reason": reason,
    }


def confusion_figure(metrics: Metrics, *, title: str = "Confusion matrix") -> Figure:
    cm = np.array(metrics["confusion_matrix"])
    fig = Figure(figsize=(3.2, 3))
    ax = fig.subplots()
    ax.imshow(cm, cmap="Reds")
    ax.set_xticks([0, 1], ["no podium", "podium"])
    ax.set_yticks([0, 1], ["no podium", "podium"])
    ax.set_xlabel("predicted")
    ax.set_ylabel("actual")
    ax.set_title(title)
    for (i, j), v in np.ndenumerate(cm):
        ax.text(j, i, str(int(v)), ha="center", va="center")
    return fig


def calibration_figure(model: Any, x_test: pd.DataFrame, y_test: pd.Series) -> Figure:
    proba = model.predict_proba(_features(x_test))[:, 1]
    frac_pos, mean_pred = calibration_curve(y_test, proba, n_bins=10, strategy="quantile")
    fig = Figure(figsize=(4, 4))
    ax = fig.subplots()
    ax.plot([0, 1], [0, 1], "--", color="grey", label="perfect")
    ax.plot(mean_pred, frac_pos, marker="o", label="model")
    ax.set_xlabel("predicted probability")
    ax.set_ylabel("observed frequency")
    ax.set_title("Calibration")
    ax.legend()
    return fig
