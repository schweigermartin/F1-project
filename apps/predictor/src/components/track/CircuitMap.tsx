import type { ReactNode } from "react";

import type { CircuitPath } from "../../lib/circuits";
import styles from "../hub.module.css";

export interface CircuitMapProps {
  path: CircuitPath | null;
  circuitName?: string | undefined;
  /** Brand colour for the track + lap dot (team of the predicted P1). */
  accent?: string;
}

/**
 * Real circuit outline as SVG (AC-3). A dot traces the lap via SMIL
 * <animateMotion> — works server-rendered, no JS. Missing geometry → a clean
 * placeholder (no layout shift).
 */
export function CircuitMap({ path, circuitName, accent = "#e10600" }: CircuitMapProps): ReactNode {
  return (
    <section className={`card ${styles.col4}`}>
      <div className={styles.panelHead}>
        <h2 className={styles.panelTitle}>Strecke</h2>
        {circuitName ? <span className={styles.panelMeta}>{circuitName}</span> : null}
      </div>
      <div className={styles.mapWrap}>
        {path ? (
          <svg
            viewBox={path.viewBox}
            width="100%"
            role="img"
            aria-label={`Streckenverlauf ${circuitName ?? ""}`}
          >
            {/* Casing + coloured racing line. */}
            <path className={styles.trackPath} d={path.d} />
            <path className={styles.trackPathInner} d={path.d} style={{ stroke: accent }} />
            {/* Start/finish marker. */}
            <circle cx={path.start.x} cy={path.start.y} r={2.4} fill="#fff" />
            {/* Animated lap dot. */}
            <circle className={styles.lapDot} r={2}>
              <animateMotion dur="6s" repeatCount="indefinite" path={path.d} rotate="auto" />
            </circle>
          </svg>
        ) : (
          <p className={styles.mapPlaceholder}>
            Streckenverlauf für diese Strecke nicht verfügbar.
          </p>
        )}
      </div>
    </section>
  );
}
