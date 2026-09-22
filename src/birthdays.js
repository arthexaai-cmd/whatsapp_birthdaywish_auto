// Selection logic: who gets a message today, and is it on-time or belated.
// Pure functions over plain dates -- no Date-object timezone footguns, no
// WhatsApp, no I/O. Easy to unit test exhaustively.

/**
 * @typedef {Object} DateYMD
 * @property {number} year
 * @property {number} month 1-12
 * @property {number} day   1-31
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function isLeapYear(y) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function ymdToUtcMs(y, m, d) {
  return Date.UTC(y, m - 1, d);
}

/** Add `n` days to a YMD date (n may be negative). */
export function addDays(ymd, n) {
  const ms = ymdToUtcMs(ymd.year, ymd.month, ymd.day) + n * MS_PER_DAY;
  const dt = new Date(ms);
  return { year: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1, day: dt.getUTCDate() };
}

export function ymdToKey(ymd) {
  return `${ymd.year}-${String(ymd.month).padStart(2, "0")}-${String(ymd.day).padStart(2, "0")}`;
}

/**
 * Resolve a person's birthday (month/day, year optional) onto a concrete
 * occurrence in the given year, applying the Feb 29 fallback for non-leap
 * years. Returns a DateYMD.
 */
export function birthdayOccurrence(person, year, leapDayFallback = "feb28") {
  if (person.birthMonth === 2 && person.birthDay === 29 && !isLeapYear(year)) {
    return leapDayFallback === "mar1" ? { year, month: 3, day: 1 } : { year, month: 2, day: 28 };
  }
  return { year, month: person.birthMonth, day: person.birthDay };
}

/**
 * Given "today" and a lookback window, return the list of dates (most
 * recent first, i.e. today first) that should be considered for matching:
 * today, today-1, ..., today-catchupDays.
 */
export function candidateDates(today, catchupDays) {
  const out = [];
  for (let i = 0; i <= catchupDays; i++) out.push(addDays(today, -i));
  return out;
}

/**
 * Match a roster against the candidate date window. For each person whose
 * birthday falls on one of the candidate dates (checked across the
 * relevant years spanned by the window), emit a Match. A person matches at
 * most once per run, against their most recent qualifying occurrence.
 *
 * @returns {Array<{person, occurrence: DateYMD, belated: boolean, ledgerKey: string}>}
 */
export function matchBirthdays(people, today, { catchupDays = 2, leapDayFallback = "feb28" } = {}) {
  const dates = candidateDates(today, catchupDays);
  const dateKeys = new Set(dates.map(ymdToKey));
  // Years potentially spanned by the window (handles Jan 1 - Dec 31 wraparound).
  const years = new Set(dates.map((d) => d.year));

  const matches = [];
  for (const person of people) {
    let found = null;
    for (const year of years) {
      const occ = birthdayOccurrence(person, year, leapDayFallback);
      if (dateKeys.has(ymdToKey(occ))) {
        if (!found || ymdToUtcMs(occ.year, occ.month, occ.day) > ymdToUtcMs(found.year, found.month, found.day)) {
          found = occ;
        }
      }
    }
    if (found) {
      const belated = ymdToKey(found) !== ymdToKey(today);
      matches.push({
        person,
        occurrence: found,
        belated,
        ledgerKey: `${person.phoneE164}:${ymdToKey(found)}`,
      });
    }
  }
  return matches;
}

/**
 * Filter out matches already present in the ledger (already sent, or
 * permanently flagged not-on-whatsapp).
 * @param {Set<string>} sentKeys ledgerKey values already recorded as sent/failed-permanent
 */
export function dedupeAgainstLedger(matches, sentKeys) {
  return matches.filter((m) => !sentKeys.has(m.ledgerKey));
}

/**
 * Parse "HH:MM" into minutes since midnight.
 */
function hhmmToMinutes(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Is the given local time (minutes since midnight) inside the quiet-hours
 * window [start, end)? The window may wrap past midnight.
 */
export function isQuietHours(nowMinutes, [start, end]) {
  const s = hhmmToMinutes(start);
  const e = hhmmToMinutes(end);
  if (s === e) return false; // degenerate config: treat as "never quiet"
  if (s < e) {
    // e.g. 01:00 - 05:00, does not wrap
    return nowMinutes >= s && nowMinutes < e;
  }
  // wraps past midnight, e.g. 21:30 - 08:30
  return nowMinutes >= s || nowMinutes < e;
}
