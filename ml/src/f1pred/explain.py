"""SHAP explanations (AC-6): global feature importance + a single prediction.

SHAP supplies the values (the real explainability); plotting is done with the
plain matplotlib OO API so it's robust across shap versions and needs no
display. `shap.TreeExplainer` is exact + deterministic for tree models.
"""

from typing import Any

import numpy as np
import pandas as pd
import shap
from matplotlib.figure import Figure

from f1pred.schema import FEATURE_NAMES


def _features(x: pd.DataFrame) -> pd.DataFrame:
    return x.loc[:, list(FEATURE_NAMES)].astype(float)


def _values(model: Any, x: pd.DataFrame) -> np.ndarray:
    """SHAP value matrix (n_rows, n_features) for the positive class."""
    explanation = shap.TreeExplainer(model)(_features(x))
    vals = np.asarray(explanation.values)
    if vals.ndim == 3:  # (rows, features, classes) → positive class
        vals = vals[:, :, -1]
    return vals


def global_importance(model: Any, x: pd.DataFrame) -> pd.Series:
    """Mean absolute SHAP value per feature, descending."""
    mean_abs = np.abs(_values(model, x)).mean(axis=0)
    return pd.Series(mean_abs, index=list(FEATURE_NAMES)).sort_values(ascending=False)


def one_prediction_shap(model: Any, x_row: pd.DataFrame) -> pd.Series:
    """Signed SHAP contributions per feature for a single row."""
    vals = _values(model, x_row.iloc[:1])
    return pd.Series(vals[0], index=list(FEATURE_NAMES))


def importance_figure(importance: pd.Series) -> Figure:
    fig = Figure(figsize=(5, 3))
    ax = fig.subplots()
    ordered = importance.sort_values()
    ax.barh(ordered.index.astype(str), ordered.to_numpy(), color="#e10600")
    ax.set_xlabel("mean |SHAP|")
    ax.set_title("Global feature importance")
    fig.tight_layout()
    return fig


def one_prediction_figure(contrib: pd.Series) -> Figure:
    fig = Figure(figsize=(5, 3))
    ax = fig.subplots()
    ordered = contrib.reindex(contrib.abs().sort_values().index)
    colors = ["#43b02a" if v >= 0 else "#1e88e5" for v in ordered]
    ax.barh(ordered.index.astype(str), ordered.to_numpy(), color=colors)
    ax.axvline(0, color="grey", linewidth=0.8)
    ax.set_xlabel("SHAP contribution (→ podium)")
    ax.set_title("Single prediction")
    fig.tight_layout()
    return fig
