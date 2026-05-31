"""Versioned model artifact + model card → local dir and/or S3.

The card is rendered in code (no external template file → nothing to misplace).
Layout matches `@f1/shared` via layout.py (`models/<semver>/...`, never
`latest/` — Constitution IX). S3 upload is optional: without a client the
artifacts are written locally (ml/artifacts/<version>/) and that's logged.
"""

import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from f1pred.evaluate import Metrics
from f1pred.layout import model_artifact_key, model_card_key

logger = logging.getLogger(__name__)

DEFAULT_LOCAL_DIR = "artifacts"  # relative to the ml/ workdir (gitignored as ml/artifacts/)


@dataclass(frozen=True)
class ModelCardMeta:
    version: str
    seasons: str
    fastf1_version: str
    n_train: int
    n_test: int
    metrics: Metrics
    baseline: Metrics
    top_features: list[tuple[str, float]]
    limitations: str


def _metric_row(label: str, m: Metrics) -> str:
    return f"| {label} | {m['accuracy']:.3f} | {m['log_loss']:.3f} | {m['roc_auc']:.3f} |"


def render_model_card(meta: ModelCardMeta) -> str:
    """Render the model card markdown from measured metrics + metadata."""
    features = "\n".join(f"- `{name}` — mean|SHAP| {val:.3f}" for name, val in meta.top_features)
    return f"""# Model Card — Podium Predictor `{meta.version}`

Binary XGBoost classifier: probability a driver finishes on the podium (P≤3).

## Data

- Source: FastF1 {meta.fastf1_version}.
- Seasons / split (temporal, no shuffle): {meta.seasons}.
- Rows: {meta.n_train} train, {meta.n_test} test.

## Features (pre-race only — no leakage)

{features}

## Metrics (test) vs. baseline "podium = grid ≤ 3"

| model | accuracy | log_loss | roc_auc |
| ----- | -------- | -------- | ------- |
{_metric_row("XGBoost", meta.metrics)}
{_metric_row("baseline", meta.baseline)}

## Limitations

{meta.limitations}

## Cost

Training is local + offline (FastF1 cache); the artifact is a few MB in S3 — ≈0 €
(Constitution IV).
"""


def write_local(
    version: str, model: Any, card_text: str, *, base_dir: str = DEFAULT_LOCAL_DIR
) -> Path:
    """Write model.json + model_card.md under base_dir/<version>/."""
    out = Path(base_dir) / version
    out.mkdir(parents=True, exist_ok=True)
    model.save_model(str(out / "model.json"))
    (out / "model_card.md").write_text(card_text, encoding="utf-8")
    return out


def upload_s3(
    version: str, model_path: Path, card_text: str, *, s3_client: Any, bucket: str
) -> None:
    """Put the model JSON + card to models/<version>/ in S3."""
    s3_client.put_object(
        Bucket=bucket,
        Key=model_artifact_key(version),
        Body=model_path.read_bytes(),
    )
    s3_client.put_object(
        Bucket=bucket,
        Key=model_card_key(version),
        Body=card_text.encode("utf-8"),
    )


def publish(
    model: Any,
    card_text: str,
    *,
    version: str,
    base_dir: str = DEFAULT_LOCAL_DIR,
    s3_client: Any | None = None,
    bucket: str | None = None,
) -> Path:
    """Write locally always; upload to S3 when a client + bucket are given."""
    out = write_local(version, model, card_text, base_dir=base_dir)
    if s3_client is not None and bucket is not None:
        upload_s3(version, out / "model.json", card_text, s3_client=s3_client, bucket=bucket)
        logger.info("uploaded model %s to s3://%s/models/%s/", version, bucket, version)
    else:
        logger.info("no S3 target — model %s written locally to %s", version, out)
    return out
