// The WhatsApp browser profile's `lockfile`, and why it needs handling.
//
// On Windows, Chromium-based browsers (Edge/Chrome) create `<profile>/lockfile`
// on start and hold it open exclusively until they exit. If the browser dies
// or is killed mid-start (app closed while connecting, a launch that timed
// out, a crash), the file is left behind -- unlocked, but present.
//
// Puppeteer then misreports EVERY later launch failure on Windows as "The
// browser is already running for <profile>" whenever that file exists: its
// check for the leftover lockfile runs before its own timeout check, so even
// a plain "Edge took more than 30 s to start" (first run on a slow PC,
// antivirus scanning the browser) comes out as "already running". The app
// then told the user to wait, and waiting never helped.
//
// Because the live browser holds the file open, trying to delete it tells the
// two cases apart: the delete succeeds only for a stale file (safe to remove)
// and fails (EBUSY/EPERM) while a browser really is still using the profile.

import fs from "node:fs";
import path from "node:path";

/**
 * whatsapp-web.js's LocalAuth keeps the browser profile in `<dataPath>/session`
 * (no clientId is used by this app).
 */
export function browserProfileDir(sessionDir) {
  return path.join(sessionDir, "session");
}

/**
 * Which of the given processes are browsers left running on this app's
 * WhatsApp profile (e.g. orphaned by a launch Puppeteer thought had failed).
 * Only top-level browser processes (no `--type=`; their helpers exit with
 * them) whose `--user-data-dir` is exactly profileDir -- never the user's own
 * Edge/Chrome windows, which use a different profile.
 * @param {Array<{ pid: number, commandLine: string | null }>} processes
 * @returns {number[]} pids
 */
export function findOrphanBrowserPids(processes, profileDir) {
  const norm = (p) => path.resolve(p).replace(/[\\/]+$/, "").toLowerCase();
  const want = norm(profileDir);
  const pids = [];
  for (const { pid, commandLine } of processes) {
    if (!commandLine || /--type=/.test(commandLine)) continue;
    // Seen in the wild: "--user-data-dir=C:\...\Birthday Bot\..." (whole
    // argument quoted, as Puppeteer passes it), --user-data-dir="..." (as Edge
    // passes it to helpers), and unquoted for paths without spaces.
    const m = commandLine.match(/"--user-data-dir=([^"]+)"|--user-data-dir="([^"]+)"|--user-data-dir=(\S+)/);
    if (m && norm(m[1] ?? m[2] ?? m[3]) === want) pids.push(pid);
  }
  return pids;
}

/**
 * Remove the profile's lockfile if no running browser holds it.
 * @param {string} profileDir the browser's userDataDir (see browserProfileDir)
 * @param {typeof fs} [fsImpl] injectable for tests
 * @returns {"none" | "cleared" | "in_use"}
 *   none: no lockfile; cleared: a stale one was removed; in_use: a browser still holds it.
 */
export function clearStaleBrowserLock(profileDir, fsImpl = fs) {
  const lockPath = path.join(profileDir, "lockfile");
  if (!fsImpl.existsSync(lockPath)) return "none";
  try {
    fsImpl.unlinkSync(lockPath);
    return "cleared";
  } catch (err) {
    if (err.code === "ENOENT") return "none"; // the old browser exited and removed it meanwhile
    return "in_use";
  }
}
