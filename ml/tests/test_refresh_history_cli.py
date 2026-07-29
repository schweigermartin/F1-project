"""Tests for the pure argument handling of `scripts/refresh_history.py`.

The script itself needs FastF1, network and AWS, so only its pure parts are
exercised here — loaded by path because `scripts/` is not an importable package.
"""

import importlib.util
import sys
from pathlib import Path
from types import ModuleType

import pandas as pd
import pytest

from f1pred.data import RACE_COLUMNS


def _load_script() -> ModuleType:
    path = Path(__file__).resolve().parents[1] / "scripts" / "refresh_history.py"
    spec = importlib.util.spec_from_file_location("refresh_history", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


script = _load_script()


def test_parses_a_range() -> None:
    assert script.parse_rounds("1-11") == list(range(1, 12))


def test_parses_a_single_round_and_a_list() -> None:
    assert script.parse_rounds("3") == [3]
    assert script.parse_rounds("1,4,7") == [1, 4, 7]


def test_parses_a_mixed_spec_and_deduplicates() -> None:
    assert script.parse_rounds("1-3,3,5") == [1, 2, 3, 5]


def test_tolerates_whitespace() -> None:
    assert script.parse_rounds(" 1 , 2 ") == [1, 2]


def test_rejects_an_inverted_range() -> None:
    with pytest.raises(ValueError, match="empty round range"):
        script.parse_rounds("11-1")


def test_rejects_an_empty_spec() -> None:
    with pytest.raises(ValueError, match="no rounds parsed"):
        script.parse_rounds(",")


def test_resolve_rounds_prefers_an_explicit_spec() -> None:
    # No FastF1 call happens on this path, which is what makes it testable.
    empty = pd.DataFrame(columns=RACE_COLUMNS)
    assert script.resolve_rounds(empty, 2026, "2-4") == [2, 3, 4]


def test_refuses_to_overwrite_the_source_version() -> None:
    """A published history must not be mutated in place — predictions already
    stored under that version record it and must stay reproducible."""
    with pytest.raises(SystemExit):
        script.main(["--version", "0.2.0", "--target-version", "0.2.0", "--year", "2026"])


def test_requires_a_target_version() -> None:
    with pytest.raises(SystemExit):
        script.main(["--version", "0.2.0", "--year", "2026"])
