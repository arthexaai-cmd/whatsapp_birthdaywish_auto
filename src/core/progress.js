// Progress & upcoming-schedule report: what has been sent so far, and who is
// due a message on which day going forward. Backs both the Reports tab and
// its Excel export, so the two can never disagree.
//
// Pure with respect to Electron (takes an open node:sqlite db, like the rest
// of src/core/). The upcoming schedule deliberately reuses the engine's own
// building blocks -- matchBirthdays() for the catch-up window,
// birthdayOccurrence() for Feb 29, the ledger for "already sent" -- rather
// than reimplementing the selection rules, so it predicts what a run would
// actually do. It can only predict the *day*, though: the exact minute is
// randomized per run by pacing.js, so rows carry the scheduled start time
// ("from 09:15"), not a send time.

import XLSX from "xlsx";
import fs from "node:fs";
import { matchBirthdays, birthdayOccurrence, addDays, ymdToKey, todayInTz } from "./birthdays.js";
import { effectiveDailyCap } from "./pacing.js";

import { hasRunToday } from "./schedule.js";
import { listContacts, listAllSendsWithRuns, sendStatusByLedgerKey, countDistinctRunDays, listRuns } from "./db.js";

XLSX.set_fs(fs); // SheetJS 0.20's ESM build needs fs for writeFile (see xlsx.js)

