// App entry point: window lifecycle, single-instance lock, IPC wiring,
// tray, and the scheduler. Everything domain-specific (DB, engine, WhatsApp,
// scheduling math) lives in its own module -- this file is just the glue.

import { app, BrowserWindow, Notification } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDb, closeDb } from "./db.js";
import { getAllSettings } from "../src/core/db.js";
import { registerAllIpc } from "./ipc/index.js";
import { createTray } from "./tray.js";
import { Scheduler } from "./scheduler.js";
import { runManager } from "./runManager.js";
import { whatsappManager } from "./whatsappManager.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.env.ELECTRON_DEV === "true";

// whatsapp-web.js occasionally rejects a promise internally (e.g. its own
// session-cleanup logic racing a browser teardown) in a way we have no
// handle on and cannot .catch() ourselves. Node's default behavior for an
// unhandled rejection is just a console warning (not a crash) in this
// context, but log it plainly rather than let a scary stack trace look
// like the app broke -- it isn't fatal.
process.on("unhandledRejection", (reason) => {
  console.error("[main] unhandled rejection (non-fatal):", reason);
});

let mainWindow = null;
let trayHandle = null;
let scheduler = null;

// Only one instance may run at a time -- two copies would race on the same
// SQLite file and the same WhatsApp session.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(main);
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 820,
    minHeight: 600,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (isDev) {
    win.loadURL("http://localhost:5173");
  } else {
    win.loadFile(path.join(__dirname, "..", "dist-ui", "index.html"));
  }

  win.once("ready-to-show", () => win.show());

  win.webContents.on("did-fail-load", (event, errorCode, errorDescription, validatedURL) => {
    console.error(`[renderer] failed to load ${validatedURL}: ${errorDescription} (${errorCode})`);
  });
  win.webContents.on("console-message", (event) => {
    // Electron >=9 passes a single event object ({ level, message, lineNumber, sourceId, ... })
    // rather than positional args. level: 0=verbose/log, 1=info, 2=warning, 3=error.
    if (event.level >= 2) {
      console.error(`[renderer console] ${event.message} (${event.sourceId}:${event.lineNumber})`);
    }
  });
  win.webContents.on("render-process-gone", (event, details) => {
    console.error(`[renderer] process gone: ${JSON.stringify(details)}`);
  });

  // Closing the window minimizes to tray instead of quitting, so the
  // scheduler keeps running in the background -- the whole point of the
  // tray. Only app.quit() (from the tray menu, or OS shutdown) really exits.
  win.on("close", (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      win.hide();
    }
  });

  return win;
}

async function main() {
  const db = openDb();

  mainWindow = createWindow();

  registerAllIpc({
    db,
    mainWindow,
    onScheduleChanged: () => {
      scheduler?.rearm();
      trayHandle?.refresh();
    },
  });

  scheduler = new Scheduler({
    db,
    getSettings: () => getAllSettings(db),
    onFire: async ({ reason }) => {
      if (runManager.isActive()) return; // a manual run is already going; don't collide
      mainWindow?.webContents.send("run:autoStarted", { reason });
      try {
        const result = await runManager.start({
          db,
          dryRun: false,
          userDataPath: app.getPath("userData"),
          trigger: reason, // "scheduled" or "catch_up" -- keeps the anti-pattern-detection start jitter
        });
        notifyRunResult(result, reason);
      } catch (err) {
        notifyRunError(err, reason);
      } finally {
        trayHandle?.refresh();
      }
    },
  });
  scheduler.start();

  trayHandle = createTray({
    getMainWindow: () => mainWindow,
    getScheduler: () => scheduler,
    getSettings: () => getAllSettings(db),
  });

  applyRunAtLogin(getAllSettings(db).runAtLogin);

  runManager.on("progress", () => trayHandle?.refresh());
  whatsappManager.on("state", () => trayHandle?.refresh());

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
    else mainWindow?.show();
  });
}

function applyRunAtLogin(enabled) {
  if (process.platform === "win32" || process.platform === "darwin") {
    app.setLoginItemSettings({ openAtLogin: !!enabled, openAsHidden: true });
  }
}

function notifyRunResult(result, reason) {
  if (!Notification.isSupported()) return;
  if (!result || !result.summary) {
    if (result?.scheduled?.length === 0) return; // nothing to send, no need to notify
  }
  const label = reason === "catch_up" ? "Birthday Bot (catch-up run)" : "Birthday Bot";
  const body = result?.summary?.text || "Run completed.";
  new Notification({ title: label, body }).show();
}

function notifyRunError(err, reason) {
  if (!Notification.isSupported()) return;
  new Notification({
    title: "Birthday Bot — run failed",
    body: err.message || String(err),
  }).show();
}

app.on("window-all-closed", () => {
  // Intentionally no-op: the tray keeps the app (and scheduler) alive.
  // Real quit happens only via the tray's Quit item or OS shutdown.
});

app.on("before-quit", () => {
  app.isQuitting = true;
  scheduler?.stop();
  closeDb();
});
