// WhatsApp failure matrix at the engine level (E2, E5, E8, E11, E16, E17 in
// docs/TEST_PLAN.md): a fake client whose calls fail on demand.

import { describe, it, expect, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { migrate, seedDefaultsIfEmpty, upsertContact, listRuns, getRunSends, loadTerminalLedgerKeys } from "../src/core/db.js";
import { runEngine, previewToday } from "../src/core/engine.js";
import { DEFAULT_SETTINGS } from "../src/core/defaults.js";

const DAY = "2026-03-14";

function freshDb() {
  const db = new DatabaseSync(":memory:");
  migrate(db);
  seedDefaultsIfEmpty(db, { onTime: ["Happy birthday {name}!"], belated: ["Belated happy birthday {name}!"], vars: {} });
  return db;
}

const settings = (over = {}) => ({
  ...DEFAULT_SETTINGS,
  timezone: "UTC",
  selfNotifyEnabled: false,
  retry: { maxConsecutiveFailures: 2, retryBackoffSeconds: [0, 0] },
  pacing: {
    ...DEFAULT_SETTINGS.pacing,
    startJitterMinutes: [0, 0],
    batchSize: [10, 10],
    withinBatchSeconds: [0, 0],
    betweenBatchMinutes: [0, 0],
    typingMsPerChar: [0, 0],
    quietHours: ["00:00", "00:00"],
  },
  ...over,
});

const person = (db, n) =>
  upsertContact(db, { name: `P${n}`, phoneE164: `+91981234000${n}`, birthMonth: 3, birthDay: 14 });

function client(over = {}) {
  return {
    getNumberId: vi.fn(async (d) => ({ _serialized: `${d}@c.us` })),
    getChatById: vi.fn(async () => ({ sendStateTyping: vi.fn(async () => {}) })),
    sendMessage: vi.fn(async () => ({ id: "m" })),
    ...over,
  };
}

const run = (db, c, extra = {}) => runEngine({ db, settings: settings(), dateOverride: DAY, waClient: c, ...extra });

describe("send retry path", () => {
  it("first send fails, retry succeeds -> recorded as sent", async () => {
    const db = freshDb();
    person(db, 1);
    let calls = 0;
    const c = client({ sendMessage: vi.fn(async () => { if (++calls === 1) throw new Error("boom"); return {}; }) });
    const r = await run(db, c);
    expect(r.results[0].status).toBe("sent");
    expect(c.sendMessage).toHaveBeenCalledTimes(2);
  });

  it("both attempts fail -> failed row with the error, and it is retryable next run", async () => {
    const db = freshDb();
    person(db, 1);
    const c = client({ sendMessage: vi.fn(async () => { throw new Error("Evaluation failed: x"); }) });
    const r = await run(db, c);
    expect(r.results[0]).toMatchObject({ status: "failed", reason: "Evaluation failed: x" });
    expect(loadTerminalLedgerKeys(db).size).toBe(0); // failed is not terminal

    const c2 = client();
    const r2 = await run(db, c2);
    expect(r2.results[0].status).toBe("sent"); // retry overwrites the failure
    expect(getRunSends(db, listRuns(db)[0].id)[0].status).toBe("sent");
  });
});

describe("typing indicator is cosmetic (regression c489185)", () => {
  it("getChatById throwing does not block the send", async () => {
    const db = freshDb();
    person(db, 1);
    const c = client({ getChatById: vi.fn(async () => { throw new Error("Store changed"); }) });
    const r = await run(db, c);
    expect(r.results[0].status).toBe("sent");
    expect(c.sendMessage).toHaveBeenCalledTimes(1);
  });
  it("sendStateTyping throwing does not block the send", async () => {
    const db = freshDb();
    person(db, 1);
    const c = client({ getChatById: vi.fn(async () => ({ sendStateTyping: async () => { throw new Error("x"); } })) });
    expect((await run(db, c)).results[0].status).toBe("sent");
  });
});

describe("number lookup failures (F8)", () => {
  it("getNumberId throwing is recorded failed, and 2 in a row abort the run", async () => {
    const db = freshDb();
    [1, 2, 3].forEach((n) => person(db, n));
    const c = client({ getNumberId: vi.fn(async () => { throw new Error("net::ERR_INTERNET_DISCONNECTED"); }) });
    const r = await run(db, c);
    expect(r.results.map((x) => x.status)).toEqual(["failed", "failed"]);
    expect(c.sendMessage).not.toHaveBeenCalled();
    // Third person untouched: still due next run.
    expect(previewToday({ db, settings: settings(), dateOverride: DAY }).due).toHaveLength(3);
  });

  it("not_on_whatsapp does not count toward consecutive failures", async () => {
    const db = freshDb();
    [1, 2, 3, 4].forEach((n) => person(db, n));
    const c = client({ getNumberId: vi.fn(async (d) => (d.endsWith("1") || d.endsWith("2") || d.endsWith("3") ? null : { _serialized: `${d}@c.us` })) });
    const r = await run(db, c);
    expect(r.results.filter((x) => x.status === "not_on_whatsapp")).toHaveLength(3);
    expect(r.results.filter((x) => x.status === "sent")).toHaveLength(1);
  });

  it("a success in between resets the consecutive-failure counter", async () => {
    const db = freshDb();
    [1, 2, 3, 4, 5].forEach((n) => person(db, n));
    // Send order is shuffled, so alternate by order of first appearance
    // (fail, ok, fail, ok, fail): never 2 failures in a row.
    const order = [];
    const c = client({
      sendMessage: vi.fn(async (chat) => {
        if (!order.includes(chat)) order.push(chat);
        if (order.indexOf(chat) % 2 === 0) throw new Error("x");
        return {};
      }),
    });
    const r = await run(db, c);
    expect(r.results).toHaveLength(5);
    expect(r.results.filter((x) => x.status === "sent")).toHaveLength(2);
  });
});

describe("cancellation (E16)", () => {
  it("abort during a run stops between sends; sent people stay recorded; run marked cancelled", async () => {
    const db = freshDb();
    [1, 2, 3].forEach((n) => person(db, n));
    const controller = new AbortController();
    const c = client({
      sendMessage: vi.fn(async () => {
        controller.abort(); // user presses Stop after the first send
        return {};
      }),
    });
    const r = await run(db, c, { signal: controller.signal });
    expect(r.cancelled).toBe(true);
    expect(r.results).toHaveLength(1);
    expect(listRuns(db)[0].status).toBe("cancelled");
    expect(loadTerminalLedgerKeys(db).size).toBe(1);
  });

  it("abort while backing off after a failed send stops without a second attempt", async () => {
    const db = freshDb();
    person(db, 1);
    const controller = new AbortController();
    const c = client({
      sendMessage: vi.fn(async () => {
        setTimeout(() => controller.abort(), 0);
        throw new Error("boom");
      }),
    });
    const r = await runEngine({
      db,
      settings: settings({ retry: { maxConsecutiveFailures: 2, retryBackoffSeconds: [30, 30] } }),
      dateOverride: DAY,
      waClient: c,
      signal: controller.signal,
    });
    expect(c.sendMessage).toHaveBeenCalledTimes(1);
    expect(r.results[0].status).toBe("failed");
  });
});

describe("approved (manual review) text", () => {
  it("sends the reviewed text word for word and only the reviewed people", async () => {
    const db = freshDb();
    [1, 2].forEach((n) => person(db, n));
    const s = settings();
    const { due } = previewToday({ db, settings: s, dateOverride: DAY });
    const first = due[0];
    const approved = { [first.ledgerKey]: "EXACT REVIEWED TEXT" };
    const c = client();
    const r = await run(db, c, { approved });
    expect(r.results).toHaveLength(1);
    expect(c.sendMessage).toHaveBeenCalledWith(expect.any(String), "EXACT REVIEWED TEXT");
  });
});

describe("self-notify (E17)", () => {
  it("a failing summary message does not break or fail the run", async () => {
    const db = freshDb();
    person(db, 1);
    const events = [];
    let lookups = 0;
    const c = client({
      getNumberId: vi.fn(async (d) => {
        if (++lookups > 1) throw new Error("self lookup failed"); // 2nd lookup = the self-notify number
        return { _serialized: `${d}@c.us` };
      }),
    });
    const res = await runEngine({
      db,
      settings: settings({ selfNotifyEnabled: true, selfNotifyNumber: "+919999999999" }),
      dateOverride: DAY,
      waClient: c,
      onProgress: (e) => events.push(e.phase),
    });
    expect(res.results[0].status).toBe("sent");
    expect(events).toContain("self_notify_failed");
    expect(listRuns(db)[0].status).toBe("completed");
  });
});

describe("ledger idempotency across runs", () => {
  it("running twice sends once", async () => {
    const db = freshDb();
    person(db, 1);
    const c = client();
    await run(db, c);
    await run(db, c);
    expect(c.sendMessage).toHaveBeenCalledTimes(1);
  });
});

describe("quiet hours at send time (F7)", () => {
  it("stops before sending when the clock has moved into quiet hours since planning", async () => {
    const db = freshDb();
    [1, 2, 3].forEach((n) => person(db, n));
    // Planned at 12:00 UTC (fine); the second send happens at 22:00 (quiet, 21:30-08:30).
    const times = ["2026-03-14T12:00:00Z", "2026-03-14T12:00:00Z", "2026-03-14T22:00:00Z", "2026-03-14T22:00:00Z"];
    let call = 0;
    vi.useFakeTimers({ toFake: ["Date"] }); // only the clock; real timers keep the engine's waits working
    vi.setSystemTime(new Date(times[0]));
    const c = client({
      sendMessage: vi.fn(async () => {
        call++;
        if (call === 1) vi.setSystemTime(new Date(times[2])); // the laptop "slept" until 22:00
        return {};
      }),
    });
    const events = [];
    const r = await runEngine({
      db,
      settings: settings({ pacing: { ...settings().pacing, quietHours: ["21:30", "08:30"] } }),
      dateOverride: DAY,
      waClient: c,
      onProgress: (e) => events.push(e.phase),
    });
    vi.useRealTimers();
    expect(c.sendMessage).toHaveBeenCalledTimes(1);
    expect(r.results).toHaveLength(1);
    expect(events).toContain("deferred_quiet_hours");
    expect(listRuns(db)[0].status).toBe("completed");
    // The two people not reached are still due next run.
    expect(previewToday({ db, settings: settings(), dateOverride: DAY }).due).toHaveLength(2);
  });
});
