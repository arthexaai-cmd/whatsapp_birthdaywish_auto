// Pure decision logic for the "are you sure?" dialog shown when the user
// closes the window or quits. Kept free of Electron so every case is
// unit-tested; electron/main.js only turns the result into a message box.
//
// Why this exists: closing the window just hides it to the tray (the
// scheduler keeps running), but Quit really exits -- after which no
// scheduled send or reminder happens until the app is opened again, and a
// send in progress is cut off. Neither was visible to the user before.

import { scheduledAction } from "./schedule.js";

/**
 * @param {object} opts
 * @param {boolean} opts.runActive        a send/dry run is in progress
 * @param {number}  [opts.pendingCount]   sends still queued in that run (0 if unknown)
 * @param {object}  opts.settings
 * @param {Date|null} [opts.nextFireAt]
 * @param {"window"|"quit"} opts.via      window = X button (hides to tray), quit = really exits
 * @returns {{level: "none"|"info"|"warn"|"danger", title?: string, message?: string,
 *            buttons?: string[], defaultId?: number, cancelId?: number,
 *            checkbox?: string, quitButtonIndex?: number}}
 *   quitButtonIndex is the button that means "yes, really quit / stop".
 *   For "window" + info, the app hides to the tray either way; the dialog is informational.
 */
export function closeDecision({ runActive, pendingCount = 0, settings, nextFireAt = null, via }) {
  if (runActive) {
    const n = pendingCount > 0 ? `${pendingCount} message${pendingCount === 1 ? " is" : "s are"} still queued. ` : "";
    if (via === "window") {
      // Hiding to the tray does not stop a run, so this is only a heads-up.
      return {
        level: "info",
        title: "Sending is in progress",
        message: `${n}Birthday Bot will keep sending in the tray. Use Quit from the tray to stop.`,
        buttons: ["OK"],
        defaultId: 0,
        cancelId: 0,
      };
    }
    return {
      level: "danger",
      title: "Messages are still being sent",
      message:
        `${n}Quitting stops them. Anyone not yet sent can be sent later from Today's birthdays.`,
      buttons: ["Keep running", "Stop & quit"],
      defaultId: 0,
      cancelId: 0,
      quitButtonIndex: 1,
    };
  }

  const action = scheduledAction(settings);
  const when = nextFireAt ? nextFireAt.toLocaleString() : settings.scheduledTime;

  if (via === "window") {
    if (settings.closeWarningDismissed || action === "none") return { level: "none" };
    const what = action === "send" ? `the automatic send at ${settings.scheduledTime}` : `the birthday reminder at ${settings.scheduledTime}`;
    return {
      level: "info",
      title: "Birthday Bot is still running",
      message: `Closing the window keeps Birthday Bot running in the tray so ${what} still happens. Use Quit from the tray to exit completely.`,
      buttons: ["OK"],
      defaultId: 0,
      cancelId: 0,
      checkbox: "Don't show this again",
    };
  }

  // via === "quit"
  if (action === "none") return { level: "none" };
  const message =
    action === "send"
      ? `If you quit, the automatic send (next: ${when}) will NOT go out until you open Birthday Bot again.`
      : `If you quit, you won't get the birthday reminder (next: ${when}) until you open Birthday Bot again.`;
  return {
    level: "warn",
    title: "Quit Birthday Bot?",
    message,
    buttons: ["Minimize to tray", "Quit anyway"],
    defaultId: 0,
    cancelId: 0,
    quitButtonIndex: 1,
  };
}
