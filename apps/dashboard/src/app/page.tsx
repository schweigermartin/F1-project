import type { ReactNode } from "react";

/**
 * RacePage — the single dashboard view. A placeholder in T9; the live socket
 * hook + Zustand store land in T10, the visx timing tower in T11, and the
 * replay controls in T12.
 */
export default function RacePage(): ReactNode {
  return (
    <main style={{ padding: "2rem", maxWidth: 960, margin: "0 auto" }}>
      <h1 style={{ color: "var(--accent)", marginBottom: "0.25rem" }}>F1 Live Dashboard</h1>
      <p style={{ color: "var(--muted)" }}>
        Live timing and replay. The realtime view arrives in the next steps.
      </p>
    </main>
  );
}
