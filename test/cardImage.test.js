import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { importBackground } from "../src/core/cardImage.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "card-img-"));
async function writePng(dir, name, w, h) {
  const c = createCanvas(w, h);
  c.getContext("2d").fillRect(0, 0, w, h);
  const p = path.join(dir, name);
  fs.writeFileSync(p, await c.encode("png"));
  return p;
}

describe("importBackground", () => {
  it("stores a normal picture as background.jpg in the cards folder", async () => {
    const dir = tmp();
    const src = await writePng(dir, "in.png", 800, 600);
    const out = await importBackground(src, path.join(dir, "cards"));
    expect(out).toEqual({ image: "background.jpg", width: 800, height: 600 });
    expect(fs.existsSync(path.join(dir, "cards", "background.jpg"))).toBe(true);
  });
  it("shrinks a huge picture to at most 2000px on the long side", async () => {
    const dir = tmp();
    const src = await writePng(dir, "big.png", 4000, 3000);
    const out = await importBackground(src, path.join(dir, "cards"));
    expect(out.width).toBe(2000);
    expect(out.height).toBe(1500);
    const stored = await loadImage(fs.readFileSync(path.join(dir, "cards", "background.jpg")));
    expect(stored.width).toBe(2000);
  });
  it("rejects a file that is not a picture, with a plain message", async () => {
    const dir = tmp();
    const bad = path.join(dir, "notes.png");
    fs.writeFileSync(bad, "this is not an image");
    await expect(importBackground(bad, path.join(dir, "cards"))).rejects.toThrow(/couldn't be opened as a picture/);
    expect(fs.existsSync(path.join(dir, "cards", "background.jpg"))).toBe(false);
  });
  it("rejects a tiny picture and a missing file", async () => {
    const dir = tmp();
    const tiny = await writePng(dir, "tiny.png", 50, 50);
    await expect(importBackground(tiny, path.join(dir, "cards"))).rejects.toThrow(/too small/);
    await expect(importBackground(path.join(dir, "nope.png"), path.join(dir, "cards"))).rejects.toThrow(/could not be found/);
  });
  it("keeps the previous picture when a replacement is rejected", async () => {
    const dir = tmp();
    const cards = path.join(dir, "cards");
    await importBackground(await writePng(dir, "ok.png", 400, 400), cards);
    const before = fs.readFileSync(path.join(cards, "background.jpg"));
    const bad = path.join(dir, "bad.png");
    fs.writeFileSync(bad, "nope");
    await expect(importBackground(bad, cards)).rejects.toThrow();
    expect(fs.readFileSync(path.join(cards, "background.jpg")).equals(before)).toBe(true);
  });
});
