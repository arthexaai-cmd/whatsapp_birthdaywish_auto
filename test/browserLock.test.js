import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { browserProfileDir, clearStaleBrowserLock, findOrphanBrowserPids } from "../src/core/browserLock.js";

function tempProfile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-lock-"));
  return dir;
}

describe("browserProfileDir", () => {
  it("is LocalAuth's default 'session' folder inside the session dir", () => {
    expect(browserProfileDir(path.join("x", "wa-session"))).toBe(path.join("x", "wa-session", "session"));
  });
});

describe("findOrphanBrowserPids", () => {
  const profile = path.resolve("C:/Users/x/AppData/Roaming/Birthday Bot/wa-session/session");
  it("matches only top-level browsers on exactly this profile (quoted or not, any slash/case)", () => {
    const procs = [
      { pid: 1, commandLine: `"msedge.exe" --headless=new "--user-data-dir=${profile}" about:blank` },
      { pid: 2, commandLine: `msedge.exe --user-data-dir="${profile.replace(/\\/g, "/").toUpperCase()}" --edge-skip-compat-layer-relaunch` },
      { pid: 8, commandLine: `msedge.exe --user-data-dir=C:/nospace/profile` },
      { pid: 3, commandLine: `msedge.exe --type=renderer "--user-data-dir=${profile}"` },
      { pid: 4, commandLine: `msedge.exe --user-data-dir=C:/Users/x/AppData/Local/Microsoft/Edge/User` },
      { pid: 5, commandLine: `msedge.exe` },
      { pid: 6, commandLine: null },
      { pid: 7, commandLine: `msedge.exe "--user-data-dir=${profile}-other"` },
    ];
    expect(findOrphanBrowserPids(procs, profile)).toEqual([1, 2]);
  });
});

describe("clearStaleBrowserLock", () => {
  it("reports none when there is no lockfile (or no profile yet)", () => {
    const dir = tempProfile();
    expect(clearStaleBrowserLock(dir)).toBe("none");
    expect(clearStaleBrowserLock(path.join(dir, "missing"))).toBe("none");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("removes a stale lockfile left by a browser that died", () => {
    const dir = tempProfile();
    fs.writeFileSync(path.join(dir, "lockfile"), "");
    expect(clearStaleBrowserLock(dir)).toBe("cleared");
    expect(fs.existsSync(path.join(dir, "lockfile"))).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("reports in_use when a running browser holds the lockfile (delete refused)", () => {
    const busy = Object.assign(new Error("EBUSY: resource busy or locked"), { code: "EBUSY" });
    const fakeFs = { existsSync: () => true, unlinkSync: () => { throw busy; } };
    expect(clearStaleBrowserLock("C:/profile", fakeFs)).toBe("in_use");
  });

  it("treats a lockfile that vanished mid-check as none", () => {
    const gone = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    const fakeFs = { existsSync: () => true, unlinkSync: () => { throw gone; } };
    expect(clearStaleBrowserLock("C:/profile", fakeFs)).toBe("none");
  });
});

describe("findOrphanBrowserPids (unquoted path)", () => {
  it("matches an unquoted --user-data-dir without spaces", () => {
    const profile = path.resolve("C:/nospace/profile");
    expect(findOrphanBrowserPids([{ pid: 9, commandLine: `msedge.exe --user-data-dir=${profile} about:blank` }], profile)).toEqual([9]);
  });
});
