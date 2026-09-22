import { describe, it, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { migrate, startRun, endRun } from "../src/core/db.js";
import { computeTodayFireDate, computeNextFireDate, hasRunToday } from "../src/core/schedule.js";

function freshDb() {
  const db = new DatabaseSync(":memory:");
  migrate(db);
  return db;
}

describe("computeTodayFireDate", () => {
  it("computes the correct UTC instant for a fixed-offset timezone (IST, UTC+5:30)", () => {
    const settings = { scheduledTime: "09:15", timezone: "Asia/Kolkata" };
    const now = new Date("2026-03-14T02:00:00Z"); // 07:30 IST
    const fire = computeTodayFireDate(settings, now);
    // 09:15 IST == 03:45 UTC
    expect(fire.toISOString()).toBe("2026-03-14T03:45:00.000Z");
  });

  it("computes correctly for a DST-observing timezone before a spring-forward transition", () => {
    // America/New_York: DST starts 2026-03-08. Before that, EST = UTC-5.
    // Use a `now` safely inside March 1 local time (07:00 EST) to avoid
    // crossing the UTC/local midnight boundary.
    const settings = { scheduledTime: "09:00", timezone: "America/New_York" };
    const now = new Date("2026-03-01T12:00:00Z"); // 07:00 EST, still March 1 locally
    const fire = computeTodayFireDate(settings, now);
    expect(fire.toISOString()).toBe("2026-03-01T14:00:00.000Z"); // 09:00 EST = 14:00 UTC
  });

  it("computes correctly for a DST-observing timezone after a spring-forward transition", () => {
    // After March 8 2026, EDT = UTC-4.
    const settings = { scheduledTime: "09:00", timezone: "America/New_York" };
    const now = new Date("2026-03-15T12:00:00Z"); // 08:00 EDT, still March 15 locally
    const fire = computeTodayFireDate(settings, now);
    expect(fire.toISOString()).toBe("2026-03-15T13:00:00.000Z"); // 09:00 EDT = 13:00 UTC
  });
});

describe("computeNextFireDate", () => {
  it("returns today's fire time if it has not passed yet", () => {
    const settings = { scheduledTime: "09:15", timezone: "Asia/Kolkata" };
    const now = new Date("2026-03-14T02:00:00Z"); // 07:30 IST, before 09:15
    const next = computeNextFireDate(settings, now);
    expect(next.toISOString()).toBe("2026-03-14T03:45:00.000Z");
  });

  it("rolls to tomorrow if today's time already passed", () => {
    const settings = { scheduledTime: "09:15", timezone: "Asia/Kolkata" };
    const now = new Date("2026-03-14T05:00:00Z"); // 10:30 IST, after 09:15
    const next = computeNextFireDate(settings, now);
    expect(next.toISOString()).toBe("2026-03-15T03:45:00.000Z");
  });

  it("rolls correctly across a DST spring-forward boundary", () => {
    const settings = { scheduledTime: "09:00", timezone: "America/New_York" };
    // March 7 2026, 23:00 UTC = 18:00 EST -- already past 09:00 today.
    const now = new Date("2026-03-08T00:00:00Z");
    const next = computeNextFireDate(settings, now);
    // Tomorrow (March 8) is the DST transition day; 09:00 EDT = 13:00 UTC.
    expect(next.toISOString()).toBe("2026-03-08T13:00:00.000Z");
  });

  it("is always strictly in the future relative to now", () => {
    const settings = { scheduledTime: "00:01", timezone: "UTC" };
    const now = new Date("2026-01-01T00:00:30Z");
    const next = computeNextFireDate(settings, now);
    expect(next.getTime()).toBeGreaterThan(now.getTime());
  });
});

describe("hasRunToday", () => {
  it("is false with no runs", () => {
    const db = freshDb();
    expect(hasRunToday(db, "UTC")).toBe(false);
  });

  it("is true after a completed run today, false for a run marked failed-only status excluded", () => {
    const db = freshDb();
    const runId = startRun(db, { dryRun: false });
    endRun(db, runId, { status: "completed", summary: {} });
    expect(hasRunToday(db, "UTC")).toBe(true);
  });

  it("counts a cancelled run as satisfying today's check too", () => {
    const db = freshDb();
    const runId = startRun(db, { dryRun: false });
    endRun(db, runId, { status: "cancelled", summary: {} });
    expect(hasRunToday(db, "UTC")).toBe(true);
  });

  it("ignores a still-running (crashed/unfinished) run", () => {
    const db = freshDb();
    startRun(db, { dryRun: false }); // never ended -> stays 'running'
    expect(hasRunToday(db, "UTC")).toBe(false);
  });
});
