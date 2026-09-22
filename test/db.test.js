import { describe, it, expect, beforeEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import {
  migrate,
  seedDefaultsIfEmpty,
  getSetting,
  setSetting,
  listContacts,
  upsertContact,
  deleteContact,
  importRosterRows,
  getMessagesConfig,
  startRun,
  endRun,
  recordSend,
  loadTerminalLedgerKeys,
  countDistinctRunDays,
} from "../src/core/db.js";

function freshDb() {
  const db = new DatabaseSync(":memory:");
  migrate(db);
  return db;
}

const sampleMessages = {
  onTime: ["Happy birthday {name}!"],
  belated: ["Belated happy birthday {name}!"],
  vars: { wish: ["Have a great day."] },
};

describe("migrate", () => {
  it("creates all tables and is idempotent", () => {
    const db = freshDb();
    expect(() => migrate(db)).not.toThrow(); // re-running should be a no-op
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r) => r.name);
    for (const t of ["contacts", "templates", "template_vars", "settings", "runs", "sends"]) {
      expect(tables).toContain(t);
    }
  });
});

describe("settings", () => {
  it("round-trips JSON values", () => {
    const db = freshDb();
    setSetting(db, "scheduleTime", "09:15");
    setSetting(db, "quietHours", ["21:30", "08:30"]);
    expect(getSetting(db, "scheduleTime")).toBe("09:15");
    expect(getSetting(db, "quietHours")).toEqual(["21:30", "08:30"]);
    expect(getSetting(db, "missing", "fallback")).toBe("fallback");
  });

  it("upserts on repeated set", () => {
    const db = freshDb();
    setSetting(db, "k", 1);
    setSetting(db, "k", 2);
    expect(getSetting(db, "k")).toBe(2);
  });
});

describe("seedDefaultsIfEmpty", () => {
  it("seeds once and never overwrites user edits", () => {
    const db = freshDb();
    expect(seedDefaultsIfEmpty(db, sampleMessages)).toBe(true);
    const cfg = getMessagesConfig(db);
    expect(cfg.onTime).toEqual(["Happy birthday {name}!"]);

    // User edits (adds a template)...
    db.prepare("INSERT INTO templates (kind, text, enabled) VALUES ('onTime', 'Custom!', 1)").run();
    // ...seeding again must be a no-op since templates already exist.
    expect(seedDefaultsIfEmpty(db, sampleMessages)).toBe(false);
    expect(getMessagesConfig(db).onTime).toContain("Custom!");
    expect(getMessagesConfig(db).onTime).toHaveLength(2);
  });
});

describe("contacts upsert", () => {
  it("adds a new contact and updates on re-import by phone", () => {
    const db = freshDb();
    const r1 = upsertContact(db, { name: "A", phoneE164: "+919812345678", birthMonth: 1, birthDay: 1 });
    expect(r1.action).toBe("added");
    const r2 = upsertContact(db, { name: "A Renamed", phoneE164: "+919812345678", birthMonth: 1, birthDay: 2 });
    expect(r2.action).toBe("updated");
    expect(r2.id).toBe(r1.id);

    const contacts = listContacts(db);
    expect(contacts).toHaveLength(1);
    expect(contacts[0].name).toBe("A Renamed");
    expect(contacts[0].birthDay).toBe(2);
  });

  it("deletes a contact", () => {
    const db = freshDb();
    const { id } = upsertContact(db, { name: "A", phoneE164: "+919812345678", birthMonth: 1, birthDay: 1 });
    deleteContact(db, id);
    expect(listContacts(db)).toHaveLength(0);
  });
});

describe("importRosterRows", () => {
  const headers = ["name", "phone", "birthdate"];

  it("classifies added vs updated vs errors, and dry-run writes nothing", () => {
    const db = freshDb();
    upsertContact(db, { name: "Existing", phoneE164: "+919812345678", birthMonth: 1, birthDay: 1 });

    const rows = [
      headers,
      ["Existing Renamed", "9812345678", "02/01"], // same phone -> update
      ["New Person", "9812345679", "03/01"], // new -> add
      ["Bad", "123", "01/01"], // invalid phone -> error
    ];

    const dryPreview = importRosterRows(db, rows, { defaultCountry: "IN", dryRun: true });
    expect(dryPreview.added).toBe(1);
    expect(dryPreview.updated).toBe(1);
    expect(dryPreview.errors).toHaveLength(1);
    expect(listContacts(db)).toHaveLength(1); // dry-run: nothing written

    const real = importRosterRows(db, rows, { defaultCountry: "IN", dryRun: false });
    expect(real.added).toBe(1);
    expect(real.updated).toBe(1);
    expect(listContacts(db)).toHaveLength(2);
  });
});

describe("ledger idempotency via sends.ledger_key", () => {
  it("rejects a duplicate ledger_key instead of double-recording", () => {
    const db = freshDb();
    const runId = startRun(db, { dryRun: false });
    const entry = {
      runId,
      contactId: null,
      ledgerKey: "+919812345678:2026-03-14",
      name: "A",
      phone: "+919812345678",
      occurrence: "2026-03-14",
      status: "sent",
      belated: false,
    };
    const first = recordSend(db, entry);
    expect(first.recorded).toBe(true);
    const second = recordSend(db, entry);
    expect(second.recorded).toBe(false);
    expect(second.reason).toBe("duplicate");

    const keys = loadTerminalLedgerKeys(db);
    expect(keys.has(entry.ledgerKey)).toBe(true);
    expect(keys.size).toBe(1);
  });

  it("excludes failed (non-terminal) entries from the terminal ledger", () => {
    const db = freshDb();
    const runId = startRun(db, { dryRun: false });
    recordSend(db, {
      runId,
      ledgerKey: "k1",
      name: "A",
      phone: "+91",
      occurrence: "2026-01-01",
      status: "failed",
      error: "timeout",
      belated: false,
    });
    expect(loadTerminalLedgerKeys(db).size).toBe(0);
  });
});

describe("runs", () => {
  it("starts and ends a run, and counts distinct completed days", () => {
    const db = freshDb();
    const runId = startRun(db, { dryRun: false });
    endRun(db, runId, { status: "completed", summary: { sent: 3 } });
    expect(countDistinctRunDays(db)).toBe(1);

    const run = db.prepare("SELECT * FROM runs WHERE id = ?").get(runId);
    expect(run.status).toBe("completed");
    expect(JSON.parse(run.summary_json)).toEqual({ sent: 3 });
  });
});
