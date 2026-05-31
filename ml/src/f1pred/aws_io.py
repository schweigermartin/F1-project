"""Pure (de)serialization between domain records and AWS wire formats.

Kept out of the lambda adapter so the error-prone parts — DDB item shapes (with
float→Decimal, which boto3's resource API requires) and the Bedrock Anthropic
request/response — are unit-tested in CI. The adapter (T7) only does the boto3
calls around these helpers.
"""

from decimal import Decimal
from typing import Any

from f1pred.ddb_keys import explanation_sk, prediction_sk, race_pk
from f1pred.inference_handler import ExplanationRecord, PredictionRecord

#: Anthropic-on-Bedrock Messages API version (request body field).
BEDROCK_ANTHROPIC_VERSION = "bedrock-2023-05-31"

#: A 3-sentence German explanation is short; cap tokens to bound cost (AC-2/IV).
BEDROCK_MAX_TOKENS = 300


def _dec(value: float) -> Decimal:
    """float → Decimal via str so DDB doesn't choke on binary-float artifacts."""
    return Decimal(str(value))


def prediction_item(record: PredictionRecord) -> dict[str, Any]:
    """DDB item for `prediction#<N>` — matches the shared PredictionItemSchema."""
    p = record.prediction
    return {
        "PK": race_pk(record.race_date, record.round),
        "SK": prediction_sk(p.driver_number),
        "driver_number": p.driver_number,
        "driver_code": p.driver_code,
        "podium_probability": _dec(p.podium_probability),
        "shap_top": [
            {"feature": c.feature, "contribution": _dec(c.contribution)} for c in p.shap_top
        ],
        "model_version": record.model_version,
        "predicted_at": record.predicted_at,
    }


def explanation_item(record: ExplanationRecord) -> dict[str, Any]:
    """DDB item for `explanation#<N>` — matches the shared ExplanationItemSchema."""
    key = record.key
    return {
        "PK": race_pk(key.race_date, key.round),
        "SK": explanation_sk(key.driver_number),
        "bedrock_text": record.bedrock_text,
        "model_id": record.model_id,
        "cached_at": record.cached_at,
    }


def build_bedrock_request(
    system: str, user: str, *, max_tokens: int = BEDROCK_MAX_TOKENS
) -> dict[str, Any]:
    """Anthropic Messages request body for `bedrock-runtime:InvokeModel`."""
    return {
        "anthropic_version": BEDROCK_ANTHROPIC_VERSION,
        "max_tokens": max_tokens,
        "system": system,
        "messages": [{"role": "user", "content": [{"type": "text", "text": user}]}],
    }


def parse_bedrock_text(response_body: dict[str, Any]) -> str:
    """Extract the text from a Bedrock Anthropic response. Raises if empty so the
    handler treats a malformed/blocked response as a Bedrock error (and keeps the
    prediction)."""
    content = response_body.get("content", [])
    text = "".join(
        block.get("text", "") for block in content if block.get("type") == "text"
    ).strip()
    if not text:
        raise ValueError("bedrock response contained no text content")
    return text
