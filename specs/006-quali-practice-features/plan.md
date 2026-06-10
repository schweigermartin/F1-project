# Plan: Quali- & Practice-Features (Modell 0.2.0)

> **Spec:** [spec.md](./spec.md)
> **Status:** done — umgesetzt, Modell 0.2.0 deployed (README Phase 6)
> **Phasen 3+4 werden erweitert, nicht neu gebaut.**

## Architektur

Kein neuer Stack, kein neues Modul-Gerüst. Wir erweitern die bestehende Phase-3-Pipeline (`ml/src/f1pred/`) um Practice-Lap-Daten und reichere Quali-Größen und trainieren `0.2.0` über dasselbe Notebook. Die Phase-4-Inference bekommt **einen** zusätzlichen Live-Loader (Practice), eingehängt am bestehenden `load_features`-Boundary — der pure `handle_inference`-Handler bleibt unverändert.

**Zentrale Design-Erkenntnis:** Die 6 neuen Features sind alle **per-race-passthrough** (aus den eigenen Quali/Practice-Sessions des jeweiligen Rennens), keine rolling-Aggregate. Folgen:

- `build_features` reicht sie nur durch (wie heute `grid_position`/`quali_gap_to_pole_s`/`is_wet`), kein `.shift` nötig.
- `history.csv` speist nur die **rolling**-Features (`points`, `finish_position`) → bleibt schema-gleich, **muss nicht neu gebaut werden** für die neuen Spalten. Das hält den Inference-Pfad und das Backfill-Risiko klein: Practice-Backfill ist **nur fürs Training** nötig, nicht für `history.csv`.
- Am Inference kommt das neue Signal aus dem Live-Fetch der Sessions des anstehenden Wochenendes.

```
TRAINING (offline, ml/)                         INFERENCE (λ, Phase 4)
FastF1: R + Q + FP1/FP2/FP3                      load_features(date, round, ver):
   │ cache .fastf1-cache/                          ├─ history.csv  (rolling, unverändert)
   ▼                                               ├─ live Quali   (passthrough, bestehend)
 data.py  ── neue Spalten ──▶ RACE_COLUMNS+6       └─ live Practice(passthrough, NEU)
   ▼                                                        │
 features.py  (passthrough + rolling, 12 cols)              ▼ build_race_features (12 cols)
   ▼                                               predict_podium → DDB + Bedrock (unverändert)
 split.py (zeitlich) → train.py (XGBoost)
   ▼
 evaluate.py: 0.2.0 vs 0.1.0 (gleicher Test-Split)  ── Roll-out-Gate
   ▼ artifact.py
 s3://…/models/0.2.0/{model.json, history.csv, model_card.md}   (0.1.0 bleibt)
```

## Komponenten (Änderungen pro Datei)

### 1. Feature-Vertrag — `schema.py` (+ `packages/shared`)

`FEATURE_NAMES` 6 → 12 (neue ans Ende, Reihenfolge ist Vertrag). `PodiumFeatures` bekommt 6 Felder mit Ranges:

| Feld                       | Typ   | Range / Hinweis                 |
| -------------------------- | ----- | ------------------------------- |
| `quali_segment_reached`    | int   | 1–3                             |
| `quali_grid_delta`         | int   | z.B. −20…+20 (Grid − Quali-Pos) |
| `quali_teammate_gap_s`     | float | signiert (kann negativ sein)    |
| `practice_best_pace_gap_s` | float | ≥ 0 (Gap zur Session-Best)      |
| `practice_long_run_pace_s` | float | signiert (Gap zum Feld-Median)  |
| `practice_laps_count`      | int   | ≥ 0                             |

`_validate_row` in `inference.py` und die TS-`PredictionItemSchema`-Anzeige bleiben konsistent (Const. III/VI). `bedrock_prompt.py` bekommt deutsche Klartext-Labels für die 6 neuen Feature-Namen (für die SHAP-Begründung).

### 2. Data Layer — `data.py`

- `RACE_COLUMNS` += die 6 neuen Spalten.
- `fastf1_load_race` lädt zusätzlich die Practice-Sessions (FP1–FP3) und berechnet die Practice-Spalten; Quali-Load wird um Segment/Position/Teammate-Gap erweitert.
- Neue **pure, getestete** Helfer (kein Netz):
  - `_quali_segment_reached(qres, code)` → 3 wenn Q3-Zeit gesetzt, sonst 2/1.
  - `_quali_grid_delta(grid, quali_pos)`.
  - `_quali_teammate_gap(qres, code, constructor)`.
  - `_practice_best_pace_gap(laps, code)` → schnellste Runde vs. Session-Best.
  - `_practice_long_run_pace(laps, code)` → Median der Stint-Runden vs. Feld-Median (Stint = aufeinanderfolgende Runden ohne Box; Out-/In-Laps raus).
  - `_practice_laps_count(laps, code)`.
