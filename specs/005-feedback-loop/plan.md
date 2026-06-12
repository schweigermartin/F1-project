# Plan: Feedback Loop

> **Spec:** [spec.md](./spec.md)
> **Status:** in progress
> **Bestehende Stacks werden erweitert, kein neuer Stack.**

## Architektur

Eine neue Node-λ `F1-Evaluation` schließt den Kreislauf: Archiver konsolidiert eine Session → Custom-EventBridge-Event → Evaluation-λ liest das Archiv (tatsächliches Ergebnis) und `F1Predictions` (Vorhersage), berechnet Top-3-Hit-Rate + Brier Score und schreibt beides zurück nach `F1Predictions`. Die bestehende Read-API bekommt einen `?season=`-Modus, das Predictor-Frontend einen Saison-Chart.

```
PipelineStack                              InferenceStack
┌──────────┐  konsolidiert    default bus  ┌──────────────────────────────┐
│ Archiver │ ──.jsonl──▶ S3   ──────────▶  │ Rule: f1.archiver/           │
│    λ     │  PutEvents:                   │   SessionArchived            │
└──────────┘  SessionArchived              │        │                     │
              {date, session_id}           │        ▼                     │
                                           │  Evaluation λ (NEU)          │
   OpenF1 /sessions ◀──── ist das ein ─────│   ├─ Race? round? (D-3)      │
   (2 Calls, Zod)         Rennen?          │   ├─ S3: raw/sessions/….jsonl│
                                           │   │   └─ letzter position-   │
                                           │   │      Tick pro Fahrer     │
                                           │   ├─ DDB: prediction#NN rows │
                                           │   ├─ hit_rate + brier        │
                                           │   └─ DDB schreiben:          │
                                           │      race#<d>#<r> / evaluation
                                           │      season#<y> / eval#<r>   │
                                           │        │                     │
                                           │        ▼                     │
                                           │  Read-API  ?season=<year>    │
                                           └──────────────────────────────┘
                                                    │
                                                    ▼
                                    Predictor-Frontend: Saison-Chart
```

**Warum InferenceStack statt 5. Stack:** (a) Alles, was `F1Predictions` liest/schreibt, lebt dann in einem Stack (Kohäsion, ein Blast-Radius); (b) das CloudWatch-Free-Tier endet bei 3 Dashboards — `f1-pipeline`, `f1-realtime`, `f1-inference` existieren schon, ein 4. kostete $3/Monat (Constitution IV). Die Feedback-Widgets wandern als neue Zeile ins bestehende `f1-inference`-Dashboard. Die Evaluation-Constructs werden per `Tags.of(...).add("Phase", "5")` einzeln getaggt, damit die Kosten-Attribution stimmt.

**Warum Archiver-Event statt S3-Notification (D-2):** S3-Object-Created feuert auch für jede Part-Datei (eine pro Poll-Tick, tausende pro Session); EventBridge kann Prefix+Suffix nicht sauber UND-verknüpft auf `…/parts/…` ausschließen, also müsste die λ das Rauschen selbst wegfiltern — tausende Invocations für nichts. Der Archiver weiß dagegen exakt, wann er eine Session konsolidiert hat, und feuert genau einmal.

## Komponenten (Änderungen pro Datei)

### 1. `@f1/shared` — Schemas + Keys (Constitution III/VI)

- **`ddb-keys.ts`:** `seasonPK(year)` → `season#<year>`, `evalSK(round)` → `eval#<NN>` (zero-padded wie `racePK`), `EVALUATION_SK = "evaluation"`.
- **`evaluation-schema.ts` (neu):**
  - `SEASON_API_SCHEMA_VERSION = 1`.
  - `RaceEvaluationSchema`: `race_date`, `round`, `season`, `model_version`, `n_drivers`, `top3_hit_rate` (0–1), `brier_score` (0–1), `predicted_top3` (3× `{driver_number, driver_code, podium_probability}`), `actual_top3` (3× `{driver_number, driver_code: string|null, position}` — Code aus der Prediction des Fahrers gemappt, `null` wenn ein Podium-Fahrer nicht vorhergesagt wurde), `evaluated_at`.
  - `SeasonEvaluationResponseSchema`: `{schema_version, season, races: RaceEvaluation[]}` (Races nach `round` aufsteigend).
  - `SessionArchivedDetailSchema`: `{date, session_id}` — der Event-Vertrag Archiver→Evaluation, von beiden Seiten importiert.
