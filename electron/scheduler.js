// Electron glue around the pure date-math in src/core/schedule.js: arms a
// wall-clock poll for the next fire time, re-arming daily, and hooks
// powerMonitor's 'resume' event so a run missed during sleep still triggers
// a catch-up check on wake. What firing does (send in automatic mode, a
// reminder notification in manual mode -- see scheduledAction) is supplied
// by the caller via onFire.

import { powerMonitor } from "electron";
import {
  computeTodayFireDate,
  computeNextFireDate,
  hasRunToday,
  evaluateSchedulerTick,
  scheduledAction,
} from "../src/core/schedule.js";

// How often the wall clock is checked against the armed fire time. Precision
// doesn't matter much -- every run adds its own random start jitter anyway.
const TICK_MS = 30_000;

export class Scheduler {
  constructor({ db, getSettings, onFire }) {
    this.db = db;
    this.getSettings = getSettings;
    this.onFire = onFire;
    this.timer = null;
    this.nextFireAt = null;
    this.firing = false;
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
    if (this.timer) clearInterval(this.timer);
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
    const settings = this.getSettings();
    try {
      this.nextFireAt = scheduledAction(settings) === "none" ? null : computeNextFireDate(settings);
    } catch (err) {
      // Bad stored settings must never take the app down or spam errors; the
      // Schedule tab validates new values, so this only guards old data.
      console.error("[scheduler] could not compute the next fire time:", err);
      this.nextFireAt = null;
    }
    // Poll the wall clock rather than one long setTimeout -- see
    // evaluateSchedulerTick for why (timers ignore OS clock changes).
    if (!this.timer) this.timer = setInterval(() => this._tick(), TICK_MS);
  }

  _tick() {
    if (this.firing) return; // a scheduled run is still in progress
    let decision;
    try {
      decision = evaluateSchedulerTick(this.nextFireAt, this.getSettings());
    } catch (err) {
      console.error("[scheduler] tick failed:", err);
      return;
    }
    const { fire, nextFireAt } = decision;
    this.nextFireAt = nextFireAt;
    if (fire) this._fire();
  }

  async _fire() {
    this.firing = true;
    try {
      await this.onFire({ reason: "scheduled" });
    } finally {
      this.firing = false;
    }
  }

  _maybeCatchUp() {
    try {
      this._maybeCatchUpUnsafe();
    } catch (err) {
      console.error("[scheduler] catch-up check failed:", err);
    }
  }

  _maybeCatchUpUnsafe() {
    const settings = this.getSettings();
    const action = scheduledAction(settings);
    if (action === "none") return;
    // catchUpOnLaunch governs automatic *sends* only. A manual-mode reminder
    // is always safe to show late (it sends nothing), and onFire itself
    // de-dupes reminders to once a day.
    if (action === "send" && !settings.catchUpOnLaunch) return;

    const now = new Date();
    const todayFire = computeTodayFireDate(settings, now);
    if (todayFire.getTime() > now.getTime()) return;

    if (action === "remind" || !hasRunToday(this.db, settings.timezone, now)) {
      this.onFire({ reason: "catch_up" });
    }
  }
}
