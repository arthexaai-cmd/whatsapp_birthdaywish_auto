// Reads the birthday roster from a Google Sheet using a service account.
// Read-only: the sheet is shared with the service account's email as a
// Viewer. Returns the same row-array shape as sources/xlsx.js.

import fs from "node:fs";
import { google } from "googleapis";
import { GoogleAuth } from "google-auth-library";

/**
 * @param {object} opts
 * @param {string} opts.sheetId     the id from the sheet's URL
 * @param {string} [opts.tab]       tab/sheet name; defaults to the first tab
 * @param {string} opts.credentialsPath path to the service-account key JSON
 * @returns {Promise<Array<Array<any>>>}
 */
export async function readGsheetRows({ sheetId, tab, credentialsPath }) {
  if (!sheetId) throw new Error("GSHEET_ID is not set.");
  if (!fs.existsSync(credentialsPath)) {
    throw new Error(
      `Google service-account key not found at ${credentialsPath}. ` +
        `Set GOOGLE_APPLICATION_CREDENTIALS or place the key there.`
    );
  }

  const auth = new GoogleAuth({
    keyFile: credentialsPath,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  const client = await auth.getClient();
  const sheets = google.sheets({ version: "v4", auth: client });

  let range = tab ? `${tab}` : undefined;
  if (!range) {
    // Discover the first tab's title if none was configured.
    const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
    const firstTitle = meta.data.sheets?.[0]?.properties?.title;
    if (!firstTitle) throw new Error("Could not determine the first sheet tab; set GSHEET_TAB explicitly.");
    range = firstTitle;
  }

  // FORMATTED_VALUE returns date cells as the text the sheet displays
  // (e.g. "14/03/1995"), which roster.parseBirthdate() already handles.
  // Using UNFORMATTED_VALUE would return date cells as raw serial numbers.
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range,
    valueRenderOption: "FORMATTED_VALUE",
  });

  return res.data.values || [];
}
