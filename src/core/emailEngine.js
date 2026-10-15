// The email channel's engine: who is due an email today, and sending it.
// Kept apart from engine.js (WhatsApp) on purpose: its own ledger table
// (email_sends), its own pacing, and no WhatsApp client. Like engine.js it is
// pure with respect to Electron -- the mail transport is injected, so tests use
// a fake and a dry run never touches the network.
//
// Every selected sender account emails every due person (one email per
// person per account). An account that fails to log in or hits its sending
// limit is stopped for the run; the others carry on.

import { matchBirthdays, todayInTz } from "./birthdays.js";
import { renderMessage, namePostfixFrom } from "./messages.js";
import { buildBody, buildSubject, CARD_CID } from "./emailBody.js";
import { emailSendCapacity } from "./emailAccounts.js";
import { getMessagesConfig, listContacts, loadTerminalEmailKeys, countEmailsSentSince, recordEmailSend } from "./db.js";

const DAY_MS = 24 * 60 * 60 * 1000;
export const PAUSE_RANGE_MS = [1000, 3000]; // between two mails from one account

const ymdKey = (o) => `${o.year}-${String(o.month).padStart(2, "0")}-${String(o.day).padStart(2, "0")}`;

/** Ledger key: one row per sender + address + birthday. */
export function emailLedgerKey(senderId, email, occurrence) {
  return `${senderId}:${String(email).trim().toLowerCase()}:${occurrence}`;
}

/**
 * Classify a failed send so the engine knows what to do next.
 *   auth       -- bad login / app password: this account can't send at all
 *   quota      -- the provider's sending limit was reached: stop this account
 *   recipient  -- this address was refused: only this email failed
 *   transient  -- network hiccup or a temporary reply: worth one retry
 */
export function classifyMailError(err) {
  const code = String(err?.code ?? "");
  const rc = Number(err?.responseCode ?? 0);
  const msg = `${err?.message ?? ""} ${err?.response ?? ""}`.toLowerCase();
  if (code === "EAUTH" || rc === 535 || rc === 534 || rc === 530 || /invalid login|authentication|username and password not accepted|basic authentication is not supported/.test(msg)) return "auth";
  if (/daily user sending|sending limit|rate limit|quota|too many (messages|emails|recipients)|5\.4\.5|5\.2\.3|exceeded/.test(msg) || rc === 452 || rc === 454) return "quota";
  if (code === "EENVELOPE" || rc === 550 || rc === 551 || rc === 553 || rc === 554 || (rc >= 500 && rc < 600)) return "recipient";
  return "transient";
}

/** A plain-English version of a mail error, for the screen. */
export function friendlyMailError(err) {
  const kind = classifyMailError(err);
  const raw = String(err?.message ?? err ?? "").trim();
  if (/basic authentication is not supported/i.test(raw)) {
    return "Microsoft no longer accepts a password for this account type. Try a Gmail account, or ask your IT team.";
  }
  if (kind === "auth") return "The sign-in was refused. Check the email address and the app password (for Gmail, use an app password, not your normal password).";
  if (kind === "quota") return "This account has reached its sending limit. It can send again after about 24 hours.";
  if (/ENOTFOUND|EAI_AGAIN/.test(String(err?.code))) return "The mail server could not be found. Check the server name and your internet connection.";
  if (/ECONNREFUSED|ETIMEDOUT|ECONNRESET|ESOCKET|EDNS/.test(String(err?.code)) || /timed? ?out/i.test(raw)) return "Couldn't reach the mail server. Check your internet connection (and the server and port for an Other account).";
  if (/certificate|self.signed|ssl|tls/i.test(raw)) return "The secure connection to the mail server failed. Check the server name and the SSL setting.";
  return raw || "Sending failed.";
}

const FRIENDLY_STOP = {
  auth: "the sign-in was refused. Check the address and app password.",
  quota: "it reached its sending limit. It can send again after about 24 hours.",
};

/**
 * Who is due an email now, and what each sender still has to send.
 * @param {object} o
 * @param {object[]} o.accounts selected, enabled sender accounts
 * @returns {{today: string, people: object[], noEmail: object[], accounts: object[], totalEmails: number}}
 */
export function previewEmailsToday({ db, settings, accounts, dateOverride = null, now = new Date() }) {
  const contacts = listContacts(db).filter((c) => !c.skip);
  const today = todayInTz(settings.timezone, dateOverride);
  const matches = matchBirthdays(contacts, today, { catchupDays: settings.catchupDays, leapDayFallback: settings.leapDayFallback });

  const terminal = loadTerminalEmailKeys(db);
  const messagesConfig = getMessagesConfig(db);
  const postfix = namePostfixFrom(settings);
  const since = new Date(now.getTime() - DAY_MS).toISOString();
  const accountStats = accounts.map((a) => ({ id: a.id, label: a.label, pending: 0, capacityLeft: emailSendCapacity(a, countEmailsSentSince(db, a.id, since)), overCap: 0 }));

  const people = [];
  const noEmail = [];
  for (const m of matches) {
    const c = m.person;
    if (!c.email) {
      noEmail.push({ contactId: c.id, name: c.name });
      continue;
    }
    const occurrence = ymdKey(m.occurrence);
    const pendingSenders = accounts.filter((a) => !terminal.has(emailLedgerKey(a.id, c.email, occurrence))).map((a) => a.id);
    if (pendingSenders.length === 0) continue; // already emailed from every selected account
    people.push({
      contactId: c.id,
      name: c.name,
      email: c.email,
      belated: m.belated,
      occurrence,
      text: renderMessage(c, m.belated, messagesConfig, Math.random, postfix),
      subject: buildSubject(settings.emailSubject, c.name),
      pendingSenders,
    });
  }
  for (const s of accountStats) {
    s.pending = people.filter((p) => p.pendingSenders.includes(s.id)).length;
    s.overCap = Math.max(0, s.pending - s.capacityLeft);
  }
  return { today: ymdKey(today), people, noEmail, accounts: accountStats, totalEmails: people.reduce((n, p) => n + p.pendingSenders.length, 0) };
}

