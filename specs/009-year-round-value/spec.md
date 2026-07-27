# Spec: Year-Round Value — Post-Session Ingest, Prediction Archive, Race Analysis

> **Phase:** 009
> **Status:** draft — awaiting review
> **Owner:** Martin
> **Constitution:** II (jede Phase liefert Vorzeigbares), III (geteilte Basis), IV (Kostenkontrolle — dieser Phase _senkt_ die Kosten), V (**Demo muss jederzeit funktionieren** — der Kern dieser Phase), VI (Zod an allen Grenzen), VIII (Observability), X (pragmatische Tests), XII (README aktuell).

## Problem / Motivation

Am 2026-07-27 wurde geprüft, was die beiden deployten Apps einem Besucher
tatsächlich zeigen. Ergebnis: **strukturell nichts** — und zwar aus drei
unabhängigen Gründen, die alle in derselben Woche verifiziert wurden.

**(1) OpenF1 hat Echtzeitdaten hinter eine Bezahlschranke gestellt.** Laut
openf1.org gilt: _„Data is considered live from 30 minutes before a session
starts until 30 minutes after it ends. Outside of this window, data is
classified as historical and is free to access."_ Live-Zugriff (REST/MQTT/WS)
kostet 9,90 €/Monat. Der Poller (`infra/lambda/poller/handler.ts:97`) schickt
keinerlei Credentials und pollt **exakt** innerhalb dieses Fensters. Messung im
Hungary-Race-Fenster (2026-07-26): **15.289 × HTTP 401, 0 erfolgreiche Ticks.**
Konsequenz: für **kein einziges Rennen 2026** liegt ein Archiv in S3
(`raw/sessions/2026-07-19/` und `.../2026-07-26/` sind leer). Damit ist auch der
Replay-Modus wertlos — obwohl Constitution V ihn als _Pflicht-Feature_ führt —
und die Feedback-Loop feuert nie, weil `SessionArchived` für Race nie entsteht.

**(2) Der Predictor zeigt fast immer eine leere Hülle.** Vorhersagen entstehen
einmal pro Rennen (T-60min), und es gibt **keinen Weg, vergangene Vorhersagen
anzusehen** — `page.tsx:166` holt ausschließlich das Zielrennen. Zwischen zwei
Rennwochenenden (typisch 14 Tage) zeigt das Kernstück „Podiums-Vorhersage
erscheint rund eine Stunde vor Rennstart", `GridVsPrediction` rendert `null`.
Das eigentliche Alleinstellungsmerkmal — die Bedrock-Erklärungen — ist hinter
einem Klick versteckt und standardmäßig unsichtbar.

**(3) `/live` ist ganzjährig eine Leerseite.** Sie zeigt „Waiting for session
data…". Der Replay-Fallback existiert und funktioniert, ist aber ein nacktes
Textfeld für eine Session-ID, die **nirgends in der UI auffindbar** ist.

Der Bug, der die Vorhersagen zusätzlich seit Runde 7 komplett gestoppt hat
(IAM-ARN mit Slash statt Doppelpunkt), ist bereits separat gefixt (`b4b96c1`)
und ist **nicht** Teil dieser Phase.

Die Datenlage ist dabei exzellent: Jolpica liefert für jedes gefahrene Rennen
2026 vollständige **Runden-für-Runde-Zeiten und Positionen** (1429 Records für
Ungarn) und **Boxenstopps** (45), OpenF1 liefert 30 Minuten nach Sessionende
Laps/Stints/Intervals/Race-Control **kostenlos**. Der Rohstoff für echte
Rennanalyse liegt vor — er wird nur nicht geholt.

## Ziel

Beide Apps sollen an einem beliebigen Dienstag im August genauso viel wert sein
wie 60 Minuten vor dem Start in Zandvoort.

## User Stories

- **US-1 (Archiv statt Wartezimmer):** Als Fan wähle ich jedes vergangene Rennen der Saison und sehe die damalige Vorhersage, die Bedrock-Begründung, die SHAP-Beiträge und daneben das tatsächliche Ergebnis — auch Wochen später.
- **US-2 (Rennverlauf):** Als Fan sehe ich für jedes gefahrene Rennen, wie sich die Positionen Runde für Runde entwickelt haben, wann wer an die Box kam und wie sich der Abstand zur Spitze verändert hat.
- **US-3 (Strategie):** Als Fan erkenne ich auf einen Blick die Stint-/Reifenstrategie eines Rennens und kann zwei Fahrer direkt vergleichen.
- **US-4 (Replay ohne Vorwissen):** Als Besucher starte ich ein Replay, indem ich ein Rennen aus einer Liste wähle — nicht indem ich eine Session-ID kenne.
- **US-5 (Archiv wird gefüllt):** Als Betreiber bekomme ich nach jeder Session automatisch das vollständige Datenpaket in S3, ohne für Live-Zugriff zu bezahlen.
- **US-6 (Loop schließt sich):** Als Betreiber sehe ich nach jedem Rennen automatisch Trefferquote und Brier-Score in der Saison-Auswertung.
- **US-7 (Erklärung sichtbar):** Als Fan lese ich die Modell-Begründung, ohne erst irgendwo hinklicken zu müssen.