- Practice-Lap-Daten: `session.load(laps=True, telemetry=False, weather=False)`. Welche Sessions zählen (FP2+FP3, FP1 nur für `laps_count`) → in tasks.md fixieren.
- **Failure-Mode:** fehlende Practice-Session → die betroffenen Spalten NaN, **kein** Renn-Drop (Policy in features.py). `RateLimitExceededError` propagiert (Backoff), wird nicht still verworfen (R-1/R-4).

### 3. Feature-Pipeline — `features.py`

- Neue Spalten werden **durchgereicht** (sie sind schon in `races`).
- **Missing-Policy (R-3), pro Feature:**
  - `practice_laps_count` NaN → **0** (Session nicht gefahren = 0 Runden, valider Zustand).
  - `practice_best_pace_gap_s` / `practice_long_run_pace_s` NaN → **neutraler Konstanten-Fill** (analog `NEUTRAL_TRACK_HISTORY`, keine Datenabhängigkeit → kein Leakage). Neue Konstanten dokumentiert.
  - `quali_segment_reached` / `quali_grid_delta` / `quali_teammate_gap_s` NaN → da Quali Pflicht-Signal ist, gehören sie in `_DROP_IF_MISSING` (kein Quali = kein Signal, wie heute). Teammate-Gap-Sonderfall (kein Teamkollege klassifiziert) → neutraler Fill statt Drop.
