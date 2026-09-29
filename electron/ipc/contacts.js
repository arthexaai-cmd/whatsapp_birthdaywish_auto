// IPC: contacts CRUD + Excel import. Registered against ipcMain by
// electron/ipc/index.js. All handlers are thin -- the actual logic lives in
// src/core/db.js and src/core/xlsx.js, kept Electron-agnostic and tested.

import { app, ipcMain, dialog, shell } from "electron";
import path from "node:path";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import { listContacts, upsertContact, deleteContact, importRosterRows } from "../../src/core/db.js";
import { readXlsxRows, writeSampleXlsx } from "../../src/core/xlsx.js";
import { validateContactInput } from "../../src/core/roster.js";
import { ImportGuard } from "../../src/core/importGuard.js";

export function registerContactsIpc(db) {
  const importGuard = new ImportGuard();

  ipcMain.handle("contacts:list", () => listContacts(db));

  ipcMain.handle("contacts:upsert", (event, rawContact) => {
    const contact = validateContactInput(rawContact); // month/day/year/name checked server-side too
    // Normalize the phone the same way Excel import does (roster.js), so a
    // manually-added contact and an imported one are never treated as
    // different people just because of formatting.
    const parsed = parsePhoneNumberFromString(contact.phoneE164, getDefaultCountry(db));
    if (!parsed || !parsed.isValid()) {
      throw new Error(`Invalid phone number: "${contact.phoneE164}"`);
    }
    return upsertContact(db, { ...contact, phoneE164: parsed.number });
  });

  ipcMain.handle("contacts:delete", (event, id) => {
    deleteContact(db, id);
    return { ok: true };
  });

  ipcMain.handle("contacts:pickExcelFile", async () => {
    const result = await dialog.showOpenDialog({
      title: "Select an Excel file",
      properties: ["openFile"],
      filters: [{ name: "Excel", extensions: ["xlsx", "xls"] }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    importGuard.pick(result.filePaths[0]);
    return result.filePaths[0];
  });

  ipcMain.handle("contacts:saveSampleFile", async () => {
    const result = await dialog.showSaveDialog({
      title: "Save sample contacts file",
      defaultPath: path.join(app.getPath("documents"), "birthday-contacts.xlsx"),
      filters: [{ name: "Excel", extensions: ["xlsx"] }],
    });
    if (result.canceled || !result.filePath) return null;
    writeSampleXlsx(result.filePath);
    shell.showItemInFolder(result.filePath);
    return result.filePath;
  });

  ipcMain.handle("contacts:previewImport", (event, filePath) => {
    importGuard.assertPicked(filePath);
    const rows = readXlsxRows(filePath);
    importGuard.recordPreview(filePath);
    return importRosterRows(db, rows, { defaultCountry: getDefaultCountry(db), dryRun: true });
  });

  ipcMain.handle("contacts:confirmImport", (event, filePath) => {
    importGuard.assertUnchangedSincePreview(filePath);
    const rows = readXlsxRows(filePath);
    const result = importRosterRows(db, rows, { defaultCountry: getDefaultCountry(db), dryRun: false });
    importGuard.reset();
    return result;
  });
}

function getDefaultCountry(db) {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'defaultCountry'").get();
  if (!row) return "IN";
  try {
    return JSON.parse(row.value);
  } catch {
    return row.value;
  }
}