- Konstanten für den Event-Bus-Vertrag: `ARCHIVER_EVENT_SOURCE = "f1.archiver"`, `SESSION_ARCHIVED_DETAIL_TYPE = "SessionArchived"`.

### 2. Archiver — `infra/lambda/archiver/` (Trigger-Quelle, AC-1)

- **`handler.ts`:** neue DI-Dep `notifySessionArchived(date, session_id)`, aufgerufen pro konsolidierter Session **nach** put+delete. Notify-Fehler werden gefangen → Metrik `ArchiverNotifyFailures` + strukturiertes Error-Log, der Archive-Lauf selbst scheitert **nicht** (das Archiv ist durabel; ein verlorenes Event lässt sich manuell nachholen — Runbook). Begründung: würde der Lauf scheitern, wäre die Session beim Retry schon `skippedExisting` und das Event trotzdem weg.
- **`index.ts`:** wired `PutEventsCommand` (default bus) mit Source/DetailType aus `@f1/shared`.
- **PipelineStack:** `events:PutEvents` auf den Default-Bus für die Archiver-Rolle; Alarm auf `ArchiverNotifyFailures > 0`.

### 3. Evaluation-λ — `infra/lambda/evaluation/` (neu, Kern der Phase)

Gleiches Muster wie alle Pipeline-λ: pures `handler.ts` (DI), dünnes `index.ts` (AWS-Clients), `__tests__/handler.test.ts`.

`EvaluationDeps`: `fetchSessionByKey`, `fetchSeasonRaces` (beide OpenF1, Zod-validiert), `getArchiveText` (S3), `queryRace` (DDB Query auf `racePK`), `putItem` (DDB), `now`, `emitMetric`, `logger`.

Ablauf (pure Funktion `evaluateArchivedSession(detail, deps)`):

1. `SessionArchivedDetailSchema.parse(event.detail)`.
2. Session per `session_key` holen → kein Treffer = laut scheitern; `session_name !== "Race"` → `{skipped: "not-race"}` + Metrik, Ende (deckt Sprints ab, R-5).
3. `round` = 1-basierte Position unter den Race-Sessions der Saison, sortiert nach `date_start` — **identische Logik wie Schedule-Sync `raceRound`**, damit der PK exakt dem der Inference-λ entspricht (D-3).
4. `prediction#`-Rows unter `racePK(date, round)` laden, gegen `PredictionItemSchema` parsen. Keine → Metrik `EvaluationSkippedNoPredictions`, sauberes Ende (R-4).
5. Archiv `S3_PATHS.rawSession(date, session_id)` zeilenweise gegen `PipelineEventSchema` parsen, `endpoint === "position"`-Payloads gegen `z.array(PositionSchema)`; pro `driver_number` den Tick mit dem spätesten `date` behalten (Reihen-`date`, nicht `fetched_at` — robust gegen Batch-Reihenfolge).
6. Guard (R-3): < 3 Fahrer mit Positionsdaten → Error werfen (λ-Failure → Alarm). Tatsächliches Podium = finale Positionen 1–3.
7. Metriken: `predicted_top3` = 3 höchste `podium_probability` (Tie-Break `driver_number` aufsteigend, deterministisch); `top3_hit_rate = |∩| / 3`; `brier_score` = Mittel über **vorhergesagte** Fahrer von `(p − y)²`. Pure, separat getestete Funktion.
8. Zwei `PutItem`s desselben validierten `RaceEvaluation`-Payloads: `(racePK, "evaluation")` + `(seasonPK(year), evalSK(round))` — idempotent per Overwrite (AC-2). EMF: `EvaluationRuns`, `EvaluationHitRate`, `EvaluationBrier`.

### 4. InferenceStack — `infra/lib/inference-stack.ts`

