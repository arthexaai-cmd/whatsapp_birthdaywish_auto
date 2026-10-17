import { describe, it, expect, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { migrate, seedDefaultsIfEmpty, upsertContact } from "../src/core/db.js";
import { runEngine, previewToday } from "../src/core/engine.js";
import { DEFAULT_SETTINGS } from "../src/core/defaults.js";
import { createFakeWhatsappClient } from "../src/core/fakeWhatsapp.js";

function freshDb() {
  const db = new DatabaseSync(":memory:");
  migrate(db);
  seedDefaultsIfEmpty(db, { onTime: ["Happy birthday {name}!"], belated: ["Belated {name}!"], vars: {}, emoji: [] });
  upsertContact(db, { name: "Test Person", phoneE164: "+919812345678", birthMonth: 3, birthDay: 14 });
  return db;
}

const settingsWith = (messageFormat) => ({
  ...DEFAULT_SETTINGS,
  timezone: "UTC",
  messageFormat,
  pacing: {
    ...DEFAULT_SETTINGS.pacing,
    startJitterMinutes: [0, 0],
    batchSize: [10, 10],
    withinBatchSeconds: [0, 0],
    betweenBatchMinutes: [0, 0],
    typingMsPerChar: [0, 0],
    quietHours: ["00:00", "00:00"],
  },
  retry: { maxConsecutiveFailures: 2, retryBackoffSeconds: [0, 0] },
  selfNotifyEnabled: false,
});

const run = (db, format, extra = {}) =>
  runEngine({ db, settings: settingsWith(format), dateOverride: "2026-03-14", waClient: extra.waClient, applyStartJitter: false, ...extra });

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

describe("runEngine — message format", () => {
  it("text: sends only the text and never draws a card", async () => {
    const db = freshDb();
    const waClient = createFakeWhatsappClient();
    const renderCard = vi.fn(async () => JPEG);
    await run(db, "text", { waClient, renderCard });
    expect(renderCard).not.toHaveBeenCalled();
    expect(waClient.sent).toHaveLength(1);
    expect(waClient.sent[0].kind).toBe("text");
    expect(waClient.sent[0].text).toMatch(/^Happy birthday/);
  });

  it("image: sends one image with no caption", async () => {
    const db = freshDb();
    const waClient = createFakeWhatsappClient();
    const renderCard = vi.fn(async () => JPEG);
    const result = await run(db, "image", { waClient, renderCard });
    expect(renderCard).toHaveBeenCalledOnce();
    expect(renderCard.mock.calls[0][0].name).toBe("Test Person");
    expect(waClient.sent).toHaveLength(1);
    expect(waClient.sent[0]).toMatchObject({ kind: "image", caption: null });
    expect(waClient.sent[0].media.mimetype).toBe("image/jpeg");
    expect(Buffer.from(waClient.sent[0].media.data, "base64").equals(JPEG)).toBe(true);
    expect(result.results[0].status).toBe("sent");
  });

  it("both: sends one image with the wish as its caption", async () => {
    const db = freshDb();
    const waClient = createFakeWhatsappClient();
    await run(db, "both", { waClient, renderCard: async () => JPEG });
    expect(waClient.sent).toHaveLength(1);
    expect(waClient.sent[0].kind).toBe("image");
    expect(waClient.sent[0].caption).toMatch(/^Happy birthday/);
  });

  it("both: the reviewed (approved) text is the caption", async () => {
    const db = freshDb();
    const waClient = createFakeWhatsappClient();
    const { due } = previewToday({ db, settings: settingsWith("both"), dateOverride: "2026-03-14" });
    await run(db, "both", { waClient, renderCard: async () => JPEG, approved: { [due[0].ledgerKey]: "Reviewed wish" } });
    expect(waClient.sent[0].caption).toBe("Reviewed wish");
  });

  it("falls back to the text wish when no card renderer is available", async () => {
    const db = freshDb();
    const waClient = createFakeWhatsappClient();
    const events = [];
    const result = await run(db, "image", { waClient, renderCard: null, onProgress: (e) => events.push(e) });
    expect(waClient.sent).toHaveLength(1);
    expect(waClient.sent[0].kind).toBe("text");
    expect(result.results[0].status).toBe("sent");
    expect(events.some((e) => e.phase === "card_fallback")).toBe(true);
  });

  it("falls back to the text wish when drawing the card throws", async () => {
    const db = freshDb();
    const waClient = createFakeWhatsappClient();
    const events = [];
    await run(db, "both", {
      waClient,
      renderCard: async () => {
        throw new Error("font failed");
      },
      onProgress: (e) => events.push(e),
    });
    expect(waClient.sent[0].kind).toBe("text");
    expect(events.find((e) => e.phase === "card_fallback").error).toBe("font failed");
  });

  it("falls back to the text wish when the card itself won't send", async () => {
    const db = freshDb();
    const waClient = createFakeWhatsappClient({ failMediaSend: ["919812345678"] });
    const events = [];
    const result = await run(db, "image", { waClient, renderCard: async () => JPEG, onProgress: (e) => events.push(e) });
    expect(result.results[0].status).toBe("sent");
    expect(waClient.sent).toHaveLength(1);
    expect(waClient.sent[0].kind).toBe("text");
    expect(waClient.sent[0].text).toMatch(/^Happy birthday/);
    expect(events.find((e) => e.phase === "card_fallback").error).toBe("fake: media send failed");
    expect(events.some((e) => e.phase === "send_failed")).toBe(false);
  });

  // The whole point of the fallback: a WhatsApp Web change that breaks every
  // media send must not take the run down with it on the second person.
  it("a broken media path never aborts the run under maxConsecutiveFailures", async () => {
    const db = freshDb();
    upsertContact(db, { name: "Second", phoneE164: "+919800000002", birthMonth: 3, birthDay: 14 });
    upsertContact(db, { name: "Third", phoneE164: "+919800000003", birthMonth: 3, birthDay: 14 });
    const waClient = createFakeWhatsappClient({
      failMediaSend: ["919812345678", "919800000002", "919800000003"],
    });
    const events = [];
    const result = await run(db, "both", { waClient, renderCard: async () => JPEG, onProgress: (e) => events.push(e) });
    expect(result.results.map((r) => r.status)).toEqual(["sent", "sent", "sent"]);
    expect(waClient.sent.every((s) => s.kind === "text")).toBe(true);
    expect(events.some((e) => e.phase === "aborted_consecutive_failures")).toBe(false);
    // Each person burns two card attempts before the fallback, and sendCard's
    // typing simulation has a 1.5 s floor that pacing settings can't zero out.
  }, 30_000);

  it("records a failure only when the text fallback fails too", async () => {
    const db = freshDb();
    const waClient = createFakeWhatsappClient({ failSend: ["919812345678"] });
    const result = await run(db, "image", { waClient, renderCard: async () => JPEG });
    expect(result.results[0].status).toBe("failed");
    expect(waClient.sent).toHaveLength(0);
  });

  it("dry run reports the format and sends nothing", async () => {
    const db = freshDb();
    const result = await run(db, "both", { waClient: null, dryRun: true });
    expect(result.scheduled[0].format).toBe("both");
  });
});

describe("previewToday — message format", () => {
  it("reports the configured format so the review screen can show cards", () => {
    const db = freshDb();
    expect(previewToday({ db, settings: settingsWith("image"), dateOverride: "2026-03-14" }).messageFormat).toBe("image");
    expect(previewToday({ db, settings: { ...settingsWith("text"), messageFormat: undefined }, dateOverride: "2026-03-14" }).messageFormat).toBe("text");
  });
});
