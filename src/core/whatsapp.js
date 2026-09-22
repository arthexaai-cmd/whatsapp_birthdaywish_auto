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
 * @param {string} [opts.executablePath] path to system Chrome/Edge (see electron/browser.js)
 * @param {(qr: string) => void} [opts.onQr] called each time a new QR is issued
 * @param {(status: {phase: string, [k: string]: any}) => void} [opts.onStatus] loading/auth progress
 * @param {number} [opts.qrTimeoutMs] how long to wait for a scan before giving up (default 2 min)
 */
export async function createClient({
  sessionDir,
  executablePath,
  onQr,
  onStatus,
  qrTimeoutMs = 120_000,
}) {
  const client = new Client({
    authStrategy: new LocalAuth({ dataPath: sessionDir }),
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

  const ready = new Promise((resolve, reject) => {
    client.on("ready", () => {
      clearQrTimer();
      onStatus?.({ phase: "ready" });
      resolve();
    });

    client.on("auth_failure", (msg) => {
      clearQrTimer();
      reject(new Error(`WhatsApp auth failure: ${msg}`));
    });

    client.on("disconnected", (reason) => {
      clearQrTimer();
      reject(new Error(`WhatsApp disconnected: ${reason}`));
    });

    client.on("loading_screen", (percent, message) => {
      onStatus?.({ phase: "loading", percent, message });
    });

    client.on("qr", (qr) => {
      onStatus?.({ phase: "qr" });
      onQr?.(qr);
      // Reset the timeout on every new QR (WhatsApp rotates it periodically
      // while waiting), so the window is "time since the LAST QR", not since
      // the first one.
      clearQrTimer();
      qrTimer = setTimeout(() => {
        reject(
          new Error(
            "Timed out waiting for the WhatsApp QR code to be scanned. " +
              "Open the app and re-pair from Settings."
          )
        );
      }, qrTimeoutMs);
    });
  });

  client.initialize();
  try {
    await ready;
  } finally {
    clearQrTimer();
  }
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
  const chat = await client.getChatById(chatId);
  await chat.sendStateTyping();
  const perChar = randInt(typingMsPerCharRange);
  const delay = Math.min(text.length * perChar, 15_000); // cap so a long message doesn't stall the batch
  await new Promise((r) => setTimeout(r, delay));
  return client.sendMessage(chatId, text);
}
