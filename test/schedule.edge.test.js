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

describe("fire time lands on the right DAY (regression: evening IST fired a day late)", () => {
  const at = (tz, time, nowIso) => computeTodayFireDate({ scheduledTime: time, timezone: tz }, new Date(nowIso)).toISOString();

  it("IST evening times are today, not tomorrow", () => {
    const now = "2026-09-29T16:37:00Z"; // 22:07 IST, 29 Sep
    expect(at("Asia/Kolkata", "22:09", now)).toBe("2026-09-29T16:39:00.000Z");
    expect(at("Asia/Kolkata", "18:45", now)).toBe("2026-09-29T13:15:00.000Z");
    expect(at("Asia/Kolkata", "23:59", now)).toBe("2026-09-29T18:29:00.000Z");
    expect(at("Asia/Kolkata", "00:00", now)).toBe("2026-09-28T18:30:00.000Z");
  });
  it("US early-morning times are today (were landing in the past)", () => {
    const now = "2026-09-29T15:00:00Z"; // 11:00 EDT, 29 Sep
    expect(at("America/New_York", "01:00", now)).toBe("2026-09-29T05:00:00.000Z");
    expect(at("America/New_York", "09:15", now)).toBe("2026-09-29T13:15:00.000Z");
    expect(at("America/Los_Angeles", "00:30", now)).toBe("2026-09-29T07:30:00.000Z");
  });
  it("far-ahead zones (UTC+13/+14) and far-behind zones (UTC-10) work", () => {
    expect(at("Pacific/Kiritimati", "00:10", "2026-09-29T12:00:00Z")).toBe("2026-09-29T10:10:00.000Z"); // 02:00 on 30 Sep local? now is 02:00 Sep30 there
    expect(at("Pacific/Honolulu", "23:30", "2026-09-29T12:00:00Z")).toBe("2026-09-30T09:30:00.000Z");
  });

  const settings = { sendMode: "auto", scheduledTime: "22:09", timezone: "Asia/Kolkata", schedulingPaused: false };
  it("computeNextFireDate for an evening IST time is later today, and the tick fires on time", () => {
    const now = new Date("2026-09-29T16:37:00Z");
    const next = computeNextFireDate(settings, now);
    expect(next.toISOString()).toBe("2026-09-29T16:39:00.000Z");
    expect(evaluateSchedulerTick(next, settings, new Date("2026-09-29T16:38:59Z")).fire).toBe(false);
    const r = evaluateSchedulerTick(next, settings, new Date("2026-09-29T16:39:00Z"));
    expect(r.fire).toBe(true);
    expect(r.nextFireAt.toISOString()).toBe("2026-09-30T16:39:00.000Z");
  });

  it("never fires repeatedly: after a fire the next time is always strictly in the future (every zone x time)", () => {
    const zones = ["Asia/Kolkata", "UTC", "America/New_York", "America/Los_Angeles", "Europe/London", "Australia/Sydney", "Pacific/Kiritimati", "Pacific/Honolulu", "Asia/Kathmandu"];
    const times = ["00:00", "00:30", "01:00", "05:59", "09:15", "12:00", "18:30", "18:31", "22:09", "23:59"];
    for (const tz of zones) {
      for (const time of times) {
        for (const nowIso of ["2026-03-08T07:30:00Z", "2026-09-29T00:10:00Z", "2026-09-29T16:37:00Z", "2026-11-01T06:30:00Z"]) {
          const now = new Date(nowIso);
          const next = computeNextFireDate({ scheduledTime: time, timezone: tz }, now);
          expect(next.getTime(), tz + " " + time + " " + nowIso).toBeGreaterThan(now.getTime());
          expect(next.getTime() - now.getTime(), tz + " " + time + " " + nowIso).toBeLessThanOrEqual(25 * 3600_000);
        }
      }
    }
  });
});
