# Tasks: ML Model

> **Plan:** [plan.md](./plan.md)
> **Status:** ready

Reihenfolge bewusst: Setup → Layout/Schema → Target/Split → Feature-Pipeline → Data → Training → Eval/SHAP → Artefakt → Notebook → (Martin) Lauf+Upload → Abschluss. Die pure Logik (Target/Split/Features) kommt vor allem, was FastF1-Download braucht — so ist das Meiste offline + in CI testbar.

## Konventionen

- `[ ]` offen, `[~]` in Arbeit, `[x]` erledigt. Jeder Task = ein Commit (`feat(phase-3/TX): …`).
- Jeder Task hat **Output** + **Verify**. Python: Type-Hints überall, `ruff` + `mypy` + `pytest` grün, `logging` statt `print`.
- Tasks ohne Netzwerk/Creds laufen in CI; FastF1-Download + Training + S3-Upload führt Martin lokal aus (markiert).

## Aufgaben

### T1 — Python-Workspace-Setup (`ml/`) — DONE

- **Output:**
  - `ml/pyproject.toml` (hatchling, src-Layout) mit gepinnten Deps (fastf1, pandas, scikit-learn, xgboost, shap, boto3, pydantic, matplotlib) + `[dev]` (pytest, mypy, ruff, moto, pandas-stubs) + ruff/mypy(strict)/pytest-Config.
  - `ml/src/f1pred/__init__.py` (`__version__`), `ml/tests/test_smoke.py` (nicht-leere Suite → pytest exitet sonst mit 5).
  - CI-Job `python` (ehem. `python-lint`, `if:false` entfernt): `pip install -e ./ml[dev]` → ruff + mypy + pytest, timeout 15, pip-Cache.
  - `.gitignore`: `ml/artifacts/`, `*.egg-info/`, `.mypy_cache/`/`.pytest_cache/`/`.ruff_cache/` (`.venv`/`.fastf1-cache` schon da). `ml/README.md` aktualisiert.
- **Verify:** lokal (venv) `ruff check .` + `mypy src` + `pytest` → grün. Bei der Gelegenheit 3 Ruff-Findings im Phase-1-`fetch_fixtures.py` autofixed (`datetime.UTC`, f-string). JS/TS-Gates unberührt (eslint ignoriert `ml/**`, prettier clean).

### T2 — S3-Layout + Feature-Schema — DONE

- **Output:**
  - `f1pred/layout.py` — `model_artifact_key`/`model_card_key`/`bucket_name`, spiegeln `@f1/shared` `S3_PATHS` mit Verweis auf die TS-Quelle (Constitution III).
  - `f1pred/schema.py` — `FEATURE_NAMES` (6 pre-race-Features, feste Reihenfolge) + `PodiumFeatures` (pydantic, `extra="forbid"`, Ranges auf grid_position/quali_gap).
- **Verify:** 6 Tests (Pfade == shared-Layout; FEATURE_NAMES == Model-Felder in Reihenfolge; valid akzeptiert; out-of-range grid / negativer Gap / unknown+missing abgelehnt) → ruff + mypy + pytest (8) grün.

### T3 — Target (`target.py`) — DONE

- **Output:** `podium_label(results, position_col="position")` → 0/1-Series, `pd.to_numeric(errors="coerce")` → DNF/NC/NaN → 0. Pure.
- **Verify:** 4 Tests (Top-3→1; Non-Finisher→0; non-numeric coerced; deterministisch) → ruff + mypy + pytest (12) grün.

### T4 — Temporal Split (`split.py`) — DONE

- **Output:** `temporal_split(df, *, train_max_year, val_year, test_year, year_col="year")` → frozen `Split(train, val, test)` nach Saison-Jahr, kein Shuffle; `ValueError` wenn Jahre nicht streng steigend.
- **Verify:** 4 Tests (Zuordnung; Ordnungs-Invariante max(train) < min(test/val); non-increasing → ValueError; fehlende Saison → leerer Frame) → ruff + mypy + pytest (16) grün.

### T5 — Feature-Pipeline (`features.py`) — DONE

- **Output:** `build_features(races, *, window=5)` → Keys + die 6 `FEATURE_NAMES`. `driver_form`/`constructor_form` = `groupby.transform(shift(1).rolling(window).mean())`, `track_history` = `groupby([driver,circuit]).transform(shift(1).expanding().mean())` — `shift(1)` = die Leakage-Garantie. Index erhalten (Target-Alignment). Missing-Policy: grid/quali/is_wet/form fehlend → Zeile weg; `track_history` Erstbesuch → `NEUTRAL_TRACK_HISTORY=10.0` gefüllt (leakage-frei, sonst dezimiert).
- **Verify:** 7 Tests (Constitution X): Feature-Spalten vorhanden; Determinismus (`assert_frame_equal`); Erstrennen verworfen; `driver_form` nutzt nur Vergangenheit (Wert geprüft); **Anti-Leakage** (Permutation der letzten-Runde-Ergebnisse → Features der Runde unverändert); fehlendes Pflichtfeld → Zeile weg. Synthetische Fixtures, **kein FastF1**. → ruff + mypy (6) + pytest (22) grün.
- **Notes:** track_history-Neutral-Fill ist eine bewusste Verfeinerung ggü. „Default verwerfen" (Plan §Feature-Pipeline aktualisiert).

### T6 — Data Layer (`data.py`) — DONE

