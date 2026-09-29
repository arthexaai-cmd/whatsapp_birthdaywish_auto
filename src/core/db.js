// SQLite schema, migrations, and query functions. Pure with respect to
// Electron -- takes an already-open node:sqlite DatabaseSync instance, so
// it's testable in plain Node/Vitest with an in-memory database. The
// Electron-specific part (resolving the userData path and opening the file)
// lives in electron/db.js.
//
// node:sqlite is a built-in Node/Electron module (no native compilation,
// no prebuild-binary matching against the Electron ABI) -- important for a
// distributable app where end users never run a build step.

import { normalizeRoster } from "./roster.js";

const SCHEMA_VERSION = 1;

export function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_meta (version INTEGER NOT NULL);

    CREATE TABLE IF NOT EXISTS contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone_e164 TEXT NOT NULL UNIQUE,
      birth_month INTEGER NOT NULL,
      birth_day INTEGER NOT NULL,
      birth_year INTEGER,
      custom_message TEXT,
      salutation TEXT,
      skip INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL CHECK (kind IN ('onTime', 'belated')),
      text TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS template_vars (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      status TEXT NOT NULL DEFAULT 'running',
      dry_run INTEGER NOT NULL DEFAULT 0,
      summary_json TEXT
    );

    CREATE TABLE IF NOT EXISTS sends (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL REFERENCES runs(id),
      contact_id INTEGER REFERENCES contacts(id),
      ledger_key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      occurrence TEXT NOT NULL,
      status TEXT NOT NULL,
      error TEXT,
      belated INTEGER NOT NULL DEFAULT 0,
      sent_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sends_run ON sends(run_id);
    CREATE INDEX IF NOT EXISTS idx_contacts_skip ON contacts(skip);
  `);

  const row = db.prepare("SELECT version FROM schema_meta LIMIT 1").get();
  if (!row) {
    db.prepare("INSERT INTO schema_meta (version) VALUES (?)").run(SCHEMA_VERSION);
  }
  // Future migrations: `if (row.version < 2) { ...; db.prepare("UPDATE schema_meta SET version = 2").run(); }`
}

/** Seed default templates/vars on first run only (never overwrite user edits). */
export function seedDefaultsIfEmpty(db, messagesConfig) {
  const count = db.prepare("SELECT COUNT(*) AS n FROM templates").get().n;
  if (count > 0) return false;

  const insertTemplate = db.prepare("INSERT INTO templates (kind, text, enabled) VALUES (?, ?, 1)");
  const insertVar = db.prepare("INSERT INTO template_vars (name, value) VALUES (?, ?)");

  // node:sqlite has no .transaction() helper (unlike better-sqlite3), so wrap manually.
  function doSeed() {
    for (const t of messagesConfig.onTime || []) insertTemplate.run("onTime", t);
    for (const t of messagesConfig.belated || []) insertTemplate.run("belated", t);
    for (const [name, values] of Object.entries(messagesConfig.vars || {})) {
      for (const v of values) insertVar.run(name, v);
    }
  }

  db.exec("BEGIN");
  try {
    doSeed();
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  return true;
}

// ---- Settings -------------------------------------------------------------

export function getSetting(db, key, fallback = null) {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
  if (!row) return fallback;
  try {
    return JSON.parse(row.value);
  } catch {
    return row.value;
  }
}

export function setSetting(db, key, value) {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, JSON.stringify(value));
}

export function getAllSettings(db) {
  const rows = db.prepare("SELECT key, value FROM settings").all();
  const out = {};
  for (const r of rows) {
    try {
      out[r.key] = JSON.parse(r.value);
    } catch {
      out[r.key] = r.value;
    }
  }
  return out;
}

// ---- Contacts ---------------------------------------------------------

export function listContacts(db) {
  return db.prepare("SELECT * FROM contacts ORDER BY name COLLATE NOCASE").all().map(rowToContact);
}

export function getContact(db, id) {
  const row = db.prepare("SELECT * FROM contacts WHERE id = ?").get(id);
  return row ? rowToContact(row) : null;
}

export function upsertContact(db, c) {
  const now = new Date().toISOString();
  const existing = db.prepare("SELECT id FROM contacts WHERE phone_e164 = ?").get(c.phoneE164);
  if (existing) {
    db.prepare(
      `UPDATE contacts SET name=?, birth_month=?, birth_day=?, birth_year=?,
         custom_message=?, salutation=?, skip=?, updated_at=? WHERE id=?`
    ).run(
      c.name,
      c.birthMonth,
      c.birthDay,
      c.birthYear ?? null,
      c.customMessage ?? null,
      c.salutation ?? null,
      c.skip ? 1 : 0,
      now,
      existing.id
    );
    return { id: existing.id, action: "updated" };
  }
  const info = db
    .prepare(
      `INSERT INTO contacts
        (name, phone_e164, birth_month, birth_day, birth_year, custom_message, salutation, skip, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      c.name,
      c.phoneE164,
      c.birthMonth,
      c.birthDay,
      c.birthYear ?? null,
      c.customMessage ?? null,
      c.salutation ?? null,
      c.skip ? 1 : 0,
      now,
      now
    );
  return { id: info.lastInsertRowid, action: "added" };
}

