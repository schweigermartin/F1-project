"""XGBoost podium classifier.

Fixed seed + single-threaded for reproducibility (AC-8), `scale_pos_weight` for
the ~15% class imbalance (AC-4), a documented default hyper-parameter set, and
early stopping on the validation fold.
"""

from typing import Any

import pandas as pd
from xgboost import XGBClassifier

from f1pred.schema import FEATURE_NAMES

RANDOM_STATE = 42

#: Modest, documented defaults — no large HP search (spec Out of Scope).
DEFAULT_PARAMS: dict[str, Any] = {
    "n_estimators": 400,
    "max_depth": 4,
    "learning_rate": 0.05,
    "subsample": 0.8,
    "colsample_bytree": 0.8,
    "min_child_weight": 2,
    "eval_metric": "logloss",
    "tree_method": "hist",
    "random_state": RANDOM_STATE,
    "n_jobs": 1,  # single-threaded → deterministic (AC-8)
}


def scale_pos_weight(y: pd.Series) -> float:
    """neg/pos ratio to counter the podium imbalance; 1.0 if no positives."""
    pos = int((y == 1).sum())
    neg = int((y == 0).sum())
    return neg / pos if pos else 1.0


def _matrix(x: pd.DataFrame) -> pd.DataFrame:
    """Select features in the canonical order and make them numeric (is_wet→0/1)."""
    return x.loc[:, list(FEATURE_NAMES)].astype(float)


def train_podium(
    x_train: pd.DataFrame,
    y_train: pd.Series,
    x_val: pd.DataFrame,
    y_val: pd.Series,
    *,
    params: dict[str, Any] | None = None,
    early_stopping_rounds: int = 30,
) -> XGBClassifier:
    """Train and return a fitted XGBClassifier on the FEATURE_NAMES columns."""
    merged = {**DEFAULT_PARAMS, **(params or {})}
    model = XGBClassifier(
        **merged,
        scale_pos_weight=scale_pos_weight(y_train),
        early_stopping_rounds=early_stopping_rounds,
    )
    model.fit(
        _matrix(x_train),
        y_train,
        eval_set=[(_matrix(x_val), y_val)],
        verbose=False,
    )
    return model
