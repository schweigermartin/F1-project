"""Local inference driver — mirrors infra/lambda/inference/lambda_function.py.

Runs the *same* pure `handle_inference` with real Bedrock + real DDB, but loads
the model from a local artifact and uses the warm local FastF1 cache. Used for the
T14 smoke run when the Lambda's cold /tmp cache trips Ergast's 500-calls/h limit.

    AWS_PROFILE=private python scripts/run_inference_local.py 2026-05-03 4 0.1.0
"""

import json
import logging
import sys
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
from f1pred.inference import build_race_features, fastf1_load_quali
from f1pred.inference_handler import (
    ExplanationKey,
    InferenceDeps,
    handle_inference,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("inference-local")

TABLE_NAME = "F1Predictions"
BEDROCK_MODEL_ID = "eu.anthropic.claude-haiku-4-5-20251001-v1:0"

_table = boto3.resource("dynamodb").Table(TABLE_NAME)
_bedrock = boto3.client("bedrock-runtime")


def _load_model(version: str) -> XGBClassifier:
    model = XGBClassifier()
    model.load_model(f"artifacts/{version}/model.json")
    return model


def _load_features(race_date: str, round_number: int, version: str) -> Any:
    # Precomputed history artifact (models/<version>/history.csv) — only the
    # upcoming quali is fetched live, so FastF1's 500-calls/h limit is never hit.
    history = pd.read_csv(f"artifacts/{version}/history.csv")[RACE_COLUMNS]
    return build_race_features(
        race_date, round_number, load_quali=fastf1_load_quali, history=history
    )


def _get_cached_explanation(key: ExplanationKey) -> str | None:
    resp = _table.get_item(
        Key={"PK": race_pk(key.race_date, key.round), "SK": explanation_sk(key.driver_number)}
    )
    item = resp.get("Item")
    return str(item["bedrock_text"]) if item else None


def _invoke_bedrock(system: str, user: str) -> str:
    resp = _bedrock.invoke_model(
        modelId=BEDROCK_MODEL_ID, body=json.dumps(build_bedrock_request(system, user))
    )
    return parse_bedrock_text(json.loads(resp["body"].read()))


def main() -> None:
    race_date, round_number, version = sys.argv[1], int(sys.argv[2]), sys.argv[3]
    deps = InferenceDeps(
        load_model=_load_model,
        load_features=_load_features,
        put_prediction=lambda rec: _table.put_item(Item=prediction_item(rec)),
        get_cached_explanation=_get_cached_explanation,
        invoke_bedrock=_invoke_bedrock,
        put_explanation=lambda rec: _table.put_item(Item=explanation_item(rec)),
        now=lambda: datetime.now(UTC),
        emit_metric=lambda name, value: logger.info("metric %s=%s", name, value),
        model_id=BEDROCK_MODEL_ID,
        logger=logger,
    )
    summary = handle_inference(
        {"race_date": race_date, "round": round_number, "model_version": version}, deps
    )
    print(json.dumps(summary.__dict__, indent=2))


if __name__ == "__main__":
    main()
