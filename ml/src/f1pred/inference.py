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
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import pandas as pd

from f1pred.data import RACE_COLUMNS
from f1pred.explain import one_prediction_shap
from f1pred.features import build_features
from f1pred.schema import FEATURE_NAMES, PodiumFeatures

logger = logging.getLogger(__name__)

#: How many of the (six) SHAP contributions to keep per driver for the prompt.
DEFAULT_TOP_N = 3

#: Columns the inference frame must carry alongside the features to identify a
#: driver — they become the DDB key + the frontend label, not model input.
_IDENTITY_COLUMNS = ("driver_number", "driver_code")

#: Columns a `LoadQuali` must return for the just-completed qualifying: driver
#: identity + the three quali-derived passthrough features (the rolling features
#: are computed from history, not supplied here).
QUALI_COLUMNS = [
    "driver_number",
    "driver_code",
    "driver",
    "constructor",
    "circuit",
    "grid_position",
    "quali_gap_to_pole_s",
    "is_wet",
]

#: Shape `build_race_features` returns — exactly what `predict_podium` consumes.
OUTPUT_COLUMNS = ["driver_number", "driver_code", *FEATURE_NAMES]

#: (race_date, round) -> the upcoming race's per-driver quali frame, or None.
LoadQuali = Callable[[str, int], "pd.DataFrame | None"]


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


def build_race_features(
    race_date: str,
    round_number: int,
    *,
    load_quali: LoadQuali,
    history: pd.DataFrame,
) -> pd.DataFrame:
    """Build the six pre-race features for every driver of an upcoming race.

    Three features come straight from the just-completed qualifying (via
    `load_quali`): `grid_position`, `quali_gap_to_pole_s`, `is_wet`. The other
    three are rolling/historical aggregates — so we append the target race (its
    own result unknown) to `history` and run the *same* `build_features` as
    training, which derives `driver_form`/`constructor_form`/`track_history`
    from prior races only (the `.shift(1)` no-leakage guarantee). Reusing one
    feature pipeline for train and inference is the point: no feature drift
    (Constitution III).

    `history` must hold the normalized `RACE_COLUMNS` of past races. Drivers
    without a usable qualifying time are skipped + logged (R-4); drivers with no
    prior history at all are dropped by `build_features` (no signal) and logged.
    Returns `OUTPUT_COLUMNS`; an empty/absent quali yields an empty frame.
    """
    quali = load_quali(race_date, round_number)
    if quali is None or quali.empty:
        logger.warning("no qualifying data for %s round %s", race_date, round_number)
        return pd.DataFrame(columns=OUTPUT_COLUMNS)

    # R-4: a driver who didn't set a qualifying time has no grid/gap → skip + log.
    incomplete = quali[quali["grid_position"].isna() | quali["quali_gap_to_pole_s"].isna()]
    for _, r in incomplete.iterrows():
        logger.warning(
            "skipping driver %s: no qualifying time for %s round %s",
            r.get("driver_code") or r.get("driver"),
            race_date,
            round_number,
        )
    quali = quali.drop(index=incomplete.index)
    if quali.empty:
        return pd.DataFrame(columns=OUTPUT_COLUMNS)

    year = int(race_date[:4])
    target = pd.DataFrame(
        {
            "year": year,
            "round": round_number,
            "driver": quali["driver"].astype(str),
            "constructor": quali["constructor"].astype(str),
            "circuit": quali["circuit"].astype(str),
            "grid_position": quali["grid_position"],
            "quali_gap_to_pole_s": quali["quali_gap_to_pole_s"],
            "is_wet": quali["is_wet"],
            # Inert placeholders: the target race is chronologically last, so
            # build_features' .shift(1) never reads its own result. Real 0.0
            # (not NaN) keeps the column dtype clean for the concat below.
            "points": 0.0,
            "finish_position": 0.0,
        },
        columns=RACE_COLUMNS,
    )

    combined = pd.concat([history.loc[:, RACE_COLUMNS], target], ignore_index=True)
    feats = build_features(combined)
    target_feats = feats[(feats["year"] == year) & (feats["round"] == round_number)]

    # build_features carries only keys + features; re-attach driver identity.
    identity = quali.loc[:, ["driver", "driver_number", "driver_code"]]
    merged = target_feats.merge(identity, on="driver", how="left")

    dropped = set(quali["driver"]) - set(target_feats["driver"])
    for driver in sorted(dropped):
        logger.warning("dropping driver %s: no prior history for %s", driver, race_date)

    return merged.loc[:, OUTPUT_COLUMNS].reset_index(drop=True)


# ─── Default FastF1-backed quali loader (real run only, not in CI) ────────────


def fastf1_load_quali(race_date: str, round_number: int) -> pd.DataFrame | None:
    """Load the just-completed qualifying for an upcoming race as a QUALI_COLUMNS
    frame (the `LoadQuali` the lambda injects). None on missing data; rate limits
    propagate so the caller can back off (mirrors `data.fastf1_load_race`). Not
    exercised in CI — the unit tests inject a fake loader instead."""
    import fastf1  # noqa: PLC0415 — lazy so the module imports without FastF1
    from fastf1.exceptions import RateLimitExceededError  # noqa: PLC0415

    # Reuse the Phase-3 gap/cache helpers — no duplicated quali logic (Const. III).
    from f1pred.data import _enable_cache, _quali_gap_seconds, _to_int  # noqa: PLC0415

    year = int(race_date[:4])
    _enable_cache()
    try:
        quali = fastf1.get_session(year, round_number, "Q")
        quali.load(telemetry=False, weather=True, messages=False)
    except RateLimitExceededError:
        raise
    except Exception as exc:  # noqa: BLE001 — FastF1 raises broadly on missing data
        logger.warning("FastF1 quali load failed for %s round %s: %s", race_date, round_number, exc)
        return None

    qres = getattr(quali, "results", None)
    if qres is None or len(qres) == 0:
        return None

    pole_time = qres["Q3"].dropna().min() if "Q3" in qres else None
    is_wet = bool(getattr(quali, "weather_data", pd.DataFrame()).get("Rainfall", pd.Series()).any())
    circuit = str(quali.event["EventName"])

    rows = []
    for _, r in qres.iterrows():
        code = str(r["Abbreviation"])
        rows.append(
            {
                "driver_number": _to_int(r.get("DriverNumber")),
                "driver_code": code,
                "driver": code,
                "constructor": str(r["TeamName"]),
                "circuit": circuit,
                "grid_position": _to_int(r.get("Position")),  # quali classification
                "quali_gap_to_pole_s": _quali_gap_seconds(quali, code, pole_time),
                "is_wet": is_wet,
            }
        )
    return pd.DataFrame(rows, columns=QUALI_COLUMNS)
