import { describe, it, expect } from "vitest";
import { validateAccount, validateAccounts, normalizeAccounts, emailSendCapacity, EMAIL_PRESETS, MAX_ACCOUNTS, DEFAULT_ACCOUNT_CAP } from "../src/core/emailAccounts.js";
import { buildSubject, buildBody, escapeHtml, CARD_CID } from "../src/core/emailBody.js";

const gmail = (o = {}) => ({ preset: "gmail", user: "me@gmail.com", ...o });

describe("validateAccount", () => {
  it("a Gmail account gets the preset server, a default cap and an id", () => {
    const a = validateAccount(gmail({ fromName: "Arthexa" }));
    expect(a).toMatchObject({ preset: "gmail", host: "smtp.gmail.com", port: 465, secure: true, fromEmail: "me@gmail.com", fromName: "Arthexa", dailyCap: DEFAULT_ACCOUNT_CAP, enabled: true });
    expect(a.id).toMatch(/^[a-z0-9-]{3,40}$/);
    expect(a.label).toBe("me@gmail.com");
  });
  it("ignores a host/port sent for a preset (can't be pointed elsewhere)", () => {
    const a = validateAccount(gmail({ host: "evil.example.com", port: 25 }));
    expect(a.host).toBe(EMAIL_PRESETS.gmail.host);
    expect(a.port).toBe(465);
  });
  it("'Other' needs a valid host, port and security choice", () => {
    const ok = validateAccount({ preset: "other", user: "me@corp.com", host: "smtp.corp.com", port: "587", secure: false });
    expect(ok).toMatchObject({ host: "smtp.corp.com", port: 587, secure: false });
    expect(() => validateAccount({ preset: "other", user: "me@corp.com", host: "bad host", port: 587, secure: false })).toThrow(/server/);
    expect(() => validateAccount({ preset: "other", user: "me@corp.com", host: "smtp.corp.com", port: 70000, secure: false })).toThrow(/port/);
    expect(() => validateAccount({ preset: "other", user: "me@corp.com", host: "smtp.corp.com", port: 587 })).toThrow(/secure/);
  });
  it("a plain username login needs a separate from-address", () => {
    expect(() => validateAccount({ preset: "other", user: "apikey", host: "smtp.x.com", port: 587, secure: false })).toThrow(/sent from/);
    expect(validateAccount({ preset: "other", user: "apikey", fromEmail: "me@x.com", host: "smtp.x.com", port: 587, secure: false }).fromEmail).toBe("me@x.com");
  });
  it("rejects line breaks in names, bad caps, unknown presets and a missing user", () => {
    expect(() => validateAccount(gmail({ fromName: "A\nBcc: x@y.com" }))).toThrow(/single line/);
    expect(() => validateAccount(gmail({ dailyCap: 0 }))).toThrow(/limit/);
    expect(() => validateAccount(gmail({ dailyCap: 5000 }))).toThrow(/limit/);
    expect(() => validateAccount({ preset: "yahoo", user: "a@b.co" })).toThrow(/Gmail, Outlook/);
    expect(() => validateAccount(gmail({ user: "" }))).toThrow(/sign in/);
    expect(() => validateAccount(null)).toThrow();
  });
  it("an id from outside must be well formed", () => {
    expect(() => validateAccount(gmail({ id: "../x" }))).toThrow(/id/);
    expect(validateAccount(gmail({ id: "acct-abc123" })).id).toBe("acct-abc123");
  });
});

describe("validateAccounts / normalizeAccounts", () => {
  it("limits the count and rejects duplicate addresses", () => {
    const many = Array.from({ length: MAX_ACCOUNTS + 1 }, (_, i) => gmail({ user: `u${i}@gmail.com` }));
    expect(() => validateAccounts(many)).toThrow(/up to/);
    expect(() => validateAccounts([gmail(), gmail({ user: "ME@gmail.com" })])).toThrow(/already been added/);
    expect(validateAccounts([gmail(), gmail({ user: "b@gmail.com" })])).toHaveLength(2);
  });
  it("normalizeAccounts drops damaged entries instead of throwing", () => {
    const good = validateAccount(gmail());
    expect(normalizeAccounts([good, { preset: "nope" }, null, good])).toEqual([good]);
    expect(normalizeAccounts(undefined)).toEqual([]);
  });
});

describe("emailSendCapacity", () => {
  it("is the cap minus the last 24 h, never negative", () => {
    expect(emailSendCapacity({ dailyCap: 100 }, 30)).toBe(70);
    expect(emailSendCapacity({ dailyCap: 100 }, 250)).toBe(0);
  });
});

describe("email body", () => {
  it("fills {name}, strips line breaks from the subject and caps its length", () => {
    expect(buildSubject("Happy Birthday {name}!", "Priya")).toBe("Happy Birthday Priya!");
    expect(buildSubject("Hi\r\nBcc: x@y.com {name}", "A")).not.toMatch(/[\r\n]/);
    expect(buildSubject("", "Priya")).toBe("Happy Birthday Priya!");
    expect(buildSubject("x".repeat(500), "A").length).toBe(200);
  });
  it("shows the card inline and escapes the wish text", () => {
    const { html, text } = buildBody({ text: "Hi <b>Priya</b> & co\nSecond line", hasCard: true });
    expect(html).toContain(`src="cid:${CARD_CID}"`);
    expect(html).toContain("Hi &lt;b&gt;Priya&lt;/b&gt; &amp; co<br>Second line");
    expect(html).not.toContain("<b>Priya");
    expect(text).toBe("Hi <b>Priya</b> & co\nSecond line");
  });
  it("has no image tag without a card", () => {
    expect(buildBody({ text: "Hello", hasCard: false }).html).not.toContain("<img");
  });
  it("escapeHtml covers quotes", () => {
    expect(escapeHtml(`"'<>&`)).toBe("&quot;&#39;&lt;&gt;&amp;");
  });
});
