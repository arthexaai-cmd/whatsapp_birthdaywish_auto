// Is a "ready" whatsapp-web.js client still usable? The manager marks a
// client ready once and reused it forever, so when the underlying browser
// died (crash, killed, sleep) every later run kept using the dead client and
// failed with "detached Frame" until the app was restarted. Ask the client
// itself before trusting it: a dead page makes getState() throw or hang.

/**
 * @param {{getState: () => Promise<string>}} client
 * @param {number} [timeoutMs]
 * @returns {Promise<boolean>} true only if WhatsApp reports CONNECTED in time
 */
export async function isClientAlive(client, timeoutMs = 10_000) {
  if (!client || typeof client.getState !== "function") return false;
  let timer;
  try {
    const state = await Promise.race([
      client.getState(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("health check timed out")), timeoutMs);
      }),
    ]);
    return state === "CONNECTED";
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
