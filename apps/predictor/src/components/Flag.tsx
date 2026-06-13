import type { ReactNode } from "react";

import styles from "./hub.module.css";

/** Country flag from flagcdn.com (free, no key). Renders nothing when null. */
export function Flag({
  code,
  title,
}: {
  code: string | null;
  title?: string | undefined;
}): ReactNode {
  if (!code) return null;
  return (
    <img
      className={styles.flag}
      src={`https://flagcdn.com/w80/${code}.png`}
      alt={title ? `Flagge ${title}` : code}
      loading="lazy"
    />
  );
}
