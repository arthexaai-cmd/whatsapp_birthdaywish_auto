// Pure logic for in-app updates: when it is safe to install, and the update
// state machine the UI renders. No Electron here (electron/updater.js wires
// it to electron-updater), so every rule is unit-tested.
//
// The rule that shapes everything: this app sends messages on a schedule, so
// an update must never restart it mid-send, and in Automatic mode must not
// land right before a scheduled send (the restart would skip that birthday).

import { scheduledAction } from "./schedule.js";

/** In Automatic mode, don't install this close to the daily send (minutes). */
export const INSTALL_GUARD_MINUTES = 30;

/**
 * @param {object} opts
 * @param {boolean} opts.runActive        a send (or dry run) is in progress
 * @param {object} opts.settings
 * @param {Date|null} [opts.nextFireAt]   when the scheduler fires next
 * @param {Date} [opts.now]
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
export function canInstallNow({ runActive, settings, nextFireAt = null, now = new Date() }) {
  if (runActive) {
    return { ok: false, reason: "Messages are being sent right now. The update can be installed when the send finishes." };
  }
  if (scheduledAction(settings) === "send" && nextFireAt) {
    const minutes = (nextFireAt.getTime() - now.getTime()) / 60_000;
    if (minutes >= 0 && minutes < INSTALL_GUARD_MINUTES) {
      return {
        ok: false,
        reason: `The automatic send starts in about ${Math.max(1, Math.ceil(minutes))} minute(s). Install after it has run, so nothing is missed.`,
      };
    }
  }
  return { ok: true };
}

/** Should a background check run now? (Manual checks always run.) */
export function shouldCheckNow({ enabled, lastCheckAt, now = new Date(), intervalHours = 6 }) {
  if (!enabled) return false;
  if (!lastCheckAt) return true;
  return now.getTime() - lastCheckAt.getTime() >= intervalHours * 3_600_000;
}

export const INITIAL_UPDATE_STATE = Object.freeze({
  status: "idle", // disabled | idle | checking | up-to-date | available | downloading | ready | error
  version: null, // the newer version, when known
  progress: 0, // 0-100 while downloading
  error: null,
  releaseNotes: null,
  checkedAt: null,
});

/**
 * @param {object} state  previous state
 * @param {{type: string, [k: string]: any}} event  one of:
 *   disabled | checking | available{version,releaseNotes} | not-available |
 *   progress{percent} | downloaded{version} | error{message} | download-started
 */
export function reduceUpdateState(state, event, now = new Date()) {
  switch (event.type) {
    case "disabled":
      return { ...INITIAL_UPDATE_STATE, status: "disabled" };
    case "checking":
      // Don't hide an already-found update behind "checking".
      if (state.status === "ready" || state.status === "downloading") return state;
      return { ...state, status: "checking", error: null };
    case "available":
      if (state.status === "ready" && state.version === event.version) return state;
      return {
        ...state,
        status: "available",
        version: event.version,
        releaseNotes: event.releaseNotes ?? null,
        progress: 0,
        error: null,
        checkedAt: now.toISOString(),
      };
    case "not-available":
      if (state.status === "ready" || state.status === "downloading") return state;
      return { ...INITIAL_UPDATE_STATE, status: "up-to-date", checkedAt: now.toISOString() };
    case "download-started":
      return { ...state, status: "downloading", progress: 0, error: null };
    case "progress":
      return { ...state, status: "downloading", progress: Math.max(0, Math.min(100, Math.round(event.percent ?? 0))) };
    case "downloaded":
      return { ...state, status: "ready", version: event.version ?? state.version, progress: 100, error: null };
    case "error":
      // An error while a download is ready must not lose the ready update.
      if (state.status === "ready") return { ...state, error: event.message };
      return { ...state, status: "error", error: event.message, checkedAt: now.toISOString() };
    default:
      return state;
  }
}
