// createClient's pairing lifecycle against a fake whatsapp-web.js Client:
// the QR timeout must not be reset by QR rotation, and an abort must tear
// the browser down and reject as "cancelled".

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const instances = [];
vi.mock("whatsapp-web.js", async () => {
  const { EventEmitter } = await import("node:events");
  class Client extends EventEmitter {
    constructor() {
      super();
      this.destroyed = false;
      instances.push(this);
    }
    initialize() {
      return new Promise(() => {}); // pairing never finishes on its own
    }
    async destroy() {
      this.destroyed = true;
    }
  }
  return { default: { Client, LocalAuth: class {} } };
});

const { createClient } = await import("../src/core/whatsapp.js");

beforeEach(() => {
  instances.length = 0;
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe("createClient pairing", () => {
  it("times out qrTimeoutMs after the FIRST QR even though WhatsApp keeps rotating it", async () => {
    const p = createClient({ sessionDir: "x", qrTimeoutMs: 60_000 });
    const rejected = p.then(() => "resolved", (e) => e.message);
    const client = instances[0];
    for (let t = 0; t < 10; t++) {
      client.emit("qr", `qr-${t}`);
      await vi.advanceTimersByTimeAsync(20_000); // a fresh QR every 20 s
    }
    expect(await rejected).toMatch(/Timed out waiting for the WhatsApp QR/);
    expect(client.destroyed).toBe(true);
  });

  it("does not time out before the limit", async () => {
    const p = createClient({ sessionDir: "x", qrTimeoutMs: 60_000 });
    let settled = false;
    p.then(() => (settled = true), () => (settled = true));
    instances[0].emit("qr", "qr");
    await vi.advanceTimersByTimeAsync(50_000);
    expect(settled).toBe(false);
    instances[0].emit("ready");
    await p;
    expect(settled).toBe(true);
  });

  it("abort tears the browser down and rejects as cancelled", async () => {
    const ac = new AbortController();
    const p = createClient({ sessionDir: "x", qrTimeoutMs: 60_000, signal: ac.signal });
    const result = p.then(() => null, (e) => e);
    instances[0].emit("qr", "qr");
    ac.abort();
    const err = await result;
    expect(err.cancelled).toBe(true);
    expect(err.message).toMatch(/cancelled/);
    expect(instances[0].destroyed).toBe(true);
  });

  it("an already-aborted signal cancels immediately", async () => {
    const ac = new AbortController();
    ac.abort();
    const err = await createClient({ sessionDir: "x", signal: ac.signal }).catch((e) => e);
    expect(err.cancelled).toBe(true);
  });

  it("a LOGOUT while pairing rejects with reason LOGOUT", async () => {
    const p = createClient({ sessionDir: "x" });
    const result = p.catch((e) => e);
    instances[0].emit("disconnected", "LOGOUT");
    expect((await result).reason).toBe("LOGOUT");
  });
});
