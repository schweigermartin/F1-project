import type { ReactNode } from "react";

import { Dashboard } from "../components/Dashboard";

/**
 * RacePage — the single dashboard view. Live timing tower + gap chart + weather
 * (T11), fed by the WebSocket store (T10). Replay controls land in T12.
 */
export default function RacePage(): ReactNode {
  return <Dashboard />;
}
