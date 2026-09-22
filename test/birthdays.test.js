import { describe, it, expect } from "vitest";
import {
  addDays,
  ymdToKey,
  birthdayOccurrence,
  candidateDates,
  matchBirthdays,
  dedupeAgainstLedger,
  isQuietHours,
} from "../src/core/birthdays.js";

function person(overrides) {
  return {
    name: "Test Person",
    firstName: "Test",
    phoneE164: "+919812345678",
    birthMonth: 3,
    birthDay: 14,
    birthYear: 1995,
    customMessage: null,
    salutation: null,
    rowNum: 2,
    ...overrides,
  };
}

describe("addDays / ymdToKey", () => {
  it("adds and subtracts days across month/year boundaries", () => {
    expect(addDays({ year: 2026, month: 1, day: 1 }, -1)).toEqual({ year: 2025, month: 12, day: 31 });
    expect(addDays({ year: 2026, month: 2, day: 28 }, 1)).toEqual({ year: 2026, month: 3, day: 1 });
  });
  it("formats as YYYY-MM-DD", () => {
    expect(ymdToKey({ year: 2026, month: 3, day: 4 })).toBe("2026-03-04");
  });
});

describe("birthdayOccurrence — Feb 29 handling", () => {
  it("falls back to Feb 28 in a non-leap year by default", () => {
    const p = person({ birthMonth: 2, birthDay: 29 });
    expect(birthdayOccurrence(p, 2026)).toEqual({ year: 2026, month: 2, day: 28 });
  });
  it("uses Feb 29 in a leap year", () => {
    const p = person({ birthMonth: 2, birthDay: 29 });
    expect(birthdayOccurrence(p, 2028)).toEqual({ year: 2028, month: 2, day: 29 });
  });
  it("supports mar1 fallback config", () => {
    const p = person({ birthMonth: 2, birthDay: 29 });
    expect(birthdayOccurrence(p, 2026, "mar1")).toEqual({ year: 2026, month: 3, day: 1 });
  });
  it("2027 is confirmed non-leap for the fallback test", () => {
    const p = person({ birthMonth: 2, birthDay: 29 });
    expect(birthdayOccurrence(p, 2027)).toEqual({ year: 2027, month: 2, day: 28 });
  });
});

describe("candidateDates", () => {
  it("includes today plus the lookback window, most recent first", () => {
    const today = { year: 2026, month: 3, day: 14 };
    const dates = candidateDates(today, 2);
    expect(dates).toEqual([
      { year: 2026, month: 3, day: 14 },
      { year: 2026, month: 3, day: 13 },
      { year: 2026, month: 3, day: 12 },
    ]);
  });
});

describe("matchBirthdays", () => {
  const today = { year: 2026, month: 3, day: 14 };

  it("matches an on-time birthday", () => {
    const p = person({ birthMonth: 3, birthDay: 14 });
    const matches = matchBirthdays([p], today, { catchupDays: 2 });
    expect(matches).toHaveLength(1);
    expect(matches[0].belated).toBe(false);
    expect(matches[0].ledgerKey).toBe(`${p.phoneE164}:2026-03-14`);
  });

  it("matches a belated birthday within the catchup window", () => {
    const p = person({ birthMonth: 3, birthDay: 12 });
    const matches = matchBirthdays([p], today, { catchupDays: 2 });
    expect(matches).toHaveLength(1);
    expect(matches[0].belated).toBe(true);
    expect(matches[0].occurrence).toEqual({ year: 2026, month: 3, day: 12 });
  });

  it("does not match outside the catchup window", () => {
    const p = person({ birthMonth: 3, birthDay: 10 });
    const matches = matchBirthdays([p], today, { catchupDays: 2 });
    expect(matches).toHaveLength(0);
  });

  it("handles the catchup window boundary exactly", () => {
    const p = person({ birthMonth: 3, birthDay: 12 }); // exactly catchupDays=2 back
    const matches = matchBirthdays([p], today, { catchupDays: 2 });
    expect(matches).toHaveLength(1);
    const p2 = person({ birthMonth: 3, birthDay: 11 }); // one day beyond
    expect(matchBirthdays([p2], today, { catchupDays: 2 })).toHaveLength(0);
  });

  it("handles a Jan 1 today with a catchup window spanning the prior year", () => {
    const jan1 = { year: 2026, month: 1, day: 1 };
    const p = person({ birthMonth: 12, birthDay: 30 });
    const matches = matchBirthdays([p], jan1, { catchupDays: 2 });
    expect(matches).toHaveLength(1);
    expect(matches[0].occurrence).toEqual({ year: 2025, month: 12, day: 30 });
    expect(matches[0].belated).toBe(true);
  });

  it("applies Feb 29 fallback consistently when matching", () => {
    const p = person({ birthMonth: 2, birthDay: 29 });
    const feb28 = { year: 2026, month: 2, day: 28 };
    const matches = matchBirthdays([p], feb28, { catchupDays: 0, leapDayFallback: "feb28" });
    expect(matches).toHaveLength(1);
    expect(matches[0].belated).toBe(false);
  });
});

describe("dedupeAgainstLedger", () => {
  it("filters out already-sent ledger keys", () => {
    const p = person({});
    const matches = [{ person: p, occurrence: { year: 2026, month: 3, day: 14 }, belated: false, ledgerKey: "k1" }];
    expect(dedupeAgainstLedger(matches, new Set(["k1"]))).toHaveLength(0);
    expect(dedupeAgainstLedger(matches, new Set(["other"]))).toHaveLength(1);
  });
});

describe("isQuietHours", () => {
  const window = ["21:30", "08:30"]; // wraps midnight

  it("is quiet late at night", () => {
    expect(isQuietHours(22 * 60, window)).toBe(true); // 22:00
  });
  it("is quiet just before the end boundary", () => {
    expect(isQuietHours(8 * 60 + 29, window)).toBe(true); // 08:29
  });
  it("is not quiet at the end boundary", () => {
    expect(isQuietHours(8 * 60 + 30, window)).toBe(false); // 08:30
  });
  it("is not quiet mid-day", () => {
    expect(isQuietHours(13 * 60, window)).toBe(false); // 13:00
  });
  it("is quiet at the start boundary", () => {
    expect(isQuietHours(21 * 60 + 30, window)).toBe(true); // 21:30
  });
});
