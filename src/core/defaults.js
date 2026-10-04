// Default settings seeded into the `settings` table on first run. Mirrors
// the old config/config.yaml structure from the CLI phase, now living in
// the DB so the UI can read and edit it directly instead of hand-editing YAML.
// Never re-applied once a key exists -- see electron/db.js's seedSettingsIfMissing.

// Bumped when the pacing defaults change in a way existing installs should
// follow. Stored in the DB so each install migrates exactly once. Main-process
// only (not in settingsValidation's allowlist).
export const PACING_DEFAULTS_VERSION = 1;

export const DEFAULT_SETTINGS = {
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata",

  defaultCountry: "IN",
  leapDayFallback: "feb28", // "feb28" | "mar1" -- how Feb 29 birthdays land in non-leap years

  catchupDays: 2, // how many days back to keep retrying a missed birthday

  // How messages go out. "manual" (default): someone opens the app, reviews
  // today's birthdays and presses Send; at scheduledTime the app only shows a
  // reminder notification (if reminderEnabled). "auto": the app sends by
  // itself at scheduledTime, with launch-time catch-up. Manual is the default
  // because an unattended sender acts on whatever the PC clock says -- a
  // wrong or test-changed clock sends real wishes on the wrong day.
  sendMode: "manual",
  reminderEnabled: true,
  updateCheckEnabled: true, // look for a newer version on launch and every few hours (never installs by itself)
  closeWarningDismissed: false, // user ticked "don't show again" on the close-to-tray notice

  // Daily schedule
  scheduledTime: "09:15", // local HH:MM: the automatic send (auto mode) or reminder (manual mode)
  runAtLogin: true,
  schedulingPaused: false,
  catchUpOnLaunch: true, // if today's scheduled time already passed with no run, fire on next launch

  // Pacing -- the anti-ban core. See src/core/pacing.js.
  pacing: {
    // Small enough to still defeat exact-second pattern matching (the actual
    // anti-detection goal) without wasting a large chunk of the day as pure
    // dead time before anything starts. The gaps below are tuned so a full
    // day at the default cap of 100 averages about 4 hours (about
    // 18 batches x ~7 min + ~60 s per message, plus a few seconds of typing
    // per message), starting at 09:15 and ending mid-afternoon, well before
    // quiet hours at 21:30.
    startJitterMinutes: [0, 10],
    batchSize: [4, 7],
    withinBatchSeconds: [30, 90],
    betweenBatchMinutes: [5, 9],
    typingMsPerChar: [45, 90],
    dailyCap: 100,
    quietHours: ["21:30", "08:30"],
    // No warm-up by default: the full cap applies from the first day.
    // warmupStartCap only matters if the user sets warmupDays above 0.
    warmupDays: 0,
    warmupStartCap: 8,
  },

  retry: {
    maxConsecutiveFailures: 2,
    retryBackoffSeconds: [60, 120],
  },

  selfNotifyEnabled: true,
  selfNotifyNumber: "",

  // Respectful suffix after the first name ("Abhijit ji"). Skipped for
  // contacts that have a salutation, so it never reads "Mr Abhijit ji".
  namePostfixEnabled: true,
  namePostfix: "ji",

  // Set true the first time WhatsApp pairing ever succeeds. Lets the app
  // treat a later disconnect (session expired, phone unlinked it) as a
  // reconnect prompt on the Settings screen rather than dropping the user
  // back into the full first-run wizard.
  hasEverPaired: false,

  // Consent screen must be accepted before any real (non-dry-run) send.
  riskAcknowledged: false,

  // Which generation of pacing defaults this install has been moved to.
  pacingDefaultsVersion: PACING_DEFAULTS_VERSION,

  // UI-enforced ceiling so a user can't naively crank dailyCap to something
  // that reads as bulk spam to WhatsApp.
  dailyCapMax: 150,
};

// The pacing defaults shipped up to 2.1.5. A saved value that still equals
// one of these was never changed by the user, so it follows the new default;
// a value the user edited is left alone.
const OLD_PACING_DEFAULTS_V0 = {
  startJitterMinutes: [0, 20],
  withinBatchSeconds: [40, 150],
  betweenBatchMinutes: [14, 28],
  dailyCap: 60,
  warmupDays: 7,
};

/**
 * One-time move of an existing install's pacing to the current defaults,
 * field by field, only for fields still at their old default.
 * @returns {object} the pacing object to store (a new object; input untouched)
 */
export function migratePacingToCurrentDefaults(pacing, defaults = DEFAULT_SETTINGS.pacing) {
  const out = { ...pacing };
  for (const [key, oldValue] of Object.entries(OLD_PACING_DEFAULTS_V0)) {
    if (JSON.stringify(pacing?.[key]) === JSON.stringify(oldValue)) out[key] = defaults[key];
  }
  return out;
}

/** Deep-ish merge: only fills in keys missing from `existing`, recursing one level for objects. */
export function fillMissingDefaults(existing, defaults) {
  const out = { ...existing };
  for (const [key, value] of Object.entries(defaults)) {
    if (!(key in out)) {
      out[key] = value;
    } else if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      out[key] &&
      typeof out[key] === "object" &&
      !Array.isArray(out[key])
    ) {
      out[key] = fillMissingDefaults(out[key], value);
    }
  }
  return out;
}
