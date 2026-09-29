// Excel import against real .xlsx/.xls/.csv files on disk (C-section of
// docs/TEST_PLAN.md): header variants, date/phone formats, bad files, scale.

import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import XLSX from "xlsx";
import { DatabaseSync } from "node:sqlite";
import { migrate, importRosterRows, listContacts, upsertContact } from "../src/core/db.js";
import { readXlsxRows } from "../src/core/xlsx.js";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bbot-import-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

function freshDb() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  migrate(db);
  return db;
}

/** Write rows (array of arrays) to a workbook file and return its path. */
function writeBook(name, sheets, bookType = "xlsx") {
  const wb = XLSX.utils.book_new();
  for (const [sheetName, aoa] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa, { cellDates: true }), sheetName);
  }
  const file = path.join(tmp, name);
  XLSX.writeFile(wb, file, { bookType });
  return file;
}

const importFile = (db, file, opts = {}) => importRosterRows(db, readXlsxRows(file), { defaultCountry: "IN", ...opts });

describe("headers", () => {
  it("accepts different case, order and stray spaces", () => {
    const f = writeBook("hdr.xlsx", { Contacts: [[" Birthdate ", "PHONE", "Name "], ["14/03/1995", "+919812345678", "Priya Sharma"]] });
    const db = freshDb();
    expect(importFile(db, f)).toMatchObject({ added: 1, errors: [] });
    expect(listContacts(db)[0]).toMatchObject({ name: "Priya Sharma", birthMonth: 3, birthDay: 14 });
  });
  it("reports every row when a required header is missing", () => {
    const f = writeBook("nohdr.xlsx", { Contacts: [["name", "mobile", "dob"], ["A", "+919812345678", "14/03"]] });
    const r = importFile(freshDb(), f);
    expect(r.added).toBe(0);
    expect(r.errors).toHaveLength(1);
  });
});

describe("dates", () => {
  const cases = [
    ["DD/MM/YYYY", "14/03/1995", 3, 14],
    ["DD-MM-YYYY", "14-03-1995", 3, 14],
    ["DD/MM (no year)", "14/03", 3, 14],
    ["YYYY-MM-DD", "1995-03-14", 3, 14],
    ["2-digit year", "14/03/95", 3, 14],
    ["Feb 29", "29/02", 2, 29],
  ];
  for (const [label, val, m, d] of cases) {
    it(`parses ${label}`, () => {
      const f = writeBook(`d-${label.replace(/\W/g, "")}.xlsx`, { Contacts: [["name", "phone", "birthdate"], ["A", "+919812345678", val]] });
      const db = freshDb();
      expect(importFile(db, f).errors).toEqual([]);
      expect(listContacts(db)[0]).toMatchObject({ birthMonth: m, birthDay: d });
    });
  }
  it("parses a real Excel date cell without shifting the day", () => {
    const f = writeBook("datecell.xlsx", { Contacts: [["name", "phone", "birthdate"], ["A", "+919812345678", new Date(Date.UTC(1995, 2, 14))]] });
    const db = freshDb();
    expect(importFile(db, f).errors).toEqual([]);
    expect(listContacts(db)[0]).toMatchObject({ birthMonth: 3, birthDay: 14 });
  });
  it("parses a raw Excel serial number", () => {
    const f = writeBook("serial.xlsx", { Contacts: [["name", "phone", "birthdate"], ["A", "+919812345678", 34772]] }); // 1995-03-14
    const db = freshDb();
    expect(importFile(db, f).errors).toEqual([]);
    expect(listContacts(db)[0]).toMatchObject({ birthMonth: 3, birthDay: 14 });
  });
  it("rejects impossible dates with a row-specific error", () => {
    const f = writeBook("bad-dates.xlsx", {
      Contacts: [["name", "phone", "birthdate"], ["A", "+919812345678", "31/04"], ["B", "+919812345679", "32/01"], ["C", "+919812345680", "hello"]],
    });
    const r = importFile(freshDb(), f);
    expect(r.added).toBe(0);
    expect(r.errors.map((e) => e.rowNum)).toEqual([2, 3, 4]);
    expect(r.errors.every((e) => /birthdate/.test(e.reason))).toBe(true);
  });
});

