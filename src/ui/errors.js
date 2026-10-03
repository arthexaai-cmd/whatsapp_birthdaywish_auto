// Turns errors coming back over IPC into something a non-technical user can
// act on. Electron wraps every rejected ipcRenderer.invoke() as
// "Error invoking remote method '<channel>': Error: <message>", and the
// underlying messages come from whatsapp-web.js / Node / our own core code
// -- none of which is meant to be shown to an end user as-is.
//
// Known cases get a plain-language explanation; anything unrecognised falls
// back to the cleaned-up original message so nothing is silently hidden.
// The full raw error is always logged to the console for debugging.

const IPC_PREFIX = /^Error invoking remote method '[^']*':\s*/;
const ERROR_PREFIX = /^(?:[A-Za-z]*Error:\s*)+/;

export function cleanMessage(err) {
  const raw = err?.message ?? String(err ?? "");
  return raw.replace(IPC_PREFIX, "").replace(ERROR_PREFIX, "").trim();
}

const RULES = [
  // WhatsApp Web stopped answering (most often the internet dropped mid-send); puppeteer's
  // wording tells the user to change a setting they can't touch.
  [/protocolTimeout|callFunctionOn timed out|Navigation timeout|Waiting for selector/i,
    "WhatsApp didn't respond in time -- usually a lost internet connection. It will be retried on the next send."],

  // --- App updates --- (before the generic network rule: these carry their own wording)
  [/^(?:HttpError:\s*)?403\b|rate limit/i, "GitHub is limiting update checks right now. Try again in a little while."],
  [/^(?:HttpError:\s*)?404\b|Cannot find latest\.yml|No published versions|Unable to find latest version/i,
    "No update information was found yet. Nothing has been released, or the release is still being prepared."],
  [/sha512 checksum mismatch|checksum/i, "The downloaded update failed its integrity check and was not installed. Try downloading it again."],

  // --- Network --- (first: "net::ERR_INTERNET_DISCONNECTED" would otherwise hit the generic /disconnected/ rule below)
  [/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|net::ERR_/i, "Couldn't reach the internet. Check your connection and try again."],

  // --- WhatsApp connection ---
  [/disconnected: LOGOUT|auth failure/i, "WhatsApp logged this computer out. Click the button below to show a new QR code and scan it again."],
  [/connection cancelled/i, "WhatsApp connection cancelled."],
  [/Timed out waiting for the WhatsApp QR/i, "The QR code wasn't scanned in time. Click the button below to get a new one."],
  [/disconnected: (CONFLICT|UNPAIRED|UNLAUNCHED|TOS_BLOCK|SMB_TOS_BLOCK)/i, "WhatsApp ended the session. Open WhatsApp on your phone, then reconnect from here."],
  [/disconnected: NAVIGATION|Execution context was destroyed|detached Frame|Target closed|Session closed|Protocol error/i,
    "The connection to WhatsApp Web was interrupted. Please try again."],
  [/browser_closed|connection_lost/i, "The WhatsApp connection was lost (its browser closed). Reconnect and try again."],
  [/disconnected/i, "WhatsApp disconnected. Please try connecting again."],
  [/browser_profile_in_use/i,
    "The browser WhatsApp uses is still open in the background. Restart the computer (or end msedge.exe / chrome.exe in Task Manager), then try again."],
  [/browser_launch_failed/i,
    "Microsoft Edge (or Chrome) didn't start in time to connect to WhatsApp. Try again; if it keeps happening, antivirus may be blocking it. Details are in main.log in %APPDATA%\\Birthday Bot."],
  [/browser is already running|already running for/i, "WhatsApp is still shutting down from the last attempt. Wait a few seconds and try again."],
  [/No installed browser|no_browser_found/i, "Microsoft Edge or Google Chrome is needed to connect to WhatsApp, and neither was found on this computer."],
  [/connected waClient is required/i, "WhatsApp isn't connected. Connect it from Settings, then try again."],
  [/Could not detect this platform for a Chromium download/i, "Chromium can't be downloaded automatically on this computer. Please install Microsoft Edge or Google Chrome."],

  [/^Import refused: (.*)/i, (m) => m[1]],
  [/^The file changed after the preview/i, () => "The file changed after the preview. Choose it again to review the new contents."],
  [/^Invalid contact: (.*)/i, (m) => m[1]],

  // --- Settings the app refused to store ---
  [/^Invalid setting: (.*)/i, (m) => m[1]],

  // --- Runs ---
  [/A run is already in progress/i, "A run is already in progress. Wait for it to finish, or cancel it first."],

  // --- Files ---
  [/EBUSY|EPERM|resource busy or locked/i, "That file is open in another program (probably Excel). Close it there and try again."],
  [/EACCES|permission denied/i, "The app doesn't have permission to use that file or folder. Try a different location."],
  [/xlsx roster file not found|ENOENT/i, "That file couldn't be found. It may have been moved or deleted."],
  [/Sheet ".*" not found/i, "The Excel file has no sheet with contacts in it. Use the sample Excel file as a starting point."],
  [/Unsupported file|Corrupted zip|End of data reached|invalid zip|not a spreadsheet/i,
    "That file couldn't be read as an Excel spreadsheet. Save it as .xlsx and try again."],

  // --- Contacts ---
  [/Invalid phone number: "(.*)"/i, (m) => `"${m[1]}" isn't a valid phone number. Include the country code, e.g. +919812345678.`],
  [/UNIQUE constraint failed: contacts/i, "A contact with that phone number already exists."],
];

/**
 * @param {unknown} err  anything caught from a window.api call
 * @returns {string}     a user-facing message
 */
export function friendlyError(err) {
  console.error(err);
  return friendlyMessage(err);
}

/** Same mapping as friendlyError but without logging -- for text already stored (e.g. History rows). */
export function friendlyMessage(err) {
  const msg = cleanMessage(err);
  for (const [pattern, text] of RULES) {
    const m = msg.match(pattern);
    if (m) return typeof text === "function" ? text(m) : text;
  }
  return msg || "Something went wrong. Please try again.";
}
