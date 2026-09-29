import { describe, it, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { migrate, upsertContact, startRun, endRun, recordSend } from "../src/core/db.js";
import { buildProgressReport, buildUpcomingSchedule, buildReportWorkbook } from "../src/core/progress.js";
import { DEFAULT_SETTINGS } from "../src/core/defaults.js";

function freshDb() {
  const db = new DatabaseSync(":memory:");
  migrate(db);
  return db;
}

const settings = {
  ...DEFAULT_SETTINGS,
  timezone: "UTC",
  catchupDays: 2,
  scheduledTime: "09:15",
  pacing: { ...DEFAULT_SETTINGS.pacing, dailyCap: 60, warmupDays: 0 },
};

function contact(db, name, phone, month, day, extra = {}) {
  return upsertContact(db, { name, phoneE164: phone, birthMonth: month, birthDay: day, ...extra }).id;
}

// 2025-12-30 10:00 UTC -- late in the year, so Jan birthdays wrap to 2026.
const NOW = new Date("2025-12-30T10:00:00Z");

describe("buildUpcomingSchedule", () => {
  it("orders by send date across the year boundary and respects the horizon", () => {
    const db = freshDb();
    contact(db, "Jan", "+911111111111", 1, 3);
    contact(db, "Dec", "+912222222222", 12, 31);
    contact(db, "Jun", "+913333333333", 6, 1);
    const { rows } = buildUpcomingSchedule(db, settings, { days: 30, now: NOW });
    expect(rows.map((r) => [r.name, r.sendDate])).toEqual([
      ["Dec", "2025-12-31"],
      ["Jan", "2026-01-03"],
    ]);
    expect(rows.every((r) => r.status === "scheduled")).toBe(true);
  });

  it("applies the Feb 29 fallback in a non-leap year and computes age", () => {
    const db = freshDb();
    contact(db, "Leap", "+914444444444", 2, 29, { birthYear: 2000 });
    const { rows } = buildUpcomingSchedule(db, { ...settings, leapDayFallback: "mar1" }, { days: 365, now: NOW });
    expect(rows[0].sendDate).toBe("2026-03-01");
    expect(rows[0].turning).toBe(26);
  });

  it("lists skipped contacts separately, never in the schedule", () => {
    const db = freshDb();
    contact(db, "Skip", "+915555555555", 12, 31, { skip: true });
    const { rows, skipped } = buildUpcomingSchedule(db, settings, { days: 30, now: NOW });
    expect(rows).toHaveLength(0);
    expect(skipped.map((s) => s.name)).toEqual(["Skip"]);
  });

  it("shows today's already-sent birthday as sent, and a missed one as a catch-up", () => {
    const db = freshDb();
    const todayId = contact(db, "Today", "+916666666666", 12, 30);
    contact(db, "Yesterday", "+917777777777", 12, 29);
    const runId = startRun(db);
    recordSend(db, {
      runId,
      contactId: todayId,
      ledgerKey: "+916666666666:2025-12-30",
      name: "Today",
      phone: "+916666666666",
      occurrence: "2025-12-30",
      status: "sent",
    });
    endRun(db, runId, { status: "completed", summary: {} });
    // The run above started "now" (real clock), not on NOW's date, so
    // hasRunToday is false for NOW and the next run is today.
    const { rows } = buildUpcomingSchedule(db, settings, { days: 30, now: NOW });
    const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
    expect(byName.Today.status).toBe("sent");
    expect(byName.Yesterday).toMatchObject({ status: "catch_up", sendDate: "2025-12-30", belated: true });
  });

  it("marks a failed send inside the catch-up window as pending retry", () => {
    const db = freshDb();
    const id = contact(db, "Flaky", "+918888888888", 12, 29);
    const runId = startRun(db);
    recordSend(db, {
      runId,
      contactId: id,
      ledgerKey: "+918888888888:2025-12-29",
      name: "Flaky",
      phone: "+918888888888",
      occurrence: "2025-12-29",
      status: "failed",
      error: "boom",
    });
    const { rows } = buildUpcomingSchedule(db, settings, { days: 30, now: NOW });
    expect(rows[0]).toMatchObject({ name: "Flaky", status: "pending_retry", sendDate: "2025-12-30" });
  });

  it("flags days with more due sends than the daily cap", () => {
    const db = freshDb();
    contact(db, "A", "+919000000001", 1, 5);
    contact(db, "B", "+919000000002", 1, 5);
    contact(db, "C", "+919000000003", 1, 6);
    const tight = { ...settings, pacing: { ...settings.pacing, dailyCap: 1 } };
    const { rows, meta } = buildUpcomingSchedule(db, tight, { days: 30, now: NOW });
    expect(meta.overCapDays).toEqual(["2026-01-05"]);
    expect(rows.filter((r) => r.overCap).map((r) => r.name)).toEqual(["A", "B"]);
  });
});

describe("buildProgressReport", () => {
  it("totals the ledger", () => {
    const db = freshDb();
    const runId = startRun(db);
    const base = { runId, name: "X", occurrence: "2025-01-01" };
    recordSend(db, { ...base, ledgerKey: "a", phone: "+1", status: "sent" });
    recordSend(db, { ...base, ledgerKey: "b", phone: "+2", status: "sent", belated: true });
    recordSend(db, { ...base, ledgerKey: "c", phone: "+3", status: "failed", error: "x" });
    recordSend(db, { ...base, ledgerKey: "d", phone: "+4", status: "not_on_whatsapp" });
    endRun(db, runId, { status: "completed", summary: {} });
    const { totals, sends } = buildProgressReport(db);
    expect(totals).toMatchObject({ sent: 2, belatedSent: 1, failed: 1, notOnWhatsapp: 1, runsCompleted: 1 });
    expect(sends).toHaveLength(4);
  });
});

describe("buildReportWorkbook", () => {
  it("has the four sheets with header rows", () => {
    const db = freshDb();
    contact(db, "Dec", "+912222222222", 12, 31);
    const wb = buildReportWorkbook({
      progress: buildProgressReport(db),
      upcoming: buildUpcomingSchedule(db, settings, { days: 30, now: NOW }),
      generatedAt: NOW,
    });
    expect(wb.SheetNames).toEqual(["Summary", "Sent history", "Upcoming schedule", "Skipped contacts"]);
    expect(wb.Sheets["Upcoming schedule"].A1.v).toBe("Send date");
    expect(wb.Sheets["Upcoming schedule"].C2.v).toBe("Dec");
    expect(wb.Sheets["Sent history"].A1.v).toBe("Sent at");
  });
});

describe("sending mode in the report", () => {
  it("defaults to manual and reflects automatic", () => {
    const db = freshDb();
    expect(buildUpcomingSchedule(db, { ...settings, sendMode: undefined }, { now: NOW }).meta.sendMode).toBe("manual");
    expect(buildUpcomingSchedule(db, { ...settings, sendMode: "auto" }, { now: NOW }).meta.sendMode).toBe("auto");
  });
});
