"""Pure AWS (de)serialization tests — no boto3, no network."""

from decimal import Decimal

import pytest

from f1pred.aws_io import (
    BEDROCK_ANTHROPIC_VERSION,
    build_bedrock_request,
    explanation_item,
    parse_bedrock_text,
    prediction_item,
)
from f1pred.inference import Prediction, ShapContribution
from f1pred.inference_handler import ExplanationKey, ExplanationRecord, PredictionRecord

PRED = Prediction(
    driver_number=1,
    driver_code="VER",
    podium_probability=0.68,
    shap_top=[ShapContribution("grid_position", 0.31), ShapContribution("is_wet", -0.09)],
)


def test_prediction_item_has_keys_and_decimal_floats() -> None:
    rec = PredictionRecord("2026-06-07", 9, "0.1.0", "2026-06-07T13:00:00+00:00", PRED)
    item = prediction_item(rec)

    assert item["PK"] == "race#2026-06-07#09"
    assert item["SK"] == "prediction#01"
    assert item["driver_code"] == "VER"
    assert item["podium_probability"] == Decimal("0.68")
    assert all(isinstance(c["contribution"], Decimal) for c in item["shap_top"])
    assert item["shap_top"][0] == {"feature": "grid_position", "contribution": Decimal("0.31")}
    assert item["model_version"] == "0.1.0"


def test_explanation_item_shape() -> None:
    key = ExplanationKey("2026-06-07", 9, 44, "0.1.0")
    rec = ExplanationRecord(
        key, "Hamilton ...", "claude-haiku-4-5-20251001", "2026-06-07T13:00:05+00:00"
    )
    item = explanation_item(rec)

    assert item["PK"] == "race#2026-06-07#09"
    assert item["SK"] == "explanation#44"
    assert item["bedrock_text"] == "Hamilton ..."
    assert item["model_id"] == "claude-haiku-4-5-20251001"


def test_build_bedrock_request_is_anthropic_messages_shape() -> None:
    body = build_bedrock_request("SYS", "USER", max_tokens=123)
    assert body["anthropic_version"] == BEDROCK_ANTHROPIC_VERSION
    assert body["max_tokens"] == 123
    assert body["system"] == "SYS"
    assert body["messages"] == [{"role": "user", "content": [{"type": "text", "text": "USER"}]}]


def test_parse_bedrock_text_joins_text_blocks() -> None:
    body = {
        "content": [
            {"type": "text", "text": "Satz eins. "},
            {"type": "text", "text": "Satz zwei."},
        ]
    }
    assert parse_bedrock_text(body) == "Satz eins. Satz zwei."


def test_parse_bedrock_text_raises_on_empty_content() -> None:
    with pytest.raises(ValueError, match="no text content"):
        parse_bedrock_text({"content": []})
