import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { renderCard, makeCardRenderer } from "../src/core/cardRender.js";
import { DEFAULT_SETTINGS } from "../src/core/defaults.js";

const assetsDir = path.join(import.meta.dirname, "..", "assets");
const cardsDir = fs.mkdtempSync(path.join(os.tmpdir(), "cards-test-"));
const isJpeg = (b) => b[0] === 0xff && b[1] === 0xd8;

describe("renderCard", () => {
  it("draws the bundled starter picture to a JPEG", async () => {
    const jpeg = await renderCard({ config: { image: "starter" }, text: "Mr Abhijit Sharma ji", cardsDir, assetsDir });
    expect(isJpeg(jpeg)).toBe(true);
    expect(jpeg.length).toBeGreaterThan(5_000);
  });
  it("different names give different images", async () => {
    const a = await renderCard({ config: { image: "starter" }, text: "Anna", cardsDir, assetsDir });
    const b = await renderCard({ config: { image: "starter" }, text: "Bob", cardsDir, assetsDir });
    expect(a.equals(b)).toBe(false);
  });
  it("shrinks a large uploaded picture so its long side is at most 1080px", async () => {
    const big = createCanvas(3000, 2000);
    big.getContext("2d").fillRect(0, 0, 3000, 2000);
    fs.writeFileSync(path.join(cardsDir, "big.jpg"), await big.encode("jpeg", 80));
    const jpeg = await renderCard({ config: { image: "big.jpg" }, text: "Anna", cardsDir, assetsDir });
    // JPEG SOF0/2 marker holds the size: scan for it.
    let i = 2;
    while (i < jpeg.length) {
      const marker = jpeg[i + 1];
      const len = jpeg.readUInt16BE(i + 2);
      if (marker === 0xc0 || marker === 0xc2) {
        expect(jpeg.readUInt16BE(i + 5)).toBe(720); // height
        expect(jpeg.readUInt16BE(i + 7)).toBe(1080); // width
        return;
      }
      i += 2 + len;
    }
    throw new Error("no SOF marker found");
  });
  it("fails with a clear message when no picture is set or the file is gone", async () => {
    await expect(renderCard({ config: { image: null }, text: "A", cardsDir, assetsDir })).rejects.toThrow(/no birthday picture/i);
    await expect(renderCard({ config: { image: "gone.jpg" }, text: "A", cardsDir, assetsDir })).rejects.toThrow(/missing/i);
  });
  it("renders an empty name without throwing (just the picture)", async () => {
    expect(isJpeg(await renderCard({ config: { image: "starter" }, text: "", cardsDir, assetsDir }))).toBe(true);
  });
  it("draws any hex colour the user picked, not just the old preset list", async () => {
    const jpeg = await renderCard({ config: { image: "starter", color: "#39ff14" }, text: "Priya", cardsDir, assetsDir });
    expect(isJpeg(jpeg)).toBe(true);
  });
  it("a rotated card differs from an unrotated one and is still a valid JPEG", async () => {
    const flat = await renderCard({ config: { image: "starter" }, text: "Priya Sharma", cardsDir, assetsDir });
    const rotated = await renderCard({ config: { image: "starter", rotation: 25 }, text: "Priya Sharma", cardsDir, assetsDir });
    expect(isJpeg(rotated)).toBe(true);
    expect(flat.equals(rotated)).toBe(false);
  });
  it("renders every font without throwing", async () => {
    const { CARD_FONTS } = await import("../src/core/cardLayout.js");
    for (const f of CARD_FONTS) {
      const jpeg = await renderCard({ config: { image: "starter", font: f.id }, text: "Priya", cardsDir, assetsDir });
      expect(isJpeg(jpeg), f.id).toBe(true);
    }
  });
});

describe("makeCardRenderer", () => {
  it("is null until a picture is configured", () => {
    expect(makeCardRenderer({ settings: { ...DEFAULT_SETTINGS }, cardsDir, assetsDir })).toBeNull();
  });
  it("writes the person's card name (salutation, name, postfix) on the card", async () => {
    const settings = { ...DEFAULT_SETTINGS, cardConfig: { image: "starter" } };
    const render = makeCardRenderer({ settings, cardsDir, assetsDir });
    const jpeg = await render({ name: "Abhijit Sharma", firstName: "Abhijit", salutation: "Mr" });
    const plain = await renderCard({ config: { image: "starter" }, text: "Mr Abhijit Sharma ji", cardsDir, assetsDir });
    expect(jpeg.equals(plain)).toBe(true);
  });
});
