"use client";

import type { ReplaySpeed } from "@f1/shared";
import { type ReactNode, useState } from "react";

import { buildReplayStart, REPLAY_SPEEDS } from "../lib/replay";
import type { RaceMode } from "../store/race-store";

const btn = (active: boolean): React.CSSProperties => ({
  padding: "0.3rem 0.6rem",
  borderRadius: 6,
  border: "1px solid #2a3242",
  background: active ? "var(--accent)" : "#11161f",
  color: "var(--fg)",
  cursor: "pointer",
  fontSize: "0.8rem",
});

export function ReplayControls({
  mode,
  noLiveSession,
  onStart,
  onStop,
}: {
  mode: RaceMode;
  noLiveSession: boolean;
  onStart: (sessionId: string, speed: ReplaySpeed) => void;
  onStop: () => void;
}): ReactNode {
  const [session, setSession] = useState("");
  const [speed, setSpeed] = useState<ReplaySpeed>(1);

  const start = (): void => {
    const req = buildReplayStart(session, speed);
    if (req.ok) onStart(req.session_id, req.speed);
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.6rem",
        flexWrap: "wrap",
        padding: "0.6rem 1rem",
        background: "#11161f",
        borderRadius: 8,
      }}
    >
      <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}>Replay</span>
      <input
        aria-label="session id"
        value={session}
        onChange={(e) => setSession(e.target.value)}
        placeholder="session id"
        style={{
          padding: "0.3rem 0.5rem",
          borderRadius: 6,
          border: "1px solid #2a3242",
          background: "#0a0e14",
          color: "var(--fg)",
          width: 120,
        }}
      />
      <div style={{ display: "flex", gap: "0.3rem" }}>
        {REPLAY_SPEEDS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSpeed(s)}
            style={btn(s === speed)}
            aria-pressed={s === speed}
          >
            {s}×
          </button>
        ))}
      </div>
      {mode === "replay" ? (
        <button type="button" onClick={onStop} style={btn(true)}>
          Stop
        </button>
      ) : (
        <button type="button" onClick={start} style={btn(false)} disabled={session.trim() === ""}>
          Start
        </button>
      )}
      {noLiveSession && mode !== "replay" && (
        <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}>
          No live session — replay an archived one.
        </span>
      )}
    </div>
  );
}
