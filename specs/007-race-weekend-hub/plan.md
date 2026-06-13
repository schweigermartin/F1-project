# Plan: Race Weekend Hub & Frontend Overhaul

> **Spec:** [spec.md](./spec.md)
> Reines Frontend auf bestehenden + freien Quellen. Kein neuer AWS-Service (Constitution IV). Server Components by default, Client-Inseln nur wo nötig (Constitution VI/Performance).

## 0. Architektur-Überblick

```
@f1/shared (neu)                         apps/predictor (Hub)              apps/dashboard (Refresh)
 ├─ design-tokens.ts  (CSS-var Namen)     src/app/page.tsx  (Hub-Komposition) src/app/page.tsx (Tokens)
 ├─ teams.ts          (Team→Farbe, code)  src/lib/                            src/app/live  (Tokens)
 └─ (re-export im index)                   ├─ openf1-weekend.ts (sessions/wx/pos, client+server)
                                           ├─ weather-api.ts    (Open-Meteo, server)
                                           ├─ circuits.ts       (GeoJSON→SVG path, server)
                                           ├─ history-api.ts    (Jolpica Strecken-Sieger)
                                           ├─ standings-api.ts  (Fahrer/Team-Standings, geteilt mit dashboard-Logik-Stil)
                                           └─ (bestehend) predictions-api / evaluations-api / schedule
                                          src/components/
                                           ├─ weekend/WeekendHeader.tsx (+Countdown island)
                                           ├─ weekend/SessionTimeline.tsx
                                           ├─ track/CircuitMap.tsx
                                           ├─ weather/WeatherPanel.tsx
                                           ├─ predictions/PodiumBoard.tsx (Team-Farben, Karten)
                                           ├─ predictions/ShapWaterfall.tsx
                                           ├─ predictions/GridVsPrediction.tsx
                                           ├─ history/TrackHistory.tsx
                                           ├─ live/LiveResultPanel.tsx (client island, OpenF1 poll)
                                           └─ season/SeasonPerformance.tsx (interaktiv aufgewertet)
```

**Leitprinzipien:** (1) jedes Panel lädt seine Daten unabhängig und degradiert allein (Promise.allSettled-Muster); (2) Pure-Logik (Zeitformat, Geometrie-Projektion, Farb-Mapping, Vorhersage-vs-Realität-Diff) ist aus den Komponenten herausgezogen und unit-getestet; (3) Client-Komponenten nur für Countdown, Live-Poll, SHAP-Hover, Metrik-Toggle.

## 1. `@f1/shared` — geteilte Basis (Constitution III)

**`design-tokens.ts`** — Quelle der Wahrheit für das Design-Vokabular als **Daten** (kein CSS-Import in shared): exportiert ein `DESIGN_TOKENS`-Objekt (Farb-Hex, Spacing-Skala, Radius, Schrift-Stacks, Akzent `#e10600`) **und** einen `tokensToCssVars()`-Helfer, der `:root{--…}` als String erzeugt. Beide Apps injizieren das in ihr `globals.css`/Layout, sodass Tokens identisch sind. Tests: Snapshot der erzeugten CSS-Var-Liste + Vollständigkeit (jeder Token-Key → eine Var).

**`teams.ts`** — `TEAM_COLORS: Record<string, { primary: string; accent: string }>` für die 2026-Teams + `teamColor(constructorName)` mit Normalisierung (case/alias) und neutralem Fallback. `driverTeamColor(driverCode, standings)` leitet über Standings ab. Zod-Schema für die Map-Form. Tests: bekannte Teams, Alias, Unbekannt→Fallback.

Beide werden im `index.ts` re-exportiert (gleiche Konvention wie `evaluation-schema`).

## 2. Datenzugriffs-Layer (apps/predictor/src/lib)

Alle server-seitig (ISR) außer dem Live-Poller. Muster wie bestehende `f1-api.ts`: `fetch` → `res.ok` → `safeParse` → sauberes Output-Shape oder `null`.

- **`openf1-weekend.ts`**
  - `getWeekendSessions(meetingKeyOrDate)` — OpenF1 `/sessions?year=&country=` (Zod `SessionSchema[]` aus `@f1/shared`), gefiltert auf das Meeting des Zielrennens; liefert sortierte Sessions mit `date_start/date_end/session_name/gmt_offset`. Server, ISR 1 h.
  - `pickWeekendForRace(sessions, race)` — **pure**: matcht das Meeting per Datum/Land an die Jolpica-`ScheduledRace`. Unit-getestet.
  - `getLiveWeather(sessionKey)` / `getLivePositions(sessionKey)` — für den Client-Poller (fetch + Zod `WeatherSchema`/`PositionSchema`). Genutzt von der Live-Insel.
