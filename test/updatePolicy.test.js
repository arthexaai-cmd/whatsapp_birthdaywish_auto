import { describe, it, expect } from "vitest";
import {
  canInstallNow,
  shouldCheckNow,
  reduceUpdateState,
  INITIAL_UPDATE_STATE,
  INSTALL_GUARD_MINUTES,
} from "../src/core/updatePolicy.js";
import { validateSetting } from "../src/core/settingsValidation.js";
import { DEFAULT_SETTINGS } from "../src/core/defaults.js";

const at = (iso) => new Date(iso);
const auto = { sendMode: "auto", schedulingPaused: false, reminderEnabled: true };
const manual = { sendMode: "manual", schedulingPaused: false, reminderEnabled: true };

describe("canInstallNow", () => {
  const now = at("2026-10-01T10:00:00Z");
  it("refuses while a run is active, in any mode", () => {
    for (const settings of [auto, manual]) {
      const r = canInstallNow({ runActive: true, settings, nextFireAt: null, now });
      expect(r.ok).toBe(false);
      expect(r.reason).toMatch(/being sent/);
    }
  });
  it("Manual mode: allowed even right before the reminder (a reminder sends nothing)", () => {
    expect(canInstallNow({ runActive: false, settings: manual, nextFireAt: at("2026-10-01T10:05:00Z"), now }).ok).toBe(true);
  });
  it("Automatic mode: refused when the send is inside the guard window", () => {
    const r = canInstallNow({ runActive: false, settings: auto, nextFireAt: at("2026-10-01T10:10:00Z"), now });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/10 minute/);
  });
  it("Automatic mode: allowed just outside the guard window and when far away", () => {
    const edge = new Date(now.getTime() + INSTALL_GUARD_MINUTES * 60_000);
    expect(canInstallNow({ runActive: false, settings: auto, nextFireAt: edge, now }).ok).toBe(true);
    expect(canInstallNow({ runActive: false, settings: auto, nextFireAt: at("2026-10-02T09:15:00Z"), now }).ok).toBe(true);
  });
  it("Automatic mode but paused: nothing will send, so allowed", () => {
    expect(canInstallNow({ runActive: false, settings: { ...auto, schedulingPaused: true }, nextFireAt: at("2026-10-01T10:05:00Z"), now }).ok).toBe(true);
  });
  it("unknown next fire time is allowed", () => {
    expect(canInstallNow({ runActive: false, settings: auto, nextFireAt: null, now }).ok).toBe(true);
  });
  it("a fire time already in the past does not block", () => {
    expect(canInstallNow({ runActive: false, settings: auto, nextFireAt: at("2026-10-01T09:59:00Z"), now }).ok).toBe(true);
  });
});

describe("shouldCheckNow", () => {
  const now = at("2026-10-01T12:00:00Z");
  it("respects the enabled flag", () => expect(shouldCheckNow({ enabled: false, lastCheckAt: null, now })).toBe(false));
  it("checks when never checked", () => expect(shouldCheckNow({ enabled: true, lastCheckAt: null, now })).toBe(true));
  it("waits for the interval", () => {
    expect(shouldCheckNow({ enabled: true, lastCheckAt: at("2026-10-01T07:00:00Z"), now })).toBe(false);
    expect(shouldCheckNow({ enabled: true, lastCheckAt: at("2026-10-01T06:00:00Z"), now })).toBe(true);
  });
});

describe("reduceUpdateState", () => {
  const run = (events, start = INITIAL_UPDATE_STATE) => events.reduce((s, e) => reduceUpdateState(s, e, at("2026-10-01T00:00:00Z")), start);

  it("happy path: check -> available -> download -> ready", () => {
    const s = run([{ type: "checking" }, { type: "available", version: "2.1.1", releaseNotes: "Fixes" }]);
    expect(s).toMatchObject({ status: "available", version: "2.1.1", releaseNotes: "Fixes" });
    const d = run([{ type: "download-started" }, { type: "progress", percent: 42.4 }], s);
    expect(d).toMatchObject({ status: "downloading", progress: 42 });
    expect(run([{ type: "downloaded", version: "2.1.1" }], d)).toMatchObject({ status: "ready", progress: 100, version: "2.1.1" });
  });
  it("no update -> up-to-date and clears any old version", () => {
    expect(run([{ type: "not-available" }])).toMatchObject({ status: "up-to-date", version: null });
  });
  it("a background re-check never hides a downloaded update", () => {
    const ready = run([{ type: "available", version: "2.1.1" }, { type: "downloaded", version: "2.1.1" }]);
    expect(run([{ type: "checking" }], ready).status).toBe("ready");
    expect(run([{ type: "not-available" }], ready).status).toBe("ready");
    expect(run([{ type: "available", version: "2.1.1" }], ready).status).toBe("ready");
  });
  it("an error keeps a ready update but records the message", () => {
    const ready = run([{ type: "available", version: "2.1.1" }, { type: "downloaded", version: "2.1.1" }]);
    expect(run([{ type: "error", message: "offline" }], ready)).toMatchObject({ status: "ready", error: "offline" });
  });
  it("an error otherwise moves to error and a later check recovers", () => {
    const e = run([{ type: "error", message: "boom" }]);
    expect(e).toMatchObject({ status: "error", error: "boom" });
    expect(run([{ type: "checking" }], e)).toMatchObject({ status: "checking", error: null });
  });
  it("progress is clamped to 0-100", () => {
    expect(run([{ type: "progress", percent: 250 }]).progress).toBe(100);
    expect(run([{ type: "progress", percent: -5 }]).progress).toBe(0);
  });
  it("disabled (dev build) and unknown events", () => {
    expect(run([{ type: "disabled" }]).status).toBe("disabled");
    expect(run([{ type: "whatever" }])).toEqual(INITIAL_UPDATE_STATE);
  });
});

describe("updateCheckEnabled setting", () => {
  it("defaults to on and is a renderer-writable boolean", () => {
    expect(DEFAULT_SETTINGS.updateCheckEnabled).toBe(true);
    expect(validateSetting("updateCheckEnabled", false)).toBe(false);
    expect(() => validateSetting("updateCheckEnabled", "no")).toThrow();
  });
});

describe("newer release found while an older one is pending", () => {
  const run = (events, start = INITIAL_UPDATE_STATE) => events.reduce((s, e) => reduceUpdateState(s, e), start);

  it("a re-check during a download switches to the newest version without leaving 'downloading'", () => {
    const s = run([
      { type: "available", version: "2.1.5" },
      { type: "download-started" },
      { type: "checking" },
      { type: "available", version: "2.1.7", releaseNotes: "notes" },
    ]);
    expect(s.status).toBe("downloading");
    expect(s.version).toBe("2.1.7");
    expect(s.releaseNotes).toBe("notes");
    expect(run([{ type: "downloaded", version: "2.1.7" }], s)).toMatchObject({ status: "ready", version: "2.1.7" });
  });

  it("a newer release replaces an already-downloaded older one, so Install never installs a stale version", () => {
    const s = run([
      { type: "available", version: "2.1.6" },
      { type: "downloaded", version: "2.1.6" },
      { type: "available", version: "2.1.7" },
    ]);
    expect(s).toMatchObject({ status: "available", version: "2.1.7" });
  });
});
