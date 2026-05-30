# Spec: Data Pipeline

> **Phase:** 001
> **Status:** spec-ready
> **Owner:** Martin
> **Constitution:** alle Artikel — besonders III (geteilte Basis), IV (Kostenkontrolle), VI (Schema-Validierung), VII (Security), VIII (Observability).

## Problem / Motivation

Dies ist der **Backbone**: ein event-driven Ingest-Loop, der OpenF1-Daten kontinuierlich (nur während Sessions) abfragt, in eine Queue puffert, validiert, persistiert und archiviert. Phase 2 (Dashboard) konsumiert den Live-Zustand, Phase 3 (ML) trainiert auf dem Archiv. Ohne Phase 1 existiert nichts Echtes.

Diese Phase ist auch das **technisch interessanteste** Stück — sie demonstriert Lambda, SQS, DynamoDB, S3, EventBridge, CloudWatch in einem realistischen Zusammenspiel.

## User Stories

- **US-1:** Als Operator möchte ich, dass die Pipeline automatisch losläuft, sobald eine F1-Session beginnt, und automatisch stoppt, wenn sie vorbei ist — damit ich keine 24/7-Polling-Kosten zahle.
- **US-2:** Als Phase-2-Frontend möchte ich den **aktuellen** Stand eines Rennens (Positionen, Gaps, Stints) per WebSocket-fähigem Backend abfragen können.
- **US-3:** Als Phase-3-ML-Pipeline möchte ich abgeschlossene Sessions als geordnete JSONL-Files in S3 finden, damit ich darauf trainieren kann.
- **US-4:** Als Operator möchte ich gewarnt werden, wenn der Feed mitten in einer Session abreißt (Schweigen ist verdächtiger als Fehler).
- **US-5:** Als Developer möchte ich, dass Schema-Drift in OpenF1 die Pipeline laut zum Stehen bringt, statt still falsche Daten zu schreiben.

## Acceptance Criteria

- **AC-1:** WENN eine F1-Session (Practice / Qualifying / Race / Sprint) gemäß OpenF1 `sessions` Endpoint **aktiv** ist, DANN SOLL eine EventBridge-Rule alle 5 Sekunden die Poller-Lambda triggern.
- **AC-2:** WENN keine Session aktiv ist, DANN SOLL die Polling-Rule **deaktiviert** sein (kein Idle-Polling).
- **AC-3:** Die Poller-Lambda SOLL die Endpoints `positions`, `intervals`, `laps`, `stints`, `weather` mit dem aktuellen `session_key` abfragen, die Responses gegen Zod-Schemas validieren und einzelne Events in SQS schreiben.
- **AC-4:** Die Consumer-Lambda SOLL aus SQS lesen, den Live-State in DynamoDB schreiben (mit TTL 24h) und nach Session-Ende eine kompakte JSONL-Datei nach `s3://<bucket>/raw/sessions/<YYYY-MM-DD>/<session_id>.jsonl` schreiben.
- **AC-5:** WENN ein Schema-Validation-Fail auftritt, DANN SOLL die Nachricht in die DLQ wandern UND eine CloudWatch-Metrik `SchemaValidationFailure` mit der Endpoint-Bezeichnung emittiert werden.
- **AC-6:** WÄHREND einer aktiven Session SOLL ein CloudWatch-Alarm feuern, wenn 15 Minuten keine erfolgreichen Consumer-Invocations stattfanden ("Feed abgerissen").
- **AC-7:** Das DynamoDB-Schema SOLL Single-Table sein mit `PK=session#<id>`, `SK=<entity>#<...>` und TTL-Attribut, sodass abgelaufene Live-Daten automatisch verschwinden.
- **AC-8:** Die Gesamt-Pipeline SOLL bei einem 2-stündigen Rennen ≤ 1 € kosten (Annahme dokumentiert).
- **AC-9:** Eine archivierte Session SOLL aus S3 in vollständig **chronologisch geordneter** Reihenfolge gelesen werden können (wichtig für Phase 2 Replay und Phase 3 Training).
- **AC-10:** Ein lokaler Integrationstest (LocalStack oder Mock) SOLL die Pipeline End-to-End mit Fixture-Daten durchlaufen.

## Out of Scope

- WebSocket-API für Frontend (Phase 2 — DynamoDB Streams werden hier vorbereitet, aber die API-Gateway-Route nicht).
- Frontend (Phase 2).
- ML-Feature-Pipeline (Phase 3 — die liest nur aus S3, das hier befüllt wird).
- Historische Daten aus FastF1 (Phase 3 — komplett anderer Pfad).
- Authentifizierung von Lambda-Endpoints (es gibt keine öffentlichen Endpoints in Phase 1).

## Risks & Open Questions

- **R-1:** OpenF1 hat Rate-Limits — TBD welche genau (Doku checken, ggf. anfragen). Mitigation: SQS als Buffer; Poller mit exponentiellem Backoff bei 429.
- **R-2:** OpenF1-Schema kann sich ändern (Community-API). Mitigation: Zod-Validierung + DLQ + Alarm.
- **R-3:** "Session aktiv" zu detecten ist nicht trivial — OpenF1 hat einen `sessions` Endpoint, aber wir müssen Vor-/Nachlauf (Practice startet 15 Min vorher, Race-Stewards laufen 30 Min nach) berücksichtigen. Vorschlag: Cron-basierter Rule-Switcher, der täglich die `sessions`-Liste abfragt und für jede Session ein Zeitfenster (Start −15 min, Ende +30 min) als Enable/Disable-Schedule setzt.
- **R-4:** Lambda-Cold-Starts bei 5s-Polling — Lambda hat eine kalte Sekunde, die nächste ist warm. Bei 5s-Intervall sollte das OK sein. Kein Provisioned Concurrency in Phase 1.
- **R-5:** SQS FIFO vs. Standard — FIFO garantiert Ordnung, kostet aber mehr und hat Throughput-Limits. Standard reicht: Ordnung stellen wir beim S3-Write per Timestamp her, nicht im Stream.
- **Q-1:** Wie lange ist "Session-Ende" definiert? Vorschlag: 30 Minuten ohne neue `laps`-Events → trigger Archivierungs-Job (Step Functions oder einfacher Cron).
- **Q-2:** Sollen `weather` und `intervals` mit derselben Frequenz gepollt werden wie `positions`? `weather` ändert sich langsam — 30s reicht. Entscheidung im `plan.md`.

## Dependencies

- Phase 0 abgeschlossen (Monorepo, CDK, S3-Bucket, IAM).
- OpenF1 API erreichbar (öffentlich, kein Key nötig — gut).
- AWS-Region mit allen genutzten Services (Lambda, SQS, DynamoDB, EventBridge, CloudWatch) — `eu-central-1` ✓.

## Definition of Done

- Pipeline ist deployed und hat **mindestens eine echte Session** komplett ingestiert (Free Practice reicht). Archiv-File in S3 vorhanden.
- DynamoDB enthält Live-State während der Session, ist nach TTL leer.
- CloudWatch-Dashboard zeigt: Poller-Invocations, SQS-Tiefe, Consumer-Errors, Archiv-File-Count.
- "Feed abgerissen"-Alarm wurde mindestens einmal manuell getestet (Rule deaktivieren, Alarm beobachten).
- Cost-Report nach erstem Wochenende: ≤ 1 €.
- `README.md` Spec-Status: `Data Pipeline` → `done`.
