# Spec: Feedback Loop

> **Phase:** 005
> **Status:** in progress — Spec ausgearbeitet (war Stub bis Phase 6 done)
> **Owner:** Martin
> **Constitution:** II (vorzeigbares Artefakt: Saison-Chart), III (geteilte Schemas/Keys, einmal gebaut), IV (Kosten: ~24 Läufe/Jahr, kein Polling), VI (Zod an jeder Grenze), VIII (Alarm pro Lambda), IX (versionierte Modelle, kein `latest/`), X (pragmatische Tests), XII (README erzählt die Loop-Story).

## Problem / Motivation

Der Schritt, der aus zwei Projekten ein System macht: Vorhersagen werden mit tatsächlichen Race-Ergebnissen verglichen, eine messbare Trefferquote entsteht, und das Modell wird über die Saison nachvollziehbar besser (oder eben nicht — auch das ist ein Ergebnis). **Im Interview die stärkste Story.**

Die Daten liegen bereits vollständig im eigenen System: `F1Predictions` hält jede Pre-Race-Vorhersage (RETAIN, kein TTL — genau dafür angelegt), und das S3-Archiv (`raw/sessions/…jsonl`, Phase 1 Archiver) enthält die `position`-Ticks bis Rennende, also das tatsächliche Ergebnis. Phase 5 verbindet beide — ohne neue externe Datenquelle für das Ergebnis selbst.

## User Stories

- **US-1:** Als F1-Fan möchte ich nach jedem Rennen sehen, wie gut das Modell vorhergesagt hat (Brier Score, Top-3-Hit-Rate).
- **US-2:** Als ML-Reviewer möchte ich einen Trend sehen: wird das Modell über die Saison besser? (Saison-Chart, pro Rennen ein Datenpunkt, Modell-Version annotiert.)
- **US-3:** Als Developer möchte ich, dass die Auswertung automatisch nach jedem Rennen läuft — ohne manuellen Trigger und ohne 24/7-Polling.
- **US-4:** Als Betreiber möchte ich einen dokumentierten Re-Training-Runbook-Pfad: neue Daten → neues semver-Artefakt → Roll-out-Gate → Version-Flip (manuell, wie in Phase 6 erprobt).

## Metriken (Definition)

| Metrik          | Definition                                                                                                                                             |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `top3_hit_rate` | \|vorhergesagte Top-3 ∩ tatsächliche Top-3\| / 3 — Top-3 der Vorhersage = die 3 höchsten `podium_probability`-Fahrer des Rennens.                      |
| `brier_score`   | Mittel über alle vorhergesagten Fahrer von `(p_i − y_i)²`, mit `y_i = 1` wenn der Fahrer tatsächlich auf dem Podium landet, sonst 0. Kleiner = besser. |

Tatsächliches Podium = die letzten bekannten `position`-Werte (Plätze 1–3) aus dem archivierten Race-Session-JSONL.

## Acceptance Criteria

EARS-Stil, beobachtbar/prüfbar.

- **AC-1:** Wenn der Phase-1-Archiver eine Session konsolidiert hat, löst er ein Event aus, das die Evaluation-λ startet. Die λ prüft selbst, ob die Session ein Rennen ist und ob Vorhersagen existieren; Nicht-Rennen und Rennen ohne Vorhersagen beenden den Lauf sauber (Metrik, kein Fehler).
- **AC-2:** Für jedes ausgewertete Rennen werden `top3_hit_rate`, `brier_score`, vorhergesagte + tatsächliche Top-3, `model_version` und `evaluated_at` in `F1Predictions` persistiert — einmal unter dem Race-PK (`race#<date>#<round>`, SK `evaluation`) und einmal unter einem Saison-PK (`season#<year>`, SK `eval#<round>`), damit der Saison-Chart mit **einer** Query lädt. Schreiben ist idempotent (Re-Run überschreibt deterministisch).
- **AC-3:** Das Predictor-Frontend zeigt einen "Saison-Performance"-Chart: Top-3-Hit-Rate und Brier Score pro Rennen über die Saison, geladen über die bestehende Read-API (neuer `?season=<year>`-Modus), validiert gegen ein geteiltes Zod-Schema in `@f1/shared` (Constitution III/VI). Ohne ausgewertete Rennen zeigt die Seite einen Empty-State, keinen Fehler.
- **AC-4:** Re-Training bleibt **manuell** (Spec-Empfehlung R-1, in Phase 6 erprobt): das Runbook (Backfill → Training → Roll-out-Gate vs. aktive Version → Publish `models/<semver>/` → Version-Flip) ist in `docs/` bzw. README dokumentiert. Eine automatisierte Pipeline (Step Functions) ist explizit out of scope, der Weg dahin ist beschrieben.
- **AC-5 (revidiert):** Die aktive Modell-Version bleibt ein **explizit gepinnter** `ACTIVE_MODEL_VERSION` (PipelineStack → Schedule-Sync → Inference-Event) — kein `latest/`-Pointer (Constitution IX) und kein automatischer Flip, weil der Roll-out durch ein Gate + menschliche Entscheidung geht (Phase 6 AC-4). Der Flip ist eine reviewbare Ein-Zeilen-Änderung; das Runbook (AC-4) beschreibt ihn.
- **AC-6:** Die Evaluation-λ hat strukturiertes JSON-Logging, EMF-Metriken und mindestens einen CloudWatch-Alarm auf Fehler (Constitution VIII), angebunden an das bestehende `f1-alerts`-SNS-Topic.
- **AC-7:** Validierung an allen Grenzen: Archiv-Zeilen werden gegen `PipelineEventSchema`/`PositionSchema` geparst, DDB-Items und API-Responses gegen geteilte Zod-Schemas; Drift scheitert laut (Constitution VI).

