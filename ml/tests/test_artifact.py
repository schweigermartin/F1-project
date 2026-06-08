import boto3
import pandas as pd
from moto import mock_aws

from f1pred.artifact import ModelCardMeta, publish, render_model_card
from f1pred.data import RACE_COLUMNS
from f1pred.evaluate import Metrics
from f1pred.layout import model_artifact_key, model_card_key, model_history_key
from f1pred.train import train_podium

TrainVal = tuple[pd.DataFrame, pd.Series, pd.DataFrame, pd.Series]

_METRICS: Metrics = {
    "accuracy": 0.91,
    "log_loss": 0.22,
    "roc_auc": 0.95,
    "confusion_matrix": [[80, 5], [4, 11]],
}
_BASELINE: Metrics = {
    "accuracy": 0.80,
    "log_loss": 0.40,
    "roc_auc": 0.70,
    "confusion_matrix": [[70, 15], [8, 7]],
}


def _meta(version: str = "1.0.0") -> ModelCardMeta:
    return ModelCardMeta(
        version=version,
        seasons="train ≤2023, val 2024, test 2025",
        fastf1_version="3.4.0",
        n_train=400,
        n_test=120,
        metrics=_METRICS,
        baseline=_BASELINE,
        top_features=[("grid_position", 1.2), ("driver_form", 0.6)],
        limitations="Imbalanced (~15% podium); no live-session signal yet.",
    )


def test_card_contains_metrics_features_and_baseline() -> None:
    card = render_model_card(_meta())
    assert "Podium Predictor `1.0.0`" in card
    assert "grid_position" in card
    assert "0.910" in card  # model accuracy
    assert "baseline" in card


def test_publish_writes_local_artifacts(train_val: TrainVal, tmp_path: object) -> None:
    x_train, y_train, x_val, y_val = train_val
    model = train_podium(x_train, y_train, x_val, y_val)
    out = publish(model, render_model_card(_meta()), version="1.0.0", base_dir=str(tmp_path))
    assert (out / "model.json").exists()
    assert (out / "model_card.md").exists()


@mock_aws
def test_publish_uploads_to_s3_at_the_versioned_keys(
    train_val: TrainVal, tmp_path: object
) -> None:
    x_train, y_train, x_val, y_val = train_val
    model = train_podium(x_train, y_train, x_val, y_val)
    s3 = boto3.client("s3", region_name="eu-central-1")
    s3.create_bucket(
        Bucket="f1-data-test",
        CreateBucketConfiguration={"LocationConstraint": "eu-central-1"},
    )
    publish(
        model,
        render_model_card(_meta()),
        version="1.0.0",
        base_dir=str(tmp_path),
        s3_client=s3,
        bucket="f1-data-test",
    )
    # Both objects exist at the shared-layout keys.
    s3.head_object(Bucket="f1-data-test", Key=model_artifact_key("1.0.0"))
    s3.head_object(Bucket="f1-data-test", Key=model_card_key("1.0.0"))


def _history() -> pd.DataFrame:
    """A minimal race frame with the full RACE_COLUMNS contract."""
    return pd.DataFrame([dict.fromkeys(RACE_COLUMNS, 0)])


def test_publish_writes_history_locally_when_given(
    train_val: TrainVal, tmp_path: object
) -> None:
    x_train, y_train, x_val, y_val = train_val
    model = train_podium(x_train, y_train, x_val, y_val)
    out = publish(
        model,
        render_model_card(_meta()),
        version="1.0.0",
        base_dir=str(tmp_path),
        history=_history(),
    )
    saved = pd.read_csv(out / "history.csv")
    assert list(saved.columns) == RACE_COLUMNS


def test_publish_omits_history_by_default(train_val: TrainVal, tmp_path: object) -> None:
    x_train, y_train, x_val, y_val = train_val
    model = train_podium(x_train, y_train, x_val, y_val)
    out = publish(model, render_model_card(_meta()), version="1.0.0", base_dir=str(tmp_path))
    assert not (out / "history.csv").exists()


@mock_aws
def test_publish_uploads_history_to_s3_when_given(train_val: TrainVal, tmp_path: object) -> None:
    x_train, y_train, x_val, y_val = train_val
    model = train_podium(x_train, y_train, x_val, y_val)
    s3 = boto3.client("s3", region_name="eu-central-1")
    s3.create_bucket(
        Bucket="f1-data-test",
        CreateBucketConfiguration={"LocationConstraint": "eu-central-1"},
    )
    publish(
        model,
        render_model_card(_meta()),
        version="1.0.0",
        base_dir=str(tmp_path),
        s3_client=s3,
        bucket="f1-data-test",
        history=_history(),
    )
    s3.head_object(Bucket="f1-data-test", Key=model_history_key("1.0.0"))
