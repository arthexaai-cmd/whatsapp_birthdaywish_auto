// Volume check for the Reports export: 10,000 contacts and 10,000 ledger
// rows, written to a real .xlsx file on disk and read back, to make sure
// nothing is truncated and it stays fast enough to run from a button click.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import XLSX from "xlsx";
import { DatabaseSync } from "node:sqlite";
import { migrate, upsertContact, startRun, endRun, recordSend } from "../src/core/db.js";
import { buildProgressReport, buildUpcomingSchedule, writeReportXlsx } from "../src/core/progress.js";
import { DEFAULT_SETTINGS } from "../src/core/defaults.js";

const N = 10_000;
const NOW = new Date("2025-06-15T10:00:00Z");
const settings = { ...DEFAULT_SETTINGS, timezone: "UTC", scheduledTime: "09:15" };

function inTransaction(db, fn) {
  db.exec("BEGIN");
  try {
    fn();
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

function seed() {
  const db = new DatabaseSync(":memory:");
  migrate(db);
  const phone = (i) => `+9170000${String(i).padStart(5, "0")}`;
  inTransaction(db, () => {
    for (let i = 0; i < N; i++) {
      upsertContact(db, {
        name: `Person ${i} with a longer name ✨`,
        phoneE164: phone(i),
        birthMonth: (i % 12) + 1,
        birthDay: (i % 28) + 1,
        birthYear: 1970 + (i % 40),
        customMessage: i % 10 === 0 ? `Custom wish for person ${i}, have a great year!` : null,
        skip: i % 50 === 0, // 200 skipped contacts
      });
    }
  });
  const runId = startRun(db);
  const statuses = ["sent", "sent", "sent", "failed", "not_on_whatsapp"];
  inTransaction(db, () => {
    for (let i = 0; i < N; i++) {
      recordSend(db, {
        runId,
        contactId: i + 1,
        ledgerKey: `${phone(i)}:2024-01-01`,
        name: `Person ${i} with a longer name ✨`,
        phone: phone(i),
        occurrence: "2024-01-01",
        status: statuses[i % statuses.length],
        error: i % 5 === 3 ? "Evaluation failed: something went wrong in WhatsApp Web" : null,
        belated: i % 7 === 0,
      });
    }
  });
  endRun(db, runId, { status: "completed", summary: {} });
  return db;
}

describe(`Reports export at ${N.toLocaleString()} rows`, () => {
  it("builds, writes and reads back every row", () => {
    const db = seed();

    const t0 = performance.now();
    const progress = buildProgressReport(db);
    const upcoming = buildUpcomingSchedule(db, settings, { days: 365, now: NOW });
    const tBuild = performance.now() - t0;

    expect(progress.sends).toHaveLength(N);
    expect(progress.totals).toMatchObject({ sent: 6000, failed: 2000, notOnWhatsapp: 2000 });
    expect(upcoming.skipped).toHaveLength(N / 50);
    expect(upcoming.rows).toHaveLength(N - N / 50); // every non-skipped contact within 12 months

    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bb-report-")), "report.xlsx");
    const t1 = performance.now();
    writeReportXlsx(file, { progress, upcoming, generatedAt: NOW });
    const tWrite = performance.now() - t1;
    const sizeKb = Math.round(fs.statSync(file).size / 1024);

    const t2 = performance.now();
    const wb = XLSX.readFile(file);
    const rows = (name) => XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1 });
    const history = rows("Sent history");
    const schedule = rows("Upcoming schedule");
    const skipped = rows("Skipped contacts");
    const tRead = performance.now() - t2;

    // +1 for the header row on each sheet.
    expect(history).toHaveLength(N + 1);
    expect(schedule).toHaveLength(N - N / 50 + 1);
    expect(skipped).toHaveLength(N / 50 + 1);

    // Spot-check content survived the round trip intact (incl. non-ASCII).
    const names = new Set(history.slice(1).map((r) => r[1]));
    expect(names.size).toBe(N);
    expect(names.has("Person 9999 with a longer name ✨")).toBe(true);
    expect(schedule.slice(1).every((r) => /^\d{4}-\d{2}-\d{2}$/.test(r[0]))).toBe(true);
    const dates = schedule.slice(1).map((r) => r[0]);
    expect([...dates].sort()).toEqual(dates); // still in date order

    console.log(
      `[stress] build ${tBuild.toFixed(0)} ms · write ${tWrite.toFixed(0)} ms · read ${tRead.toFixed(0)} ms · file ${sizeKb} KB`
    );
    // Generous ceiling -- it has to feel instant-ish behind a button, not win a benchmark.
    expect(tBuild + tWrite).toBeLessThan(15_000);

    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  }, 60_000);
});