- **`weather-api.ts`** — `getRaceDayForecast(lat, lon, dateIso)` gegen Open-Meteo (`forecast?latitude=&longitude=&daily=temperature_2m_max,precipitation_probability_max,wind_speed_10m_max&start_date=&end_date=`), lokales Zod-Envelope, Output `{ tempMax, precipProb, windMax }`. Lat/Lon kommen aus Jolpica-Circuit-Location (erweitere `RaceMeta` um `lat/lon`). Server, ISR 1 h.
- **`circuits.ts`** — `getCircuitPath(circuitKeyOrName)`:
  - server-seitig GeoJSON laden (langer Cache), Linien-Koordinaten extrahieren;
  - **pure** `projectToSvg(coords, box)` — Lon/Lat → normierte SVG-Koordinaten (Mercator-frei genügt bei Streckengröße: lineare Skalierung auf Bounding-Box, y invertiert), liefert `{ d: string, start: {x,y}, viewBox }`. Unit-getestet (bekannte Koordinaten → erwartete Box).
  - Mapping circuit→GeoJSON-Feature über `circuit_short_name`/Land; Fehlmatch → `null` (Platzhalter).
- **`history-api.ts`** — `getTrackWinners(circuitId, n=5)` Jolpica `circuits/<id>/results/1?limit=&offset=` (oder `/<season>/circuits`), Output `[{ year, driver, code, constructor }]`. Server, ISR 24 h.
- **`standings-api.ts`** — dünne Predictor-Kopie der bereits im Dashboard erprobten `getDriverStandings/getConstructorStandings` (bewusste Unabhängigkeit der Apps, Constitution III erlaubt das für App-lokale Fetch-Logik; nur Schemas/Keys/Team-Farben sind geteilt). Liefert zusätzlich die `driver→constructor`-Map für Team-Farben.

## 3. Komponenten (apps/predictor/src/components)

Server-Komponenten, sofern nicht „(client)".

- **`weekend/WeekendHeader.tsx`** — Strecke, Flagge (`Flag`-Muster aus Dashboard nachziehen oder minimal lokal), Land, Datum; rechts **`Countdown` (client island)** zur nächsten Session. Props: `race`, `nextSession`.
- **`weekend/SessionTimeline.tsx`** — horizontale/vertikale Timeline der Sessions, lokale Zeit via `Intl.DateTimeFormat` (pure `formatSessionTime` Helfer), Markierung „nächste/laufend". Empty→Jolpica-Renndatum.
- **`track/CircuitMap.tsx`** — `<svg>` mit `<path d>` aus `circuits.ts`, Start/Ziel-Punkt, animierter „Lap"-Dot (`<animateMotion>`/CSS `offset-path`). Team-/Akzentfarbe. Platzhalter wenn `null`.
- **`weather/WeatherPanel.tsx`** — Forecast-Kacheln (Temp, Regen %, Wind); bei aktiver Session Live-Werte (vom Live-Poller durchgereicht). Empty→Hinweis.
- **`predictions/PodiumBoard.tsx`** — ersetzt `PodiumPredictions`: Fahrer-**Karten** in Team-Farbe, animierter Balken (CSS `@keyframes` width), Rang-Badge (🥇🥈🥉 für Top-3), Modell-Badge. Aufklappen rendert `ShapWaterfall` + Begründung. (client island für Expand.)
- **`predictions/ShapWaterfall.tsx`** — SVG-Wasserfall der `shap_top`-Beiträge (Basis → +/− Balken → Ergebnis), grün/rot signiert, Feature-Labels (bestehende `FEATURE_LABELS` erweitern um die 0.2.0-Features). Pure Geometrie-Helfer `buildWaterfall(contribs)` unit-getestet.
- **`predictions/GridVsPrediction.tsx`** — kleine Tabelle/Chart Startplatz ↔ Podiumswahrscheinlichkeit (aus Features/Quali). Ausblenden wenn keine Quali-Daten.
- **`history/TrackHistory.tsx`** — Liste letzter Sieger mit Flagge/Team-Farbpunkt.
- **`live/LiveResultPanel.tsx` (client)** — `useLivePoll(sessionKey, active)` Hook (15 s, Cleanup), zeigt Live-Positionen ODER finales Jolpica-Ergebnis; **`diffPredictionVsActual(predictedTop3, actualTop3)`** (pure, unit-getestet) markiert Treffer grün / Fehlschlag rot.
- **`season/SeasonPerformance.tsx`** — bestehenden SVG-Chart aufwerten: Hover-Tooltip-Layer (client island), Metrik-Toggle (Hit-Rate/Brier), Modell-Versions-Bänder (vertikale Trennlinie bei Versionswechsel). Empty-State bleibt.

## 4. Seiten-Komposition (apps/predictor/src/app/page.tsx)

