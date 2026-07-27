/**
 * The session list behind the replay picker on `/live` (Phase 9, T20, AC-7).
 *
 * **Deviation from plan §3.3 / decision D-3 — deliberate.** The plan derives
 * this list by listing the S3 keys under `raw/sessions/`. We do not: the
 * dashboard runs on Vercel and holds no AWS credentials. Taking the S3 route
 * would mean minting an IAM user, shipping its keys into a third-party build
 * environment and being unable to verify any of it from here — a lot of new,
 * unverified surface for what is ultimately a dropdown. OpenF1 `/sessions`
 * answers the same question for free, needs no key, is already this app's
 * source for practice sessions (`openf1.ts`), and is fetched server-side and
 * ISR-cached exactly like every other external read.
 *
 * The trade-off is honest and bounded: this lists **every past session of the
 * season**, not only the ones that actually have an archive behind them (spec
 * R-3 — rounds 1–11 predate the post-session ingest). That degrades cleanly
 * rather than erroring: the replay Lambda answers an unarchived session with
 * `{type:"info", code:"session-not-archived"}` (`infra/lambda/ws-replay/
 * handler.ts`), so the worst case is a replay that yields no rows — which the
 * UI explains — instead of a crash.
 *
 * Zod-validated at the boundary (Constitution VI); every failure resolves to
 * `[]` so `/live` falls back to its free-text field instead of breaking
 * (AC-11).
 */

import { type Session, SessionSchema } from "@f1/shared";
import { z } from "zod";

const BASE = "https://api.openf1.org/v1";
/** A running season's calendar shifts rarely — hourly is more than fresh enough. */
const REVALIDATE_SECONDS = 60 * 60;

const SessionsArray = z.array(SessionSchema);

export interface ArchivedSession {
  /** OpenF1 `session_key` — exactly what the replay Lambda expects as `session_id`. */
  session_key: number;
  /** Ready-to-render German label, e.g. "Ungarn — Rennen · 26.07.2026". */
  label: string;
  /** Session day, `YYYY-MM-DD` (local to the circuit, as OpenF1 reports it). */
  date: string;
  /** Raw OpenF1 `session_name` ("Race", "Qualifying", "Practice 1", …). */
  sessionName: string;
}

/**
 * German country names for the values OpenF1 actually emits in `country_name`.
 * Unknown entries fall through to the English name — a missing translation must
 * never cost the user the option itself.
 */
const COUNTRY_DE: Record<string, string> = {
  Australia: "Australien",
  Austria: "Österreich",
  Azerbaijan: "Aserbaidschan",
  Bahrain: "Bahrain",
  Belgium: "Belgien",
  Brazil: "Brasilien",
  Canada: "Kanada",
  China: "China",
  France: "Frankreich",
  Germany: "Deutschland",
  "Great Britain": "Großbritannien",
  Hungary: "Ungarn",
  Italy: "Italien",
  Japan: "Japan",
  Mexico: "Mexiko",
  Monaco: "Monaco",
  Netherlands: "Niederlande",
  Portugal: "Portugal",
  Qatar: "Katar",
  "Saudi Arabia": "Saudi-Arabien",
  Singapore: "Singapur",
  Spain: "Spanien",
  "United Arab Emirates": "Vereinigte Arabische Emirate",
  "United Kingdom": "Großbritannien",
  "United States": "USA",
};

/**
 * German session names; same fallback rule as the countries. `Day 1`–`Day 3`
 * are OpenF1's pre-season test days — they carry a session_key and therefore
 * show up in the picker like any other session.
 */
const SESSION_DE: Record<string, string> = {
  "Day 1": "Testtag 1",
  "Day 2": "Testtag 2",
  "Day 3": "Testtag 3",
  "Practice 1": "Freies Training 1",
  "Practice 2": "Freies Training 2",
  "Practice 3": "Freies Training 3",
  Qualifying: "Qualifying",
  Race: "Rennen",
  Sprint: "Sprint",
  "Sprint Qualifying": "Sprint-Qualifying",
  "Sprint Shootout": "Sprint-Shootout",
};

/**
 * `2026-07-26T13:00:00+02:00` → `26.07.2026`. Deliberately string-sliced rather
 * than parsed: the leading `YYYY-MM-DD` is already the circuit's local day, and
 * `new Date(...).toLocale…` would re-interpret it in the server's timezone and
 * shift late-evening sessions onto the wrong date.
 */
function formatDay(dateStart: string): string {
  const [year, month, day] = dateStart.slice(0, 10).split("-");
  return year && month && day ? `${day}.${month}.${year}` : dateStart.slice(0, 10);
}

/** Pure: the picker's one-line label for a session. */
export function archivedSessionLabel(session: Session): string {
  const country = COUNTRY_DE[session.country_name] ?? session.country_name;
  const name = SESSION_DE[session.session_name] ?? session.session_name;
  return `${country} — ${name} · ${formatDay(session.date_start)}`;
}

/**
 * Pure: past, non-cancelled sessions, newest first. "Past" is measured against
 * `date_end` — a session still running has no replay to offer, and OpenF1 keeps
 * its historical data behind the live paywall until 30 minutes after the end
 * anyway (spec §1).
 */
export function toArchivedSessions(sessions: Session[], now: Date): ArchivedSession[] {
  const cutoff = now.getTime();
  return sessions
    .filter((s) => {
      if (s.is_cancelled) return false;
      const end = Date.parse(s.date_end);
      return Number.isFinite(end) && end <= cutoff;
    })
    .sort((a, b) => Date.parse(b.date_start) - Date.parse(a.date_start))
    .map((s) => ({
      session_key: s.session_key,
      label: archivedSessionLabel(s),
      date: s.date_start.slice(0, 10),
      sessionName: s.session_name,
    }));
}

async function fetchSeason(year: number, now: Date): Promise<ArchivedSession[]> {
  try {
    const url = new URL(`${BASE}/sessions`);
    url.searchParams.set("year", String(year));
    const res = await fetch(url, {
      next: { revalidate: REVALIDATE_SECONDS },
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return [];
    const json: unknown = await res.json();
    const parsed = SessionsArray.safeParse(json);
    if (!parsed.success) return [];
    return toArchivedSessions(parsed.data, now);
  } catch {
    return [];
  }
}

/**
 * Past sessions of the current season, newest first — `[]` if the source is
 * unreachable or drifted.
 *
 * Off-season fallback (spec R-5): between December and March the current year
 * has no finished session at all, which would leave `/live` exactly as dead as
 * before. One extra request against the previous season keeps AC-8 true all
 * year, and it only ever fires when the current year came back empty.
 */
export async function getArchivedSessions(now: Date = new Date()): Promise<ArchivedSession[]> {
  const year = now.getUTCFullYear();
  const current = await fetchSeason(year, now);
  if (current.length > 0) return current;
  return fetchSeason(year - 1, now);
}
