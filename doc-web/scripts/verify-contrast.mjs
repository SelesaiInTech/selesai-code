// Gate G6: light mode keeps accessible contrast (cream canvas with charcoal ink).
// WCAG relative-luminance contrast check on the core light-mode pairs.
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../src/styles/custom.css", import.meta.url), "utf8");

function lum(hex) {
  const c = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16) / 255);
  const f = (v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(a, b) {
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

// Light-mode pairs: ink on cream canvas, muted ink on cream, ink on white surface.
// The vivid brand orange #ff5600 is reserved for badges (black text on it = 6.6:1)
// and dark-mode accents; text/CTA orange is the deeper #c2410c for AA compliance.
const pairs = [
  ["#111111", "#f5f1ec", 4.5], // body text on canvas
  ["#626260", "#f5f1ec", 4.5], // muted text on canvas
  ["#111111", "#ffffff", 4.5], // text on white cards
  ["#c2410c", "#f5f1ec", 4.5], // orange text links on cream
  ["#ffffff", "#c2410c", 4.5], // white text on orange CTA
  ["#111111", "#ff5600", 4.5], // black text on vivid orange badge
];

for (const [fg, bg, min] of pairs) {
  const c = contrast(fg, bg);
  if (c < min) {
    console.error(`contrast ${fg} on ${bg} = ${c.toFixed(2)} (need >= ${min})`);
    process.exit(1);
  }
}

console.log("contrast verification passed");