## Acceptance Criteria

EARS-Stil, beobachtbar/prüfbar.

- **AC-1 (Post-Session-Ingest):** Für jede Session programmiert `F1-ScheduleSync` **einen** One-Shot-Lauf auf `session_end + 35min` statt eines Poll-Fensters während der Session. Der Lauf holt die komplette Session (`laps`, `position`, `intervals`, `stints`, `pit`, `weather`, `race_control`) in einem Durchgang, Zod-validiert, und schreibt sie nach DynamoDB + S3. Kein Request fällt mehr in OpenF1s Live-Fenster; HTTP 401 kommt nicht mehr vor.
- **AC-2 (Archiv existiert):** Nach dem ersten Rennen unter der neuen Logik liegt unter `raw/sessions/<date>/<session_key>.jsonl` ein vollständiges Archiv der **Race**-Session, und `SessionArchived` wird dafür emittiert.
- **AC-3 (Feedback-Loop feuert):** `F1-Evaluation` wird für die Race-Session ausgeführt (nicht mehr nur für Practice/Quali), schreibt einen Evaluations-Record, und die Read-API liefert unter `?season=2026` ein nicht-leeres `races`-Array.
- **AC-4 (Prediction-Archiv):** Der Predictor hat einen Rundenselektor über alle Runden mit vorhandener Vorhersage. Die Auswahl setzt `?round=N` (teilbarer Link) und zeigt Vorhersage, Bedrock-Begründung, SHAP-Wasserfall und — falls das Rennen gelaufen ist — das tatsächliche Ergebnis mit Treffer-Markierung. Default: nächstes Rennen, sonst letztes mit Vorhersage.
- **AC-5 (Positionsverlauf):** Für jedes gefahrene Rennen zeigt ein Chart die Position jedes Fahrers pro Runde (Quelle: Jolpica `/laps`), mit Hover-Detail und Fahrer-Hervorhebung. Boxenstopps (Jolpica `/pitstops`) sind als Marker eingezeichnet.
- **AC-6 (Pace + Strategie):** Ein zweites Panel zeigt Rundenzeiten-Pace (Ausreißer wie SC-Runden gedämpft) und eine Stint-Leiste je Fahrer. Zwei Fahrer können zum direkten Vergleich ausgewählt werden.
- **AC-7 (Replay-Picker):** `/live` bietet eine Liste der archivierten Sessions (aus S3 abgeleitet, server-seitig). Ein Klick startet das Replay. Das freie Textfeld bleibt höchstens als Fallback und ist nicht mehr der einzige Weg.
- **AC-8 (`/live` off-season nützlich):** Läuft keine Session, zeigt `/live` statt „Waiting for session data…" das zuletzt archivierte Rennen als startbereites Replay — Constitution V erfüllt.
- **AC-9 (Erklärung sichtbar):** Die Bedrock-Begründung des Top-1-Fahrers ist ohne Interaktion sichtbar; die übrigen bleiben aufklappbar.
- **AC-10 (Design-Konsistenz):** `/live` nutzt die geteilten `@f1/shared`-Tokens statt hartkodierter Hex-Werte und ist visuell konsistent mit Explorer + Predictor-Hub.
- **AC-11 (Degradation):** Jede externe Quelle wird Zod-validiert; jedes Panel degradiert einzeln mit einem verständlichen Hinweis. Kein Ausfall reißt eine Seite ab.
- **AC-12 (Kosten):** Der Steady-State-Footprint sinkt gegenüber heute (weniger Lambda-Invocations, keine neuen Services). Der Plan weist ihn aus.

## Free data sources (kein Key)

| Quelle         | Liefert                                                                                                                 | Einsatz                    |
| -------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| Jolpica/Ergast | `/laps` (Position + Zeit je Runde), `/pitstops`, Results, Quali, Standings                                              | server-seitig, ISR         |
| OpenF1         | `/laps`, `/position`, `/intervals`, `/stints`, `/pit`, `/weather`, `/race_control` — **frei ab 30min nach Sessionende** | Ingest-λ + server-seitig   |
| open-meteo     | Renntag-Prognose (nur ~16 Tage Horizont)                                                                                | server-seitig, best-effort |

## Out of Scope

