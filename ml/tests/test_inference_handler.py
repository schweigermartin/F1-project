"""Inference-handler tests — drive handle_inference with fakes, no AWS/FastF1."""

import logging
from datetime import UTC, datetime

import pandas as pd
import pytest
from pydantic import ValidationError

from f1pred.inference_handler import (
    ExplanationKey,
    ExplanationRecord,
    InferenceDeps,
    PredictionRecord,
    handle_inference,
)
from f1pred.train import train_podium

TrainVal = tuple[pd.DataFrame, pd.Series, pd.DataFrame, pd.Series]

EVENT = {"race_date": "2026-06-07", "round": 9, "model_version": "0.1.0"}
FIXED_NOW = datetime(2026, 6, 7, 13, 0, 0, tzinfo=UTC)


def _features(x_val: pd.DataFrame, n: int = 3) -> pd.DataFrame:
    feats = x_val.head(n).copy().reset_index(drop=True)
    feats.insert(0, "driver_number", list(range(1, n + 1)))
    feats.insert(1, "driver_code", [f"D{i:02d}" for i in range(1, n + 1)])
    return feats


class FakeDeps:
    """A recording InferenceDeps; `cached` and `bedrock` are tunable per test."""

    def __init__(self, model: object, features: pd.DataFrame) -> None:
        self._model = model
        self._features = features
        self.predictions: list[PredictionRecord] = []
        self.explanations: dict[ExplanationKey, ExplanationRecord] = {}
        self.cache: dict[ExplanationKey, str] = {}
        self.metrics: list[tuple[str, float]] = []
        self.bedrock_calls = 0
        self.bedrock_should_raise = False

    def _invoke_bedrock(self, system: str, user: str) -> str:
        self.bedrock_calls += 1
        if self.bedrock_should_raise:
            raise RuntimeError("throttled")
        return f"Begründung für: {user.splitlines()[0]}"

    def build(self) -> InferenceDeps:
        return InferenceDeps(
            load_model=lambda _v: self._model,
            load_features=lambda _d, _r: self._features,
            put_prediction=self.predictions.append,
            get_cached_explanation=lambda key: self.cache.get(key),
            invoke_bedrock=self._invoke_bedrock,
            put_explanation=lambda rec: self.explanations.__setitem__(rec.key, rec),
            now=lambda: FIXED_NOW,
            emit_metric=lambda name, value: self.metrics.append((name, value)),
            model_id="claude-haiku-4-5-20251001",
            logger=logging.getLogger("test.inference"),
        )


@pytest.fixture
def deps(train_val: TrainVal) -> FakeDeps:
    x_train, y_train, x_val, y_val = train_val
    model = train_podium(x_train, y_train, x_val, y_val)
    return FakeDeps(model, _features(x_val))


def _metric(deps: FakeDeps, name: str) -> float:
    return sum(v for n, v in deps.metrics if n == name)


def test_cache_miss_writes_predictions_and_calls_bedrock_per_driver(deps: FakeDeps) -> None:
    summary = handle_inference(EVENT, deps.build())

    assert summary.n_drivers == 3
    assert summary.predictions_written == 3
    assert summary.bedrock_calls == 3
    assert summary.cache_hits == 0
    assert len(deps.predictions) == 3
    assert len(deps.explanations) == 3
    assert _metric(deps, "InferenceDrivers") == 3
    assert _metric(deps, "BedrockCalls") == 3


def test_prediction_record_carries_race_context_and_model_version(deps: FakeDeps) -> None:
    handle_inference(EVENT, deps.build())
    rec = deps.predictions[0]
    assert rec.race_date == "2026-06-07"
    assert rec.round == 9
    assert rec.model_version == "0.1.0"
    assert rec.predicted_at == FIXED_NOW.isoformat()
    assert rec.prediction.driver_number == 1


def test_cache_hit_skips_bedrock_entirely(deps: FakeDeps) -> None:
    # Pre-populate the cache for all three drivers.
    for n in (1, 2, 3):
        deps.cache[ExplanationKey("2026-06-07", 9, n, "0.1.0")] = "schon erklärt"

    summary = handle_inference(EVENT, deps.build())

    assert summary.cache_hits == 3
    assert summary.bedrock_calls == 0
    assert deps.bedrock_calls == 0  # AC-3: a second load costs nothing
    assert deps.explanations == {}
    assert summary.predictions_written == 3  # predictions still written
    assert _metric(deps, "BedrockCacheHits") == 3


def test_bedrock_error_never_blocks_the_prediction(deps: FakeDeps) -> None:
    built = deps.build()
    deps.bedrock_should_raise = True

    summary = handle_inference(EVENT, built)

    assert summary.predictions_written == 3  # all predictions persisted
    assert summary.bedrock_errors == 3
    assert summary.bedrock_calls == 0  # none succeeded
    assert deps.explanations == {}  # nothing cached on failure
    assert _metric(deps, "BedrockErrors") == 3


def test_empty_features_yield_zero_drivers_and_a_metric(train_val: TrainVal) -> None:
    x_train, y_train, x_val, y_val = train_val
    model = train_podium(x_train, y_train, x_val, y_val)
    empty = _features(x_val).iloc[0:0]
    fake = FakeDeps(model, empty)

    summary = handle_inference(EVENT, fake.build())

    assert summary.n_drivers == 0
    assert summary.predictions_written == 0
    assert fake.bedrock_calls == 0
    assert _metric(fake, "InferenceDrivers") == 0


def test_invalid_event_is_rejected(deps: FakeDeps) -> None:
    with pytest.raises(ValidationError):
        handle_inference({"round": 9, "model_version": "0.1.0"}, deps.build())


def test_explanation_record_stamps_model_id_and_timestamp(deps: FakeDeps) -> None:
    handle_inference(EVENT, deps.build())
    rec = next(iter(deps.explanations.values()))
    assert rec.model_id == "claude-haiku-4-5-20251001"
    assert rec.cached_at == FIXED_NOW.isoformat()
    assert rec.bedrock_text.startswith("Begründung für: Fahrer:")
