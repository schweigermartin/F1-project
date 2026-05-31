/**
 * Free imagery sources used to liven up the site.
 *
 * Photos: Unsplash (Unsplash License — free for commercial use, no attribution
 * required; we credit the source anyway in the UI). Served straight from the
 * Unsplash CDN with our own width/quality params — no Next image optimization,
 * so there is zero Vercel transformation cost.
 */

/** Unsplash photo IDs (verified to resolve). Close-up Formula 1 cars. */
export const PHOTOS = {
  carHero: "photo-1752959812280-6271b5d6b143",
  carWide: "photo-1752959805242-0a7799902ae4",
} as const;

/** Build a sized Unsplash CDN URL. */
export function unsplash(id: string, width = 1600, quality = 70): string {
  return `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${width}&q=${quality}`;
}
