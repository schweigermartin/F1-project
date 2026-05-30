# Spec: Live Dashboard

> **Phase:** 002
> **Status:** implemented (T1–T13); deploy + live-validation (T14–T16) ausstehend
> **Owner:** Martin
> **Constitution:** alle Artikel — besonders V (Demo muss jederzeit funktionieren → Replay), VI (Schema-Validierung an Systemgrenzen → WebSocket-Messages), VII (Security by Default → WebSocket-Auth), VIII (Observability).

## Problem / Motivation

Phase 1 sammelt Daten, die niemand sieht. Diese Phase liefert das **öffentliche Gesicht von Projekt 1**: eine Live-URL, die in jede Bewerbung passt und in <5s zeigt, was das System tut. Ohne sie ist die Pipeline ein unsichtbares Backend — ein Recruiter kann nichts „anklicken".

Weil es nur ~20 Renn-Wochenenden im Jahr gibt (Constitution V), muss das Dashboard **auch dazwischen** etwas Sinnvolles zeigen. Der Replay-Modus aus dem S3-Archiv ist deshalb Pflicht-Feature, nicht Beiwerk.

## User Stories

- **US-1:** Als Recruiter möchte ich eine Live-URL öffnen und in <5s ein laufendes (oder repliziertes) F1-Rennen sehen, damit ich ohne Erklärung verstehe, was das Projekt tut.
- **US-2:** Als F1-Fan möchte ich Position, Gaps, Stints/Reifen und Wetter aller Fahrer in Echtzeit sehen und wie sich die Reihenfolge über die Runden verändert.
- **US-3:** Als Recruiter möchte ich auch außerhalb von Renn-Wochenenden eine sinnvolle Demo sehen — eine archivierte Session, die in Echtzeit oder beschleunigt abgespielt wird.
- **US-4:** Als Operator möchte ich, dass eine unterbrochene Verbindung sich transparent neu verbindet, ohne dass der Nutzer die Seite neu lädt.

## Acceptance Criteria

EARS-Stil. Beobachtbar, prüfbar, ohne Implementierungs-Details.

- **AC-1:** WENN eine Session live ist, DANN SOLL das Frontend Positions-/Gap-/Stint-/Wetter-Updates ohne manuelles Refresh anzeigen, mit einer End-to-End-Latenz von ≤ 10s vom OpenF1-Poll bis zur Anzeige.
- **AC-2:** WENN keine Session live ist, DANN SOLL ein Replay-Toggle eine archivierte Session aus dem S3-Archiv abspielen — in Echtzeit-Geschwindigkeit oder konfigurierbar 2× / 4×.
- **AC-3:** Das Frontend SOLL unter einer öffentlichen URL erreichbar und ohne Login nutzbar sein.
- **AC-4:** WENN die Verbindung abbricht, DANN SOLL das Frontend innerhalb von ≤ 5s transparent neu verbinden und den aktuellen Zustand wiederherstellen, ohne sichtbare Daten-Lücke für den Nutzer.
- **AC-5:** WÄHREND der Replay läuft, SOLL die zeitliche Reihenfolge der Events der archivierten Session entsprechen (chronologisch, skaliert um den Speed-Faktor).
- **AC-6:** Das System SOLL eingehende Server-Nachrichten am Frontend und eingehende Client-Nachrichten am Backend gegen ein geteiltes Schema validieren; ungültige Nachrichten werden verworfen + geloggt, nie still verarbeitet (Constitution VI).
- **AC-7:** Lighthouse Performance SOLL ≥ 90 auf Desktop und ≥ 80 auf Mobile erreichen.
- **AC-8:** Der Betrieb SOLL im Steady State (keine Live-Session, keine offene Verbindung) ≈ 0 € kosten — keine Dauer-Verbindungen, kein 24/7-Compute (Constitution IV).

## Out of Scope

- Authentifizierung mit Nutzerkonten (öffentliche Demo; ein minimaler Anti-Abuse-Schutz fürs WebSocket ist Teil von Phase 2, echtes Login nicht).
- Mobile App (React Native — kein Scope).
- Predictor-UI mit Bedrock-Erklärungen (Phase 4).
- Historische Analysen / Cross-Session-Vergleiche (nie geplant für dieses Dashboard).
- Voll-Längen-Replay eines 2h-Rennens in 1×-Echtzeit am Stück: garantiert nur via Beschleunigung bzw. Self-Continuation (Plan §Replay) — 1× ist für Sessions/Segmente innerhalb des Lambda-Budgets zugesichert.

## Resolved Decisions

Die offenen Fragen des Stubs sind entschieden (Details + Begründung im plan.md):

- **Q-1 (Charts): visx.** Mehr Kontrolle über die F1-spezifischen Visualisierungen (Timing-Tower, Positions-Verlauf) ist den höheren Aufwand wert — Portfolio-Wert.
- **R-2 (Replay-Transport): eigener server-getriebener Replay-Endpoint.** Eine Lambda liest die S3-JSONL und streamt sie zeitgesteuert (1×/2×/4×) über **denselben** WebSocket wie Live — keine presigned URLs, kein clientseitiges Timing. Konsistenter Daten-Pfad Live = Replay.

## Risks & Open Questions

- **R-1:** API-Gateway-WebSocket-Quotas (Message-Size 128 KB, Idle-Timeout 10 min). Snapshot muss ggf. gechunkt werden → Entscheidung im Plan.
- **R-3:** Lambda-15-Min-Wall vs. langer Replay → Self-Continuation-Cursor (Plan §Replay). Risiko: verwaiste Replay-Ketten bei Disconnect → Abbruch-Check pro Chunk.
- **R-4:** Vercel ↔ AWS-WebSocket: Origin-Allowlist + Anti-Abuse-Token, damit fremde Clients keine Kosten erzeugen (Constitution IV+VII).
- **Q-2:** Snapshot-Quelle beim Connect — DDB-Live-Items (aktuelle Session) vs. letzter S3-Stand. Entscheidung im Plan (Default: DDB für Live, S3 für Replay).

## Dependencies

- **Phase 1 abgeschlossen** (✅): DynamoDB `F1Live` mit Streams (`NEW_AND_OLD_IMAGES`), S3-Archiv `raw/sessions/<date>/<session>.jsonl`, geteilte Schemas + Key-Helper in `@f1/shared`.
- Vercel-Account (Frontend-Deploy, Preview/Production-Env getrennt — Constitution VII).
- Mindestens eine archivierte Session im S3-Archiv für den Replay-Modus (erstes Live-Wochenende; für Demo notfalls ein hochgeladenes T3-Fixture).

## Definition of Done

- Live-URL im README, mit Screenshot.
- Live-Modus zeigt während einer aktiven Session Echtzeit-Updates (oder, außerhalb, nachweisbar gegen eine simulierte Stream-Quelle).
- Replay-Modus spielt mindestens eine archivierte Session mit 1×/2×/4× ab.
- Reconnect funktioniert nachweislich (Netzwerk-Drop → < 5s Recovery).
- Lighthouse-Score erreicht (AC-7), ein Playwright-Smoke-Test grün (Constitution X).
- Spec-Status: `Live Dashboard → done`, `git tag phase-2-done`.
