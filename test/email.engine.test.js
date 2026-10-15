import { describe, it, expect, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { migrate, seedDefaultsIfEmpty, upsertContact, recordEmailSend, listContacts } from "../src/core/db.js";
import { previewEmailsToday, runEmailEngine, classifyMailError, friendlyMailError, emailLedgerKey } from "../src/core/emailEngine.js";
import { validateAccount } from "../src/core/emailAccounts.js";
import { DEFAULT_SETTINGS } from "../src/core/defaults.js";

const TODAY = "2026-03-14";
const settings = { ...DEFAULT_SETTINGS, timezone: "UTC", emailSubject: "Happy Birthday {name}!" };
const A = validateAccount({ id: "acct-aaa", preset: "gmail", user: "a@gmail.com", fromName: "Team A" });
const B = validateAccount({ id: "acct-bbb", preset: "gmail", user: "b@gmail.com" });

function freshDb(people = [["Priya Sharma", "+919812345678", "priya@example.com"], ["Rahul Verma", "+919812345679", "rahul@example.com"]]) {
  const db = new DatabaseSync(":memory:");
  migrate(db);
  seedDefaultsIfEmpty(db, { onTime: ["Happy birthday {name}!"], belated: ["Belated {name}!"], vars: {}, emoji: [] });
  for (const [name, phone, email] of people) upsertContact(db, { name, phoneE164: phone, birthMonth: 3, birthDay: 14, email });
  return db;
}

/** A fake nodemailer transport per account; behaviours can be scripted. */
function mailers(script = {}) {
  const sent = [];
  const mailerFor = (account) => ({
    sendMail: vi.fn(async (msg) => {
      const f = script[account.id];
      if (f) await f(msg);
      sent.push({ account: account.id, ...msg });
      return { messageId: "x" };
    }),
  });
  return { sent, mailerFor };
}
const quick = { sleep: async () => {}, retryDelayMs: 0 };
const run = (db, accounts, extra = {}) => runEmailEngine({ db, settings, accounts, dateOverride: TODAY, ...quick, ...extra });

describe("previewEmailsToday", () => {
  it("lists due people with an email, once, with the wish and subject; people without email are separate", () => {
    const db = freshDb([["Priya Sharma", "+919812345678", "priya@example.com"], ["No Mail", "+919812345600", null]]);
    const p = previewEmailsToday({ db, settings, accounts: [A, B], dateOverride: TODAY });
    expect(p.people).toHaveLength(1);
    expect(p.people[0]).toMatchObject({ name: "Priya Sharma", email: "priya@example.com", subject: "Happy Birthday Priya Sharma!", pendingSenders: ["acct-aaa", "acct-bbb"] });
    expect(p.people[0].text).toMatch(/^Happy birthday/);
    expect(p.noEmail.map((x) => x.name)).toEqual(["No Mail"]);
    expect(p.totalEmails).toBe(2);
    expect(p.accounts.map((a) => [a.id, a.pending, a.capacityLeft, a.overCap])).toEqual([["acct-aaa", 1, 100, 0], ["acct-bbb", 1, 100, 0]]);
  });
  it("skips skipped contacts, other days, and pairs already sent from that sender", () => {
    const db = freshDb();
    const [c] = listContacts(db);
    recordEmailSend(db, { contactId: c.id, ledgerKey: emailLedgerKey("acct-aaa", c.email, TODAY), name: c.name, email: c.email, sender: "acct-aaa", occurrence: TODAY, status: "sent" });
    const p = previewEmailsToday({ db, settings, accounts: [A, B], dateOverride: TODAY });
    expect(p.people.find((x) => x.email === c.email).pendingSenders).toEqual(["acct-bbb"]);
    expect(previewEmailsToday({ db, settings, accounts: [A], dateOverride: "2026-07-01" }).people).toEqual([]);
    db.prepare("UPDATE contacts SET skip = 1").run();
    expect(previewEmailsToday({ db, settings, accounts: [A], dateOverride: TODAY }).people).toEqual([]);
  });
  it("reports a sender that cannot cover everyone (overCap)", () => {
    const db = freshDb();
    const small = validateAccount({ id: "acct-sml", preset: "gmail", user: "s@gmail.com", dailyCap: 1 });
    const p = previewEmailsToday({ db, settings, accounts: [small], dateOverride: TODAY });
    expect(p.accounts[0]).toMatchObject({ pending: 2, capacityLeft: 1, overCap: 1 });
  });
});

describe("runEmailEngine", () => {
  it("every person gets one email from every selected account", async () => {
    const db = freshDb();
    const { sent, mailerFor } = mailers();
    const r = await run(db, [A, B], { mailerFor });
    expect(r.sent).toBe(4);
    const pairs = sent.map((m) => `${m.account}>${m.to}`).sort();
    expect(pairs).toEqual(["acct-aaa>priya@example.com", "acct-aaa>rahul@example.com", "acct-bbb>priya@example.com", "acct-bbb>rahul@example.com"]);
    expect(sent.find((m) => m.account === "acct-aaa").from).toEqual({ name: "Team A", address: "a@gmail.com" });
    expect(db.prepare("SELECT COUNT(*) AS n FROM email_sends WHERE status='sent'").get().n).toBe(4);
  });

  it("never sends the same pair twice, even on a second run", async () => {
    const db = freshDb();
    const { sent, mailerFor } = mailers();
    await run(db, [A, B], { mailerFor });
    await run(db, [A, B], { mailerFor });
    expect(sent).toHaveLength(4);
  });

  it("attaches the card inline and uses the reviewed text; text-only when there is no card", async () => {
    const db = freshDb([["Priya Sharma", "+919812345678", "priya@example.com"]]);
    const { sent, mailerFor } = mailers();
    const [c] = listContacts(db);
    const renderCard = vi.fn(async () => Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    await run(db, [A], { mailerFor, renderCard, approved: { [c.id]: "Reviewed wish" } });
    expect(renderCard).toHaveBeenCalledOnce();
    expect(renderCard.mock.calls[0][0].name).toBe("Priya Sharma");
    expect(sent[0].text).toBe("Reviewed wish");
    expect(sent[0].html).toContain("cid:");
    expect(sent[0].attachments[0]).toMatchObject({ cid: expect.any(String), contentType: "image/jpeg", contentDisposition: "inline" });

    const db2 = freshDb([["Priya Sharma", "+919812345678", "priya@example.com"]]);
    const m2 = mailers();
    await run(db2, [A], { mailerFor: m2.mailerFor });
    expect(m2.sent[0].attachments).toEqual([]);
    expect(m2.sent[0].html).not.toContain("<img");
  });

  it("falls back to a text-only email when the card can't be drawn", async () => {
    const db = freshDb([["Priya Sharma", "+919812345678", "priya@example.com"]]);
    const { sent, mailerFor } = mailers();
    const events = [];
    await run(db, [A], { mailerFor, renderCard: async () => { throw new Error("font failed"); }, onProgress: (e) => events.push(e) });
    expect(sent).toHaveLength(1);
    expect(sent[0].attachments).toEqual([]);
    expect(events.find((e) => e.phase === "card_fallback").error).toBe("font failed");
  });

  it("only emails people in the approved list", async () => {
    const db = freshDb();
    const { sent, mailerFor } = mailers();
    const priya = listContacts(db).find((c) => c.name === "Priya Sharma");
    await run(db, [A], { mailerFor, approved: { [priya.id]: "Hi" } });
    expect(sent.map((m) => m.to)).toEqual(["priya@example.com"]);
  });

  it("a login failure stops only that account; the other still sends to everyone", async () => {
    const db = freshDb();
    const authErr = Object.assign(new Error("Invalid login: 535 Username and Password not accepted"), { code: "EAUTH", responseCode: 535 });
    const { sent, mailerFor } = mailers({ "acct-aaa": async () => { throw authErr; } });
    const events = [];
    const r = await run(db, [A, B], { mailerFor, onProgress: (e) => events.push(e) });
    expect(sent.filter((m) => m.account === "acct-bbb")).toHaveLength(2);
    expect(sent.filter((m) => m.account === "acct-aaa")).toHaveLength(0);
    expect(r.stopped).toEqual({ "acct-aaa": "auth" });
    expect(events.filter((e) => e.phase === "account_stopped")).toHaveLength(1);
    // A's second person was never attempted: only one failed row for A.
    expect(db.prepare("SELECT COUNT(*) AS n FROM email_sends WHERE sender='acct-aaa'").get().n).toBe(1);
    expect(db.prepare("SELECT status FROM email_sends WHERE sender='acct-aaa'").get().status).toBe("failed");
  });

  it("a sending-limit reply stops that account for the run", async () => {
    const db = freshDb();
    const quota = Object.assign(new Error("550 5.4.5 Daily user sending limit exceeded"), { responseCode: 550 });
    const { sent, mailerFor } = mailers({ "acct-aaa": async () => { throw quota; } });
    const r = await run(db, [A], { mailerFor });
    expect(r.stopped["acct-aaa"]).toBe("quota");
    expect(sent).toHaveLength(0);
  });

  it("stops the whole run when every account has stopped", async () => {
    const db = freshDb();
    const authErr = Object.assign(new Error("bad"), { code: "EAUTH" });
    const { mailerFor } = mailers({ "acct-aaa": async () => { throw authErr; }, "acct-bbb": async () => { throw authErr; } });
    const events = [];
    await run(db, [A, B], { mailerFor, onProgress: (e) => events.push(e) });
    expect(events.some((e) => e.phase === "all_accounts_stopped")).toBe(true);
  });

  it("a refused recipient address fails only that email, not the account", async () => {
    const db = freshDb();
    const refused = Object.assign(new Error("550 No such user"), { responseCode: 550 });
    const { sent, mailerFor } = mailers({ "acct-aaa": async (m) => { if (m.to === "priya@example.com") throw refused; } });
    const r = await run(db, [A], { mailerFor });
    expect(sent.map((m) => m.to)).toEqual(["rahul@example.com"]);
    expect(r.failed).toBe(1);
    expect(r.stopped).toEqual({});
  });

  it("retries a transient error once and records success", async () => {
    const db = freshDb([["Priya Sharma", "+919812345678", "priya@example.com"]]);
    let calls = 0;
    const { sent, mailerFor } = mailers({ "acct-aaa": async () => { if (++calls === 1) throw Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }); } });
    const r = await run(db, [A], { mailerFor });
    expect(calls).toBe(2);
    expect(r.sent).toBe(1);
    expect(sent).toHaveLength(1);
  });

  it("three transient failures in a row stop that account", async () => {
    const db = freshDb([["P1", "+919800000001", "p1@x.co"], ["P2", "+919800000002", "p2@x.co"], ["P3", "+919800000003", "p3@x.co"], ["P4", "+919800000004", "p4@x.co"]]);
    const { mailerFor } = mailers({ "acct-aaa": async () => { throw Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }); } });
    const r = await run(db, [A], { mailerFor });
    expect(r.stopped["acct-aaa"]).toBe("transient");
    expect(r.failed).toBe(3);
  });

  it("respects each account's daily cap and rolling 24 h history", async () => {
    const db = freshDb();
    const tiny = validateAccount({ id: "acct-tny", preset: "gmail", user: "t@gmail.com", dailyCap: 1 });
    const { sent, mailerFor } = mailers();
    const r = await run(db, [tiny], { mailerFor });
    expect(sent).toHaveLength(1);
    expect(r.stopped["acct-tny"]).toBe("quota");
    // The cap is now used up for the next 24 h:
    const again = await run(db, [tiny], { mailerFor });
    expect(again.sent).toBe(0);
  });

  it("a cancelled run stops between sends", async () => {
    const db = freshDb();
    const ac = new AbortController();
    const { sent, mailerFor } = mailers({ "acct-aaa": async () => ac.abort() });
    const r = await run(db, [A], { mailerFor, signal: ac.signal });
    expect(r.cancelled).toBe(true);
    expect(sent).toHaveLength(1);
  });

  it("makes no mail calls when nobody is due", async () => {
    const db = freshDb();
    const { sent, mailerFor } = mailers();
    const r = await runEmailEngine({ db, settings, accounts: [A], mailerFor, dateOverride: "2026-07-01", ...quick });
    expect(r.sent).toBe(0);
    expect(sent).toHaveLength(0);
  });
});

