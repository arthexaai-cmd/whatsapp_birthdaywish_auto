// WhatsApp Web client lifecycle: connect using a persisted session, validate
// numbers before sending, send with a typing-presence delay, and fail loud
// (never silently swallow a broken session).
//
// This module is UI-agnostic: a `qr` event is reported via the onQr
// callback as a raw string, not rendered to an image here. The Electron
// IPC layer turns that string into a data-URL PNG (via the `qrcode`
// package) for the renderer to display.

import pkg from "whatsapp-web.js";
const { Client, LocalAuth } = pkg;

/**
 * Create and ready a WhatsApp client using the persisted LocalAuth session
 * at sessionDir.
 *
 * A `qr` event means there is no valid paired session -- expected on first
 * run (the wizard shows it and waits for a scan with a generous timeout),
 * but during an unattended scheduled run it means the session died and
 * needs the user to re-pair from the app. Either way we never reject
 * *because* a QR was requested; we reject only if qrTimeoutMs elapses
 * without a successful pairing, so callers control how long to wait.
 *
 * @param {object} opts
 * @param {string} opts.sessionDir
 * @param {string} [opts.webVersionCacheDir] where whatsapp-web.js caches the WhatsApp Web
 *   client version it pins to. Defaults to a `./.wwebjs_cache/` relative to process.cwd()
 *   if omitted -- unpredictable for a packaged app, so callers should always pass a path
 *   under userData (see electron/whatsappManager.js).
 * @param {string} [opts.executablePath] path to system Chrome/Edge (see electron/browser.js)
 * @param {(qr: string) => void} [opts.onQr] called each time a new QR is issued
 * @param {(status: {phase: string, [k: string]: any}) => void} [opts.onStatus] loading/auth progress
 * @param {number} [opts.qrTimeoutMs] how long to wait for a scan before giving up (default 2 min),
 *   counted from the FIRST QR. WhatsApp rotates the QR every ~20 s indefinitely, so a timer that
 *   restarted on every rotation would never fire (the pairing screen would wait forever).
 * @param {AbortSignal} [opts.signal] cancels the attempt: the browser is torn down and the promise
 *   rejects with an error whose `cancelled` is true.
 */
