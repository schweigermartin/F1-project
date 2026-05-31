import type { ReactNode } from "react";

/**
 * A small country flag from flagcdn.com (free, no key). Renders nothing when
 * the code is null. Plain <img> straight from the CDN — no Next optimization,
 * so no Vercel transformation cost.
 */
export function Flag({
  code,
  size = 21,
  title,
}: {
  code: string | null;
  size?: number;
  title?: string | undefined;
}): ReactNode {
  if (!code) return null;
  const height = Math.round((size * 3) / 4);
  return (
    <img
      src={`https://flagcdn.com/w40/${code}.png`}
      alt={title ? `Flagge ${title}` : code}
      width={size}
      height={height}
      loading="lazy"
      style={{
        borderRadius: 2,
        objectFit: "cover",
        verticalAlign: "middle",
        boxShadow: "0 0 0 1px rgba(255,255,255,0.1)",
        flex: "none",
      }}
    />
  );
}
