import type { Metadata } from "next";
import type { ReactNode } from "react";

import { Architecture } from "../../components/architecture/Architecture";

export const metadata: Metadata = {
  title: "Architektur — F1 Portfolio",
  description:
    "Wie das F1-Portfolio gebaut ist: event-driven AWS-Pipeline, XGBoost-Podium-Modell und Tech-Stack.",
};

/** /architecture — recruiter-facing showcase of the system (Constitution XII). */
export default function ArchitecturePage(): ReactNode {
  return <Architecture />;
}
