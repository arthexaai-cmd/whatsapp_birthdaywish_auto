// Turns raw rows (from Google Sheets or an .xlsx file) into normalised
// Person objects. Pure and side-effect free — unit-testable without any
// network or WhatsApp involvement.

import { parsePhoneNumberFromString } from "libphonenumber-js";

/**
 * @typedef {Object} Person
 * @property {string} name          full name as given
 * @property {string} firstName     derived first token of name
 * @property {string} phoneE164     normalised phone, e.g. +919812345678
 * @property {number} birthMonth    1-12
 * @property {number} birthDay      1-31
 * @property {number|null} birthYear
 * @property {string|null} customMessage
 * @property {string|null} salutation
 * @property {number} rowNum        1-based row number in the source, for error reporting
 */

const TRUTHY = new Set(["1", "true", "yes", "y", "skip"]);

function normHeader(h) {
  return String(h ?? "").trim().toLowerCase();
}

/** Build a lookup from normalised header -> raw header, for a header row. */
function headerIndex(headers) {
  const idx = {};
  headers.forEach((h, i) => {
    const key = normHeader(h);
    if (key) idx[key] = i;
  });
  return idx;
}

function cell(row, idx, name) {
  const i = idx[name];
  if (i === undefined) return undefined;
  const v = row[i];
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s === "" ? undefined : s;
}

/**
 * Parse a birthdate string in DD/MM/YYYY, DD/MM, DD-MM-YYYY, DD-MM, or
 * YYYY-MM-DD form. Also accepts a JS Date (e.g. from xlsx cell types).
 * Returns { month, day, year } or null if unparsable.
 */
export function parseBirthdate(raw) {
  if (raw instanceof Date && !isNaN(raw)) {
    return { month: raw.getMonth() + 1, day: raw.getDate(), year: null };
  }
  const s = String(raw ?? "").trim();
  if (!s) return null;

  // YYYY-MM-DD
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (m) {
    const [, y, mo, d] = m;
    return finalizeDate(+mo, +d, +y);
  }

  // DD/MM/YYYY or DD-MM-YYYY
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/);
  if (m) {
    const [, d, mo, y] = m;
    const year = y.length === 2 ? 2000 + (+y) : +y;
    return finalizeDate(+mo, +d, year);
  }

  // DD/MM or DD-MM (no year)
  m = s.match(/^(\d{1,2})[-/](\d{1,2})$/);
  if (m) {
    const [, d, mo] = m;
    return finalizeDate(+mo, +d, null);
  }

  return null;
}

function finalizeDate(month, day, year) {
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  // Reject impossible day-in-month combos (Apr 31 etc), but always allow
  // Feb 29 here -- leap-day handling is birthdays.js's job, not the parser's.
  const daysInMonth = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day > daysInMonth[month - 1]) return null;
  return { month, day, year: year || null };
}

/**
 * Normalise a single roster row (array of cells) into a Person, given a
 * header index built by headerIndex(). Returns { person } or { error }.
 */
export function normalizeRow(row, idx, rowNum, defaultCountry) {
  const name = cell(row, idx, "name");
  const phoneRaw = cell(row, idx, "phone");
  const birthdateRaw = cell(row, idx, "birthdate") ?? row[idx["birthdate"]];
  const skip = cell(row, idx, "skip");
  const customMessage = cell(row, idx, "custom_message") ?? null;
  const salutation = cell(row, idx, "salutation") ?? null;

  if (skip && TRUTHY.has(skip.toLowerCase())) {
    return { skipped: true, rowNum, reason: "marked skip" };
  }

  if (!name) return { error: { rowNum, reason: "missing name" } };
  if (!phoneRaw) return { error: { rowNum, reason: "missing phone", name } };

  const phone = parsePhoneNumberFromString(phoneRaw, defaultCountry);
  if (!phone || !phone.isValid()) {
    return { error: { rowNum, reason: `invalid phone "${phoneRaw}"`, name } };
  }

  if (birthdateRaw === undefined || birthdateRaw === null || birthdateRaw === "") {
    return { error: { rowNum, reason: "missing birthdate", name } };
  }
  const bd = parseBirthdate(birthdateRaw);
  if (!bd) {
    return { error: { rowNum, reason: `invalid birthdate "${birthdateRaw}"`, name } };
  }

  const person = {
    name,
    firstName: name.split(/\s+/)[0],
    phoneE164: phone.number,
    birthMonth: bd.month,
    birthDay: bd.day,
    birthYear: bd.year,
    customMessage,
    salutation,
    rowNum,
  };
  return { person };
}

/**
 * Normalise a full sheet (array of rows, first row = header) into
 * { people, errors, skipped }.
 */
export function normalizeRoster(rows, { defaultCountry } = { defaultCountry: "IN" }) {
  if (!rows || rows.length === 0) return { people: [], errors: [], skipped: [] };
  const [headerRow, ...dataRows] = rows;
  const idx = headerIndex(headerRow);

  const people = [];
  const errors = [];
  const skipped = [];

  dataRows.forEach((row, i) => {
    const rowNum = i + 2; // account for header row, 1-based
    // Skip fully blank rows silently
    if (!row || row.every((c) => c === undefined || c === null || String(c).trim() === "")) {
      return;
    }
    const result = normalizeRow(row, idx, rowNum, defaultCountry);
    if (result.person) people.push(result.person);
    else if (result.error) errors.push(result.error);
    else if (result.skipped) skipped.push(result);
  });

  return { people, errors, skipped };
}
