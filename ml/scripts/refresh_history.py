"""Bring a published model's history artifact up to date (Phase 010, T15).

`models/<version>/history.csv` is what the inference lambda derives the three
rolling features from — `driver_form`, `constructor_form`, `track_history`. The
deployed 0.2.0 artifact ends at round 24 of 2025, so every 2026 prediction has
been computed from prior-season form that never moved during the season. This
script appends the season's finished races and re-uploads the artifact, turning
what was a manual runbook step into one reproducible command.

    cd ml
    .venv/bin/python scripts/refresh_history.py --version 0.2.0 --year 2026 --dry-run
    .venv/bin/python scripts/refresh_history.py --version 0.2.0 --year 2026 --rounds 1-11
    AWS_PROFILE=private .venv/bin/python scripts/refresh_history.py --version 0.2.0 --year 2026

Without `--rounds` it resumes: it loads whatever rounds follow the highest one
already present for that season. `--dry-run` writes the merged frame locally to
`artifacts/<version>/history.csv` and uploads nothing.

Deliberately **not** part of CI — it needs FastF1, network and AWS credentials.
The merge logic it wraps (`f1pred.history.append_races`) is pure and is what the
test suite covers.

Note the model itself is *not* retrained here. Refreshing the history makes the
rolling features current; the fitted trees still come from the 2022–2025 window,
which is a separate (and larger) piece of work.
"""

import argparse
import io
import logging
import os
import sys
from pathlib import Path
from typing import Any

import pandas as pd

from f1pred.data import RACE_COLUMNS, fastf1_load_race, fastf1_rounds_for_year
from f1pred.history import append_races, latest_round, seasons_covered
from f1pred.layout import model_history_key

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("refresh-history")


def parse_rounds(spec: str) -> list[int]:
    """Parse `--rounds` as `1-11`, `3`, or `1,4,7` into a sorted round list."""
    rounds: set[int] = set()
    for part in spec.split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            lo, hi = part.split("-", 1)
            start, end = int(lo), int(hi)
            if start > end:
                raise ValueError(f"empty round range: {part}")
            rounds.update(range(start, end + 1))
        else:
            rounds.add(int(part))
    if not rounds:
        raise ValueError(f"no rounds parsed from {spec!r}")
    return sorted(rounds)


def download_history(s3_client: Any, bucket: str, version: str) -> pd.DataFrame:
    """Read the currently published history artifact from S3."""
    key = model_history_key(version)
    obj = s3_client.get_object(Bucket=bucket, Key=key)
    frame = pd.read_csv(io.BytesIO(obj["Body"].read()))
    logger.info(
        "loaded s3://%s/%s — %d rows, seasons %s", bucket, key, len(frame), seasons_covered(frame)
    )
    return frame


def load_new_races(year: int, rounds: list[int]) -> pd.DataFrame:
    """Fetch the requested races via FastF1; skip and log the ones with no data.

    A round that hasn't been driven yet simply returns nothing, which is why
    running this mid-season with a generous range is safe.
    """
    frames: list[pd.DataFrame] = []
    for rnd in rounds:
        try:
            race = fastf1_load_race(year, rnd)
        except Exception as exc:  # noqa: BLE001 — FastF1 raises broadly; keep going
            logger.warning("round %s: load failed (%s) — skipping", rnd, exc)
            continue
        if race is None or race.empty:
            logger.info("round %s: no data yet — skipping", rnd)
            continue
        logger.info("round %s: %d driver rows", rnd, len(race))
        frames.append(race)
    if not frames:
        return pd.DataFrame(columns=RACE_COLUMNS)
    return pd.concat(frames, ignore_index=True)


def resolve_rounds(history: pd.DataFrame, year: int, spec: str | None) -> list[int]:
    """Explicit `--rounds`, else everything after the season's highest known round."""
    if spec:
        return parse_rounds(spec)
    known = latest_round(history, year)
    start = 1 if known is None else known + 1
    available = [r for r in fastf1_rounds_for_year(year) if r >= start]
    logger.info("resuming %s from round %d (%d candidate rounds)", year, start, len(available))
    return available


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version", required=True, help="model version, e.g. 0.2.0")
    parser.add_argument("--year", type=int, required=True, help="season to append, e.g. 2026")
    parser.add_argument(
        "--rounds", help="e.g. 1-11 or 1,4,7 (default: resume after the last known)"
    )
    parser.add_argument("--bucket", help="S3 bucket (default: $F1_DATA_BUCKET)")
    parser.add_argument("--local-dir", default="artifacts", help="where to write the merged CSV")
    parser.add_argument("--dry-run", action="store_true", help="write locally, upload nothing")
    args = parser.parse_args(argv)

    bucket = args.bucket or os.environ.get("F1_DATA_BUCKET")
    if not bucket:
        parser.error("no bucket: pass --bucket or set F1_DATA_BUCKET")

    import boto3  # lazy import so --help works without AWS installed

    s3 = boto3.client("s3")

    history = download_history(s3, bucket, args.version)
    rounds = resolve_rounds(history, args.year, args.rounds)
    if not rounds:
        logger.info("nothing to do — history already covers %s", args.year)
        return 0

    new_races = load_new_races(args.year, rounds)
    if new_races.empty:
        logger.info("no new race data found — history unchanged")
        return 0

    merged = append_races(history, new_races)
    added = len(merged) - len(history)

    out_dir = Path(args.local_dir) / args.version
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "history.csv"
    merged.to_csv(out_path, index=False)
    logger.info(
        "wrote %s — %d rows (+%d), seasons %s",
        out_path,
        len(merged),
        added,
        seasons_covered(merged),
    )

    if args.dry_run:
        logger.info("--dry-run: not uploading")
        return 0

    key = model_history_key(args.version)
    s3.put_object(Bucket=bucket, Key=key, Body=out_path.read_bytes())
    logger.info("uploaded s3://%s/%s", bucket, key)
    return 0


if __name__ == "__main__":
    sys.exit(main())