/**
 * Delete a contact but keep their send history. sends.contact_id references
 * contacts(id) (and electron/db.js turns foreign_keys ON), so a contact who
 * was ever messaged can't be deleted while rows still point at them. Detach
 * those rows first: they carry their own copy of name/phone, so History and
 * Reports stay complete, and the ledger_key (phone-based) is untouched -- so
 * re-adding the same person later still can't double-send a birthday.
 */
export function deleteContact(db, id) {
  db.exec("BEGIN");
  try {
    db.prepare("UPDATE sends SET contact_id = NULL WHERE contact_id = ?").run(id);
    db.prepare("DELETE FROM contacts WHERE id = ?").run(id);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

/**
 * Import raw roster rows (array-of-arrays, header row first -- the same
 * shape readXlsxRows() produces) via normalizeRoster(), then upsert every
 * valid person on phone_e164. Returns a preview-friendly summary.
 */
export function importRosterRows(db, rows, { defaultCountry = "IN", dryRun = false } = {}) {
  const { people, errors, skipped } = normalizeRoster(rows, { defaultCountry });

  let added = 0;
  let updated = 0;
  if (!dryRun) {
    for (const p of people) {
      // A re-import must not undo edits made in the app: keep an existing
      // contact's skip flag, and keep their custom message / salutation when
      // the sheet leaves those cells blank.
      const existing = db.prepare("SELECT skip, custom_message, salutation FROM contacts WHERE phone_e164 = ?").get(p.phoneE164);
      const result = upsertContact(db, {
        ...p,
        skip: existing ? !!existing.skip : false,
        customMessage: p.customMessage ?? existing?.custom_message ?? null,
        salutation: p.salutation ?? existing?.salutation ?? null,
      });
      if (result.action === "added") added++;
      else updated++;
    }
  } else {
    // Dry-run preview: count without writing, using the same upsert logic's
    // add/update classification (existing phone -> update, else add).
    const existingPhones = new Set(db.prepare("SELECT phone_e164 FROM contacts").all().map((r) => r.phone_e164));
    for (const p of people) {
      if (existingPhones.has(p.phoneE164)) updated++;
      else added++;
    }
  }

  return { added, updated, errors, skippedCount: skipped.length, total: people.length };
}

function rowToContact(row) {
  return {
    id: row.id,
    name: row.name,
    firstName: row.name.split(/\s+/)[0],
    phoneE164: row.phone_e164,
    birthMonth: row.birth_month,
    birthDay: row.birth_day,
    birthYear: row.birth_year,
    customMessage: row.custom_message,
    salutation: row.salutation,
    skip: !!row.skip,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ---- Templates ----------------------------------------------------------

export function getMessagesConfig(db) {
  const templates = db.prepare("SELECT kind, text FROM templates WHERE enabled = 1").all();
  const vars = db.prepare("SELECT name, value FROM template_vars").all();
  const emoji = getSetting(db, "emojiPool", ["🎂", "🎉", "🥳", "✨"]);

  const cfg = { onTime: [], belated: [], vars: {}, emoji };
  for (const t of templates) cfg[t.kind].push(t.text);
  for (const v of vars) {
    if (!cfg.vars[v.name]) cfg.vars[v.name] = [];
    cfg.vars[v.name].push(v.value);
  }
  return cfg;
}

export function addTemplate(db, kind, text) {
  const info = db.prepare("INSERT INTO templates (kind, text, enabled) VALUES (?, ?, 1)").run(kind, text);
  return info.lastInsertRowid;
}

export function setTemplateEnabled(db, id, enabled) {
  db.prepare("UPDATE templates SET enabled = ? WHERE id = ?").run(enabled ? 1 : 0, id);
}

export function deleteTemplate(db, id) {
  db.prepare("DELETE FROM templates WHERE id = ?").run(id);
}

export function listTemplates(db) {
  return db.prepare("SELECT * FROM templates ORDER BY kind, id").all();
}

// ---- Runs & sends (ledger) ----------------------------------------------

export function startRun(db, { dryRun = false } = {}) {
  const info = db
    .prepare("INSERT INTO runs (started_at, status, dry_run) VALUES (?, 'running', ?)")
    .run(new Date().toISOString(), dryRun ? 1 : 0);
  return info.lastInsertRowid;
}

export function endRun(db, runId, { status, summary }) {
  db.prepare("UPDATE runs SET ended_at = ?, status = ?, summary_json = ? WHERE id = ?").run(
    new Date().toISOString(),
    status,
    JSON.stringify(summary ?? null),
    runId
  );
}

export function listRuns(db, limit = 50) {
  return db.prepare("SELECT * FROM runs ORDER BY id DESC LIMIT ?").all(limit);
}

export function getRunSends(db, runId) {
  return db.prepare("SELECT * FROM sends WHERE run_id = ? ORDER BY id").all(runId);
}

/** Every recorded send with its run's start time/status, newest first. */
export function listAllSendsWithRuns(db) {
  return db
    .prepare(
      `SELECT s.*, r.started_at AS run_started_at, r.status AS run_status
       FROM sends s JOIN runs r ON r.id = s.run_id
       ORDER BY s.sent_at DESC, s.id DESC`
    )
    .all();
}

/** Map of ledger_key -> recorded status (ledger_key is UNIQUE, so one row each). */
export function sendStatusByLedgerKey(db) {
  const rows = db.prepare("SELECT ledger_key, status FROM sends").all();
  return new Map(rows.map((r) => [r.ledger_key, r.status]));
}

/**
 * Record a send outcome. Returns { recorded: true } normally, or
 * { recorded: false, reason: 'duplicate' } if this ledger_key was already
 * recorded -- the UNIQUE constraint is the actual idempotency guarantee;
 * this just turns the constraint violation into a clean result instead of
 * throwing, since a caller retrying after a crash should not treat "already
 * recorded" as an error.
 *
 * Exception: a row still at status 'failed' is overwritten in place. A
 * failure isn't terminal (see loadTerminalLedgerKeys), so a later run retries
 * it -- and that retry's outcome must replace the 'failed' row. Otherwise a
 * successful retry would be dropped as a "duplicate", the ledger would keep
 * saying 'failed', and the next run inside the catch-up window would send
 * the same wish again. Terminal rows ('sent', 'not_on_whatsapp') are never
 * overwritten.
 */
export function recordSend(db, entry) {
  try {
    const info = db.prepare(
      `INSERT INTO sends (run_id, contact_id, ledger_key, name, phone, occurrence, status, error, belated, sent_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(ledger_key) DO UPDATE SET
         run_id = excluded.run_id, contact_id = excluded.contact_id, name = excluded.name,
         phone = excluded.phone, status = excluded.status, error = excluded.error,
         belated = excluded.belated, sent_at = excluded.sent_at
       WHERE sends.status = 'failed'`
    ).run(
      entry.runId,
      entry.contactId ?? null,
      entry.ledgerKey,
      entry.name,
      entry.phone,
      entry.occurrence,
      entry.status,
      entry.error ?? null,
      entry.belated ? 1 : 0,
      new Date().toISOString()
    );
    // 0 changes: the key exists with a terminal status, so the upsert's WHERE skipped it.
    if (info.changes === 0) return { recorded: false, reason: "duplicate" };
    return { recorded: true };
  } catch (err) {
    if (String(err.message).includes("UNIQUE constraint failed")) {
      return { recorded: false, reason: "duplicate" };
    }
    throw err;
  }
}

/**
 * Ledger keys already terminal (sent, or confirmed not on WhatsApp) --
 * these must never be retried. A transient "failed" entry is intentionally
 * excluded, so it remains eligible for a future run.
 */
export function loadTerminalLedgerKeys(db) {
  const rows = db
    .prepare("SELECT DISTINCT ledger_key FROM sends WHERE status IN ('sent', 'not_on_whatsapp')")
    .all();
  return new Set(rows.map((r) => r.ledger_key));
}

export function countDistinctRunDays(db) {
  const rows = db.prepare("SELECT started_at FROM runs WHERE status = 'completed'").all();
  const days = new Set(rows.map((r) => r.started_at.slice(0, 10)));
  return days.size;
}
