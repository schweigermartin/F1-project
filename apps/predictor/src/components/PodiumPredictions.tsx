"use client";

import type { PredictionApiResponse } from "@f1/shared";
import { type ReactNode, useState } from "react";

import { sortByPodium } from "../lib/predictions-api";
import styles from "./predictions.module.css";

/** Human-readable, German feature names for the SHAP drivers (US-2 detail). */
const FEATURE_LABELS: Record<string, string> = {
  grid_position: "Startplatz",
  quali_gap_to_pole_s: "Quali-Rückstand zur Pole",
  driver_form: "Fahrer-Form",
  constructor_form: "Team-Form",
  track_history: "Strecken-Historie",
  is_wet: "Nässe",
};

function pct(probability: number): string {
  return `${Math.round(probability * 100)} %`;
}

export interface PodiumPredictionsProps {
  response: PredictionApiResponse | null;
  raceName: string | null;
  raceDate: string | null;
}

export function PodiumPredictions({
  response,
  raceName,
  raceDate,
}: PodiumPredictionsProps): ReactNode {
  const [expanded, setExpanded] = useState<number | null>(null);

  if (!response || response.drivers.length === 0) {
    return (
      <section className={styles.empty}>
        <h2>{raceName ?? "Nächstes Rennen"}</h2>
        <p>
          Die Podiums-Vorhersage erscheint rund eine Stunde vor dem Renn­start
          {raceDate ? ` (${raceDate})` : ""}. Schau dann wieder vorbei.
        </p>
      </section>
    );
  }

  const drivers = sortByPodium(response.drivers);

  return (
    <section className={styles.board}>
      <header className={styles.head}>
        <div>
          <h2 className={styles.title}>{raceName ?? "Podiums-Vorhersage"}</h2>
          {raceDate ? <p className={styles.sub}>{raceDate}</p> : null}
        </div>
        <span className={styles.modelBadge} title="Modellversion">
          Modell v{response.model_version}
        </span>
      </header>

      <ol className={styles.list}>
        {drivers.map((d) => {
          const isOpen = expanded === d.driver_number;
          return (
            <li key={d.driver_number} className={styles.row}>
              <button
                type="button"
                className={styles.bar}
                aria-expanded={isOpen}
                onClick={() => setExpanded(isOpen ? null : d.driver_number)}
              >
                <span
                  className={styles.fill}
                  style={{ width: `${Math.round(d.podium_probability * 100)}%` }}
                  aria-hidden
                />
                <span className={styles.code}>{d.driver_code}</span>
                <span className={styles.prob}>{pct(d.podium_probability)}</span>
                {d.explanation ? (
                  <span className={styles.cacheBadge} title="Begründung aus Cache">
                    🅒
                  </span>
                ) : null}
              </button>

              {isOpen ? (
                <div className={styles.detail}>
                  {d.explanation ? (
                    <p className={styles.reason}>{d.explanation.bedrock_text}</p>
                  ) : (
                    <p className={styles.reasonPending}>Begründung folgt.</p>
                  )}
                  {d.shap_top.length > 0 ? (
                    <ul className={styles.shap}>
                      {d.shap_top.map((s) => (
                        <li key={s.feature}>
                          <span>{FEATURE_LABELS[s.feature] ?? s.feature}</span>
                          <span className={s.contribution >= 0 ? styles.pos : styles.neg}>
                            {s.contribution >= 0 ? "+" : ""}
                            {s.contribution.toFixed(2)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
