import { describe, it, expect } from "vitest";
import {
  clampBox,
  fitText,
  validateCardConfig,
  normalizeCardConfig,
  DEFAULT_CARD_CONFIG,
  isValidHexColor,
  normalizeRotationDeg,
  contrastStrokeColor,
  unrotateDelta,
  CARD_FONTS,
} from "../src/core/cardLayout.js";

// 10 px per character at size 10 => width = chars * size.
const measure = (text, size) => text.length * size;

describe("clampBox", () => {
  it("keeps a box inside the picture", () => {
    expect(clampBox({ x: 0.9, y: 0.95, w: 0.4, h: 0.2 })).toEqual({ x: 0.6, y: 0.8, w: 0.4, h: 0.2 });
    expect(clampBox({ x: -1, y: -1, w: 0.3, h: 0.3 })).toEqual({ x: 0, y: 0, w: 0.3, h: 0.3 });
  });
  it("enforces a minimum size and caps at the whole picture", () => {
    const b = clampBox({ x: 0, y: 0, w: 0, h: 5 });
    expect(b.w).toBeGreaterThanOrEqual(0.05);
    expect(b.h).toBe(1);
  });
  it("falls back to the default for garbage", () => {
    expect(clampBox(null)).toEqual(DEFAULT_CARD_CONFIG.box);
    expect(clampBox({ x: "a", y: NaN, w: undefined })).toEqual(DEFAULT_CARD_CONFIG.box);
  });
});

describe("fitText", () => {
  it("uses the largest size that fits one line", () => {
    const r = fitText(measure, "Priya", 200, 60, { maxSize: 100, minSize: 10 });
    expect(r.lines).toEqual(["Priya"]);
    expect(r.size).toBe(Math.floor(200 / 5)); // width-limited: 5 chars * 40 = 200
  });
  it("is height-limited for short names in a short box", () => {
    const r = fitText(measure, "Al", 1000, 40, { maxSize: 200, minSize: 10 });
    expect(r.size).toBe(Math.floor(40 / 1.15));
  });
  it("wraps a very long name onto two lines when that gives much bigger text", () => {
    const r = fitText(measure, "Venkatasubramanian Raghunathan", 300, 200, { maxSize: 200, minSize: 10 });
    expect(r.lines).toHaveLength(2);
    expect(r.lines.every((l) => measure(l, r.size) <= 300)).toBe(true);
  });
  it("keeps one line when wrapping would not help", () => {
    const r = fitText(measure, "Anna Lee", 1000, 60, { maxSize: 100, minSize: 10 });
    expect(r.lines).toHaveLength(1);
  });
  it("never goes below the minimum size and never throws", () => {
    const r = fitText(measure, "Supercalifragilisticexpialidocious", 20, 20, { maxSize: 100, minSize: 14 });
    expect(r.size).toBe(14);
  });
  it("returns no lines for an empty name", () => {
    expect(fitText(measure, "  ", 100, 100).lines).toEqual([]);
    expect(fitText(measure, null, 100, 100).lines).toEqual([]);
  });
  it("collapses runs of whitespace", () => {
    expect(fitText(measure, "A   B", 500, 100).lines).toEqual(["A B"]);
  });
});

describe("validateCardConfig", () => {
  it("fills defaults and clamps the box", () => {
    const c = validateCardConfig({ image: "starter", box: { x: 2, y: 2, w: 0.5, h: 0.5 } });
    expect(c.font).toBe(DEFAULT_CARD_CONFIG.font);
    expect(c.box).toEqual({ x: 0.5, y: 0.5, w: 0.5, h: 0.5 });
  });
  it("rejects unknown fonts, colours, alignments and name parts", () => {
    expect(() => validateCardConfig({ font: "comic" })).toThrow(/fonts/);
    expect(() => validateCardConfig({ color: "red" })).toThrow(/colour/);
    expect(() => validateCardConfig({ color: "#ff00" })).toThrow(/colour/);
    expect(() => validateCardConfig({ align: "justify" })).toThrow(/alignment/);
    expect(() => validateCardConfig({ nameParts: "last" })).toThrow(/full|first/);
  });
  it("rejects non-boolean flags and non-objects", () => {
    expect(() => validateCardConfig({ outline: "yes" })).toThrow(/true or false/);
    expect(() => validateCardConfig(null)).toThrow();
    expect(() => validateCardConfig([])).toThrow();
  });
  it("only accepts a safe picture file name (no paths)", () => {
    expect(validateCardConfig({ image: "background.jpg" }).image).toBe("background.jpg");
    expect(validateCardConfig({ image: "starter" }).image).toBe("starter");
    expect(validateCardConfig({ image: null }).image).toBeNull();
    for (const bad of ["../x.jpg", "a/b.png", "C:\\x.png", "x.exe", "", "x".repeat(70) + ".jpg"]) {
      expect(() => validateCardConfig({ image: bad }), bad).toThrow(/picture/);
    }
  });
  it("normalizeCardConfig never throws and falls back to defaults", () => {
    expect(normalizeCardConfig({ font: "nope" })).toEqual(DEFAULT_CARD_CONFIG);
    expect(normalizeCardConfig(undefined)).toEqual(DEFAULT_CARD_CONFIG);
  });
  it("accepts any valid hex colour, lower-cased", () => {
    expect(validateCardConfig({ color: "#D4A017" }).color).toBe("#d4a017");
    expect(validateCardConfig({ color: "#000000" }).color).toBe("#000000");
  });
  it("accepts, clamps and normalizes rotation; a missing/bad value defaults to 0", () => {
    expect(validateCardConfig({ rotation: 45 }).rotation).toBe(45);
    expect(validateCardConfig({ rotation: 400 }).rotation).toBe(40);
    expect(validateCardConfig({ rotation: -270 }).rotation).toBe(90);
    expect(validateCardConfig({ rotation: "bad" }).rotation).toBe(0);
    expect(validateCardConfig({}).rotation).toBe(0);
  });
});

