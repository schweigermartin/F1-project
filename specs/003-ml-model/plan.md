# Plan: ML Model

> **Spec:** [spec.md](./spec.md)
> **Status:** draft

## Architektur

Eine reine Offline-Pipeline im `ml/`-Python-Workspace (kein pnpm, eigene Toolchain). FastF1 lädt historische Renn-/Quali-/Wetterdaten (lokaler Cache), eine modulare Feature-Pipeline baut **leakage-freie, pre-race-bekannte** Features pro (Rennen, Fahrer), ein zeitlicher Split trennt Train/Val/Test, XGBoost trainiert den binären Podium-Klassifikator, Evaluation + SHAP erzeugen die Notebook-Outputs, und ein Artefakt-Schritt schreibt `model.json` + `model_card.md` versioniert nach S3.

```
FastF1 (2018–2025)                 Phase-1 S3-Archiv (optional, später)
   │ cache: .fastf1-cache/                │
   ▼                                      ▼
┌──────────────┐   load.py        ┌──────────────────────┐
│ data layer   │─────────────────▶│ raw race+quali frames│
└──────────────┘                  └─────────┬────────────┘
                                            │ features.py (pure, getestet)
                                            ▼
                                  ┌──────────────────────┐
                                  │ feature matrix X, y   │  y = podium (≤3)
                                  └─────────┬────────────┘
                                            │ split.py (zeitlich)
                          ┌─────────────────┼─────────────────┐
                          ▼                 ▼                 ▼
                       train (≤2023)     val (2024)        test (2025)
                          │
                          ▼ train.py (XGBoost + scale_pos_weight)
                  ┌──────────────┐
                  │  model       │──▶ evaluate.py (Acc/LogLoss/AUC/Kalibrierung/CM vs Baseline)
                  └──────┬───────┘──▶ shap (global + per-row)
                         │ artifact.py
                         ▼
            s3://<bucket>/models/<semver>/{model.json, model_card.md}
```

Das **Notebook** (`ml/notebooks/train_podium_model.ipynb`) orchestriert diese Module sichtbar (US-1); die Module sind importierbar + getestet, damit das Notebook dünn bleibt und die Logik nicht in Zellen versteckt ist.

## Komponenten

### 1. Data Layer (`src/f1pred/data.py`)

- **Verantwortung:** FastF1-Sessions laden (Race-Results, Qualifying, Weather) für eine Saison-Spanne, in pandas-Frames normalisieren. Cache in `.fastf1-cache/`.
- **In/Out:** Saison-Liste → `RaceFrame` (eine Zeile pro Rennen×Fahrer mit Roh-Spalten) + Quali-Frame.
- **Failure-Mode:** Fehlende Session (alte Saison ohne Quali-Daten) → Rennen wird übersprungen + geloggt (R-4), nicht imputiert.

### 2. Target (`src/f1pred/target.py`)

- **Verantwortung:** `podium = (finishing_position <= 3)` als 0/1. DNF/NC → kein Podium (0).
- **Pure + getestet:** deterministisch aus der Ergebnis-Spalte.

### 3. Feature-Pipeline (`src/f1pred/features.py`)

- **Verantwortung:** Pro (Rennen, Fahrer) **nur pre-race-bekannte** Features bauen:
  - `grid_position` (Startplatz)
  - `quali_gap_to_pole_s` (bestes Quali-Delta zur Pole, Sekunden)
  - `driver_form` (Ø Punkte/Platzierung der letzten N=5 Rennen, **streng vor** diesem Rennen)
  - `constructor_form` (Team-Ø der letzten N Rennen)
  - `track_history` (Ø Endplatz des Fahrers auf diesem Circuit in Vorsaisons)
  - `is_wet` (Regen-Flag aus Wetter/Session-Status)
- **Failure-Mode:** Zeile mit fehlendem Pflicht-Feature → verworfen (dokumentiert). Form-Features für die ersten N Rennen einer Karriere → NaN → Zeile verworfen oder neutral, im Plan festgelegt (Default: verwerfen für sauberes Signal).
- **Anti-Leakage-Invariante:** die Funktion bekommt **niemals** Renn-Ergebnis-Spalten außer für rolling-Form, die **shifted** (nur Vergangenheit) berechnet wird. Test erzwingt: Feature-Output ändert sich nicht, wenn man die Ergebnis-Spalte des aktuellen Rennens permutiert.

### 4. Temporal Split (`src/f1pred/split.py`)

- **Verantwortung:** Split nach Renn-Datum/Saison: Train ≤ 2023, Val = 2024, Test = 2025 (Q-2; final je FastF1-Verfügbarkeit). Kein Shuffle.
- **Pure + getestet:** keine Test-Zeile hat ein Datum ≤ einer Train-Zeile (Ordnungs-Invariante).

### 5. Training (`src/f1pred/train.py`)

- **Verantwortung:** `xgboost.XGBClassifier` mit fixem `random_state`, `scale_pos_weight = neg/pos` aus dem Train-Set (AC-4), dokumentiertem Default-HP-Set, Early-Stopping auf Val.
- **Out:** trainiertes Booster-Objekt + die genutzte Feature-Reihenfolge.

