"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { type ReactNode, useTransition } from "react";

import { SESSION_OPTIONS, type SessionKey } from "../../lib/explorer";
import type { DriverStanding, RaceMeta } from "../../lib/f1-api";
import styles from "./explorer.module.css";

export interface ExplorerBarProps {
  races: RaceMeta[];
  drivers: DriverStanding[];
  round: number;
  session: SessionKey;
  driver: string | null;
}

/**
 * Sticky selector bar (AC-1/2/4/6): race dropdown, session pills, driver-focus
 * dropdown. Each change merges into the URL searchParams and navigates —
 * server re-renders the board (shareable links, ISR cache). `useTransition`
 * dims the bar while the new view streams in (subtle motion).
 */
export function ExplorerBar({
  races,
  drivers,
  round,
  session,
  driver,
}: ExplorerBarProps): ReactNode {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  function setParam(key: string, value: string | null): void {
    const params = new URLSearchParams(searchParams.toString());
    if (value === null || value === "") params.delete(key);
    else params.set(key, value);
    startTransition(() => {
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    });
  }

  return (
    <div className={`${styles.bar} ${pending ? styles.barPending : ""}`}>
      <div className={styles.group}>
        <span className={styles.groupLabel}>Rennen</span>
        <select
          className={styles.select}
          aria-label="Rennen wählen"
          value={String(round)}
          onChange={(e) => setParam("round", e.target.value)}
        >
          {races.map((r) => (
            <option key={r.round} value={r.round}>
              R{r.round} · {r.name}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.group}>
        <span className={styles.groupLabel}>Session</span>
        <div className={styles.tabs} role="group" aria-label="Session wählen">
          {SESSION_OPTIONS.map((o) => (
            <button
              key={o.key}
              type="button"
              className={`${styles.tab} ${session === o.key ? styles.tabActive : ""}`}
              aria-pressed={session === o.key}
              onClick={() => setParam("session", o.key)}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.group}>
        <span className={styles.groupLabel}>Fahrer-Fokus</span>
        <select
          className={styles.select}
          aria-label="Fahrer fokussieren"
          value={driver ?? ""}
          onChange={(e) => setParam("driver", e.target.value || null)}
        >
          <option value="">— aus —</option>
          {drivers.map((d) => (
            <option key={d.code} value={d.code}>
              {d.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
