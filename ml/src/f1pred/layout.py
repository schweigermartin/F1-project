"""S3 model-artifact paths — mirrors `@f1/shared` `S3_PATHS` (Constitution III).

The TypeScript source of truth is `packages/shared/src/s3-layout.ts`; the
`models/<version>/...` layout must stay in sync with `modelArtifact` /
`modelCard` there. Versions are SemVer, never `latest/` (Constitution IX).
"""

S3_BUCKET_PREFIX = "f1-data"


def bucket_name(account_id: str, region: str) -> str:
    """Deterministic, globally-unique bucket name (account + region)."""
    return f"{S3_BUCKET_PREFIX}-{account_id}-{region}"


def model_artifact_key(version: str) -> str:
    """S3 key for the trained XGBoost model JSON."""
    return f"models/{version}/model.json"


def model_card_key(version: str) -> str:
    """S3 key for the human-readable model card alongside the artifact."""
    return f"models/{version}/model_card.md"


def model_history_key(version: str) -> str:
    """S3 key for the precomputed historical race frame bundled with the model.
    The inference lambda reads this for rolling features instead of re-fetching
    FastF1 (which trips Ergast's 500-calls/h limit on a cold cache)."""
    return f"models/{version}/history.csv"
