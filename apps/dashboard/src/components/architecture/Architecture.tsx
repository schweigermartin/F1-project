import Link from "next/link";
import type { ReactNode } from "react";

import { STATS } from "../../lib/architecture-data";
import { PHOTOS, unsplash } from "../../lib/images";
import { F1Car } from "../art/RaceArt";
import styles from "./architecture.module.css";
import { ModelExplainer } from "./ModelExplainer";
import { PipelineDiagram } from "./PipelineDiagram";
import { TechStack } from "./TechStack";

/**
 * The /architecture showcase: explains the system for a recruiter-facing audience
 * (Constitution XII) — the live AWS pipeline (interactive), the ML model, and the
 * tech stack. Plain-language leads up top, detail on hover.
 */
export function Architecture(): ReactNode {
  return (
    <main className={styles.page}>
      <header className={styles.heroBanner}>
        <img
          className={styles.heroImg}
          src={unsplash(PHOTOS.carWide, 1600, 65)}
          alt=""
          aria-hidden
        />
        <F1Car
          style={{
            position: "absolute",
            right: "1.25rem",
            bottom: "0.9rem",
            width: 200,
            color: "#1b2433",
            opacity: 0.55,
            pointerEvents: "none",
          }}
        />
        <div className={styles.heroInner}>
          <Link href="/" className={styles.back}>
            ← Start
          </Link>
          <h1 className={styles.title}>Wie das hier gebaut ist</h1>
          <p className={styles.lead}>
            Ein F1-Portfolio aus zwei Systemen auf einer gemeinsamen AWS-Pipeline: ein{" "}
            <strong style={{ color: "var(--fg)" }}>Live-Telemetrie-Dashboard</strong> und ein{" "}
            <strong style={{ color: "var(--fg)" }}>ML-Podium-Predictor</strong>. Alles serverless,
            als Code, mit fast keinen Laufkosten. Unten: der Datenfluss in Echtzeit, das Modell und
            die Werkzeuge dahinter.
          </p>
          <div className={styles.stats}>
            {STATS.map((s) => (
              <div key={s.label} className={styles.stat}>
                <span className={styles.statValue}>{s.value}</span>
                <span className={styles.statLabel}>{s.label}</span>
              </div>
            ))}
          </div>
        </div>
      </header>

      <Section
        n={1}
        kicker="Echtzeit · serverless"
        title="Live-Telemetrie-Pipeline"
        lead="Vom Renndaten-Feed bis in deinen Browser — ohne ständiges Nachladen. Jede Komponente macht genau eine Sache; gepollt wird nur, während eine Session läuft. Fahr mit der Maus über die Bausteine, um zu sehen, was jeder tut."
      >
        <PipelineDiagram />
      </Section>

      <Section
        n={2}
        kicker="Machine Learning"
        title="Podium-Predictor"
        lead="Aus historischen Renndaten lernt ein Modell, wer aufs Podium fährt — und erklärt per SHAP, warum. Wichtig: Es nutzt nur Wissen von vor dem Start, damit die Vorhersage ehrlich bleibt."
      >
        <ModelExplainer />
      </Section>

      <Section
        n={3}
        kicker="Werkzeuge"
        title="Tech-Stack"
        lead="Bewusst gewählt — jede Zeile mit einem Grund. Schlanke Bausteine statt Framework-Ballast."
      >
        <TechStack />
      </Section>

      <footer className={styles.footer}>
        Spec-Driven gebaut (spec → plan → tasks → code). Code + Architektur:{" "}
        <a href="https://github.com/schweigermartin/F1-project" target="_blank" rel="noreferrer">
          GitHub
        </a>
        .
      </footer>
    </main>
  );
}

function Section({
  children,
  kicker,
  lead,
  n,
  title,
}: {
  children: ReactNode;
  kicker: string;
  lead: string;
  n: number;
  title: string;
}): ReactNode {
  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <span className={styles.sectionNum} aria-hidden>
          {n}
        </span>
        <div>
          <div className={styles.kicker}>{kicker}</div>
          <h2 className={styles.sectionTitle}>{title}</h2>
        </div>
      </div>
      <p className={styles.sectionLead}>{lead}</p>
      {children}
    </section>
  );
}
