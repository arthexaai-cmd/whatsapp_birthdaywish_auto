import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tagMatchesVersion } from "../scripts/release-check.mjs";

describe("tagMatchesVersion", () => {
  it("accepts exactly v<version>", () => {
    expect(tagMatchesVersion("v2.1.0", "2.1.0")).toBe(true);
  });
  it("rejects a different version, a missing v, prerelease drift and non-strings", () => {
    expect(tagMatchesVersion("v2.1.1", "2.1.0")).toBe(false);
    expect(tagMatchesVersion("2.1.0", "2.1.0")).toBe(false);
    expect(tagMatchesVersion("v2.1.0-beta.1", "2.1.0")).toBe(false);
    expect(tagMatchesVersion(undefined, "2.1.0")).toBe(false);
    expect(tagMatchesVersion("v2.1.0", undefined)).toBe(false);
  });
});

describe("scripts/release-check.mjs (as the workflow runs it)", () => {
  const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "scripts", "release-check.mjs");
  const version = JSON.parse(fs.readFileSync(path.join(path.dirname(script), "..", "package.json"), "utf8")).version;
  const run = (tag) => spawnSync(process.execPath, [script], { env: { ...process.env, TAG: tag }, encoding: "utf8" });

  it("exits 0 for the matching tag", () => {
    expect(run(`v${version}`).status).toBe(0);
  });
  it("exits 1 with a clear message for a wrong tag", () => {
    const r = run("v0.0.1");
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/does not match package\.json version/);
  });
});
