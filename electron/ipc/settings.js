// IPC: settings read/write (schedule time, pacing, quiet hours, timezone,
// risk consent, etc.) and history browsing.

import { ipcMain, app } from "electron";
import { getAllSettings, setSetting, listRuns, getRunSends } from "../../src/core/db.js";
import { DEFAULT_SETTINGS } from "../../src/core/defaults.js";

export function registerSettingsIpc(db, { onScheduleChanged } = {}) {
  ipcMain.handle("settings:getAll", () => getAllSettings(db));

  ipcMain.handle("settings:set", (event, { key, value }) => {
    // Clamp the daily cap to the UI-enforced ceiling regardless of what the
    // renderer sends -- defense in depth against a naive "send to everyone".
    if (key === "pacing" && value?.dailyCap) {
      const max = getAllSettings(db).dailyCapMax ?? DEFAULT_SETTINGS.dailyCapMax;
      value.dailyCap = Math.min(value.dailyCap, max);
    }
    setSetting(db, key, value);
    if (key === "scheduledTime" || key === "schedulingPaused" || key === "timezone" || key === "catchUpOnLaunch") {
      onScheduleChanged?.();
    }
    return { ok: true };
  });

  ipcMain.handle("settings:appInfo", () => ({
    version: app.getVersion(),
    userDataPath: app.getPath("userData"),
  }));

  ipcMain.handle("history:listRuns", (event, limit) => listRuns(db, limit));
  ipcMain.handle("history:getRunSends", (event, runId) => getRunSends(db, runId));
}
