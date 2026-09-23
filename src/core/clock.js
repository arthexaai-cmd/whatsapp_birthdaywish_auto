// Detects drift between this machine's system clock and true time, since
// the app has no other source of "now" -- birthday matching, the daily
// scheduler, quiet hours, and the ledger's date keys all ultimately read
// from the OS clock (see engine.js's todayInTz / schedule.js). A wrong
// clock (wrong date, wrong time, or a stale/never-synced VM/dual-boot
// clock) can silently make birthdays match the wrong day or the scheduler
// fire at the wrong moment, with no other symptom.
//
// This module only *measures* drift -- it never touches the system clock.
// Actually changing the OS clock needs elevated privileges and is safest
// left to the OS's own trusted Date & Time settings UI; see
// electron/ipc/clock.js's openDateTimeSettings.

/** Anything under this is treated as normal network/measurement jitter. */
export const DRIFT_WARNING_MS = 3 * 60 * 1000; // 3 minutes

/**
 * Given a reference "true" time and the local time it was measured against,
 * compute drift and classify it. Pure function -- the actual network fetch
 * happens in electron/clock.js (Node's main process; the renderer's CSP has
 * no connect-src for external hosts, deliberately).
 *
 * @param {Date} trueTime time from a trusted external source (e.g. an HTTPS Date header)
 * @param {Date} localTime this machine's `new Date()` at roughly the same moment
 */
export function classifyDrift(trueTime, localTime) {
  const driftMs = localTime.getTime() - trueTime.getTime(); // positive = local clock is ahead
  return {
    driftMs,
    ok: Math.abs(driftMs) <= DRIFT_WARNING_MS,
    trueTime: trueTime.toISOString(),
    localTime: localTime.toISOString(),
  };
}

/** Human-readable "off by ~X" string for display, e.g. "2 minutes", "3 hours", "1 day". */
export function describeDrift(driftMs) {
  const abs = Math.abs(driftMs);
  const rawMinutes = abs / 60_000;
  if (rawMinutes < 1) return "less than a minute";
  const minutes = Math.round(rawMinutes);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}
