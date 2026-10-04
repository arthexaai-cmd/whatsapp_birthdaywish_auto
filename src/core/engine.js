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

import { matchBirthdays, dedupeAgainstLedger, todayInTz } from "./birthdays.js";
import { renderMessage, namePostfixFrom } from "./messages.js";
import { batchMatches, buildSchedule, effectiveDailyCap, isQuietNow } from "./pacing.js";
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
export function hasPendingMatches({ db, settings, dateOverride = null, ignoreLedger = false, approved = null }) {
  return findDueMatches({ db, settings, dateOverride, ignoreLedger, approved }).matches.length > 0;
}

/**
 * Who is due a message right now: non-skipped contacts whose birthday is
 * today or inside the catch-up window, minus anyone already terminal in the
 * ledger. With `approved` (an object of ledgerKey -> text from a manual
 * review), narrowed to exactly the reviewed people -- so someone added or
 * edited after the review is never swept into that send.
 */
function findDueMatches({ db, settings, dateOverride = null, ignoreLedger = false, approved = null }) {
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
  if (approved) matches = matches.filter((m) => Object.hasOwn(approved, m.ledgerKey));
  return { allContacts, today, matches };
}

/**
 * Today's review list for manual mode: everyone due, each with the exact
 * text a Send would use (pass the returned ledgerKey -> text pairs back to
 * runEngine as `approved`, and that text is what goes out -- templates are
 * randomized per render, so re-rendering at send time would not match what
 * the person reviewed). Also reports how many the daily cap would push to a
 * later run, and who was already sent to today.
 */
export function previewToday({ db, settings, dateOverride = null, ignoreLedger = false }) {
  const { allContacts, today, matches } = findDueMatches({ db, settings, dateOverride, ignoreLedger });
  const messagesConfig = getMessagesConfig(db);
  const due = matches.map((m) => ({
    ledgerKey: m.ledgerKey,
    contactId: m.person.id,
    name: m.person.name,
    phone: m.person.phoneE164,
    belated: m.belated,
    occurrence: ymdKey(m.occurrence),
    text: renderMessage(m.person, m.belated, messagesConfig, Math.random, namePostfixFrom(settings)),
  }));

  // Already handled today: today's matches that the ledger marks terminal.
  const terminalKeys = loadTerminalLedgerKeys(db);
  const alreadySentToday = matchBirthdays(allContacts, today, { catchupDays: 0, leapDayFallback: settings.leapDayFallback })
    .filter((m) => terminalKeys.has(m.ledgerKey))
    .map((m) => ({ ledgerKey: m.ledgerKey, name: m.person.name, phone: m.person.phoneE164 }));

  const cap = effectiveDailyCap(settings.pacing, countDistinctRunDays(db));
  return { today: ymdKey(today), due, cap, overCap: Math.max(0, due.length - cap), alreadySentToday };
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
 * @param {boolean} [opts.applyStartJitter] whether to add the random startJitterMinutes delay
 *   before the first send. Default true -- this exists so the *automatic* daily trigger
 *   doesn't fire at a suspiciously exact time every day. A manually-triggered run (someone
 *   clicking "Run now") already has human-introduced timing randomness, so callers pass
 *   false there; skipping it also avoids the confusing "nothing happens for a while
 *   with no explanation" experience on a manual test run.
 * @param {Record<string,string>|null} [opts.approved] manual-mode review result from
 *   previewToday: ledgerKey -> exact text. When given, only these people are sent to,
 *   with exactly this text.
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
  applyStartJitter = true,
  approved = null,
  onProgress = () => {},
}) {
  const runStart = new Date();
  const messagesConfig = getMessagesConfig(db);
  if (!dryRun && !waClient) {
    throw new Error("runEngine: a connected waClient is required for a real (non-dry-run) run.");
  }

  const { allContacts, matches } = findDueMatches({ db, settings, dateOverride, ignoreLedger, approved });
  onProgress({ phase: "loaded", contactCount: allContacts.length });
  onProgress({ phase: "matched", matchCount: matches.length });
  // Reviewed text (manual mode) wins over a fresh random render.
  const textFor = (person, belated, ledgerKey) =>
    approved && typeof approved[ledgerKey] === "string" ? approved[ledgerKey] : renderMessage(person, belated, messagesConfig, Math.random, namePostfixFrom(settings));

  if (matches.length === 0) {
    return { scheduled: [], deferred: [], results: [], summary: null, cap: 0, droppedByCap: 0 };
  }

  const ledgerDays = countDistinctRunDays(db);
  const { batches, cap, droppedByCap } = batchMatches(matches, settings.pacing, ledgerDays);
  const pacingForRun = applyStartJitter ? settings.pacing : { ...settings.pacing, startJitterMinutes: [0, 0] };
  const { scheduled, deferred } = buildSchedule(batches, pacingForRun, runStart, settings.timezone);
  onProgress({
    phase: "scheduled",
    scheduledCount: scheduled.length,
    deferredCount: deferred.length,
    cap,
    droppedByCap,
    firstSendAt: scheduled[0]?.sendAt ?? null,
  });

  if (dryRun) {
    const preview = scheduled.map(({ item, sendAt }) => ({
      person: item.person,
      belated: item.belated,
      sendAt,
      text: textFor(item.person, item.belated, item.ledgerKey),
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

    // The schedule was planned up front. If the computer slept or the run
    // dragged on, "now" can be inside quiet hours even though the planned
    // time wasn't: stop here and leave everyone left for the next run.
    if (isQuietNow(new Date(), settings.timezone, settings.pacing.quietHours)) {
      onProgress({ phase: "deferred_quiet_hours" });
      break;
    }

    const person = item.person;
    const text = textFor(person, item.belated, item.ledgerKey);
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
      // A send failure is very often whatsapp-web.js's injected browser-side
      // code hitting a WhatsApp Web internal change (a minified
      // "Evaluation failed: <x>" from Puppeteer's page.evaluate) -- .message
      // alone can be as unhelpful as a single letter. Log the full error
      // (stack included) to the console so it's actually diagnosable; the
      // ledger/UI keep just the message for conciseness.
      console.error(`[engine] send failed for ${person.name} (${person.phoneE164}):`, err);
      const message = err.message || String(err);
      recordSend(db, {
        runId,
        contactId: person.id,
        ledgerKey: item.ledgerKey,
        name: person.name,
        phone: person.phoneE164,
        occurrence,
        status: "failed",
        error: message,
        belated: item.belated,
      });
      results.push({ person, belated: item.belated, status: "failed", reason: message });
      consecutiveFailures++;
      onProgress({ phase: "send_failed", person, error: message, consecutiveFailures });
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
