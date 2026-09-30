import { describe, it, expect } from "vitest";
import { createVirtualClock, isTestModeEnabled } from "../src/core/virtualClock.js";
import { computeNextFireDate, evaluateSchedulerTick } from "../src/core/schedule.js";

describe("isTestModeEnabled (the gate)", () => {
  it("is off by default and off with only one of the two switches", () => {
    expect(isTestModeEnabled({})).toBe(false);
    expect(isTestModeEnabled({ BIRTHDAY_BOT_TEST_CLOCK: "1" })).toBe(false);
    expect(isTestModeEnabled({ BIRTHDAY_BOT_USER_DATA: "D:\\scratch" })).toBe(false);
    expect(isTestModeEnabled({ BIRTHDAY_BOT_TEST_CLOCK: "true", BIRTHDAY_BOT_USER_DATA: "D:\\scratch" })).toBe(false);
  });
  it("is on only with both", () => {
    expect(isTestModeEnabled({ BIRTHDAY_BOT_TEST_CLOCK: "1", BIRTHDAY_BOT_USER_DATA: "D:\\scratch" })).toBe(true);
  });
});

describe("createVirtualClock", () => {
  it("with offset 0 behaves like the real Date", () => {
    const { VirtualDate } = createVirtualClock();
    const before = Date.now();
    const v = VirtualDate.now();
    expect(v).toBeGreaterThanOrEqual(before);
    expect(v - before).toBeLessThan(1000);
    expect(new VirtualDate() instanceof Date).toBe(true);
    expect(new VirtualDate() instanceof VirtualDate).toBe(true);
  });

  it("setNow makes new Date() and Date.now() report that time, and it keeps ticking", async () => {
    const c = createVirtualClock();
    c.setNow("2027-03-14T01:59:50Z");
    const a = new c.VirtualDate();
    expect(Math.abs(a.getTime() - Date.parse("2027-03-14T01:59:50Z"))).toBeLessThan(1000);
    await new Promise((r) => setTimeout(r, 60));
    expect(c.VirtualDate.now()).toBeGreaterThan(a.getTime());
  });

  it("advance moves time forward (and backward)", () => {
    const c = createVirtualClock();
    c.setNow("2026-10-01T00:00:00Z");
    c.advance(24 * 3600_000);
    expect(new c.VirtualDate().toISOString().slice(0, 10)).toBe("2026-10-02");
    c.advance(-2 * 24 * 3600_000);
    expect(new c.VirtualDate().toISOString().slice(0, 10)).toBe("2026-09-30");
  });

  it("dates built from arguments and the static helpers are untouched", () => {
    const c = createVirtualClock();
    c.setNow("2030-01-01T00:00:00Z");
    expect(new c.VirtualDate("2026-03-14T00:00:00Z").toISOString()).toBe("2026-03-14T00:00:00.000Z");
    expect(new c.VirtualDate(2026, 2, 14).getFullYear()).toBe(2026);
    expect(c.VirtualDate.UTC(2026, 2, 14)).toBe(Date.UTC(2026, 2, 14));
    expect(c.VirtualDate.parse("2026-03-14T00:00:00Z")).toBe(Date.parse("2026-03-14T00:00:00Z"));
  });

  it("Date() called as a function still returns a string", () => {
    const c = createVirtualClock();
    expect(typeof c.VirtualDate()).toBe("string");
  });

  it("reset and invalid input", () => {
    const c = createVirtualClock();
    c.setNow("2040-01-01T00:00:00Z");
    c.reset();
    expect(Math.abs(c.VirtualDate.now() - Date.now())).toBeLessThan(1000);
    expect(() => c.setNow("not a date")).toThrow(/not a valid time/);
  });

  it("drives the real scheduler code: jumping to just before the fire time, then past it, fires once", () => {
    const c = createVirtualClock();
    const settings = { sendMode: "auto", scheduledTime: "09:15", timezone: "Asia/Kolkata", schedulingPaused: false };
    c.setNow("2026-10-01T03:40:00Z"); // 09:10 IST
    const next = computeNextFireDate(settings, new c.VirtualDate());
    expect(next.toISOString()).toBe("2026-10-01T03:45:00.000Z");
    expect(evaluateSchedulerTick(next, settings, new c.VirtualDate()).fire).toBe(false);
    c.advance(6 * 60_000); // 09:16 IST
    expect(evaluateSchedulerTick(next, settings, new c.VirtualDate()).fire).toBe(true);
  });
});
