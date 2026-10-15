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
      "namePostfixEnabled", "namePostfix",
    ]) {
      expect(RENDERER_SETTABLE_KEYS).toContain(k);
    }
  });
  it("name postfix", () => {
    expect(validateSetting("namePostfixEnabled", false)).toBe(false);
    expect(() => validateSetting("namePostfixEnabled", "yes")).toThrow(/true or false/);
    expect(validateSetting("namePostfix", " ji ")).toBe("ji");
    expect(validateSetting("namePostfix", "")).toBe("");
    expect(() => validateSetting("namePostfix", "a\nb")).toThrow(/single line/);
    expect(() => validateSetting("namePostfix", "x".repeat(21))).toThrow(/at most 20/);
    expect(() => validateSetting("namePostfix", 5)).toThrow(/single line/);
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

describe("validateSetting — card settings", () => {
  it("accepts the three message formats and nothing else", () => {
    for (const f of ["text", "image", "both"]) expect(validateSetting("messageFormat", f)).toBe(f);
    expect(() => validateSetting("messageFormat", "video")).toThrow(/text.*image.*both/);
  });
  it("keeps cardConfig main-process only (written through the Cards screen's own validator)", () => {
    expect(RENDERER_SETTABLE_KEYS).not.toContain("cardConfig");
    expect(() => validateSetting("cardConfig", {})).toThrow(/can't be changed/);
  });
});

describe("validateSetting — email settings", () => {
  it("accepts a one-line subject and rejects empty, long or multi-line ones", () => {
    expect(validateSetting("emailSubject", "  Happy Birthday {name}! ")).toBe("Happy Birthday {name}!");
    expect(() => validateSetting("emailSubject", "")).toThrow(/subject/);
    expect(() => validateSetting("emailSubject", "a\nBcc: x@y.com")).toThrow(/subject/);
    expect(() => validateSetting("emailSubject", "x".repeat(201))).toThrow(/subject/);
  });
  it("keeps the account list main-process only (it is written by the email screen's own IPC)", () => {
    expect(RENDERER_SETTABLE_KEYS).not.toContain("emailAccounts");
    expect(() => validateSetting("emailAccounts", [])).toThrow(/can't be changed/);
  });
});

describe("validateSetting — onboardingDismissed", () => {
  it("is a renderer-settable boolean", () => {
    expect(validateSetting("onboardingDismissed", true)).toBe(true);
    expect(() => validateSetting("onboardingDismissed", "yes")).toThrow(/true or false/);
  });
});
