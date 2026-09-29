// Factory reset: deletes everything the app has stored about the user, so
// the next launch starts from the first-run wizard. Pure file operations on
// a given userData path (no Electron), so it's testable against a temp dir;
// electron/main.js handles the ordering around it (stop runs, log out of
// WhatsApp, close the DB) and the relaunch.

import fs from "node:fs";
import path from "node:path";

// Everything that holds user data. Deliberately NOT included:
//  - "chromium": the optional fallback browser download (a ~150MB cache,
//    no personal data -- deleting it would just force a re-download);
//  - Electron's own profile folders (Cache, Local Storage, ...): the UI
//    keeps nothing there that matters.
export const RESET_TARGETS = [
  "birthday-bot.sqlite",
  "birthday-bot.sqlite-wal",
  "birthday-bot.sqlite-shm",
  "wa-session",
  "wwebjs-cache",
];

/**
 * Delete RESET_TARGETS under userDataPath. The DB must already be closed.
 * @returns {{ removed: string[], failed: Array<{ name: string, error: string }> }}
 */
export function wipeAppData(userDataPath) {
  const removed = [];
  const failed = [];
  for (const name of RESET_TARGETS) {
    const target = path.join(userDataPath, name);
    if (!fs.existsSync(target)) continue;
    try {
      // Retries: on Windows a just-closed browser can hold wa-session files
      // for a moment after exit.
      fs.rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
      removed.push(name);
    } catch (err) {
      failed.push({ name, error: err.message });
    }
  }
  return { removed, failed };
}
