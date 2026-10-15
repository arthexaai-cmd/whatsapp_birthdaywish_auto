// Brings the user's chosen picture into the app: checks it really is a usable
// image, shrinks it if it is huge, and saves it as a JPEG inside the app's own
// folder (so a later move or delete of the original doesn't break the card).

import fs from "node:fs";
import path from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const MAX_SIDE = 2000;
const MIN_SIDE = 200;
export const STORED_NAME = "background.jpg";

/**
 * @param {string} srcPath  the file the user picked
 * @param {string} cardsDir where to store it (created if missing)
 * @returns {Promise<{image: string, width: number, height: number}>}
 * @throws {Error} with a plain-English message
 */
export async function importBackground(srcPath, cardsDir) {
  let stat;
  try {
    stat = fs.statSync(srcPath);
  } catch {
    throw new Error("That file could not be found. Please choose it again.");
  }
  if (!stat.isFile()) throw new Error("Please choose a picture file.");
  if (stat.size > MAX_UPLOAD_BYTES) throw new Error("That picture is too large (over 25 MB). Please choose a smaller one.");

  let img;
  try {
    img = await loadImage(fs.readFileSync(srcPath));
  } catch {
    throw new Error("That file couldn't be opened as a picture. Please try a different JPG or PNG.");
  }
  if (Math.min(img.width, img.height) < MIN_SIDE) throw new Error("That picture is too small. Please choose one at least 200 pixels wide and tall.");

  const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
  const width = Math.round(img.width * scale);
  const height = Math.round(img.height * scale);
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff"; // a transparent PNG becomes white, not black
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);

  fs.mkdirSync(cardsDir, { recursive: true });
  fs.writeFileSync(path.join(cardsDir, STORED_NAME), await canvas.encode("jpeg", 90));
  return { image: STORED_NAME, width, height };
}
