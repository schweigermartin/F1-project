# Plan: Interactive Season Explorer (Dashboard)

> **Spec:** [spec.md](./spec.md)
> Reines Frontend in `apps/dashboard`. State über URL-searchParams, server-gerendert + ISR. Selektoren = schlanke Client-Inseln (`router.push`). Kein neues AWS (Constitution IV).

## 0. Architektur

```
app/page.tsx (Server, searchParams: round, session, driver)
 └─ SeasonExplorer (Server) — fetch + Komposition
     ├─ ExplorerBar (client, sticky)        RaceSelect · SessionTabs · DriverSelect
     ├─ NextRaceHero + Countdown (bestehend)
     ├─ PodiumStrip (Top-3 der gewählten Session)
     ├─ ResultBoard (Klassifikation der gewählten Session)
     ├─ DriverFocusCard (nur wenn ?driver gesetzt)
     ├─ StandingsPanel (Fahrer + Konstrukteure, Fokus-Highlight)
     └─ CalendarRail (gewähltes Rennen markiert, Link je Rennen)

lib/
 ├─ f1-api.ts (bestehend)  + getRaceResults, getQualifyingResults
 ├─ openf1.ts (neu)        getMeetingSessions, getPracticeFastestLaps (OpenF1)
 └─ explorer.ts (neu, pure) resolveSelection(searchParams, schedule) → {round, session, driver}
                            + sessionLabel/order helpers
```

**Leitprinzip:** alle Fetches server-seitig mit `Promise.allSettled`; jedes Panel
degradiert einzeln. Pure-Logik (Selektions-Auflösung, Session-Reihenfolge,
Fastest-Lap-Aggregation, Fokus-Ableitung) ist aus den Komponenten gezogen und
unit-getestet.

## 1. Datenzugriff

**`lib/f1-api.ts` (erweitern):**

- `getRaceResults(season, round)` → `RaceResultRow[]` (Pos, Fahrer, Code, Team, Zeit/Status, Punkte, Grid) via `…/{season}/{round}/results`.
- `getQualifyingResults(season, round)` → `QualiRow[]` (Pos, Fahrer, Code, Team, Q1/Q2/Q3-Bestzeit) via `…/{season}/{round}/qualifying`.
- Bestehende `getDriverStandings/getConstructorStandings/getSchedule/getLastResults/pickNextRace` bleiben.

**`lib/openf1.ts` (neu, Zod via `@f1/shared` Schemas wo möglich):**

- `getMeetingSessions({year, country})` → OpenF1 `/sessions` (SessionSchema), gefiltert aufs Meeting (Datum/Land des Rennens).
- `getPracticeFastestLaps(sessionKey)` → `/laps` (LapSchema) min `lap_duration` je `driver_number` + `/drivers` (neues schmales Schema) für `name_acronym`/Team; liefert `FastLapRow[]` sortiert. Best-effort → `[]`/`null` bei Lücken.

**`lib/explorer.ts` (neu, pure):**

- `SESSION_OPTIONS` (race, qualifying, fp1–fp3) + Labels + Reihenfolge.
- `resolveSelection(params, schedule, now)` → validiert `round` (sonst next/last via `pickNextRace`), `session` (sonst `race`), `driver` (sonst null). Unit-getestet.
- `fastestPerDriver(laps)` (pure Aggregation) + `buildDriverFocus(code, standings, raceRows)` (pure). Unit-getestet.

## 2. Komponenten (clean & modern, dezente Motion)