- **Bezahlter OpenF1-Live-Zugang.** Bewusst entschieden (2026-07-27): kostenloser Post-Session-Pfad statt 9,90 €/Monat. Die Live-Telemetrie-Story wird ehrlich zur Rennanalyse-Story umgedeutet, nicht simuliert.
- Modelländerungen jeder Art — kalibrierte Multi-Head-Vorhersagen bleiben Phase 10 (vormals „Phase 9" im Roadmap-Memo).
- Telegram-Briefing, Live-Win-Probability, öffentliches Produkt (spätere Phasen).
- Neue AWS-Services. Diese Phase ändert Scheduling + Lambda-Logik, fügt nichts hinzu.
- Sektor-/Telemetrie-Deep-Dive (`/car_data`) — die Payloads sind groß, der Nutzen für diese Phase gering.

## Resolved Decisions

- **D-1 (Post-Session statt Live-Poll):** Ein One-Shot-Lauf auf `end + 35min` ersetzt ~700 Poll-Ticks pro Session. Er ist **billiger, vollständiger und robuster**: historische Daten sind final (kein Nachziehen von Korrekturen), es gibt keinen Rate-Limit-Sturm mehr, und der Lambda-Deadline-Schutz aus `05751e8` wird zur reinen Absicherung. Der Verlust ist die Echtzeit — die es faktisch nie gab.
- **D-2 (Positionsverlauf aus Jolpica, nicht OpenF1):** Jolpica `/laps` liefert Position **und** Rundenzeit in einem paginierten Aufruf und deckt die gesamte Saison ab, auch Rennen vor dieser Phase. Damit funktioniert US-2 rückwirkend ab Runde 1, ohne auf das neue Archiv zu warten.
- **D-3 (Archiv-Index aus S3, nicht neue Tabelle):** Die Replay-Session-Liste wird aus den vorhandenen S3-Keys abgeleitet (Constitution III: keine Zweitquelle für dieselbe Wahrheit, kein neuer Service).
- **D-4 (Charts hand-gerollt mit visx):** Das Dashboard hat `@visx/*` bereits; der Predictor bekommt es dazu. Kein schweres Chart-Framework — konsistent mit dem bestehenden `SeasonPerformance`-Chart.
- **D-5 (Prediction-Archiv über bestehende Read-API):** Die API kann bereits nach `race_date`+`round` abfragen. Es braucht nur einen Rundenselektor im Frontend und eine Liste verfügbarer Runden.

## Risks & Open Questions

- **R-1 (35-Minuten-Puffer zu knapp):** OpenF1s „live" endet 30min nach Sessionende; 35min lässt 5min Luft. Läuft eine Session über (rote Flagge), verschiebt sich das Ende. Mitigation: Ingest-λ prüft die Session-Metadaten und terminiert sich bei HTTP 401 selbst neu (ein Retry auf +30min), statt Daten zu verlieren. Alarm bei zweitem Fehlschlag.
- **R-2 (Jolpica-Pagination):** `/laps` liefert 1429 Records für ein Rennen bei Default-Limit 30 — Pagination ist Pflicht, sonst zeigt der Chart nur die ersten Runden. Mitigation: `limit=100` + Schleife bis `total`, aggressiv ISR-gecacht (Ergebnisse ändern sich nie).
- **R-3 (Rückwirkende Archive fehlen):** Für die Rennen 1–11 gibt es kein S3-Archiv und der Replay bleibt dort leer. Mitigation: Das Ingest-λ ist parametrisierbar; ein einmaliger Backfill-Lauf über die vergangenen Sessions ist möglich (jetzt kostenlos, weil alles historisch ist). Als eigener Task geführt, nicht als Blocker.
- **R-4 (Positionsverlauf-Chart mit 20 Linien wird Spaghetti):** Mitigation: Default nur Top-10 + Fokusfahrer, Rest ausgegraut/opt-in.
- **R-5 (Off-Season-Leere bleibt bestehen):** Nach dem letzten Rennen der Saison gibt es keine neuen Daten. Mitigation: `/live` fällt auf das zuletzt archivierte Rennen zurück (AC-8), das Archiv bleibt navigierbar.

## Dependencies

- `b4b96c1` (IAM-ARN-Fix) und `67a7648` (Consumer-Dedupe) sind deployed — sonst schreibt der Ingest weiter in eine kaputte Batch-Logik und es entstehen keine neuen Vorhersagen.
- `@f1/shared`: OpenF1-Schemas, `S3_PATHS`, `ddb-keys`, Design-Tokens, Team-Farben — alle vorhanden.
- Bestehende Read-API (`race_date`+`round`, `season`) — unverändert nutzbar.

## Definition of Done

- Alle AC erfüllt; Post-Session-Ingest hat mindestens **eine echte Session** vollständig archiviert und die Feedback-Loop hat dafür einen Evaluations-Record geschrieben.
- `pnpm typecheck/lint/format:check/test` grün; CI grün; `cdk synth` grün.
- Playwright-Smokes für Prediction-Archiv, Rennverlauf-Chart und Replay-Picker grün.
- README aktualisiert — insbesondere die Architektur-Grafik und die ehrliche Beschreibung „Post-Session-Ingest" statt „5s-Live-Polling" (Constitution XII).
- Spec-Status `done`, `git tag phase-9-done`.
