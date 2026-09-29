import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import XLSX from "xlsx";
import { readXlsxRows, writeSampleXlsx, buildSampleWorkbook, SAMPLE_HEADERS } from "../src/core/xlsx.js";
import { normalizeRoster } from "../src/core/roster.js";

describe("sample contacts template", () => {
  let tmpDir;
  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = null;
  });

  it("puts a header-only Contacts sheet first", () => {
    const wb = buildSampleWorkbook();
    expect(wb.SheetNames).toEqual(["Contacts", "Instructions"]);
  });

  it("imports nothing when left unedited", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bbot-"));
    const file = path.join(tmpDir, "sample.xlsx");
    writeSampleXlsx(file);

    const rows = readXlsxRows(file);
    expect(rows).toEqual([SAMPLE_HEADERS]);
    expect(normalizeRoster(rows, { defaultCountry: "IN" })).toEqual({ people: [], errors: [], skipped: [] });
  });

  it("round-trips a filled-in row through the real importer", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bbot-"));
    const file = path.join(tmpDir, "filled.xlsx");
    const wb = buildSampleWorkbook();
    XLSX.utils.sheet_add_aoa(wb.Sheets.Contacts, [["Priya Sharma", "+919812345678", "14/03/1995", "Didi", "", ""]], {
      origin: -1,
    });
    XLSX.writeFile(wb, file);

    const { people, errors } = normalizeRoster(readXlsxRows(file), { defaultCountry: "IN" });
    expect(errors).toEqual([]);
    expect(people).toHaveLength(1);
    expect(people[0]).toMatchObject({
      name: "Priya Sharma",
      phoneE164: "+919812345678",
      birthMonth: 3,
      birthDay: 14,
      birthYear: 1995,
      salutation: "Didi",
    });
  });
});
