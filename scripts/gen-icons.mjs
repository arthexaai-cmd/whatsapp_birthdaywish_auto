// Generates minimal placeholder icons so the app runs and packages without
// external design tools. Produces a solid-color rounded square with a "B"
// mark. Replace build/icon.ico and build/tray-icon.png with real branding
// before a real release -- these exist only so nothing is missing.

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";

function crc32(buf) {
  let c;
  const table = crc32.table || (crc32.table = (() => {
    const t = [];
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })());
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

/** Builds a simple solid-background PNG with a lighter rounded square "mark" -- good enough as a placeholder. */
function buildPng(size) {
  const bg = [22, 163, 74]; // accent green
  const mark = [255, 255, 255];
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const margin = Math.round(size * 0.28);

  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0; // filter type: none
    for (let x = 0; x < size; x++) {
      const i = rowStart + 1 + x * 4;
      const inMark = x > margin && x < size - margin && y > margin && y < size - margin;
      const [r, g, b] = inMark ? mark : bg;
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
      raw[i + 3] = 255;
    }
  }

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const idat = zlib.deflateSync(raw);
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

/** Wraps a single 256x256 PNG in a minimal ICO container (Windows supports PNG-compressed ICO entries since Vista). */
function buildIco(png256) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(1, 4); // 1 image

  const entry = Buffer.alloc(16);
  entry[0] = 0; // width 256 -> 0
  entry[1] = 0; // height 256 -> 0
  entry[2] = 0; // color palette
  entry[3] = 0; // reserved
  entry.writeUInt16LE(1, 4); // color planes
  entry.writeUInt16LE(32, 6); // bits per pixel
  entry.writeUInt32LE(png256.length, 8); // size of image data
  entry.writeUInt32LE(header.length + entry.length, 12); // offset

  return Buffer.concat([header, entry, png256]);
}

const buildDir = path.resolve(process.cwd(), "build");
fs.mkdirSync(buildDir, { recursive: true });

const trayPng = buildPng(32);
fs.writeFileSync(path.join(buildDir, "tray-icon.png"), trayPng);

const png256 = buildPng(256);
fs.writeFileSync(path.join(buildDir, "icon.ico"), buildIco(png256));

console.log("Wrote placeholder build/tray-icon.png and build/icon.ico");
