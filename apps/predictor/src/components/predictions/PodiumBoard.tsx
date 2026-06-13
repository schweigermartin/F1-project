"use client";

import { driverTeamColor, type PredictionApiResponse } from "@f1/shared";
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
  const [expanded, setExpanded] = useState<number | null>(null);

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
                    width: `${Math.round(d.podium_probability * 100)}%`,
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
                <span className={`${styles.prob} tnum`}>{pct(d.podium_probability)}</span>
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
    </section>
  );
}
