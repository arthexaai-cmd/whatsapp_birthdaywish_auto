import { describe, it, expect } from "vitest";
import { validateSetting, RENDERER_SETTABLE_KEYS } from "../src/core/settingsValidation.js";
import { isValidTimezone } from "../src/core/schedule.js";
import { DEFAULT_SETTINGS } from "../src/core/defaults.js";

const pacing = (over = {}) => ({ ...DEFAULT_SETTINGS.pacing, ...over });

describe("isValidTimezone", () => {
  it("accepts IANA names and rejects typos, empty and non-strings", () => {
    expect(isValidTimezone("Asia/Kolkata")).toBe(true);
    expect(isValidTimezone("UTC")).toBe(true);
    expect(isValidTimezone("Asia/Kolkatta")).toBe(false);
    expect(isValidTimezone("")).toBe(false);
    expect(isValidTimezone(undefined)).toBe(false);
    expect(isValidTimezone(5)).toBe(false);
  });
});

describe("validateSetting — keys (S2)", () => {
  it("rejects keys only the main process may write", () => {
    for (const k of ["lastReminderDate", "dailyCapMax", "hasEverPaired", "closeWarningDismissed", "__proto__", "nonsense"]) {
      expect(() => validateSetting(k, true), k).toThrow(/can't be changed/);
    }
  });
  it("allows every key the UI actually writes", () => {
    for (const k of [
      "sendMode", "reminderEnabled", "schedulingPaused", "scheduledTime", "timezone", "catchupDays",
      "catchUpOnLaunch", "runAtLogin", "pacing", "selfNotifyNumber", "selfNotifyEnabled", "defaultCountry", "riskAcknowledged",
    ]) {
      expect(RENDERER_SETTABLE_KEYS).toContain(k);
    }
  });
});

describe("validateSetting — simple values", () => {
  it("timezone (F5)", () => {
    expect(validateSetting("timezone", "Asia/Kolkata")).toBe("Asia/Kolkata");
    expect(() => validateSetting("timezone", "Asia/Kolkatta")).toThrow(/not a valid timezone/);
    expect(() => validateSetting("timezone", "")).toThrow();
  });
  it("scheduledTime", () => {
    expect(validateSetting("scheduledTime", "09:15")).toBe("09:15");
    for (const bad of ["", "9:15", "24:00", "09:60", "abc", null]) expect(() => validateSetting("scheduledTime", bad), String(bad)).toThrow();
  });
  it("sendMode / booleans / catchupDays / country", () => {
    expect(validateSetting("sendMode", "auto")).toBe("auto");
    expect(() => validateSetting("sendMode", "yolo")).toThrow();
    expect(() => validateSetting("runAtLogin", "yes")).toThrow();
    expect(validateSetting("catchupDays", 0)).toBe(0);
    for (const bad of [-1, 15, 1.5, NaN, "2"]) expect(() => validateSetting("catchupDays", bad), String(bad)).toThrow();
    expect(validateSetting("defaultCountry", "IN")).toBe("IN");
    expect(() => validateSetting("defaultCountry", "india")).toThrow();
  });
});

describe("validateSetting — pacing (F4)", () => {
  it("accepts the shipped defaults unchanged", () => {
    expect(validateSetting("pacing", pacing())).toEqual(pacing());
  });
  it("rejects a batch size that can start at 0", () => {
    expect(() => validateSetting("pacing", pacing({ batchSize: [0, 0] }))).toThrow(/Messages per batch/);
    expect(() => validateSetting("pacing", pacing({ batchSize: [0, 5] }))).toThrow();
  });
  it("rejects reversed, negative, fractional and non-numeric ranges", () => {
    for (const bad of [[7, 4], [-1, 3], [1.5, 3], ["a", "b"], [1], null]) {
      expect(() => validateSetting("pacing", pacing({ withinBatchSeconds: bad })), JSON.stringify(bad)).toThrow();
    }
  });
  it("rejects bad quiet hours", () => {
    expect(() => validateSetting("pacing", pacing({ quietHours: ["", "08:30"] }))).toThrow(/quiet hours/);
    expect(() => validateSetting("pacing", pacing({ quietHours: ["25:00", "08:30"] }))).toThrow();
  });
  it("clamps dailyCap to the ceiling and rejects zero", () => {
    expect(validateSetting("pacing", pacing({ dailyCap: 9999 }), { dailyCapMax: 150 }).dailyCap).toBe(150);
    expect(() => validateSetting("pacing", pacing({ dailyCap: 0 }))).toThrow();
  });
  it("drops unknown pacing fields", () => {
    expect(validateSetting("pacing", pacing({ evil: 1 }))).not.toHaveProperty("evil");
  });
  it("rejects non-objects", () => {
    for (const bad of [null, [], "x", 3]) expect(() => validateSetting("pacing", bad)).toThrow();
  });
});
