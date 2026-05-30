import type { ReplaySpeed } from "@f1/shared";

/** Replay playback speeds offered by the UI (matches ReplaySpeedSchema). */
export const REPLAY_SPEEDS: readonly ReplaySpeed[] = [1, 2, 4];

export type ReplayStartRequest =
  | { ok: true; session_id: string; speed: ReplaySpeed }
  | { ok: false };

/** Validate the replay form: a non-empty session id + an allowed speed. */
export function buildReplayStart(input: string, speed: ReplaySpeed): ReplayStartRequest {
  const session_id = input.trim();
  if (!session_id) return { ok: false };
  return { ok: true, session_id, speed };
}
