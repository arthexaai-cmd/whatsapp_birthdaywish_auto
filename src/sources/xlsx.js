// Reads a local .xlsx roster file into the plain row-array shape that
// roster.normalizeRoster() expects (array of arrays, first row = headers).
// Used as a fallback source and as a one-time importer into Google Sheets.

import XLSX from "xlsx";
import fs from "node:fs";

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
