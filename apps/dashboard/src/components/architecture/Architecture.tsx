import Link from "next/link";
import type { ReactNode } from "react";

import { ModelExplainer } from "./ModelExplainer";
import { PipelineDiagram } from "./PipelineDiagram";
import { TechStack } from "./TechStack";

/**
 * The /architecture showcase: explains the system for a recruiter-facing audience
 * (Constitution XII) — the live AWS pipeline (interactive), the ML model, and the
 * tech stack. Composed from data-driven sections.
 */
export function Architecture(): ReactNode {
  return (
    <main style={{ padding: "1.5rem", maxWidth: 1040, margin: "0 auto" }}>
      <header style={{ marginBottom: "1.5rem" }}>
        <Link
          href="/"
          style={{ color: "var(--muted)", textDecoration: "none", fontSize: "0.85rem" }}
        >
          ← Live-Dashboard
        </Link>
        <h1 style={{ color: "var(--accent)", margin: "0.5rem 0 0.4rem" }}>
          Wie das hier gebaut ist
        </h1>
        <p style={{ margin: 0, color: "var(--muted)", maxWidth: 640, lineHeight: 1.55 }}>
          Zwei Systeme auf einer event-driven AWS-Pipeline: ein Live-Telemetrie-Dashboard und ein
          ML-Podium-Predictor. Unten der Datenfluss in Echtzeit, das Modell und der Stack.
        </p>
      </header>

      <Section title="Live-Telemetrie-Pipeline" subtitle="event-driven · serverless · Echtzeit">
        <PipelineDiagram />
      </Section>

      <Section title="Podium-Predictor (ML)" subtitle="XGBoost · SHAP · vs. Baseline">
        <ModelExplainer />
      </Section>

      <Section title="Tech-Stack" subtitle="Womit — und warum">
        <TechStack />
      </Section>

      <footer style={{ margin: "2rem 0 1rem", color: "var(--muted)", fontSize: "0.8rem" }}>
        Spec-Driven gebaut (spec → plan → tasks → code). Code + Architektur:{" "}
        <a
          href="https://github.com/schweigermartin/F1-project"
          style={{ color: "var(--accent)" }}
          target="_blank"
          rel="noreferrer"
        >
          GitHub
        </a>
        .
      </footer>
    </main>
  );
}

function Section({
  children,
  subtitle,
  title,
}: {
  children: ReactNode;
  subtitle: string;
  title: string;
}): ReactNode {
  return (
    <section
      style={{
        background: "#0b0f16",
        border: "1px solid #161c28",
        borderRadius: 12,
        padding: "1.25rem 1.4rem",
        marginBottom: "1.5rem",
      }}
    >
      <div style={{ marginBottom: "1rem" }}>
        <h2 style={{ margin: 0, fontSize: "1.1rem" }}>{title}</h2>
        <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>{subtitle}</span>
      </div>
      {children}
    </section>
  );
}
