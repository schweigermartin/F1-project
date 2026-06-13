# Spec: Interactive Season Explorer (Dashboard)

> **Phase:** 008
> **Status:** done — implementiert, getestet (Gate grün), Merge nach `main` + Tag
> **Owner:** Martin
> **Constitution:** II (vorzeigbare Live-Seite), III (geteilte Tokens/Team-Farben/Schemas aus `@f1/shared`), IV (nur freie APIs, server-seitig gecacht, kein neues AWS), V (Demo/Off-Season-Fallback bleibt), VI (Zod an jeder externen Grenze), X (pragmatische Tests + Playwright-Smoke), XII (README aktuell).

## Problem / Motivation

Die Dashboard-Landing (`apps/dashboard`, `f1-project-zeta.vercel.app`) zeigt nur eine
statische Momentaufnahme: aktuelle Standings, der nächste GP, das letzte Ergebnis. Man
kann **nicht** durch die Saison navigieren. Sie soll zu einem **interaktiven Season
Explorer** werden: clean & modern, mit dezenter Motion, der die **wichtigsten
Ergebnisse** prominent zeigt und über **Dropdowns/Selektoren** bedienbar ist —
zwischen **Rennen/Runden**, **Sessions (FP/Quali/Race)** und mit **Fahrer-Fokus**.

Der Predictor bleibt unangetastet (gefällt). Alles aus **freien** Quellen
(Jolpica, OpenF1), **kein neuer AWS-Service**.

## User Stories

- **US-1 (Renn-Auswahl):** Als Fan wähle ich über ein Dropdown jedes Rennen der Saison (Runde 1–N) und sehe sofort dessen Ergebnis/Infos — ohne Seitenwechsel-Gefühl, mit teilbarem Link.
- **US-2 (Session-Umschalter):** Als Fan schalte ich für das gewählte Wochenende zwischen **Rennen**, **Qualifying** und **Freiem Training (FP1–FP3)** um und sehe die jeweilige Klassifikation.
- **US-3 (Wichtigste Ergebnisse):** Als Fan sehe ich für die gewählte Session eine klare Ergebnis-Tabelle (Platz, Fahrer in Team-Farbe, Team, Zeit/Status, Punkte) plus ein hervorgehobenes **Podium**.
- **US-4 (Fahrer-Fokus):** Als Fan wähle ich einen Fahrer und die Seite fokussiert auf ihn: WM-Position/Punkte, sein Resultat im gewählten Rennen, Startplatz, hervorgehoben in allen Tabellen.
- **US-5 (Saison-Kontext):** Als Fan sehe ich weiterhin Fahrer-/Konstrukteurs-WM, Kalender (mit Markierung des gewählten Rennens) und den Countdown zum nächsten GP.
- **US-6 (Konsistenz):** Als Recruiter erlebe ich dieselbe Designsprache wie der Predictor-Hub (geteilte Tokens + Team-Farben), modern und aufgeräumt.

## Acceptance Criteria

EARS-Stil, beobachtbar/prüfbar.

- **AC-1:** Ein **Renn-Selektor** (Dropdown) listet alle Saison-Rennen; Auswahl setzt `?round=N` (server-gerendert, ISR-gecacht, teilbarer Link) und aktualisiert alle race-abhängigen Panels. Default ohne Param: nächstes (oder letztes) Rennen.
- **AC-2:** Ein **Session-Selektor** schaltet zwischen `race` / `qualifying` / `fp1` / `fp2` / `fp3` (`?session=`). Rennen + Qualifying liefern volle Klassifikation aus Jolpica; Practice liefert die **schnellsten Runden je Fahrer** aus OpenF1, falls verfügbar — sonst ein sauberer Hinweis (kein Fehler).
- **AC-3:** Ein **Ergebnis-Board** zeigt die Klassifikation der gewählten Session: Position, Fahrer (Team-Farbe), Team, Zeit/Status bzw. Rundenzeit, Punkte (bei Rennen). Top-3 als **Podium** hervorgehoben.
- **AC-4:** Ein **Fahrer-Selektor** (`?driver=CODE`) aktiviert den Fokus: eine Fahrer-Karte (WM-Platz, Punkte, Siege, Ergebnis im gewählten Rennen, Startplatz) und Hervorhebung der Fahrerzeile in Ergebnis + Standings. Ohne Auswahl: kein Fokus, nichts bricht.
- **AC-5:** Fahrer-/Konstrukteurs-Standings, Kalender (gewähltes Rennen markiert) und Nächstes-Rennen-Countdown bleiben vorhanden und korrekt.
- **AC-6:** Look ist **clean & modern** mit dezenter Motion (Tab-/Zeilen-Übergänge, Hover), über die geteilten `@f1/shared`-Tokens + Team-Farben — konsistent mit dem Predictor-Hub. Sticky Selektor-Leiste.
- **AC-7:** Alle externen Antworten (Jolpica, OpenF1) werden Zod-validiert (Constitution VI); jeder Panel-Ausfall degradiert einzeln (freundlicher Hinweis), nichts reißt die Seite ab. Off-Season/fehlende Daten → sinnvolle Leerzustände (Constitution V).
- **AC-8:** Die bestehenden Seiten `/live` und `/architecture` bleiben funktional unverändert; ihr Playwright-Smoke bleibt grün. Ein neuer Smoke deckt die Explorer-Selektoren ab.

