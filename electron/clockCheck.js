// Fetches true time from a trusted external source and measures drift
// against this machine's clock. Runs in the main process, not the
// renderer -- the renderer's CSP deliberately has no connect-src for
// external hosts (see src/ui/index.html), and network calls belong here
// regardless.
//
// Reads the `Date` response header from a lightweight, always-on HTTPS
// endpoint rather than depending on a dedicated "time API" service (which
// could rate-limit, change, or disappear) -- every HTTPS server is
// required to send an accurate Date header (RFC 7231 §7.1.1.2), so this
// works against essentially anything. Google's connectivity-check endpoint
// is used because it's minimal (204, no body) and built for exactly this
// kind of lightweight probe.

import https from "node:https";
import { classifyDrift } from "../src/core/clock.js";

const PROBE_URL = "https://www.gstatic.com/generate_204";
const TIMEOUT_MS = 8000;

function fetchServerDate(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: TIMEOUT_MS }, (res) => {
      res.resume(); // discard body, we only need headers
      const dateHeader = res.headers.date;
      if (!dateHeader) {
        reject(new Error("Response had no Date header."));
        return;
      }
      const parsed = new Date(dateHeader);
      if (isNaN(parsed.getTime())) {
        reject(new Error(`Could not parse Date header: "${dateHeader}"`));
        return;
      }
      resolve(parsed);
    });
    req.on("timeout", () => req.destroy(new Error("Timed out reaching the time-check server.")));
    req.on("error", reject);
  });
}

/**
 * @returns {Promise<{ok: boolean, driftMs: number, trueTime: string, localTime: string} | {ok: null, error: string}>}
 *   ok: null means the check itself failed (e.g. no internet) -- not the same as "clock is wrong".
 */
export async function checkClockDrift() {
  try {
    const before = Date.now();
    const trueTime = await fetchServerDate(PROBE_URL);
    const after = Date.now();
    // Attribute the network round-trip's midpoint as the local reference
    // instant, which halves the latency's contribution to the measured
    // drift. Not NTP-grade precision, but this only needs to catch a clock
    // that's wrong by minutes/hours/days/timezone, not milliseconds.
    const localAtMeasurement = new Date((before + after) / 2);
    return classifyDrift(trueTime, localAtMeasurement);
  } catch (err) {
    return { ok: null, error: err.message || String(err) };
  }
}