const defaultSleep = (ms, signal) =>
  new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(t), resolve()), { once: true });
  });

/**
 * Send the reviewed emails.
 * @param {object} o
 * @param {object[]} o.accounts selected sender accounts
 * @param {(account: object) => {sendMail: Function}} o.mailerFor returns a nodemailer-style transport
 * @param {((person: object) => Promise<Buffer>)|null} [o.renderCard]
 * @param {Record<number,string>} [o.approved] contactId -> reviewed wish text; only these people are emailed
 * @param {AbortSignal} [o.signal]
 */
export async function runEmailEngine({
  db,
  settings,
  accounts,
  mailerFor,
  renderCard = null,
  approved = null,
  signal,
  dateOverride = null,
  now = new Date(),
  sleep = defaultSleep,
  pauseRange = PAUSE_RANGE_MS,
  retryDelayMs = 5000,
  maxConsecutiveFailures = 3,
  onProgress = () => {},
}) {
  const preview = previewEmailsToday({ db, settings, accounts, dateOverride, now });
  const people = preview.people.filter((p) => !approved || Object.hasOwn(approved, p.contactId));
  onProgress({ phase: "matched", personCount: people.length, emailCount: people.reduce((n, p) => n + p.pendingSenders.length, 0) });

  const state = new Map(accounts.map((a) => [a, { stopped: null, failures: 0, capacity: preview.accounts.find((s) => s.id === a.id).capacityLeft, sent: 0, mailer: null }]));
  const byId = new Map(listContacts(db).map((c) => [c.id, c])); // full contact (salutation etc.) for the card
  const results = [];
  let cancelled = false;
  const pause = () => sleep(pauseRange[0] + Math.random() * (pauseRange[1] - pauseRange[0]), signal);

  const stop = (account, reason, detail) => {
    state.get(account).stopped = reason;
    onProgress({ phase: "account_stopped", account: { id: account.id, label: account.label }, reason, message: FRIENDLY_STOP[reason] ?? detail });
  };

  for (const person of people) {
    if (signal?.aborted) {
      cancelled = true;
      break;
    }
    if ([...state.values()].every((s) => s.stopped)) {
      onProgress({ phase: "all_accounts_stopped" });
      break;
    }

    let card = null;
    if (renderCard) {
      try {
        card = await renderCard(byId.get(person.contactId));
      } catch (err) {
        onProgress({ phase: "card_fallback", person: { name: person.name }, error: err.message || String(err) });
      }
    }
    const text = approved && typeof approved[person.contactId] === "string" ? approved[person.contactId] : person.text;
    const { text: plain, html } = buildBody({ text, hasCard: !!card });
    const subject = buildSubject(settings.emailSubject, person.name);

    for (const account of accounts) {
      const st = state.get(account);
      if (st.stopped || !person.pendingSenders.includes(account.id)) continue;
      if (signal?.aborted) {
        cancelled = true;
        break;
      }
      if (st.capacity <= 0) {
        stop(account, "quota", "it reached its daily limit.");
        continue;
      }
      const ledgerKey = emailLedgerKey(account.id, person.email, person.occurrence);
      onProgress({ phase: "sending", person: { name: person.name, email: person.email }, account: { id: account.id, label: account.label } });

      const message = {
        from: { name: account.fromName || "", address: account.fromEmail },
        to: person.email,
        subject,
        text: plain,
        html,
        attachments: card ? [{ filename: "birthday-card.jpg", content: card, cid: CARD_CID, contentType: "image/jpeg", contentDisposition: "inline" }] : [],
      };
      const record = (status, error) =>
        recordEmailSend(db, { contactId: person.contactId, ledgerKey, name: person.name, email: person.email, sender: account.id, occurrence: person.occurrence, status, error });

      try {
        st.mailer ??= mailerFor(account);
        try {
          await st.mailer.sendMail(message);
        } catch (err) {
          if (classifyMailError(err) !== "transient") throw err;
          await sleep(retryDelayMs, signal);
          if (signal?.aborted) throw err;
          await st.mailer.sendMail(message); // a second failure propagates
        }
        record("sent");
        st.capacity--;
        st.sent++;
        st.failures = 0;
        results.push({ person: person.name, sender: account.id, status: "sent" });
        onProgress({ phase: "sent", person: { name: person.name, email: person.email }, account: { id: account.id, label: account.label } });
      } catch (err) {
        const kind = classifyMailError(err);
        console.error(`[email] send failed (${account.label} -> ${person.email}):`, err);
        const errMessage = err.message || String(err);
        record("failed", errMessage);
        results.push({ person: person.name, sender: account.id, status: "failed", reason: errMessage });
        onProgress({ phase: "send_failed", person: { name: person.name, email: person.email }, account: { id: account.id, label: account.label }, error: errMessage, kind });
        if (kind === "auth" || kind === "quota") stop(account, kind, errMessage);
        else if (kind === "transient" && ++st.failures >= maxConsecutiveFailures) stop(account, "transient", `${st.failures} sends in a row failed (${errMessage}).`);
      }
      await pause();
    }
    if (cancelled) break;
  }

  onProgress({ phase: cancelled ? "cancelled" : "complete" });
  const stopped = Object.fromEntries([...state].filter(([, s]) => s.stopped).map(([a, s]) => [a.id, s.stopped]));
  return { results, stopped, cancelled, sent: results.filter((r) => r.status === "sent").length, failed: results.filter((r) => r.status === "failed").length };
}