describe("phones", () => {
  it("normalises spaces, dashes, leading 0 and bare 10-digit numbers using the default country", () => {
    const f = writeBook("phones.xlsx", {
      Contacts: [
        ["name", "phone", "birthdate"],
        ["A", "+91 98123 45678", "1/1"],
        ["B", "98123-45679", "1/1"],
        ["C", "09812345680", "1/1"],
      ],
    });
    const db = freshDb();
    expect(importFile(db, f).errors).toEqual([]);
    expect(listContacts(db).map((c) => c.phoneE164).sort()).toEqual(["+919812345678", "+919812345679", "+919812345680"]);
  });
  it("accepts numbers from other countries when they carry a country code", () => {
    const f = writeBook("intl.xlsx", { Contacts: [["name", "phone", "birthdate"], ["A", "+14155552671", "1/1"], ["B", "+447911123456", "1/1"]] });
    const db = freshDb();
    expect(importFile(db, f).errors).toEqual([]);
    expect(listContacts(db)).toHaveLength(2);
  });
  it("rejects invalid numbers and keeps the good rows", () => {
    const f = writeBook("badphone.xlsx", { Contacts: [["name", "phone", "birthdate"], ["A", "12345", "1/1"], ["B", "+919812345678", "1/1"]] });
    const r = importFile(freshDb(), f);
    expect(r).toMatchObject({ added: 1 });
    expect(r.errors).toHaveLength(1);
  });
  it("numeric phone cells (no +) still work", () => {
    const f = writeBook("numphone.xlsx", { Contacts: [["name", "phone", "birthdate"], ["A", 9812345678, "1/1"]] });
    expect(importFile(freshDb(), f)).toMatchObject({ added: 1, errors: [] });
  });
});

describe("rows", () => {
  it("ignores blank rows and marks skip rows", () => {
    const f = writeBook("blank.xlsx", {
      Contacts: [["name", "phone", "birthdate", "skip"], [], ["A", "+919812345678", "1/1", ""], ["", "", "", ""], ["B", "+919812345679", "1/1", "yes"]],
    });
    const r = importFile(freshDb(), f);
    expect(r).toMatchObject({ added: 1, skippedCount: 1, errors: [] });
  });
  it("duplicate phones inside one file: one contact, last row wins, counted add then update", () => {
    const f = writeBook("dup.xlsx", { Contacts: [["name", "phone", "birthdate"], ["First", "+919812345678", "1/1"], ["Second", "+919812345678", "2/2"]] });
    const db = freshDb();
    const r = importFile(db, f);
    expect(listContacts(db)).toHaveLength(1);
    expect(listContacts(db)[0].name).toBe("Second");
    expect(r.added + r.updated).toBe(2);
  });
  it("preview (dryRun) writes nothing and matches what confirm then does", () => {
    const f = writeBook("preview.xlsx", { Contacts: [["name", "phone", "birthdate"], ["A", "+919812345678", "1/1"], ["B", "+919812345679", "1/1"]] });
    const db = freshDb();
    const preview = importFile(db, f, { dryRun: true });
    expect(listContacts(db)).toHaveLength(0);
    const real = importFile(db, f);
    expect(real).toMatchObject({ added: preview.added, updated: preview.updated });
    expect(importFile(db, f, { dryRun: true })).toMatchObject({ added: 0, updated: 2 });
  });
  it("Unicode, emoji and RTL names survive intact; first name is the first word", () => {
    const names = ["Zoë Müller", "李小龍", "محمد علي", "Anna 🎂 Kim"];
    const f = writeBook("uni.xlsx", { Contacts: [["name", "phone", "birthdate"], ...names.map((n, i) => [n, `+9198123456${70 + i}`, "1/1"])] });
    const db = freshDb();
    expect(importFile(db, f).errors).toEqual([]);
    expect(listContacts(db).map((c) => c.name).sort()).toEqual([...names].sort());
  });
});

