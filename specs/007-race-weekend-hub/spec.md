# Spec: Race Weekend Hub & Frontend Overhaul

> **Phase:** 007
> **Status:** done — alle Panels gebaut + getestet (Gate grün, beide Apps bauen, Smokes grün), merged nach `main` + getaggt `phase-7-done` + gepusht; Vercel deployt Production automatisch aus `main` (visueller Live-Check durch Martin)
> **Owner:** Martin
> **Constitution:** II (jede Seite ein vorzeigbares Artefakt), III (geteilte Schemas/Keys in `@f1/shared`, kein Doppel-Code), IV (Kosten: nur freie APIs, server-seitig gecacht, kein neues AWS), V (Demo jederzeit — Off-Season-Fallback), VI (Zod an jeder externen Grenze, lautes Scheitern), X (pragmatische Tests + 1 Playwright-Smoke pro App), XII (README + Live-URLs aktuell).

## Problem / Motivation

Die beiden Frontends sind technisch sauber, aber optisch und inhaltlich ungleich:

- Das **Dashboard** (`apps/dashboard`) ist bereits reich — Standings, Kalender, Ergebnisse mit Flaggen + Countdown, Live-Timing-Tower, Gap-Chart, Wetter, Replay, Architektur-Seite.
- Der **Predictor** (`apps/predictor`) ist minimal — eine zentrierte Überschrift, CSS-Balken für die Podiumswahrscheinlichkeit und ein SVG-Saison-Chart. Inline-Styles, kaum Kontext.

Für ein Portfolio, das **heraussticht**, muss der Predictor zu einem vollwertigen **Rennwochenende-Cockpit** werden: Wer ein Race-Weekend öffnet, sieht auf einen Blick _wann_ gefahren wird, _wo_ (Streckenkarte), _bei welchem Wetter_, _wer laut Modell aufs Podium kommt und warum_, _wie es dort historisch lief_ — und nach dem Rennen _Vorhersage vs. Realität_. Dashboard und Live-Seite bekommen denselben gehobenen, konsistenten Look (gemeinsames Design-Vokabular, Team-Farben, Bewegung mit Maß).

Alles aus **kostenlosen** Quellen, die schon im Projekt sind (Jolpica/Ergast, OpenF1, die eigene Read-API) plus eine freie Wetter-API und freie Streckengeometrie — **kein neuer AWS-Service, keine laufenden Kosten** (Constitution IV).

## User Stories

