import type { Metadata } from "next";
import type { ReactNode } from "react";

import { Dashboard } from "../../components/Dashboard";
import { getArchivedSessions } from "../../lib/archived-sessions";

export const metadata: Metadata = {
  title: "Live-Dashboard — F1 Portfolio",
  description: "Live and replayed F1 telemetry — positions, gaps, tyres, weather.",
};

// ISR: the list of past sessions only grows on a race weekend (Phase 9, T20).
export const revalidate = 3600;

/**
 * /live — the live dashboard. Timing tower + gap chart + weather, fed by the
 * WebSocket store, with replay controls. (Moved here from / when the season
 * overview became the landing page.)
 *
 * The dashboard itself is a Client Component tree, so the replay session list
 * is fetched here on the server and handed down as a prop — that keeps the
 * OpenF1 call server-side and ISR-cached (Phase 9, T20/T21, AC-7/AC-8). A
 * failure resolves to `[]`, and the page still renders with its free-text
 * fallback (AC-11).
 */
export default async function LivePage(): Promise<ReactNode> {
  const sessions = await getArchivedSessions();
  return <Dashboard sessions={sessions} />;
}
