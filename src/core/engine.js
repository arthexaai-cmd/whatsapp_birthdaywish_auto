// The orchestrator: load contacts from DB -> match birthdays -> dedupe vs
// the DB ledger -> build a paced schedule -> send (or dry-run) -> record.
//
// Deliberately decoupled from Electron and from whatsapp-web.js's Client
// type: callers inject an already-connected waClient (or null for a dry
// run) and a db (a node:sqlite DatabaseSync, or anything implementing the
// same query surface as src/core/db.js). This keeps it unit-testable with
// fakes for both, and keeps main.js's job to just wiring real ones in.
//
// Supports cancellation via a standard AbortSignal: a run can be minutes to
// hours long by design (see pacing.js), so the UI must be able to stop one
// cleanly mid-batch without losing the record of what already sent.

import { matchBirthdays, dedupeAgainstLedger } from "./birthdays.js";
import { renderMessage } from "./messages.js";
import { batchMatches, buildSchedule } from "./pacing.js";
import { resolveWhatsappId, sendWithTyping } from "./whatsapp.js";
import { buildSummary } from "./report.js";
import {
  listContacts,
  getMessagesConfig,
  loadTerminalLedgerKeys,
  countDistinctRunDays,
  startRun,
  endRun,
  recordSend,
} from "./db.js";

function ymdKey(occ) {
  return `${occ.year}-${String(occ.month).padStart(2, "0")}-${String(occ.day).padStart(2, "0")}`;
}

/**
 * Cheap pre-check for whether a run would have anything to send, without
 * needing a WhatsApp connection. Used to avoid launching the browser (and
 * blocking on a QR timeout) for a scheduled/catch-up run that would end up
 * finding zero matches anyway -- e.g. an empty contact list, or everyone
 * already sent to today.
 */
export function hasPendingMatches({ db, settings, dateOverride = null, ignoreLedger = false }) {
  const allContacts = listContacts(db).filter((c) => !c.skip);
  const today = todayInTz(settings.timezone, dateOverride);
  let matches = matchBirthdays(allContacts, today, {
    catchupDays: settings.catchupDays,
    leapDayFallback: settings.leapDayFallback,
  });
  if (!ignoreLedger) {
    const terminalKeys = loadTerminalLedgerKeys(db);
    matches = dedupeAgainstLedger(matches, terminalKeys);
  }
  return matches.length > 0;
}

