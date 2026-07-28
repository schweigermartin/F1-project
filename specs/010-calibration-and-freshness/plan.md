# Plan: Kalibrierung & Aktualität (Phase 010)

> Spec: [`spec.md`](./spec.md) · Tasks: [`tasks.md`](./tasks.md)

## 1. Überblick

Vier voneinander unabhängige Bausteine, in dieser Reihenfolge committbar:

| Block | Was                                     | Wo                                     |
| ----- | --------------------------------------- | -------------------------------------- |
| **A** | Normalisierung auf drei Plätze          | `@f1/shared` → Read-API → Frontend     |
| **B** | Grid-Baseline sichtbar                  | Frontend, ohne neue Fetches            |
| **C** | Trainingsfenster offenlegen             | Frontend, statisch aus `model_version` |
| **D** | History-Refresh für die laufende Saison | `ml/` (pure Funktion + CLI)            |

A ist der Kern, B und C sind klein, D ist die Voraussetzung für das spätere
Neu-Training.

## 2. Block A — Normalisierung

### 2.1 Warum kein Temperature-Scaling

Naheliegend wäre eine Temperatur α auf den Log-Odds:
`p'ᵢ = σ(α · logit(pᵢ))`. Das funktioniert hier **nicht**. Für α → ∞ geht jede
Wahrscheinlichkeit > 0,5 gegen 1 und jede < 0,5 gegen 0, die Summe also gegen
`#{pᵢ > 0,5}`. In Runde 8 sind das 6 Fahrer — die Summe kann 3 nie erreichen,
egal wie groß α wird. Temperature-Scaling kann die Rangfolge schärfen, aber die
Gesamtmasse nicht unter die Zahl der Über-50-%-Fahrer drücken.

Ebenfalls verworfen: die simple Skalierung `pᵢ · 3 / Σp`. Sie trifft die Summe,
kann aber Werte > 1 erzeugen (Runde 10: 0,93 · 3/4,94 = 0,56 — hier nicht, aber
bei einem dominanten Feld sehr wohl) und verletzt damit AC-3.

### 2.2 Gewählt: Logit-Shift (Intercept-Korrektur)

Gesucht ist ein einziger additiver Versatz `b` im Log-Odds-Raum mit

```
Σᵢ σ(logit(pᵢ) + b) = slots        (slots = 3)
```

Eigenschaften, die genau die Acceptance Criteria treffen:

- **Streng monoton in `b`** (Summe von streng monoton wachsenden σ) → die Lösung
  ist eindeutig und per Bisektion sicher zu finden. Grenzwerte: `b → −∞` ⇒ Summe → 0,
  `b → +∞` ⇒ Summe → n. Für `n > slots` liegt das Ziel garantiert im Intervall.
- **Rangerhaltend** (AC-2): derselbe Versatz für alle, σ ist streng monoton ⇒
  die Ordnung bleibt exakt erhalten.
- **Wertebereich** (AC-3): σ bildet nach (0, 1) ab, per Konstruktion.

Der eigentliche Grund, warum das die _richtige_ Korrektur ist und nicht bloß
eine, die die Summe trifft: `train.py:57` setzt `scale_pos_weight = neg/pos`.
Eine Gewichtung der positiven Klasse verschiebt in einem logistischen Modell
genau den **Intercept** um ≈ `log(neg/pos)` — also einen konstanten Versatz auf
allen Log-Odds. Ein Logit-Shift ist die dazu passende inverse Operation. Er
korrigiert die eingebaute Verzerrung an der Stelle, an der sie entsteht, statt
die Symptome zu glätten.

