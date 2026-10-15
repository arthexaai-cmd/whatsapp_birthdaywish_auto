// Draws the birthday card: the user's background picture with one person's
// name fitted into the saved box. Used both for the editor preview and for the
// image that is actually sent, so what the user sees is what goes out.
//
// Pure Node (no Electron): fonts and the bundled starter picture are found
// through a `assetsDir` the caller supplies (the repo's assets/ in dev,
// resources/assets when packaged).

import fs from "node:fs";
import path from "node:path";
import { createCanvas, loadImage, GlobalFonts } from "@napi-rs/canvas";
import { CARD_FONTS, contrastStrokeColor, fitText, normalizeCardConfig } from "./cardLayout.js";
import { cardName, namePostfixFrom } from "./messages.js";

const MAX_SIDE = 1080; // default long side of the sent image; keeps uploads small and fast
const JPEG_QUALITY = 85;

let fontsFor = null; // assetsDir the fonts were registered from

function registerFonts(assetsDir) {
  if (fontsFor === assetsDir) return;
  for (const f of CARD_FONTS) {
    const p = path.join(assetsDir, "fonts", f.file);
    if (fs.existsSync(p)) GlobalFonts.registerFromPath(p, f.family);
  }
  fontsFor = assetsDir;
}

/** Path of the picture a config points at, or null when none is set. */
export function backgroundPathFor(config, { cardsDir, assetsDir }) {
  if (!config.image) return null;
  if (config.image === "starter") return path.join(assetsDir, "cards", "starter.jpg");
  return path.join(cardsDir, config.image);
}

/**
 * @param {object} opts
 * @param {object} opts.config      a card config (normalised here)
 * @param {string} opts.text        what to write on the card
 * @param {string} opts.cardsDir    folder holding the user's uploaded picture
 * @param {string} opts.assetsDir   folder holding fonts/ and cards/starter.jpg
 * @param {number} [opts.maxSide]   long side in px (smaller for review thumbnails)
 * @returns {Promise<Buffer>} a JPEG
 * @throws {Error} when no picture is set or it can't be read
 */
export async function renderCard({ config: rawConfig, text, cardsDir, assetsDir, maxSide = MAX_SIDE }) {
  const config = normalizeCardConfig(rawConfig);
  const bgPath = backgroundPathFor(config, { cardsDir, assetsDir });
  if (!bgPath) throw new Error("No birthday picture has been set up yet.");
  if (!fs.existsSync(bgPath)) throw new Error("The birthday picture file is missing. Please choose it again.");
  registerFonts(assetsDir);

  const img = await loadImage(fs.readFileSync(bgPath));
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  const W = Math.round(img.width * scale);
  const H = Math.round(img.height * scale);
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, W, H);

  const font = CARD_FONTS.find((f) => f.id === config.font);
  const bw = config.box.w * W;
  const bh = config.box.h * H;
  // Box centre in canvas space: text is drawn in a frame centred on the box
  // (local origin = box centre, so rotating the canvas around it rotates the
  // text with the box, the way the editor's overlay does visually).
  const cx = config.box.x * W + bw / 2;
  const cy = config.box.y * H + bh / 2;

  const measure = (s, size) => {
    ctx.font = `${size}px "${font.family}"`;
    return ctx.measureText(s).width;
  };
  const { lines, size, lineHeight } = fitText(measure, text, bw, bh);
  if (lines.length === 0) return canvas.encode("jpeg", JPEG_QUALITY);

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((config.rotation * Math.PI) / 180);

  ctx.font = `${size}px "${font.family}"`;
  ctx.textBaseline = "middle";
  ctx.textAlign = config.align;
  // Box-local coordinates: the box spans -bw/2..bw/2, -bh/2..bh/2 around the
  // rotation origin set above.
  const tx = config.align === "left" ? -bw / 2 : config.align === "right" ? bw / 2 : 0;
  const top = -(lines.length * lineHeight) / 2;

  lines.forEach((line, i) => {
    const ty = top + lineHeight * (i + 0.5);
    if (config.outline) {
      // An automatically contrasting outline (black on light text, white on
      // dark) keeps the name readable on a busy picture, whatever colour
      // the user picked.
      ctx.lineJoin = "round";
      ctx.lineWidth = Math.max(2, size / 12);
      ctx.strokeStyle = contrastStrokeColor(config.color);
      ctx.strokeText(line, tx, ty);
    }
    ctx.fillStyle = config.color;
    ctx.fillText(line, tx, ty);
  });
  ctx.restore();

  return canvas.encode("jpeg", JPEG_QUALITY);
}

/**
 * The `renderCard(person)` function runEngine expects, built from the saved
 * settings; null when no card can be made (no picture set up), which makes the
 * engine fall back to the text wish.
 */
export function makeCardRenderer({ settings, cardsDir, assetsDir, maxSide }) {
  const config = normalizeCardConfig(settings.cardConfig);
  if (!config.image) return null;
  const postfix = namePostfixFrom(settings);
  return (person) => renderCard({ config, text: cardName(person, config, postfix), cardsDir, assetsDir, maxSide });
}