- **`ExplorerBar.tsx` (client):** sticky Leiste mit drei Selektoren. `RaceSelect` (native `<select>` der Runden, „R7 · Spanien"), `SessionTabs` (Pill-Buttons Race/Quali/FP1-3), `DriverSelect` (`<select>` Fahrer, „— Fokus aus —"). Jede Änderung → `router.replace` mit gemergten searchParams (scroll: false). `useTransition` für sanftes Pending (dezente Motion).
- **`ResultBoard.tsx` (server):** Tabelle mit Team-Farb-Leiste je Zeile, Hover, Podium-Plätze farbig (gold/silber/bronze Tokens). Spalten je Session-Typ (Rennen: Zeit/Status + Punkte; Quali: Q1/Q2/Q3; Practice: Bestzeit + Lücke). Empty-State je Quelle.
- **`PodiumStrip.tsx` (server):** Top-3 als drei Karten (1 mittig erhöht) in Team-Farben — der „wichtigste Ergebnisse"-Blickfang.
- **`DriverFocusCard.tsx` (server):** erscheint nur bei `?driver`; WM-Platz/Punkte/Siege + Ergebnis & Startplatz im gewählten Rennen, Team-Farb-Akzent.
- **`StandingsPanel.tsx`:** bestehende Tabellen (aus SeasonWidgets) + Fokus-Highlight der gewählten Fahrerzeile.
- **`CalendarRail.tsx`:** kompaktes Raster; jedes Rennen ist ein Link `?round=N` (gewähltes markiert).
- Wiederverwendung: `NextRaceHero`, `Countdown`, `Flag`, `season.module.css` (Phase-7-Skin) + neues `explorer.module.css`.

## 3. Seiten-Komposition

`page.tsx` liest `searchParams`, ruft `resolveSelection`, lädt per `allSettled`:
schedule, driver/constructor standings, raceResults|qualiResults|practiceLaps (je
nach session), und reicht alles an `SeasonExplorer`. Banner/Hero/Footer bleiben.
Default-Route `/` ohne Params → nächstes/letztes Rennen, Session `race`.

## 4. Failure-Modes (Constitution V/VI)

| Quelle weg             | Verhalten                                                                          |
| ---------------------- | ---------------------------------------------------------------------------------- |
| Jolpica results/quali  | „Ergebnis nicht verfügbar" (z. B. Rennen noch nicht gefahren → Hinweis + Zeitplan) |
| OpenF1 practice        | „Practice-Bestzeiten nicht verfügbar"                                              |
| Standings/Schedule     | bestehender Fallback je Karte                                                      |
| ungültige searchParams | `resolveSelection` fällt auf Defaults zurück (nie Crash)                           |

## 5. Tests (Constitution X)

- **Unit:** `resolveSelection` (Defaults/Validierung/Clamp), `fastestPerDriver`, `buildDriverFocus`, Session-Order/Labels.
- **Component:** `ResultBoard` (Spalten je Session-Typ + Empty), `PodiumStrip`, `DriverFocusCard` (nur bei driver), `ExplorerBar` (Auswahl → push aufgerufen, gemockter Router).
- **E2E:** neuer Dashboard-Smoke: Landing lädt, Renn-Dropdown wechseln → Board aktualisiert, Session-Tab wechseln, Fahrer-Fokus an/aus. Bestehender `/live`-Smoke bleibt.
- Gate: typecheck/lint/format/test grün, beide Apps bauen, CI grün.

## 6. Kosten (Constitution IV)

- **0 € laufend.** Keine AWS-Ressource. Jolpica + OpenF1 frei; server-seitige Fetches ISR-gecacht (Ergebnisse statisch nach dem Rennen → langer Cache). Renn-Wechsel = wenige gecachte Calls.

## 7. Rollout

1. Datenlibs (`f1-api` erweitern, `openf1.ts`) + Pure-`explorer.ts` (+Tests).
2. Komponenten (ExplorerBar, ResultBoard, PodiumStrip, DriverFocusCard, CalendarRail, StandingsPanel-Fokus) + `explorer.module.css`.
3. `page.tsx`/`SeasonExplorer` Komposition + Demo-/Empty-Fallbacks.
4. Tests (Unit+Component+Playwright), Gate grün.
5. README + Close-out + Tag.
