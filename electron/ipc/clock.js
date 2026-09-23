// IPC: system clock drift check + a link into the OS's own Date & Time
// settings. The app deliberately never touches the system clock itself --
// changing it needs elevated OS privileges and is safest left to the OS's
// own trusted UI (which, on Windows, has its own "Sync now" button once
// there).

import { ipcMain, shell } from "electron";
import { checkClockDrift } from "../clockCheck.js";

export function registerClockIpc() {
  ipcMain.handle("clock:check", () => checkClockDrift());

  ipcMain.handle("clock:openDateTimeSettings", async () => {
    const platform = process.platform;
    if (platform === "win32") {
      await shell.openExternal("ms-settings:dateandtime");
    } else if (platform === "darwin") {
      await shell.openExternal("x-apple.systempreferences:com.apple.preference.datetime");
    } else {
      // No reliable universal deep link across Linux desktop environments;
      // the renderer shows manual instructions instead when this returns false.
      return { opened: false };
    }
    return { opened: true };
  });
}
