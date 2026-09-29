import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ImportGuard } from "../src/core/importGuard.js";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bbot-guard-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
const file = (name, content) => {
  const p = path.join(tmp, name);
  fs.writeFileSync(p, content);
  return p;
};

describe("ImportGuard", () => {
  it("S3: refuses any path that was not picked in the dialog", () => {
    const g = new ImportGuard();
    const a = file("a.xlsx", "1");
    expect(() => g.assertPicked(a)).toThrow(/Import refused/); // nothing picked yet
    g.pick(a);
    expect(() => g.assertPicked(a)).not.toThrow();
    expect(() => g.assertPicked("C:\Windows\win.ini")).toThrow(/Import refused/);
    expect(() => g.assertPicked(file("b.xlsx", "1"))).toThrow(/Import refused/);
  });

  it("treats path case and separators the same (Windows)", () => {
    const g = new ImportGuard();
    const a = file("Case.xlsx", "1");
    g.pick(a);
    expect(() => g.assertPicked(a.toUpperCase())).not.toThrow();
  });

  it("F10: confirm needs a preview first, and detects a file edited in between", () => {
    const g = new ImportGuard();
    const a = file("c.xlsx", "rows v1");
    g.pick(a);
    expect(() => g.assertUnchangedSincePreview(a)).toThrow(/preview the file/);
    g.recordPreview(a);
    expect(() => g.assertUnchangedSincePreview(a)).not.toThrow();
    fs.writeFileSync(a, "rows v2 (edited in Excel)");
    expect(() => g.assertUnchangedSincePreview(a)).toThrow(/changed after the preview/);
  });

  it("picking again starts a fresh cycle; reset blocks replaying a used preview", () => {
    const g = new ImportGuard();
    const a = file("d.xlsx", "x");
    g.pick(a);
    g.recordPreview(a);
    g.reset();
    expect(() => g.assertUnchangedSincePreview(a)).toThrow(/Import refused/);
    g.pick(a);
    expect(() => g.assertUnchangedSincePreview(a)).toThrow(/preview the file/);
  });
});
