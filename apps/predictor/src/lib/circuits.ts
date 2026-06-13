/**
 * Real circuit geometry for the track map (AC-3). We fetch a free GeoJSON of F1
 * circuit outlines (ODbL — attributed in the footer), match the target race's
 * circuit, and project its lon/lat line to a normalized SVG path. Server-side
 * with a long ISR cache: geometry never changes (spec D-2). Any miss → `null`,
 * and the map renders a clean placeholder (no layout shift).
 *
 * The projection (`projectToSvg`) is pure and unit-tested; the fetch is a thin
 * wrapper around it.
 */

import { z } from "zod";

// bacinger/f1-circuits — community GeoJSON of circuit outlines (ODbL).
const GEOJSON_URL =
  "https://raw.githubusercontent.com/bacinger/f1-circuits/master/f1-circuits.geojson";
const REVALIDATE_SECONDS = 60 * 60 * 24 * 30; // 30d — geometry is static.

const LineString = z.object({
  type: z.literal("LineString"),
  coordinates: z.array(z.tuple([z.number(), z.number()]).rest(z.number())),
});
const MultiLineString = z.object({
  type: z.literal("MultiLineString"),
  coordinates: z.array(z.array(z.tuple([z.number(), z.number()]).rest(z.number()))),
});

const FeatureSchema = z.object({
  type: z.literal("Feature"),
  properties: z.object({
    id: z.union([z.string(), z.number()]).optional(),
    name: z.string().optional(),
    Location: z.string().optional(),
  }),
  geometry: z.union([LineString, MultiLineString]),
});
const FeatureCollectionSchema = z.object({
  type: z.literal("FeatureCollection"),
  features: z.array(FeatureSchema),
});
type Feature = z.infer<typeof FeatureSchema>;

export interface CircuitPath {
  /** SVG path data in the chosen viewBox. */
  d: string;
  /** Start/finish marker, in viewBox coordinates. */
  start: { x: number; y: number };
  viewBox: string;
  width: number;
  height: number;
}

/** Lon/lat coordinate pair (extra elements like elevation are ignored). */
export type LonLat = readonly [number, number, ...number[]];

/** Pull the longest line out of a (Multi)LineString feature. */
export function featureCoords(feature: Feature): LonLat[] {
  if (feature.geometry.type === "LineString") return feature.geometry.coordinates;
  // MultiLineString → the longest segment is the lap.
  return feature.geometry.coordinates.reduce<LonLat[]>(
    (longest, seg) => (seg.length > longest.length ? seg : longest),
    [],
  );
}

/**
 * Pure: project lon/lat coordinates onto an SVG viewBox of `size`×`size` with
 * `pad` border, preserving aspect ratio and centering. Latitude is flipped
 * (north = up). Returns the path plus the start point (first coordinate).
 */
export function projectToSvg(coords: LonLat[], size = 100, pad = 6): CircuitPath | null {
  if (coords.length < 2) return null;
  const lons = coords.map((c) => c[0]);
  const lats = coords.map((c) => c[1]);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const spanLon = maxLon - minLon || 1e-9;
  const spanLat = maxLat - minLat || 1e-9;
  const inner = size - pad * 2;
  // Uniform scale so the longer axis fits `inner`; the other axis is centered.
  const scale = inner / Math.max(spanLon, spanLat);
  const offsetX = pad + (inner - spanLon * scale) / 2;
  const offsetY = pad + (inner - spanLat * scale) / 2;
  const toXY = (c: LonLat): { x: number; y: number } => ({
    x: offsetX + (c[0] - minLon) * scale,
    // Flip latitude: larger lat → smaller y.
    y: offsetY + (maxLat - c[1]) * scale,
  });

  const pts = coords.map(toXY);
  const first = pts[0];
  if (!first) return null;
  const d =
    pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" ") + " Z";
  return {
    d,
    start: { x: Number(first.x.toFixed(2)), y: Number(first.y.toFixed(2)) },
    viewBox: `0 0 ${size} ${size}`,
    width: size,
    height: size,
  };
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z]/g, "");
}

/**
 * Pure: best-effort match of a race's circuit to a GeoJSON feature by comparing
 * normalized circuit name and locality against the feature name/location.
 */
export function matchCircuitFeature(
  features: Feature[],
  race: { circuit?: string; locality?: string },
): Feature | null {
  const keys = [race.circuit, race.locality].filter(Boolean).map((s) => normalize(s as string));
  if (keys.length === 0) return null;
  for (const f of features) {
    const haystack = normalize(`${f.properties.name ?? ""} ${f.properties.Location ?? ""}`);
    if (keys.some((k) => k.length >= 4 && (haystack.includes(k) || k.includes(haystack)))) {
      return f;
    }
  }
  return null;
}

export async function getCircuitPath(race: {
  circuit?: string;
  locality?: string;
}): Promise<CircuitPath | null> {
  if (!race.circuit && !race.locality) return null;
  try {
    const res = await fetch(GEOJSON_URL, {
      next: { revalidate: REVALIDATE_SECONDS },
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const json: unknown = await res.json();
    const parsed = FeatureCollectionSchema.safeParse(json);
    if (!parsed.success) return null;
    const feature = matchCircuitFeature(parsed.data.features, race);
    if (!feature) return null;
    return projectToSvg(featureCoords(feature));
  } catch {
    return null;
  }
}
