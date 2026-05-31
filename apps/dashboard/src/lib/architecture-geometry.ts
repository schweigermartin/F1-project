/**
 * Pure geometry for the architecture diagram: node centres, where an edge meets
 * a node's border, the SVG path string used both to draw the edge and to drive
 * the animateMotion flow dot, and the label midpoint. No React, fully testable.
 */

import { DIAGRAM, EDGES, NODES, type PipelineEdge, type PipelineNode } from "./architecture-data";

export interface Point {
  x: number;
  y: number;
}

export interface EdgeGeometry {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Label anchor — midpoint of the segment. */
  mx: number;
  my: number;
  /** SVG path data (straight segment) for stroke + <mpath>. */
  d: string;
}

const byId = new Map(NODES.map((n) => [n.id, n]));

export function nodeById(id: string): PipelineNode | undefined {
  return byId.get(id);
}

export function nodeCenter(node: PipelineNode): Point {
  return { x: node.x + DIAGRAM.nodeW / 2, y: node.y + DIAGRAM.nodeH / 2 };
}

/**
 * The point on `node`'s border along the ray from its centre toward `toward`.
 * Keeps edges visually attached to the box edge instead of the centre.
 */
export function borderPoint(node: PipelineNode, toward: Point): Point {
  const c = nodeCenter(node);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (dx === 0 && dy === 0) return c;
  const hw = DIAGRAM.nodeW / 2;
  const hh = DIAGRAM.nodeH / 2;
  const scale = 1 / Math.max(Math.abs(dx) / hw, Math.abs(dy) / hh);
  return { x: c.x + dx * scale, y: c.y + dy * scale };
}

export function edgeGeometry(edge: PipelineEdge): EdgeGeometry {
  const from = byId.get(edge.from);
  const to = byId.get(edge.to);
  if (!from || !to) {
    throw new Error(`Edge references unknown node: ${edge.from} -> ${edge.to}`);
  }
  const start = borderPoint(from, nodeCenter(to));
  const end = borderPoint(to, nodeCenter(from));
  return {
    x1: start.x,
    y1: start.y,
    x2: end.x,
    y2: end.y,
    mx: (start.x + end.x) / 2,
    my: (start.y + end.y) / 2,
    d: `M ${start.x.toFixed(1)} ${start.y.toFixed(1)} L ${end.x.toFixed(1)} ${end.y.toFixed(1)}`,
  };
}

/** All edges touching `nodeId` — used to highlight the neighbourhood on hover. */
export function incidentEdges(nodeId: string): PipelineEdge[] {
  return EDGES.filter((e) => e.from === nodeId || e.to === nodeId);
}

/** Stable DOM id for an edge's motion path. */
export function edgePathId(edge: PipelineEdge): string {
  return `flow-${edge.from}-${edge.to}`;
}
