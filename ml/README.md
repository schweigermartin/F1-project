# ml/

Python workspace for the F1 podium predictor (Phase 3). **Not** part of the
pnpm workspace — its own toolchain (pip + venv, ruff + mypy + pytest). See
[specs/003-ml-model](../specs/003-ml-model/spec.md) for spec/plan/tasks.

## Layout

```
ml/
  pyproject.toml          # deps + ruff/mypy/pytest config
  src/f1pred/             # the pipeline package (data, features, split, train, …)
  tests/                  # pytest — feature pipeline determinism + no-leakage
  notebooks/              # train_podium_model.ipynb (added in T11)
  scripts/                # fetch_fixtures.py (OpenF1 fixtures, Phase 1 T3)
```

## Setup

```bash
cd ml
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"        # runtime + dev deps (fastf1, xgboost, shap, …)
```

## Checks (mirror CI)

```bash
ruff check .
mypy src
pytest
```

## Training (later — needs FastF1 download + AWS creds)

The real training run + S3 artifact upload is a local step (like the Phase 2
deploy): run `notebooks/train_podium_model.ipynb` end to end. It downloads
FastF1 seasons (cached in `.fastf1-cache/`), trains, evaluates against the
grid-top-3 baseline, and uploads `models/<semver>/model.json` + `model_card.md`
to S3.
