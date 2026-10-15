// Sender accounts for the email channel. Pure: validation and capacity maths
// only -- no Electron, no network, and never a password (those live encrypted
// in electron/emailSecret.js and never reach the renderer).
//
// Every selected account emails every birthday person (it is not load
// sharing), so each account's daily cap has to cover the whole list.

import { isValidEmail } from "./emailAddress.js";

export const MAX_ACCOUNTS = 5;
export const DEFAULT_ACCOUNT_CAP = 100; // one vendor's test saw Gmail SMTP stop just past ~100/day
export const MAX_ACCOUNT_CAP = 200;

export const EMAIL_PRESETS = {
  gmail: { label: "Gmail", host: "smtp.gmail.com", port: 465, secure: true },
  // Microsoft is retiring password-based SMTP for business (Exchange Online)
  // accounts, so this may fail for some; "Test connection" reports it.
  outlook: { label: "Outlook / Microsoft 365", host: "smtp-mail.outlook.com", port: 587, secure: false },
  other: { label: "Other", host: "", port: 587, secure: false },
};

const ID_RE = /^[a-z0-9-]{3,40}$/;
const HOST_RE = /^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/;
const hasControl = (s) => /[\u0000-\u001f\u007f]/.test(s);

const fail = (msg) => {
  throw new Error(msg);
};

/** A fresh account id (lowercase letters/digits/dashes). */
export function makeAccountId(rand = Math.random) {
  return `acct-${Math.floor(rand() * 36 ** 6).toString(36).padStart(6, "0")}${Date.now().toString(36).slice(-4)}`;
}

/**
 * Validate one account from the renderer. Returns a cleaned copy.
 * @throws {Error} with a user-readable message
 */
export function validateAccount(input) {
  if (!input || typeof input !== "object") fail("The account details are not valid.");
  const preset = EMAIL_PRESETS[input.preset] ? input.preset : fail("Please choose Gmail, Outlook or Other.");
  const p = EMAIL_PRESETS[preset];

  const id = input.id === undefined || input.id === null ? makeAccountId() : ID_RE.test(String(input.id)) ? String(input.id) : fail("The account id is not valid.");

  const user = typeof input.user === "string" ? input.user.trim() : "";
  if (!user || user.length > 254 || hasControl(user)) fail("Please enter the email address or username you sign in with.");

  // The address mail is sent "from". For Gmail/Outlook it is the login itself;
  // for "Other" the login may be a plain username, so a separate address is needed.
  let fromEmail = typeof input.fromEmail === "string" ? input.fromEmail.trim() : "";
  if (!fromEmail && isValidEmail(user)) fromEmail = user;
  if (!isValidEmail(fromEmail)) fail("Please enter the email address the birthday emails should be sent from.");

  const host = preset === "other" ? (typeof input.host === "string" ? input.host.trim() : "") : p.host;
  if (!HOST_RE.test(host)) fail("Please enter the mail server name (for example smtp.example.com).");
  const port = preset === "other" ? Number(input.port) : p.port;
  if (!Number.isInteger(port) || port < 1 || port > 65535) fail("The mail server port must be a number between 1 and 65535.");
  const secure = preset === "other" ? (typeof input.secure === "boolean" ? input.secure : fail("Choose whether the connection is secure (SSL).")) : p.secure;

  const fromName = input.fromName === undefined || input.fromName === null ? "" : String(input.fromName).trim();
  if (fromName.length > 80 || hasControl(fromName)) fail("The sender name must be a single line of at most 80 characters.");
  const label = (input.label === undefined || input.label === null || String(input.label).trim() === "" ? fromEmail : String(input.label)).trim();
  if (label.length > 60 || hasControl(label)) fail("The account name must be a single line of at most 60 characters.");

  const cap = input.dailyCap === undefined || input.dailyCap === null || input.dailyCap === "" ? DEFAULT_ACCOUNT_CAP : Number(input.dailyCap);
  if (!Number.isInteger(cap) || cap < 1 || cap > MAX_ACCOUNT_CAP) fail(`The daily limit must be a whole number from 1 to ${MAX_ACCOUNT_CAP}.`);

  return { id, label, preset, host, port, secure, user, fromEmail, fromName, dailyCap: cap, enabled: input.enabled !== false };
}

/** Validate the whole list (count and uniqueness). @throws {Error} */
export function validateAccounts(list) {
  if (!Array.isArray(list)) fail("The account list is not valid.");
  if (list.length > MAX_ACCOUNTS) fail(`You can add up to ${MAX_ACCOUNTS} sender accounts.`);
  const accounts = list.map(validateAccount);
  if (new Set(accounts.map((a) => a.id)).size !== accounts.length) fail("Two accounts share the same id.");
  if (new Set(accounts.map((a) => a.fromEmail.toLowerCase())).size !== accounts.length) fail("That email address has already been added.");
  return accounts;
}

/** Same as validateAccounts but never throws: damaged entries are dropped. */
export function normalizeAccounts(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const a of raw) {
    try {
      const v = validateAccount(a);
      if (!out.some((x) => x.id === v.id || x.fromEmail.toLowerCase() === v.fromEmail.toLowerCase())) out.push(v);
    } catch {
      /* skip a damaged entry */
    }
    if (out.length >= MAX_ACCOUNTS) break;
  }
  return out;
}

/** How many more emails this account may send now (its cap minus the last 24 h). */
export function emailSendCapacity(account, sentLast24h) {
  return Math.max(0, account.dailyCap - Math.max(0, sentLast24h));
}
