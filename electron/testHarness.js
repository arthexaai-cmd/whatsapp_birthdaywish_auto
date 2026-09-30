// TEST MODE ONLY. Lets an automated test drive the app's sense of time so the
// automatic-mode scenarios (fire times, midnight, DST, catch-up, wake from
// sleep) can be checked in minutes instead of waiting for real time.
//
// Inert unless BOTH BIRTHDAY_BOT_TEST_CLOCK=1 and BIRTHDAY_BOT_USER_DATA (a
// scratch data folder) are set -- see isTestModeEnabled. A normal install
// never has either, so none of this runs and no port is opened.
//
// Control server: http://127.0.0.1:<BIRTHDAY_BOT_TEST_PORT|9333>
//   GET  /state                      -> { now, offsetMs, nextFireAt }
//   POST /clock/set     {iso}        -> jump "now" to that instant
//   POST /clock/advance {minutes}    -> move "now" (negative = backwards)
//   POST /scheduler/tick             -> run the scheduler's wall-clock check now
//   POST /scheduler/rearm            -> recompute the next fire time
//   POST /power/resume               -> emit the OS "resume from sleep" event
//   GET  /wa/fake                    -> { on, sent[], lookups[] } of the fake WhatsApp client
//   POST /wa/fake {on:false}|{...}   -> install/configure/remove the fake client (sends nothing)
//                                       config: notOnWa[], failLookup[], failSend[] (digits), sendDelayMs
//   POST /wa/fake/reset              -> clear its recorded sends
//   POST /wa/lookup {numbers[]}      -> real lookup only (never sends)
// BIRTHDAY_BOT_TEST_FAKE_WA=1 installs the fake client at boot.

import http from "node:http";
import { powerMonitor } from "electron";
import { createVirtualClock, isTestModeEnabled } from "../src/core/virtualClock.js";
import { whatsappManager } from "./whatsappManager.js";
import { createFakeWhatsappClient } from "../src/core/fakeWhatsapp.js";

let clock = null;
let fake = null; // the fake WhatsApp client while it is installed

/**
 * Make the app use a fake WhatsApp client (records sends, sends nothing). The
 * real client, if connected, is shut down first; its saved session stays on
 * disk. Test mode only.
 */
async function enableFakeWhatsapp(config = {}) {
  if (whatsappManager.client && !whatsappManager.client.isFake) await whatsappManager.disconnect();
  fake = createFakeWhatsappClient(config);
  whatsappManager.client = fake;
  whatsappManager._setState({ status: "ready", error: null, qrDataUrl: null });
  console.warn("[TEST MODE] FAKE WhatsApp client installed: nothing will be sent to anyone.");
}

async function disableFakeWhatsapp() {
  if (whatsappManager.client?.isFake) whatsappManager.client = null;
  fake = null;
  whatsappManager._setState({ status: "disconnected", error: null, qrDataUrl: null });
  console.warn("[TEST MODE] fake WhatsApp client removed; the next run will use the real (saved) session.");
}

/** Boot-time switch, so even the launch-time catch-up run can never reach real WhatsApp. */
export function installFakeWhatsappIfRequested() {
  if (!clock || process.env.BIRTHDAY_BOT_TEST_FAKE_WA !== "1") return false;
  fake = createFakeWhatsappClient();
  whatsappManager.client = fake;
  whatsappManager.status = "ready";
  console.warn("[TEST MODE] FAKE WhatsApp client installed at boot: nothing will be sent to anyone.");
  return true;
}

/** Replace the global Date with the virtual clock. Call first thing at startup. */
export function installVirtualClock() {
  if (!isTestModeEnabled()) return false;
  clock = createVirtualClock(Date);
  const start = process.env.BIRTHDAY_BOT_TEST_CLOCK_START; // e.g. relaunch "after" a fire time
  if (start) clock.setNow(start);
  globalThis.Date = clock.VirtualDate;
  console.warn("[TEST MODE] virtual clock installed -- the app's time is NOT the real time. Never use with real data.");
  return true;
}

/** Start the local control server. Returns the server, or null when not in test mode. */
export function startTestControlServer({ getScheduler }) {
  if (!clock) return null;
  const port = Number(process.env.BIRTHDAY_BOT_TEST_PORT) || 9333;

  const state = () => ({
    now: new Date().toISOString(),
    offsetMs: clock.getOffsetMs(),
    nextFireAt: getScheduler()?.getNextFireAt?.()?.toISOString?.() ?? null,
  });

  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      const send = (code, obj) => {
        res.writeHead(code, { "Content-Type": "application/json" });
        res.end(JSON.stringify(obj));
      };
      try {
        const args = body ? JSON.parse(body) : {};
        const route = `${req.method} ${req.url.split("?")[0]}`;
        switch (route) {
          case "GET /state":
            return send(200, state());
          case "POST /clock/set":
            clock.setNow(args.iso);
            return send(200, state());
          case "POST /clock/advance":
            clock.advance((Number(args.minutes) || 0) * 60_000);
            return send(200, state());
          case "POST /scheduler/tick":
            getScheduler()?._tick();
            return send(200, state());
          case "POST /scheduler/rearm":
            getScheduler()?.rearm();
            return send(200, state());
          case "GET /wa/fake":
            return send(200, { on: Boolean(fake), sent: fake?.sent ?? [], lookups: fake?.lookups ?? [] });
          case "POST /wa/fake": {
            (async () => {
              if (args.on === false) await disableFakeWhatsapp();
              else if (!fake) await enableFakeWhatsapp(args);
              else fake.configure(args);
              send(200, { on: Boolean(fake) });
            })();
            return;
          }
          case "POST /wa/fake/reset":
            if (fake) { fake.sent.length = 0; fake.lookups.length = 0; }
            return send(200, { ok: true });
          case "POST /wa/lookup": {
            // Lookup ONLY (never sends): what does WhatsApp say about these numbers?
            const client = whatsappManager.client;
            if (!client) return send(409, { error: "WhatsApp is not connected" });
            (async () => {
              const out = [];
              for (const n of args.numbers ?? []) {
                const row = { number: n };
                try { const r = await client.getNumberId(n); row.getNumberId = r ? r._serialized : null; } catch (e) { row.getNumberId = "ERR " + e.message; }
                try { row.isRegisteredUser = await client.isRegisteredUser(`${n}@c.us`); } catch (e) { row.isRegisteredUser = "ERR " + e.message; }
                out.push(row);
              }
              send(200, out);
            })();
            return;
          }
          case "POST /power/resume":
            powerMonitor.emit("resume");
            return send(200, state());
          default:
            return send(404, { error: `unknown route ${route}` });
        }
      } catch (err) {
        send(400, { error: err.message });
      }
    });
  });
  server.listen(port, "127.0.0.1", () => console.warn(`[TEST MODE] control server on http://127.0.0.1:${port}`));
  return server;
}
