import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { wipeAppData } from "../src/core/reset.js";

describe("wipeAppData", () => {
  it("deletes the DB, WhatsApp session and web cache, and keeps the browser download", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-reset-"));
    for (const f of ["birthday-bot.sqlite", "birthday-bot.sqlite-wal", "birthday-bot.sqlite-shm", "main.log"]) {
      fs.writeFileSync(path.join(dir, f), "x");
    }
    for (const d of ["wa-session/session/Default", "wwebjs-cache", "chromium/win64"]) {
      fs.mkdirSync(path.join(dir, d), { recursive: true });
    }
    fs.writeFileSync(path.join(dir, "wa-session/session/Default/Cookies"), "x");

    const { removed, failed } = wipeAppData(dir);

    expect(failed).toEqual([]);
    expect(removed.sort()).toEqual(
      ["birthday-bot.sqlite", "birthday-bot.sqlite-shm", "birthday-bot.sqlite-wal", "main.log", "wa-session", "wwebjs-cache"].sort()
    );
    expect(fs.readdirSync(dir)).toEqual(["chromium"]);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("is a no-op on an already-empty data folder", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-reset-"));
    expect(wipeAppData(dir)).toEqual({ removed: [], failed: [] });
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