**Was es nicht ist, und so wird es auch benannt:** keine gelernte Kalibrierung.
Platt/Isotonic/Beta brauchen einen Holdout-Fold und damit das Neu-Training
(Spec „Out of Scope"). Diese Normalisierung nutzt nur die _bekannte
Nebenbedingung_, dass ein Rennen drei Podiumsplätze hat. In der UI heißt sie
deshalb „auf drei Plätze normiert", nicht „kalibriert".

### 2.3 Randfälle

| Fall                        | Verhalten                            | Begründung                                                                                                        |
| --------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| leeres Feld                 | `[]`                                 | nichts zu normieren                                                                                               |
| `n ≤ slots`                 | alle `1.0`                           | bei ≤ 3 Fahrern fahren alle aufs Podium; die Summe kann `slots` nicht erreichen, `1.0` ist die korrekte Sättigung |
| `pᵢ ∈ {0, 1}`               | auf `[ε, 1−ε]` geklemmt              | `logit` wäre sonst ±∞                                                                                             |
| Summe bereits exakt `slots` | `b ≈ 0`, Werte praktisch unverändert | Fixpunkt                                                                                                          |
| alle `pᵢ` gleich            | alle `slots/n`                       | symmetrisch korrekt                                                                                               |

Bisektion über `b ∈ [−100, +100]`, Abbruch bei `|Σ − slots| < 1e-9` oder 200
Iterationen (deterministisch, kein Solver-Import).

### 2.4 Datenfluss — bewusst auf dem **Lesepfad**

```
Inferenz-λ ──schreibt rohe predict_proba──▶ DynamoDB (unverändert)
                                                │
                                     Read-API ──┤ normalisiert beim Serialisieren
                                                ▼
                                          Frontend zeigt normiert
```

Der Grund für den Lesepfad statt des Schreibpfads ist AC-4: die elf bereits
gespeicherten Rennen werden dadurch **ohne Backfill** korrekt, und die rohe
Modellausgabe bleibt als Audit-Spur erhalten. DDB bleibt „was das Modell sagte",
die API liefert „was das für dieses Rennen bedeutet".

### 2.5 Vertragsänderung

`PredictionWithExplanationSchema` bekommt ein **optionales** Feld:

```ts
podium_probability_normalized: z.number().min(0).max(1).optional();
```

`PredictionItemSchema` (= die DDB-Zeile) bleibt unangetastet — das Feld existiert
nur auf der Leitung, nie im Speicher.

`PREDICTION_API_SCHEMA_VERSION` bleibt bei `1`. Das ist Absicht und der Grund
ist AC-5: Read-API (Lambda) und Frontend (Vercel) deployen getrennt. Ein
`z.literal`-Bump würde in der Lücke dazwischen jede Antwort hart abweisen. Ein
_additives, optionales_ Feld ist in beide Richtungen verträglich — altes
Frontend ignoriert es (Zod strippt unbekannte Keys), neues Frontend fällt über
den Helper auf `podium_probability` zurück. Der Versions-Literal bleibt dem
vorbehalten, was er absichern soll: **brechende** Formänderungen.

### 2.6 Dateien

| Datei                                                       | Änderung                                                               |
| ----------------------------------------------------------- | ---------------------------------------------------------------------- |
| `packages/shared/src/podium-normalize.ts`                   | **neu** — `normalizePodiumProbabilities`, `effectivePodiumProbability` |
| `packages/shared/__tests__/podium-normalize.test.ts`        | **neu** — AC-1/2/3 + alle Randfälle aus 2.3                            |
| `packages/shared/src/index.ts`                              | Re-Export                                                              |
| `packages/shared/src/prediction-schema.ts`                  | optionales Feld + Doku warum ohne Version-Bump                         |
| `infra/lambda/predictions-api/handler.ts`                   | Normalisierung vor `PredictionApiResponseSchema.parse`                 |
| `apps/predictor/src/lib/predictions-api.ts`                 | `sortByPodium` sortiert über den Helper                                |
| `apps/predictor/src/components/predictions/PodiumBoard.tsx` | zeigt den normierten Wert                                              |

## 3. Block B — Grid-Baseline

Alle nötigen Daten liegen bereits auf der Seite (`app/page.tsx:154-172`):
`gridR` (`getQualifyingGrid`), `predR` (Vorhersage), `resultR`/`finalTop3`
(Jolpica-Ergebnis). Deshalb **kein neuer Fetch** (AC-8) — die Komponente ist
rein präsentational und bekommt die drei Listen als Props.

Neue Komponente `apps/predictor/src/components/predictions/BaselineComparison.tsx`:

- rendert `null`, solange kein Endergebnis vorliegt (vor dem Rennen gibt es
  nichts zu vergleichen) — konsistent mit dem `null`-Verhalten von `GridVsPrediction`
- zählt Schnittmengen `|top3 ∩ actual|` für Modell und Grid, jeweils „x von 3"
- führt den Stichprobenvorbehalt aus Spec (3) sichtbar mit

Die Zählfunktion `top3Overlap` kommt in `apps/predictor/src/lib/live-diff.ts`
(dort liegt bereits die Vergleichslogik gegen `ActualSlot` — Constitution III,
keine zweite Vergleichsimplementierung) und wird dort mitgetestet.

## 4. Block C — Trainingsfenster offenlegen

Statische, versionsgebundene Herkunftsangabe in `@f1/shared`:

```ts
MODEL_PROVENANCE: Record<string, { trainedSeasons: string; historyThrough: string }>;
```

`0.2.0 → { trainedSeasons: "2022–2025", historyThrough: "2025" }`, plus ein
Fallback für unbekannte Versionen. Begründung für den Ort: die Angabe gehört zum
Modellvertrag, nicht zum Frontend, und die Model Card führt dieselben Zahlen
(Constitution IX). `PodiumBoard` rendert sie unter den Balken (AC-6).

## 5. Block D — History-Refresh

### 5.1 Reine Funktion

`ml/src/f1pred/history.py`:

```python
def append_races(history: pd.DataFrame, new_races: pd.DataFrame) -> pd.DataFrame
```

- beide auf `RACE_COLUMNS` normalisiert (der Vertrag aus `data.py`)
- Dedupe auf `(year, round, driver)`, **neue Zeile gewinnt** (Korrektur eines
  nachgetragenen Ergebnisses soll durchschlagen)
- stabil sortiert nach `(year, round)` → AC-9 (Idempotenz folgt aus Dedupe +
  deterministischer Sortierung)

Die `.shift(1)`-Garantie (AC-10) wird nicht angefasst: `build_features` leitet
die rollierenden Features aus der Reihenfolge des Frames ab, und die bleibt nach
`(year, round)` sortiert. Der Test dazu ist explizit: History um ein Rennen
verlängern und prüfen, dass die Features der _vorherigen_ Rennen unverändert
bleiben.

### 5.2 CLI

`ml/scripts/refresh_history.py` — dünner Adapter, analog `backfill_practice.py`:

```
python scripts/refresh_history.py --version 0.2.0 --year 2026 --rounds 1-11 [--dry-run]
```

lädt `models/<version>/history.csv` aus S3, holt die Rennen über das bestehende
`data.fastf1_load_race` (kein zweiter Ladepfad), `append_races`, schreibt lokal
und lädt via `artifact.upload_s3`-Pfad hoch. `--dry-run` schreibt nur lokal.

**Wichtig und in der Task vermerkt:** Der reale Lauf braucht FastF1 + Netz +
AWS-Credentials und ist deshalb **nicht** Teil von CI. Getestet wird die reine
Funktion; der CLI-Lauf ist ein manueller Schritt mit dokumentiertem Ergebnis.

## 6. Tests (Constitution X)

| Ebene             | Was                                                                                                                         |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `packages/shared` | Normalisierung: Summe = slots, Rangerhaltung, Wertebereich, alle Randfälle aus 2.3, Idempotenz (zweimal normieren = einmal) |
| `packages/shared` | Schema: Antwort mit und ohne das neue Feld parst                                                                            |
| `infra`           | Read-API: Antwort trägt normierte Werte, Summe = 3, Rohwert unverändert                                                     |
| `apps/predictor`  | `top3Overlap` inkl. leerer/unvollständiger Eingaben                                                                         |
| `ml`              | `append_races`: Dedupe, Idempotenz, Sortierung, Leakage-Invarianz (AC-10)                                                   |

## 7. Risiken

| Risiko                                                      | Umgang                                                                           |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Bisektion konvergiert nicht                                 | festes Intervall + Iterationsdeckel; Test mit extremen Eingaben (alle 0, alle 1) |
| Normierte Werte wirken „schlechter" (kein 94-%-Balken mehr) | genau das ist der Punkt — die UI benennt die Bedeutung explizit (AC-6)           |
| Frontend/Lambda-Deploy-Reihenfolge                          | optionales Feld + Fallback-Helper (AC-5), kein Versions-Bump                     |
| FastF1-Rate-Limit beim Refresh                              | CLI läuft manuell, rundenweise, mit `--dry-run`; kein CI-Pfad                    |
