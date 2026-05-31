# Spec: Inference + Bedrock

> **Phase:** 004
> **Status:** ready — plan.md + tasks.md abgeleitet, Entscheidungen geklärt; Implementierung wartet auf das publishte Phase-3-Artefakt
> **Owner:** Martin

## Problem / Motivation

Schließt Projekt 1 ab: Modell aus Phase 3 in Produktion bringen, Vorhersagen per LLM (Claude via Bedrock) in natürliche Sprache übersetzen. Zweite öffentliche Live-URL.

## User Stories

- **US-1:** Als F1-Fan möchte ich vor jedem Rennen pro Fahrer die Podium-Wahrscheinlichkeit als Balken sehen.
- **US-2:** Als F1-Fan möchte ich pro Fahrer eine ausklappbare, natürlichsprachliche Begründung sehen ("Verstappen 68% — weil ...").
- **US-3:** Als Operator möchte ich, dass Bedrock-Calls gecacht werden, damit ein zweiter Page-Load nichts kostet.

## Acceptance Criteria

- **AC-1:** Vor jedem Rennen werden Vorhersagen einmalig berechnet (Inference-Lambda) und in DDB persistiert.
- **AC-2:** SHAP-Top-N-Features pro Fahrer fließen als strukturierter Prompt in Bedrock (Claude). Output = max. 3 Sätze pro Fahrer.
- **AC-3:** Bedrock-Antworten werden in DDB neben der Vorhersage gecacht. Re-Requests ohne neue Vorhersage zahlen nichts.
- **AC-4:** Frontend zeigt sortierte Balken + Klick → Begründung sichtbar. Deployed auf Vercel.
- **AC-5:** Bedrock erklärt, sagt nicht vorher (Wahrscheinlichkeiten kommen aus dem Modell, nicht aus dem LLM) — Architektur-Constraint.

## Out of Scope

- Re-Training (Phase 5).
- Vergleich Vorhersage vs. Realität (Phase 5).
- Multi-Race-Vorhersagen für ganze Saison.

## Risks & Open Questions

- **R-1:** Bedrock-Region: Claude verfügbar in `eu-central-1`? Falls nein → separater Stack in `us-east-1` mit Cross-Region-Call.
- **R-2:** Prompt-Quality — viele Iterationen wahrscheinlich. Prompts in `packages/shared/src/bedrock-prompts.ts` versionieren.
- **Q-1:** Welches Claude-Modell? Haiku reicht für 3 Sätze pro Fahrer, ist günstig — Empfehlung Haiku 4.5.

## Dependencies

- Phase 3 abgeschlossen (Modell in S3).
- Bedrock-Access für den AWS-Account aktiviert (manueller Schritt in AWS-Konsole).

## Definition of Done

- Predictor-Frontend live auf Vercel.
- Vor mindestens einem realen Rennen Vorhersagen generiert und gespeichert.
- Bedrock-Output qualitativ geprüft (Stichprobe).
- Spec-Status: `Inference + Bedrock → done`.
