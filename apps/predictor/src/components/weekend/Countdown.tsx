"use client";

import { type ReactNode, useEffect, useState } from "react";

import styles from "../hub.module.css";

/**
 * Live countdown to an ISO datetime. Computes only after mount (no hydration
 * mismatch) and ticks once a second. `label` names what we're counting to
 * (e.g. the next session).
 */
export function Countdown({ targetIso, label }: { targetIso: string; label?: string }): ReactNode {
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    const target = new Date(targetIso).getTime();
    const tick = (): void => setRemaining(Math.max(0, target - Date.now()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [targetIso]);

  const sec = remaining === null ? null : Math.floor(remaining / 1000);
  const fmt = (n: number): string => String(n).padStart(2, "0");

  return (
    <div>
      <div className={styles.countdown} role="timer">
        <Unit num={sec === null ? "–" : String(Math.floor(sec / 86400))} label="Tage" />
        <Unit num={sec === null ? "–" : fmt(Math.floor((sec % 86400) / 3600))} label="Std" />
        <Unit num={sec === null ? "–" : fmt(Math.floor((sec % 3600) / 60))} label="Min" />
        <Unit num={sec === null ? "–" : fmt(sec % 60)} label="Sek" />
      </div>
      {label ? <div className={styles.cdTarget}>bis {label}</div> : null}
    </div>
  );
}

function Unit({ num, label }: { num: string; label: string }): ReactNode {
  return (
    <div className={styles.cdUnit}>
      <div className={styles.cdNum}>{num}</div>
      <div className={styles.cdLabel}>{label}</div>
    </div>
  );
}
