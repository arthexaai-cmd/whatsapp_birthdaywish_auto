// App entry point: window lifecycle, single-instance lock, IPC wiring,
// tray, and the scheduler. Everything domain-specific (DB, engine, WhatsApp,
// scheduling math) lives in its own module -- this file is just the glue.

import { app, BrowserWindow, Notification, dialog } from "electron";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { openDb, closeDb } from "./db.js";
import { getAllSettings, setSetting } from "../src/core/db.js";
import { scheduledAction } from "../src/core/schedule.js";
import { closeDecision } from "../src/core/closeWarning.js";
import { previewToday } from "../src/core/engine.js";
import { todayInTz, ymdToKey } from "../src/core/birthdays.js";
import { wipeAppData } from "../src/core/reset.js";
import { registerAllIpc } from "./ipc/index.js";
import { createTray } from "./tray.js";
import { Scheduler } from "./scheduler.js";
import { runManager } from "./runManager.js";
import { whatsappManager } from "./whatsappManager.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.env.ELECTRON_DEV === "true";
// Windows has no "open as hidden" login option (that flag is macOS-only), so
// the login item passes this argument instead.
const startedHidden = process.argv.includes("--hidden");

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
let reminderNotification = null;

// Test/dev aid: point the app at a scratch data folder so testing never
// touches the real contacts and WhatsApp session (see CLAUDE.md).
if (process.env.BIRTHDAY_BOT_USER_DATA) app.setPath("userData", process.env.BIRTHDAY_BOT_USER_DATA);

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

  // Started by Windows at login (see applyRunAtLogin): stay in the tray, no window.
  win.once("ready-to-show", () => {
    if (!startedHidden) win.show();
  });

  // The UI is a local page: it never opens new windows, and never navigates
  // away from itself (a compromised page or a stray link must not load a
  // remote site inside a window that has the preload bridge).
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event, url) => {
    const own = isDev ? url.startsWith("http://localhost:5173") : url.startsWith(pathToFileURL(path.join(__dirname, "..", "dist-ui")).href);
    if (!own) event.preventDefault();
  });

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
      notifyHiddenToTray();
    }
  });

  // Windows shutdown/logoff: never block it. Mark the quit as confirmed so
  // the quit guard doesn't pop a dialog, and stop any run cleanly.
  win.on("query-session-end", () => {
    app.isQuitting = true;
    runManager.cancel();
  });
  win.on("session-end", () => {
    app.isQuitting = true;
    runManager.cancel();
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
      applyRunAtLogin(getAllSettings(db).runAtLogin);
    },
    onFactoryReset: factoryReset,
  });

  scheduler = new Scheduler({
    db,
    getSettings: () => getAllSettings(db),
    onFire: async ({ reason }) => {
      const settings = getAllSettings(db);
      const action = scheduledAction(settings);
      if (action === "remind") return remindIfDue(db, settings);
      if (action !== "send") return;
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
    onQuit: () => requestQuit(db),
  });
  quitDb = db;

  applyRunAtLogin(getAllSettings(db).runAtLogin);

  runManager.on("progress", () => trayHandle?.refresh());
  whatsappManager.on("state", () => trayHandle?.refresh());

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
    else mainWindow?.show();
  });
}

/**
 * Settings → Reset everything. Order matters: nothing may be sending or
 * holding files open when the data is deleted. Stop any run and the
 * scheduler, log out of WhatsApp (closes its browser and session), stop
 * starting with Windows, close the DB, wipe the data, then relaunch into
 * the first-run wizard.
 */
async function factoryReset() {
  runManager.cancel();
  for (let i = 0; i < 100 && runManager.isActive(); i++) await new Promise((r) => setTimeout(r, 100));
  if (runManager.isActive()) throw new Error("A send is still finishing. Wait a moment and try again.");

  scheduler?.stop();
  await whatsappManager.logOutAndUnlink().catch((err) => console.error("[reset] WhatsApp logout failed:", err));
  applyRunAtLogin(false);
  closeDb();

  const { failed } = wipeAppData(app.getPath("userData"));
  if (failed.length) console.error("[reset] could not delete:", failed);

  app.isQuitting = true;
  app.relaunch();
  app.exit(0);
}

