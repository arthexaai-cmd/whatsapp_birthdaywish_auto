// WhatsApp Web client lifecycle: connect using a persisted session, validate
// numbers before sending, send with a typing-presence delay, and fail loud
// (never silently swallow a broken session).

import pkg from "whatsapp-web.js";
const { Client, LocalAuth } = pkg;
import qrcode from "qrcode-terminal";

/**
 * Create and ready a WhatsApp client using the persisted LocalAuth session
 * at sessionDir. In automated (non-interactive) mode, a QR prompt means the
 * session is dead -- we abort rather than hang for hours in a GH Actions job.
 *
 * @param {object} opts
 * @param {string} opts.sessionDir
 * @param {boolean} [opts.interactive] if true, print the QR and wait for scan (used by scripts/login.js)
 */
export async function createClient({ sessionDir, interactive = false }) {
  const client = new Client({
    authStrategy: new LocalAuth({ dataPath: sessionDir }),
    puppeteer: {
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    },
  });

  const ready = new Promise((resolve, reject) => {
    client.on("ready", () => resolve());
    client.on("auth_failure", (msg) => reject(new Error(`WhatsApp auth failure: ${msg}`)));
    client.on("disconnected", (reason) => reject(new Error(`WhatsApp disconnected: ${reason}`)));
    client.on("qr", (qr) => {
      if (interactive) {
        qrcode.generate(qr, { small: true });
        console.log("Scan the QR code above with WhatsApp on your phone (Linked devices > Link a device).");
      } else {
        reject(
          new Error(
            "WhatsApp session is not authenticated (a QR code was requested). " +
              "Run `npm run login` once on this machine to pair the session, then retry."
          )
        );
      }
    });
  });

  client.initialize();
  await ready;
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
