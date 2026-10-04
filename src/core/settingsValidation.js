// Validation for settings written from the renderer (settings:set IPC).
// The renderer is untrusted input: without this, any value could be stored
// -- a batch size of 0 froze the app, a mistyped timezone made the scheduler
// throw every 30 s, and internal keys (lastReminderDate, dailyCapMax) were
// writable. Pure and unit-tested; electron/ipc/settings.js just calls it.

import { isValidTimezone } from "./schedule.js";

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

const isBool = (v) => typeof v === "boolean";
const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

function fail(msg) {
  throw new Error(`Invalid setting: ${msg}`);
}

/** A [lo, hi] pair of integers with min <= lo <= hi <= max. */
function range(name, v, min, max) {
  if (!Array.isArray(v) || v.length !== 2 || !isInt(v[0], min, max) || !isInt(v[1], min, max) || v[0] > v[1]) {
    fail(`${name} must be two whole numbers from ${min} to ${max}, smallest first.`);
  }
  return [v[0], v[1]];
}

function validatePacing(v, { dailyCapMax }) {
  if (!v || typeof v !== "object" || Array.isArray(v)) fail("pacing must be an object.");
  const quiet = v.quietHours;
  if (!Array.isArray(quiet) || quiet.length !== 2 || !HHMM.test(quiet[0]) || !HHMM.test(quiet[1])) {
    fail("quiet hours must be two times in HH:MM form.");
  }
  if (!isInt(v.dailyCap, 1, 100000)) fail("daily cap must be a whole number of at least 1.");
  if (!isInt(v.warmupDays, 0, 365)) fail("warm-up days must be a whole number from 0 to 365.");
  if (!isInt(v.warmupStartCap, 1, 100000)) fail("warm-up start cap must be a whole number of at least 1.");
  return {
    startJitterMinutes: range("Start delay", v.startJitterMinutes, 0, 240),
    batchSize: range("Messages per batch", v.batchSize, 1, 100),
    withinBatchSeconds: range("Gap between messages", v.withinBatchSeconds, 0, 3600),
    betweenBatchMinutes: range("Gap between batches", v.betweenBatchMinutes, 0, 1440),
    typingMsPerChar: range("Typing speed", v.typingMsPerChar, 0, 1000),
    dailyCap: Math.min(v.dailyCap, dailyCapMax), // UI-enforced ceiling, also enforced here
    quietHours: [quiet[0], quiet[1]],
    warmupDays: v.warmupDays,
    warmupStartCap: v.warmupStartCap,
  };
}

// key -> (value, ctx) => cleaned value. Anything not listed is rejected:
// lastReminderDate, dailyCapMax, hasEverPaired and closeWarningDismissed are
// only ever written by the main process.
const VALIDATORS = {
  sendMode: (v) => (v === "auto" || v === "manual" ? v : fail('sending mode must be "manual" or "auto".')),
  reminderEnabled: (v) => (isBool(v) ? v : fail("reminderEnabled must be true or false.")),
  schedulingPaused: (v) => (isBool(v) ? v : fail("schedulingPaused must be true or false.")),
  catchUpOnLaunch: (v) => (isBool(v) ? v : fail("catchUpOnLaunch must be true or false.")),
  runAtLogin: (v) => (isBool(v) ? v : fail("runAtLogin must be true or false.")),
  updateCheckEnabled: (v) => (isBool(v) ? v : fail("updateCheckEnabled must be true or false.")),
  selfNotifyEnabled: (v) => (isBool(v) ? v : fail("selfNotifyEnabled must be true or false.")),
  riskAcknowledged: (v) => (isBool(v) ? v : fail("riskAcknowledged must be true or false.")),
  scheduledTime: (v) => (typeof v === "string" && HHMM.test(v) ? v : fail("the scheduled time must be in HH:MM form.")),
  timezone: (v) => (typeof v === "string" && isValidTimezone(v) ? v : fail(`"${v}" is not a valid timezone (for example Asia/Kolkata).`)),
  catchupDays: (v) => (isInt(v, 0, 14) ? v : fail("catch-up days must be a whole number from 0 to 14.")),
  leapDayFallback: (v) => (v === "feb28" || v === "mar1" ? v : fail('leap-day rule must be "feb28" or "mar1".')),
  defaultCountry: (v) => (typeof v === "string" && /^[A-Z]{2}$/.test(v) ? v : fail("default country must be a 2-letter code like IN.")),
  selfNotifyNumber: (v) => (typeof v === "string" && v.length <= 32 ? v.trim() : fail("the self-notify number is too long.")),
  namePostfixEnabled: (v) => (isBool(v) ? v : fail("namePostfixEnabled must be true or false.")),
  namePostfix: (v) =>
    typeof v === "string" && v.trim().length <= 20 && !/[\r\n]/.test(v) ? v.trim() : fail("the name postfix must be a single line of at most 20 characters."),
  pacing: validatePacing,
};

export const RENDERER_SETTABLE_KEYS = Object.keys(VALIDATORS);

/**
 * @param {string} key
 * @param {unknown} value
 * @param {{dailyCapMax?: number}} [ctx]
 * @returns the cleaned value to store
 * @throws {Error} with a user-readable message for an unknown key or a bad value
 */
export function validateSetting(key, value, { dailyCapMax = 150 } = {}) {
  if (!Object.hasOwn(VALIDATORS, key)) fail(`"${key}" can't be changed from here.`);
  return VALIDATORS[key](value, { dailyCapMax });
}
