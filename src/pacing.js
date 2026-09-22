// Builds a human-like send schedule: start jitter, randomised batches with
// gaps between and within, a hard daily cap, warm-up ramping for a young
// ledger, and a quiet-hours cutoff. This is the core anti-ban mechanism --
// see the plan doc for rationale.

import { isQuietHours } from "./birthdays.js";

function randInt([lo, hi], rng = Math.random) {
  return Math.floor(rng() * (hi - lo + 1)) + lo;
}

function shuffle(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Effective daily cap given warm-up ramping. */
export function effectiveDailyCap(pacingConfig, ledgerDayCount) {
  const { dailyCap, warmupDays, warmupStartCap } = pacingConfig;
  if (ledgerDayCount >= warmupDays) return dailyCap;
  // Ramp linearly from warmupStartCap (day 0) to dailyCap (day warmupDays).
  const frac = ledgerDayCount / warmupDays;
  const cap = Math.round(warmupStartCap + frac * (dailyCap - warmupStartCap));
  return Math.max(warmupStartCap, Math.min(dailyCap, cap));
}

/**
 * Split matches into randomised batches, apply the daily cap, and shuffle
 * ordering so the same people aren't always first. Does not compute timing
 * -- see buildSchedule for that (kept separate so tests can check batching
 * without dealing with clocks).
 */
export function batchMatches(matches, pacingConfig, ledgerDayCount, rng = Math.random) {
  const cap = effectiveDailyCap(pacingConfig, ledgerDayCount);
  const capped = shuffle(matches, rng).slice(0, cap);

  const batches = [];
  let i = 0;
  while (i < capped.length) {
    const size = randInt(pacingConfig.batchSize, rng);
    batches.push(capped.slice(i, i + size));
    i += size;
  }
  return { batches, cap, droppedByCap: matches.length - capped.length };
}

/**
 * Given batches (from batchMatches) and a run-start Date, compute an
 * absolute send timestamp for every item, respecting quiet hours: if a
 * computed send time falls inside quiet hours, that item (and everything
 * after it) is deferred to the next run rather than sent late at night.
 *
 * @returns {{ scheduled: Array<{item, sendAt: Date}>, deferred: Array }}
 */
export function buildSchedule(batches, pacingConfig, runStart, tz, rng = Math.random) {
  const startJitterMs = randInt(pacingConfig.startJitterMinutes, rng) * 60_000;
  let cursor = new Date(runStart.getTime() + startJitterMs);

  const scheduled = [];
  const deferred = [];
  let stopped = false;

  for (const batch of batches) {
    if (stopped) {
      deferred.push(...batch);
      continue;
    }
    for (const item of batch) {
      if (localMinutesInQuietHours(cursor, tz, pacingConfig.quietHours)) {
        stopped = true;
        deferred.push(item);
        continue;
      }
      scheduled.push({ item, sendAt: new Date(cursor) });
      cursor = new Date(cursor.getTime() + randInt(pacingConfig.withinBatchSeconds, rng) * 1000);
    }
    if (!stopped) {
      cursor = new Date(cursor.getTime() + randInt(pacingConfig.betweenBatchMinutes, rng) * 60_000);
    }
  }

  return { scheduled, deferred };
}

function localMinutesInQuietHours(date, tz, quietHours) {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const h = Number(parts.find((p) => p.type === "hour").value);
  const m = Number(parts.find((p) => p.type === "minute").value);
  return isQuietHours(h * 60 + m, quietHours);
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
