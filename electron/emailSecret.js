// Storage for the email sender passwords (app passwords). They are encrypted
// with Electron's safeStorage (Windows DPAPI, tied to the signed-in Windows
// user) and kept in one file in the app's data folder. They are never written
// to the settings table (the renderer can read every setting) and never sent
// to the renderer: the UI only ever learns whether an account HAS a password.

import fs from "node:fs";
import path from "node:path";
import { app, safeStorage } from "electron";

const file = () => path.join(app.getPath("userData"), "email-secrets.bin");

function readAll() {
  const f = file();
  if (!fs.existsSync(f)) return {};
  try {
    return JSON.parse(safeStorage.decryptString(fs.readFileSync(f)));
  } catch (err) {
    // Damaged, or saved by a different Windows user: treat as empty so the
    // user can simply re-enter the passwords.
    console.warn("[email] could not read the saved passwords:", err.message);
    return {};
  }
}

function writeAll(map) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("This computer can't store passwords securely, so email can't be set up here.");
  }
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), safeStorage.encryptString(JSON.stringify(map)));
}

export const hasPassword = (id) => Object.hasOwn(readAll(), id);
export const getPassword = (id) => readAll()[id] ?? null;

export function setPassword(id, password) {
  writeAll({ ...readAll(), [id]: password });
}

export function deletePassword(id) {
  const all = readAll();
  if (!Object.hasOwn(all, id)) return;
  delete all[id];
  writeAll(all);
}
