// Finds an already-installed Chromium-based browser on this machine, so
// whatsapp-web.js's Puppeteer can drive it instead of downloading its own
// Chromium (which would add ~300MB+ to the installer). Validated against a
// packaged Electron process in the phase-2 spike: system Edge works fine.
//
// Preference order: Edge (guaranteed present on Windows 10/11) > Chrome >
// Chromium. If none are found, callers should fall back to a one-time
// Chromium download (see downloadFallbackChromium below) rather than fail.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const WIN_CANDIDATES = [
  // Edge
  "%ProgramFiles(x86)%\\Microsoft\\Edge\\Application\\msedge.exe",
  "%ProgramFiles%\\Microsoft\\Edge\\Application\\msedge.exe",
  "%LocalAppData%\\Microsoft\\Edge\\Application\\msedge.exe",
  // Chrome
  "%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe",
  "%ProgramFiles(x86)%\\Google\\Chrome\\Application\\chrome.exe",
  "%LocalAppData%\\Google\\Chrome\\Application\\chrome.exe",
  // Chromium (rare, but some users have it)
  "%ProgramFiles%\\Chromium\\Application\\chrome.exe",
  "%LocalAppData%\\Chromium\\Application\\chrome.exe",
];

const MAC_CANDIDATES = [
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
];

const LINUX_CANDIDATES = [
  "/usr/bin/microsoft-edge",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/snap/bin/chromium",
];

function expandWindowsEnvVars(p) {
  return p.replace(/%([^%]+)%/g, (_, name) => process.env[name] || "");
}

/**
 * @returns {{ executablePath: string, browser: 'edge'|'chrome'|'chromium' } | null}
 */
export function findSystemBrowser() {
  const platform = os.platform();
  const candidates =
    platform === "win32" ? WIN_CANDIDATES.map(expandWindowsEnvVars) : platform === "darwin" ? MAC_CANDIDATES : LINUX_CANDIDATES;

  for (const p of candidates) {
    if (p && fs.existsSync(p)) {
      const lower = p.toLowerCase();
      const browser = lower.includes("edge") ? "edge" : lower.includes("chromium") ? "chromium" : "chrome";
      return { executablePath: p, browser };
    }
  }
  return null;
}

/**
 * Where a fallback-downloaded Chromium lives, if the user has no browser
 * installed at all. Kept in userData, not the app's own resources, so it
 * survives app updates and is never bundled in the installer.
 */
export function fallbackChromiumDir(userDataPath) {
  return path.join(userDataPath, "chromium");
}

/**
 * One-click fallback for the rare case no system browser was found: downloads
 * a single Chromium build into userData/chromium via @puppeteer/browsers.
 * Only called from the UI on explicit user action (it's a real download,
 * ~150MB) -- never automatically.
 *
 * @param {string} userDataPath
 * @param {(progress: {downloadedBytes: number, totalBytes: number}) => void} [onProgress]
 * @returns {Promise<{ executablePath: string, browser: 'chromium' }>}
 */
export async function downloadFallbackChromium(userDataPath, onProgress) {
  const { install, resolveBuildId, detectBrowserPlatform, Browser } = await import("@puppeteer/browsers");
  const cacheDir = fallbackChromiumDir(userDataPath);
  const platform = detectBrowserPlatform();
  if (!platform) throw new Error("Could not detect this platform for a Chromium download.");

  const buildId = await resolveBuildId(Browser.CHROME, platform, "stable");
  const installed = await install({
    browser: Browser.CHROME,
    buildId,
    cacheDir,
    platform,
    downloadProgressCallback: (downloadedBytes, totalBytes) => onProgress?.({ downloadedBytes, totalBytes }),
  });

  return { executablePath: installed.executablePath, browser: "chromium" };
}

/** Checks whether a fallback Chromium was already downloaded previously. */
export function findFallbackChromium(userDataPath) {
  const dir = fallbackChromiumDir(userDataPath);
  if (!fs.existsSync(dir)) return null;
  // @puppeteer/browsers lays out cacheDir/<browser>/<platform-buildId>/...
  try {
    const browserDirs = fs.readdirSync(dir);
    for (const b of browserDirs) {
      const buildDirs = fs.readdirSync(path.join(dir, b));
      for (const build of buildDirs) {
        const candidates = [
          path.join(dir, b, build, "chrome-win64", "chrome.exe"),
          path.join(dir, b, build, "chrome-win32", "chrome.exe"),
          path.join(dir, b, build, "chrome-linux64", "chrome"),
          path.join(dir, b, build, "chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"),
        ];
        for (const c of candidates) {
          if (fs.existsSync(c)) return { executablePath: c, browser: "chromium" };
        }
      }
    }
  } catch {
    return null;
  }
  return null;
}
