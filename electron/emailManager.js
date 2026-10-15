// Runs the email engine with a cancellation controller and forwards progress.
// One email run at a time (mirrors runManager.js for WhatsApp). Builds a
// nodemailer transport per sender account from its saved settings plus the
// decrypted password.

import { EventEmitter } from "node:events";
import nodemailer from "nodemailer";
import { getAllSettings } from "../src/core/db.js";
import { normalizeAccounts } from "../src/core/emailAccounts.js";
import { runEmailEngine } from "../src/core/emailEngine.js";
import { makeCardRenderer } from "../src/core/cardRender.js";
import { cardPaths } from "./cardPaths.js";
import { getPassword } from "./emailSecret.js";

/** A nodemailer transport for one account. TLS 1.2+ and sane timeouts. */
export function createTransport(account) {
  const pass = getPassword(account.id);
  if (!pass) throw new Error(`"${account.label}" has no password saved. Please enter it again.`);
  return nodemailer.createTransport({
    host: account.host,
    port: account.port,
    secure: account.secure,
    auth: { user: account.user, pass },
    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
    socketTimeout: 30_000,
    tls: { minVersion: "TLSv1.2" },
  });
}

/** The enabled accounts with these ids, in saved order. */
export function selectAccounts(settings, accountIds) {
  const wanted = new Set(accountIds ?? []);
  return normalizeAccounts(settings.emailAccounts).filter((a) => a.enabled && wanted.has(a.id));
}

class EmailManager extends EventEmitter {
  constructor() {
    super();
    this.active = false;
    this.controller = null;
  }

  isActive() {
    return this.active;
  }

  async start({ db, accountIds, approved = null, userDataPath }) {
    if (this.active) throw new Error("Emails are already being sent.");
    const settings = getAllSettings(db);
    const accounts = selectAccounts(settings, accountIds);
    if (accounts.length === 0) throw new Error("Choose at least one sender account.");

    this.active = true;
    this.controller = new AbortController();
    const transports = new Map();
    try {
      const mailerFor = (account) => {
        if (!transports.has(account.id)) transports.set(account.id, createTransport(account));
        return transports.get(account.id);
      };
      return await runEmailEngine({
        db,
        settings,
        accounts,
        mailerFor,
        renderCard: makeCardRenderer({ settings, ...cardPaths(userDataPath) }),
        approved,
        signal: this.controller.signal,
        onProgress: (event) => this.emit("progress", event),
      });
    } finally {
      for (const t of transports.values()) t.close?.();
      this.active = false;
      this.controller = null;
    }
  }

  cancel() {
    this.controller?.abort();
  }
}

export const emailManager = new EmailManager();
