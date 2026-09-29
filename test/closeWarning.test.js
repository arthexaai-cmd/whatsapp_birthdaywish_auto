import { describe, it, expect } from "vitest";
import { closeDecision } from "../src/core/closeWarning.js";

const base = { sendMode: "manual", reminderEnabled: true, schedulingPaused: false, scheduledTime: "09:15", closeWarningDismissed: false };
const next = new Date("2026-10-01T09:15:00");
const d = (over, settings = {}) => closeDecision({ runActive: false, nextFireAt: next, via: "quit", ...over, settings: { ...base, ...settings } });

describe("closeDecision — quit", () => {
  it("auto mode warns the automatic send will not go out", () => {
    const r = d({}, { sendMode: "auto" });
    expect(r.level).toBe("warn");
    expect(r.message).toMatch(/automatic send/);
    expect(r.message).toMatch(/NOT go out/);
    expect(r.buttons).toEqual(["Minimize to tray", "Quit anyway"]);
    expect(r.defaultId).toBe(0);
    expect(r.quitButtonIndex).toBe(1);
  });
  it("manual mode with reminder warns about the reminder", () => {
    const r = d({});
    expect(r.level).toBe("warn");
    expect(r.message).toMatch(/reminder/);
  });
  it("manual mode with reminder off: no warning", () => {
    expect(d({}, { reminderEnabled: false }).level).toBe("none");
  });
  it("paused: no warning (in either mode)", () => {
    expect(d({}, { schedulingPaused: true }).level).toBe("none");
    expect(d({}, { schedulingPaused: true, sendMode: "auto" }).level).toBe("none");
  });
  it("falls back to scheduledTime when nextFireAt is unknown", () => {
    const r = d({ nextFireAt: null }, { sendMode: "auto" });
    expect(r.message).toContain("09:15");
  });
});

describe("closeDecision — window close", () => {
  it("first time: informational notice with a don't-show-again checkbox", () => {
    const r = d({ via: "window" }, { sendMode: "auto" });
    expect(r.level).toBe("info");
    expect(r.checkbox).toBeTruthy();
    expect(r.message).toMatch(/automatic send at 09:15/);
  });
  it("manual mode mentions the reminder", () => {
    expect(d({ via: "window" }).message).toMatch(/reminder at 09:15/);
  });
  it("silent once dismissed", () => {
    expect(d({ via: "window" }, { closeWarningDismissed: true }).level).toBe("none");
  });
  it("silent when nothing is scheduled", () => {
    expect(d({ via: "window" }, { schedulingPaused: true }).level).toBe("none");
  });
});

describe("closeDecision — run in progress", () => {
  it("quit is a danger dialog that defaults to keep running", () => {
    const r = d({ runActive: true, pendingCount: 3 }, { schedulingPaused: true });
    expect(r.level).toBe("danger");
    expect(r.message).toMatch(/3 messages are still queued/);
    expect(r.buttons).toEqual(["Keep running", "Stop & quit"]);
    expect(r.defaultId).toBe(0);
    expect(r.quitButtonIndex).toBe(1);
  });
  it("singular wording for one message", () => {
    expect(d({ runActive: true, pendingCount: 1 }).message).toMatch(/1 message is still queued/);
  });
  it("ignores dismissed flag: a run is always warned about", () => {
    expect(d({ runActive: true }, { closeWarningDismissed: true }).level).toBe("danger");
  });
  it("closing the window during a run only informs (run continues in tray)", () => {
    const r = d({ runActive: true, via: "window" });
    expect(r.level).toBe("info");
    expect(r.quitButtonIndex).toBeUndefined();
  });
});
