"use client";

import { type ReactNode, useMemo, useState } from "react";

import {
  DIAGRAM,
  EDGES,
  GROUP_COLOR,
  GROUP_LABEL,
  type NodeGroup,
  NODES,
} from "../../lib/architecture-data";
import { edgeGeometry, edgePathId, incidentEdges } from "../../lib/architecture-geometry";

/**
 * Interactive, animated view of the live-telemetry pipeline. Data "packets" flow
 * along each edge (SVG animateMotion); hovering/focusing a node highlights its
 * neighbourhood and explains it in the panel below. Data-driven from
 * architecture-data.ts.
 */
export function PipelineDiagram(): ReactNode {
  const [active, setActive] = useState<string | null>(null);

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

  const dim = (id: string): number => (neighbourhood && !neighbourhood.has(id) ? 0.28 : 1);
  const edgeActive = (from: string, to: string): boolean =>
    !neighbourhood || neighbourhood.has(from) || neighbourhood.has(to);

  return (
    <div>
      <svg
        viewBox={`0 0 ${DIAGRAM.width} ${DIAGRAM.height}`}
        width="100%"
        role="img"
        aria-label="AWS-Datenpipeline: OpenF1 über Lambda, SQS, DynamoDB und S3 bis zum WebSocket-Dashboard"
        style={{ display: "block" }}
      >
        <defs>
          <marker
            id="arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L10,5 L0,10 z" fill="#5a6473" />
          </marker>
        </defs>

        {/* Edges + animated flow dots (behind the nodes). */}
        {EDGES.map((e) => {
          const g = edgeGeometry(e);
          const fromGroup = NODES.find((n) => n.id === e.from)?.group ?? "source";
          const on = edgeActive(e.from, e.to);
          return (
            <g key={edgePathId(e)} opacity={on ? 1 : 0.2}>
              <path
                id={edgePathId(e)}
                d={g.d}
                fill="none"
                stroke="#39414f"
                strokeWidth={1.5}
                markerEnd="url(#arrow)"
              />
              {e.label ? (
                <text x={g.mx} y={g.my - 5} textAnchor="middle" fontSize={9.5} fill="#8a94a6">
                  {e.label}
                </text>
              ) : null}
              <circle r={3.6} fill={GROUP_COLOR[fromGroup]}>
                <animateMotion dur={`${e.dur}s`} repeatCount="indefinite" rotate="auto">
                  <mpath href={`#${edgePathId(e)}`} />
                </animateMotion>
              </circle>
            </g>
          );
        })}

        {/* Nodes (front, interactive). */}
        {NODES.map((n) => (
          <g
            key={n.id}
            transform={`translate(${n.x}, ${n.y})`}
            opacity={dim(n.id)}
            tabIndex={0}
            role="button"
            aria-label={`${n.label}: ${n.detail}`}
            style={{ cursor: "pointer", outline: "none", transition: "opacity 0.2s" }}
            onMouseEnter={() => setActive(n.id)}
            onMouseLeave={() => setActive(null)}
            onFocus={() => setActive(n.id)}
            onBlur={() => setActive(null)}
          >
            <rect
              width={DIAGRAM.nodeW}
              height={DIAGRAM.nodeH}
              rx={8}
              fill="#11161f"
              stroke={active === n.id ? GROUP_COLOR[n.group] : "#2a313d"}
              strokeWidth={active === n.id ? 2 : 1}
            />
            <rect width={4} height={DIAGRAM.nodeH} rx={2} fill={GROUP_COLOR[n.group]} />
            <text x={14} y={22} fontSize={12.5} fontWeight={600} fill="#e6e6e6">
              {n.label}
            </text>
            <text x={14} y={39} fontSize={10} fill="#8a94a6">
              {n.sub}
            </text>
          </g>
        ))}
      </svg>

      <Legend />

      <div
        style={{
          marginTop: "0.75rem",
          minHeight: 64,
          background: "#0e131b",
          border: "1px solid #1c2230",
          borderRadius: 8,
          padding: "0.75rem 1rem",
        }}
        aria-live="polite"
      >
        {activeNode ? (
          <>
            <strong style={{ color: GROUP_COLOR[activeNode.group] }}>{activeNode.label}</strong>
            <span style={{ color: "var(--muted)" }}> — {GROUP_LABEL[activeNode.group]}</span>
            <p style={{ margin: "0.35rem 0 0", fontSize: "0.9rem", lineHeight: 1.5 }}>
              {activeNode.detail}
            </p>
          </>
        ) : (
          <p style={{ margin: 0, color: "var(--muted)", fontSize: "0.9rem" }}>
            Fahr über eine Komponente (oder fokussiere sie per Tab), um sie zu erklären. Die
            fließenden Punkte zeigen den Datenfluss.
          </p>
        )}
      </div>
    </div>
  );
}

function Legend(): ReactNode {
  const groups = Object.keys(GROUP_COLOR) as NodeGroup[];
  return (
    <div
      style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem 1.25rem", marginTop: "0.75rem" }}
    >
      {groups.map((g) => (
        <span key={g} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span
            style={{ width: 11, height: 11, borderRadius: 3, background: GROUP_COLOR[g] }}
            aria-hidden
          />
          <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>{GROUP_LABEL[g]}</span>
        </span>
      ))}
    </div>
  );
}
