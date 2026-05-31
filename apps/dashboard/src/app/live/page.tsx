import type { Metadata } from "next";
import type { ReactNode } from "react";

import { Dashboard } from "../../components/Dashboard";

export const metadata: Metadata = {
  title: "Live-Dashboard — F1 Portfolio",
  description: "Live and replayed F1 telemetry — positions, gaps, tyres, weather.",
};

/**
 * /live — the live dashboard. Timing tower + gap chart + weather, fed by the
 * WebSocket store, with replay controls. (Moved here from / when the season
 * overview became the landing page.)
 */
export default function LivePage(): ReactNode {
  return <Dashboard />;
}
