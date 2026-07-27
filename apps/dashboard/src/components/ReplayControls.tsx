"use client";

import type { ReplaySpeed } from "@f1/shared";
import { type ReactNode, useState } from "react";

import type { ArchivedSession } from "../lib/archived-sessions";
import { buildReplayStart, REPLAY_SPEEDS } from "../lib/replay";
import type { RaceMode } from "../store/race-store";
import styles from "./live.module.css";

export interface ReplayControlsProps {
  mode: RaceMode;
  noLiveSession: boolean;
  /** Past sessions of the season, newest first (server-fetched by the page). */
  sessions: ArchivedSession[];
  onStart: (sessionId: string, speed: ReplaySpeed) => void;
  onStop: () => void;
}

/**
 * Replay controls (Phase 9, T20, AC-7).
 *
 * Before this phase the only way in was a bare text box for a raw OpenF1
 * session id — a value that appeared nowhere in the UI, so in practice the
 * replay was unreachable for anyone who had not read the source. The picker is
 * now the primary path; the text field survives purely as an escape hatch for a
 * session the list does not carry (a backfilled one, or a season the list did
 * not load). Both write the same piece of state, so the box always shows what
 * the picker selected and typing over it simply wins.
 */
export function ReplayControls({
  mode,
  noLiveSession,
  sessions,
  onStart,
  onStop,
}: ReplayControlsProps): ReactNode {
  // Preload the most recent past session so "Start" is one click away (T21).
  const [sessionId, setSessionId] = useState(() => sessions[0]?.session_key.toString() ?? "");
  const [speed, setSpeed] = useState<ReplaySpeed>(1);

  // A hand-typed id is not in the list — keep the select on its empty option
  // rather than letting React silently show a stale selection.
  const inList = sessions.some((s) => s.session_key.toString() === sessionId);

  const start = (): void => {
    const req = buildReplayStart(sessionId, speed);
    if (req.ok) onStart(req.session_id, req.speed);
  };

  return (
    <div className={styles.controls}>
      <span className={styles.controlsLabel}>Replay</span>

      {sessions.length > 0 && (
        <span className={styles.field}>
          <select
            aria-label="Vergangene Session"
            className={styles.select}
            value={inList ? sessionId : ""}
            onChange={(e) => setSessionId(e.target.value)}
          >
            <option value="">— Session wählen —</option>
            {sessions.map((s) => (
              <option key={s.session_key} value={s.session_key}>
                {s.label}
              </option>
            ))}
          </select>
        </span>
      )}

      <span className={styles.field}>
        <span className={styles.fieldHint}>{sessions.length > 0 ? "oder ID" : "Session-ID"}</span>
        <input
          aria-label="session id"
          className={styles.input}
          value={sessionId}
          onChange={(e) => setSessionId(e.target.value)}
          placeholder="z. B. 9876"
          inputMode="numeric"
        />
      </span>

      <div className={styles.speeds}>
        {REPLAY_SPEEDS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSpeed(s)}
            className={`${styles.speed} ${s === speed ? styles.speedActive : ""}`}
            aria-pressed={s === speed}
          >
            {s}×
          </button>
        ))}
      </div>

      {mode === "replay" ? (
        <button type="button" onClick={onStop} className={styles.action}>
          Stop
        </button>
      ) : (
        <button
          type="button"
          onClick={start}
          className={styles.action}
          disabled={sessionId.trim() === ""}
        >
          Start
        </button>
      )}

      {noLiveSession && mode !== "replay" && (
        <span className={styles.note}>
          Gerade läuft keine Session — wähle oben eine vergangene aus und starte das Replay.
        </span>
      )}
      {sessions.length === 0 && (
        <span className={styles.note}>
          Die Session-Liste ist gerade nicht erreichbar. Eine bekannte OpenF1-Session-ID
          funktioniert weiterhin von Hand.
        </span>
      )}
    </div>
  );
}
