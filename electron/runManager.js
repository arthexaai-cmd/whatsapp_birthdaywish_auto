// Runs the engine (dry or real) with a cancellation controller and forwards
// progress to any subscriber (the dashboard window, via IPC). Only one run
// at a time -- concurrent runs would race on the WhatsApp client and the
// ledger's UNIQUE constraint would just reject the loser's sends anyway, so
// we simply refuse to start a second run rather than let that happen.

import { EventEmitter } from "node:events";
import { runEngine, hasPendingMatches } from "../src/core/engine.js";
import { getAllSettings } from "../src/core/db.js";
import { whatsappManager } from "./whatsappManager.js";

class RunManager extends EventEmitter {
  constructor() {
    super();
    this.active = false;
    this.controller = null;
    this.lastResult = null;
    /** Sends still queued in the current run (for the quit warning). */
    this.pending = 0;
  }

  isActive() {
    return this.active;
  }

  /**
   * @param {object} opts
   * @param {import('node:sqlite').DatabaseSync} opts.db
   * @param {boolean} [opts.dryRun]
   * @param {string} [opts.dateOverride]
   * @param {boolean} [opts.ignoreLedger]
   * @param {string} [opts.userDataPath] required for a real run (to resolve the browser)
   * @param {'manual'|'scheduled'|'catch_up'} [opts.trigger] who started this run. 'manual'
   *   (the default -- covers the dashboard's Run now/Dry run buttons and the tray's Run
   *   now) skips the random start-jitter delay, since a human already introduced timing
   *   randomness by clicking the button. 'scheduled'/'catch_up' keep the jitter, which
   *   exists specifically so the automatic daily trigger doesn't fire at a fixed,
   *   suspiciously exact time every day.
   * @param {Record<string,string>|null} [opts.approved] manual review result (ledgerKey -> text), see runEngine
   */
  async start({ db, dryRun = false, dateOverride = null, ignoreLedger = false, approved = null, userDataPath, trigger = "manual" }) {
    if (this.active) {
      throw new Error("A run is already in progress.");
    }
    this.active = true;
    this.controller = new AbortController();
    this.pending = 0;
    this.emit("progress", { phase: "starting", dryRun });

    try {
      const settings = getAllSettings(db);

      // Skip connecting WhatsApp entirely for a real run that would find
      // nothing to send anyway (empty contact list, everyone already sent
      // to today, etc.) -- avoids launching the browser and risking a QR
      // wait for scheduled/catch-up runs that have no actual work to do.
      if (!dryRun && !hasPendingMatches({ db, settings, dateOverride, ignoreLedger, approved })) {
        this.emit("progress", { phase: "matched", matchCount: 0 });
        const result = { scheduled: [], deferred: [], results: [], summary: null, cap: 0, droppedByCap: 0 };
        this.lastResult = result;
        return result;
      }

      let waClient = null;
      if (!dryRun) {
        waClient = await whatsappManager.connect({ userDataPath, qrTimeoutMs: 20_000 });
      }

      const result = await runEngine({
        db,
        settings,
        dryRun,
        dateOverride,
        ignoreLedger,
        approved,
        waClient,
        signal: this.controller.signal,
        applyStartJitter: trigger !== "manual",
        onProgress: (event) => {
          if (event.phase === "scheduled") this.pending = event.scheduledCount;
          else if (["sent", "not_on_whatsapp", "send_failed"].includes(event.phase)) this.pending = Math.max(0, this.pending - 1);
          this.emit("progress", event);
        },
      });

      this.lastResult = result;
      return result;
    } finally {
      this.active = false;
      this.controller = null;
    }
  }

  getPendingCount() {
    return this.active ? this.pending : 0;
  }

  /** Cancel the run in progress, if any. Takes effect between sends, never mid-send. */
  cancel() {
    if (this.controller) this.controller.abort();
  }
}

export const runManager = new RunManager();
