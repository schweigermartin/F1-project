"""End-to-end orchestration: races frame → trained model + metrics + card.

Kept here (not in the notebook) so the wiring is unit-tested offline against
synthetic races; the notebook is a thin caller (T11).
"""

from dataclasses import dataclass
from typing import Any

import pandas as pd

from f1pred.artifact import ModelCardMeta, render_model_card
from f1pred.evaluate import Metrics, baseline_grid_top3, evaluate
from f1pred.explain import global_importance
from f1pred.features import build_features
from f1pred.schema import FEATURE_NAMES
from f1pred.split import temporal_split
from f1pred.target import podium_label

_TARGET = "podium"


@dataclass(frozen=True)
class PipelineResult:
    model: Any
    metrics: Metrics
    baseline: Metrics
    importance: pd.Series
    card_text: str
    n_train: int
    n_test: int


def run_pipeline(
    races: pd.DataFrame,
    *,
    train_max_year: int,
    val_year: int,
    test_year: int,
    version: str,
    fastf1_version: str = "unknown",
    limitations: str = (
        "Imbalanced target (~15% podium); FastF1 gaps dropped, not imputed; "
        "no live-session signal yet (Phase 5)."
    ),
    early_stopping_rounds: int = 30,
) -> PipelineResult:
    """Build features, split temporally, train, evaluate vs baseline, render card."""
    # Lazy import so the heavy xgboost dep isn't pulled unless we actually train.
    from f1pred.train import train_podium

    features = build_features(races)
    target = podium_label(races, position_col="finish_position").reindex(features.index)
    data = features.assign(**{_TARGET: target})

    split = temporal_split(
        data, train_max_year=train_max_year, val_year=val_year, test_year=test_year
    )
    cols = list(FEATURE_NAMES)
    model = train_podium(
        split.train[cols],
        split.train[_TARGET],
        split.val[cols],
        split.val[_TARGET],
        early_stopping_rounds=early_stopping_rounds,
    )

    metrics = evaluate(model, split.test[cols], split.test[_TARGET])
    baseline = baseline_grid_top3(split.test, split.test[_TARGET])
    importance = global_importance(model, split.test)

    card = render_model_card(
        ModelCardMeta(
            version=version,
            seasons=f"train ≤{train_max_year}, val {val_year}, test {test_year}",
            fastf1_version=fastf1_version,
            n_train=len(split.train),
            n_test=len(split.test),
            metrics=metrics,
            baseline=baseline,
            top_features=[(str(k), float(v)) for k, v in importance.head(6).items()],
            limitations=limitations,
        )
    )
    return PipelineResult(
        model=model,
        metrics=metrics,
        baseline=baseline,
        importance=importance,
        card_text=card,
        n_train=len(split.train),
        n_test=len(split.test),
    )
