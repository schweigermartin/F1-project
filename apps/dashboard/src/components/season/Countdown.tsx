"use client";

import { type ReactNode, useEffect, useState } from "react";

import styles from "./season.module.css";

/**
 * Live countdown to an ISO datetime. Computes only after mount (avoids a
 * server/client hydration mismatch) and ticks once a second.
 */
export function Countdown({ targetIso }: { targetIso: string }): ReactNode {
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    const target = new Date(targetIso).getTime();
    const tick = (): void => setRemaining(Math.max(0, target - Date.now()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [targetIso]);

  if (remaining === null) {
    // Pre-hydration placeholder — keeps layout stable, no mismatch.
    return (
      <div className={styles.countdown} aria-hidden>
        {["Tage", "Std", "Min", "Sek"].map((l) => (
          <Unit key={l} num="–" label={l} />
        ))}
      </div>
    );
  }

  const sec = Math.floor(remaining / 1000);
  const days = Math.floor(sec / 86400);
  const hours = Math.floor((sec % 86400) / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  const secs = sec % 60;
  const pad = (n: number): string => String(n).padStart(2, "0");

  return (
    <div className={styles.countdown} role="timer" aria-label={`Noch ${days} Tage bis zum Start`}>
      <Unit num={String(days)} label="Tage" />
      <Unit num={pad(hours)} label="Std" />
      <Unit num={pad(mins)} label="Min" />
      <Unit num={pad(secs)} label="Sek" />
    </div>
  );
}

function Unit({ label, num }: { label: string; num: string }): ReactNode {
  return (
    <div className={styles.countUnit}>
      <div className={styles.countNum}>{num}</div>
      <div className={styles.countLabel}>{label}</div>
    </div>
  );
}
