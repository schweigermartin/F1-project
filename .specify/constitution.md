# Constitution — F1 Portfolio Project

Projektweite Prinzipien. Jede Phase, jeder Plan, jeder Task muss sich daran messen lassen. Änderungen an dieser Datei sind explizit zu begründen.

## I. Spec-First, Immer

Kein Code ohne `spec.md` (WAS/WARUM, Acceptance Criteria) → `plan.md` (WIE technisch) → `tasks.md` (Schritte). In genau dieser Reihenfolge. Wer mittendrin baut, schreibt Specs zurück, bevor er weiterbaut.

## II. Jede Phase liefert etwas Vorzeigbares

Eine Phase ist erst fertig, wenn sie für sich allein als Portfolio-Beleg taugt — Live-URL, Notebook, Diagramm oder funktionierendes System. Wenn das Projekt nach Phase N pausiert, muss N ein vollständiges Artefakt sein. Keine halben Features.

## III. Geteilte Basis, einmal gebaut

S3-Bucket, DynamoDB-Schema, IAM-Rollen, CDK-Konventionen werden **einmal** in Phase 0/1 entschieden und sind danach gesetzt. Beide Apps lesen aus derselben Pipeline. Doppel-Implementierungen sind ein Code-Smell.

## IV. Kostenkontrolle ist nicht optional

- Budget-Alarm in AWS (Schwellenwert in Phase 0 festlegen, z.B. 5–10 €) ist Pflicht vor dem ersten Lambda-Deploy.
- EventBridge-Polling läuft nur während aktiver Sessions, nie 24/7.
- DynamoDB On-Demand (Lernprojekt-Volumen), TTL auf allem Ephemeren.
- Bedrock-Calls cachen, nie pro Request neu.
- Jeder Plan dokumentiert seinen Kosten-Footprint (geschätzte €/Monat im Steady State).

## V. Demo muss jederzeit funktionieren

Es gibt nur ~20 Renn-Wochenenden im Jahr. Dazwischen muss das Dashboard trotzdem etwas zeigen. Replay-Modus aus S3-Archiv ist Pflicht-Feature, nicht Nice-to-have. Akzeptanzkriterium für Phase 2.

## VI. Typsicherheit + Validierung an Systemgrenzen

- TypeScript: keine `any`, keine `@ts-ignore` ohne begründenden Kommentar.
- Zod für alle externen Daten (OpenF1 Responses, WebSocket-Messages, Form-Inputs).
- Python: Type Hints überall, Pydantic für FastAPI/Lambda-Events.
- Schema-Drift (OpenF1 ändert Response) muss laut scheitern, nicht still durchrutschen.

## VII. Security by Default

- IAM Least Privilege — keine `*`-Policies, auch nicht "temporär".
- Secrets via AWS Secrets Manager oder SSM Parameter Store, nie in Env Files committen.
- Vercel: separate Env-Vars für Preview/Production.
- API Gateway: WebSocket-Auth (auch wenn das Projekt klein ist — Portfolio-Code wird gereviewt).
- Frontend-Bundle enthält keine AWS-Credentials oder Service-Role-Keys.

## VIII. Observability vor "es funktioniert"

Jede Lambda hat strukturiertes Logging (JSON) und mindestens einen CloudWatch-Alarm auf Failure-Rate oder Silence (z.B. "keine Messages in 15 Min während Session"). Wer ein Lambda ohne Alarm deployed, ist nicht fertig.

## IX. ML: Modell-Artefakte sind versioniert, Trainingsläufe reproduzierbar

- Modelle landen in S3 unter `models/<semver>/`, nicht `latest/`.
- Jedes Modell hat ein `model_card.md` (Daten, Features, Metriken, Limitations) neben dem Artefakt.
- Notebook + Random-Seed + Datenversion müssen denselben Score reproduzieren.
- Bedrock erklärt das Modell, ersetzt es nicht. Wahrscheinlichkeiten kommen aus XGBoost, Sprache aus dem LLM.

## X. Pragmatisches Testing

- Lambda-Handler: Unit-Tests für Business-Logik + ein Integrations-Test gegen LocalStack oder Mock-AWS.
- Frontend: Testing Library für kritische Interaktionen (WebSocket-Hook, Replay-Modus-Toggle), keine 100%-Coverage-Jagd.
- ML: Tests für Feature-Pipeline (Determinismus, kein Leakage), nicht für das Modell selbst.
- E2E: ein Playwright-Smoke-Test pro Frontend (Login/Connection → erste Daten sichtbar).

## XI. Commits klein, atomar, englisch

`<type>: <imperative>` — `feat: add openf1 poller lambda`. Eine logische Änderung pro Commit. Spec-Änderungen committen sich separat von Implementierung.

## XII. README ist die Eingangstür

`README.md` ist immer aktuell. Diagramm, Stack, Spec-Status, Live-URLs. Wer das Repo zum ersten Mal öffnet, versteht in 2 Minuten, was hier passiert. Recruiter-Test.
