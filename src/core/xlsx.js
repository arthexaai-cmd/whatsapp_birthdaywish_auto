// Reads a local .xlsx roster file into the plain row-array shape that
// roster.normalizeRoster() expects (array of arrays, first row = headers).
// Also builds the blank template users can download and fill in.

import XLSX from "xlsx";
import fs from "node:fs";

// SheetJS 0.20's ESM build has no file access until it is handed fs
// (readFile/writeFile otherwise throw "cannot save file").
XLSX.set_fs(fs);

/**
 * @param {string} filePath
 * @param {string} [sheetName] defaults to the first sheet
 * @returns {Array<Array<any>>}
 */
export function readXlsxRows(filePath, sheetName) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`xlsx roster file not found: ${filePath}`);
  }
  const wb = XLSX.readFile(filePath, { cellDates: true });
  const name = sheetName || wb.SheetNames[0];
  const sheet = wb.Sheets[name];
  if (!sheet) {
    throw new Error(`Sheet "${name}" not found in ${filePath}. Available: ${wb.SheetNames.join(", ")}`);
  }
  // header: 1 => array-of-arrays output, raw cell values (Dates kept as Date due to cellDates)
  return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: "" });
}

// Column order for the downloadable template. Must stay in sync with the
// headers roster.normalizeRow() looks up.
export const SAMPLE_HEADERS = ["name", "phone", "birthdate", "salutation", "custom_message", "skip"];

const SAMPLE_INSTRUCTIONS = [
  ["How to fill in this file"],
  [],
  ["Enter one person per row on the \"Contacts\" sheet (keep it as the first sheet, and keep the header row)."],
  ["Then import this file from the app (setup wizard, or the Contacts tab)."],
  [],
  ["Column", "Required?", "What to enter"],
  ["name", "Yes", "Full name. The first word is used as their first name in messages."],
  ["phone", "Yes", "With country code, e.g. +919812345678. Numbers without one use the app's default country."],
  ["birthdate", "Yes", "DD/MM/YYYY, DD/MM (year unknown), or YYYY-MM-DD."],
  ["salutation", "No", "A title placed before their first name, e.g. \"Mr\", \"Dr\", \"Sir\". Leave blank if not needed."],
  ["custom_message", "No", "A personal message that replaces the usual template for this person."],
  ["skip", "No", "Put \"yes\" to never send to this person. Leave blank otherwise."],
  [],
  ["Examples (do not copy these numbers -- they are not real contacts)"],
  SAMPLE_HEADERS,
  ["Priya Sharma", "+91 98XXX XXXXX", "14/03/1995", "", "", ""],
  ["Rahul Verma", "+91 97XXX XXXXX", "29/02", "Sir", "", ""],
  ["Anita Desai", "+91 96XXX XXXXX", "1988-11-02", "", "Happy birthday Anita! Have a wonderful year.", ""],
];

/**
 * Build the blank contacts template: a header-only "Contacts" sheet (first,
 * so readXlsxRows picks it up) plus an "Instructions" sheet. The Contacts
 * sheet deliberately has no example rows, so importing an unedited template
 * can never add placeholder people.
 */
export function buildSampleWorkbook() {
  const wb = XLSX.utils.book_new();

  const contacts = XLSX.utils.aoa_to_sheet([SAMPLE_HEADERS]);
  contacts["!cols"] = [{ wch: 24 }, { wch: 18 }, { wch: 14 }, { wch: 12 }, { wch: 40 }, { wch: 8 }];
  XLSX.utils.book_append_sheet(wb, contacts, "Contacts");

  const instructions = XLSX.utils.aoa_to_sheet(SAMPLE_INSTRUCTIONS);
  instructions["!cols"] = [{ wch: 18 }, { wch: 18 }, { wch: 90 }];
  XLSX.utils.book_append_sheet(wb, instructions, "Instructions");

  return wb;
}

/** Write the template to filePath as .xlsx. */
export function writeSampleXlsx(filePath) {
  XLSX.writeFile(buildSampleWorkbook(), filePath, { bookType: "xlsx" });
}
