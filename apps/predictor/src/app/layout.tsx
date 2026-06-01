import "./globals.css";

import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "F1 Podium-Predictor",
  description:
    "Podiums-Wahrscheinlichkeiten pro Fahrer (XGBoost) mit KI-Begründung (Claude/Bedrock).",
};

export default function RootLayout({ children }: { children: ReactNode }): ReactNode {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
