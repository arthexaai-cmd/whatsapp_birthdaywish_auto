import { describe, it, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { migrate, startRun, endRun } from "../src/core/db.js";
import {
  computeTodayFireDate,
  computeNextFireDate,
  evaluateSchedulerTick,
  scheduledAction,
  hasRunToday,
} from "../src/core/schedule.js";

const NY = { scheduledTime: "09:15", timezone: "America/New_York" };

describe("DST transitions (America/New_York)", () => {
  it("fires at 09:15 local on the spring-forward day (EDT, UTC-4)", () => {
    const fire = computeTodayFireDate(NY, new Date("2026-03-08T14:00:00Z")); // 10:00 EDT
    expect(fire.toISOString()).toBe("2026-03-08T13:15:00.000Z");
  });
  it("fires at 09:15 local on the fall-back day (EST, UTC-5)", () => {
    const fire = computeTodayFireDate(NY, new Date("2026-11-01T15:00:00Z"));
    expect(fire.toISOString()).toBe("2026-11-01T14:15:00.000Z");
  });
  it("next fire across spring-forward is still 09:15 local", () => {
    const now = new Date("2026-03-07T20:00:00Z"); // after Mar 7 fire
    const next = computeNextFireDate(NY, now);
    expect(next.toISOString()).toBe("2026-03-08T13:15:00.000Z");
  });
  it("00:00 fires at local midnight", () => {
    const fire = computeTodayFireDate({ scheduledTime: "00:00", timezone: "Asia/Kolkata" }, new Date("2026-05-10T10:00:00Z"));
    expect(fire.toISOString()).toBe("2026-05-09T18:30:00.000Z");
  });
});

describe("evaluateSchedulerTick — clock jumps", () => {
  const settings = { sendMode: "auto", scheduledTime: "09:15", timezone: "UTC", schedulingPaused: false };
  const armed = new Date("2026-05-10T09:15:00Z");

  it("clock jumps forward past the fire time: fires once and re-arms for tomorrow", () => {
    const r = evaluateSchedulerTick(armed, settings, new Date("2026-05-10T15:00:00Z"));
    expect(r.fire).toBe(true);
    expect(r.nextFireAt.toISOString()).toBe("2026-05-11T09:15:00.000Z");
  });
  it("clock jumps back by days: re-derives instead of waiting", () => {
    const r = evaluateSchedulerTick(armed, settings, new Date("2026-05-01T08:00:00Z"));
    expect(r.fire).toBe(false);
    expect(r.nextFireAt.toISOString()).toBe("2026-05-01T09:15:00.000Z");
  });
  it("does not fire early", () => {
    expect(evaluateSchedulerTick(armed, settings, new Date("2026-05-10T09:14:59Z")).fire).toBe(false);
  });
});

describe("scheduledAction — every combination", () => {
  const cases = [
    [{ sendMode: "auto" }, "send"],
    [{ sendMode: "auto", reminderEnabled: false }, "send"],
    [{ sendMode: "manual" }, "remind"],
    [{ sendMode: "manual", reminderEnabled: true }, "remind"],
    [{ sendMode: "manual", reminderEnabled: false }, "none"],
    [{ sendMode: "auto", schedulingPaused: true }, "none"],
    [{ sendMode: "manual", schedulingPaused: true }, "none"],
    [{}, "remind"], // unknown mode falls back to manual
  ];
  for (const [s, want] of cases) {
    it(`${JSON.stringify(s)} -> ${want}`, () => expect(scheduledAction(s)).toBe(want));
  }
});

// The scheduler calls these every 30 s and at launch; a throw there is a
// recurring unhandled error. Desired behavior: never throw.
describe("robustness against bad settings (F5, F6)", () => {
  it("F5: invalid timezone does not throw", () => {
    expect(() => computeNextFireDate({ scheduledTime: "09:15", timezone: "Asia/Kolkatta" })).not.toThrow();
  });
  it("F6: empty scheduledTime yields a valid Date or null, never Invalid Date", () => {
    let r;
    try {
      r = computeNextFireDate({ scheduledTime: "", timezone: "UTC" });
    } catch {
      r = null;
    }
    expect(r === null || !isNaN(r.getTime())).toBe(true);
  });
});

describe("hasRunToday near midnight (F13)", () => {
  it("F13: a run started 00:30 IST today (still yesterday in UTC) counts as today", () => {
    const db = new DatabaseSync(":memory:");
    migrate(db);
    const id = startRun(db, { dryRun: false });
    endRun(db, id, { status: "completed", summary: {} });
    db.prepare("UPDATE runs SET started_at = ? WHERE id = ?").run("2026-05-09T19:00:00.000Z", id); // 00:30 IST May 10
    expect(hasRunToday(db, "Asia/Kolkata", new Date("2026-05-10T04:00:00Z"))).toBe(true);
  });
});
