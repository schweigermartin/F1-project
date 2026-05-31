import type { CSSProperties, ReactNode } from "react";

/**
 * Hand-made decorative SVG motifs (no external assets, no copyright risk). All
 * are aria-hidden — purely visual flourish to liven up the pages.
 */

/** A checkered-flag band. Pass a unique `id` if used more than once per page. */
export function CheckeredStrip({
  height = 14,
  id = "checker",
}: {
  height?: number;
  id?: string;
}): ReactNode {
  const half = height / 2;
  return (
    <svg
      width="100%"
      height={height}
      viewBox={`0 0 80 ${height}`}
      preserveAspectRatio="none"
      aria-hidden
      style={{ display: "block" }}
    >
      <defs>
        <pattern id={id} width="8" height={height} patternUnits="userSpaceOnUse">
          <rect width="4" height={half} fill="#e9ecf1" />
          <rect x="4" y={half} width="4" height={half} fill="#e9ecf1" />
          <rect x="4" width="4" height={half} fill="#10141b" />
          <rect y={half} width="4" height={half} fill="#10141b" />
        </pattern>
      </defs>
      <rect width="80" height={height} fill={`url(#${id})`} />
    </svg>
  );
}

/** Diagonal speed streaks — a subtle motion accent. */
export function SpeedLines({
  color = "#e10600",
  style,
}: {
  color?: string;
  style?: CSSProperties;
}): ReactNode {
  return (
    <svg
      viewBox="0 0 200 120"
      width="100%"
      height="100%"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden
      style={{ display: "block", ...style }}
    >
      {Array.from({ length: 7 }, (_, i) => (
        <line
          key={i}
          x1={10 + i * 6}
          y1={6 + i * 17}
          x2={90 + i * 14}
          y2={6 + i * 17}
          stroke={color}
          strokeWidth={2.5}
          strokeLinecap="round"
          opacity={0.1 + i * 0.025}
        />
      ))}
    </svg>
  );
}

/** Abstract side-on F1 car silhouette in `currentColor`. */
export function F1Car({ style }: { style?: CSSProperties }): ReactNode {
  return (
    <svg viewBox="0 0 240 72" width="100%" aria-hidden style={{ display: "block", ...style }}>
      <g fill="currentColor">
        {/* front + rear wing */}
        <rect x="2" y="44" width="30" height="7" rx="2" />
        <rect x="204" y="22" width="32" height="7" rx="2" />
        <rect x="218" y="26" width="5" height="22" rx="1" />
        {/* body wedge + cockpit/airbox */}
        <path d="M26 50 L120 42 L150 30 Q166 22 176 30 L210 40 L216 46 L216 50 Z" />
        <path d="M128 41 Q140 22 156 26 L150 40 Z" opacity="0.85" />
        {/* wheels */}
        <circle cx="64" cy="54" r="15" />
        <circle cx="196" cy="54" r="15" />
      </g>
      {/* hubs */}
      <circle cx="64" cy="54" r="5.5" fill="#0b0f16" />
      <circle cx="196" cy="54" r="5.5" fill="#0b0f16" />
    </svg>
  );
}
