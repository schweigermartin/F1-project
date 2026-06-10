"""Inference lambda adapter — wires real AWS/FastF1 clients into the pure
`handle_inference` from the f1pred package (T6). Thin by design: every bit of
testable logic (predict, features, prompt, DDB items, Bedrock parse) lives in
f1pred and is covered by `pytest ml/`; this file is just boto3 + FastF1 plumbing
and is exercised by the local docker smoke-invoke (T7) and the real run (T13/14).

Env:
  PREDICTIONS_TABLE   F1Predictions DynamoDB table name
  MODEL_BUCKET        S3 bucket holding models/<version>/model.json
  BEDROCK_MODEL_ID    Claude Haiku model/inference-profile id (eu-central-1)
  FASTF1_CACHE_DIR    writable FastF1 cache dir (/tmp on Lambda's read-only fs)
"""

import json
import logging
import os
from datetime import UTC, datetime
from typing import Any

import boto3
import pandas as pd
from xgboost import XGBClassifier

from f1pred.aws_io import (
    build_bedrock_request,
    explanation_item,
    parse_bedrock_text,
    prediction_item,
)
from f1pred.data import RACE_COLUMNS
from f1pred.ddb_keys import explanation_sk, race_pk
from f1pred.inference import build_race_features, fastf1_load_practice, fastf1_load_quali
from f1pred.inference_handler import (
    ExplanationKey,
    ExplanationRecord,
    InferenceDeps,
    PredictionRecord,
    handle_inference,
)
from f1pred.layout import model_artifact_key, model_history_key

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("inference")

_TABLE_NAME = os.environ["PREDICTIONS_TABLE"]
_MODEL_BUCKET = os.environ["MODEL_BUCKET"]
_BEDROCK_MODEL_ID = os.environ["BEDROCK_MODEL_ID"]

_s3 = boto3.client("s3")
_table = boto3.resource("dynamodb").Table(_TABLE_NAME)
_bedrock = boto3.client("bedrock-runtime")

#: Warm-invocation cache: a loaded model is reused across invocations by version.
_model_cache: dict[str, XGBClassifier] = {}

#: CloudWatch EMF namespace for the inference metrics (alarms wired in T9).
_METRIC_NAMESPACE = "F1/Inference"


def _load_model(version: str) -> XGBClassifier:
    if version not in _model_cache:
        path = f"/tmp/model-{version}.json"  # noqa: S108 — Lambda's only writable dir
        _s3.download_file(_MODEL_BUCKET, model_artifact_key(version), path)
        model = XGBClassifier()
        model.load_model(path)
        _model_cache[version] = model
        logger.info("loaded model %s from s3://%s", version, _MODEL_BUCKET)
    return _model_cache[version]


def _load_features(race_date: str, round_number: int, version: str) -> Any:
    # Rolling features come from the precomputed history bundled with the model
    # (models/<version>/history.csv); only the upcoming weekend's quali + practice
    # are fetched live, so FastF1's 500-calls/h limit is never hit on a cold /tmp
    # cache. reindex tolerates a history.csv that predates the 0.2.0 columns (the
    # extra columns are only needed on the target row, which comes from live data).
    path = f"/tmp/history-{version}.csv"  # noqa: S108 — Lambda's only writable dir
    _s3.download_file(_MODEL_BUCKET, model_history_key(version), path)
    history = pd.read_csv(path).reindex(columns=RACE_COLUMNS)
    return build_race_features(
        race_date,
        round_number,
        load_quali=fastf1_load_quali,
        history=history,
        load_practice=fastf1_load_practice,
    )


def _get_cached_explanation(key: ExplanationKey) -> str | None:
    resp = _table.get_item(
        Key={"PK": race_pk(key.race_date, key.round), "SK": explanation_sk(key.driver_number)}
    )
    item = resp.get("Item")
    return str(item["bedrock_text"]) if item else None


def _invoke_bedrock(system: str, user: str) -> str:
    resp = _bedrock.invoke_model(
        modelId=_BEDROCK_MODEL_ID,
        body=json.dumps(build_bedrock_request(system, user)),
    )
    text: str = parse_bedrock_text(json.loads(resp["body"].read()))
    return text


def _emit_metric(name: str, value: float) -> None:
    """Emit one metric via CloudWatch EMF (structured log → no API call, no extra
    IAM beyond logs)."""
    print(  # noqa: T201 — EMF is delivered through stdout/CloudWatch Logs
        json.dumps(
            {
                "_aws": {
                    "CloudWatchMetrics": [
                        {
                            "Namespace": _METRIC_NAMESPACE,
                            "Dimensions": [[]],
                            "Metrics": [{"Name": name}],
                        }
                    ],
                    "Timestamp": int(datetime.now(UTC).timestamp() * 1000),
                },
                name: value,
            }
        )
    )


def lambda_handler(event: dict[str, Any], _context: object = None) -> dict[str, Any]:
    deps = InferenceDeps(
        load_model=_load_model,
        load_features=_load_features,
        put_prediction=lambda rec: _table.put_item(Item=prediction_item(rec)),
        get_cached_explanation=_get_cached_explanation,
        invoke_bedrock=_invoke_bedrock,
        put_explanation=lambda rec: _table.put_item(Item=explanation_item(rec)),
        now=lambda: datetime.now(UTC),
        emit_metric=_emit_metric,
        model_id=_BEDROCK_MODEL_ID,
        logger=logger,
    )
    summary = handle_inference(event, deps)
    return {
        "race_date": summary.race_date,
        "round": summary.round,
        "n_drivers": summary.n_drivers,
        "predictions_written": summary.predictions_written,
        "bedrock_calls": summary.bedrock_calls,
        "cache_hits": summary.cache_hits,
        "bedrock_errors": summary.bedrock_errors,
    }


# Re-export so the adapter can construct records in a smoke test if needed.
__all__ = ["lambda_handler", "PredictionRecord", "ExplanationRecord"]