```
resolveTargetRace() (bestehend, Jolpica)              → race
Promise.allSettled([
  getWeekendSessions, getRaceDayForecast, getCircuitPath,
  getTrackWinners, getDriverStandings, fetchRacePredictions, fetchSeasonEvaluations
])                                                     → jedes Panel bekommt Daten|null
DEMO-Modus: alle Quellen aus erweitertem demo-data.ts
Layout (CSS-Grid, responsive):
  [ WeekendHeader (full) ]
  [ CircuitMap ] [ SessionTimeline + WeatherPanel ]
  [ PodiumBoard (wide) ] [ GridVsPrediction ]
  [ LiveResultPanel (wide) ]
  [ TrackHistory ] [ Standings-Kontext ]
  [ SeasonPerformance (wide) ]
```

`globals.css`/`layout.tsx`: Design-Tokens via `tokensToCssVars()` injizieren; Karten-Grundklassen, Schrift (Display-Stack), responsive Grid.

## 5. Dashboard-Refresh (apps/dashboard)

- Tokens aus `@f1/shared` in `globals.css` übernehmen (gleiche Variablen-Namen → bestehende Module-CSS erbt automatisch konsistente Werte).
- Team-Farben in Standings/Results/Timing-Tower einsetzen (Farbpunkt/Leiste pro Fahrerzeile) — bestehende Tabellen, additive Klassen.
- **Keine** funktionale Änderung an WS-Hook, Store, Replay, Architektur. Smoke bleibt grün.

## 6. Datenmodell / Contracts

- Keine DDB-/S3-Änderung. Neue **Zod-Envelopes lokal** pro Fetch-Lib (Open-Meteo, Circuit-GeoJSON, Jolpica-Historie) — nur die gelesenen Felder, lenient bei Extras (wie `openf1-schema`).
- `@f1/shared`: `DesignTokens`, `TeamColors` als getypte/zod-validierte Daten. `RaceMeta` (predictor-lokal) um `lat/lon` + `circuitId` erweitern.
- Vorhersage-/Evaluations-Contracts unverändert (Phase 4/5).

## 7. Failure-Modes (Constitution V/VI)

| Quelle weg             | Verhalten                                                |
| ---------------------- | -------------------------------------------------------- |
| OpenF1 `/sessions`     | Timeline fällt auf Jolpica-Renndatum zurück              |
| Circuit-GeoJSON        | Karte zeigt Platzhalter, kein Layout-Sprung              |
| Open-Meteo             | „Wetter nicht verfügbar"                                 |
| Live-Poll Fehler       | Stoppt Poll, zeigt letztes Jolpica-Ergebnis              |
| Read-API 404           | bestehender „vor T-60min"-Empty-State                    |
| Alles weg (Off-Season) | Demo-/Fallback-Daten, Seite bleibt voll (Constitution V) |

## 8. Tests (Constitution X)

- **Unit (vitest):** `pickWeekendForRace`, `formatSessionTime`, `projectToSvg`, `buildWaterfall`, `diffPredictionVsActual`, `teamColor`/`driverTeamColor`, `tokensToCssVars`, Time-/Countdown-Helfer. Alle pure.
- **Component (Testing Library):** `PodiumBoard` (Sort + Expand + Team-Farbe), `SessionTimeline` (lokale Zeit/Markierung), `WeatherPanel` (Forecast vs „nicht verfügbar"), `LiveResultPanel` (Diff-Markierung), `SeasonPerformance` (Toggle/Empty).
- **E2E:** Playwright-Smoke je App grün (Predictor: Hub-Panels sichtbar im Demo-Modus; Dashboard: bestehender Race-Smoke). Demo-Modus macht den Predictor-Smoke hermetisch.
- Gate: `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test` grün, CI grün.

## 9. Kosten-Footprint (Constitution IV)

- **0 € laufend.** Keine neue AWS-Ressource. Alle Quellen frei. Vercel-Hosting unverändert (zwei bestehende Projekte, Hobby-Tier).
- Server-seitige Fetches ISR-gecacht (Sessions/Wetter/Historie 1–24 h) → wenige Calls/Tag, innerhalb aller Free-Limits.
- Live-Polling nur während aktiver Race-Session, 15 s-Intervall, client-seitig (keine Server-Kosten), automatischer Stopp.

## 10. Rollout

1. `@f1/shared` Tokens + Team-Farben (mit Tests) — Basis.
2. Predictor Fetch-Libs + Pure-Helfer (mit Tests).
3. Predictor Komponenten + Seiten-Komposition + erweiterte Demo-Daten.
4. Predictor Tests (Component + Playwright), Gate grün.
5. Dashboard/Live Token- + Team-Farben-Refresh (Funktion unverändert), Smoke grün.
6. README + Attribution, Deploy-Verifikation auf Vercel-Preview, Close-out + Tag.
