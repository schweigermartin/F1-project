/**
 * Pure helpers for the session timeline (AC-2). Kept out of the components so
 * the date/zone logic is unit-tested without rendering.
 */

import type { Session } from "@f1/shared";

export type SessionStatus = "past" | "live" | "upcoming";

/** Classify a session relative to `now` from its start/end window. */
export function sessionStatus(session: Session, now: Date): SessionStatus {
  const start = new Date(session.date_start).getTime();
  const end = new Date(session.date_end).getTime();
  const t = now.getTime();
  if (t < start) return "upcoming";
  if (t > end) return "past";
  return "live";
}

/**
 * The next session to count down to: the live one if any, else the earliest
 * upcoming. `null` once the whole weekend is over.
 */
export function pickNextSession(sessions: Session[], now: Date): Session | null {
  const live = sessions.find((s) => sessionStatus(s, now) === "live");
  if (live) return live;
  const upcoming = sessions
    .filter((s) => sessionStatus(s, now) === "upcoming")
    .sort((a, b) => a.date_start.localeCompare(b.date_start));
  return upcoming[0] ?? null;
}

/**
 * Localized weekday + time, e.g. "Sa, 20:00". `timeZone` defaults to the
 * runtime zone (browser); tests pass a fixed zone for determinism.
 */
export function formatSessionTime(iso: string, timeZone?: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("de-DE", {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    ...(timeZone ? { timeZone } : {}),
  }).format(d);
}
