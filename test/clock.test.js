import { describe, it, expect } from "vitest";
import { classifyDrift, describeDrift, DRIFT_WARNING_MS } from "../src/core/clock.js";

describe("classifyDrift", () => {
  it("is ok when local time matches true time", () => {
    const t = new Date("2026-03-14T10:00:00Z");
    const result = classifyDrift(t, new Date(t.getTime()));
    expect(result.ok).toBe(true);
    expect(result.driftMs).toBe(0);
  });

  it("is ok within the warning threshold", () => {
    const t = new Date("2026-03-14T10:00:00Z");
    const local = new Date(t.getTime() + DRIFT_WARNING_MS - 1000);
    expect(classifyDrift(t, local).ok).toBe(true);
  });

  it("flags drift beyond the warning threshold, clock ahead", () => {
    const t = new Date("2026-03-14T10:00:00Z");
    const local = new Date(t.getTime() + DRIFT_WARNING_MS + 1000);
    const result = classifyDrift(t, local);
    expect(result.ok).toBe(false);
    expect(result.driftMs).toBeGreaterThan(0);
  });

  it("flags drift beyond the warning threshold, clock behind", () => {
    const t = new Date("2026-03-14T10:00:00Z");
    const local = new Date(t.getTime() - DRIFT_WARNING_MS - 1000);
    const result = classifyDrift(t, local);
    expect(result.ok).toBe(false);
    expect(result.driftMs).toBeLessThan(0);
  });

  it("flags a clock that is off by a whole day", () => {
    const t = new Date("2026-03-14T10:00:00Z");
    const local = new Date("2026-03-15T10:00:00Z");
    expect(classifyDrift(t, local).ok).toBe(false);
  });
});

describe("describeDrift", () => {
  it("describes sub-minute drift", () => {
    expect(describeDrift(30_000)).toBe("less than a minute");
  });
  it("describes minutes", () => {
    expect(describeDrift(5 * 60_000)).toBe("5 minutes");
    expect(describeDrift(1 * 60_000)).toBe("1 minute");
  });
  it("describes hours once past 60 minutes", () => {
    expect(describeDrift(90 * 60_000)).toBe("2 hours"); // rounds 90min -> 1.5h -> 2h
  });
  it("describes days once past ~48 hours", () => {
    expect(describeDrift(3 * 24 * 60 * 60_000)).toBe("3 days");
  });
  it("is symmetric for negative (behind) drift", () => {
    expect(describeDrift(-5 * 60_000)).toBe("5 minutes");
  });
});