### 6. Evaluation (`src/f1pred/evaluate.py`)

- **Verantwortung:** Auf Test: Accuracy, Log-Loss, ROC-AUC, Konfusionsmatrix, Kalibrierungs-Kurve. **Baseline**: „Podium = grid_position ≤ 3" → dieselben Metriken zum Vergleich (AC-5).
- **Out:** Metrik-Dict + Matplotlib-Figures (im Notebook gezeigt).

### 7. SHAP (`src/f1pred/explain.py`)

- **Verantwortung:** `shap.TreeExplainer` → globaler Summary-Plot + mindestens ein per-Vorhersage-Plot (z. B. ein überraschendes Podium). (AC-6)

### 8. Artefakt (`src/f1pred/artifact.py`)

- **Verantwortung:** `booster.save_model("model.json")`, `model_card.md` aus Template + gemessenen Metriken rendern, beide nach `models/<semver>/` in S3 (boto3). Semver vergibt der Aufrufer (Notebook/CLI-Flag), nie `latest/` (Constitution IX).
- **Failure-Mode:** Upload braucht AWS-Creds (Martin); ohne Creds schreibt es lokal nach `ml/artifacts/<semver>/` und meldet das.

## Datenmodelle

- **Feature-Schema:** ein `pydantic`-Modell (oder `dataclass` + Validierung) `PodiumFeatures` mit den 6 Feldern (Typen + erlaubte Ranges), Single Source der Feature-Namen/-Reihenfolge — geteilt von Training und (Phase-4-)Inference.
- **S3-Layout:** spiegelt `@f1/shared` `S3_PATHS.modelArtifact(version)` = `models/<version>/model.json`, `modelCard(version)` = `models/<version>/model_card.md`. Eine Python-Konstante hält dasselbe Layout (kein Magic-String), mit Verweis auf die TS-Quelle.
- **`model_card.md`:** Daten (Saisons, FastF1-Version), Features (+ Begründung), Split, HP, Metriken vs. Baseline, Limitations (Imbalance, Datenlücken, kein Live-Signal).

## Externe Verträge

- **FastF1:** `fastf1.get_session(year, round, 'R'|'Q')`, `.load()`, Results/Weather-Frames. Cache via `fastf1.Cache.enable_cache('.fastf1-cache/')`. Version in `requirements.txt` gepinnt (Reproduzierbarkeit).
- **S3:** Bucket `f1-data-<account>-<region>`, Pfade wie oben. Nur PutObject auf `models/*`.
- **Kein Bedrock/kein Live-API** in Phase 3.

## Security & IAM

- Upload nutzt das lokale AWS-Profil (Martin), least privilege: `s3:PutObject` auf `models/*`. Kein neuer IAM-Stack — der Upload ist ein lokales Skript, kein Lambda. (Phase 4 baut die Inference-Rolle.)
- Keine Secrets; FastF1 ist key-frei.

## Observability

- Strukturierte Logs (`logging`, JSON-Formatter optional) in den Modulen statt `print` (Constitution / Martins Python-Konvention).
- „Observability" hier = das Notebook: Metriken, Plots, Baseline-Vergleich prominent. Kein CloudWatch (kein Live-System).

## Kosten-Footprint

| Posten                | Annahme                       | €      |
| --------------------- | ----------------------------- | ------ |
| FastF1-Download       | einmalig, lokaler Cache       | 0      |
| Training              | lokal, < 10 Min CPU           | 0      |
| S3-Storage (Artefakt) | model.json + card ≈ wenige MB | ~0     |
| **Gesamt**            |                               | **≈0** |

Klar im 5-USD-Budget (Constitution IV); der Footprint steht so im `model_card.md`.

## Test-Strategie

Pytest im `ml/`-Workspace (Constitution X — Feature-Pipeline, **nicht** das Modell):

- **`test_target.py`:** Podium-Label korrekt (≤3 → 1, DNF → 0).
- **`test_features.py`:** Determinismus (gleicher Input → gleicher Output), **Anti-Leakage** (Permutation der aktuellen Ergebnis-Spalte ändert Features nicht), rolling-Form nutzt nur Vergangenheit (shift), fehlende Pflichtfelder → Zeile verworfen.
- **`test_split.py`:** zeitliche Ordnung (kein Test-Datum ≤ Train-Datum), keine Überlappung.
- **Fixtures:** kleine synthetische Renn-Frames (ein paar Rennen, ~6 Fahrer) — **kein FastF1-Download im Test** (offline, deterministisch). Optional ergänzt durch die Phase-1-OpenF1-Fixtures.
- **CI:** den `python-lint`-Job in `.github/workflows/ci.yml` aktivieren (`if: false` → `true`): `ruff check ml/`, `mypy`, `pytest`.

## Abweichungen von der Constitution

Keine. (Der finale Trainingslauf + S3-Upload braucht FastF1-Download + AWS-Creds und wird — wie der Phase-2-Deploy — lokal von Martin ausgeführt; der Code + die Tests sind CI-grün ohne Netzwerk.)
