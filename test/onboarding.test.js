import { describe, it, expect } from "vitest";
import { canSendWhatsapp, assertCanSendWhatsapp, whatsappSetupState, onboardingChecklist } from "../src/core/onboarding.js";

describe("canSendWhatsapp / assertCanSendWhatsapp", () => {
  it("needs both the accepted notice and a pairing", () => {
    expect(canSendWhatsapp({ riskAcknowledged: true, hasEverPaired: true })).toBe(true);
    expect(canSendWhatsapp({ riskAcknowledged: true, hasEverPaired: false })).toBe(false);
    expect(canSendWhatsapp({ riskAcknowledged: false, hasEverPaired: true })).toBe(false);
    expect(canSendWhatsapp({})).toBe(false);
    expect(canSendWhatsapp(undefined)).toBe(false);
  });
  it("the guard explains what to do, in plain words", () => {
    expect(() => assertCanSendWhatsapp({})).toThrow(/Set up WhatsApp/);
    expect(() => assertCanSendWhatsapp({ riskAcknowledged: true, hasEverPaired: true })).not.toThrow();
  });
});

describe("whatsappSetupState", () => {
  it("never / disconnected / paired", () => {
    expect(whatsappSetupState({}, { status: "disconnected" })).toBe("never");
    expect(whatsappSetupState({}, undefined)).toBe("never");
    expect(whatsappSetupState({ hasEverPaired: true }, { status: "disconnected" })).toBe("disconnected");
    expect(whatsappSetupState({ hasEverPaired: true }, { status: "error" })).toBe("disconnected");
    expect(whatsappSetupState({ hasEverPaired: true }, { status: "ready" })).toBe("paired");
    expect(whatsappSetupState({}, { status: "ready" })).toBe("paired");
  });
});

describe("onboardingChecklist", () => {
  it("a fresh install shows all three steps, WhatsApp and Email marked optional", () => {
    const c = onboardingChecklist({ settings: {}, contactCount: 0, emailReadyCount: 0 });
    expect(c.items.map((i) => [i.key, i.done])).toEqual([["contacts", false], ["whatsapp", false], ["email", false]]);
    expect(c.items.filter((i) => i.optional).map((i) => i.key)).toEqual(["whatsapp", "email"]);
    expect(c.show).toBe(true);
  });
  it("ticks each step from the real state, in any order", () => {
    expect(onboardingChecklist({ settings: {}, contactCount: 3, emailReadyCount: 1 }).items.map((i) => i.done)).toEqual([true, false, true]);
    expect(onboardingChecklist({ settings: { hasEverPaired: true }, contactCount: 0, emailReadyCount: 0 }).items.map((i) => i.done)).toEqual([false, true, false]);
  });
  it("hides itself when dismissed or when everything is done", () => {
    expect(onboardingChecklist({ settings: { onboardingDismissed: true }, contactCount: 0 }).show).toBe(false);
    const done = onboardingChecklist({ settings: { hasEverPaired: true }, contactCount: 5, emailReadyCount: 2 });
    expect(done.allDone).toBe(true);
    expect(done.show).toBe(false);
  });
});