describe("classifyMailError", () => {
  it("sorts errors into what the engine should do", () => {
    expect(classifyMailError({ code: "EAUTH" })).toBe("auth");
    expect(classifyMailError({ responseCode: 535, message: "x" })).toBe("auth");
    expect(classifyMailError({ message: "550 5.7.30 Basic authentication is not supported for Client Submission" })).toBe("auth");
    expect(classifyMailError({ responseCode: 550, message: "5.4.5 Daily user sending quota exceeded" })).toBe("quota");
    expect(classifyMailError({ responseCode: 550, message: "mailbox unavailable" })).toBe("recipient");
    expect(classifyMailError({ code: "EENVELOPE" })).toBe("recipient");
    expect(classifyMailError({ code: "ETIMEDOUT" })).toBe("transient");
    expect(classifyMailError(new Error("socket closed"))).toBe("transient");
  });
});

describe("friendlyMailError", () => {
  it("explains common failures in plain language", () => {
    expect(friendlyMailError({ code: "EAUTH" })).toMatch(/app password/);
    expect(friendlyMailError({ message: "550 5.7.30 Basic authentication is not supported for Client Submission" })).toMatch(/Gmail/);
    expect(friendlyMailError({ responseCode: 550, message: "5.4.5 Daily user sending limit exceeded" })).toMatch(/24 hours/);
    expect(friendlyMailError({ code: "ENOTFOUND", message: "getaddrinfo ENOTFOUND smtp.x" })).toMatch(/could not be found/);
    expect(friendlyMailError({ code: "ETIMEDOUT" })).toMatch(/reach the mail server/);
    expect(friendlyMailError(new Error("something odd"))).toBe("something odd");
  });
});
