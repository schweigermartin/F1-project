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

### T7 — Training (`train.py`)

- **Output:** `train_podium(X_train, y_train, X_val, y_val)` → `XGBClassifier`, fixer `random_state`, `scale_pos_weight = neg/pos`, dokumentiertes HP-Set, Early-Stopping auf Val.
- **Verify:** Test: trainiert auf synthetischem Set, gibt Booster zurück; **gleicher Seed → gleicher Score** (Reproduzierbarkeit, AC-8).

### T8 — Evaluation + Baseline (`evaluate.py`)

- **Output:** `evaluate(model, X_test, y_test)` → Accuracy/Log-Loss/ROC-AUC/Konfusionsmatrix + Kalibrierung; `baseline_grid_top3(...)` für denselben Vergleich. Plot-Helfer (Matplotlib).
- **Verify:** Test: Metrik-Dict-Shape auf synthetischem Set, Baseline deterministisch berechnet.

### T9 — SHAP (`explain.py`)

- **Output:** `shap_global(model, X)` + `shap_one(model, row)` (TreeExplainer) → Figures. (AC-6)
- **Verify:** Test: läuft auf dem synthetischen Modell ohne Fehler, liefert erwartete Shapes.

### T10 — Artefakt + Model-Card (`artifact.py`)

- **Output:** `save_model_json`, `render_model_card(metrics, meta)` aus Template, `upload(version)` nach `models/<semver>/` (boto3); ohne Creds Fallback `ml/artifacts/<semver>/` + Log. `model_card_template.md`.
- **Verify:** Test: lokaler Write + Card-Render (Metriken eingesetzt); S3-Upload gegen `moto`/Mock oder local-fallback-Pfad.

### T11 — Notebook (`ml/notebooks/train_podium_model.ipynb`)

- **Output:** orchestriert Data→Features→Split→Train→Eval→SHAP→Artefakt sichtbar; Metriken + Baseline + Plots prominent (US-1/DoD). Dünn — Logik in den Modulen.
- **Verify:** Notebook läuft top-to-bottom durch (Martin, mit FastF1-Cache); Outputs committed.

### T12 — (Martin) Realer Trainingslauf + S3-Upload

- **Auszuführen (lokal, braucht FastF1-Download + AWS-Creds):** `pip install -r requirements.txt`, Notebook/CLI ausführen → Saisons laden, trainieren, evaluieren, `models/<semver>/model.json` + `model_card.md` nach S3 hochladen.
- **Verify:** Artefakt in S3; Score schlägt die Baseline; Re-Run mit gleichem Seed → gleicher Score (AC-8); Laufzeit < 10 Min (AC-9).

### T13 — Phase-3-Abschluss

- **Output:** README erwähnt Modell + Score (vs. Baseline), Architektur/Status aktualisiert. Spec-/Plan-Status → `done`. `git tag phase-3-done`.
- **Verify:** ML-Reviewer-Test: Notebook + Model-Card erklären Daten, Features, Eval und Limitations ohne mündliche Erklärung.