- `NodejsFunction` `F1-Evaluation` (Node 20, ARM64, ESM, 512 MB, 2 min Timeout — das Race-Archiv ist einige MB JSONL).
- EventBridge-Rule auf den Default-Bus: `source = f1.archiver`, `detail-type = SessionArchived` → Target Evaluation-λ (mit DLQ? nein — bei Failure greift der Error-Alarm, Re-Run ist idempotent + manuell trivial; dokumentiert).
- IAM (least privilege): `s3:GetObject` auf `raw/sessions/*`; `dynamodb:Query` + `PutItem` auf `F1Predictions`. Kein Bedrock.
- **Alarm** `F1-Evaluation-Errors` (> 0, NOT_BREACHING bei Silence) → `f1-alerts` (AC-6).
- Dashboard `f1-inference`: neue Zeile — Hit-Rate/Brier über Zeit (`EvaluationHitRate`/`EvaluationBrier`, Maximum) + Eval-Invocations/Errors.
- `props.dataBucket` ist schon da; neuer Grant genügt.

### 5. Read-API — `infra/lambda/predictions-api/`

- `handler.ts`: Routing auf Query-Param — `?season=<year>` → Query `seasonPK(year)`, Items gegen `RaceEvaluationSchema`, sortiert nach `round`, Response gegen `SeasonEvaluationResponseSchema`; leere Saison → **200 mit `races: []`** (kein 404 — "noch nichts ausgewertet" ist ein normaler Zustand, AC-3 Empty-State). Bestehender `?race_date=&round=`-Modus unverändert.
- `index.ts`: unverändert bis auf das Durchreichen (Query ist bereits generisch über PK).
- IAM unverändert (`dynamodb:Query`).

### 6. Predictor-Frontend — `apps/predictor/`

- `lib/evaluations-api.ts` (neu): Server-side Fetch `${PREDICTIONS_API}?season=<year>`, Zod-validiert gegen das geteilte Schema, Fehler → `null` (gleicher Stil wie `lib/predictions-api.ts`).
- `components/SeasonPerformance.tsx` (neu): dependency-freier SVG-Chart (wie die bestehenden CSS-Balken — kein neues Chart-Package für 24 Datenpunkte): X = Runde, linke Serie Top-3-Hit-Rate (0–1), zweite Serie Brier Score; Tooltip/Labels mit Race-Datum + Modell-Version; Empty-State „Noch keine ausgewerteten Rennen".
- `app/page.tsx`: Server Component lädt Saison-Daten parallel zu den Predictions und rendert den Chart-Abschnitt darunter.
- Saison = Jahr des Target-Race (aus `schedule.ts` bereits vorhanden).

### 7. Doku — `docs/retraining-runbook.md` (neu, AC-4) + README

- Runbook: Backfill → Training-Notebook → Roll-out-Gate vs. aktive Version → `models/<semver>/` publishen → `ACTIVE_MODEL_VERSION` in `pipeline-stack.ts` flippen → `cdk deploy` → Smoke-Check. Plus Skizze „so würde man es automatisieren" (Step Functions + Fargate, warum nicht gebaut).
- README: Loop-Pfeil im Diagramm wird ✅, 1 Absatz Loop-Story, Phasen-Tabelle Phase 5 → deployed (am Ende), Live-URLs unverändert.

## Datenmodell (DDB `F1Predictions`)

| PK                | SK             | Inhalt                               | Writer       |
| ----------------- | -------------- | ------------------------------------ | ------------ |
| `race#<date>#<r>` | `prediction#`  | bestehend (Phase 4)                  | Inference-λ  |
| `race#<date>#<r>` | `explanation#` | bestehend (Phase 4)                  | Inference-λ  |
| `race#<date>#<r>` | `evaluation`   | `RaceEvaluation` (NEU)               | Evaluation-λ |
| `season#<year>`   | `eval#<NN>`    | identischer `RaceEvaluation`-Payload | Evaluation-λ |

Doppelt geschrieben statt GSI (D-4): ein Writer, idempotent, je Konsument eine Query. Read-API-Race-Modus ignoriert die neue `evaluation`-Row (SK-Prefix-Match bleibt `prediction#`/`explanation#`).

