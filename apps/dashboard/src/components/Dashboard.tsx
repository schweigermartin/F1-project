"use client";

import Link from "next/link";
import { type ReactNode, useEffect, useMemo } from "react";

import { useRaceSocket } from "../hooks/use-race-socket";
import { DEMO_SNAPSHOT } from "../lib/demo-data";
import { gapChartData, sortedDrivers } from "../lib/format";
import { useRaceStore } from "../store/race-store";
import { ConnectionStatus } from "./ConnectionStatus";
import { GapChart } from "./GapChart";
import { ReplayControls } from "./ReplayControls";
import { TimingTower } from "./TimingTower";
import { WeatherStrip } from "./WeatherStrip";

const Card = ({ children, title }: { children: ReactNode; title: string }): ReactNode => (
  <section style={{ background: "#0e131b", borderRadius: 10, padding: "1rem 1.25rem" }}>
    <h2 style={{ margin: "0 0 0.75rem", fontSize: "0.95rem", color: "var(--muted)" }}>{title}</h2>
    {children}
  </section>
);

export function Dashboard(): ReactNode {
  const controls = useRaceSocket();

  const drivers = useRaceStore((s) => s.drivers);
  const weather = useRaceStore((s) => s.weather);
  const connection = useRaceStore((s) => s.connection);
  const mode = useRaceStore((s) => s.mode);
  const noLiveSession = useRaceStore((s) => s.noLiveSession);

  // Seed canned data when there's no backend configured, so the dashboard is
  // never blank locally / in a preview without a deployed WS API.
  useEffect(() => {
    if (!process.env["NEXT_PUBLIC_WS_URL"]) {
      useRaceStore.getState().applySnapshot(DEMO_SNAPSHOT);
    }
  }, []);

  const ordered = useMemo(() => sortedDrivers(drivers), [drivers]);
  const bars = useMemo(() => gapChartData(drivers), [drivers]);
  const empty = ordered.length === 0;

  return (
    <main style={{ padding: "1.5rem", maxWidth: 1000, margin: "0 auto" }}>
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: "1rem",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: "1rem", flexWrap: "wrap" }}>
          <h1 style={{ color: "var(--accent)", margin: 0 }}>F1 Live Dashboard</h1>
          <Link
            href="/season"
            style={{ color: "var(--muted)", textDecoration: "none", fontSize: "0.85rem" }}
          >
            Saison →
          </Link>
          <Link
            href="/architecture"
            style={{ color: "var(--muted)", textDecoration: "none", fontSize: "0.85rem" }}
          >
            Architektur →
          </Link>
        </div>
        <ConnectionStatus status={connection} mode={mode} />
      </header>

      <WeatherStrip weather={weather} />

      <div style={{ marginTop: "1rem" }}>
        <ReplayControls
          mode={mode}
          noLiveSession={noLiveSession}
          onStart={controls.startReplay}
          onStop={controls.stopReplay}
        />
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr)",
          gap: "1rem",
          marginTop: "1rem",
        }}
      >
        <Card title="Timing">{empty ? <Placeholder /> : <TimingTower drivers={ordered} />}</Card>
        <Card title="Gap to leader">{empty ? <Placeholder /> : <GapChart bars={bars} />}</Card>
      </div>
    </main>
  );
}

function Placeholder(): ReactNode {
  return <p style={{ color: "var(--muted)" }}>Waiting for session data…</p>;
}
