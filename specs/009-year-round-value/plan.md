# Plan: Year-Round Value

> **Spec:** [spec.md](./spec.md) · **Tasks:** [tasks.md](./tasks.md)
> Architektur, Datenmodelle, Contracts. Kein Code — der lebt in den Tasks.

## 0. Überblick

Drei weitgehend unabhängige Arbeitsstränge. Strang A ist die Voraussetzung für
AC-2/3 und für einen sinnvollen Replay; B und C hängen nicht an A und können
parallel laufen.

| Strang | Was                                                 | Betrifft                                |
| ------ | --------------------------------------------------- | --------------------------------------- |
| **A**  | Post-Session-Ingest statt Live-Polling              | `infra/` (schedule-sync, poller→ingest) |
| **B**  | Prediction-Archiv + sichtbare Erklärung             | `apps/predictor`                        |
| **C**  | Rennanalyse-Charts + Replay-Picker + `/live`-Tokens | `apps/dashboard`, `packages/shared`     |

---

## 1. Strang A — Post-Session-Ingest

### 1.1 Das Scheduling dreht sich um

Heute (`infra/lambda/schedule-sync/handler.ts:116-125`) baut `toSpec()` pro
Session ein **Fenster** `[start - PRE_START, end + POST_END]`, in dem der Poller
alle 5s läuft. Neu: **ein** One-Shot-Zeitpunkt.

```
alt:  f1-poll-<key>    rate(5s) im Fenster  → ~700 Invocations/Session → 100% HTTP 401
neu:  f1-ingest-<key>  at(end + 35min)      → 1 Invocation/Session     → HTTP 200
```

`PRE_START_MINUTES`/`POST_END_MINUTES` entfallen zugunsten von
`INGEST_DELAY_MINUTES = 35`. Die Sweep-Logik für verwaiste Schedules bleibt
strukturell gleich, arbeitet aber auf dem Präfix `f1-ingest-`. Der bestehende
`f1-infer-` Pfad bleibt vollständig unberührt — Vorhersagen brauchen weiterhin
T-60min **vor** dem Rennen und ziehen ihre Features aus FastF1/Jolpica, nicht
aus dem Poller.

**Migration:** `SCHEDULE_NAME_PREFIX` wechselt von `f1-poll-` auf `f1-ingest-`.
Damit der erste Lauf die alten Schedules aufräumt, sweept die Logik in dieser
Phase **beide** Präfixe (alte `f1-poll-*` werden bedingungslos gelöscht). Nach
einer Saison kann der Legacy-Zweig raus.

### 1.2 Aus dem Poller wird ein Ingest

`infra/lambda/poller/` behält seine DI-Struktur (`handler.ts` pur,
`index.ts` verdrahtet AWS) und seine Zod-Validierung pro Endpoint — das ist
gesunde Substanz. Was sich ändert:

- **Kein Zeitbudget-Tanz mehr.** Der Deadline-Schutz aus `05751e8` bleibt als
  Sicherheitsnetz, wird aber unkritisch: ein Durchgang statt Dauerlauf.
- **Vollständigkeit statt Aktualität.** Pro Endpoint wird die komplette Session
  geholt (`?session_key=<key>`), nicht ein Zeitfenster.
- **Endpoint-Liste wächst** um `pit` und `race_control` (bisher nur
  `position`/`intervals`/`laps`/`stints`/`weather`) — beide sind für die
  Strategie- und Verlaufsdarstellung wertvoll und kosten je einen Request.
- **Paginierung**, falls OpenF1 begrenzt. Ein Endpoint, der offensichtlich
  abgeschnitten ist, muss laut scheitern (Constitution VI), nicht still
  halbe Daten liefern.

**Selbstheilung (R-1):** Bekommt der Lauf HTTP 401, ist die Session noch im
Live-Fenster (Sessionende hat sich verschoben). Dann terminiert er **einmalig**
einen neuen `f1-ingest-<key>`-Schedule auf `now + 30min` und beendet sich ohne
Fehler. Beim zweiten 401 wird eine Metrik `IngestStillLive` emittiert, die
alarmiert. Das braucht `scheduler:CreateSchedule` in der Ingest-Rolle — die
einzige neue IAM-Berechtigung dieser Phase.