- `_DROP_IF_MISSING` wird **explizit** gepflegt (nicht „alle außer track_history"), weil jetzt mehrere Features eine Fill-Policy haben.

### 4. Split / Training / SHAP — `split.py`, `train.py`, `explain.py`

- Weitgehend unverändert: alle lesen `FEATURE_NAMES`. `scale_pos_weight`, Seed, HP-Set übernommen. Ggf. leichte HP-Nachjustierung, dokumentiert.

### 5. Evaluation — `evaluate.py`

- Neuer **Modell-zu-Modell-Vergleich**: `0.2.0` **und** `0.1.0` auf demselben zeitlichen Test-Split (Acc/Log-Loss/ROC-AUC/Kalibrierung/CM). Baseline „grid ≤ 3" bleibt. Output trägt das **Roll-out-Gate** (AC-4): `0.2.0` schlägt `0.1.0` bei ROC-AUC **und** Log-Loss → live, sonst dokumentierter Verzicht.

### 6. Artefakt — `artifact.py`, `layout.py`

- `layout.py` unverändert (Version ist Parameter). Upload nach `models/0.2.0/`. `history.csv` schema-gleich neu publishen (nur für Vollständigkeit des Artefakts; Inhalt = rolling-Quellspalten). `0.1.0` bleibt unangetastet (Fallback).
- `model_card.md`: 12 Features begründet, Saison-Spanne, Backfill-Notiz, Metriken vs. `0.1.0`, Limitations (Sprint, Practice-Lücken).

### 7. Inference Live-Practice — `inference.py` + Adapter

- `QUALI_COLUMNS` += neue Quali-Spalten; `fastf1_load_quali` berechnet sie.
- Neuer `LoadPractice = Callable[[str, int], pd.DataFrame | None]` + `fastf1_load_practice` (lazy FastF1, Rate-Limit propagiert), liefert per-Fahrer die 3 Practice-Spalten.
- `build_race_features` baut die Target-Zeile mit allen 12 passthrough/rolling-Spalten; Practice/Quali werden per `driver_code` gemergt.
- Der **reale** `load_features`-Adapter (index/handler-Wiring) ruft zusätzlich `load_practice` auf. Der pure `handle_inference` ändert sich **nicht** (Boundary bleibt `load_features`).

## Datenmodelle

- **Feature-Matrix:** 12 Spalten in `FEATURE_NAMES`-Reihenfolge; `is_wet`→0/1, neue ints/floats numerisch.
- **`history.csv`:** unverändertes Schema (rolling-Quellen). Bewusste Entscheidung, dokumentiert in der Model-Card.
- **S3:** `models/0.2.0/{model.json, history.csv, model_card.md}`, Pfade aus `layout.py`/`S3_PATHS`.

## Backfill-Strategie & FastF1-Call-Budget (R-1, das Hauptrisiko)

- Sessions/Rennen: heute 2 (R+Q) → bis 5 (+FP1/FP2/FP3). Practice mit `laps=True` ist der teuerste Load.
- **Saison-Spanne (Vorschlag):** Train ≤ 2023, Val 2024, Test 2025 wie `0.1.0`, aber Practice-Lap-Daten erst ab **2019** verlässlich (2018 ausgenommen → Form/Track-History dürfen weiter zurückreichen, Practice-Features ab 2019; ältere Rennen bekommen die Practice-Fill-Policy). Final in tasks.md, abhängig vom realen Rate-Limit-Verhalten.
- **Budget (grob):** ~7 Saisons × ~22 Rennen × 3 Practice-Loads ≈ **460 Practice-Loads**, jeder mehrere Ergast/F1-Calls → klar über 500/h. → **inkrementeller Backfill** über mehrere Stunden, **persistenter Cache** (`.fastf1-cache/`, einmalig, danach offline reproduzierbar), `RateLimitExceededError`-Backoff mit Resume aus Cache. Kein 24/7-Polling (Const. IV).
- **Inference-Budget:** pro Lauf nur die 3–4 Sessions des kommenden Wochenendes → unkritisch, bestehende Caching/Backoff-Mechanik greift (R-6).

## Sprint-Wochenenden (R-4)

- Nur FP1, dann Sprint-Quali → FP2/FP3 fehlen. Practice-Pace-Features greifen die Fill-Policy; `practice_laps_count` zählt nur FP1.
- **Offene Entscheidung für tasks.md:** zusätzliches `is_sprint`-Flag als 13. Feature? Default-Stance: **nein** für den ersten Wurf (Fill-Policy reicht, hält das Set schlank); nur falls das Eval auf Sprint-Rennen auffällig schwächelt.

## Leakage-Invarianten & Tests (Const. IX/X)

- Bestehender Permutations-Test (Renn-Ergebnis permutieren → Features unverändert) deckt jetzt 12 Features ab.
- Neuer Test: Practice/Quali-Werte eines Rennens stammen ausschließlich aus dessen eigenen Sessions (keine Vermischung über Rennen — die passthrough-Spalten haben keinen `.shift`-Pfad).
- Pure-Helfer (Segment/Delta/Teammate/Pace/Long-Run/Laps) je mit Unit-Test inkl. Missing/Sprint-Edge-Cases. Alles ohne Netz in CI (`pytest`); FastF1-Pfade nur im realen Lauf (Martin).
- Determinismus: fixer Seed + gepinnte Daten → gleicher Score bei Re-Run.

## Security & IAM

- Kein neuer IAM. Backfill + Upload via lokales Profil `private`, least privilege `s3:PutObject` auf `models/*`. FastF1 key-frei.
- Inference-λ-Rolle unverändert (liest weiter `models/*`); nur ein zusätzlicher Live-Fetch, keine neuen Permissions.

## Observability

- Strukturierte Logs für gedroppte/gefüllte Zeilen (welches Feature, warum) — Practice-Lücken müssen sichtbar sein, nicht still.
- Inference: bestehende `InferenceDrivers`-Metrik + Silence-Alarm decken den neuen Pfad ab; wenn Live-Practice fehlt, Vorhersage läuft (Fill-Policy) + Warn-Log.

## Kosten-Footprint

| Posten                   | Annahme                               | €      |
| ------------------------ | ------------------------------------- | ------ |
| FastF1 Practice-Backfill | einmalig, lokaler Cache, inkrementell | 0      |
| Training 0.2.0           | lokal, < 10 Min CPU                   | 0      |
| S3 `models/0.2.0/`       | wenige MB                             | ~0     |
| Inference Live-Practice  | +3–4 Session-Loads/Lauf, gecacht      | ~0     |
| **Gesamt**               |                                       | **≈0** |

Im 5-USD-Budget (Const. IV); steht so in der Model-Card.

## Test-Strategie

- `pytest` (pure Helfer, Feature-Pipeline, Missing/Sprint, Leakage) grün in CI; `ruff` + `mypy` grün.
- `vitest` für die erweiterte `@f1/shared`-Anzeige der neuen Features.
- Realer Lauf (Backfill, Training, Upload, Pre-Race-Auto-Run) = **(Martin)**, wie Phase 3/4.

## Offene Entscheidungen → tasks.md

1. Welche Practice-Sessions für Pace (FP2+FP3) vs. nur `laps_count` (FP1–FP3)?
2. Konkrete Saison-Spanne + Practice-Start-Jahr nach erstem Backfill-Probelauf.
3. Neutrale Fill-Konstanten für `practice_best_pace_gap_s` / `practice_long_run_pace_s`.
4. `is_sprint`-Flag ja/nein.
5. Stint-Definition für Long-Run (Mindest-Runden, Out/In-Lap-Filter, Treibstoff-/Reifenkorrektur ja/nein).