## Failure-Modes

| Fall                                   | Verhalten                                                            |
| -------------------------------------- | -------------------------------------------------------------------- |
| Session ist kein Rennen / Sprint       | sauberer Skip + Metrik (kein Alarm)                                  |
| Keine Predictions (Inference fiel aus) | Skip + `EvaluationSkippedNoPredictions` (Phase-4-Alarm gab es schon) |
| Archiv < 3 Fahrer mit Position (R-3)   | Error → `F1-Evaluation-Errors`-Alarm; kein falsches Ergebnis in DDB  |
| OpenF1 nicht erreichbar / Drift        | Zod-Fail → Error → Alarm (Constitution VI: laut)                     |
| PutEvents im Archiver scheitert        | Archiv bleibt ok; `ArchiverNotifyFailures`-Alarm; manueller Re-Run   |
| Re-Run derselben Session               | identische Keys → Overwrite, idempotent                              |

Manueller Re-Run (Runbook): `aws lambda invoke` mit `{detail: {date, session_id}}`-Payload — die λ akzeptiert das EventBridge-Envelope und nackte Details.

## Security & IAM

- Evaluation-λ: nur `s3:GetObject raw/sessions/*`, `dynamodb:Query/PutItem` auf `F1Predictions` — kein Bedrock, kein Write auf S3 (Constitution VII).
- Archiver: zusätzlich `events:PutEvents` (Default-Bus).
- Read-API/Frontend: unverändert (öffentliche Daten, CORS-Allowlist bleibt).

## Kosten-Footprint (Constitution IV)

| Posten                    | Annahme                                 | €      |
| ------------------------- | --------------------------------------- | ------ |
| Evaluation-λ              | ~30 Invocations/Jahr (24 Races + Skips) | ~0     |
| EventBridge Custom Events | ~150 Events/Jahr ($1/M)                 | ~0     |
| DDB Writes                | 2 Puts/Rennen, on-demand                | ~0     |
| OpenF1 Calls              | 2/Evaluation, keys-frei                 | 0      |
| Dashboard                 | bestehendes `f1-inference` erweitert    | 0      |
| **Gesamt**                |                                         | **≈0** |

Kein neues Dashboard (Free-Tier-Grenze), kein Polling, kein neuer Stack.

## Test-Strategie (Constitution X)

- **Evaluation-Handler (vitest):** Metrik-Mathematik (Hit-Rate 0/1/2/3 Treffer, Brier-Grenzfälle, Tie-Break), Podium-Extraktion aus synthetischem Archiv-JSONL (späterer `date` gewinnt, Nicht-`position`-Zeilen ignoriert, kaputte Zeilen übersprungen), Skip-Pfade (not-race, no-predictions), R-3-Guard, Idempotenz (zwei Puts, deterministischer Payload).
- **Archiver:** bestehende Tests + `notifySessionArchived` wird pro konsolidierter Session genau einmal gerufen; Notify-Fehler killt den Lauf nicht.
- **Read-API:** Season-Modus (sortiert, leer → `races: []`, Drift → Fehler), Race-Modus-Regression (ignoriert `evaluation`-Row).
- **Shared:** Key-Helper + Schema-Roundtrips.
- **Frontend:** Testing Library — Chart rendert N Punkte, Empty-State, API-Client validiert/fault-tolerant.
- **Infra:** `pipeline-stack`/`inference-stack`-Snapshot-Tests erweitert (Rule, IAM, Alarme); `cdk synth` in CI.
- **Real:** Deploy + Backfill der bereits archivierten Rennen mit Predictions (manueller Invoke pro Rennen) → DoD „≥ 3 Rennen verglichen" (Martin/AWS).

## Offene Entscheidungen → tasks.md

1. Exakte EMF-Metrik-Namen + Dashboard-Widget-Layout.
2. `evaluated_at`-Quelle (`now()`-DI wie überall).
3. Ob der Race-Modus der Read-API die Evaluation gleich mit ausliefert (Badge „Modell traf 2/3") — Default: **nein**, erst Saison-Chart (AC-3), Badge ist additiver Folgetask.