export async function createClient({
  sessionDir,
  webVersionCacheDir,
  executablePath,
  onQr,
  onStatus,
  qrTimeoutMs = 120_000,
  signal,
}) {
  const client = new Client({
    authStrategy: new LocalAuth({ dataPath: sessionDir }),
    webVersionCache: webVersionCacheDir ? { type: "local", path: webVersionCacheDir } : undefined,
    // Without this, the linked device shows up generically (e.g. "Chrome")
    // in WhatsApp's own Settings > Linked Devices list on the phone --
    // naming it clearly means it's obvious what it is and easy to find if
    // you ever want to unlink it directly from the phone.
    browserName: "Birthday Bot",
    puppeteer: {
      headless: true,
      executablePath,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    },
  });

  let qrTimer = null;
  const clearQrTimer = () => {
    if (qrTimer) clearTimeout(qrTimer);
    qrTimer = null;
  };

  let settled = false;
  let onReady, onAuthFailure, onDisconnected, onQrEvent, onLoading;

  const ready = new Promise((resolve, reject) => {
    // Every failure path goes through here. It tears down the underlying
    // Puppeteer browser and *waits* for it to exit before rejecting.
    // Without this the process (and its lock on the session's browser
    // profile directory) leaks: whatsapp-web.js's own cleanup tries to
    // delete session files via LocalAuth.logout(), which fails with EBUSY
    // while this browser still holds them open -- and the next connect
    // attempt then fails with "browser is already running for <profile>".
    // Waiting also means a caller that reacts to a LOGOUT by deleting the
    // session directory isn't racing a still-running browser.
    const fail = async (err) => {
      if (settled) return;
      settled = true;
      clearQrTimer();
      await client.destroy().catch(() => {});
      reject(err);
    };

    onReady = () => {
      if (settled) return;
      settled = true;
      clearQrTimer();
      onStatus?.({ phase: "ready" });
      resolve();
    };

    onAuthFailure = (msg) => fail(new Error(`WhatsApp auth failure: ${msg}`));

    onDisconnected = (reason) => {
      const err = new Error(`WhatsApp disconnected: ${reason}`);
      err.reason = reason;
      fail(err);
    };

    onLoading = (percent, message) => onStatus?.({ phase: "loading", percent, message });

    onQrEvent = (qr) => {
      onStatus?.({ phase: "qr" });
      onQr?.(qr);
      // Started once, at the first QR -- NOT reset on rotation (see qrTimeoutMs).
      if (qrTimer) return;
      qrTimer = setTimeout(() => {
        fail(
          new Error(
            "Timed out waiting for the WhatsApp QR code to be scanned. " +
              "Open the app and re-pair from Settings."
          )
        );
      }, qrTimeoutMs);
    };

    client.on("ready", onReady);
    client.on("auth_failure", onAuthFailure);
    client.on("disconnected", onDisconnected);
    client.on("loading_screen", onLoading);
    client.on("qr", onQrEvent);

    // initialize() can itself reject (e.g. the browser fails to launch
    // because an old one still holds the profile). Unhandled, that left the
    // caller waiting forever on a `ready` that would never come.
    client.initialize().catch(fail);

    if (signal) {
      const cancel = () => {
        const err = new Error("WhatsApp connection cancelled.");
        err.cancelled = true;
        fail(err);
      };
      if (signal.aborted) cancel();
      else signal.addEventListener("abort", cancel, { once: true });
    }
  });

  await ready;

  // From here on the caller owns the client's lifecycle (including reacting
  // to a later disconnect, e.g. being unlinked from the phone). Drop the
  // pairing-phase handlers so they don't race the caller's own teardown.
  client.off("ready", onReady);
  client.off("auth_failure", onAuthFailure);
  client.off("disconnected", onDisconnected);
  client.off("loading_screen", onLoading);
  client.off("qr", onQrEvent);

  return client;
}

/**
 * Look up whether a phone number is registered on WhatsApp and, if so,
 * return its chat id. Sending to numbers that aren't on WhatsApp is one of
 * the strongest ban signals, so callers must hard-skip a null result.
 */
export async function resolveWhatsappId(client, phoneE164) {
  const digits = phoneE164.replace(/^\+/, "");
  const result = await client.getNumberId(digits);
  return result ? result._serialized : null;
}

function randInt([lo, hi]) {
  return Math.floor(Math.random() * (hi - lo + 1)) + lo;
}

/**
 * Send a message with a simulated typing delay beforehand, to look more
 * like a human composing rather than a script firing instantly.
 */
export async function sendWithTyping(client, chatId, text, typingMsPerCharRange) {
  // Best-effort only: the "typing…" presence indicator is a cosmetic
  // anti-detection touch, not something the actual send depends on. Both
  // getChatById() and sendStateTyping() go through whatsapp-web.js's
  // injected page.evaluate() calls into WhatsApp's internal (and
  // frequently-changing) Store objects -- exactly the kind of call that
  // breaks first when WhatsApp ships an internal change, well before the
  // more heavily-used sendMessage()/getNumberId() paths do. A failure here
  // must never block the real send.
  try {
    const chat = await client.getChatById(chatId);
    await chat.sendStateTyping();
  } catch (err) {
    console.warn(`[whatsapp] typing-presence simulation failed (non-fatal, continuing to send): ${err.message}`);
  }
  const perChar = randInt(typingMsPerCharRange);
  const delay = Math.min(text.length * perChar, 15_000); // cap so a long message doesn't stall the batch
  await new Promise((r) => setTimeout(r, delay));
  return client.sendMessage(chatId, text);
}
