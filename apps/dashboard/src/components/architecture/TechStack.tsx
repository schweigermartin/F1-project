import type { CSSProperties, ReactNode } from "react";

import { TECH_STACK } from "../../lib/architecture-data";
import styles from "./architecture.module.css";

/** Grouped tech-stack cards with a one-line rationale per choice; hover to lift. */
export function TechStack(): ReactNode {
  return (
    <div className={styles.techGrid}>
      {TECH_STACK.map((cat) => (
        <section
          key={cat.title}
          className={styles.techCard}
          style={{ "--cardAccent": cat.accent } as CSSProperties}
        >
          <div className={styles.techHead}>
            <span className={styles.techIcon} aria-hidden>
              {cat.icon}
            </span>
            <h3 className={styles.techTitle}>{cat.title}</h3>
          </div>
          <ul className={styles.techList}>
            {cat.items.map((it) => (
              <li key={it.name}>
                <div className={styles.techName}>{it.name}</div>
                <div className={styles.techWhy}>{it.why}</div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
