# Spec: Feedback Loop

> **Phase:** 005
> **Status:** stub — vollständig ausarbeiten nach Phase 4 done
> **Owner:** Martin

## Problem / Motivation

Der Schritt, der aus zwei Projekten ein System macht: Vorhersagen werden mit tatsächlichen Race-Ergebnissen verglichen, eine messbare Trefferquote entsteht, und (optional) das Modell wird über die Saison besser. **Im Interview die stärkste Story.**

## User Stories

- **US-1:** Als F1-Fan möchte ich nach jedem Rennen sehen, wie gut das Modell vorhergesagt hat (Brier Score, Top-3-Hit-Rate).
- **US-2:** Als ML-Reviewer möchte ich einen Trend sehen: wird das Modell über die Saison besser?
- **US-3:** Als Developer möchte ich, dass nach jedem Rennen automatisch neu trainiert wird, falls sich genug neue Daten angesammelt haben.

## Acceptance Criteria

- **AC-1:** Nach Race-Ende (Trigger: Phase 1 Archiver fertig) startet ein Evaluation-Job, der DDB-Vorhersagen mit dem tatsächlichen Ergebnis aus S3 abgleicht.
- **AC-2:** Trefferquote (Top-3-Hit-Rate, Brier Score) pro Rennen wird in DDB persistiert.
- **AC-3:** Predictor-Frontend zeigt einen "Saison-Performance"-Chart (Hit-Rate über Rennen).
- **AC-4:** OPTIONAL: Re-Training-Pipeline (Step Functions oder Manual-Trigger), die nach jedem Rennen mit dem erweiterten Datensatz neu trainiert und neue Modell-Version nach S3 schreibt.
- **AC-5:** Inference-Lambda lädt **immer** die neueste Modell-Version (latest-Pointer in S3 oder DDB-Lookup).

## Out of Scope

- A/B-Testing zwischen Modellversionen.
- Real-time-Inference während des Rennens.

## Risks & Open Questions

- **R-1:** Re-Training automatisiert vs. manuell — automatisiert ist mehr Infra (Step Functions, ECS Fargate für längere Jobs), manuell reicht für Portfolio-Story. Empfehlung: erst manuell, dokumentieren wie es automatisiert würde.
- **Q-1:** Brauchen wir Drift-Detection (Datenverteilung ändert sich)? Bonus-Punkt, nicht Pflicht.

## Dependencies

- Phasen 1–4 abgeschlossen.

## Definition of Done

- Mindestens 3 Rennen mit Vorhersage + tatsächlichem Ergebnis verglichen.
- Saison-Chart im Predictor-Frontend.
- README erzählt die Loop-Story (Diagramm + 1 Absatz).
- Spec-Status: `Feedback Loop → done`.
