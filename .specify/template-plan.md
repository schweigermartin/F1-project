# Plan: <Name>

> **Spec:** [spec.md](./spec.md)
> **Status:** draft | review | approved | implementing | done

## Architektur

Ein Diagramm (ASCII oder Link auf `docs/`) + 3–5 Sätze Erklärung der Datenflüsse und Komponenten-Grenzen.

## Komponenten

Pro Komponente:
- **Name + Verantwortung** (eine Aussage)
- **Runtime / Trigger** (Lambda + EventBridge / WebSocket Route / React Hook / …)
- **In/Out** (Eingangs- und Ausgangsverträge — Typen, Schemas, Event-Shapes)
- **Failure-Mode** (was passiert bei Fehler, Retry, DLQ, …)

## Datenmodelle

- DynamoDB: PK/SK, GSIs, TTL
- S3: Pfad-Layout, Object-Format, Lifecycle
- Frontend State: Stores, Query-Keys
- Schemas in `packages/shared` (Zod / Pydantic, Single Source of Truth)

## Externe Verträge

OpenF1-Endpoints, Bedrock-Modell-ID, FastF1-Cache-Layout, WebSocket-Message-Shape — alles, was die Phase mit der Außenwelt austauscht.

## Security & IAM

Welche Rollen, welche Permissions (least privilege), welche Secrets, wo gespeichert.

## Observability

- Logs: was wird strukturiert geloggt?
- Metriken: welche Custom Metrics?
- Alarme: welche Schwellen, welcher Receiver?

## Kosten-Footprint

Geschätzte €/Monat im Steady State. Annahmen explizit (z.B. "20 Renn-Wochenenden × 2h Polling × 12 Lambda-Calls/Min").

## Test-Strategie

Welche Layer werden wie getestet (Unit / Integration / E2E). Welche Fixtures.

## Abweichungen von der Constitution

Mit Begründung. Default: keine.
