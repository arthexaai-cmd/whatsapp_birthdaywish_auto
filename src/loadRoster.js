// Picks the configured roster source, fetches raw rows, and normalizes them.
import { readXlsxRows } from "./sources/xlsx.js";
import { readGsheetRows } from "./sources/gsheet.js";
import { normalizeRoster } from "./roster.js";

export async function loadRoster(config) {
  let rows;
  if (config.roster.source === "xlsx") {
    rows = readXlsxRows(config.roster.xlsx.path, config.roster.xlsx.sheet || undefined);
  } else {
    rows = await readGsheetRows({
      sheetId: config.roster.gsheet.sheetId,
      tab: config.roster.gsheet.tab || undefined,
      credentialsPath: config.roster.gsheet.credentialsPath,
    });
  }
  return normalizeRoster(rows, { defaultCountry: config.roster.defaultCountry });
}
