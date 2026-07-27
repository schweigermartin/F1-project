import type { ReactNode } from "react";

import type { RaceResultRow } from "../../lib/f1-api";
import {
  buildProgressionDrivers,
  type PitStopRecord,
  toPaceSeries,
  toPositionSeries,
  toStints,
} from "../../lib/race-analysis";
import type { LapChart } from "../../lib/race-progression";
import { Card } from "../season/SeasonWidgets";
import { PaceChart } from "./PaceChart";
import { PositionChart } from "./PositionChart";
import styles from "./progression.module.css";
import { StintBar } from "./StintBar";

export interface RaceProgressionPanelProps {
  chart: LapChart | null;
  pitStops: PitStopRecord[] | null;
  results: RaceResultRow[] | null;
  /** Three-letter code from the explorer's `?driver=` param. */
  focusCode: string | null;
  raceName: string;
}

/**
 * The race-analysis panel (AC-5/AC-6): position trace, pace comparison and
 * stint strategy for one finished race, all derived from Jolpica's lap-by-lap
 * data. Rendered on the server — the transforms run once per ISR revalidation,
 * the client only receives the plotted series.
 *
 * Degrades as a unit (AC-11): a race without lap data — not run yet, cancelled,
 * or older than Ergast's lap coverage — gets one honest note instead of three
 * broken charts.
 */
export function RaceProgressionPanel({
  chart,
  pitStops,
  results,
  focusCode,
  raceName,
}: RaceProgressionPanelProps): ReactNode {
  if (!chart) {
    return (
      <div style={{ marginTop: "1.25rem" }}>
        <Card title="Rennverlauf" wide>
          <p className={styles.empty}>
            Für {raceName} liegen keine Runden-für-Runde-Daten vor — das Rennen ist noch nicht
            gefahren, wurde abgesagt, oder die freie Jolpica-API führt dafür keine Rundenzeiten.
            Sobald das Rennen gelaufen ist, erscheinen hier Positionsverlauf, Pace und Stints.
          </p>
        </Card>
      </div>
    );
  }

  const stops = pitStops ?? [];
  const drivers = buildProgressionDrivers(chart.records, results);
  const positions = toPositionSeries(chart.records);
  const pace = toPaceSeries(chart.records);
  const stints = toStints(chart.records, stops);
  // Force a fresh chart state (active drivers, A/B selection) per race.
  const raceKey = `${chart.season}-${chart.round}`;

  return (
    <>
      <div style={{ marginTop: "1.25rem" }}>
        <Card
          title="Positionsverlauf"
          meta={`${chart.totalLaps} Runden · ${drivers.length} Fahrer · ${stops.length} Stopps`}
          wide
        >
          <PositionChart
            key={raceKey}
            series={positions}
            drivers={drivers}
            pitStops={stops}
            totalLaps={chart.totalLaps}
            focusCode={focusCode}
          />
        </Card>
      </div>

      <div style={{ marginTop: "1.25rem" }}>
        <Card title="Pace-Vergleich" meta="Rundenzeiten, robust skaliert" wide>
          <PaceChart
            key={raceKey}
            series={pace.series}
            drivers={drivers}
            bounds={pace.bounds}
            outlierCount={pace.outlierCount}
            totalLaps={chart.totalLaps}
            focusCode={focusCode}
          />
        </Card>
      </div>

      <div style={{ marginTop: "1.25rem" }}>
        <Card
          title="Stint-Strategie"
          meta={pitStops === null ? "Boxenstopps nicht verfügbar" : `${stops.length} Boxenstopps`}
          wide
        >
          {stints.length > 0 ? (
            <StintBar
              stints={stints}
              drivers={drivers}
              totalLaps={chart.totalLaps}
              focusCode={focusCode}
            />
          ) : (
            <p className={styles.empty}>Für dieses Rennen liegen keine Stint-Daten vor.</p>
          )}
        </Card>
      </div>
    </>
  );
}