### 1.3 Was dadurch von selbst heilt

`SessionArchived` entsteht für Race-Sessions, sobald der Archiver echte Parts
sieht. Damit läuft `F1-Evaluation` erstmals auf einer Race-Session — der
Vergleich in `infra/lambda/evaluation/handler.ts:167` (`session_name !== "Race"`)
ist korrekt und bleibt unangetastet; ihm fehlte bisher nur der Input. AC-3 ist
also eine **Folge** von AC-1/2, kein eigener Codepfad.

### 1.4 Kosten (Constitution IV)

| Posten           | heute                             | nachher                |
| ---------------- | --------------------------------- | ---------------------- |
| Poll-Invocations | ~700/Session × ~120 Sessions      | ~1/Session × ~120      |
| SQS-Messages     | proportional                      | drastisch weniger      |
| DDB-Writes       | gleiche Zeilen, weniger Dubletten | ≤ heute                |
| Neue Services    | —                                 | **keine**              |
| OpenF1           | 0 € (401)                         | 0 € (historisch, frei) |

Der Footprint **sinkt** deutlich; das 5-USD-Budget bleibt mit großem Abstand
eingehalten.

---

## 2. Strang B — Predictor

### 2.1 Rundenselektor + Archiv

`apps/predictor/src/app/page.tsx` bekommt `searchParams` (`?round=N`), analog zum
bereits bewährten Muster des Dashboard-Explorers (`resolveSelection` in
`apps/dashboard/src/lib/explorer.ts`). Die Read-API kann bereits nach
`race_date`+`round` abgefragt werden — es fehlt nur die Liste, **welche** Runden
eine Vorhersage haben.

Dafür genügt die vorhandene Saison-Auswertung plus ein billiger Probe-Fetch:
`fetchSeasonEvaluations` liefert die ausgewerteten Runden; für die restlichen
wird beim Rendern des Selektors nicht geprüft, sondern eine Auswahl ohne
Vorhersage zeigt sauber den Leerzustand (AC-11). Keine neue API, kein neuer
Index — bewusst simpel gehalten.

### 2.2 Vorhersage vs. Realität

Ist das gewählte Rennen gelaufen, wird neben die Vorhersage das tatsächliche
Top-3 gestellt (Jolpica-Results, bereits via `history-api`-Muster verfügbar) mit
Treffer-Markierung pro Position. Das ist der Moment, in dem das Projekt seine
eigentliche Geschichte erzählt — und heute fehlt er komplett.

### 2.3 Demo-Modus entschärfen

`const DEMO = !process.env["NEXT_PUBLIC_PREDICTIONS_API_URL"]` schaltet heute die
**ganze** Seite auf Fixtures (`page.tsx:43,52`), obwohl Wetter, Kalender,
Standings und Streckenhistorie gar keine Read-API brauchen. Künftig fällt **nur**
der Vorhersage-Teil auf Demo zurück; alles andere holt echte Daten. Die
Fixture-Daten (`demo-data.ts:23`, ein Juni-Rennen) werden damit unschädlich.

### 2.4 Erklärung sichtbar (AC-9)

`PodiumBoard.tsx:56` initialisiert `isOpen` für jeden Fahrer auf `false`. Der
Top-1-Fahrer startet künftig offen.

---

## 3. Strang C — Dashboard

### 3.1 Rennverlauf aus Jolpica

Neuer Client `apps/dashboard/src/lib/race-progression.ts`:

```ts
getLapChart(season, round): Promise<LapChart | null>   // /laps, paginiert
getPitStops(season, round): Promise<PitStop[] | null>  // /pitstops
```

**Pagination ist Pflicht (R-2):** ein Rennen hat ~1400 Lap-Records, Jolpicas
Default-Limit ist 30. Schleife mit `limit=100` bis `MRData.total`, Zod pro Seite,
ISR sehr lang (fertige Rennen ändern sich nie).

Reine Transformationslogik (`packages/shared` oder lokal, je nach Wiederverwendung):

- `toPositionSeries(laps)` → pro Fahrer `{lap, position}[]`
- `toPaceSeries(laps)` → Rundenzeiten, mit robuster Ausreißerdämpfung (Median ± MAD) damit SC-/Box-Runden die Skala nicht sprengen
- `toStints(laps, pitstops)` → Stint-Segmente je Fahrer

