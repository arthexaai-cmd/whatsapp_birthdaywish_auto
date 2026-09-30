// Pure date-math for the daily scheduler: computing the next local fire
// time (DST-correct, no fixed 24h interval) and whether a run already
// happened today. No Electron dependency, so it's unit-testable directly --
// electron/scheduler.js wraps this with the actual timer/powerMonitor glue.

import { listRuns } from "./db.js";

/** True when Intl accepts this IANA timezone name (a typo would make every date computation throw). */
export function isValidTimezone(tz) {
  if (typeof tz !== "string" || !tz) return false;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The configured timezone, or the machine's own if the stored value is not a real one. */
function safeTimezone(tz) {
  return isValidTimezone(tz) ? tz : Intl.DateTimeFormat().resolvedOptions().timeZone;
}

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
  return fireDateForLocalDay(settings, now, 0);
}

/** The fire instant on the local calendar day that is `dayOffset` days after `now`'s local day. */
function fireDateForLocalDay(settings, now, dayOffset) {
  const { h, m } = parseHHMM(settings.scheduledTime);
  const tz = safeTimezone(settings.timezone);
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23", // 00-23 (hour12:false renders midnight as "24" in some engines)
  });
  // The wall-clock reading of an instant in tz, expressed as if it were UTC.
  const wallAsUtc = (date) => {
    const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
    return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute));
  };

  // JS has no native tz-aware date constructor, so: take today's date in tz
  // with the target time, and shift a naive UTC guess by the *full* wall-clock
  // difference (date AND time) until it renders as the target. Comparing only
  // hours/minutes (as this once did) lands on the wrong DAY whenever the zone
  // offset pushes the guess across midnight -- e.g. any evening time in IST,
  // which fired a day late, or an early-morning time in New York, which landed
  // in the past. Converges in a couple of iterations, DST included.
  const todayParts = Object.fromEntries(fmt.formatToParts(now).map((x) => [x.type, x.value]));
  const targetWall = Date.UTC(Number(todayParts.year), Number(todayParts.month) - 1, Number(todayParts.day) + dayOffset, h, m);
  let candidate = new Date(targetWall);
  for (let i = 0; i < 4; i++) {
    const diffMs = targetWall - wallAsUtc(candidate);
    if (diffMs === 0) break;
    candidate = new Date(candidate.getTime() + diffMs);
  }
  return candidate;
}

/** The next Date (strictly in the future) matching settings.scheduledTime in settings.timezone. */
export function computeNextFireDate(settings, now = new Date()) {
  const todayFire = computeTodayFireDate(settings, now);
  if (todayFire.getTime() > now.getTime()) return todayFire;
  // Roll forward one local CALENDAR day. Adding 24 h to `now` is wrong: on a
  // 23 h (spring-forward) day it can land on the day after tomorrow.
  return fireDateForLocalDay(settings, now, 1);
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * What the daily trigger (and the launch-time catch-up) should do:
 * "send" in automatic mode, "remind" in manual mode with reminders on,
 * "none" otherwise. schedulingPaused suppresses both.
 *
 * @returns {"send" | "remind" | "none"}
 */
export function scheduledAction(settings) {
  if (settings.schedulingPaused) return "none";
  if (settings.sendMode === "auto") return "send";
  return settings.reminderEnabled === false ? "none" : "remind";
}

/**
 * One scheduler tick: given the currently-armed fire time, decide whether to
 * fire now and what to arm next. electron/scheduler.js calls this on a short
 * interval instead of relying on one long setTimeout, because timers count
 * elapsed (monotonic) time and ignore wall-clock changes: if the OS clock is
 * corrected or changed while the app runs, a 24h timeout armed beforehand
 * would still fire ~24 *real* hours later -- i.e. at the wrong local time, or
 * a day late. Comparing against the wall clock every tick follows the clock.
 *
 * @returns {{ fire: boolean, nextFireAt: Date|null }}
 */
export function evaluateSchedulerTick(nextFireAt, settings, now = new Date()) {
  if (scheduledAction(settings) === "none") return { fire: false, nextFireAt: null };
  if (!nextFireAt) return { fire: false, nextFireAt: computeNextFireDate(settings, now) };
  if (now.getTime() >= nextFireAt.getTime()) {
    return { fire: true, nextFireAt: computeNextFireDate(settings, now) };
  }
  // The armed time can never legitimately be more than a day out; if it is,
  // the clock moved backwards -- re-derive it from the new wall clock.
  if (nextFireAt.getTime() - now.getTime() > DAY_MS + 60_000) {
    return { fire: false, nextFireAt: computeNextFireDate(settings, now) };
  }
  return { fire: false, nextFireAt };
}

function todayKey(tz, now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: safeTimezone(tz), year: "numeric", month: "2-digit", day: "2-digit" }).format(
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
    (r) => (r.status === "completed" || r.status === "cancelled") && todayKey(tz, new Date(r.started_at)) === today
  );
}
