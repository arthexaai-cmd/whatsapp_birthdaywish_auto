// Pure layout + validation for the birthday card: where the name box sits, how
// the name is fitted into it, and which style choices are allowed. No canvas
// and no Electron here -- the text measurer is injected (fitText), so every rule
// is unit-tested in plain Node. cardRender.js plugs in the real canvas.

// The fonts offered in the editor. `file` is in assets/fonts/; `family` is the
// name the renderer registers it under; `category` groups them in the picker.
export const CARD_FONTS = [
  // Script / elegant
  { id: "elegant", label: "Elegant", family: "Great Vibes", css: "Great Vibes", file: "GreatVibes.woff", category: "Script" },
  { id: "dancing", label: "Dancing", family: "Dancing Script Bold", css: "Dancing Script", file: "DancingScript-Bold.woff", category: "Script" },
  { id: "allura", label: "Allura", family: "Allura", css: "Allura", file: "Allura.woff", category: "Script" },
  { id: "sacramento", label: "Sacramento", family: "Sacramento", css: "Sacramento", file: "Sacramento.woff", category: "Script" },
  // Handwriting / casual
  { id: "fun", label: "Fun", family: "Pacifico", css: "Pacifico", file: "Pacifico.woff", category: "Handwriting" },
  { id: "caveat", label: "Caveat", family: "Caveat Bold", css: "Caveat", file: "Caveat-Bold.woff", category: "Handwriting" },
  { id: "shadows", label: "Shadows", family: "Shadows Into Light", css: "Shadows Into Light", file: "ShadowsIntoLight.woff", category: "Handwriting" },
  { id: "cookie", label: "Cookie", family: "Cookie", css: "Cookie", file: "Cookie.woff", category: "Handwriting" },
  // Serif
  { id: "classic", label: "Classic", family: "Playfair Display Bold", css: "Playfair Display", file: "PlayfairDisplay-Bold.woff", category: "Serif" },
  { id: "merriweather", label: "Merriweather", family: "Merriweather Bold", css: "Merriweather", file: "Merriweather-Bold.woff", category: "Serif" },
  { id: "lora", label: "Lora", family: "Lora Bold", css: "Lora", file: "Lora-Bold.woff", category: "Serif" },
  { id: "cormorant", label: "Cormorant", family: "Cormorant Garamond Bold", css: "Cormorant Garamond", file: "CormorantGaramond-Bold.woff", category: "Serif" },
  // Sans-serif
  { id: "bold", label: "Bold", family: "Poppins Bold", css: "Poppins", file: "Poppins-Bold.woff", category: "Sans-serif" },
  { id: "montserrat", label: "Montserrat", family: "Montserrat Bold", css: "Montserrat", file: "Montserrat-Bold.woff", category: "Sans-serif" },
  { id: "raleway", label: "Raleway", family: "Raleway Bold", css: "Raleway", file: "Raleway-Bold.woff", category: "Sans-serif" },
  { id: "oswald", label: "Oswald", family: "Oswald SemiBold", css: "Oswald", file: "Oswald-SemiBold.woff", category: "Sans-serif" },
  // Display / bold
  { id: "retro", label: "Retro", family: "Lobster", css: "Lobster", file: "Lobster.woff", category: "Display" },
  { id: "bebas", label: "Bebas", family: "Bebas Neue", css: "Bebas Neue", file: "BebasNeue.woff", category: "Display" },
  { id: "anton", label: "Anton", family: "Anton", css: "Anton", file: "Anton.woff", category: "Display" },
  { id: "alfaslab", label: "Alfa Slab", family: "Alfa Slab One", css: "Alfa Slab One", file: "AlfaSlabOne.woff", category: "Display" },
];

// A handful of one-click common choices; the editor also offers a full
// colour picker for anything else (see Cards.jsx), so this list stays short.
export const CARD_COLORS = [
  { label: "White", hex: "#ffffff" },
  { label: "Black", hex: "#111111" },
  { label: "Gold", hex: "#d4a017" },
  { label: "Red", hex: "#c62828" },
  { label: "Pink", hex: "#e91e8c" },
  { label: "Blue", hex: "#1565c0" },
  { label: "Green", hex: "#2e7d32" },
  { label: "Purple", hex: "#6a1b9a" },
];

export const CARD_ALIGNS = ["left", "center", "right"];

export const DEFAULT_CARD_CONFIG = {
  image: null, // file name inside <userData>/cards, or "starter" for the bundled picture
  box: { x: 0.15, y: 0.4, w: 0.7, h: 0.15 }, // fractions of the picture, so any resolution works
  font: "classic",
  color: "#ffffff",
  align: "center",
  outline: true,
  rotation: 0, // degrees, normalized to (-180, 180]
  nameParts: "full", // "full" | "first"
  includeSalutation: true,
  includePostfix: true,
};

const MIN_BOX = 0.05; // smallest side, as a fraction of the picture
const FONT_IDS = new Set(CARD_FONTS.map((f) => f.id));
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const IMAGE_NAME = /^(starter|[A-Za-z0-9_-]{1,60}\.(jpg|jpeg|png|webp))$/;

const isNum = (n) => typeof n === "number" && Number.isFinite(n);

/** @returns {boolean} whether `s` is a 6-digit hex colour like "#d4a017" */
export function isValidHexColor(s) {
  return typeof s === "string" && HEX_COLOR.test(s);
}

