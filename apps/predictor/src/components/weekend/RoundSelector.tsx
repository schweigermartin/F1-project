"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

import type { ScheduledRace } from "../../lib/schedule";
import styles from "../hub.module.css";

export interface RoundSelectorProps {
  races: ScheduledRace[];
  round: number;
}

/**
 * Round picker for the prediction archive (T10/AC-4): every race of the
 * season schedule is selectable, not just the current one. Picking a round
 * pushes `?round=N` — a plain navigation (not a URLSearchParams merge, this
 * page has no other params to preserve) so the whole hub re-resolves around
 * it server-side and the result is a shareable, bookmarkable link. Rounds
 * without a prediction yet simply show `PodiumBoard`'s existing empty state
 * (AC-11) — no availability check here, kept deliberately simple (plan §2.1).
 */
export function RoundSelector({ races, round }: RoundSelectorProps): ReactNode {
  const router = useRouter();

  if (races.length === 0) return null;

  return (
    <label className={styles.roundSelector}>
      <span className={styles.groupLabel}>Runde</span>
      <select
        className={styles.select}
        aria-label="Runde wählen"
        value={String(round)}
        onChange={(e) => router.push(`/?round=${e.target.value}`)}
      >
        {races.map((r) => (
          <option key={r.round} value={r.round}>
            R{r.round} · {r.name}
          </option>
        ))}
      </select>
    </label>
  );
}
