// System tray icon: lets the app keep running (and the scheduler keep
// ticking) with the window closed, and gives quick access to status and
// actions without opening the full window.

import { Tray, Menu, nativeImage, app } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runManager } from "./runManager.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let tray = null;

export function createTray({ getMainWindow, getScheduler, getSettings, onQuit }) {
  const iconPath = path.join(__dirname, "..", "build", "tray-icon.png");
  const icon = nativeImage.createFromPath(iconPath);
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip("Birthday Bot");

  const rebuildMenu = () => {
    const scheduler = getScheduler();
    const settings = getSettings();
    const nextFire = scheduler?.getNextFireAt?.();
    const auto = settings.sendMode === "auto";
    const nextFireLabel = settings.schedulingPaused
      ? "Scheduling paused"
      : !auto && settings.reminderEnabled === false
        ? "Manual mode · reminders off"
        : nextFire
          ? `${auto ? "Next send" : "Next reminder"}: ${nextFire.toLocaleString()}`
          : "Not scheduled";

    const menu = Menu.buildFromTemplate([
      { label: nextFireLabel, enabled: false },
      { type: "separator" },
      {
        label: "Open Birthday Bot",
        click: () => {
          const win = getMainWindow();
          win?.show();
          win?.focus();
        },
      },
      {
        label: "Send today's birthdays…", // opens the review screen; never sends by itself
        enabled: !runManager.isActive(),
        click: () => {
          const win = getMainWindow();
          win?.show();
          win?.webContents.send("tray:runNow");
        },
      },
      {
        label: settings.schedulingPaused ? "Resume scheduling" : "Pause scheduling",
        click: () => {
          const win = getMainWindow();
          win?.webContents.send("tray:toggleScheduling");
        },
      },
      { type: "separator" },
      {
        label: "Quit",
        // Goes through main.js's quit guard, which warns before exiting.
        click: () => onQuit(),
      },
    ]);
    tray.setContextMenu(menu);
  };

  rebuildMenu();
  tray.on("click", () => {
    const win = getMainWindow();
    win?.show();
    win?.focus();
  });

  return { tray, refresh: rebuildMenu };
}
