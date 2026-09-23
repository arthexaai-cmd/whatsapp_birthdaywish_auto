import { describe, it, expect, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { migrate, seedDefaultsIfEmpty, upsertContact, loadTerminalLedgerKeys, listRuns } from "../src/core/db.js";
import { runEngine } from "../src/core/engine.js";
import { DEFAULT_SETTINGS } from "../src/core/defaults.js";

function freshDb() {
  const db = new DatabaseSync(":memory:");
  migrate(db);
  seedDefaultsIfEmpty(db, {
    onTime: ["Happy birthday {name}!"],
    belated: ["Belated happy birthday {name}!"],
    vars: {},
  });
  return db;
}

function settingsFor(today) {
  return {
    ...DEFAULT_SETTINGS,
    timezone: "UTC",
    pacing: {
      ...DEFAULT_SETTINGS.pacing,
      startJitterMinutes: [0, 0],
      batchSize: [10, 10],
      withinBatchSeconds: [0, 0],
      betweenBatchMinutes: [0, 0],
      typingMsPerChar: [0, 0],
      quietHours: ["00:00", "00:00"], // degenerate = never quiet, see isQuietHours
    },
  };
}

/** A fake whatsapp-web.js Client: every number is "on WhatsApp" unless in notOnWa. */
function fakeClient({ notOnWa = new Set(), failNumbers = new Set() } = {}) {
  return {
    getNumberId: vi.fn(async (digits) => {
      if (notOnWa.has(digits)) return null;
      return { _serialized: `${digits}@c.us` };
    }),
    getChatById: vi.fn(async (chatId) => ({
      sendStateTyping: vi.fn(async () => {}),
    })),
    sendMessage: vi.fn(async (chatId) => {
      const digits = chatId.replace("@c.us", "");
      if (failNumbers.has(digits)) throw new Error("simulated send failure");
      return { id: "msg1" };
    }),
  };
}

function addPerson(db, overrides = {}) {
  return upsertContact(db, {
    name: "Test Person",
    phoneE164: "+919812345678",
    birthMonth: 3,
    birthDay: 14,
    ...overrides,
  });
}

describe("runEngine — applyStartJitter", () => {
  it("applies no start delay when applyStartJitter is false, even with a wide jitter range configured", async () => {
    const db = freshDb();
    addPerson(db);
    const settings = { ...settingsFor(), pacing: { ...settingsFor().pacing, startJitterMinutes: [50, 75] } };

    const before = Date.now();
    const result = await runEngine({
      db,
      settings,
      dryRun: true,
      dateOverride: "2026-03-14",
      waClient: null,
      applyStartJitter: false,
    });

    expect(result.scheduled).toHaveLength(1);
    const waitMs = new Date(result.scheduled[0].sendAt).getTime() - before;
    expect(waitMs).toBeLessThan(5000); // effectively immediate, not 50-75 minutes
  });

  it("applies the configured start jitter when applyStartJitter is true (the default)", async () => {
    const db = freshDb();
    addPerson(db);
    const settings = { ...settingsFor(), pacing: { ...settingsFor().pacing, startJitterMinutes: [50, 75] } };

    const before = Date.now();
    const result = await runEngine({
      db,
      settings,
      dryRun: true,
      dateOverride: "2026-03-14",
      waClient: null,
      // applyStartJitter omitted -- defaults to true
    });

    const waitMinutes = (new Date(result.scheduled[0].sendAt).getTime() - before) / 60_000;
    expect(waitMinutes).toBeGreaterThanOrEqual(50);
    expect(waitMinutes).toBeLessThanOrEqual(75.1); // small slack for test execution time
  });
});

describe("runEngine — dry run", () => {
  it("schedules matches, renders messages, sends nothing, writes no ledger rows", async () => {
    const db = freshDb();
    addPerson(db);
    const settings = settingsFor();

    const result = await runEngine({
      db,
      settings,
      dryRun: true,
      dateOverride: "2026-03-14",
      waClient: null,
    });

    expect(result.scheduled).toHaveLength(1);
    expect(result.scheduled[0].text).toContain("Test Person".split(" ")[0]);
    expect(loadTerminalLedgerKeys(db).size).toBe(0);
    expect(listRuns(db)).toHaveLength(0); // dry run never starts a `runs` row
  });

  it("returns nothing scheduled when there are no matches", async () => {
    const db = freshDb();
    addPerson(db, { birthMonth: 1, birthDay: 1 });
    const settings = settingsFor();

    const result = await runEngine({ db, settings, dryRun: true, dateOverride: "2026-03-14", waClient: null });
    expect(result.scheduled).toHaveLength(0);
  });
});

describe("runEngine — real send", () => {
  it("sends, records a ledger entry, and is idempotent on rerun", async () => {
    const db = freshDb();
    addPerson(db);
    const settings = settingsFor();
    const client = fakeClient();

    const result1 = await runEngine({ db, settings, dateOverride: "2026-03-14", waClient: client });
    expect(result1.results).toHaveLength(1);
    expect(result1.results[0].status).toBe("sent");
    expect(client.sendMessage).toHaveBeenCalledTimes(1);

    // Re-run the same day: already sent, so nothing new goes out.
    const result2 = await runEngine({ db, settings, dateOverride: "2026-03-14", waClient: client });
    expect(result2.scheduled).toHaveLength(0);
    expect(client.sendMessage).toHaveBeenCalledTimes(1); // unchanged
  });

  it("hard-skips a number not on WhatsApp and never retries it", async () => {
    const db = freshDb();
    addPerson(db);
    const settings = settingsFor();
    const client = fakeClient({ notOnWa: new Set(["919812345678"]) });

    const result = await runEngine({ db, settings, dateOverride: "2026-03-14", waClient: client });
    expect(result.results[0].status).toBe("not_on_whatsapp");
    expect(client.sendMessage).not.toHaveBeenCalled();

    const keys = loadTerminalLedgerKeys(db);
    expect(keys.size).toBe(1); // not_on_whatsapp is terminal -- never retried
  });

  it("throws if a real run is attempted with no waClient", async () => {
    const db = freshDb();
    addPerson(db);
    await expect(runEngine({ db, settings: settingsFor(), dateOverride: "2026-03-14", waClient: null })).rejects.toThrow(
      /waClient is required/
    );
  });

  it("aborts after maxConsecutiveFailures and leaves the rest for next run", async () => {
    const db = freshDb();
    addPerson(db, { name: "A", phoneE164: "+911111111111", birthMonth: 3, birthDay: 14 });
    addPerson(db, { name: "B", phoneE164: "+912222222222", birthMonth: 3, birthDay: 14 });
    addPerson(db, { name: "C", phoneE164: "+913333333333", birthMonth: 3, birthDay: 14 });

    const settings = { ...settingsFor(), retry: { maxConsecutiveFailures: 2, retryBackoffSeconds: [0, 0] } };
    const client = fakeClient({ failNumbers: new Set(["911111111111", "912222222222", "913333333333"]) });

    const result = await runEngine({ db, settings, dateOverride: "2026-03-14", waClient: client });
    // Stops after 2 consecutive failures, leaving the 3rd person unattempted.
    expect(result.results.filter((r) => r.status === "failed")).toHaveLength(2);
    expect(result.results).toHaveLength(2);
  });

  it("supports cancellation via AbortSignal between sends", async () => {
    const db = freshDb();
    addPerson(db, { name: "A", phoneE164: "+911111111111", birthMonth: 3, birthDay: 14 });
    addPerson(db, { name: "B", phoneE164: "+912222222222", birthMonth: 3, birthDay: 14 });

    const settings = settingsFor();
    const client = fakeClient();
    const controller = new AbortController();
    controller.abort(); // cancel before the loop even starts

    const result = await runEngine({ db, settings, dateOverride: "2026-03-14", waClient: client, signal: controller.signal });
    expect(result.cancelled).toBe(true);
    expect(result.results).toHaveLength(0);
    expect(listRuns(db)[0].status).toBe("cancelled");
  });
});

describe("runEngine — belated matching", () => {
  it("marks a match from a prior day as belated and uses the belated template", async () => {
    const db = freshDb();
    addPerson(db, { birthMonth: 3, birthDay: 12 }); // 2 days before "today"
    const settings = { ...settingsFor(), catchupDays: 2 };

    const result = await runEngine({ db, settings, dryRun: true, dateOverride: "2026-03-14", waClient: null });
    expect(result.scheduled[0].belated).toBe(true);
    expect(result.scheduled[0].text).toMatch(/Belated/);
  });
});
