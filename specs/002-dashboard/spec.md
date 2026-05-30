# Spec: Live Dashboard

> **Phase:** 002
> **Status:** stub — vollständig ausarbeiten nach Phase 1 done
> **Owner:** Martin

## Problem / Motivation

Liefert das öffentliche Gesicht von Projekt 2: eine Live-URL, die in jede Bewerbung passt. Macht die in Phase 1 gesammelten Daten sichtbar.

## User Stories

- **US-1:** Als Recruiter möchte ich eine Live-URL öffnen und in <5s ein laufendes (oder repliziertes) F1-Rennen sehen, damit ich verstehe, was das Projekt tut.
- **US-2:** Als F1-Fan möchte ich Position, Gaps und Stints aller Fahrer in Echtzeit sehen.
- **US-3:** Als Recruiter möchte ich auch außerhalb von Renn-Wochenenden eine sinnvolle Demo sehen (Replay-Modus).

## Acceptance Criteria

- **AC-1:** WENN eine Session live ist, DANN SOLL das Frontend per WebSocket Live-Updates ohne manuelles Refresh anzeigen.
- **AC-2:** WENN keine Session live ist, DANN SOLL ein Replay-Toggle eine archivierte Session aus S3 in Echtzeit-Geschwindigkeit (oder konfigurierbar 2×/4×) abspielen.
- **AC-3:** Das Frontend SOLL deployed sein und unter einer öffentlichen Vercel-URL erreichbar.
- **AC-4:** Reconnect-Logik SOLL transparent funktionieren (z.B. Netzwerkabbruch → max 5s Re-Connect).
- **AC-5:** Lighthouse Performance ≥ 90 auf Desktop, ≥ 80 auf Mobile.

## Out of Scope

- Authentifizierung (öffentliche Demo).
- Mobile App (React Native — kein Scope).
- Predictor-UI (Phase 4).

## Risks & Open Questions

- **R-1:** API Gateway WebSocket-Quotas — TBD bei Plan.
- **R-2:** Replay-Modus muss S3-JSONL streamen können → presigned URLs vs. eigener Endpoint? Entscheidung im plan.md.
- **Q-1:** Library für Charts: Recharts (einfacher) oder visx (mächtiger, aufwendiger).

## Dependencies

- Phase 1 abgeschlossen (DDB + Streams + S3-Archiv vorhanden).

## Definition of Done

- Live-URL im README, mit Screenshot.
- Replay-Modus funktioniert mit mindestens einer archivierten Session.
- Lighthouse-Score erreicht.
- Spec-Status: `Live Dashboard → done`.