- **US-1 (Wochenend-Überblick):** Als F1-Fan sehe ich beim Öffnen der Predictor-Seite sofort das anstehende Rennwochenende: Strecke, Land/Flagge, alle Sessions (FP1→Rennen) mit **lokaler Zeit** und einem **Countdown** zur nächsten Session.
- **US-2 (Streckenkarte):** Als Fan sehe ich eine **interaktive Streckenkarte** (echtes Layout) mit Start/Ziel und einer animierten „Runde", die die Strecke nachfährt — als Blickfang, der das Wochenende verortet.
- **US-3 (Wetter):** Als Fan sehe ich die **Wettervorhersage** für den Renntag am Streckenort (Temperatur, Regenrisiko, Wind) — bzw. Live-Wetter während einer aktiven Session.
- **US-4 (Podiums-Vorhersage, aufgewertet):** Als Fan sehe ich die Podiumswahrscheinlichkeiten als **Fahrer-Karten in Team-Farben** mit animierten Balken; ich kann eine Karte aufklappen und sehe ein **SHAP-Wasserfall-Diagramm** (welche Faktoren ziehen den Fahrer aufs Podium / davon weg) plus die Claude-Begründung.
- **US-5 (Quali & Grid):** Als Fan sehe ich den **Startaufstellung-vs-Vorhersage**-Vergleich und Quali-Teamkollegen-Duelle (aus den 0.2.0-Quali-Features), damit die Vorhersage nachvollziehbar wird.
- **US-6 (Strecken-Historie):** Als Fan sehe ich die **letzten Sieger** an dieser Strecke und ob das Modell „Strecken-Typen" trifft.
- **US-7 (Live-/Ergebnis-Panel):** Als Fan sehe ich während einer aktiven Race-Session **Live-Positionen** und nach dem Rennen das **Endergebnis** — direkt gegen die Vorhersage gestellt („Vorhersage vs. Realität", Top-3 grün/rot markiert).
- **US-8 (Saison-Trend, interaktiv):** Als ML-Reviewer sehe ich den Saison-Performance-Chart aufgewertet: Hover-Tooltips, Metrik-Umschalter (Hit-Rate / Brier), Modell-Versions-Bänder.
- **US-9 (Konsistentes Portfolio):** Als Recruiter erlebe ich Predictor, Dashboard-Landing und Live-Seite mit **einer** visuellen Sprache (Typografie, Farben, Karten, Motion) — es wirkt wie ein Produkt, nicht drei Prototypen.

## Acceptance Criteria

EARS-Stil, beobachtbar/prüfbar.

- **AC-1:** Die Predictor-Seite zeigt einen **Wochenend-Header** mit Streckenname, Land + Flagge, Datum und einem Live-Countdown zur nächsten Session. Ohne Sessions-Daten degradiert sie zu einem Header ohne Countdown (kein Fehler).
- **AC-2:** Eine **Session-Timeline** listet alle Wochenend-Sessions (Practice/Quali/Sprint/Race) mit in die Browser-Zeitzone konvertierten Zeiten und markiert die nächste/laufende Session. Quelle: OpenF1 `/sessions` (Zod-validiert); fehlt sie, fällt die Timeline auf die Jolpica-Renndaten zurück.
- **AC-3:** Eine **Streckenkarte** rendert das echte Circuit-Layout als SVG (aus freier Geometrie), mit Start/Ziel-Markierung und einer CSS/SMIL-animierten Runde. Fehlt die Geometrie für die Strecke, zeigt die Karte einen sauberen Platzhalter (kein Fehler, kein Layout-Sprung).
- **AC-4:** Ein **Wetter-Panel** zeigt für den Renntag am Streckenort Temperatur, Regenwahrscheinlichkeit und Wind aus einer freien API (Open-Meteo, kein Key). Bei aktiver Session werden OpenF1-Live-Wetterwerte bevorzugt. Quelle Zod-validiert; Ausfall → „Wetter nicht verfügbar".
- **AC-5:** Die **Podiums-Vorhersage** rendert je Fahrer eine Karte in **Team-Farbe** mit animiertem Wahrscheinlichkeitsbalken, sortiert absteigend. Aufklappen zeigt ein **SHAP-Wasserfall-Diagramm** (signierte Beiträge) und die Claude-Begründung. Ohne Vorhersage → bestehender Empty-State (vor T-60min).
- **AC-6:** Ein **Grid-vs-Vorhersage**-Block stellt Startplatz und vorhergesagte Podiumswahrscheinlichkeit gegenüber (aus `shap_top`/Features bzw. Quali-Daten). Fehlen Quali-Daten, wird der Block ausgeblendet.
- **AC-7:** Ein **Historie-Panel** zeigt die letzten Sieger an dieser Strecke (Jolpica, Zod-validiert). Off-Season / fehlende Daten → freundlicher Hinweis.
- **AC-8:** Ein **Live-/Ergebnis-Panel** zeigt bei aktiver Race-Session Live-Positionen (OpenF1, client-seitig gepollt nur während der Session — Constitution IV) und sonst das letzte/finale Ergebnis (Jolpica). Es markiert die **Top-3 der Vorhersage gegen die echte Top-3** (Treffer grün, Fehlschlag rot).
- **AC-9:** Der **Saison-Performance-Chart** ist interaktiv: Hover-Tooltips an Datenpunkten, Umschalter Hit-Rate ↔ Brier, sichtbare Modell-Versions-Wechsel. Empty-State bleibt erhalten.
- **AC-10:** **Dashboard-Landing** und **Live-Seite** übernehmen das gemeinsame Design-Vokabular (Tokens/Typografie/Karten) und die Team-Farben; bestehende Funktion (Standings, Kalender, Timing-Tower, Replay) bleibt unverändert korrekt.
- **AC-11:** **Demo-Modus bleibt** (Constitution V): ohne `NEXT_PUBLIC_PREDICTIONS_API_URL` rendert der Predictor deterministische Demo-Daten für **alle** neuen Panels; der Playwright-Smoke bleibt hermetisch und grün.
- **AC-12:** Alle externen Antworten (OpenF1, Jolpica, Open-Meteo, Circuit-Geometrie) werden gegen geteilte/lokale Zod-Schemas validiert; Drift scheitert laut bzw. degradiert pro Panel (Constitution VI). Kein Panel-Ausfall reißt die Seite ab.

## Free data sources (kein API-Key, kostenlos)

| Quelle                                            | Liefert                                                    | Einsatz                                                                 | CORS                                   |
| ------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------- |
| **Jolpica/Ergast** (`api.jolpi.ca`)               | Schedule, Standings, Ergebnisse, Quali, Strecken-Historie  | bereits genutzt; Server-seitig (kein CORS)                              | nein → server-side                     |
| **OpenF1** (`api.openf1.org`)                     | `/sessions` (Zeiten), `/weather`, `/position` live, Fahrer | Timeline, Live-Wetter, Live-Positionen                                  | ja → client-seitig nur während Session |
| **Open-Meteo** (`api.open-meteo.com`)             | Wettervorhersage nach Lat/Lon                              | Renntag-Forecast                                                        | ja                                     |
| **f1-circuits GeoJSON** (öffentliches Repo, ODbL) | echte Streckengeometrie (Lon/Lat-Linien)                   | Streckenkarte; **build-/server-seitig gefetcht + gecacht**, attribuiert | —                                      |
| **eigene Read-API** (Phase 4/5)                   | Predictions + Saison-Evaluations                           | bestehend                                                               | konfiguriert                           |

## Out of Scope

- Neue AWS-Infrastruktur jeder Art (kein Lambda, kein DDB, kein WS) — Phase 007 ist **reines Frontend** auf bestehenden + freien Quellen.
- Echtzeit-Telemetrie-Overlay (Speed/Throttle-Traces) auf der Predictor-Seite — die Live-Telemetrie bleibt im Dashboard.
- Bezahl-/Key-pflichtige Datenquellen (offizielle F1-API, Wetter-Premium).
- Account/Login, Personalisierung, Mehrsprachigkeit (UI bleibt Deutsch wie bestehend).
- Bündeln urheberrechtlich unklarer Strecken-SVGs — nur freie Geometrie (ODbL) mit Attribution.

## Resolved Decisions

- **D-1 (gemeinsames Design statt geteiltes Paket):** Ein **Design-Token-Set** (CSS-Variablen: Farben, Spacing, Radius, Schrift) + Team-Farben-Map wird in `@f1/shared` als reine Daten/Typen geführt (Constitution III: Team-Farben sind cross-cutting, beide Apps brauchen sie). Visuelle Komponenten bleiben pro App (kein UI-Paket — Overkill für zwei Next-Apps), teilen aber Tokens + Farben.
- **D-2 (Streckengeometrie server-seitig):** Die GeoJSON wird **server-seitig** (ISR, langer Cache) geladen und zu einem normierten SVG-Path projiziert — nicht im Client. Geometrie ändert sich nie; Cache praktisch unbegrenzt. Attribution im Footer (ODbL).
- **D-3 (Live nur während Session):** OpenF1-Live-Polling läuft **client-seitig und nur**, wenn eine Race-Session aktiv ist (`isSessionActive`), mit moderatem Intervall (z. B. 15 s) und sauberem Cleanup — Constitution IV/V. Außerhalb: statisches Jolpica-Ergebnis, kein Polling.
- **D-4 (Wetter zweistufig):** Forecast über Open-Meteo (Renntag), Live-Werte über OpenF1 `/weather` wenn Session aktiv. Beide Zod-validiert, unabhängig degradierend.
- **D-5 (Motion mit Maß, dependency-arm):** Bewegung primär über CSS/SVG (Bars, Lap-Animation, Übergänge). Keine schwere Animations-Lib; das bestehende `visx` (im Dashboard) darf für Charts wiederverwendet werden, der Predictor bleibt aber bei dependency-freiem SVG wo möglich (gleiche Linie wie bisher).
- **D-6 (Team-Farben aus Standings abgeleitet):** Fahrer→Team kommt aus den Jolpica-Standings (`constructor`), Team→Farbe aus einer gepflegten Map in `@f1/shared`. Unbekanntes Team → neutrale Akzentfarbe (kein Crash).

## Risks & Open Questions

- **R-1 (Circuit-GeoJSON-Verfügbarkeit/Lizenz):** Externe Repo-Quelle kann sich ändern. Mitigation: server-seitig fetchen + langer Cache; bei Ausfall Platzhalter (AC-3). Attribution gemäß ODbL. Optional später: Geometrie einmalig ins eigene S3 spiegeln (kein laufender Kostenpunkt).
- **R-2 (OpenF1 CORS/Rate-Limit live):** Client-Polling könnte limitiert werden. Mitigation: nur während Session, 15 s-Intervall, Abbruch bei Fehlern, Fallback auf Jolpica.
- **R-3 (Off-Season-Leere):** Zwischen den Rennen wenig Live-Daten. Mitigation (Constitution V): Demo-Daten für alle Panels, „nächstes Rennen"-Logik, Historie + Saison-Chart füllen die Seite.
- **R-4 (Bundle-Größe):** Reichere UI darf LCP nicht ruinieren. Mitigation: Server Components by default, Client-Inseln nur für Countdown/Live/Interaktion, `next/image` für Fotos, SVG statt Raster.
- **Q-1 (Eigene Streckengeometrie ins S3?):** offen/Bonus — erst wenn die externe Quelle unzuverlässig wird.

## Dependencies

- Phasen 1–6 abgeschlossen (✅): Read-API (Predictions/Evaluations), Jolpica-Clients, OpenF1-Schemas in `@f1/shared`, Dashboard-Design als Referenz, aktives Modell 0.2.0 mit Quali-/Practice-Features.
- Keine neue AWS-Abhängigkeit. Vercel-Deploy beider Apps bleibt unverändert (nur Frontend-Code).

## Definition of Done

- Predictor ist ein Rennwochenende-Hub mit allen Panels (AC-1…AC-9), Demo-Modus inklusive (AC-11), live auf Vercel.
- Dashboard-Landing + Live-Seite teilen das Design-Vokabular + Team-Farben (AC-10), bestehende Funktion unverändert grün.
- Alle externen Quellen Zod-validiert, jedes Panel degradiert unabhängig (AC-12).
- Tests: Unit für neue Pure-Logik (Zeit-/Geometrie-/Farb-/Mapping-Helfer), Component-Tests für kritische Panels, je 1 Playwright-Smoke pro App grün (Constitution X).
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test` grün; CI grün.
- README aktualisiert (Screenshots/Beschreibung der Hub-Features, Datenquellen-Attribution), Spec-Status `done`, `git tag phase-7-done`.
