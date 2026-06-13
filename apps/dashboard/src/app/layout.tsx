import "./globals.css";

import { tokensToCssVars } from "@f1/shared";
import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "F1 Portfolio",
  description: "F1-Portfolio: Live-Telemetrie, ML-Podium-Predictor und Saison-Übersicht.",
};

export default function RootLayout({ children }: { children: ReactNode }): ReactNode {
  return (
    <html lang="en">
      {/* Shared design tokens (@f1/shared) — same source as the predictor so
          both apps share one visual vocabulary (Phase 7, Constitution III). */}
      <head>
        <style dangerouslySetInnerHTML={{ __html: `:root{${tokensToCssVars()}}` }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