## Free data sources (kein Key)

| Quelle         | Liefert                                                              | Einsatz            |
| -------------- | -------------------------------------------------------------------- | ------------------ |
| Jolpica/Ergast | Schedule, Standings, **Race-Results**, **Qualifying-Results**        | server-seitig, ISR |
| OpenF1         | `/sessions`, `/laps`, `/drivers` → **Practice-Bestzeiten** je Fahrer | server-seitig, ISR |

## Out of Scope

- Neue AWS-Infrastruktur jeder Art (reines Frontend).
- Predictor-App (bleibt unverändert).
- Live-Telemetrie-Umbau auf `/live` (nur Token-Konsistenz, keine Funktionsänderung).
- Echtzeit-Race-Updates auf der Explorer-Seite (statische, ISR-gecachte Klassifikationen).
- Sektor-/Telemetrie-Details je Practice-Runde (nur Bestzeit je Fahrer).

## Resolved Decisions

- **D-1 (State via URL searchParams, server-gerendert):** `round`/`session`/`driver` leben in der URL → teilbare Links, server-seitige Jolpica-Fetches (kein CORS-Problem), ISR-Caching. Selektoren sind schlanke Client-Komponenten, die nur `router.push` aufrufen.
- **D-2 (Session-Tiefe gestaffelt):** Race + Qualifying = volle Jolpica-Klassifikation; Practice = OpenF1-Bestzeiten je Fahrer (best-effort, Fallback-Hinweis). So bleibt „FP/Quali/Race" erfüllt, ohne dass Practice die Seite blockiert.
- **D-3 (Fahrer-Fokus ohne Extra-Fetch):** Fokus-Daten kommen aus bereits geladenen Standings + Renn-Ergebnis; kein zusätzlicher Roundtrip.
- **D-4 (geteilte Basis):** Team-Farben + Design-Tokens aus `@f1/shared` (Phase 7); OpenF1-Schemas aus `@f1/shared`. Keine Doppel-Implementierung (Constitution III).

## Risks & Open Questions

- **R-1 (Practice-Daten lückenhaft):** OpenF1 hat nicht für jede historische Practice-Session vollständige Laps. Mitigation: Bestzeiten best-effort, sonst Hinweis + Session-Zeit.
- **R-2 (Jolpica-Rate-Limit):** Mehr Fetches pro Renn-Wechsel. Mitigation: aggressive ISR (Ergebnisse ändern sich nach dem Rennen nie), pro Round gecacht.
- **R-3 (Off-Season-Leere):** wenig Live-Bezug. Mitigation: Default auf letztes Rennen, Demo-Fallback bleibt (Constitution V).

## Dependencies

- `@f1/shared` Tokens + Team-Farben + OpenF1-Schemas (Phase 7/1) vorhanden.
- Bestehende Jolpica-Clients in `apps/dashboard/lib/f1-api.ts`.

## Definition of Done

- Explorer mit Renn-/Session-/Fahrer-Selektoren live, alle ACs erfüllt, Leerzustände sauber.
- `/live` + `/architecture` unverändert grün.
- Zod an allen Grenzen; Tests für neue Pure-Logik + kritische Komponenten; Playwright-Smokes (Explorer + bestehender Live-Smoke) grün.
- `pnpm typecheck/lint/format:check/test` grün; CI grün.
- README aktualisiert; Spec-Status `done`, `git tag phase-8-done`.
