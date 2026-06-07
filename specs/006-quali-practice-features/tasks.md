# Tasks: Quali- & Practice-Features (Modell 0.2.0)

> **Plan:** [plan.md](./plan.md)
> **Status:** draft — zur Review, noch kein Code.

Reihenfolge bewusst: geteilter Feature-Vertrag zuerst → pure Helfer + Pipeline
(offline + in CI testbar) → Data-Layer-Verdrahtung → Backfill + Training + Eval
(Martin, FastF1/Creds) → Artefakt → Inference-Live-Practice → Deploy + realer
Pre-Race-Lauf + Abschluss. Alles ohne Netz/Creds läuft in CI; FastF1-Backfill,
Training, Upload, Deploy und der reale Lauf führt Martin aus (**(Martin)** markiert).

## Konventionen

- `[ ]` offen, `[~]` in Arbeit, `[x]` erledigt. Jeder Task = ein Commit
  (`feat(phase-6/TX): …`), Spec-/Plan-Änderungen separat.
- Jeder Task hat **Output** + **Verify**. Python: Type-Hints, `ruff` + `mypy` +
  `pytest` grün, `logging` statt `print`. TS: `tsc` + `eslint` + `vitest` grün, Zod
  an Grenzen.
- Tasks ohne Netz/Creds laufen in CI; Backfill/Training/Deploy/realer Lauf = **(Martin)**.

## Fixierte Entscheidungen (aus plan.md „Offene Entscheidungen")

- **D-4 (Pace-Sessions):** Pace-Features aus **FP2 + FP3** (beste Pace + Long-Run);
  `practice_laps_count` summiert **FP1–FP3**.
- **D-5 (Saison-Spanne):** Train ≤ 2023, Val 2024, Test 2025; Practice-Features erst
  ab **2019** (davor Fill-Policy). Final nach T6-Probelauf bestätigen.
- **D-6 (Fill-Konstanten):** `NEUTRAL_PRACTICE_PACE_GAP = 1.0` s, `NEUTRAL_LONG_RUN_GAP = 0.0` s,
  `practice_laps_count` fehlend → `0`. Werte in `features.py` dokumentiert.
- **D-7 (Sprint-Flag):** **kein** `is_sprint`-Feature im ersten Wurf (Fill-Policy reicht).
- **D-8 (Stint-Definition):** Long-Run = aufeinanderfolgende Runden ohne Box, Out-/In-Lap
  raus, Mindeststint **5 Runden**, **keine** Treibstoff-/Reifenkorrektur (dokumentierte
  Vereinfachung); Median der verbleibenden Runden, Gap zum Feld-Median.

## Aufgaben

### T1 — Feature-Vertrag erweitern (`ml/src/f1pred/schema.py`)

- **Output:** `FEATURE_NAMES` 6 → 12 (neue ans Ende, Reihenfolge ist Vertrag);
  `PodiumFeatures` += 6 Felder mit Ranges (`quali_segment_reached` 1–3,
  `quali_grid_delta` int, `quali_teammate_gap_s` float, `practice_best_pace_gap_s`
  float ≥ 0, `practice_long_run_pace_s` float, `practice_laps_count` int ≥ 0).
- **Verify:** `pytest ml/tests/test_schema.py` grün; `mypy` + `ruff` grün.

### T2 — Pure Quali-Helfer (`ml/src/f1pred/data.py`)

- **Output:** `_quali_segment_reached`, `_quali_grid_delta`, `_quali_teammate_gap`
  — pure Funktionen über ein Quali-Results-Frame, kein Netz. Teammate-Gap-Edge:
  kein klassifizierter Teamkollege → `NaN` (Fill in T4).
- **Verify:** neue Cases in `test_data.py` (inkl. Strafen-Delta, Q1-Aus, Solo-Teamkollege); `pytest` grün.

### T3 — Pure Practice-Helfer (`ml/src/f1pred/data.py`)

- **Output:** `_practice_best_pace_gap`, `_practice_long_run_pace` (D-8),
  `_practice_laps_count` — pure Funktionen über ein Laps-Frame. Out-/In-Lap-Filter,
  Mindeststint 5, Median, Gap zur Session-/Feld-Best/Median.
- **Verify:** `test_data.py`-Cases: kurzer Stint < 5, fehlende Session, Out-Lap-Filter,
  Einzel-Runde; `pytest` grün.

### T4 — Feature-Pipeline + Missing-Policy (`ml/src/f1pred/features.py`)

- **Output:** 6 neue Spalten durchreichen; `_DROP_IF_MISSING` **explizit** pflegen
  (Quali-Features drop, Practice-Features fill); Fill-Konstanten D-6
  (`NEUTRAL_PRACTICE_PACE_GAP`, `NEUTRAL_LONG_RUN_GAP`, laps→0); Teammate-Gap-NaN → Fill 0.0.
