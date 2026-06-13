# Tasks: Race Weekend Hub & Frontend Overhaul

> **Spec:** [spec.md](./spec.md) · **Plan:** [plan.md](./plan.md)
> Jeder Task ist einzeln committbar (`<type>(phase-7/TX): <imperative>`); Reihenfolge ist verbindlich. Spec/Plan committen separat (Constitution XI).

| #    | Task                                                                                                                                                                              | Status | Verweis        |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | -------------- |
| T1   | Spec + Plan + Tasks schreiben (dieses Dokument)                                                                                                                                   | ✅     | spec/plan      |
| T2   | `@f1/shared`: `design-tokens.ts` (`DESIGN_TOKENS` + `tokensToCssVars()`) + Tests + Export im Index                                                                               | ⬜     | plan §1        |
| T3   | `@f1/shared`: `teams.ts` (`TEAM_COLORS`, `teamColor`, `driverTeamColor`, Zod) + Tests + Export                                                                                   | ⬜     | plan §1, D-6   |
| T4   | Predictor lib: `standings-api.ts` (+`lat/lon/circuitId` in `RaceMeta`/schedule) + Tests                                                                                          | ⬜     | plan §2        |
| T5   | Predictor lib: `openf1-weekend.ts` (`getWeekendSessions`, pure `pickWeekendForRace`, live `getLiveWeather/Positions`) + Tests                                                    | ⬜     | plan §2, AC-2  |
| T6   | Predictor lib: `weather-api.ts` (Open-Meteo, Zod) + Tests                                                                                                                        | ⬜     | plan §2, AC-4  |
| T7   | Predictor lib: `circuits.ts` (GeoJSON-Fetch + pure `projectToSvg`) + Tests                                                                                                       | ⬜     | plan §2, AC-3  |
| T8   | Predictor lib: `history-api.ts` (Jolpica Strecken-Sieger, Zod) + Tests                                                                                                           | ⬜     | plan §2, AC-7  |
| T9   | Predictor: globals/layout Tokens injizieren; Karten-/Grid-Design-System (CSS-Modul)                                                                                              | ⬜     | plan §4        |
| T10  | Komponente `weekend/WeekendHeader.tsx` + `Countdown` (client) + Flag-Helfer                                                                                                      | ⬜     | AC-1           |
| T11  | Komponente `weekend/SessionTimeline.tsx` + pure `formatSessionTime` + Tests                                                                                                      | ⬜     | AC-2           |
| T12  | Komponente `track/CircuitMap.tsx` (SVG-Path + animierte Runde + Platzhalter)                                                                                                     | ⬜     | AC-3           |
| T13  | Komponente `weather/WeatherPanel.tsx`                                                                                                                                            | ⬜     | AC-4           |
| T14  | Komponenten `predictions/PodiumBoard.tsx` + `ShapWaterfall.tsx` (pure `buildWaterfall`) + Team-Farben; ersetzt `PodiumPredictions` + Tests                                       | ⬜     | AC-5           |
| T15  | Komponente `predictions/GridVsPrediction.tsx`                                                                                                                                    | ⬜     | AC-6           |
| T16  | Komponente `history/TrackHistory.tsx`                                                                                                                                            | ⬜     | AC-7           |
| T17  | Komponente `live/LiveResultPanel.tsx` (client poll, pure `diffPredictionVsActual`) + Tests                                                                                       | ⬜     | AC-8           |
| T18  | `season/SeasonPerformance.tsx` interaktiv aufwerten (Tooltip/Toggle/Versions-Bänder) + Tests                                                                                     | ⬜     | AC-9           |
| T19  | `page.tsx` Hub-Komposition (allSettled) + erweiterte `demo-data.ts` für alle Panels                                                                                             | ⬜     | AC-11, plan §4 |
| T20  | Predictor Playwright-Smoke auf neue Panels erweitern; Gate grün (typecheck/lint/format/test)                                                                                     | ⬜     | AC-11, X       |
| T21  | Dashboard: Tokens aus `@f1/shared` übernehmen + Team-Farben in Standings/Results/Timing-Tower (funktional unverändert); Smoke grün                                               | ⬜     | AC-10          |
| T22  | README: Hub-Features + Screenshots + Datenquellen-Attribution (ODbL/Open-Meteo); Phasen-Tabelle Phase 7                                                                          | ⬜     | XII            |
| T23  | Deploy-Verifikation auf Vercel-Preview (beide Apps), Demo + Live geprüft                                                                                                         | ⬜     | DoD            |
| T24  | Close-out: Spec-Status `done`, README-Status, `git tag phase-7-done`, Merge nach `main`                                                                                          | ⬜     | DoD            |
