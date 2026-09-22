// IPC: WhatsApp pairing (QR flow), connection status, unlink, and the
// system-browser / fallback-Chromium download path used during pairing.

import { ipcMain, app } from "electron";
import { whatsappManager } from "../whatsappManager.js";
import { findSystemBrowser } from "../browser.js";
import { setSetting } from "../../src/core/db.js";

export function registerWhatsappIpc(db, mainWindow) {
  whatsappManager.on("state", (state) => {
    mainWindow?.webContents.send("whatsapp:state", state);
  });

  ipcMain.handle("whatsapp:getState", () => whatsappManager.getState());

  ipcMain.handle("whatsapp:checkBrowser", () => {
    const found = findSystemBrowser();
    return { found: !!found, browser: found?.browser ?? null };
  });

  ipcMain.handle("whatsapp:downloadChromium", async (event) => {
    return whatsappManager.downloadChromium(app.getPath("userData"), (progress) => {
      mainWindow?.webContents.send("whatsapp:downloadProgress", progress);
    });
  });

  ipcMain.handle("whatsapp:connect", async () => {
    // Long timeout here: this is the interactive wizard pairing flow, where
    // a human needs time to pick up their phone and scan.
    await whatsappManager.connect({ userDataPath: app.getPath("userData"), qrTimeoutMs: 180_000 });
    setSetting(db, "hasEverPaired", true);
    return whatsappManager.getState();
  });

  ipcMain.handle("whatsapp:unlink", async () => {
    await whatsappManager.unlink();
    return whatsappManager.getState();
  });

  ipcMain.handle("whatsapp:disconnect", async () => {
    await whatsappManager.disconnect();
    return whatsappManager.getState();
  });
}
