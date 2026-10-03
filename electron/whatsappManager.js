// Owns the single whatsapp-web.js Client instance for the app's lifetime:
// connect/pair, expose live status + QR to the UI, and hand a ready client
// to the engine when a run needs one. A thin stateful wrapper around
// src/core/whatsapp.js's pure createClient(), which stays UI-agnostic.

import { EventEmitter } from "node:events";
import fs from "node:fs";
import QRCode from "qrcode";
import { createClient } from "../src/core/whatsapp.js";
import { isClientAlive } from "../src/core/clientHealth.js";
import { browserProfileDir, clearStaleBrowserLock } from "../src/core/browserLock.js";
import { findSystemBrowser, findFallbackChromium, downloadFallbackChromium, killOrphanBrowsers } from "./browser.js";
import { sessionDir, webVersionCacheDir } from "./db.js";

// Puppeteer's ways of saying the browser didn't start: "The browser is
// already running for <profile>" (often wrong on Windows, see
// browserLock.js) and "Failed to launch the browser process".
const LAUNCH_FAILURE = /already running|Failed to launch the browser process/i;

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
    /** Cancels that attempt (Cancel button, unlink, disconnect). */
    this._abort = null;
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
    if (this.status === "ready" && this.client) {
      // "ready" was true when we connected; the browser may have died since
      // (crash, killed, sleep). Verify, and if it's gone reconnect instead of
      // handing out a dead client that fails every send.
      if (await isClientAlive(this.client)) return this.client;
      console.warn("[whatsapp] the connection is no longer alive; reconnecting");
      const dead = this.client;
      this.client = null;
      this._setState({ status: "disconnected", error: "connection_lost", qrDataUrl: null });
      await this._teardownClient(dead);
    }
    if (!this._connecting) {
      this._abort = new AbortController();
      this._connecting = this._connect({ userDataPath, qrTimeoutMs, signal: this._abort.signal }).finally(() => {
        this._connecting = null;
        this._abort = null;
      });
    }
    return this._connecting;
  }

  /** Abort a connect attempt that is still waiting (e.g. for a QR scan) and wait for its browser to exit. */
  async cancelConnect() {
    if (!this._connecting) return;
    this._abort?.abort();
    await this._connecting.catch(() => {});
  }

  async _connect({ userDataPath, qrTimeoutMs, signal }) {
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
      // A lockfile left by a browser that died mid-start makes Puppeteer
      // report every launch failure as "already running" (browserLock.js).
      if (clearStaleBrowserLock(browserProfileDir(sessionDir())) === "cleared") {
        console.warn("[whatsapp] removed a stale browser lockfile left by an earlier attempt");
      }
      try {
        const client = await this._createClient(browser, qrTimeoutMs, signal);
        this.client = client;
        this._setState({ status: "ready", qrDataUrl: null, error: null });
        client.on("disconnected", (reason) => this._onRuntimeDisconnect(client, reason));
        // whatsapp-web.js emits no "disconnected" when the browser process itself
        // dies, so watch the browser directly.
        client.pupBrowser?.on("disconnected", () => this._onRuntimeDisconnect(client, "browser_closed"));
        return client;
      } catch (err) {
        this.client = null;
        if (err.cancelled) {
          this._setState({ status: "disconnected", error: null, qrDataUrl: null });
          throw err;
        }
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
        const launchFailed = LAUNCH_FAILURE.test(err.message);
        if (launchFailed && !retriedLaunch) {
          // Either an old browser for this profile is still exiting, or one
          // was orphaned (Edge relaunching itself left a running browser that
          // Puppeteer lost track of -- see whatsapp.js). This manager has no
          // live client at this point, so any browser on our profile is a
          // leftover: close it, then try once more. Before this, only a PC
          // restart cleared it.
          console.warn("[whatsapp] browser launch failed; closing leftover browsers and retrying:", err.message);
          retriedLaunch = true;
          const killed = await killOrphanBrowsers(browserProfileDir(sessionDir()));
          if (killed.length) console.warn(`[whatsapp] closed leftover browser process(es): ${killed.join(", ")}`);
          await new Promise((r) => setTimeout(r, killed.length ? 2000 : 4000));
          continue;
        }
        if (launchFailed) err = this._explainLaunchFailure(err);
        console.error("[whatsapp] connect failed:", err);
        this._setState({ status: "error", error: err.message, qrDataUrl: null });
        throw err;
      }
    }
  }

  /**
   * The retry also failed to launch. Find out whether "already running" is
   * true: if the profile's lockfile can be deleted, no browser holds it, so
   * the browser actually failed to start (timed out, crashed, or was blocked)
   * and Puppeteer mislabelled it. The full original error is in main.log.
   */
  _explainLaunchFailure(err) {
    const lock = clearStaleBrowserLock(browserProfileDir(sessionDir()));
    if (lock === "in_use") {
      const e = new Error("browser_profile_in_use: another browser window is still using the WhatsApp profile");
      e.cause = err;
      return e;
    }
    // Don't embed err.message: it says "already running", which is exactly the
    // wrong explanation (and would match that rule in src/ui/errors.js).
    const e = new Error("browser_launch_failed: the browser could not start");
    e.cause = err;
    return e;
  }

  _createClient(browser, qrTimeoutMs, signal) {
    return createClient({
      signal,
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
    await this.cancelConnect();
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
    await this.cancelConnect();
    const client = this.client;
    this.client = null;
    await this._teardownClient(client);
    this._setState({ status: "disconnected", qrDataUrl: null, error: null });
  }
}

export const whatsappManager = new WhatsappManager();
