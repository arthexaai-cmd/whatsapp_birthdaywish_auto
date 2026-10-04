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
  addTemplate,
  updateTemplateText,
  listTemplates,
  addTemplateVar,
  updateTemplateVar,
  deleteTemplateVar,
  listTemplateVars,
  migrateTemplateTextsToCurrentDefaults,
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

describe("templates", () => {
  it("adds, edits (including multi-line text) and lists templates", () => {
    const db = freshDb();
    const id = addTemplate(db, "onTime", "Happy birthday {name}!");
    updateTemplateText(db, id, "Happy birthday {name}!\nHope it's a great one.");
    const t = listTemplates(db).find((row) => row.id === id);
    expect(t.text).toBe("Happy birthday {name}!\nHope it's a great one.");
    expect(getMessagesConfig(db).onTime).toContain("Happy birthday {name}!\nHope it's a great one.");
  });
});

describe("template vars (the {wish} pool)", () => {
  it("adds, edits and deletes a wish-pool line", () => {
    const db = freshDb();
    const id = addTemplateVar(db, "wish", "Have a great year ahead.");
    expect(listTemplateVars(db)).toEqual([{ id, name: "wish", value: "Have a great year ahead." }]);

    updateTemplateVar(db, id, "Edited wish.");
    expect(listTemplateVars(db)[0].value).toBe("Edited wish.");
    expect(getMessagesConfig(db).vars.wish).toEqual(["Edited wish."]);

    deleteTemplateVar(db, id);
    expect(listTemplateVars(db)).toEqual([]);
  });
});

describe("migrateTemplateTextsToCurrentDefaults", () => {
  const newConfig = {
    onTime: ["{name},\n\nHappy birthday!\n\n{wish}"],
    belated: ["{name},\n\nbelated happy birthday!\n\n{wish}"],
  };

  it("replaces a row still at the old default, leaves an edited row alone", () => {
    const db = freshDb();
    const untouchedId = addTemplate(db, "onTime", "Happy birthday {name}! {wish} 🎂");
    const editedId = addTemplate(db, "belated", "My own belated wording {name}!");

    migrateTemplateTextsToCurrentDefaults(db, newConfig);

    const byId = Object.fromEntries(listTemplates(db).map((t) => [t.id, t.text]));
    expect(byId[untouchedId]).toBe("{name},\n\nHappy birthday!\n\n{wish}");
    expect(byId[editedId]).toBe("My own belated wording {name}!");
  });

  it("is a no-op when run twice", () => {
    const db = freshDb();
    const id = addTemplate(db, "onTime", "Happy birthday {name}! {wish} 🎂");
    migrateTemplateTextsToCurrentDefaults(db, newConfig);
    migrateTemplateTextsToCurrentDefaults(db, newConfig);
    expect(listTemplates(db).find((t) => t.id === id).text).toBe("{name},\n\nHappy birthday!\n\n{wish}");
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

  it("deletes a contact who has send history, keeping the history and the ledger", () => {
    const db = freshDb();
    db.exec("PRAGMA foreign_keys = ON;"); // as electron/db.js opens the real DB
    const { id } = upsertContact(db, { name: "A", phoneE164: "+919812345678", birthMonth: 1, birthDay: 1 });
    recordSend(db, {
      runId: startRun(db),
      contactId: id,
      ledgerKey: "+919812345678:2026-01-01",
      name: "A",
      phone: "+919812345678",
      occurrence: "2026-01-01",
      status: "sent",
    });

    deleteContact(db, id);

    expect(listContacts(db)).toHaveLength(0);
    const rows = db.prepare("SELECT name, phone, contact_id FROM sends").all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "A", phone: "+919812345678", contact_id: null });
    // Still counts as sent, so re-adding the same number can't double-send.
    expect(loadTerminalLedgerKeys(db).has("+919812345678:2026-01-01")).toBe(true);
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

  it("lets a successful retry overwrite a failed entry, so it is never sent again", () => {
    const db = freshDb();
    const entry = {
      contactId: null,
      ledgerKey: "+919812345678:2026-03-14",
      name: "A",
      phone: "+919812345678",
      occurrence: "2026-03-14",
      belated: false,
    };
    const run1 = startRun(db, { dryRun: false });
    expect(recordSend(db, { ...entry, runId: run1, status: "failed", error: "boom" }).recorded).toBe(true);
    expect(loadTerminalLedgerKeys(db).has(entry.ledgerKey)).toBe(false);

    const run2 = startRun(db, { dryRun: false });
    expect(recordSend(db, { ...entry, runId: run2, status: "sent", belated: true }).recorded).toBe(true);
    expect(loadTerminalLedgerKeys(db).has(entry.ledgerKey)).toBe(true);

    const rows = db.prepare("SELECT * FROM sends").all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "sent", error: null, belated: 1, run_id: run2 });
  });

  it("never overwrites a terminal entry, even with a later failure", () => {
    const db = freshDb();
    const runId = startRun(db, { dryRun: false });
    const entry = { runId, ledgerKey: "k", name: "A", phone: "+1", occurrence: "2026-03-14" };
    recordSend(db, { ...entry, status: "not_on_whatsapp" });
    expect(recordSend(db, { ...entry, status: "failed", error: "x" })).toEqual({ recorded: false, reason: "duplicate" });
    expect(db.prepare("SELECT status FROM sends").get().status).toBe("not_on_whatsapp");
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
