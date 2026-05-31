import "./globals.css";

import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "F1 Portfolio",
  description: "F1-Portfolio: Live-Telemetrie, ML-Podium-Predictor und Saison-Übersicht.",
};

export default function RootLayout({ children }: { children: ReactNode }): ReactNode {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
