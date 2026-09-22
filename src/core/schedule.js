// Pure date-math for the daily scheduler: computing the next local fire
// time (DST-correct, no fixed 24h interval) and whether a run already
// happened today. No Electron dependency, so it's unit-testable directly --
// electron/scheduler.js wraps this with the actual timer/powerMonitor glue.

import { listRuns } from "./db.js";

function parseHHMM(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return { h, m };
}

/**
 * The UTC instant corresponding to "today at settings.scheduledTime" in
 * settings.timezone, relative to `now`. May be in the past (callers decide
 * whether that matters -- computeNextFireDate rolls it to tomorrow, the
 * catch-up check uses "in the past" as the trigger condition).
 */
export function computeTodayFireDate(settings, now = new Date()) {
  const { h, m } = parseHHMM(settings.scheduledTime);
  const tz = settings.timezone;
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  const targetMinutes = h * 60 + m;

  // JS has no native tz-aware date constructor, so: build a naive UTC guess
  // from today's Y/M/D (in tz) + target time, then correct by checking what
  // local time that guess actually renders as in tz and shifting until it
  // matches h:m. Converges in at most a couple of iterations for any real
  // timezone (handles fixed offsets and DST transitions alike).
  let candidate = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), h, m, 0));
  for (let i = 0; i < 3; i++) {
    const rendered = fmt.formatToParts(candidate);
    const rh = Number(rendered.find((p) => p.type === "hour").value);
    const rm = Number(rendered.find((p) => p.type === "minute").value);
    const diffMinutes = targetMinutes - (rh * 60 + rm);
    if (diffMinutes === 0) break;
    candidate = new Date(candidate.getTime() + diffMinutes * 60_000);
  }
  return candidate;
}

/** The next Date (strictly in the future) matching settings.scheduledTime in settings.timezone. */
export function computeNextFireDate(settings, now = new Date()) {
  const todayFire = computeTodayFireDate(settings, now);
  if (todayFire.getTime() > now.getTime()) return todayFire;
  // Roll forward exactly one day and recompute (handles DST correctly,
  // unlike naively adding 86_400_000 ms).
  const tomorrowNow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  return computeTodayFireDate(settings, tomorrowNow);
}

function todayKey(tz, now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    now
  );
}

/**
 * Has a completed or cancelled run already happened today (local tz)? Used
 * only to decide whether to trigger a catch-up run -- the engine's own
 * ledger UNIQUE constraint is the real idempotency guarantee, so an
 * imprecise "today" near a timezone's midnight boundary is harmless: at
 * worst it causes one extra catch-up check that finds nothing new to send.
 */
export function hasRunToday(db, tz, now = new Date()) {
  const today = todayKey(tz, now);
  const runs = listRuns(db, 20);
  return runs.some(
    (r) => (r.status === "completed" || r.status === "cancelled") && r.started_at.slice(0, 10) === today
  );
}
