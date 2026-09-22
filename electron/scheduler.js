// Electron glue around the pure date-math in src/core/schedule.js: arms a
// real timer for the next fire time, re-arming daily, and hooks
// powerMonitor's 'resume' event so a run missed during sleep still triggers
// a catch-up check on wake. The actual send logic (connect WhatsApp, run
// the engine) is supplied by the caller via onFire.

import { powerMonitor } from "electron";
import { computeTodayFireDate, computeNextFireDate, hasRunToday } from "../src/core/schedule.js";

const MAX_TIMEOUT_MS = 24 * 60 * 60 * 1000 + 60_000; // scheduler always fires within ~24h, cap generously

export class Scheduler {
  constructor({ db, getSettings, onFire }) {
    this.db = db;
    this.getSettings = getSettings;
    this.onFire = onFire;
    this.timer = null;
    this.nextFireAt = null;
  }

  start() {
    this._maybeCatchUp();
    this._arm();
    powerMonitor.on("resume", () => {
      // The system may have been asleep through the scheduled time; treat
      // resume like a fresh launch for catch-up purposes, then re-arm.
      this._maybeCatchUp();
      this._arm();
    });
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  getNextFireAt() {
    return this.nextFireAt;
  }

  /** Recompute and re-arm the timer -- call after settings that affect timing change. */
  rearm() {
    this._arm();
  }

  _arm() {
    if (this.timer) clearTimeout(this.timer);
    const settings = this.getSettings();
    if (settings.schedulingPaused) {
      this.nextFireAt = null;
      return;
    }
    const next = computeNextFireDate(settings);
    this.nextFireAt = next;
    const delay = Math.min(Math.max(next.getTime() - Date.now(), 0), MAX_TIMEOUT_MS);
    this.timer = setTimeout(() => this._fire(), delay);
  }

  async _fire() {
    try {
      await this.onFire({ reason: "scheduled" });
    } finally {
      this._arm(); // always re-arm for the next day, even if this run failed
    }
  }

  _maybeCatchUp() {
    const settings = this.getSettings();
    if (settings.schedulingPaused || !settings.catchUpOnLaunch) return;

    const now = new Date();
    const todayFire = computeTodayFireDate(settings, now);
    const alreadyPassed = todayFire.getTime() <= now.getTime();

    if (alreadyPassed && !hasRunToday(this.db, settings.timezone, now)) {
      this.onFire({ reason: "catch_up" });
    }
  }
}
