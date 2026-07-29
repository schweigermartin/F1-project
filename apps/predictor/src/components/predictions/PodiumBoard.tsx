"use client";

import {
  driverTeamColor,
  effectivePodiumProbability,
  modelProvenance,
  type PredictionApiResponse,
} from "@f1/shared";
import { type ReactNode, useState } from "react";

import { sortByPodium } from "../../lib/predictions-api";
import type { DriverStanding } from "../../lib/standings-api";
import styles from "../hub.module.css";
import { ShapWaterfall } from "./ShapWaterfall";

const MEDALS = ["🥇", "🥈", "🥉"];

function pct(p: number): string {
  return `${Math.round(p * 100)} %`;
}

export interface PodiumBoardProps {
  response: PredictionApiResponse | null;
  raceName: string | null;
  raceDate: string | null;
  standings: DriverStanding[] | null;
}

export function PodiumBoard({
  response,
  raceName,
  raceDate,
  standings,
}: PodiumBoardProps): ReactNode {
  // T13/AC-9: the top-1 driver's explanation starts open — the model's
  // headline claim shouldn't be hidden behind a click. Lazy initializer so it
  // only runs once per mount; `page.tsx` keys this component on the round so
  // switching races remounts it and re-derives the new top-1 (rather than
  // carrying over a stale `expanded` driver number across navigations).
  const [expanded, setExpanded] = useState<number | null>(() =>
    response && response.drivers.length > 0
      ? (sortByPodium(response.drivers)[0]?.driver_number ?? null)
      : null,
  );

  if (!response || response.drivers.length === 0) {
    return (
      <section className={`card ${styles.col8}`}>
        <div className={styles.panelHead}>
          <h2 className={styles.panelTitle}>{raceName ?? "Podiums-Vorhersage"}</h2>
        </div>
        <p className={styles.empty}>
          Die Podiums-Vorhersage erscheint rund eine Stunde vor dem Rennstart
          {raceDate ? ` (${raceDate})` : ""}. Schau dann wieder vorbei.
        </p>
      </section>
    );
  }

  const drivers = sortByPodium(response.drivers);
  const provenance = modelProvenance(response.model_version);
  // Only claim normalization when the API actually supplied it (AC-5 fallback).
  const isNormalized = drivers.some((d) => d.podium_probability_normalized !== undefined);
  // Whether the form features saw the season this race belongs to. Archived
  // races keep the version that produced them (0.2.0 = history through 2025),
  // so the same card must be able to say either thing truthfully.
  const raceSeason = Number(response.race_date.slice(0, 4));
  const formIsCurrent = provenance !== null && Number(provenance.historyThrough) >= raceSeason;

  return (
    <section className={`card ${styles.col8}`}>
      <div className={styles.panelHead}>
        <h2 className={styles.panelTitle}>Podiums-Vorhersage</h2>
        <span className={styles.panelMeta}>Modell v{response.model_version}</span>
      </div>
      <div className={styles.podium}>
        {drivers.map((d, i) => {
          const isOpen = expanded === d.driver_number;
          const team = driverTeamColor(d.driver_code, standings);
          // Phase 010: the normalized probability when the API served one, the
          // raw model output otherwise — one number for bar, label and order.
          const probability = effectivePodiumProbability(d);
          return (
            <div key={d.driver_number} className={styles.driver}>
              <button
                type="button"
                className={styles.driverBtn}
                aria-expanded={isOpen}
                onClick={() => setExpanded(isOpen ? null : d.driver_number)}
              >
                <span className={styles.teamBar} style={{ background: team.primary }} aria-hidden />
                <span
                  className={styles.driverFill}
                  style={{
                    width: `${Math.round(probability * 100)}%`,
                    background: `linear-gradient(90deg, ${team.primary}, ${team.accent})`,
                  }}
                  aria-hidden
                />
                <span className={styles.rank}>{MEDALS[i] ?? i + 1}</span>
                <span>
                  <span className={styles.driverCode}>{d.driver_code}</span>{" "}
                  <span className={styles.driverTeam}>
                    {standings?.find((s) => s.code === d.driver_code)?.constructor ?? ""}
                  </span>
                </span>
                {d.explanation ? (
                  <span className={styles.cacheBadge} title="Begründung aus Cache">
                    🅒
                  </span>
                ) : (
                  <span />
                )}
                <span className={`${styles.prob} tnum`} data-testid="podium-prob">
                  {pct(probability)}
                </span>
              </button>

              {isOpen ? (
                <div className={styles.detail}>
                  {d.explanation ? (
                    <p className={styles.reason}>{d.explanation.bedrock_text}</p>
                  ) : (
                    <p className={`${styles.reason} ${styles.reasonPending}`}>Begründung folgt.</p>
                  )}
                  <ShapWaterfall contributions={d.shap_top} />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {/* AC-6: what the number means and what the model has seen, without a click. */}
      <div className={styles.provenance}>
        {isNormalized ? (
          <p>
            Die Prozentwerte sind auf die drei Podiumsplätze normiert — sie summieren sich über alle
            Fahrer zu 300 %.
          </p>
        ) : null}
        {provenance ? (
          <p>
            Trainiert auf den Saisons {provenance.trainedSeasons}. Die Formkurven-Merkmale (Fahrer-
            und Teamform, Streckenhistorie) stammen aus Daten bis einschließlich{" "}
            {provenance.historyThrough}
            {formIsCurrent
              ? ", also aus der laufenden Saison — das Modell selbst ist aber weiterhin auf den älteren Saisons trainiert."
              : " und wurden für dieses Rennen nicht fortgeschrieben — für die Regeländerungen 2026 ist das eine bekannte Schwäche."}
          </p>
        ) : null}
      </div>
    </section>
  );
}