function todayInTz(tz, override) {
  if (override) {
    const [y, m, d] = override.split("-").map(Number);
    return { year: y, month: m, day: d };
  }
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
  const parts = fmt.formatToParts(new Date());
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

/** Cancellable sleep: resolves early (without error) if the signal aborts. */
function abortableSleep(ms, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * @param {object} opts
 * @param {import("node:sqlite").DatabaseSync} opts.db
 * @param {object} opts.settings         resolved settings (see src/core/defaults.js shape)
 * @param {boolean} [opts.dryRun]
 * @param {string} [opts.dateOverride]   YYYY-MM-DD, for testing "today"
 * @param {boolean} [opts.ignoreLedger]  testing only: resend even if already recorded
 * @param {object|null} opts.waClient    a ready whatsapp-web.js Client, or null for dry runs
 * @param {AbortSignal} [opts.signal]    cancels the run between sends (never mid-send)
 * @param {(event: object) => void} [opts.onProgress]
 */
export async function runEngine({
  db,
  settings,
  dryRun = false,
  dateOverride = null,
  ignoreLedger = false,
  waClient = null,
  signal,
  onProgress = () => {},
}) {
  const runStart = new Date();
  if (!dryRun && !waClient) {
    throw new Error("runEngine: a connected waClient is required for a real (non-dry-run) run.");
  }

  const allContacts = listContacts(db).filter((c) => !c.skip);
  onProgress({ phase: "loaded", contactCount: allContacts.length });

  const today = todayInTz(settings.timezone, dateOverride);
  let matches = matchBirthdays(allContacts, today, {
    catchupDays: settings.catchupDays,
    leapDayFallback: settings.leapDayFallback,
  });

  if (!ignoreLedger) {
    const terminalKeys = loadTerminalLedgerKeys(db);
    matches = dedupeAgainstLedger(matches, terminalKeys);
  }
  onProgress({ phase: "matched", matchCount: matches.length });

  if (matches.length === 0) {
    return { scheduled: [], deferred: [], results: [], summary: null, cap: 0, droppedByCap: 0 };
  }

  const ledgerDays = countDistinctRunDays(db);
  const { batches, cap, droppedByCap } = batchMatches(matches, settings.pacing, ledgerDays);
  const { scheduled, deferred } = buildSchedule(batches, settings.pacing, runStart, settings.timezone);
  onProgress({
    phase: "scheduled",
    scheduledCount: scheduled.length,
    deferredCount: deferred.length,
    cap,
    droppedByCap,
  });

  const messagesConfig = getMessagesConfig(db);

  if (dryRun) {
    const preview = scheduled.map(({ item, sendAt }) => ({
      person: item.person,
      belated: item.belated,
      sendAt,
      text: renderMessage(item.person, item.belated, messagesConfig),
    }));
    onProgress({ phase: "dry_run_complete", preview });
    return { scheduled: preview, deferred, results: [], summary: null, cap, droppedByCap };
  }

  const runId = startRun(db, { dryRun: false });
  const results = [];
  let consecutiveFailures = 0;
  let cancelled = false;

  for (const { item, sendAt } of scheduled) {
    if (signal?.aborted) {
      cancelled = true;
      break;
    }
    const waitMs = sendAt.getTime() - Date.now();
    if (waitMs > 0) await abortableSleep(waitMs, signal);
    if (signal?.aborted) {
      cancelled = true;
      break;
    }

    const person = item.person;
    const text = renderMessage(person, item.belated, messagesConfig);
    const occurrence = ymdKey(item.occurrence);
    onProgress({ phase: "sending", person, belated: item.belated });

    try {
      const chatId = await resolveWhatsappId(waClient, person.phoneE164);
      if (!chatId) {
        recordSend(db, {
          runId,
          contactId: person.id,
          ledgerKey: item.ledgerKey,
          name: person.name,
          phone: person.phoneE164,
          occurrence,
          status: "not_on_whatsapp",
          belated: item.belated,
        });
        results.push({ person, belated: item.belated, status: "not_on_whatsapp" });
        consecutiveFailures = 0;
        onProgress({ phase: "not_on_whatsapp", person });
        continue;
      }

      await sendOnce(waClient, chatId, text, settings.pacing.typingMsPerChar, settings.retry, signal);
      recordSend(db, {
        runId,
        contactId: person.id,
        ledgerKey: item.ledgerKey,
        name: person.name,
        phone: person.phoneE164,
        occurrence,
        status: "sent",
        belated: item.belated,
      });
      results.push({ person, belated: item.belated, status: "sent" });
      consecutiveFailures = 0;
      onProgress({ phase: "sent", person });
    } catch (err) {
      recordSend(db, {
        runId,
        contactId: person.id,
        ledgerKey: item.ledgerKey,
        name: person.name,
        phone: person.phoneE164,
        occurrence,
        status: "failed",
        error: err.message,
        belated: item.belated,
      });
      results.push({ person, belated: item.belated, status: "failed", reason: err.message });
      consecutiveFailures++;
      onProgress({ phase: "send_failed", person, error: err.message, consecutiveFailures });
      if (consecutiveFailures >= settings.retry.maxConsecutiveFailures) {
        onProgress({ phase: "aborted_consecutive_failures", consecutiveFailures });
        break;
      }
    }
  }

  const runEnd = new Date();
  const summary = buildSummary(results, runStart, runEnd, settings.timezone);
  endRun(db, runId, {
    status: cancelled ? "cancelled" : "completed",
    summary: {
      sent: summary.sent.length,
      failed: summary.failed.length,
      notOnWhatsapp: summary.notOnWhatsapp.length,
    },
  });
  onProgress({ phase: cancelled ? "cancelled" : "complete", summary: summary.text });

  if (settings.selfNotifyEnabled && settings.selfNotifyNumber && waClient) {
    try {
      const chatId = await resolveWhatsappId(waClient, settings.selfNotifyNumber);
      if (chatId) await waClient.sendMessage(chatId, summary.text);
    } catch (err) {
      onProgress({ phase: "self_notify_failed", error: err.message });
    }
  }

  return { scheduled, deferred, results, summary, cap, droppedByCap, cancelled };
}

async function sendOnce(waClient, chatId, text, typingRange, retryConfig, signal) {
  try {
    await sendWithTyping(waClient, chatId, text, typingRange);
  } catch (err) {
    if (signal?.aborted) throw err;
    const [lo, hi] = retryConfig.retryBackoffSeconds;
    const backoffMs = (Math.floor(Math.random() * (hi - lo + 1)) + lo) * 1000;
    await abortableSleep(backoffMs, signal);
    if (signal?.aborted) throw err;
    await sendWithTyping(waClient, chatId, text, typingRange); // a second failure propagates
  }
}
