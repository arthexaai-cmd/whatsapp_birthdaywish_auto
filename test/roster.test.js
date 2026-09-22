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
