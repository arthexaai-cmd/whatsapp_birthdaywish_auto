// Opens the app's SQLite database under Electron's userData directory and
// runs migrations + first-run seeding. All actual schema/query logic lives
// in src/core/db.js (kept Electron-agnostic and unit-tested); this module
// just wires that up to real paths and the bundled default config.

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { app } from "electron";
import YAML from "yaml";
import { migrate, seedDefaultsIfEmpty, getAllSettings, setSetting, migrateTemplateTextsToCurrentDefaults } from "../src/core/db.js";
import { DEFAULT_SETTINGS, fillMissingDefaults, migratePacingToCurrentDefaults } from "../src/core/defaults.js";

let dbInstance = null;

function resourcesConfigPath(file) {
  // Packaged app: config/ is copied in via electron-builder's extraResources.
  // Dev: read straight from the repo's config/ folder.
  const packaged = path.join(process.resourcesPath || "", "config", file);
  if (app.isPackaged && fs.existsSync(packaged)) return packaged;
  return path.join(app.getAppPath(), "config", file);
}

export function openDb() {
  if (dbInstance) return dbInstance;

  const userDataDir = app.getPath("userData");
  fs.mkdirSync(userDataDir, { recursive: true });
  const dbPath = path.join(userDataDir, "birthday-bot.sqlite");

  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  migrate(db);

  const messagesConfig = YAML.parse(fs.readFileSync(resourcesConfigPath("messages.yaml"), "utf8"));
  seedDefaultsIfEmpty(db, messagesConfig);

  // Fill in any settings keys missing from the DB (first run, or an app
  // update that introduced a new setting) without touching ones the user
  // already has -- fillMissingDefaults only adds, never overwrites.
  const existing = getAllSettings(db);

  // An install from before pacingDefaultsVersion existed keeps its saved
  // pacing, which would pin it to the old defaults forever. Move the fields
  // the user never changed to the current defaults, once.
  if (existing.pacing && existing.pacingDefaultsVersion == null) {
    existing.pacing = migratePacingToCurrentDefaults(existing.pacing);
    setSetting(db, "pacing", existing.pacing);
  }

  // Same one-time move, but for default *template text*: offer the new
  // multi-line wording only to rows the user never edited.
  if (existing.templateDefaultsVersion == null) {
    migrateTemplateTextsToCurrentDefaults(db, messagesConfig);
    setSetting(db, "templateDefaultsVersion", DEFAULT_SETTINGS.templateDefaultsVersion);
    existing.templateDefaultsVersion = DEFAULT_SETTINGS.templateDefaultsVersion;
  }

  const merged = fillMissingDefaults(existing, DEFAULT_SETTINGS);
  for (const [key, value] of Object.entries(merged)) {
    if (!(key in existing)) setSetting(db, key, value);
  }

  dbInstance = db;
  return db;
}

export function closeDb() {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

export function sessionDir() {
  return path.join(app.getPath("userData"), "wa-session");
}

export function webVersionCacheDir() {
  return path.join(app.getPath("userData"), "wwebjs-cache");
}
