// IPC: start/cancel a run (dry or real), today's review list for manual
// sending, and live forwarding of run progress to the renderer.

import { ipcMain, app } from "electron";
import { runManager } from "../runManager.js";
import { getAllSettings } from "../../src/core/db.js";
import { previewToday } from "../../src/core/engine.js";

export function registerRunIpc(db, mainWindow) {
  runManager.on("progress", (event) => {
    mainWindow?.webContents.send("run:progress", event);
  });

  ipcMain.handle("run:previewToday", (event, { ignoreLedger = false } = {}) =>
    previewToday({ db, settings: getAllSettings(db), ignoreLedger })
  );

  ipcMain.handle(
    "run:start",
    async (event, { dryRun = false, dateOverride = null, ignoreLedger = false, approved = null } = {}) => {
      return runManager.start({
        db,
        dryRun,
        dateOverride,
        ignoreLedger,
        approved,
        userDataPath: app.getPath("userData"),
      });
    }
  );

  ipcMain.handle("run:cancel", () => {
    runManager.cancel();
    return { ok: true };
  });

  ipcMain.handle("run:isActive", () => runManager.isActive());
}
