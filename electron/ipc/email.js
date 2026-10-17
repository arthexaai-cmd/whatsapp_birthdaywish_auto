// IPC: the Email tab. Thin glue over src/core/email*.js. Passwords go in
// through saveAccount only and are stored encrypted (emailSecret.js); nothing
// here ever returns one -- the renderer only learns `hasPassword`.

import { ipcMain, app } from "electron";
import { getAllSettings, getSetting, setSetting } from "../../src/core/db.js";
import { normalizeAccounts, validateAccount, validateAccounts } from "../../src/core/emailAccounts.js";
import { previewEmailsToday, friendlyMailError } from "../../src/core/emailEngine.js";
import { buildBody, buildSubject, CARD_CID } from "../../src/core/emailBody.js";
import { makeCardRenderer } from "../../src/core/cardRender.js";
import { normalizeCardConfig } from "../../src/core/cardLayout.js";
import { emailManager, createTransport, selectAccounts } from "../emailManager.js";
import { deletePassword, hasPassword, setPassword } from "../emailSecret.js";
import { cardPaths } from "../cardPaths.js";
import { safeSend } from "../safeSend.js";

export function registerEmailIpc(db, mainWindow) {
  emailManager.on("progress", (event) => safeSend(mainWindow, "email:progress", event));

  const accounts = () => normalizeAccounts(getSetting(db, "emailAccounts", []));
  const withFlags = (list) => list.map((a) => ({ ...a, hasPassword: hasPassword(a.id) }));
  const find = (id) => accounts().find((a) => a.id === id) ?? (() => { throw new Error("That account no longer exists."); })();

  ipcMain.handle("email:listAccounts", () => withFlags(accounts()));

  // Add (no id) or edit an account. A password is required for a new account;
  // leaving it blank on an edit keeps the saved one.
  ipcMain.handle("email:saveAccount", (event, { account, password }) => {
    const clean = validateAccount(account);
    const others = accounts().filter((a) => a.id !== clean.id);
    const isNew = others.length === accounts().length;
    const list = validateAccounts([...others, clean]);
    const pw = typeof password === "string" ? password.replace(/\s+/g, "") : ""; // Google shows app passwords in groups of four
    if (isNew && !pw) throw new Error("Please enter the app password for this account.");
    if (pw) {
      if (pw.length > 200) throw new Error("That password is too long.");
      setPassword(clean.id, pw);
    }
    setSetting(db, "emailAccounts", list);
    return withFlags(list);
  });

  ipcMain.handle("email:deleteAccount", (event, id) => {
    const list = accounts().filter((a) => a.id !== id);
    deletePassword(id);
    setSetting(db, "emailAccounts", list);
    return withFlags(list);
  });

  // Sign in to the mail server without sending anything.
  ipcMain.handle("email:testAccount", async (event, id) => {
    const transport = createTransport(find(id));
    try {
      await transport.verify();
      return { ok: true };
    } catch (err) {
      throw new Error(friendlyMailError(err));
    } finally {
      transport.close?.();
    }
  });

  // A real birthday email to the account's own address, so the user sees
  // exactly what recipients will see (including the card).
  ipcMain.handle("email:sendTest", async (event, id) => {
    const account = find(id);
    const settings = getAllSettings(db);
    const render = makeCardRenderer({ settings, ...cardPaths() });
    let card = null;
    try {
      card = render ? await render({ name: "Test Person", firstName: "Test", salutation: "" }) : null;
    } catch {
      card = null; // a test email without the picture is still a useful test
    }
    const { text, html } = buildBody({ text: "This is a test of your birthday email. If you can see this, your account is set up correctly.", hasCard: !!card });
    const transport = createTransport(account);
    try {
      await transport.sendMail({
        from: { name: account.fromName || "", address: account.fromEmail },
        to: account.fromEmail,
        subject: buildSubject("Test: " + (settings.emailSubject ?? ""), "Test Person"),
        text,
        html,
        attachments: card ? [{ filename: "birthday-card.jpg", content: card, cid: CARD_CID, contentType: "image/jpeg", contentDisposition: "inline" }] : [],
      });
      return { ok: true, to: account.fromEmail, withCard: !!card };
    } catch (err) {
      throw new Error(friendlyMailError(err));
    } finally {
      transport.close?.();
    }
  });

  ipcMain.handle("email:previewToday", (event, { accountIds } = {}) => {
    const settings = getAllSettings(db);
    const picked = selectAccounts(settings, accountIds).filter((a) => hasPassword(a.id));
    return { ...previewEmailsToday({ db, settings, accounts: picked }), hasCard: Boolean(normalizeCardConfig(settings.cardConfig).image) };
  });

  ipcMain.handle("email:run", (event, { accountIds, approved }) =>
    emailManager.start({ db, accountIds, approved, userDataPath: app.getPath("userData") })
  );
  ipcMain.handle("email:cancel", () => {
    emailManager.cancel();
    return { ok: true };
  });
  ipcMain.handle("email:isActive", () => emailManager.isActive());
}