export const STATUS_LABELS = {
  sent: "Sent",
  failed: "Failed",
  not_on_whatsapp: "Not on WhatsApp",
  scheduled: "Scheduled",
  catch_up: "Scheduled (belated catch-up)",
  pending_retry: "Pending retry",
  skipped: "Skipped",
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysBetween(a, b) {
  return Math.round((Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / MS_PER_DAY);
}

function formatBirthday(c) {
  const dm = `${String(c.birthDay).padStart(2, "0")}/${String(c.birthMonth).padStart(2, "0")}`;
  return c.birthYear ? `${dm}/${c.birthYear}` : dm;
}

/** "YYYY-MM-DD HH:MM" in the given timezone, for ISO timestamps from the DB. */
export function formatLocalDateTime(iso, tz) {
  if (!iso) return "";
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .formatToParts(new Date(iso))
      .map((p) => [p.type, p.value])
  );
  // Some ICU versions render midnight as "24" with hour12:false.
  const hour = parts.hour === "24" ? "00" : parts.hour;
  return `${parts.year}-${parts.month}-${parts.day} ${hour}:${parts.minute}`;
}

/** Everything recorded in the ledger so far, plus headline totals. */
export function buildProgressReport(db) {
  const sends = listAllSendsWithRuns(db).map((s) => ({
    id: s.id,
    runId: s.run_id,
    name: s.name,
    phone: s.phone,
    occurrence: s.occurrence,
    status: s.status,
    belated: !!s.belated,
    error: s.error,
    sentAt: s.sent_at,
  }));
  const runs = listRuns(db, 1_000_000).filter((r) => !r.dry_run);
  const contacts = listContacts(db);

  const count = (pred) => sends.filter(pred).length;
  const totals = {
    sent: count((s) => s.status === "sent"),
    failed: count((s) => s.status === "failed"),
    notOnWhatsapp: count((s) => s.status === "not_on_whatsapp"),
    belatedSent: count((s) => s.status === "sent" && s.belated),
    runsCompleted: runs.filter((r) => r.status === "completed").length,
    runsCancelled: runs.filter((r) => r.status === "cancelled").length,
    contacts: contacts.length,
    skippedContacts: contacts.filter((c) => c.skip).length,
    firstSendAt: sends.length ? sends[sends.length - 1].sentAt : null,
    lastSendAt: sends.length ? sends[0].sentAt : null,
  };
  return { totals, sends };
}

/**
 * Who gets a message on which day, from the next run through `days` days
 * ahead. One row per non-skipped contact (their next due occurrence), plus
 * today's already-handled birthdays so "today" reads complete.
 *
 * @returns {{ rows: Array, skipped: Array, meta: object }}
 */
export function buildUpcomingSchedule(db, settings, { days = 365, now = new Date(), dateOverride = null } = {}) {
  const tz = settings.timezone;
  const today = todayInTz(tz, dateOverride, now);
  const todayKey = ymdToKey(today);
  const horizonKey = ymdToKey(addDays(today, days));
  const statusByKey = sendStatusByLedgerKey(db);
  const contacts = listContacts(db);

  // A birthday still owed (today's, or one inside the catch-up window) goes
  // out at the next run: today's if it hasn't happened yet, else tomorrow's.
  const nextRunDay = hasRunToday(db, tz, now) ? addDays(today, 1) : today;

  const rows = [];
  for (const c of contacts.filter((c) => !c.skip)) {
    const base = {
      contactId: c.id,
      name: c.name,
      phone: c.phoneE164,
      birthday: formatBirthday(c),
      customMessage: c.customMessage || "",
    };
    const turning = (occ) => (c.birthYear ? occ.year - c.birthYear : null);

    const [recent] = matchBirthdays([c], today, {
      catchupDays: settings.catchupDays,
      leapDayFallback: settings.leapDayFallback,
    });
    if (recent) {
      const recorded = statusByKey.get(recent.ledgerKey);
      const occKey = ymdToKey(recent.occurrence);
      if (recorded === "sent" || recorded === "not_on_whatsapp") {
        // Today's birthday already handled: show it so today's list is
        // complete. A belated one already handled is simply done -- fall
        // through to next year's occurrence.
        if (occKey === todayKey) {
          rows.push({
            ...base,
            occurrence: occKey,
            sendDate: todayKey,
            turning: turning(recent.occurrence),
            belated: false,
            status: recorded,
          });
          continue;
        }
      } else if (daysBetween(recent.occurrence, nextRunDay) <= settings.catchupDays) {
        rows.push({
          ...base,
          occurrence: occKey,
          sendDate: ymdToKey(nextRunDay),
          turning: turning(recent.occurrence),
          belated: ymdToKey(nextRunDay) !== occKey,
          status: recorded === "failed" ? "pending_retry" : ymdToKey(nextRunDay) !== occKey ? "catch_up" : "scheduled",
        });
        continue;
      }
    }

    // Next occurrence strictly after today (this year's, else next year's).
    let next = birthdayOccurrence(c, today.year, settings.leapDayFallback);
    if (ymdToKey(next) <= todayKey) next = birthdayOccurrence(c, today.year + 1, settings.leapDayFallback);
    const nextKey = ymdToKey(next);
    if (nextKey > horizonKey) continue;
    rows.push({
      ...base,
      occurrence: nextKey,
      sendDate: nextKey,
      turning: turning(next),
      belated: false,
      status: "scheduled",
    });
  }

  rows.sort((a, b) => a.sendDate.localeCompare(b.sendDate) || a.name.localeCompare(b.name));

  // Flag days with more due sends than the daily cap allows -- the overflow
  // spills into later runs as belated catch-ups, or is dropped once it falls
  // out of the catch-up window. Uses today's effective cap (warm-up included)
  // as a conservative estimate for every day.
  const dailyCap = effectiveDailyCap(settings.pacing, countDistinctRunDays(db));
  const dueByDay = new Map();
  for (const r of rows) {
    if (r.status === "sent" || r.status === "not_on_whatsapp") continue;
    dueByDay.set(r.sendDate, (dueByDay.get(r.sendDate) || 0) + 1);
  }
  for (const r of rows) r.overCap = (dueByDay.get(r.sendDate) || 0) > dailyCap;

  const skipped = contacts
    .filter((c) => c.skip)
    .map((c) => ({ contactId: c.id, name: c.name, phone: c.phoneE164, birthday: formatBirthday(c), status: "skipped" }));

  return {
    rows,
    skipped,
    meta: {
      today: todayKey,
      days,
      timezone: tz,
      scheduledTime: settings.scheduledTime,
      paused: !!settings.schedulingPaused,
      sendMode: settings.sendMode === "auto" ? "auto" : "manual",
      dailyCap,
      overCapDays: [...dueByDay.entries()].filter(([, n]) => n > dailyCap).map(([d]) => d),
    },
  };
}

/**
 * Names, messages and errors come from users and imported files. Excel
 * treats a cell starting with = + - @ (or a tab/CR) as a formula once the
 * cell is edited or the file is re-saved -- a classic CSV/XLSX injection. Prefix
 * those with an apostrophe so they stay text. Plain phone numbers and numbers
 * ("+919812345678", "-5") are left alone.
 */
export function safeCell(v) {
  if (typeof v !== "string" || v === "") return v;
  if (/^[+-]?[\d\s()-]+$/.test(v)) return v;
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}

function sheet(aoa, widths) {
  const ws = XLSX.utils.aoa_to_sheet(aoa.map((row) => row.map(safeCell)));
  ws["!cols"] = widths.map((wch) => ({ wch }));
  return ws;
}

/** Build the export workbook: Summary, Sent history, Upcoming schedule, Skipped contacts. */
export function buildReportWorkbook({ progress, upcoming, generatedAt = new Date() }) {
  const tz = upcoming.meta.timezone;
  const { totals } = progress;
  const wb = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    wb,
    sheet(
      [
        ["Birthday Bot report"],
        ["Generated", formatLocalDateTime(generatedAt.toISOString(), tz)],
        ["Timezone", tz],
        [],
        ["Progress so far"],
        ["Messages sent", totals.sent],
        ["  of which belated", totals.belatedSent],
        ["Failed", totals.failed],
        ["Not on WhatsApp", totals.notOnWhatsapp],
        ["Runs completed", totals.runsCompleted],
        ["Runs cancelled", totals.runsCancelled],
        ["First send", formatLocalDateTime(totals.firstSendAt, tz)],
        ["Last send", formatLocalDateTime(totals.lastSendAt, tz)],
        ["Contacts", totals.contacts],
        ["Skipped contacts", totals.skippedContacts],
        [],
        ["Upcoming schedule"],
        ["Covers", `${upcoming.meta.today} + ${upcoming.meta.days} days`],
        ["Sending mode", upcoming.meta.sendMode === "auto" ? `Automatic, daily from ${upcoming.meta.scheduledTime}` : "Manual (sent from the Dashboard)"],
        ["Scheduling / reminders", upcoming.meta.paused ? "PAUSED" : "On"],
        ["Messages due", upcoming.rows.filter((r) => r.status !== "sent" && r.status !== "not_on_whatsapp").length],
        ["Current daily cap", upcoming.meta.dailyCap],
        ["Days over the cap", upcoming.meta.overCapDays.join(", ") || "None"],
      ],
      [24, 40]
    ),
    "Summary"
  );

  XLSX.utils.book_append_sheet(
    wb,
    sheet(
      [
        ["Sent at", "Name", "Phone", "Birthday occurrence", "Status", "Belated", "Error"],
        ...progress.sends.map((s) => [
          formatLocalDateTime(s.sentAt, tz),
          s.name,
          s.phone,
          s.occurrence,
          STATUS_LABELS[s.status] || s.status,
          s.belated ? "Yes" : "",
          s.error || "",
        ]),
      ],
      [18, 24, 18, 18, 18, 8, 50]
    ),
    "Sent history"
  );

  XLSX.utils.book_append_sheet(
    wb,
    sheet(
      [
        ["Send date", "Starts from", "Name", "Phone", "Birthday", "Turning", "Status", "Over daily cap", "Custom message"],
        ...upcoming.rows.map((r) => [
          r.sendDate,
          upcoming.meta.scheduledTime,
          r.name,
          r.phone,
          r.birthday,
          r.turning ?? "",
          STATUS_LABELS[r.status] || r.status,
          r.overCap ? "Yes" : "",
          r.customMessage,
        ]),
      ],
      [12, 11, 24, 18, 12, 8, 26, 14, 40]
    ),
    "Upcoming schedule"
  );

  XLSX.utils.book_append_sheet(
    wb,
    sheet(
      [["Name", "Phone", "Birthday"], ...upcoming.skipped.map((s) => [s.name, s.phone, s.birthday])],
      [24, 18, 12]
    ),
    "Skipped contacts"
  );

  return wb;
}

/** Write the report workbook to filePath as .xlsx. */
export function writeReportXlsx(filePath, report) {
  XLSX.writeFile(buildReportWorkbook(report), filePath, { bookType: "xlsx" });
}
