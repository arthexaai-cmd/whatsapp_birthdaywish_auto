// IPC: app updates. The renderer can ask for the state, check, download and
// install; the main process decides whether installing is safe right now.

import { ipcMain } from "electron";
import { safeSend } from "../safeSend.js";

/**
 * @param {import("../updater.js").Updater} updater
 * @param {import("electron").BrowserWindow} mainWindow
 * @param {() => {runActive: boolean, settings: object, nextFireAt: Date|null}} getInstallContext
 */
export function registerUpdatesIpc(updater, mainWindow, getInstallContext) {
  updater.on("state", (state) => safeSend(mainWindow, "updates:state", state));

  ipcMain.handle("updates:getState", () => updater.getState());
  ipcMain.handle("updates:check", () => updater.check());
  ipcMain.handle("updates:download", () => updater.download());
  ipcMain.handle("updates:install", () => updater.install(getInstallContext()));
}
