import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { effectiveDailyCap, batchMatches, buildSchedule } from "../src/core/pacing.js";
import { DEFAULT_SETTINGS } from "../src/core/defaults.js";

const P = DEFAULT_SETTINGS.pacing;
// Warm-up is opt-in now (default warmupDays 0), so ramp tests set it explicitly.
const W = { ...P, dailyCap: 60, warmupDays: 7, warmupStartCap: 8 };
const items = (n) => Array.from({ length: n }, (_, i) => ({ id: i }));

describe("effectiveDailyCap warm-up", () => {
  it("defaults to the full cap of 100 from day 0, no warm-up", () => {
    expect(P.dailyCap).toBe(100);
    expect(P.warmupDays).toBe(0);
    expect(effectiveDailyCap(P, 0)).toBe(100);
  });
  it("starts at warmupStartCap on day 0, ramps, then reaches dailyCap", () => {
    expect(effectiveDailyCap(W, 0)).toBe(8);
    const mid = effectiveDailyCap(W, 3);
    expect(mid).toBeGreaterThan(8);
    expect(mid).toBeLessThan(60);
    expect(effectiveDailyCap(W, 7)).toBe(60);
    expect(effectiveDailyCap(W, 400)).toBe(60);
  });
  it("is monotonic non-decreasing across warm-up", () => {
    let prev = 0;
    for (let d = 0; d <= 8; d++) {
      const c = effectiveDailyCap(W, d);
      expect(c).toBeGreaterThanOrEqual(prev);
      prev = c;
    }
  });
});

describe("default pacing duration", () => {
  it("spreads a full default day (100 messages) over about 4 hours", () => {
    // 09:15 IST start. Typing time (~5 s per message) is not part of the
    // schedule, so the average lands a few minutes under 4h of wall time.
    const start = new Date("2026-10-05T03:45:00Z");
    let total = 0;
    const runs = 20;
    for (let run = 0; run < runs; run++) {
      const { batches } = batchMatches(items(100), P, 0);
      const { scheduled, deferred } = buildSchedule(batches, P, start, "Asia/Kolkata");
      expect(deferred).toHaveLength(0);
      expect(scheduled).toHaveLength(100);
      const minutes = (scheduled.at(-1).sendAt - start) / 60_000;
      expect(minutes).toBeLessThan(280);
      total += minutes;
    }
    const avg = total / runs;
    expect(avg).toBeGreaterThan(200);
    expect(avg).toBeLessThan(250);
  });
});

describe("batchMatches", () => {
  it("caps and reports dropped", () => {
    const { batches, cap, droppedByCap } = batchMatches(items(12), W, 0);
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
