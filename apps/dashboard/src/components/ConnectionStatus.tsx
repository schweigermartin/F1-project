import type { ReactNode } from "react";

import type { ConnectionStatus as Status, RaceMode } from "../store/race-store";

const COLOR: Record<Status, string> = {
  open: "#43b02a",
  connecting: "#f5c518",
  reconnecting: "#f5c518",
  closed: "#8a94a6",
};

export function ConnectionStatus({ status, mode }: { status: Status; mode: RaceMode }): ReactNode {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.85rem" }}>
      <span
        aria-label={`connection ${status}`}
        style={{
          width: 9,
          height: 9,
          borderRadius: "50%",
          background: COLOR[status],
          display: "inline-block",
        }}
      />
      <span style={{ color: "var(--muted)" }}>{status}</span>
      <span
        style={{
          marginLeft: "0.5rem",
          padding: "0.1rem 0.5rem",
          borderRadius: 4,
          background: mode === "replay" ? "var(--accent)" : "#1c2230",
          textTransform: "uppercase",
          fontSize: "0.7rem",
          letterSpacing: "0.05em",
        }}
      >
        {mode}
      </span>
    </div>
  );
}
