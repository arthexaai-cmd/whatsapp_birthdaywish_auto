// System tray icon: lets the app keep running (and the scheduler keep
// ticking) with the window closed, and gives quick access to status and
// actions without opening the full window.

import { Tray, Menu, nativeImage, app } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runManager } from "./runManager.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let tray = null;

// The 32x32 placeholder from build/tray-icon.png, embedded as a last resort.
const FALLBACK_ICON_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAN0lEQVR4nO3OwQkAIAwAsU7RoVzTQesO0iJCDu6fyL3q5QEAAADwDeAmAAAAAACAVsDUAAAAAAdkgVaSD2pb/wAAAABJRU5ErkJggg==";

export function createTray({ getMainWindow, getScheduler, getSettings, onQuit, onCheckUpdates }) {
  // Packaged: build/ isn't inside app.asar, so the icon ships as an extra
  // resource (see package.json). A missing icon used to give an empty image,
  // i.e. a blank slot in the system tray -- so fall back to an embedded copy.
  const iconPath = app.isPackaged ? path.join(process.resourcesPath, "tray-icon.png") : path.join(__dirname, "..", "build", "tray-icon.png");
  let icon = nativeImage.createFromPath(iconPath);
  if (icon.isEmpty()) {
    console.error(`[tray] icon not found at ${iconPath}; using the built-in one`);
    icon = nativeImage.createFromDataURL(`data:image/png;base64,${FALLBACK_ICON_PNG_BASE64}`);
  }
  tray = new Tray(icon);
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
      { label: "Check for updates", click: () => onCheckUpdates?.() },
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