### 3.2 Charts (visx, D-4)

| Komponente          | Zeigt                                               | AC   |
| ------------------- | --------------------------------------------------- | ---- |
| `PositionChart.tsx` | Linien P1–P20 über Runden, Boxenstopp-Marker, Hover | AC-5 |
| `PaceChart.tsx`     | Rundenzeit-Verlauf, 1–2 Fahrer im Vergleich         | AC-6 |
| `StintBar.tsx`      | Stint-Segmente je Fahrer als horizontale Leiste     | AC-6 |

Gegen Spaghetti (R-4): Default Top-10 + Fokusfahrer aus dem bestehenden
`?driver=`-Parameter; die übrigen ausgegraut und per Klick zuschaltbar. Team-
Farben aus `@f1/shared`.

### 3.3 Replay-Picker

`getArchivedSessions()` listet `raw/sessions/` aus S3 (server-seitig, IAM
read-only) und liefert `{session_key, date, label}`. `ReplayControls.tsx`
bekommt ein Select davor; das Textfeld bleibt als Fallback. Ohne laufende
Session lädt `/live` das zuletzt archivierte Rennen vor (AC-8).

**Achtung:** solange kein Rennen archiviert ist (Strang A noch nicht scharf, R-3),
ist die Liste leer. Der Backfill-Task füllt sie rückwirkend.

### 3.4 `/live` auf Tokens

`Dashboard.tsx`, `TimingTower.tsx`, `GapChart.tsx`, `WeatherStrip.tsx`,
`ConnectionStatus.tsx`, `ReplayControls.tsx` nutzen hartkodierte Hex-Werte
(`#0e131b`, `#11161f`, `#2a3242`, …). Sie wandern in ein
`live.module.css` auf Basis der `@f1/shared`-Tokens — dieselbe Sprache wie
`season.module.css`/`explorer.module.css`. Reine Darstellungsänderung, keine
Funktionsänderung; der bestehende Playwright-Smoke muss grün bleiben.

---

## 4. Contracts & Schemas

Alles Neue an einer Systemgrenze bekommt ein Zod-Schema in `@f1/shared`
(Constitution III/VI):

- `JolpicaLapsSchema`, `JolpicaPitStopsSchema` — inkl. `total`/`offset` für die Pagination
- OpenF1 `pit`, `race_control` — Ergänzung der bestehenden Endpoint-Schemas
- `ArchivedSessionSchema` — die Replay-Liste

S3-Keys ausschließlich über `S3_PATHS`, DDB-Keys über `ddb-keys` — kein
Handbau (Constitution III).

## 5. Observability (Constitution VIII)

- `F1-Ingest-Failure` — Ingest-λ Fehler → `f1-alerts`
- `F1-Ingest-Silence` — eine Race-Session ohne nachfolgenden Ingest-Lauf; genau die Klasse Fehler, die diese Phase überhaupt erst aufgedeckt hat
- `IngestStillLive` — zweiter 401 in Folge (R-1)
- Bestehende Alarme bleiben; der DLQ-Alarm hat sich als das nützlichste Instrument im Projekt erwiesen und wird nicht angefasst.

## 6. Testing (Constitution X)

- Pure Transformationen (`toPositionSeries`, `toPaceSeries`, `toStints`, Pagination-Schleife, Ingest-Zeitpunktberechnung, Schedule-Sweep über beide Präfixe) — Unit-Tests, das Rückgrat.
- Ingest-λ gegen die vorhandenen OpenF1-Fixtures (`ml/fixtures/openf1/<session_key>/`) — inklusive 401-Selbstheilungspfad.
- CDK-Assertions für den umbenannten Schedule-Pfad, die neue IAM-Berechtigung und die neuen Alarme.
- Playwright: Prediction-Archiv (Rundenwechsel), Positionsverlauf sichtbar, Replay-Picker startet ein Replay.
- **Regressionsgeist dieser Phase:** Der IAM-Bug lebte 6 Wochen, weil ein Test die Existenz einer Ressource prüfte, nicht ihren Inhalt. Neue Infra-Assertions prüfen Werte, nicht nur Namen.
