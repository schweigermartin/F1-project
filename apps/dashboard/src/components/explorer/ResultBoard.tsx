import { teamColor } from "@f1/shared";
import type { ReactNode } from "react";

import { type SessionKey, sessionLabel } from "../../lib/explorer";
import type { QualiRow, RaceResultRow } from "../../lib/f1-api";
import type { FastLapRow } from "../../lib/openf1";
import styles from "./explorer.module.css";

export interface ResultBoardProps {
  session: SessionKey;
  race: RaceResultRow[] | null;
  quali: QualiRow[] | null;
  practice: FastLapRow[] | null;
  focusDriver: string | null;
}

const POS_CLASS = ["", styles.gold, styles.silver, styles.bronze];

function Driver({ name, code, team }: { name: string; code: string; team: string }): ReactNode {
  return (
    <span className={styles.cellDriver}>
      <span
        className={styles.teamBar}
        style={{ background: teamColor(team).primary }}
        aria-hidden
      />
      <span style={{ fontWeight: 600 }}>{name}</span>
      <span className={styles.code}>{code}</span>
    </span>
  );
}

function posCell(position: number): ReactNode {
  return <td className={`${styles.cellPos} ${POS_CLASS[position] ?? ""}`}>{position}</td>;
}

/** Classification for the selected session (AC-3): columns adapt to race / quali
 *  / practice; the focused driver's row is highlighted (AC-4). */
export function ResultBoard({
  session,
  race,
  quali,
  practice,
  focusDriver,
}: ResultBoardProps): ReactNode {
  const rowClass = (code: string): string => (code === focusDriver ? (styles.rowFocus ?? "") : "");

  if (session === "race") {
    if (!race || race.length === 0) return <Empty session={session} />;
    return (
      <table className={styles.board}>
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
          {race.map((r) => (
            <tr key={r.code} className={rowClass(r.code)}>
              {posCell(r.position)}
              <td>
                <Driver name={r.driver} code={r.code} team={r.constructor} />
              </td>
              <td className={styles.sub}>{r.constructor}</td>
              <td className={styles.sub}>{r.result}</td>
              <td className={styles.pts}>{r.points}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  if (session === "qualifying") {
    if (!quali || quali.length === 0) return <Empty session={session} />;
    return (
      <table className={styles.board}>
        <thead>
          <tr>
            <th>#</th>
            <th>Fahrer</th>
            <th>Team</th>
            <th className={styles.num}>Q1</th>
            <th className={styles.num}>Q2</th>
            <th className={styles.num}>Q3</th>
          </tr>
        </thead>
        <tbody>
          {quali.map((r) => (
            <tr key={r.code} className={rowClass(r.code)}>
              {posCell(r.position)}
              <td>
                <Driver name={r.driver} code={r.code} team={r.constructor} />
              </td>
              <td className={styles.sub}>{r.constructor}</td>
              <td className={`${styles.num} ${styles.sub}`}>{r.q1 ?? "—"}</td>
              <td className={`${styles.num} ${styles.sub}`}>{r.q2 ?? "—"}</td>
              <td className={styles.num}>{r.q3 ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  // practice (fp1–fp3)
  if (!practice || practice.length === 0) return <Empty session={session} />;
  return (
    <table className={styles.board}>
      <thead>
        <tr>
          <th>#</th>
          <th>Fahrer</th>
          <th>Team</th>
          <th className={styles.num}>Bestzeit</th>
          <th className={styles.num}>Gap</th>
        </tr>
      </thead>
      <tbody>
        {practice.map((r) => (
          <tr key={r.driver_number} className={rowClass(r.code)}>
            {posCell(r.position)}
            <td>
              <Driver name={r.code} code={r.code} team={r.constructor} />
            </td>
            <td className={styles.sub}>{r.constructor}</td>
            <td className={styles.num}>{r.time}</td>
            <td className={`${styles.num} ${styles.sub}`}>{r.gap}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Empty({ session }: { session: SessionKey }): ReactNode {
  const what = sessionLabel(session);
  return (
    <p className={styles.empty}>
      {session === "race" || session === "qualifying"
        ? `${what}-Ergebnis für dieses Rennen noch nicht verfügbar.`
        : `${what}-Bestzeiten nicht verfügbar (OpenF1 hat für diese Session keine Rundendaten).`}
    </p>
  );
}
