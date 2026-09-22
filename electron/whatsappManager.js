// Owns the single whatsapp-web.js Client instance for the app's lifetime:
// connect/pair, expose live status + QR to the UI, and hand a ready client
// to the engine when a run needs one. A thin stateful wrapper around
// src/core/whatsapp.js's pure createClient(), which stays UI-agnostic.

import { EventEmitter } from "node:events";
import fs from "node:fs";
import QRCode from "qrcode";
import { createClient } from "../src/core/whatsapp.js";
import { findSystemBrowser, findFallbackChromium, downloadFallbackChromium } from "./browser.js";
import { sessionDir } from "./db.js";

class WhatsappManager extends EventEmitter {
  constructor() {
    super();
    /** @type {'disconnected'|'connecting'|'qr'|'ready'|'error'} */
    this.status = "disconnected";
    this.client = null;
    this.lastError = null;
    this.qrDataUrl = null;
  }

  getState() {
    return { status: this.status, qrDataUrl: this.qrDataUrl, error: this.lastError };
  }

  _setState(patch) {
    Object.assign(this, patch);
    this.emit("state", this.getState());
  }

  resolveBrowser(userDataPath) {
    const system = findSystemBrowser();
    if (system) return system;
    const fallback = findFallbackChromium(userDataPath);
    if (fallback) return fallback;
    return null;
  }

  async downloadChromium(userDataPath, onProgress) {
    return downloadFallbackChromium(userDataPath, onProgress);
  }

  /**
   * Connect (or reconnect) using the persisted session. If no valid session
   * exists, a QR is emitted via the 'state' event for the UI to render.
   * @param {object} opts
   * @param {number} [opts.qrTimeoutMs] long for the interactive wizard, short for a background run
   */
  async connect({ userDataPath, qrTimeoutMs = 120_000 } = {}) {
    if (this.status === "ready" && this.client) return this.client;
    if (this.status === "connecting") {
      // Already connecting -- wait for that attempt instead of starting a second.
      return new Promise((resolve, reject) => {
        this.once("state", (s) => {
          if (s.status === "ready") resolve(this.client);
          else if (s.status === "error") reject(new Error(s.error));
        });
      });
    }

    const browser = this.resolveBrowser(userDataPath);
    if (!browser) {
      this._setState({ status: "error", error: "no_browser_found" });
      throw new Error(
        "No installed browser (Edge/Chrome) was found, and no fallback Chromium has been downloaded yet."
      );
    }

    this._setState({ status: "connecting", error: null, qrDataUrl: null });

    try {
      const client = await createClient({
        sessionDir: sessionDir(),
        executablePath: browser.executablePath,
        qrTimeoutMs,
        onQr: (qr) => {
          QRCode.toDataURL(qr, { margin: 1, scale: 6 })
            .then((dataUrl) => this._setState({ status: "qr", qrDataUrl: dataUrl }))
            .catch((err) => this._setState({ status: "error", error: err.message }));
        },
        onStatus: (s) => {
          if (s.phase === "loading") this.emit("state", { ...this.getState(), loading: s });
        },
      });
      this.client = client;
      this._setState({ status: "ready", qrDataUrl: null, error: null });

      client.on("disconnected", (reason) => {
        this.client = null;
        this._setState({ status: "disconnected", error: reason });
      });

      return client;
    } catch (err) {
      this.client = null;
      this._setState({ status: "error", error: err.message });
      throw err;
    }
  }

  /** Unlink: destroy the client and delete the persisted session so the next connect() re-shows a QR. */
  async unlink() {
    if (this.client) {
      await this.client.destroy().catch(() => {});
      this.client = null;
    }
    const dir = sessionDir();
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    this._setState({ status: "disconnected", qrDataUrl: null, error: null });
  }

  async disconnect() {
    if (this.client) {
      await this.client.destroy().catch(() => {});
      this.client = null;
    }
    this._setState({ status: "disconnected", qrDataUrl: null });
  }
}

export const whatsappManager = new WhatsappManager();
