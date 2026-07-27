# Tasks: Year-Round Value

> **Spec:** [spec.md](./spec.md) · **Plan:** [plan.md](./plan.md)
> Jeder Task einzeln committbar (`<type>(phase-9/TX): <imperative>`). Spec/Plan committen separat (Constitution XI).
> Stränge B und C hängen nicht an A — parallelisierbar.

## Strang A — Post-Session-Ingest (infra)

| #   | Task                                                                                                                              | Status | Verweis         |
| --- | --------------------------------------------------------------------------------------------------------------------------------- | ------ | --------------- |
| T1  | Spec + Plan + Tasks                                                                                                               | ✅     | —               |
| T2  | `@f1/shared`: Zod-Schemas für OpenF1 `pit` + `race_control`, `ArchivedSessionSchema` + Tests                                      | ⬜     | plan §4         |
| T3  | `schedule-sync/handler.ts`: `toSpec` → One-Shot `f1-ingest-<key>` auf `end + 35min`; Sweep über **beide** Präfixe; Tests          | ✅     | plan §1.1, AC-1 |
| T4  | Poller → Ingest: Vollabruf je Endpoint statt Zeitfenster (`pit`/`race_control` offen, s. Notiz), Tests                            | 🟡     | plan §1.2, AC-1 |
| T5  | 401-Erkennung: `IngestStillLive` + Throw → Scheduler-DLQ + Alarm (statt Selbst-Reschedule, s. Plan-Notiz); Tests                  | ✅     | plan §1.2, R-1  |
| T6  | CDK: Ingest-Scheduler-DLQ + Alarm `F1-Ingest-SchedulerDLQ`, λ-Timeout 3min, Env-Wiring; Tests (keine neuen IAM-Rechte)            | ✅     | plan §1.1/§5    |
| T7  | Deploy + erste echte Session verifizieren: Archiv in S3, `SessionArchived`, `F1-Evaluation` läuft auf Race, `?season=` nicht leer | ⬜     | AC-2, AC-3      |
| T8  | Rückwirkender Ingest-Backfill für die Sessions der Runden 1–11 (jetzt kostenlos, weil historisch)                                 | ⬜     | R-3             |

## Strang B — Prediction-Archiv (apps/predictor)

| #   | Task                                                                                                         | Status | Verweis         |
| --- | ------------------------------------------------------------------------------------------------------------ | ------ | --------------- |
| T9  | `lib/schedule.ts` + neue `resolveRound`-Logik (pure): `?round=N` auflösen, Default nächstes/letztes; Tests   | ✅     | plan §2.1, AC-4 |
| T10 | `RoundSelector.tsx` (Client, `router.push`) + Einbindung in `page.tsx` via `searchParams`                    | ✅     | AC-4            |
| T11 | Vorhersage-vs-Realität: Jolpica-Ergebnis des gewählten Rennens laden, Treffer-Markierung pro Position; Tests | ✅     | plan §2.2, AC-4 |
| T12 | Demo-Modus auf den Vorhersage-Teil eingrenzen — Wetter/Kalender/Standings/Historie immer live                | ✅     | plan §2.3       |
| T13 | Bedrock-Begründung des Top-1-Fahrers standardmäßig offen                                                     | ✅     | AC-9            |

## Strang C — Rennanalyse + Replay (apps/dashboard)

| #   | Task                                                                                                                | Status | Verweis         |
| --- | ------------------------------------------------------------------------------------------------------------------- | ------ | --------------- |
| T14 | `@f1/shared`: `JolpicaLapsSchema` + `JolpicaPitStopsSchema` inkl. Pagination-Felder + Tests                         | ✅     | plan §4, R-2    |
| T15 | `lib/race-progression.ts`: `getLapChart` (paginiert bis `total`) + `getPitStops`, Zod, ISR; Tests                   | ✅     | plan §3.1, AC-5 |
| T16 | Pure Transformationen `toPositionSeries` / `toPaceSeries` (MAD-Ausreißerdämpfung) / `toStints` + Tests              | ✅     | plan §3.1, AC-6 |
| T17 | `PositionChart.tsx` (visx, Boxenstopp-Marker, Top-10-Default + Fokusfahrer, Hover)                                  | ✅     | AC-5, R-4       |
| T18 | `PaceChart.tsx` + `StintBar.tsx` (Zwei-Fahrer-Vergleich)                                                            | ✅     | AC-6            |
| T19 | Einbindung in den Explorer: neues Panel bei Session `race`, degradiert sauber wenn keine Lap-Daten                  | ✅     | AC-5, AC-11     |
| T20 | `getArchivedSessions()` (S3-Listing, server-seitig) + `ReplayPicker` in `ReplayControls.tsx`, Textfeld als Fallback | ⬜     | plan §3.3, AC-7 |
| T21 | `/live` off-season: zuletzt archiviertes Rennen vorgeladen statt „Waiting for session data…"                        | ⬜     | AC-8            |
| T22 | `live.module.css` — hartkodierte Hex-Werte durch `@f1/shared`-Tokens ersetzen; Smoke bleibt grün                    | ⬜     | AC-10           |

## Abschluss

| #   | Task                                                                                             | Status | Verweis |
| --- | ------------------------------------------------------------------------------------------------ | ------ | ------- |
| T23 | Playwright-Smokes: Prediction-Archiv, Positionsverlauf, Replay-Picker                            | ⬜     | DoD     |
| T24 | README: Architektur-Grafik + ehrliche Beschreibung „Post-Session-Ingest" statt „5s-Live-Polling" | ⬜     | XII     |
| T25 | Close-out: Gate grün, Spec-Status `done`, Merge nach `main`, `git tag phase-9-done`              | ⬜     | DoD     |

## Offene Notizen

- **T4 Teilumfang:** der Ingest holt heute die fünf bestehenden Endpoints
  (`position`, `intervals`, `laps`, `stints`, `weather`) in einem Durchgang. Die
  im Plan zusätzlich vorgesehenen `pit` und `race_control` brauchen erst neue
  Zod-Schemas in `@f1/shared` (T2) — sie sind bewusst noch nicht verdrahtet,
  damit der Ingest-Umbau für sich allein testbar und deploybar bleibt.
- **T7 blockiert:** die Verifikation gegen eine echte Session setzt einen Deploy
  voraus. Nächste Gelegenheit ist das Wochenende in Zandvoort (Runde 12,
  2026-08-23) — davor gibt es keine Session, die neue Daten erzeugt.
