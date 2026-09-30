import { describe, it, expect } from "vitest";
import { createFakeWhatsappClient } from "../src/core/fakeWhatsapp.js";
import { isClientAlive } from "../src/core/clientHealth.js";
import { resolveWhatsappId, sendWithTyping } from "../src/core/whatsapp.js";

describe("fake WhatsApp client (test mode)", () => {
  it("records sends in memory and reports a healthy connection", async () => {
    const c = createFakeWhatsappClient();
    expect(await isClientAlive(c)).toBe(true);
    const id = await resolveWhatsappId(c, "+919812345678");
    expect(id).toBe("919812345678@c.us");
    await sendWithTyping(c, id, "Happy birthday!", [0, 0]);
    expect(c.sent).toHaveLength(1);
    expect(c.sent[0]).toMatchObject({ digits: "919812345678", text: "Happy birthday!" });
  });
  it("scripted: not on WhatsApp, lookup error, send error", async () => {
    const c = createFakeWhatsappClient({ notOnWa: ["911"], failLookup: ["912"], failSend: ["913"] });
    expect(await resolveWhatsappId(c, "+911")).toBeNull();
    await expect(resolveWhatsappId(c, "+912")).rejects.toThrow(/lookup failed/);
    await expect(c.sendMessage("913@c.us", "x")).rejects.toThrow(/send failed/);
    expect(c.sent).toHaveLength(0);
  });
  it("configure() changes behaviour live, and a send delay is honoured", async () => {
    const c = createFakeWhatsappClient();
    c.configure({ notOnWa: ["914"], sendDelayMs: 40 });
    expect(await c.getNumberId("914")).toBeNull();
    const t0 = Date.now();
    await c.sendMessage("915@c.us", "hi");
    expect(Date.now() - t0).toBeGreaterThanOrEqual(35);
  });
  it("has no imports at all, so it cannot reach WhatsApp or the network", async () => {
    const src = (await import("node:fs")).readFileSync(new URL("../src/core/fakeWhatsapp.js", import.meta.url), "utf8");
    expect(src).not.toMatch(/^\s*import\s/m);
    expect(src).not.toMatch(/require\(|fetch\(|https?:\/\/(?!$)/);
  });
});
