import { describe, it, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import {
  migrate,
  upsertContact,
  listContacts,
  importRosterRows,
  deleteContact,
  recordEmailSend,
  loadTerminalEmailKeys,
  countEmailsSentSince,
} from "../src/core/db.js";
import { normalizeRoster, validateContactInput, isValidEmail } from "../src/core/roster.js";
import { SAMPLE_HEADERS } from "../src/core/xlsx.js";

const mem = () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  migrate(db);
  return db;
};
const base = { name: "Priya Sharma", phoneE164: "+919812345678", birthMonth: 3, birthDay: 14 };

describe("schema v2 migration", () => {
  it("a fresh database has contacts.email, email_sends and version 2", () => {
    const db = mem();
    expect(db.prepare("PRAGMA table_info(contacts)").all().some((c) => c.name === "email")).toBe(true);
    expect(db.prepare("SELECT COUNT(*) AS n FROM email_sends").get().n).toBe(0);
    expect(db.prepare("SELECT version FROM schema_meta").get().version).toBe(2);
  });

  it("upgrades a v1 database in place, keeping its contacts, and is safe to run twice", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`
      CREATE TABLE schema_meta (version INTEGER NOT NULL);
      INSERT INTO schema_meta VALUES (1);
      CREATE TABLE contacts (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, phone_e164 TEXT NOT NULL UNIQUE,
        birth_month INTEGER NOT NULL, birth_day INTEGER NOT NULL, birth_year INTEGER,
        custom_message TEXT, salutation TEXT, skip INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      INSERT INTO contacts (name, phone_e164, birth_month, birth_day, created_at, updated_at)
        VALUES ('Old Contact', '+911111111111', 1, 2, 'x', 'x');
    `);
    migrate(db);
    migrate(db);
    expect(db.prepare("SELECT version FROM schema_meta").get().version).toBe(2);
    const [c] = listContacts(db);
    expect(c.name).toBe("Old Contact");
    expect(c.email).toBeNull();
    upsertContact(db, { ...base, email: "a@b.co" });
    expect(listContacts(db).find((x) => x.name === "Priya Sharma").email).toBe("a@b.co");
  });
});

describe("contact email storage", () => {
  it("stores and updates the address", () => {
    const db = mem();
    upsertContact(db, { ...base, email: "priya@example.com" });
    upsertContact(db, { ...base, email: "new@example.com" });
    expect(listContacts(db)[0].email).toBe("new@example.com");
  });

  it("a re-import with a blank email cell keeps the stored address; a filled one replaces it", () => {
    const db = mem();
    upsertContact(db, { ...base, email: "keep@example.com" });
    const header = SAMPLE_HEADERS;
    const row = (email) => ["Priya Sharma", "+919812345678", "14/03/1995", "", "", "", email];
    importRosterRows(db, [header, row("")]);
    expect(listContacts(db)[0].email).toBe("keep@example.com");
    importRosterRows(db, [header, row("changed@example.com")]);
    expect(listContacts(db)[0].email).toBe("changed@example.com");
  });

  it("deleting a contact keeps their email history", () => {
    const db = mem();
    const { id } = upsertContact(db, { ...base, email: "p@x.co" });
    recordEmailSend(db, { contactId: id, ledgerKey: "s1:p@x.co:2026-03-14", name: "Priya", email: "p@x.co", sender: "s1", occurrence: "2026-03-14", status: "sent" });
    deleteContact(db, id);
    expect(db.prepare("SELECT contact_id FROM email_sends").get().contact_id).toBeNull();
  });
});

describe("email validation", () => {
  it("accepts normal addresses and rejects lists, names with brackets and junk", () => {
    for (const ok of ["a@b.co", "first.last+tag@sub.example.com"]) expect(isValidEmail(ok), ok).toBe(true);
    for (const bad of ["", "a@b", "a b@c.com", "a@b.com, c@d.com", "A <a@b.com>", "a@b.com\nBcc: x@y.com", "@b.com", "a@@b.com", "x".repeat(250) + "@b.com"]) {
      expect(isValidEmail(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  it("the Excel import reads the email column and reports a bad one on its row", () => {
    const { people, errors } = normalizeRoster([
      SAMPLE_HEADERS,
      ["Priya", "+919812345678", "14/03", "", "", "", "priya@example.com"],
      ["Rahul", "+919812345679", "15/03", "", "", "", "not-an-email"],
      ["Anita", "+919812345680", "16/03", "", "", "", ""],
    ]);
    expect(people.map((p) => p.email)).toEqual(["priya@example.com", null]);
    expect(errors).toHaveLength(1);
    expect(errors[0].reason).toMatch(/invalid email/);
  });

  it("an old sheet without an email column still imports", () => {
    const { people, errors } = normalizeRoster([["name", "phone", "birthdate"], ["Priya", "+919812345678", "14/03"]]);
    expect(errors).toEqual([]);
    expect(people[0].email).toBeNull();
  });

  it("the add/edit form validates the address and treats blank as none", () => {
    expect(validateContactInput({ ...base, email: "  p@x.co " }).email).toBe("p@x.co");
    expect(validateContactInput({ ...base, email: "" }).email).toBeNull();
    expect(validateContactInput({ ...base }).email).toBeNull();
    expect(() => validateContactInput({ ...base, email: "nope" })).toThrow(/email/);
  });
});

describe("email ledger", () => {
  const entry = (o = {}) => ({ ledgerKey: "s1:p@x.co:2026-03-14", name: "Priya", email: "p@x.co", sender: "s1", occurrence: "2026-03-14", status: "sent", ...o });

  it("a sent row is terminal and never overwritten; a failed row is replaced by the retry", () => {
    const db = mem();
    expect(recordEmailSend(db, entry({ status: "failed", error: "boom" })).recorded).toBe(true);
    expect(loadTerminalEmailKeys(db).size).toBe(0);
    expect(recordEmailSend(db, entry()).recorded).toBe(true);
    expect(loadTerminalEmailKeys(db).has("s1:p@x.co:2026-03-14")).toBe(true);
    expect(recordEmailSend(db, entry({ status: "failed" }))).toEqual({ recorded: false, reason: "duplicate" });
    expect(db.prepare("SELECT status FROM email_sends").get().status).toBe("sent");
  });

  it("the same person from two senders is two independent rows", () => {
    const db = mem();
    recordEmailSend(db, entry());
    recordEmailSend(db, entry({ ledgerKey: "s2:p@x.co:2026-03-14", sender: "s2" }));
    expect(loadTerminalEmailKeys(db).size).toBe(2);
  });

  it("counts a sender's sent mails in a time window", () => {
    const db = mem();
    recordEmailSend(db, entry());
    recordEmailSend(db, entry({ ledgerKey: "s1:q@x.co:2026-03-14", email: "q@x.co" }));
    recordEmailSend(db, entry({ ledgerKey: "s1:r@x.co:2026-03-14", email: "r@x.co", status: "failed" }));
    recordEmailSend(db, entry({ ledgerKey: "s2:p@x.co:2026-03-14", sender: "s2" }));
    const past = new Date(Date.now() - 86_400_000).toISOString();
    expect(countEmailsSentSince(db, "s1", past)).toBe(2);
    expect(countEmailsSentSince(db, "s1", new Date(Date.now() + 60_000).toISOString())).toBe(0);
  });
});
