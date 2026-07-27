import type { ReactNode } from "react";

import type { ConnectionStatus as Status, RaceMode } from "../store/race-store";
import styles from "./live.module.css";

/** Dot colour per socket state — token-backed classes, no hardcoded hex (AC-10). */
const DOT: Record<Status, string | undefined> = {
  open: styles.dotOpen,
  connecting: styles.dotPending,
  reconnecting: styles.dotPending,
  closed: styles.dotClosed,
};

export function ConnectionStatus({ status, mode }: { status: Status; mode: RaceMode }): ReactNode {
  return (
    <div className={styles.status}>
      <span aria-label={`connection ${status}`} className={`${styles.dot} ${DOT[status]}`} />
      <span className={styles.statusText}>{status}</span>
      <span className={`${styles.mode} ${mode === "replay" ? styles.modeReplay : ""}`}>{mode}</span>
    </div>
  );
}
