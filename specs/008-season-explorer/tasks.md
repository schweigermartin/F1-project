# Tasks: Interactive Season Explorer (Dashboard)

> **Spec:** [spec.md](./spec.md) · **Plan:** [plan.md](./plan.md)
> Jeder Task einzeln committbar (`<type>(phase-8/TX): <imperative>`). Spec/Plan committen separat (Constitution XI).

| #   | Task                                                                                                         | Status | Verweis       |
| --- | ------------------------------------------------------------------------------------------------------------ | ------ | ------------- |
| T1  | Spec + Plan + Tasks                                                                                          | ✅     | spec/plan     |
| T2  | `lib/f1-api.ts`: `getRaceResults` + `getQualifyingResults` (Jolpica, Zod) + Tests                            | ⬜     | plan §1, AC-3 |
| T3  | `lib/openf1.ts`: `getMeetingSessions` + `getPracticeFastestLaps` (+ pure `fastestPerDriver`) + Tests         | ⬜     | plan §1, AC-2 |
| T4  | `lib/explorer.ts` (pure): `resolveSelection`, session options/labels, `buildDriverFocus` + Tests             | ⬜     | plan §1, AC-1 |
| T5  | `explorer.module.css` + `ExplorerBar.tsx` (RaceSelect/SessionTabs/DriverSelect, router push, useTransition)  | ⬜     | AC-1/2/4/6    |
| T6  | `ResultBoard.tsx` (Spalten je Session-Typ, Team-Farben, Empty-States)                                        | ⬜     | AC-3          |
| T7  | `PodiumStrip.tsx` (Top-3 Karten)                                                                             | ⬜     | AC-3          |
| T8  | `DriverFocusCard.tsx` + Fokus-Highlight in Standings                                                         | ⬜     | AC-4          |
| T9  | `CalendarRail.tsx` (Links je Rennen) + Standings-Panel-Einbindung                                            | ⬜     | AC-5          |
| T10 | `page.tsx`/`SeasonExplorer` Komposition (allSettled, Defaults, Fallbacks)                                    | ⬜     | AC-1/5/7      |
| T11 | Component-Tests (ResultBoard/PodiumStrip/DriverFocusCard/ExplorerBar) + Playwright-Explorer-Smoke; Gate grün | ⬜     | AC-8, X       |
| T12 | README (Explorer-Features) + Close-out: Spec `done`, `git tag phase-8-done`, Merge nach `main`               | ⬜     | XII, DoD      |
