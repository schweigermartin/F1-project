#!/usr/bin/env python3
"""Fetch OpenF1 fixtures for one session and save them to disk.

Used by:
  - packages/shared tests (T2 ✓) — fixtures live next to the schemas
  - infra integration test (T12) — Consumer lambda replays these through the pipeline
  - Phase 3 ML notebooks may load them as a quick sanity check (FastF1 is the
    real training source)

Defaults to the last completed race when run without arguments.

Usage:
  python ml/scripts/fetch_fixtures.py                          # auto-pick latest race, sample 100
  python ml/scripts/fetch_fixtures.py --session 11291          # specific session
  python ml/scripts/fetch_fixtures.py --session 11291 --full   # no row sampling
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

OPENF1_BASE = "https://api.openf1.org/v1"

# macOS Python from python.org ships without system CA roots — explicitly
# point at certifi's bundle if it's available, otherwise the default context.
try:
    import certifi

    _SSL_CONTEXT = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    _SSL_CONTEXT = ssl.create_default_context()

# /position is singular — keep this list aligned with packages/shared/src/openf1-schema.ts.
DATA_ENDPOINTS = ("position", "intervals", "laps", "stints", "weather")
SAMPLED_ENDPOINTS = {"position", "intervals", "laps"}  # high-volume ones we cap


def fetch_json(url: str) -> object:
    with urllib.request.urlopen(url, timeout=30, context=_SSL_CONTEXT) as resp:
        return json.load(resp)


def find_last_completed_race() -> int:
    """Return the session_key of the most recent completed race for the current year."""
    year = dt.datetime.now(dt.timezone.utc).year
    sessions = fetch_json(f"{OPENF1_BASE}/sessions?year={year}")
    now = dt.datetime.now(dt.timezone.utc)
    completed_races = [
        s
        for s in sessions
        if s["session_type"] == "Race"
        and not s["is_cancelled"]
        and dt.datetime.fromisoformat(s["date_end"]) < now
    ]
    if not completed_races:
        sys.exit(f"No completed races found for {year}.")
    last = completed_races[-1]
    print(
        f"Auto-picked last completed race: session_key={last['session_key']} "
        f"({last['country_name']} {last['date_start']})"
    )
    return int(last["session_key"])


def fetch_endpoint(endpoint: str, session_key: int, sample: int | None) -> list[dict]:
    url = f"{OPENF1_BASE}/{endpoint}?session_key={session_key}"
    data = fetch_json(url)
    if not isinstance(data, list):
        # OpenF1 returns {"detail": "No results found."} for empty endpoints.
        print(f"  {endpoint}: skipped — {data}")
        return []
    if sample and len(data) > sample and endpoint in SAMPLED_ENDPOINTS:
        print(f"  {endpoint}: {len(data)} rows → sampled to {sample}")
        return data[:sample]
    print(f"  {endpoint}: {len(data)} rows")
    return data


def write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--session", type=int, help="OpenF1 session_key (default: latest race)")
    parser.add_argument(
        "--full",
        action="store_true",
        help="Skip row sampling on high-volume endpoints (large fixtures)",
    )
    parser.add_argument(
        "--sample",
        type=int,
        default=100,
        help="Row cap for high-volume endpoints when --full is not set (default: 100)",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=Path(__file__).resolve().parent.parent / "fixtures" / "openf1",
        help="Output root directory (default: ml/fixtures/openf1)",
    )
    args = parser.parse_args()

    session_key = args.session or find_last_completed_race()
    sample = None if args.full else args.sample
    target_dir = args.out / str(session_key)

    print(f"\nFetching fixtures for session_key={session_key} → {target_dir}")

    sessions_blob = fetch_json(f"{OPENF1_BASE}/sessions?session_key={session_key}")
    if not sessions_blob:
        sys.exit(f"Session {session_key} not found.")
    write_json(target_dir / "session.json", sessions_blob[0])
    print(f"  session: meta written")

    for ep in DATA_ENDPOINTS:
        try:
            rows = fetch_endpoint(ep, session_key, sample)
        except urllib.error.HTTPError as e:
            print(f"  {ep}: HTTP {e.code} — skipped")
            continue
        write_json(target_dir / f"{ep}.json", rows)

    print(f"\nDone. Fixtures in {target_dir}")


if __name__ == "__main__":
    main()