## Out of Scope

- A/B-Testing zwischen Modellversionen.
- Real-time-Inference während des Rennens.
- Automatisiertes Re-Training (Step Functions/Fargate) — nur dokumentiert, nicht gebaut.
- Drift-Detection (Q-1) — Bonus, nicht Pflicht; ggf. spätere Phase.
- Offizielle Post-Race-Strafen (siehe R-2) — wir werten den letzten Live-Stand, nicht die Tage später bestätigte Klassifikation.

## Resolved Decisions

- **D-1 (Ergebnisquelle):** Tatsächliches Podium aus dem **eigenen S3-Archiv** (letzter `position`-Tick pro Fahrer), nicht aus einer weiteren externen API — das schließt den Kreislauf über die eigene Pipeline und braucht null neue Datenabhängigkeiten für das Ergebnis.
- **D-2 (Trigger):** Custom-EventBridge-Event vom Archiver (`SessionArchived {date, session_id}`) statt S3-Object-Created-Notifications — Letztere feuern auch für jede Part-Datei (tausende pro Session) und müssten erst weggefiltert werden; das Archiver-Event feuert genau einmal pro konsolidierter Session.
- **D-3 (Race-Erkennung + Round):** Die Evaluation-λ klärt per OpenF1 `/sessions` (2 Calls, Zod-validiert), ob `session_id` ein Rennen ist, und berechnet `round` mit derselben Logik wie Schedule-Sync (1-basierte Position unter den **nicht abgesagten** Race-Sessions der Saison) — so matcht der PK exakt den der Inference-λ. Abgesagte Rennen zählen nicht: die offizielle Nummerierung (Jolpica, nach der das Frontend abfragt) überspringt sie; 2026 hätten zwei abgesagte Frühjahrs-Rennen sonst jede spätere Runde um zwei verschoben (in T11 real aufgefallen und in beiden λ gefixt).
- **D-4 (Persistenz):** Doppelt geschrieben (Race-PK + Saison-PK) statt GSI/Scan — ein Writer, idempotent, eine Query pro Konsument. Key-Helpers in `@f1/shared/ddb-keys` + `f1pred/ddb_keys.py`-Spiegel falls nötig (aktuell liest nur TS).
- **D-5 (AC-5-Auflösung):** Der Stub forderte "λ lädt immer die neueste Version (latest-Pointer)" — das kollidiert mit Constitution IX (`nie latest/`) und mit dem Phase-6-Roll-out-Gate (neue Version erst nach bestandenem Gate aktiv). Gepinnter `ACTIVE_MODEL_VERSION` **ist** der Pointer, nur explizit und reviewt.

## Risks & Open Questions

- **R-1 (Re-Training automatisiert vs. manuell):** entschieden — manuell, dokumentiert (AC-4). Automatisierung wäre Step Functions + Fargate (Training > 15 min Lambda-Limit); als Skizze im Runbook festgehalten.
- **R-2 (Post-Race-Strafen):** Der letzte `position`-Tick ist das Live-Ergebnis beim Abwinken; nachträgliche Zeitstrafen/Disqualifikationen (selten, aber real) können das offizielle Podium ändern. Akzeptiert und dokumentiert; ein späterer Abgleich gegen Jolpica-`results` wäre ein additiver Folgetask.
- **R-3 (Archiv unvollständig):** Poller-Ausfall am Rennende → letzte Position-Ticks fehlen oder Archiv leer. Policy: < 3 Fahrer mit Positionsdaten → Lauf scheitert laut (Alarm) statt eine falsche Hit-Rate zu schreiben.
- **R-4 (Kein Predictions-Eintrag):** Inference-λ ist nicht gelaufen (Alarm gab es dann schon in Phase 4) → Evaluation beendet sich mit Metrik `EvaluationSkippedNoPredictions`, kein Fehler — sonst pagt jedes Nicht-Renn-Wochenende doppelt.
- **R-5 (Sprint-Wochenenden):** Vorhersagen existieren nur für `session_name === "Race"` (Schedule-Sync `isRace`); Sprints werden von der Race-Erkennung (D-3) übersprungen — kein Sonderfall nötig.
- **Q-1 (Drift-Detection):** bleibt offen/Bonus — der Saison-Chart macht Degradation ohnehin sichtbar.

## Dependencies

- Phasen 1–4 + 6 abgeschlossen (✅): Archiver (Trigger-Quelle), `F1Predictions` (RETAIN, Vorhersagen seit Phase 4), S3-Archiv (Ergebnisquelle), Read-API + Predictor-Frontend (Anzeige), aktives Modell `0.2.0`.
- Mindestens 1 Rennen mit Vorhersage **und** archivierter Race-Session zum Verifizieren; DoD braucht 3 (laufen über die Saison auf).

## Definition of Done

- Evaluation-λ deployed, mit Alarm + Dashboard-Widget; Unit-Tests für Metrik-Berechnung, Podium-Extraktion und Edge-Cases (R-3/R-4); Trigger-Pfad Archiver→λ nachgewiesen.
- Mindestens 3 Rennen mit Vorhersage + tatsächlichem Ergebnis verglichen (läuft automatisch über die Saison auf; Backfill bereits archivierter Rennen zählt).
- Saison-Chart im Predictor-Frontend live (Vercel), Empty-State inklusive.
- Re-Training-Runbook dokumentiert (AC-4).
- README erzählt die Loop-Story (Diagramm-Update + 1 Absatz, Phasen-Tabelle aktualisiert).
- Spec-Status: `Feedback Loop → done`, `git tag phase-5-done`.
