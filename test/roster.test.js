import { describe, it, expect } from "vitest";
import { normalizeRoster, parseBirthdate } from "../src/core/roster.js";

describe("parseBirthdate", () => {
  it("parses DD/MM/YYYY", () => {
    expect(parseBirthdate("14/03/1995")).toEqual({ month: 3, day: 14, year: 1995 });
  });
  it("parses DD-MM (no year)", () => {
    expect(parseBirthdate("29-02")).toEqual({ month: 2, day: 29, year: null });
  });
  it("parses YYYY-MM-DD", () => {
    expect(parseBirthdate("1995-03-14")).toEqual({ month: 3, day: 14, year: 1995 });
  });
  it("accepts a Date object", () => {
    expect(parseBirthdate(new Date(2000, 2, 14))).toEqual({ month: 3, day: 14, year: null });
  });
  it("rounds a Date a few seconds before midnight to the intended day", () => {
    expect(parseBirthdate(new Date(2026, 8, 28, 23, 59, 50))).toEqual({ month: 9, day: 29, year: null });
  });
  it("accepts a raw Excel serial number", () => {
    expect(parseBirthdate(46294)).toEqual({ month: 9, day: 29, year: null });
  });
  it("rejects impossible dates", () => {
    expect(parseBirthdate("31/04/2020")).toBeNull();
    expect(parseBirthdate("32/01/2020")).toBeNull();
    expect(parseBirthdate("not a date")).toBeNull();
  });
  it("allows Feb 29 (leap handling is birthdays.js's job)", () => {
    expect(parseBirthdate("29/02/2001")).toEqual({ month: 2, day: 29, year: 2001 });
  });
});

describe("normalizeRoster", () => {
  const headers = ["name", "phone", "birthdate", "custom_message", "skip", "salutation"];

  it("normalizes a clean row", () => {
    const rows = [headers, ["Priya Sharma", "9812345678", "14/03/1995", "", "", ""]];
    const { people, errors } = normalizeRoster(rows, { defaultCountry: "IN" });
    expect(errors).toEqual([]);
    expect(people).toHaveLength(1);
    expect(people[0]).toMatchObject({
      name: "Priya Sharma",
      firstName: "Priya",
      phoneE164: "+919812345678",
      birthMonth: 3,
      birthDay: 14,
      birthYear: 1995,
    });
  });

  it("accepts a real Excel date cell (Date object) as the birthdate", () => {
    const rows = [headers, ["A", "+91 98123 45678", new Date(2026, 8, 28, 23, 59, 50), "", "", ""]];
    const { people, errors } = normalizeRoster(rows, { defaultCountry: "IN" });
    expect(errors).toEqual([]);
    expect(people[0]).toMatchObject({ birthMonth: 9, birthDay: 29 });
  });

  it("accepts a phone with +91 and spaces", () => {
    const rows = [headers, ["A", "+91 98123 45678", "01/01", "", "", ""]];
    const { people, errors } = normalizeRoster(rows, { defaultCountry: "IN" });
    expect(errors).toEqual([]);
    expect(people[0].phoneE164).toBe("+919812345678");
  });

  it("accepts a phone with a leading 0 (domestic trunk prefix)", () => {
    const rows = [headers, ["A", "09812345678", "01/01", "", "", ""]];
    const { people, errors } = normalizeRoster(rows, { defaultCountry: "IN" });
    expect(errors).toEqual([]);
    expect(people[0].phoneE164).toBe("+919812345678");
  });

  it("collects an invalid phone as an error, not fatal", () => {
    const rows = [headers, ["A", "123", "01/01", "", "", ""], ["B", "9812345678", "02/02", "", "", ""]];
    const { people, errors } = normalizeRoster(rows, { defaultCountry: "IN" });
    expect(people).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(errors[0].reason).toMatch(/invalid phone/);
  });

  it("honors the skip column", () => {
    const rows = [headers, ["A", "9812345678", "01/01", "", "yes", ""]];
    const { people, skipped } = normalizeRoster(rows, { defaultCountry: "IN" });
    expect(people).toHaveLength(0);
    expect(skipped).toHaveLength(1);
  });

  it("ignores fully blank rows", () => {
    const rows = [headers, ["", "", "", "", "", ""], ["A", "9812345678", "01/01", "", "", ""]];
    const { people, errors } = normalizeRoster(rows, { defaultCountry: "IN" });
    expect(people).toHaveLength(1);
    expect(errors).toHaveLength(0);
  });

  it("errors on missing birthdate", () => {
    const rows = [headers, ["A", "9812345678", "", "", "", ""]];
    const { errors } = normalizeRoster(rows, { defaultCountry: "IN" });
    expect(errors[0].reason).toMatch(/missing birthdate/);
  });

  it("is case-insensitive to header names and tolerant of extra columns", () => {
    const rows = [
      ["Name", "Phone", "Birthdate", "Notes"],
      ["A", "9812345678", "01/01", "irrelevant"],
    ];
    const { people, errors } = normalizeRoster(rows, { defaultCountry: "IN" });
    expect(errors).toEqual([]);
    expect(people).toHaveLength(1);
  });
});

describe("validateContactInput (F12)", () => {
  const ok = { name: " Priya ", phoneE164: "+919812345678", birthMonth: 3, birthDay: 14, birthYear: null, skip: false };
  it("cleans and accepts a good contact", async () => {
    const { validateContactInput } = await import("../src/core/roster.js");
    expect(validateContactInput(ok)).toMatchObject({ name: "Priya", birthMonth: 3, birthDay: 14, birthYear: null });
    expect(validateContactInput({ ...ok, birthMonth: 2, birthDay: 29 })).toMatchObject({ birthDay: 29 }); // leap day allowed
    expect(validateContactInput({ ...ok, birthYear: "1990" }).birthYear).toBe(1990);
  });
  it("rejects empty/zero/impossible dates, blank names and silly years", async () => {
    const { validateContactInput } = await import("../src/core/roster.js");
    for (const bad of [
      { birthMonth: 0, birthDay: 0 }, { birthMonth: 4, birthDay: 31 }, { birthMonth: 13, birthDay: 1 }, { birthMonth: NaN, birthDay: 1 },
      { birthMonth: 2, birthDay: 30 }, { name: "   " }, { birthYear: 1800 }, { birthYear: 3000 }, { birthYear: 12.5 },
    ]) {
      expect(() => validateContactInput({ ...ok, ...bad }), JSON.stringify(bad)).toThrow(/Invalid contact/);
    }
  });
});
