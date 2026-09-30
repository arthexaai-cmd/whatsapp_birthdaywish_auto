import { describe, it, expect, vi, beforeEach } from "vitest";
import { friendlyError, friendlyMessage, cleanMessage } from "../src/ui/errors.js";

const ipc = (channel, msg) => new Error(`Error invoking remote method '${channel}': Error: ${msg}`);

describe("friendlyError", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("strips Electron's IPC wrapper", () => {
    expect(cleanMessage(ipc("x", "boom"))).toBe("boom");
  });

  it("explains a WhatsApp LOGOUT", () => {
    expect(friendlyError(ipc("whatsapp:connect", "WhatsApp disconnected: LOGOUT"))).toMatch(/new QR code/);
  });

  it("explains a file locked by Excel", () => {
    expect(friendlyError(ipc("contacts:previewImport", "EBUSY: resource busy or locked, open 'C:\\x.xlsx'"))).toMatch(
      /open in another program/
    );
  });

  it("keeps the offending value for an invalid phone", () => {
    expect(friendlyError(ipc("contacts:upsert", 'Invalid phone number: "12345"'))).toMatch(/"12345" isn't a valid phone/);
  });

  it("falls back to the cleaned original message for unknown errors", () => {
    expect(friendlyError(ipc("x", "Something odd"))).toBe("Something odd");
  });

  it("handles a non-Error value", () => {
    expect(friendlyError(undefined)).toBe("Something went wrong. Please try again.");
  });

  const table = [
    ["WhatsApp disconnected: CONFLICT", /session/i],
    ["WhatsApp disconnected: UNPAIRED", /session/i],
    ["WhatsApp disconnected: TOS_BLOCK", /session/i],
    ["WhatsApp disconnected: NAVIGATION", /interrupted/i],
    ["WhatsApp disconnected: SOMETHING_NEW", /disconnected/i],
    ["WhatsApp auth failure: bad", /logged this computer out/i],
    ["Timed out waiting for the WhatsApp QR code to be scanned.", /QR code wasn't scanned/i],
    ["Protocol error (Runtime.callFunctionOn): Target closed", /interrupted/i],
    ["Execution context was destroyed", /interrupted/i],
    ["browser is already running for /tmp/x", /still shutting down/i],
    ["No installed browser (Edge/Chrome) was found", /Edge or Google Chrome/],
    ["runEngine: a connected waClient is required for a real run.", /isn't connected/],
    ["A run is already in progress.", /already in progress/],
    ["net::ERR_NAME_NOT_RESOLVED", /internet/i],
    ["getaddrinfo ENOTFOUND web.whatsapp.com", /internet/i],
    ["EACCES: permission denied, open '/tmp/x.xlsx'", /permission/i],
    ["ENOENT: no such file", /couldn't be found/i],
    ["xlsx roster file not found: /tmp/x.xlsx", /couldn't be found/i],
    ['Sheet "Contacts" not found in x. Available: A', /no sheet/i],
    ["Corrupted zip: can't find end of central directory", /couldn't be read as an Excel/i],
    ["UNIQUE constraint failed: contacts.phone_e164", /already exists/i],
    ["Could not detect this platform for a Chromium download.", /Chromium can't be downloaded/],
  ];
  for (const [raw, want] of table) {
    it(`maps: ${raw.slice(0, 55)}`, () => {
      expect(friendlyError(ipc("x", raw))).toMatch(want);
    });
  }

  it("F14: net::ERR_INTERNET_DISCONNECTED is a no-internet message", () => {
    expect(friendlyError(ipc("x", "net::ERR_INTERNET_DISCONNECTED"))).toMatch(/internet/i);
  });

  it("puppeteer's protocolTimeout text (seen when the internet drops mid-send) becomes plain language", () => {
    const raw = "Runtime.callFunctionOn timed out. Increase the 'protocolTimeout' setting in launch/connect calls for a higher timeout if needed.";
    expect(friendlyError(new Error(raw))).toMatch(/didn't respond in time/);
    expect(friendlyMessage({ message: raw })).toMatch(/lost internet connection/);
    expect(friendlyMessage({ message: raw })).not.toMatch(/protocolTimeout/);
  });

  it("never leaks the IPC wrapper or a stack-style prefix for unknown errors", () => {
    const out = friendlyError(ipc("run:start", "TypeError: Cannot read properties of undefined"));
    expect(out).not.toMatch(/Error invoking remote method/);
  });
});

describe("update errors", () => {
  it("maps GitHub / updater failures to plain language", () => {
    expect(friendlyMessage({ message: "HttpError: 403 rate limit exceeded" })).toMatch(/limiting update checks/);
    expect(friendlyMessage({ message: "Cannot find latest.yml in the latest release artifacts" })).toMatch(/No update information/);
    expect(friendlyMessage({ message: "HttpError: 404" })).toMatch(/No update information/);
    expect(friendlyMessage({ message: "sha512 checksum mismatch, expected a, got b" })).toMatch(/integrity check/);
  });
});