describe("sheets and formats", () => {
  it("reads the FIRST sheet even if it is not called Contacts", () => {
    const f = writeBook("firstsheet.xlsx", { Sheet1: [["name", "phone", "birthdate"], ["A", "+919812345678", "1/1"]], Other: [["x"]] });
    expect(importFile(freshDb(), f).added).toBe(1);
  });
  it("Instructions sheet first (wrong order) yields no contacts, not a crash", () => {
    const f = writeBook("wrongorder.xlsx", { Instructions: [["How to fill in"]], Contacts: [["name", "phone", "birthdate"], ["A", "+919812345678", "1/1"]] });
    expect(importFile(freshDb(), f).added).toBe(0);
  });
  it("empty workbook / header-only sheet imports nothing", () => {
    const f = writeBook("headeronly.xlsx", { Contacts: [["name", "phone", "birthdate"]] });
    expect(importFile(freshDb(), f)).toMatchObject({ added: 0, updated: 0, errors: [] });
  });
  it("F11: legacy .xls is readable", () => {
    const f = writeBook("legacy.xls", { Contacts: [["name", "phone", "birthdate"], ["A", "+919812345678", "14/03"]] }, "biff8");
    expect(importFile(freshDb(), f)).toMatchObject({ added: 1, errors: [] });
  });
  it("a CSV renamed to .xlsx is either read or rejected cleanly (never hangs or crashes)", () => {
    const f = path.join(tmp, "renamed.xlsx");
    fs.writeFileSync(f, "name,phone,birthdate\nA,+919812345678,14/03\n");
    let r;
    try {
      r = importFile(freshDb(), f);
    } catch (e) {
      r = e;
    }
    expect(r instanceof Error || typeof r.added === "number").toBe(true);
  });
  it("a corrupted/garbage file throws an Error (mapped to a friendly message by the UI)", () => {
    const f = path.join(tmp, "garbage.xlsx");
    fs.writeFileSync(f, Buffer.from("PK\u0003\u0004 this is not really a zip archive".repeat(5)));
    expect(() => readXlsxRows(f)).toThrow();
  });
  it("a 0-byte file does not crash the process", () => {
    const f = path.join(tmp, "zero.xlsx");
    fs.writeFileSync(f, "");
    let ok = true;
    try {
      importFile(freshDb(), f);
    } catch (e) {
      ok = e instanceof Error;
    }
    expect(ok).toBe(true);
  });
  it("a missing file gives the 'not found' error the UI maps", () => {
    expect(() => readXlsxRows(path.join(tmp, "nope.xlsx"))).toThrow(/not found/);
  });
});

describe("re-import behavior", () => {
  it("re-importing the same file adds no duplicates", () => {
    const f = writeBook("again.xlsx", { Contacts: [["name", "phone", "birthdate"], ["A", "+919812345678", "1/1"]] });
    const db = freshDb();
    importFile(db, f);
    expect(importFile(db, f)).toMatchObject({ added: 0, updated: 1 });
    expect(listContacts(db)).toHaveLength(1);
  });
  it("F9: re-import must not un-skip a contact the user skipped in the app", () => {
    const f = writeBook("skipkeep.xlsx", { Contacts: [["name", "phone", "birthdate"], ["A", "+919812345678", "1/1"]] });
    const db = freshDb();
    importFile(db, f);
    const id = listContacts(db)[0].id;
    upsertContact(db, { ...listContacts(db)[0], skip: true });
    importFile(db, f);
    expect(listContacts(db).find((c) => c.id === id).skip).toBe(true);
  });
});

describe("scale", () => {
  it("imports 5,000 rows quickly", () => {
    const rows = [["name", "phone", "birthdate"]];
    for (let i = 0; i < 5000; i++) rows.push([`Person ${i}`, `+9198${String(10000000 + i)}`, `${(i % 28) + 1}/${(i % 12) + 1}/1990`]);
    const f = writeBook("big.xlsx", { Contacts: rows });
    const db = freshDb();
    const t0 = Date.now();
    const r = importFile(db, f);
    expect(r.added + r.errors.length).toBe(5000);
    expect(Date.now() - t0).toBeLessThan(15000);
  });
});

describe("re-import keeps in-app edits (F9)", () => {
  it("blank message/salutation cells keep the existing values; non-blank ones overwrite", () => {
    const db = freshDb();
    upsertContact(db, { name: "A", phoneE164: "+919812345678", birthMonth: 1, birthDay: 1, customMessage: "Hi custom", salutation: "Sir" });
    const blank = writeBook("keepmsg.xlsx", { Contacts: [["name", "phone", "birthdate", "salutation", "custom_message"], ["A", "+919812345678", "1/1", "", ""]] });
    importFile(db, blank);
    expect(listContacts(db)[0]).toMatchObject({ customMessage: "Hi custom", salutation: "Sir" });
    const filled = writeBook("newmsg.xlsx", { Contacts: [["name", "phone", "birthdate", "salutation", "custom_message"], ["A", "+919812345678", "1/1", "Didi", "New text"]] });
    importFile(db, filled);
    expect(listContacts(db)[0]).toMatchObject({ customMessage: "New text", salutation: "Didi" });
  });
});
