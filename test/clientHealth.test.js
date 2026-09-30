import { describe, it, expect, vi, afterEach } from "vitest";
import { isClientAlive } from "../src/core/clientHealth.js";

afterEach(() => vi.useRealTimers());

describe("isClientAlive", () => {
  it("true when WhatsApp reports CONNECTED", async () => {
    expect(await isClientAlive({ getState: async () => "CONNECTED" })).toBe(true);
  });
  it("false for any other state (UNPAIRED, CONFLICT, OPENING, ...)", async () => {
    for (const s of ["UNPAIRED", "CONFLICT", "OPENING", "TIMEOUT", "", undefined]) {
      expect(await isClientAlive({ getState: async () => s }), String(s)).toBe(false);
    }
  });
  it("false when the browser is dead and getState throws (detached Frame)", async () => {
    expect(await isClientAlive({ getState: async () => { throw new Error("Attempted to use detached Frame"); } })).toBe(false);
  });
  it("false when getState hangs past the timeout", async () => {
    vi.useFakeTimers();
    const p = isClientAlive({ getState: () => new Promise(() => {}) }, 5000);
    await vi.advanceTimersByTimeAsync(5001);
    expect(await p).toBe(false);
  });
  it("false for a missing or malformed client", async () => {
    expect(await isClientAlive(null)).toBe(false);
    expect(await isClientAlive({})).toBe(false);
  });
});