- **Output:** `load_seasons(years, *, rounds_for_year, load_race)` — konkatiniert normalisierte Race-Frames (`RACE_COLUMNS`), fehlende Runde → skip + log (R-4). Default-Loader `fastf1_load_race`/`fastf1_rounds_for_year` mit **lazy** FastF1-Import + Cache `.fastf1-cache/` (Quali-Gap-zu-Pole, Regen-Flag, Coercion-Helfer). FastF1-Pfad nur im echten Lauf (T12) ausgeführt.
- **Verify:** 3 Tests (Konkatenation, skip-bei-None, leerer Frame mit korrekten Spalten) gegen injizierte Fake-Loader — **kein FastF1/Netzwerk**. ruff + mypy (7) + pytest (25) grün.

### T7 — Training (`train.py`) — DONE

- **Output:** `train_podium(x_train, y_train, x_val, y_val, *, params, early_stopping_rounds=30)` → `XGBClassifier`. `RANDOM_STATE=42`, `n_jobs=1`, `tree_method="hist"` → deterministisch (AC-8). `scale_pos_weight(y) = neg/pos` (AC-4). Dokumentiertes Default-HP-Set, Early-Stopping auf Val, Features in kanonischer Reihenfolge + `astype(float)` (is_wet→0/1). pyproject `xgboost~=3.0` (auf getestete Major nachgezogen).
- **Verify:** 4 Tests (scale_pos_weight neg/pos + no-positives; trainiert + predict_proba-Shape; **gleicher Seed → identische proba**, AC-8) auf synthetischen Fixtures (`conftest.py`). ruff + mypy (8) + pytest (29) grün (lokal mit `brew install libomp`).

### T8 — Evaluation + Baseline (`evaluate.py`) — DONE

- **Output:** `evaluate(model, x_test, y_test)` → `Metrics` (TypedDict: accuracy, log_loss, roc_auc, confusion_matrix); `baseline_grid_top3(...)` mit denselben Metriken (AC-5, Vergleich Modell vs. „Podium = Grid ≤ 3"). `confusion_figure`/`calibration_figure` über die OO-Matplotlib-API (kein pyplot/Display). AUC→NaN bei nur einer Klasse.
- **Verify:** 3 Tests (alle Metriken in Range; Baseline finite; beide Figures bauen ohne Display) auf trainiertem Synthetik-Modell. ruff + mypy (9) + pytest (32) grün.

### T9 — SHAP (`explain.py`) — DONE

- **Output:** `global_importance(model, x)` (mean|SHAP| je Feature, absteigend) + `one_prediction_shap(model, row)` (signierte Beiträge) via `shap.TreeExplainer`; `importance_figure`/`one_prediction_figure` als robuste Matplotlib-OO-Barplots (kein shap-Plotting/Display). Positive Klasse aus 3D-SHAP extrahiert. (AC-6)
- **Verify:** 3 Tests (Importance deckt alle Features ab + ≥0; per-Prediction ein Wert je Feature; beide Figures bauen) → ruff + mypy (10) + pytest (45) grün.

### T10 — Artefakt + Model-Card (`artifact.py`)

- **Output:** `render_model_card(ModelCardMeta)` (Markdown im Code statt externem Template — nichts zu verlieren), `write_local`/`upload_s3` (boto3), `publish(...)` schreibt **immer** lokal + lädt nach `models/<semver>/` hoch wenn Client+Bucket da, sonst Fallback `ml/artifacts/<semver>/` + Log. Pfade aus `layout.py` (Constitution IX, nie `latest/`).
- **Verify:** 3 Tests — Card enthält Metriken/Features/Baseline; `publish` schreibt model.json + model_card.md lokal (tmp_path); **S3-Upload gegen `moto`** landet an `model_artifact_key`/`model_card_key`. ruff + mypy (11) + pytest (49) grün.
- **Notes:** Card als Code-Template (statt `model_card_template.md`) — robuster/testbarer, kein File-IO-Risiko.

### T11 — Notebook (`ml/notebooks/train_podium_model.ipynb`) + Orchestrator (`ml/src/f1pred/pipeline.py`)

- **Output:** Die End-to-End-Verdrahtung (Data→Features→Split→Train→Eval→SHAP→Card) lebt in `pipeline.py` (`run_pipeline`), damit sie offline gegen synthetische Saisons unit-getestet ist (`tests/test_pipeline.py`). Das Notebook ist ein dünner Caller: lädt FastF1-Saisons, ruft `run_pipeline`, zeigt Metriken + Baseline + Plots + SHAP prominent (US-1/DoD), publisht das Artefakt.
- **Verify:** `pipeline.py` + `test_pipeline.py` grün in CI (offline, deterministisch). Notebook läuft top-to-bottom durch (Martin, mit FastF1-Cache → T12); Outputs committed.

### T12 — (Martin) Realer Trainingslauf + S3-Upload

- **Auszuführen (lokal, braucht FastF1-Download + AWS-Creds):** `pip install -r requirements.txt`, Notebook/CLI ausführen → Saisons laden, trainieren, evaluieren, `models/<semver>/model.json` + `model_card.md` nach S3 hochladen.
- **Verify:** Artefakt in S3; Score schlägt die Baseline; Re-Run mit gleichem Seed → gleicher Score (AC-8); Laufzeit < 10 Min (AC-9).

### T13 — Phase-3-Abschluss

- **Output:** README erwähnt Modell + Score (vs. Baseline), Architektur/Status aktualisiert. Spec-/Plan-Status → `done`. `git tag phase-3-done`.
- **Verify:** ML-Reviewer-Test: Notebook + Model-Card erklären Daten, Features, Eval und Limitations ohne mündliche Erklärung.
