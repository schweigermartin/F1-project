import { teamColor } from "@f1/shared";
import type { ReactNode } from "react";

import type { ConstructorStanding, DriverStanding, LastRace, RaceMeta } from "../../lib/f1-api";
import { countryToCode, nationalityToCode } from "../../lib/flags";
import { Flag } from "../Flag";
import { Countdown } from "./Countdown";
import styles from "./season.module.css";

const MONTHS_DE = [
  "Jan.",
  "Feb.",
  "März",
  "Apr.",
  "Mai",
  "Juni",
  "Juli",
  "Aug.",
  "Sep.",
  "Okt.",
  "Nov.",
  "Dez.",
];

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${d}. ${MONTHS_DE[m - 1] ?? ""} ${y}`;
}

export function Card({
  children,
  meta,
  title,
  wide,
}: {
  children: ReactNode;
  meta?: string | undefined;
  title: string;
  wide?: boolean | undefined;
}): ReactNode {
  return (
    <section className={`${styles.card} ${wide ? styles.span2 : ""}`}>
      <div className={styles.cardHead}>
        <h2 className={styles.cardTitle}>{title}</h2>
        {meta ? <span className={styles.cardMeta}>{meta}</span> : null}
      </div>
      {children}
    </section>
  );
}

function Fallback(): ReactNode {
  return <p className={styles.fallback}>Daten gerade nicht verfügbar — später erneut laden.</p>;
}

/** A small team-colour marker (shared @f1/shared colour map, Phase 7). */
function TeamDot({ team }: { team: string }): ReactNode {
  return (
    <span
      aria-hidden
      style={{
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: teamColor(team).primary,
        flex: "none",
      }}
    />
  );
}

export function NextRaceHero({ race }: { race: RaceMeta | null }): ReactNode {
  if (!race) return null;
  const where = [race.locality, race.country].filter(Boolean).join(", ");
  return (
    <div className={styles.hero}>
      <div>
        <div className={styles.heroKicker}>Nächstes Rennen · Runde {race.round}</div>
        <h2
          className={styles.heroName}
          style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}
        >
          <Flag code={countryToCode(race.country)} title={race.country} size={34} />
          {race.name}
        </h2>
        <div className={styles.heroMeta}>
          {race.circuit}
          {where ? ` · ${where}` : ""} · {fmtDate(race.date)}
        </div>
      </div>
      {race.startsAt ? <Countdown targetIso={race.startsAt} /> : null}
    </div>
  );
}

export function DriverStandingsCard({ rows }: { rows: DriverStanding[] | null }): ReactNode {
  return (
    <Card title="Fahrer-Weltrangliste" meta={rows ? `${rows.length} Fahrer` : undefined}>
      {!rows ? (
        <Fallback />
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>#</th>
              <th>Fahrer</th>
              <th>Team</th>
              <th className={styles.num}>Siege</th>
              <th className={styles.num}>Punkte</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.code + r.position}>
                <td className={r.position === 1 ? styles.leaderPos : styles.pos}>{r.position}</td>
                <td>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem" }}>
                    <Flag code={nationalityToCode(r.nationality)} title={r.nationality} size={18} />
                    <span className={styles.name}>{r.name}</span>
                    <span className={styles.code}>{r.code}</span>
                  </span>
                </td>
                <td className={styles.sub}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem" }}>
                    <TeamDot team={r.constructor} />
                    {r.constructor}
                  </span>
                </td>
                <td className={styles.num}>{r.wins}</td>
                <td className={styles.pts}>{r.points}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

export function ConstructorStandingsCard({
  rows,
}: {
  rows: ConstructorStanding[] | null;
}): ReactNode {
  return (
    <Card title="Konstrukteurs-Weltrangliste" meta={rows ? `${rows.length} Teams` : undefined}>
      {!rows ? (
        <Fallback />
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>#</th>
              <th>Team</th>
              <th className={styles.num}>Siege</th>
              <th className={styles.num}>Punkte</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name}>
                <td className={r.position === 1 ? styles.leaderPos : styles.pos}>{r.position}</td>
                <td>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem" }}>
                    <Flag code={nationalityToCode(r.nationality)} title={r.nationality} size={18} />
                    <TeamDot team={r.name} />
                    <span className={styles.name}>{r.name}</span>
                  </span>
                </td>
                <td className={styles.num}>{r.wins}</td>
                <td className={styles.pts}>{r.points}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

export function LastResultsCard({ race }: { race: LastRace | null }): ReactNode {
  return (
    <Card title="Letztes Ergebnis" meta={race ? `${race.name} · ${fmtDate(race.date)}` : undefined}>
      {!race ? (
        <Fallback />
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>#</th>
              <th>Fahrer</th>
              <th>Team</th>
              <th>Zeit / Status</th>
              <th className={styles.num}>Pkt</th>
            </tr>
          </thead>
          <tbody>
            {race.results.slice(0, 10).map((r) => (
              <tr key={r.code + r.position}>
                <td className={r.position === 1 ? styles.leaderPos : styles.pos}>{r.position}</td>
                <td>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem" }}>
                    <Flag code={nationalityToCode(r.nationality)} title={r.nationality} size={18} />
                    <span className={styles.name}>{r.driver}</span>
                    <span className={styles.code}>{r.code}</span>
                  </span>
                </td>
                <td className={styles.sub}>{r.constructor}</td>
                <td className={styles.sub}>{r.result}</td>
                <td className={styles.pts}>{r.points}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

export function CalendarCard({
  nextRound,
  races,
}: {
  nextRound: number | null;
  races: RaceMeta[] | null;
}): ReactNode {
  return (
    <Card title="Saisonkalender" meta={races ? `${races.length} Rennen` : undefined} wide>
      {!races ? (
        <Fallback />
      ) : (
        <ul className={styles.calList}>
          {races.map((r) => {
            const isNext = r.round === nextRound;
            const isPast = nextRound !== null && r.round < nextRound;
            return (
              <li
                key={r.round}
                className={`${styles.calRow} ${isPast ? styles.calPast : ""} ${
                  isNext ? styles.calNext : ""
                }`}
              >
                <span className={styles.calRound}>R{r.round}</span>
                <Flag code={countryToCode(r.country)} title={r.country} size={20} />
                <span className={styles.calName}>
                  {r.name}
                  {isNext ? <span className={styles.nextTag}>nächstes</span> : null}
                </span>
                <span className={styles.calDate}>{fmtDate(r.date)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
