// IPC: start/cancel a run (dry or real) and forward its progress events to
// the renderer live.

import { ipcMain, app } from "electron";
import { runManager } from "../runManager.js";

export function registerRunIpc(db, mainWindow) {
  runManager.on("progress", (event) => {
    mainWindow?.webContents.send("run:progress", event);
  });

  ipcMain.handle("run:start", async (event, { dryRun = false, dateOverride = null, ignoreLedger = false } = {}) => {
    return runManager.start({
      db,
      dryRun,
      dateOverride,
      ignoreLedger,
      userDataPath: app.getPath("userData"),
    });
  });

  ipcMain.handle("run:cancel", () => {
    runManager.cancel();
    return { ok: true };
  });

  ipcMain.handle("run:isActive", () => runManager.isActive());
}
