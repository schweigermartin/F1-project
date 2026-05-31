"""Pure inference-lambda orchestration (Phase 4).

Separated from the AWS adapter (infra/lambda/inference/, T7) so it's unit-tested
with fakes — no boto3, no FastF1, no Bedrock — the same `handler.ts`-pure +
`index.ts`-adapter split as the Phase-1/2 lambdas, in Python. The adapter injects
real clients via `InferenceDeps`; here everything is a callable.

Flow per EventBridge trigger `{ race_date, round, model_version }`:
  1. load the model artifact for the event's version,
  2. build the race's pre-race features → predict P(podium) + SHAP per driver,
  3. persist every prediction,
  4. for drivers without a cached explanation, prompt Bedrock and cache the text.

A Bedrock failure never blocks a prediction (AC-3 / plan §2): the probability is
already stored; the explanation simply retries on the next trigger.
"""

import logging
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import pandas as pd
from pydantic import BaseModel, Field

from f1pred.bedrock_prompt import SYSTEM_PROMPT, build_explanation_prompt
from f1pred.inference import Prediction, predict_podium


class InferenceEvent(BaseModel):
    """The EventBridge payload that triggers one race's inference."""

    model_config = {"extra": "forbid"}

    race_date: str  # ISO date, e.g. "2026-06-07"
    round: int = Field(ge=1)
    model_version: str  # SemVer of the artifact under models/<version>/


@dataclass(frozen=True)
class ExplanationKey:
    """Identifies a cached explanation. Keyed by model_version so a re-trained
    model gets a fresh explanation rather than a stale cache hit (AC-3)."""

    race_date: str
    round: int
    driver_number: int
    model_version: str


@dataclass(frozen=True)
class PredictionRecord:
    """A prediction plus the race context the adapter needs to build the DDB
    item + key (key construction lives in the adapter, T7)."""

    race_date: str
    round: int
    model_version: str
    predicted_at: str
    prediction: Prediction


@dataclass(frozen=True)
class ExplanationRecord:
    """A cached Bedrock explanation plus its key."""

    key: ExplanationKey
    bedrock_text: str
    model_id: str
    cached_at: str


@dataclass
class InferenceDeps:
    """Injected boundary — real implementations wired by the adapter (T7)."""

    load_model: Callable[[str], Any]  # model_version -> fitted model
    load_features: Callable[[str, int], pd.DataFrame]  # (race_date, round) -> features
    put_prediction: Callable[[PredictionRecord], None]
    get_cached_explanation: Callable[[ExplanationKey], str | None]
    invoke_bedrock: Callable[[str, str], str]  # (system, user) -> explanation text
    put_explanation: Callable[[ExplanationRecord], None]
    now: Callable[[], Any]  # -> datetime (kept Any: only .isoformat() is used)
    emit_metric: Callable[[str, float], None]
    model_id: str  # the Bedrock model id stamped onto cached explanations
    logger: logging.Logger


@dataclass(frozen=True)
class InferenceSummary:
    """Structured outcome of one run — logged + returned for tests/observability."""

    race_date: str
    round: int
    model_version: str
    n_drivers: int
    predictions_written: int
    bedrock_calls: int
    cache_hits: int
    bedrock_errors: int


def handle_inference(event: dict[str, Any], deps: InferenceDeps) -> InferenceSummary:
    """Run inference for one race and cache the explanations. Pure given `deps`."""
    ev = InferenceEvent.model_validate(event)
    log = deps.logger

    model = deps.load_model(ev.model_version)
    features = deps.load_features(ev.race_date, ev.round)
    predictions = predict_podium(model, features)
    deps.emit_metric("InferenceDrivers", float(len(predictions)))

    if not predictions:
        # No drivers (e.g. no quali yet). Loud + a metric so the silence alarm
        # (T9) can tell "ran but produced nothing" from "never triggered".
        log.warning(
            "inference produced no predictions for %s round %s (version %s)",
            ev.race_date,
            ev.round,
            ev.model_version,
        )
        return _summary(ev, n_drivers=0, written=0, calls=0, hits=0, errors=0)

    predicted_at = deps.now().isoformat()
    written = calls = hits = errors = 0

    for pred in predictions:
        deps.put_prediction(
            PredictionRecord(ev.race_date, ev.round, ev.model_version, predicted_at, pred)
        )
        written += 1

        key = ExplanationKey(ev.race_date, ev.round, pred.driver_number, ev.model_version)
        if deps.get_cached_explanation(key) is not None:
            hits += 1
            continue  # AC-3: a cached explanation costs zero Bedrock calls.

        user_prompt = build_explanation_prompt(
            pred.driver_code, pred.podium_probability, pred.shap_top
        )
        try:
            text = deps.invoke_bedrock(SYSTEM_PROMPT, user_prompt)
        except Exception as exc:  # noqa: BLE001 — Bedrock must never block a prediction
            errors += 1
            deps.emit_metric("BedrockErrors", 1.0)
            log.warning("bedrock failed for driver %s: %s", pred.driver_number, exc)
            continue

        calls += 1
        deps.emit_metric("BedrockCalls", 1.0)
        deps.put_explanation(
            ExplanationRecord(key, text, deps.model_id, deps.now().isoformat())
        )

    deps.emit_metric("BedrockCacheHits", float(hits))
    summary = _summary(
        ev, n_drivers=len(predictions), written=written, calls=calls, hits=hits, errors=errors
    )
    log.info(
        "inference complete: race=%s round=%s version=%s drivers=%d "
        "written=%d bedrock_calls=%d cache_hits=%d bedrock_errors=%d",
        summary.race_date,
        summary.round,
        summary.model_version,
        summary.n_drivers,
        summary.predictions_written,
        summary.bedrock_calls,
        summary.cache_hits,
        summary.bedrock_errors,
    )
    return summary


def _summary(
    ev: InferenceEvent, *, n_drivers: int, written: int, calls: int, hits: int, errors: int
) -> InferenceSummary:
    return InferenceSummary(
        race_date=ev.race_date,
        round=ev.round,
        model_version=ev.model_version,
        n_drivers=n_drivers,
        predictions_written=written,
        bedrock_calls=calls,
        cache_hits=hits,
        bedrock_errors=errors,
    )
