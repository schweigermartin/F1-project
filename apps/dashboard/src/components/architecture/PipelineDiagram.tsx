"use client";

import { type ReactNode, useEffect, useMemo, useState } from "react";

import {
  DIAGRAM,
  EDGES,
  GROUP_COLOR,
  GROUP_LABEL,
  type NodeGroup,
  NODES,
} from "../../lib/architecture-data";
import { edgeGeometry, edgePathId, incidentEdges } from "../../lib/architecture-geometry";
import styles from "./architecture.module.css";

/**
 * Interactive, animated view of the live-telemetry pipeline. A "current" flows
 * along each edge (animated dashes + a glowing packet); hovering/focusing a node
 * lights up its neighbourhood and explains it in plain language below. Honours
 * prefers-reduced-motion. Data-driven from architecture-data.ts.
 */
export function PipelineDiagram(): ReactNode {
  const [active, setActive] = useState<string | null>(null);
  const reduced = usePrefersReducedMotion();

  // Nodes connected to the active one (incl. itself) stay bright; the rest dim.
  const neighbourhood = useMemo(() => {
    if (!active) return null;
    const set = new Set<string>([active]);
    for (const e of incidentEdges(active)) {
      set.add(e.from);
      set.add(e.to);
    }
    return set;
  }, [active]);

  const activeNode = NODES.find((n) => n.id === active) ?? null;
  const dim = (id: string): number => (neighbourhood && !neighbourhood.has(id) ? 0.22 : 1);
  const edgeOn = (from: string, to: string): boolean =>
    !neighbourhood || neighbourhood.has(from) || neighbourhood.has(to);

  return (
    <div>
      <div className={styles.diagramWrap}>
        <svg
          viewBox={`0 0 ${DIAGRAM.width} ${DIAGRAM.height}`}
          width="100%"
          role="img"
          aria-label="AWS-Datenpipeline: OpenF1 über Lambda, SQS, DynamoDB und S3 bis zum WebSocket-Dashboard"
          style={{ display: "block" }}
        >
          <defs>
            <linearGradient id="nodeBg" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#171f2c" />
              <stop offset="1" stopColor="#0d121b" />
            </linearGradient>
            <marker
              id="arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M0,0 L10,5 L0,10 z" fill="#6b7686" />
            </marker>
          </defs>

          {/* Edges: base line + animated "current" + glowing packet (behind nodes). */}
          {EDGES.map((e) => {
            const g = edgeGeometry(e);
            const color = GROUP_COLOR[NODES.find((n) => n.id === e.from)?.group ?? "source"];
            const on = edgeOn(e.from, e.to);
            return (
              <g key={edgePathId(e)} opacity={on ? 1 : 0.18}>
                <path
                  id={edgePathId(e)}
                  d={g.d}
                  fill="none"
                  stroke="#2b3342"
                  strokeWidth={2}
                  markerEnd="url(#arrow)"
                />
                <path
                  d={g.d}
                  fill="none"
                  stroke={color}
                  strokeWidth={2}
                  strokeDasharray="5 9"
                  strokeLinecap="round"
                  opacity={0.55}
                  className={reduced ? undefined : styles.flowLine}
                />
                {e.label ? (
                  <text x={g.mx} y={g.my - 6} textAnchor="middle" fontSize={9.5} fill="#8a94a6">
                    {e.label}
                  </text>
                ) : null}
                {reduced ? (
                  <circle cx={g.mx} cy={g.my} r={3.4} fill={color} />
                ) : (
                  <circle r={4} fill={color} style={{ filter: `drop-shadow(0 0 4px ${color})` }}>
                    <animateMotion dur={`${e.dur}s`} repeatCount="indefinite" rotate="auto">
                      <mpath href={`#${edgePathId(e)}`} />
                    </animateMotion>
                  </circle>
                )}
              </g>
            );
          })}

          {/* Nodes (front, interactive). */}
          {NODES.map((n) => {
            const color = GROUP_COLOR[n.group];
            const isActive = active === n.id;
            return (
              <g
                key={n.id}
                className={styles.node}
                transform={`translate(${n.x}, ${n.y})`}
                opacity={dim(n.id)}
                tabIndex={0}
                role="button"
                aria-label={`${n.label}: ${n.plain}`}
                style={{ filter: isActive ? `drop-shadow(0 0 7px ${color}aa)` : "none" }}
                onMouseEnter={() => setActive(n.id)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(n.id)}
                onBlur={() => setActive(null)}
              >
                <rect
                  width={DIAGRAM.nodeW}
                  height={DIAGRAM.nodeH}
                  rx={10}
                  fill="url(#nodeBg)"
                  stroke={isActive ? color : "#2a313d"}
                  strokeWidth={isActive ? 2.2 : 1}
                />
                <rect width={5} height={DIAGRAM.nodeH} rx={2.5} fill={color} />
                <text x={16} y={34} fontSize={19}>
                  {n.icon}
                </text>
                <text x={44} y={24} fontSize={12.5} fontWeight={700} fill="#eef1f5">
                  {n.label}
                </text>
                <text x={44} y={41} fontSize={9.5} fill="#8a94a6">
                  {n.sub}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <Legend />

      <div className={styles.panel} aria-live="polite">
        {activeNode ? (
          <>
            <span
              className={styles.panelChip}
              style={{
                background: `${GROUP_COLOR[activeNode.group]}22`,
                color: GROUP_COLOR[activeNode.group],
              }}
            >
              {activeNode.icon} {GROUP_LABEL[activeNode.group]}
            </span>
            <p className={styles.panelPlain}>{activeNode.plain}</p>
            <p className={styles.panelTech}>{activeNode.detail}</p>
          </>
        ) : (
          <p className={styles.panelHint}>
            Fahr über eine Komponente (oder fokussiere sie per Tab), um sie in Klartext zu erklären.
            Die fließenden Punkte zeigen, wie die Daten durch das System wandern.
          </p>
        )}
      </div>
    </div>
  );
}

function Legend(): ReactNode {
  const groups = Object.keys(GROUP_COLOR) as NodeGroup[];
  return (
    <div className={styles.legend}>
      {groups.map((g) => (
        <span key={g} className={styles.legendItem}>
          <span className={styles.legendDot} style={{ background: GROUP_COLOR[g] }} aria-hidden />
          {GROUP_LABEL[g]}
        </span>
      ))}
    </div>
  );
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent): void => setReduced(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}