/** Wrap any angle (degrees) into the (-180, 180] range the editor stores. */
export function normalizeRotationDeg(deg) {
  const n = isNum(deg) ? deg : 0;
  const wrapped = ((n + 180) % 360 + 360) % 360 - 180;
  return wrapped === -180 ? 180 : wrapped;
}

/**
 * Black or white, whichever reads better on top of `hex` (WCAG relative
 * luminance). Used for the automatic text outline, since the text colour can
 * now be anything, not just a fixed palette id.
 */
export function contrastStrokeColor(hex) {
  const h = isValidHexColor(hex) ? hex : "#ffffff";
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return luminance > 0.5 ? "#000000" : "#ffffff";
}

/** Keep the box fully inside the picture and at least MIN_BOX on each side. */
export function clampBox(box) {
  const b = box && typeof box === "object" ? box : DEFAULT_CARD_CONFIG.box;
  const w = Math.min(1, Math.max(MIN_BOX, isNum(b.w) ? b.w : DEFAULT_CARD_CONFIG.box.w));
  const h = Math.min(1, Math.max(MIN_BOX, isNum(b.h) ? b.h : DEFAULT_CARD_CONFIG.box.h));
  const x = Math.min(1 - w, Math.max(0, isNum(b.x) ? b.x : DEFAULT_CARD_CONFIG.box.x));
  const y = Math.min(1 - h, Math.max(0, isNum(b.y) ? b.y : DEFAULT_CARD_CONFIG.box.y));
  return { x, y, w, h };
}

/**
 * Validate and complete a card config coming from the renderer. Unknown fonts,
 * colours and alignments are rejected (not silently replaced) so a bug shows up
 * instead of a surprising card; a missing box is clamped back inside.
 * @throws {Error} with a user-readable message
 */
export function validateCardConfig(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("The card settings are not valid.");
  const c = { ...DEFAULT_CARD_CONFIG, ...input };

  if (c.image !== null && !(typeof c.image === "string" && IMAGE_NAME.test(c.image))) throw new Error("The card picture name is not valid.");
  if (!FONT_IDS.has(c.font)) throw new Error("Please pick one of the listed fonts.");
  if (!isValidHexColor(c.color)) throw new Error("Please pick a colour.");
  if (!CARD_ALIGNS.includes(c.align)) throw new Error("Text alignment must be left, centre or right.");
  if (c.nameParts !== "full" && c.nameParts !== "first") throw new Error('The name must be "full" or "first".');
  for (const k of ["outline", "includeSalutation", "includePostfix"]) {
    if (typeof c[k] !== "boolean") throw new Error(`${k} must be true or false.`);
  }
  return {
    image: c.image,
    box: clampBox(c.box),
    font: c.font,
    color: c.color.toLowerCase(),
    align: c.align,
    outline: c.outline,
    rotation: normalizeRotationDeg(c.rotation),
    nameParts: c.nameParts,
    includeSalutation: c.includeSalutation,
    includePostfix: c.includePostfix,
  };
}

/** Same validation, but never throws: a damaged saved value falls back to defaults. */
export function normalizeCardConfig(input) {
  try {
    return validateCardConfig(input);
  } catch {
    return { ...DEFAULT_CARD_CONFIG, box: { ...DEFAULT_CARD_CONFIG.box } };
  }
}

/**
 * Fit `text` into a box of boxW x boxH pixels.
 *
 * Finds the largest size at which the whole name fits on one line. If that
 * makes the text much smaller than a two-line layout would allow (a very long
 * name), it is split onto two lines at the space nearest the middle instead.
 * Always returns something drawable: in the worst case the smallest size,
 * which may overhang slightly rather than fail.
 *
 * @param {(text: string, size: number) => number} measure width in px of text at size px
 * @returns {{lines: string[], size: number, lineHeight: number}}
 */
export function fitText(measure, text, boxW, boxH, { maxSize = 200, minSize = 14, lineSpacing = 1.15 } = {}) {
  const clean = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return { lines: [], size: minSize, lineHeight: minSize * lineSpacing };

  const best = (lines) => {
    const top = Math.max(minSize, Math.min(maxSize, Math.floor(boxH / (lines.length * lineSpacing))));
    for (let size = top; size > minSize; size -= 1) {
      if (lines.every((l) => measure(l, size) <= boxW)) return size;
    }
    return minSize;
  };
  const make = (lines) => {
    const size = best(lines);
    return { lines, size, lineHeight: size * lineSpacing };
  };

  const one = make([clean]);
  const split = splitInTwo(clean);
  if (!split) return one;
  const two = make(split);
  // Two lines only when they allow clearly bigger (more readable) text.
  return two.size > one.size * 1.3 ? two : one;
}

/**
 * Rotate a (dx, dy) screen-space drag vector by -deg degrees, turning it into
 * the box's own unrotated frame. Used when resizing a rotated box: the box is
 * always stored as a plain axis-aligned rectangle, and only its on-screen
 * display and the final render are rotated, so a corner drag (in screen
 * pixels/fractions) needs translating into the box's local axes before the
 * usual width/height maths applies -- otherwise dragging a corner of a tilted
 * box would grow or shrink it in the wrong screen direction.
 */
export function unrotateDelta(dx, dy, deg) {
  const rad = (-deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return [dx * cos - dy * sin, dx * sin + dy * cos];
}

// Split at the space closest to the middle; null when there is no space.
function splitInTwo(text) {
  const mid = text.length / 2;
  let best = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === " " && (best === -1 || Math.abs(i - mid) < Math.abs(best - mid))) best = i;
  }
  return best === -1 ? null : [text.slice(0, best), text.slice(best + 1)];
}
