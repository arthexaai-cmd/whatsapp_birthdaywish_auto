// In-app updates from GitHub Releases (electron-updater). Thin glue: all the
// rules (when installing is safe, the state machine) are in
// src/core/updatePolicy.js and unit-tested.
//
// Principles for an app that sends messages on a schedule:
//   * nothing is downloaded or installed without a click (autoDownload and
//     autoInstallOnAppQuit are off);
//   * install is refused while a send is running, or right before an
//     automatic send (canInstallNow);
//   * a normal install can't be redirected to another server: the feed
//     override below only works in test mode.

import { EventEmitter } from "node:events";
import { app } from "electron";
import electronUpdater from "electron-updater";
import { reduceUpdateState, INITIAL_UPDATE_STATE, canInstallNow } from "../src/core/updatePolicy.js";

const FIRST_CHECK_DELAY_MS = 60_000; // let the app settle after launch
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** GitHub sends release notes as HTML; the UI shows plain text. */
function plainNotes(notes) {
  if (typeof notes !== "string") return null;
  const text = notes.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, 600) : null;
}

export class Updater extends EventEmitter {
  /** @param {{getSettings: () => object}} opts */
  constructor({ getSettings }) {
    super();
    this.getSettings = getSettings;
    this.state = { ...INITIAL_UPDATE_STATE };
    this.autoUpdater = null;
    this.timers = [];
  }

  getState() {
    return this.state;
  }

  _dispatch(event) {
    this.state = reduceUpdateState(this.state, event);
    this.emit("state", this.state);
  }

  /** Test mode only: serve updates from a local folder/URL instead of GitHub. */
  _feedOverride() {
    const url = process.env.BIRTHDAY_BOT_UPDATE_URL;
    return url && process.env.BIRTHDAY_BOT_USER_DATA ? url : null;
  }

  start() {
    const override = this._feedOverride();
    if (!app.isPackaged && !override) {
      this._dispatch({ type: "disabled" });
      return;
    }

    const { autoUpdater } = electronUpdater;
    this.autoUpdater = autoUpdater;
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.allowDowngrade = false;
    autoUpdater.allowPrerelease = false;
    autoUpdater.logger = console;
    if (override) {
      autoUpdater.setFeedURL({ provider: "generic", url: override });
      autoUpdater.disableDifferentialDownload = true; // a plain static test server may not support range requests
    }
    if (!app.isPackaged) autoUpdater.forceDevUpdateConfig = true;

    autoUpdater.on("checking-for-update", () => this._dispatch({ type: "checking" }));
    autoUpdater.on("update-available", (info) =>
      this._dispatch({ type: "available", version: info.version, releaseNotes: plainNotes(info.releaseNotes) })
    );
    autoUpdater.on("update-not-available", () => this._dispatch({ type: "not-available" }));
    autoUpdater.on("download-progress", (p) => this._dispatch({ type: "progress", percent: p.percent }));
    autoUpdater.on("update-downloaded", (info) => this._dispatch({ type: "downloaded", version: info.version }));
    autoUpdater.on("error", (err) => this._dispatch({ type: "error", message: err?.message ?? String(err) }));

    const background = () => {
      if (this.getSettings().updateCheckEnabled === false) return;
      this.check();
    };
    this.timers.push(setTimeout(background, FIRST_CHECK_DELAY_MS));
    this.timers.push(setInterval(background, CHECK_INTERVAL_MS));
  }

  stop() {
    for (const t of this.timers) {
      clearTimeout(t);
      clearInterval(t);
    }
    this.timers = [];
  }

  /** Look for a newer version. Safe to call any time; never downloads. */
  async check() {
    if (!this.autoUpdater) return this.state;
    try {
      await this.autoUpdater.checkForUpdates();
    } catch (err) {
      this._dispatch({ type: "error", message: err?.message ?? String(err) });
    }
    return this.state;
  }

  /**
   * Download the newest release. Still does not install.
   *
   * electron-updater downloads whatever the *last* check found. If the app
   * has been open for a while and more releases were published since, that
   * is an out-of-date version and the user would have to download and install
   * again for each one. So look again right before downloading; the "available"
   * event updates the version shown, and the download then fetches the latest.
   */
  async download() {
    if (!this.autoUpdater || this.state.status !== "available") return this.state;
    this._dispatch({ type: "download-started" });
    try {
      await this.autoUpdater.checkForUpdates();
      await this.autoUpdater.downloadUpdate();
    } catch (err) {
      this._dispatch({ type: "error", message: err?.message ?? String(err) });
    }
    return this.state;
  }

  /**
   * Restart into the downloaded version -- only if it is safe right now.
   * @param {{runActive: boolean, settings: object, nextFireAt: Date|null}} context
   * @returns {{ok: true} | {ok: false, reason: string}}
   */
  install(context) {
    if (!this.autoUpdater || this.state.status !== "ready") {
      return { ok: false, reason: "No downloaded update is ready to install." };
    }
    const verdict = canInstallNow(context);
    if (!verdict.ok) return verdict;
    // Tell the quit guard (main.js) this quit is intended: no "are you sure" dialog.
    app.isQuitting = true;
    setImmediate(() => this.autoUpdater.quitAndInstall(false, true));
    return { ok: true };
  }
}