let quitDb = null;
let quitDialogOpen = false;

function currentCloseDecision(db, via) {
  return closeDecision({
    runActive: runManager.isActive(),
    pendingCount: runManager.getPendingCount(),
    settings: getAllSettings(db),
    nextFireAt: scheduler?.getNextFireAt?.() ?? null,
    via,
  });
}

/**
 * Window closed to the tray: show a one-time (dismissable) notice that the
 * app is still running. Non-blocking -- the window is already hidden.
 */
function notifyHiddenToTray() {
  if (!quitDb) return;
  const decision = currentCloseDecision(quitDb, "window");
  if (decision.level === "none") return;
  dialog
    .showMessageBox({
      type: "info",
      title: decision.title,
      message: decision.title,
      detail: decision.message,
      buttons: decision.buttons,
      defaultId: decision.defaultId,
      checkboxLabel: decision.checkbox,
      checkboxChecked: false,
    })
    .then(({ checkboxChecked }) => {
      if (checkboxChecked) setSetting(quitDb, "closeWarningDismissed", true);
    })
    .catch(() => {});
}

/**
 * The only path to really exiting (tray Quit, app.quit() from anywhere).
 * Warns first when quitting would stop a scheduled send/reminder or cut off
 * a run in progress.
 */
async function requestQuit(db) {
  if (app.isQuitting) return app.quit();
  if (quitDialogOpen) return;
  const decision = currentCloseDecision(db, "quit");
  if (decision.level !== "none") {
    quitDialogOpen = true;
    try {
      const { response } = await dialog.showMessageBox({
        type: decision.level === "danger" ? "warning" : "question",
        title: decision.title,
        message: decision.title,
        detail: decision.message,
        buttons: decision.buttons,
        defaultId: decision.defaultId,
        cancelId: decision.cancelId,
        noLink: true,
      });
      if (response !== decision.quitButtonIndex) return;
    } finally {
      quitDialogOpen = false;
    }
  }
  if (runManager.isActive()) {
    runManager.cancel();
    for (let i = 0; i < 100 && runManager.isActive(); i++) await new Promise((r) => setTimeout(r, 100));
  }
  app.isQuitting = true;
  app.quit();
}

function applyRunAtLogin(enabled) {
  // Only the installed app: from `npm run dev` this would register the bare
  // electron.exe, and Windows would launch a blank Electron at every login.
  if (!app.isPackaged) return;
  if (process.platform === "win32" || process.platform === "darwin") {
    app.setLoginItemSettings({ openAtLogin: !!enabled, openAsHidden: true, args: ["--hidden"] });
  }
}

/**
 * Manual mode's daily trigger: never sends, just tells the user there are
 * birthdays waiting for them to review and send. At most once per local day
 * (persisted, so the launch-time catch-up and the timer don't both fire it),
 * and only when something is actually due.
 */
function remindIfDue(db, settings) {
  const today = ymdToKey(todayInTz(settings.timezone));
  if (settings.lastReminderDate === today) return;
  const { due } = previewToday({ db, settings });
  if (due.length === 0) return;
  setSetting(db, "lastReminderDate", today);
  if (!Notification.isSupported()) return;
  // Held in a module variable: an unreferenced Notification can be garbage
  // collected while still on screen, silently dropping its click handler.
  reminderNotification = new Notification({
    title: "Birthday Bot",
    body: `${due.length} birthday${due.length === 1 ? "" : "s"} today — open Birthday Bot to review and send.`,
  });
  reminderNotification.on("click", () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
  reminderNotification.show();
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

app.on("before-quit", (event) => {
  // Any quit that didn't come through requestQuit (e.g. app.quit() elsewhere,
  // dock/Cmd-Q) still gets the warning. Confirmed quits, factory reset and
  // OS shutdown set isQuitting first and pass straight through.
  if (!app.isQuitting && quitDb) {
    event.preventDefault();
    requestQuit(quitDb);
    return;
  }
  app.isQuitting = true;
  scheduler?.stop();
  closeDb();
});
