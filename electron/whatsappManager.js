// Owns the single whatsapp-web.js Client instance for the app's lifetime:
// connect/pair, expose live status + QR to the UI, and hand a ready client
// to the engine when a run needs one. A thin stateful wrapper around
// src/core/whatsapp.js's pure createClient(), which stays UI-agnostic.

import { EventEmitter } from "node:events";
import fs from "node:fs";
import QRCode from "qrcode";
import { createClient } from "../src/core/whatsapp.js";
import { findSystemBrowser, findFallbackChromium, downloadFallbackChromium } from "./browser.js";
import { sessionDir, webVersionCacheDir } from "./db.js";

class WhatsappManager extends EventEmitter {
  constructor() {
    super();
    /** @type {'disconnected'|'connecting'|'qr'|'ready'|'error'} */
    this.status = "disconnected";
    this.client = null;
    /**
     * Machine-readable reason for the current disconnected/error state, for
     * the UI to explain. "unlinked" = logged out from the phone.
     * @type {string|null}
     */
    this.error = null;
    this.qrDataUrl = null;
    /** In-flight connect() attempt, shared by concurrent callers. */
    this._connecting = null;
    /** In-flight browser teardown; every new connect waits for it first. */
    this._teardown = Promise.resolve();
  }

  getState() {
    return { status: this.status, qrDataUrl: this.qrDataUrl, error: this.error };
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
   * Concurrent callers share one attempt.
   * @param {object} opts
   * @param {number} [opts.qrTimeoutMs] long for the interactive wizard, short for a background run
   */
  async connect({ userDataPath, qrTimeoutMs = 120_000 } = {}) {
    if (this.status === "ready" && this.client) return this.client;
    if (!this._connecting) {
      this._connecting = this._connect({ userDataPath, qrTimeoutMs }).finally(() => {
        this._connecting = null;
      });
    }
    return this._connecting;
  }

  async _connect({ userDataPath, qrTimeoutMs }) {
    const browser = this.resolveBrowser(userDataPath);
    if (!browser) {
      this._setState({ status: "error", error: "no_browser_found", qrDataUrl: null });
      throw new Error(
        "No installed browser (Edge/Chrome) was found, and no fallback Chromium has been downloaded yet."
      );
    }

    this._setState({ status: "connecting", error: null, qrDataUrl: null });

    // A previous client may still be shutting down (e.g. just unlinked from
    // the phone). Launching a new browser on the same profile before the old
    // one has exited fails with "browser is already running".
    await this._teardown;

    let clearedAfterLogout = false;
    let retriedLaunch = false;
    for (;;) {
      try {
        const client = await this._createClient(browser, qrTimeoutMs);
        this.client = client;
        this._setState({ status: "ready", qrDataUrl: null, error: null });
        client.on("disconnected", (reason) => this._onRuntimeDisconnect(client, reason));
        return client;
      } catch (err) {
        this.client = null;
        if (err.reason === "LOGOUT" && !clearedAfterLogout) {
          // The saved session was revoked (unlinked from the phone, or
          // invalidated by WhatsApp). It will never work again, so wipe it
          // and start over -- which issues a fresh QR -- instead of
          // surfacing a raw "LOGOUT" error the user can't act on.
          console.warn("[whatsapp] saved session was logged out; clearing it and re-pairing");
          clearedAfterLogout = true;
          this._clearSession();
          this._setState({ status: "connecting", error: null, qrDataUrl: null });
          continue;
        }
        if (/already running/i.test(err.message) && !retriedLaunch) {
          // An old browser for this profile is still exiting. Give it a
          // moment and try once more before giving up.
          console.warn("[whatsapp] previous browser still running; retrying shortly");
          retriedLaunch = true;
          await new Promise((r) => setTimeout(r, 4000));
          continue;
        }
        console.error("[whatsapp] connect failed:", err);
        this._setState({ status: "error", error: err.message, qrDataUrl: null });
        throw err;
      }
    }
  }

  _createClient(browser, qrTimeoutMs) {
    return createClient({
      sessionDir: sessionDir(),
      webVersionCacheDir: webVersionCacheDir(),
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
  }

  /**
   * A connected client dropped -- most commonly because the user unlinked
   * this device from their phone (reason "LOGOUT"). Tear the browser down
   * fully and, for a logout, delete the now-useless session, so the next
   * connect() goes straight to a fresh QR instead of failing.
   */
  _onRuntimeDisconnect(client, reason) {
    if (this.client !== client) return; // already replaced/torn down
    console.warn(`[whatsapp] disconnected while connected: ${reason}`);
    this.client = null;
    const loggedOut = reason === "LOGOUT";
    this._setState({ status: "disconnected", error: loggedOut ? "unlinked" : reason, qrDataUrl: null });
    this._teardownClient(client, { clearSession: loggedOut });
  }

  /** Destroy a client and (optionally) wipe the session, recording the work in _teardown. */
  _teardownClient(client, { clearSession = false } = {}) {
    this._teardown = this._teardown.then(async () => {
      if (client) await client.destroy().catch(() => {});
      if (clearSession) this._clearSession();
    });
    return this._teardown;
  }

  _clearSession() {
    const dir = sessionDir();
    try {
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    } catch (err) {
      console.error("[whatsapp] could not clear session directory:", err);
    }
  }

  /** Unlink: destroy the client and delete the persisted session so the next connect() re-shows a QR. */
  async unlink() {
    const client = this.client;
    this.client = null;
    await this._teardownClient(client, { clearSession: true });
    this._setState({ status: "disconnected", qrDataUrl: null, error: null });
  }

  /**
   * Factory reset: like unlink(), but first try a real WhatsApp logout so
   * this computer also disappears from the phone's "Linked devices" list.
   * Best-effort and time-boxed -- if there's no live session or WhatsApp
   * doesn't answer, the local session is wiped anyway.
   */
  async logOutAndUnlink() {
    const client = this.client;
    if (client) {
      await Promise.race([client.logout(), new Promise((resolve) => setTimeout(resolve, 10_000))]).catch((err) =>
        console.error("[whatsapp] logout during reset failed (continuing):", err)
      );
    }
    await this.unlink();
  }

  async disconnect() {
    const client = this.client;
    this.client = null;
    await this._teardownClient(client);
    this._setState({ status: "disconnected", qrDataUrl: null, error: null });
  }
}

export const whatsappManager = new WhatsappManager();
