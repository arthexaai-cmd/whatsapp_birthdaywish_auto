// Generates assets/cards/starter.jpg, the sample birthday picture offered in the
// Cards screen. Leaves a clear band in the middle for the name. Run once:
//   node scripts/gen-starter-card.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
GlobalFonts.registerFromPath(path.join(root, "assets/fonts/Pacifico.woff"), "Pacifico");
GlobalFonts.registerFromPath(path.join(root, "assets/fonts/Poppins-Bold.woff"), "Poppins Bold");

const S = 1080;
const c = createCanvas(S, S);
const g = c.getContext("2d");

const bg = g.createLinearGradient(0, 0, S, S);
bg.addColorStop(0, "#5b2a86");
bg.addColorStop(1, "#e6447a");
g.fillStyle = bg;
g.fillRect(0, 0, S, S);

// Deterministic confetti so the file is reproducible.
let seed = 7;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const colors = ["#ffd166", "#06d6a0", "#ffffff", "#4cc9f0", "#ff8fab"];
for (let i = 0; i < 140; i++) {
  const x = rnd() * S;
  const y = rnd() * S;
  if (y > 380 && y < 700) continue; // keep the name band clean
  g.save();
  g.translate(x, y);
  g.rotate(rnd() * Math.PI);
  g.fillStyle = colors[Math.floor(rnd() * colors.length)];
  g.globalAlpha = 0.85;
  g.fillRect(-9, -4, 18, 8);
  g.restore();
}

g.textAlign = "center";
g.fillStyle = "#ffffff";
g.font = '130px "Pacifico"';
g.fillText("Happy", S / 2, 250);
g.fillText("Birthday!", S / 2, 370);

g.font = '44px "Poppins Bold"';
g.fillStyle = "#ffe8a3";
g.fillText("Wishing you a wonderful year ahead", S / 2, 880);

fs.mkdirSync(path.join(root, "assets/cards"), { recursive: true });
fs.writeFileSync(path.join(root, "assets/cards/starter.jpg"), await c.encode("jpeg", 88));
console.log("wrote assets/cards/starter.jpg");
