import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { effectiveDailyCap, batchMatches, buildSchedule } from "../src/core/pacing.js";
import { DEFAULT_SETTINGS } from "../src/core/defaults.js";

const P = DEFAULT_SETTINGS.pacing;
const items = (n) => Array.from({ length: n }, (_, i) => ({ id: i }));

describe("effectiveDailyCap warm-up", () => {
  it("starts at warmupStartCap on day 0, ramps, then reaches dailyCap", () => {
    expect(effectiveDailyCap(P, 0)).toBe(8);
    const mid = effectiveDailyCap(P, 3);
    expect(mid).toBeGreaterThan(8);
    expect(mid).toBeLessThan(60);
    expect(effectiveDailyCap(P, 7)).toBe(60);
    expect(effectiveDailyCap(P, 400)).toBe(60);
  });
  it("is monotonic non-decreasing across warm-up", () => {
    let prev = 0;
    for (let d = 0; d <= 8; d++) {
      const c = effectiveDailyCap(P, d);
      expect(c).toBeGreaterThanOrEqual(prev);
      prev = c;
    }
  });
});

describe("batchMatches", () => {
  it("caps and reports dropped", () => {
    const { batches, cap, droppedByCap } = batchMatches(items(12), P, 0);
    expect(cap).toBe(8);
    expect(batches.flat()).toHaveLength(8);
    expect(droppedByCap).toBe(4);
  });
  it("batch sizes stay within the configured range (except the last)", () => {
    const { batches } = batchMatches(items(150), { ...P, dailyCap: 150 }, 999);
    for (const b of batches.slice(0, -1)) {
      expect(b.length).toBeGreaterThanOrEqual(4);
      expect(b.length).toBeLessThanOrEqual(7);
    }
  });
  it("F4: batchSize [0,0] must not hang the process", () => {
    // Child process so an infinite loop can't freeze the test runner.
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const url = pathToFileURL(path.join(dir, "..", "src", "core", "pacing.js")).href;
    const script = `
      import { batchMatches } from ${JSON.stringify(url)};
      const r = batchMatches([{a:1},{a:2}], { dailyCap: 60, warmupDays: 0, warmupStartCap: 8, batchSize: [0,0] }, 100);
      console.log("done", r.batches.flat().length);
    `;
    const res = spawnSync(process.execPath, ["--max-old-space-size=256", "--input-type=module", "-e", script], {
      timeout: 4000,
      encoding: "utf8",
    });
    expect(res.error, "process hung or crashed").toBeUndefined();
    expect(res.stdout).toContain("done 2");
  });
});

describe("buildSchedule and quiet hours", () => {
  const cfg = { ...P, startJitterMinutes: [0, 0], withinBatchSeconds: [60, 60], betweenBatchMinutes: [0, 0], quietHours: ["21:30", "08:30"] };
  const one = (arr) => [arr];

  it("defers items that would land after quiet hours begin", () => {
    const { scheduled, deferred } = buildSchedule(one(items(5)), cfg, new Date("2026-05-10T21:28:00Z"), "UTC");
    expect(scheduled).toHaveLength(2);
    expect(deferred).toHaveLength(3);
  });
  it("everything deferred when the run starts inside quiet hours (wrap past midnight)", () => {
    const { scheduled, deferred } = buildSchedule(one(items(3)), cfg, new Date("2026-05-10T02:00:00Z"), "UTC");
    expect(scheduled).toHaveLength(0);
    expect(deferred).toHaveLength(3);
  });
  it("nothing deferred in the middle of the day", () => {
    const { scheduled, deferred } = buildSchedule(one(items(3)), cfg, new Date("2026-05-10T12:00:00Z"), "UTC");
    expect(scheduled).toHaveLength(3);
    expect(deferred).toHaveLength(0);
  });
  it("respects the timezone when judging quiet hours", () => {
    // 16:30 UTC == 22:00 IST -> quiet in IST, fine in UTC
    expect(buildSchedule(one(items(1)), cfg, new Date("2026-05-10T16:30:00Z"), "Asia/Kolkata").scheduled).toHaveLength(0);
    expect(buildSchedule(one(items(1)), cfg, new Date("2026-05-10T16:30:00Z"), "UTC").scheduled).toHaveLength(1);
  });
  it("send times are strictly increasing", () => {
    const { scheduled } = buildSchedule(one(items(6)), cfg, new Date("2026-05-10T10:00:00Z"), "UTC");
    for (let i = 1; i < scheduled.length; i++) expect(scheduled[i].sendAt.getTime()).toBeGreaterThan(scheduled[i - 1].sendAt.getTime());
  });
});

describe("quiet hours around midnight", () => {
  const cfg = { ...P, startJitterMinutes: [0, 0], withinBatchSeconds: [60, 60], betweenBatchMinutes: [0, 0], quietHours: ["21:30", "08:30"] };
  it("00:00 and 00:30 are quiet; 08:29 quiet; 08:30 not", () => {
    const at = (iso) => buildSchedule([[{ id: 1 }]], cfg, new Date(iso), "UTC").scheduled.length; // 1 = allowed
    expect(at("2026-05-10T00:00:00Z")).toBe(0);
    expect(at("2026-05-10T00:30:00Z")).toBe(0);
    expect(at("2026-05-10T08:29:00Z")).toBe(0);
    expect(at("2026-05-10T08:30:00Z")).toBe(1);
    expect(at("2026-05-10T21:29:00Z")).toBe(1);
    expect(at("2026-05-10T21:30:00Z")).toBe(0);
  });
});
