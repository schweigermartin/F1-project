"""Inference core (Phase 4): pre-race features → per-driver podium predictions.

Reuses the Phase-3 contract end-to-end (Constitution III): `FEATURE_NAMES` /
`PodiumFeatures` for the schema, the trained model's `predict_proba` for the
probability (AC-5 — the number comes from the model, never the LLM) and
`explain.one_prediction_shap` for the per-driver SHAP contributions that the
Bedrock prompt later turns into prose.

The identical feature order to training is the whole point: a column out of
order is a silent mis-prediction, so a missing feature fails loudly here
(Constitution VI) rather than reaching the model.
"""

import logging
from dataclasses import dataclass
from typing import Any

import pandas as pd

from f1pred.explain import one_prediction_shap
from f1pred.schema import FEATURE_NAMES, PodiumFeatures

logger = logging.getLogger(__name__)

#: How many of the (six) SHAP contributions to keep per driver for the prompt.
DEFAULT_TOP_N = 3

#: Columns the inference frame must carry alongside the features to identify a
#: driver — they become the DDB key + the frontend label, not model input.
_IDENTITY_COLUMNS = ("driver_number", "driver_code")


@dataclass(frozen=True)
class ShapContribution:
    """One signed SHAP contribution for a (driver, feature). Positive pushes the
    driver toward the podium, negative away. Mirrors the TS `ShapContribution`
    in `@f1/shared/prediction-schema` (Constitution III)."""

    feature: str
    contribution: float


@dataclass(frozen=True)
class Prediction:
    """One driver's podium prediction — maps 1:1 onto the DDB `prediction#<N>`
    item and the shared `PredictionItemSchema`."""

    driver_number: int
    driver_code: str
    podium_probability: float
    shap_top: list[ShapContribution]


def _feature_matrix(features: pd.DataFrame) -> pd.DataFrame:
    """The FEATURE_NAMES columns in canonical order, numeric (is_wet→0/1).

    Raises on schema drift (a missing feature) so a model/feature mismatch fails
    loudly instead of silently mis-predicting (Constitution VI).
    """
    missing = [name for name in FEATURE_NAMES if name not in features.columns]
    if missing:
        raise ValueError(f"feature columns missing for inference: {missing}")
    return features.loc[:, list(FEATURE_NAMES)].astype(float)


def _validate_row(row: pd.Series) -> None:
    """Validate one feature row against the pre-race contract before it reaches
    the model — out-of-range values (e.g. grid_position 0) fail loudly."""
    PodiumFeatures(
        grid_position=int(row["grid_position"]),
        quali_gap_to_pole_s=float(row["quali_gap_to_pole_s"]),
        driver_form=float(row["driver_form"]),
        constructor_form=float(row["constructor_form"]),
        track_history=float(row["track_history"]),
        is_wet=bool(row["is_wet"]),
    )


def predict_podium(
    model: Any, features: pd.DataFrame, *, top_n: int = DEFAULT_TOP_N
) -> list[Prediction]:
    """Predict P(podium) + the top-N SHAP contributions for every driver row.

    `features` must carry the `_IDENTITY_COLUMNS` plus the six `FEATURE_NAMES`
    (the order of other columns is irrelevant — the matrix is reselected). Rows
    are validated against `PodiumFeatures` first; an out-of-range value raises.
    The probability is taken from `model.predict_proba` (AC-5), the SHAP values
    from the same model. An empty frame yields an empty list.
    """
    if features.empty:
        return []

    missing_id = [c for c in _IDENTITY_COLUMNS if c not in features.columns]
    if missing_id:
        raise ValueError(f"identity columns missing for inference: {missing_id}")

    matrix = _feature_matrix(features)
    proba = model.predict_proba(matrix)[:, 1]  # positive class = podium

    predictions: list[Prediction] = []
    for i, (_, row) in enumerate(features.iterrows()):
        _validate_row(row)
        # One TreeExplainer call per driver — exact, and cheap at ~20 rows/race.
        contrib = one_prediction_shap(model, features.iloc[[i]])
        top = contrib.reindex(contrib.abs().sort_values(ascending=False).index).head(top_n)
        shap_top = [
            ShapContribution(feature=str(name), contribution=float(val))
            for name, val in top.items()
        ]
        predictions.append(
            Prediction(
                driver_number=int(row["driver_number"]),
                driver_code=str(row["driver_code"]),
                podium_probability=float(proba[i]),
                shap_top=shap_top,
            )
        )

    logger.info("predicted %d drivers (top_n=%d)", len(predictions), top_n)
    return predictions
