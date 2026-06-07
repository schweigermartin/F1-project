"""Resumable FastF1 backfill for the 0.2.0 feature set (Phase 006, T6).

Warms the local `.fastf1-cache/` and writes a per-race-driver CSV that the
training notebook (T7) can load directly instead of re-fetching. Unlike a single
`load_seasons` call, this checkpoints after **every round**, so a
`RateLimitExceededError` (FastF1/Ergast cap ~500 calls/h) never loses progress:
re-run the same command and it skips the rounds already in the checkpoint and
resumes — cached sessions are free (R-1).

Each race now pulls up to five sessions (R + Q + FP1/FP2/FP3, the practice loads
being the costly ones), so a multi-season cold pull will span several hourly
windows. Default window mirrors the Phase-3 focused 2022–2025 range (all >= 2019,
so practice data is reliable; D-5).

    cd ml
    .venv/bin/python scripts/backfill_practice.py                 # 2022–2025
    .venv/bin/python scripts/backfill_practice.py --first 2022 --last 2025
    .venv/bin/python scripts/backfill_practice.py --sleep-on-limit  # auto-resume

Run from the `ml/` project root so `.fastf1-cache/` and `artifacts/` resolve the
same way as the notebook.
"""

import argparse
import logging
import time
from pathlib import Path

import pandas as pd
from fastf1.exceptions import RateLimitExceededError

from f1pred.data import RACE_COLUMNS, fastf1_load_race, fastf1_rounds_for_year

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("backfill")

#: Seconds to wait when --sleep-on-limit is set (one rate-limit window + margin).
_RATE_LIMIT_SLEEP_S = 3600 + 120


def _load_checkpoint(path: Path) -> tuple[list[pd.DataFrame], set[tuple[int, int]]]:
    """Existing rows + the set of (year, round) already fetched, from the CSV."""
    if not path.exists():
        return [], set()
    df = pd.read_csv(path)
    done = {(int(y), int(r)) for y, r in zip(df["year"], df["round"], strict=True)}
    logger.info("resuming: %d rounds already in %s", len(done), path)
    return [df], done


def _write(frames: list[pd.DataFrame], path: Path) -> None:
    """Atomically rewrite the checkpoint CSV (small data; safe after each round)."""
    combined = pd.concat(frames, ignore_index=True)[RACE_COLUMNS]
    tmp = path.with_suffix(".tmp")
    combined.to_csv(tmp, index=False)
    tmp.replace(path)


def backfill(first: int, last: int, out: Path, *, sleep_on_limit: bool, limit: int | None) -> int:
    """Fetch every round in [first, last], checkpointing after each. Returns the
    number of rounds still missing (0 = complete). `limit` caps how many rounds
    this invocation fetches (a smoke test: one round before the full pull)."""
    frames, done = _load_checkpoint(out)
    out.parent.mkdir(parents=True, exist_ok=True)

    # Plan the work first (one cheap schedule call per season) so we can report
    # progress and what's left to fetch.
    schedule: list[tuple[int, int]] = []
    for year in range(first, last + 1):
        for rnd in fastf1_rounds_for_year(year):
            schedule.append((year, rnd))
    todo = [key for key in schedule if key not in done]
    if limit is not None:
        todo = todo[:limit]
        logger.info("--limit %d: fetching at most %d round(s) this run", limit, len(todo))
    logger.info(
        "%d rounds total, %d already done, %d to fetch", len(schedule), len(done), len(todo)
    )

    for i, (year, rnd) in enumerate(todo, start=1):
        logger.info("[%d/%d] fetching %s round %s", i, len(todo), year, rnd)
        try:
            race = fastf1_load_race(year, rnd)
        except RateLimitExceededError:
            logger.warning("rate limit hit at %s round %s — progress saved to %s", year, rnd, out)
            if sleep_on_limit:
                logger.info("sleeping %ds for the rate-limit window to reset…", _RATE_LIMIT_SLEEP_S)
                time.sleep(_RATE_LIMIT_SLEEP_S)
                continue
            remaining = len(todo) - i + 1
            logger.warning("re-run the same command to resume (%d rounds left)", remaining)
            return remaining
        if race is None or race.empty:
            # Genuinely missing data (rare in a modern window) — not a rate limit.
            # It won't enter the checkpoint, so a re-run retries it from cache; that
            # is cheap and avoids permanently dropping a round that later appears.
            logger.warning("no data for %s round %s — skipping", year, rnd)
            continue
        frames.append(race)
        _write(frames, out)

    total_rows = sum(len(f) for f in frames)
    logger.info("backfill complete: %d race-driver rows in %s", total_rows, out)
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(description="Resumable FastF1 backfill (Phase 006 T6)")
    parser.add_argument("--first", type=int, default=2022, help="first season (inclusive)")
    parser.add_argument("--last", type=int, default=2025, help="last season (inclusive)")
    parser.add_argument(
        "--out",
        type=Path,
        default=None,
        help="checkpoint/output CSV (default artifacts/races_<first>_<last>.csv)",
    )
    parser.add_argument(
        "--sleep-on-limit",
        action="store_true",
        help="sleep through the rate-limit window and continue instead of exiting",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="fetch at most N rounds this run (smoke test before the full pull)",
    )
    args = parser.parse_args()

    out = args.out or Path(f"artifacts/races_{args.first}_{args.last}.csv")
    remaining = backfill(
        args.first, args.last, out, sleep_on_limit=args.sleep_on_limit, limit=args.limit
    )
    if remaining:
        logger.warning("incomplete: %d rounds remaining — re-run to resume", remaining)
        raise SystemExit(2)


if __name__ == "__main__":
    main()