- **Verify:** `test_features.py`: 12 Spalten, Fill greift bei fehlender Practice,
  Drop bei fehlender Quali, Determinismus; **Leakage-Permutations-Test deckt 12 Features**; `pytest` grün.

### T5 — `RACE_COLUMNS` + FastF1-Loader verdrahten (`ml/src/f1pred/data.py`)

- **Output:** `RACE_COLUMNS` += 6 Spalten; `fastf1_load_race` lädt FP1–FP3
  (`load(laps=True, telemetry=False)`) + erweiterte Quali, ruft T2/T3-Helfer;
  `RateLimitExceededError` propagiert, fehlende Practice → NaN-Spalten (kein Drop).
- **Verify:** `load_seasons`-Orchestrierung mit injiziertem Fake-Loader getestet
  (kein Netz); `pytest` + `mypy` grün. FastF1-Pfad selbst = (Martin)/T6.

### T6 — Practice-Backfill (Notebook/Skript) **(Martin)**

- **Output:** inkrementeller Backfill 2019–2025 in `.fastf1-cache/`, Backoff +
  Resume bei Rate-Limit; Saison-Spanne D-5 nach Probelauf bestätigt/angepasst.
- **Verify:** Cache vollständig, Call-Budget eingehalten (kein 24/7), Lückenliste geloggt.

### T7 — Training 0.2.0 (`ml/notebooks/…`, `train.py`) **(Martin)**

- **Output:** Notebook trainiert `0.2.0` über 12 Features, fixer Seed,
  `scale_pos_weight`, HP übernommen (ggf. dokumentiert nachjustiert).
- **Verify:** Re-Run → gleicher Score (Determinismus); Training < 10 Min.

### T8 — Eval + Roll-out-Gate (`ml/src/f1pred/evaluate.py`)

- **Output:** Vergleich `0.2.0` **vs.** `0.1.0` auf gleichem Test-Split (Acc/Log-Loss/
  ROC-AUC/Kalibrierung/CM) + Baseline „grid ≤ 3"; Gate-Funktion (AC-4: ROC-AUC **und**
  Log-Loss besser → live).
- **Verify:** `test_evaluate.py` (Gate-Logik mit synthetischen Scores); `pytest` grün.
  Reale Zahlen + Gate-Entscheid im Notebook = (Martin).

### T9 — Artefakt + Model-Card 0.2.0 (`ml/src/f1pred/artifact.py`) **(Martin)**

- **Output:** `models/0.2.0/{model.json, history.csv, model_card.md}` nach S3
  (Pfade aus `layout.py`); Card: 12 Features begründet, Spanne, Backfill-Notiz,
  Metriken vs. `0.1.0`, Limitations (Sprint, Practice-Lücken). `0.1.0` unangetastet.
- **Verify:** S3-Objekte vorhanden; `0.1.0` unverändert; Card vollständig.

### T10 — Inference Live-Practice + Quali (`ml/src/f1pred/inference.py`)

- **Output:** `QUALI_COLUMNS` += neue Quali-Spalten, `fastf1_load_quali` berechnet sie;
  neuer `LoadPractice` + `fastf1_load_practice` (lazy, Rate-Limit propagiert);
  `build_race_features` baut Target-Zeile mit 12 Spalten, `_validate_row` erweitert.
- **Verify:** `test_inference.py` mit injiziertem Fake-Practice-Loader (12 Spalten,
  Fill bei fehlender Practice); `pytest` grün. Pure `handle_inference` unverändert.

### T11 — Adapter-Wiring + deutsche Feature-Labels

- **Output:** realer `load_features`-Adapter ruft zusätzlich `load_practice`;
  `bedrock_prompt.py` += deutsche Labels für die 6 neuen Features; `@f1/shared`
  `PredictionItemSchema`-Anzeige kennt neue SHAP-Feature-Namen.
- **Verify:** `pytest` + `vitest` + `pnpm typecheck`/`lint` grün.

### T12 — Deploy + realer Pre-Race-Auto-Run mit 0.2.0 **(Martin)**

- **Output:** Inference-λ auf `0.2.0` umgestellt (Modell-Version im Event/Config);
  realer Pre-Race-Lauf erzeugt Vorhersagen + Bedrock-Begründungen über 12 Features.
- **Verify:** Read-API liefert Predictions+Reasons des nächsten GP; Caching ok;
  Silence-Alarm grün. Bei schlechterem Gate (T8) → `0.1.0` bleibt aktiv, dokumentiert.

### T13 — Abschluss

- **Output:** README + Phasen-Tabelle aktualisiert (Const. XII); Spec-Status →
  `done`; `git tag phase-6-done`.
- **Verify:** CI grün auf `main`; Tabelle spiegelt deployten Stand.
