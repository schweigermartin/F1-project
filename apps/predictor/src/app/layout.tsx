import "./globals.css";

import { tokensToCssVars } from "@f1/shared";
import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "F1 Race Weekend Hub — Podium Predictor",
  description:
    "Rennwochenende auf einen Blick: Sessions, Strecke, Wetter und KI-Podiumsvorhersage (XGBoost + Claude/Bedrock) — plus Saison-Performance des Modells.",
};

export default function RootLayout({ children }: { children: ReactNode }): ReactNode {
  return (
    <html lang="de">
      {/* Single source of truth for the design tokens (@f1/shared) — injected
          once so every var(--…) across both apps resolves to the same value. */}
      <head>
        <style dangerouslySetInnerHTML={{ __html: `:root{${tokensToCssVars()}}` }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
