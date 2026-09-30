// A stand-in for the whatsapp-web.js Client, for TEST MODE ONLY
// (electron/testHarness.js). It has the same surface the engine uses
// (getNumberId, getChatById, sendMessage, getState) but records every "send" in
// memory and never contacts WhatsApp -- so the whole automatic-mode logic can
// be exercised against real contacts with zero risk of messaging anyone.
//
// Behaviour is scriptable per number (digits only, no "+"): not on WhatsApp,
// lookup errors, send errors, and a per-send delay to keep a run "active".

export function createFakeWhatsappClient(config = {}) {
  const cfg = {
    notOnWa: new Set(config.notOnWa ?? []),
    failLookup: new Set(config.failLookup ?? []),
    failSend: new Set(config.failSend ?? []),
    sendDelayMs: config.sendDelayMs ?? 0,
  };
  const sent = [];
  const lookups = [];
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));

  return {
    isFake: true,
    sent,
    lookups,
    configure(patch = {}) {
      for (const key of ["notOnWa", "failLookup", "failSend"]) if (patch[key]) cfg[key] = new Set(patch[key]);
      if (patch.sendDelayMs !== undefined) cfg.sendDelayMs = patch.sendDelayMs;
    },
    async getNumberId(digits) {
      lookups.push(digits);
      if (cfg.failLookup.has(digits)) throw new Error("fake: lookup failed");
      return cfg.notOnWa.has(digits) ? null : { _serialized: `${digits}@c.us` };
    },
    async getChatById() {
      return { sendStateTyping: async () => {} };
    },
    async sendMessage(chatId, text) {
      const digits = String(chatId).replace("@c.us", "");
      if (cfg.sendDelayMs) await delay(cfg.sendDelayMs);
      if (cfg.failSend.has(digits)) throw new Error("fake: send failed");
      sent.push({ chatId, digits, text, at: new Date().toISOString() });
      return { id: `fake-${sent.length}` };
    },
    // isClientAlive() health check in whatsappManager
    async getState() {
      return "CONNECTED";
    },
    async destroy() {},
    async logout() {},
  };
}
