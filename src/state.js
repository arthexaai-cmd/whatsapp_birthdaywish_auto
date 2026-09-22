// The sent-ledger: an append-only JSONL file recording every send outcome,
// keyed by `${phoneE164}:${occurrenceDate}`. Lives under BOT_HOME, outside
// the repo workspace, so it survives across GitHub Actions checkouts.
//
// Written to immediately after each individual send (not batched at the
// end) so a mid-run crash never loses the record of what already went out,
// and re-running the same day is idempotent rather than double-sending.

import fs from "node:fs";
import readline from "node:readline";

/**
 * @typedef {Object} LedgerEntry
 * @property {string} ledgerKey
 * @property {string} phoneE164
 * @property {string} name
 * @property {string} occurrence   YYYY-MM-DD
 * @property {"sent"|"not_on_whatsapp"|"failed_permanent"} status
 * @property {string} timestamp    ISO
 * @property {boolean} belated
 */

export async function loadLedgerKeys(ledgerFile) {
  const keys = new Set();
  if (!fs.existsSync(ledgerFile)) return keys;

  const rl = readline.createInterface({
    input: fs.createReadStream(ledgerFile, "utf8"),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const entry = JSON.parse(trimmed);
      // Only "sent" and "not_on_whatsapp" (a number confirmed to not exist on
      // WhatsApp) are treated as terminal -- both should never be retried.
      // A transient "failed" entry (after retries exhausted mid-run) is NOT
      // added here, so it remains eligible for a future run to retry.
      if (entry.ledgerKey && (entry.status === "sent" || entry.status === "not_on_whatsapp")) {
        keys.add(entry.ledgerKey);
      }
    } catch {
      // Ignore a corrupt/partial trailing line (e.g. process killed mid-write).
    }
  }
  return keys;
}

export function appendLedgerEntry(ledgerFile, entry) {
  fs.appendFileSync(ledgerFile, JSON.stringify(entry) + "\n", "utf8");
}

/** Count how many distinct calendar days have at least one ledger entry, for warm-up ramping. */
export async function countLedgerDays(ledgerFile) {
  if (!fs.existsSync(ledgerFile)) return 0;
  const days = new Set();
  const rl = readline.createInterface({
    input: fs.createReadStream(ledgerFile, "utf8"),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const entry = JSON.parse(trimmed);
      if (entry.timestamp) days.add(entry.timestamp.slice(0, 10));
    } catch {
      // ignore
    }
  }
  return days.size;
}
