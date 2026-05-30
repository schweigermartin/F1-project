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

### T2 — S3-Layout + Feature-Schema

- **Output:** `f1pred/layout.py` — Modell-Pfad-Helfer spiegeln `@f1/shared` `S3_PATHS` (`models/<semver>/model.json`, `model_card.md`), mit Verweis auf die TS-Quelle (Single Source, Constitution III). `f1pred/schema.py` — `PodiumFeatures` (pydantic) mit den 6 Feldern + Feature-Reihenfolge als Konstante.
- **Verify:** Tests: Pfad-Bauer korrekt, Schema lehnt fehlende/typfalsche Felder ab.

### T3 — Target (`target.py`)

- **Output:** `podium_label(results_df)` → 0/1 (`finishing_position <= 3`; DNF/NC → 0). Pure.
- **Verify:** Test: ≤3 → 1, 4+/DNF → 0, deterministisch.

### T4 — Temporal Split (`split.py`)

- **Output:** `temporal_split(df, train_max_year, val_year, test_year)` → (train, val, test) ohne Shuffle, nach Renn-Datum.
- **Verify:** Test: keine Test-Zeile mit Datum ≤ Train, keine Überlappung, leere Spanne sauber behandelt.

### T5 — Feature-Pipeline (`features.py`)

- **Output:** `build_features(races_df, quali_df)` → Feature-Matrix mit `grid_position`, `quali_gap_to_pole_s`, `driver_form`, `constructor_form`, `track_history`, `is_wet`. Rolling-Form **shifted** (nur Vergangenheit). Zeilen mit fehlenden Pflicht-Features dokumentiert verworfen.
- **Verify:** Tests (Kern, Constitution X): Determinismus; **Anti-Leakage** (Permutation der aktuellen Ergebnis-Spalte ändert Features nicht); rolling-Form nutzt nur frühere Rennen; fehlende Pflichtfelder → Zeile weg. Fixtures = kleine synthetische Frames, **kein FastF1**.

### T6 — Data Layer (`data.py`)

- **Output:** `load_seasons(years)` — FastF1 Race+Quali+Weather → normalisierte Frames, Cache `.fastf1-cache/`. Fehlende Session → skip + log (R-4).
- **Verify:** Dünn + DI-fähig (Session-Loader injizierbar); Test gegen einen gemockten/aufgezeichneten Mini-Frame, kein echter Download in CI.

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