describe("isValidHexColor", () => {
  it("accepts 6-digit hex (any case), rejects everything else", () => {
    expect(isValidHexColor("#d4a017")).toBe(true);
    expect(isValidHexColor("#D4A017")).toBe(true);
    expect(isValidHexColor("#fff")).toBe(false);
    expect(isValidHexColor("white")).toBe(false);
    expect(isValidHexColor("d4a017")).toBe(false);
    expect(isValidHexColor("#gggggg")).toBe(false);
    expect(isValidHexColor(null)).toBe(false);
  });
});

describe("normalizeRotationDeg", () => {
  it("wraps into (-180, 180] and defaults a non-number to 0", () => {
    expect(normalizeRotationDeg(0)).toBe(0);
    expect(normalizeRotationDeg(180)).toBe(180);
    expect(normalizeRotationDeg(-180)).toBe(180);
    expect(normalizeRotationDeg(270)).toBe(-90);
    expect(normalizeRotationDeg(-270)).toBe(90);
    expect(normalizeRotationDeg(720)).toBe(0);
    expect(normalizeRotationDeg(NaN)).toBe(0);
    expect(normalizeRotationDeg(undefined)).toBe(0);
  });
});

describe("contrastStrokeColor", () => {
  it("picks black for light colours and white for dark ones", () => {
    expect(contrastStrokeColor("#ffffff")).toBe("#000000");
    expect(contrastStrokeColor("#ffe082")).toBe("#000000"); // light gold
    expect(contrastStrokeColor("#111111")).toBe("#ffffff");
    expect(contrastStrokeColor("#000000")).toBe("#ffffff");
    expect(contrastStrokeColor("#6a1b9a")).toBe("#ffffff"); // dark purple
  });
  it("falls back sensibly for a bad value", () => {
    expect(["#000000", "#ffffff"]).toContain(contrastStrokeColor("nope"));
  });
});

describe("unrotateDelta", () => {
  it("is a no-op at 0 degrees", () => {
    const [dx, dy] = unrotateDelta(10, 4, 0);
    expect(dx).toBeCloseTo(10);
    expect(dy).toBeCloseTo(4);
  });
  it("at 90 degrees, a horizontal screen drag becomes a vertical local one (and vice versa)", () => {
    // So dragging the SE handle of a box tilted 90° to the right (screen dx>0)
    // still grows it, just along the box's own (now-vertical) width axis.
    const [dx1, dy1] = unrotateDelta(10, 0, 90);
    expect(dx1).toBeCloseTo(0);
    expect(dy1).toBeCloseTo(-10);
    const [dx2, dy2] = unrotateDelta(0, 10, 90);
    expect(dx2).toBeCloseTo(10);
    expect(dy2).toBeCloseTo(0);
  });
  it("at 180 degrees, the drag is simply inverted", () => {
    const [dx, dy] = unrotateDelta(5, -3, 180);
    expect(dx).toBeCloseTo(-5);
    expect(dy).toBeCloseTo(3);
  });
  it("preserves the vector's length at any angle", () => {
    for (const deg of [0, 15, 45, 90, 137, 180, -60]) {
      const [dx, dy] = unrotateDelta(6, 8, deg);
      expect(Math.hypot(dx, dy)).toBeCloseTo(10);
    }
  });
});

describe("CARD_FONTS", () => {
  it("every font has a unique id, a unique file, and a category", () => {
    expect(new Set(CARD_FONTS.map((f) => f.id)).size).toBe(CARD_FONTS.length);
    expect(new Set(CARD_FONTS.map((f) => f.file)).size).toBe(CARD_FONTS.length);
    expect(CARD_FONTS.every((f) => typeof f.category === "string" && f.category.length > 0)).toBe(true);
    expect(CARD_FONTS.length).toBeGreaterThanOrEqual(15);
  });
});
