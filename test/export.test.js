// Excel export (D-section of docs/TEST_PLAN.md): the blank template must
// round-trip through import, and the report workbook must be safe to open.

import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import XLSX from "xlsx";
import { DatabaseSync } from "node:sqlite";
import { migrate, upsertContact, startRun, endRun, recordSend, importRosterRows } from "../src/core/db.js";
import { writeSampleXlsx, readXlsxRows } from "../src/core/xlsx.js";
import { buildProgressReport, buildUpcomingSchedule, buildReportWorkbook, writeReportXlsx } from "../src/core/progress.js";
import { DEFAULT_SETTINGS } from "../src/core/defaults.js";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bbot-export-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const settings = { ...DEFAULT_SETTINGS, timezone: "Asia/Kolkata", pacing: { ...DEFAULT_SETTINGS.pacing, warmupDays: 0 } };
const NOW = new Date("2026-05-10T04:00:00Z");

function dbWithHistory(name = "Priya") {
  const db = new DatabaseSync(":memory:");
  migrate(db);
  const id = upsertContact(db, { name, phoneE164: "+919812345678", birthMonth: 5, birthDay: 10 }).id;
  const runId = startRun(db, { dryRun: false });
  recordSend(db, { runId, contactId: id, ledgerKey: "+919812345678:2026-05-10", name, phone: "+919812345678", occurrence: "2026-05-10", status: "sent", belated: false });
  endRun(db, runId, { status: "completed", summary: { sent: 1, failed: 0, notOnWhatsapp: 0 } });
  return db;
}

describe("template round-trip", () => {
  it("fill the downloaded template with rows, save, and import it", () => {
    const file = path.join(tmp, "template.xlsx");
    writeSampleXlsx(file);
    const wb = XLSX.readFile(file);
    XLSX.utils.sheet_add_aoa(wb.Sheets["Contacts"], [["Priya Sharma", "+919812345678", "14/03/1995", "", "", ""]], { origin: "A2" });
    XLSX.writeFile(wb, file);
    const db = new DatabaseSync(":memory:");
    migrate(db);
    expect(importRosterRows(db, readXlsxRows(file), { defaultCountry: "IN" })).toMatchObject({ added: 1, errors: [] });
  });
});

describe("report workbook", () => {
  it("writes a real .xlsx that re-opens with 4 sheets and matching totals", () => {
    const db = dbWithHistory();
    const report = { progress: buildProgressReport(db), upcoming: buildUpcomingSchedule(db, settings, { days: 365, now: NOW }) };
    const file = path.join(tmp, "report.xlsx");
    writeReportXlsx(file, report);
    const wb = XLSX.readFile(file);
    expect(wb.SheetNames).toEqual(["Summary", "Sent history", "Upcoming schedule", "Skipped contacts"]);
    const history = XLSX.utils.sheet_to_json(wb.Sheets["Sent history"], { header: 1 });
    expect(history).toHaveLength(2); // header + 1 send
    expect(JSON.stringify(history[1])).toContain("Priya");
  });

  it("S5: names/messages starting with = + - @ are stored as text, not formulas", () => {
    const evil = ['=HYPERLINK("http://evil.example","click")', "+cmd|' /C calc'!A0", "-2+3", "@SUM(1+1)"];
    for (const name of evil) {
      const db = dbWithHistory(name);
      const report = { progress: buildProgressReport(db), upcoming: buildUpcomingSchedule(db, settings, { days: 365, now: NOW }) };
      const wb = buildReportWorkbook({ ...report, generatedAt: NOW });
      for (const sheetName of wb.SheetNames) {
        for (const [addr, cell] of Object.entries(wb.Sheets[sheetName])) {
          if (addr.startsWith("!")) continue;
          expect(cell.f, `${sheetName}!${addr} is a formula`).toBeUndefined();
          if (cell.t === "s" && /^[=+\-@]/.test(String(cell.v)) && String(cell.v).includes(name.slice(1, 6))) {
            // A leading formula character would be evaluated by Excel once the file is re-saved or the cell edited.
            throw new Error(`${sheetName}!${addr} starts with a formula trigger: ${cell.v}`);
          }
        }
      }
    }
  });
});

describe("safeCell", () => {
  it("escapes formula triggers but leaves phones, numbers and normal text alone", async () => {
    const { safeCell } = await import("../src/core/progress.js");
    expect(safeCell("=1+1")).toBe("'=1+1");
    expect(safeCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(safeCell("+cmd|x")).toBe("'+cmd|x");
    expect(safeCell("-2+3")).toBe("'-2+3");
    expect(safeCell("\tx")).toBe("'\tx");
    expect(safeCell("+919812345678")).toBe("+919812345678");
    expect(safeCell("+91 98123-45678")).toBe("+91 98123-45678");
    expect(safeCell("Priya Sharma")).toBe("Priya Sharma");
    expect(safeCell("")).toBe("");
    expect(safeCell(5)).toBe(5);
  });
});
