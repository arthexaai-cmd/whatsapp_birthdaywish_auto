// IPC: settings read/write (schedule time, pacing, quiet hours, timezone,
// risk consent, etc.) and history browsing.

import { ipcMain, app } from "electron";
import { getAllSettings, setSetting, listRuns, getRunSends } from "../../src/core/db.js";
import { DEFAULT_SETTINGS } from "../../src/core/defaults.js";
import { validateSetting } from "../../src/core/settingsValidation.js";

// Settings that change when/whether the daily trigger fires, what it does,
// or whether the app starts with Windows -- main.js re-arms and re-applies.
const SCHEDULE_KEYS = new Set([
  "scheduledTime",
  "schedulingPaused",
  "timezone",
  "catchUpOnLaunch",
  "sendMode",
  "reminderEnabled",
  "runAtLogin",
]);

export function registerSettingsIpc(db, { onScheduleChanged, onFactoryReset } = {}) {
  ipcMain.handle("settings:getAll", () => getAllSettings(db));

  ipcMain.handle("settings:set", (event, { key, value }) => {
    // The renderer is untrusted input: only known keys, and only sane values
    // (see settingsValidation.js). Also clamps dailyCap to the ceiling.
    const dailyCapMax = getAllSettings(db).dailyCapMax ?? DEFAULT_SETTINGS.dailyCapMax;
    const clean = validateSetting(key, value, { dailyCapMax });
    setSetting(db, key, clean);
    if (SCHEDULE_KEYS.has(key)) {
      onScheduleChanged?.();
    }
    return { ok: true };
  });

  ipcMain.handle("settings:appInfo", () => ({
    version: app.getVersion(),
    userDataPath: app.getPath("userData"),
  }));

  // Wipes all data and relaunches -- the renderer never gets a reply on
  // success, because the app exits. It only sees an error if it refused.
  ipcMain.handle("settings:factoryReset", () => onFactoryReset?.());

  ipcMain.handle("history:listRuns", (event, limit) => listRuns(db, limit));
  ipcMain.handle("history:getRunSends", (event, runId) => getRunSends(db, runId));
}
