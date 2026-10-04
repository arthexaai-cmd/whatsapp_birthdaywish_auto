import { describe, it, expect } from "vitest";
import { DEFAULT_SETTINGS, migratePacingToCurrentDefaults, PACING_DEFAULTS_VERSION } from "../src/core/defaults.js";

const OLD = {
  startJitterMinutes: [0, 20],
  batchSize: [4, 7],
  withinBatchSeconds: [40, 150],
  betweenBatchMinutes: [14, 28],
  typingMsPerChar: [45, 90],
  dailyCap: 60,
  quietHours: ["21:30", "08:30"],
  warmupDays: 7,
  warmupStartCap: 8,
};

describe("migratePacingToCurrentDefaults", () => {
  it("moves an untouched install to the current defaults", () => {
    expect(migratePacingToCurrentDefaults(OLD)).toEqual(DEFAULT_SETTINGS.pacing);
  });

  it("leaves fields the user changed alone", () => {
    const mine = { ...OLD, dailyCap: 40, quietHours: ["22:00", "07:00"], betweenBatchMinutes: [20, 40] };
    const out = migratePacingToCurrentDefaults(mine);
    expect(out.dailyCap).toBe(40);
    expect(out.quietHours).toEqual(["22:00", "07:00"]);
    expect(out.betweenBatchMinutes).toEqual([20, 40]);
    expect(out.warmupDays).toBe(0); // still at the old default, so it follows
  });

  it("does not mutate its input and is idempotent", () => {
    const copy = JSON.parse(JSON.stringify(OLD));
    const once = migratePacingToCurrentDefaults(OLD);
    expect(OLD).toEqual(copy);
    expect(migratePacingToCurrentDefaults(once)).toEqual(once);
  });

  it("new installs are seeded at the current migration version", () => {
    expect(DEFAULT_SETTINGS.pacingDefaultsVersion).toBe(PACING_DEFAULTS_VERSION);
  });
});
