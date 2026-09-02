// Gate G3: Inter is no longer the primary UI font.
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../src/styles/custom.css", import.meta.url), "utf8");

// The Google Fonts import must not pull Inter as the UI font.
if (/fonts\.googleapis\.com\/css2\?family=Inter/.test(css)) {
  console.error("Inter still imported from Google Fonts");
  process.exit(1);
}

// The --sl-font stack must not lead with Inter.
if (/--sl-font:\s*"Inter"/.test(css)) {
  console.error("--sl-font still leads with Inter");
  process.exit(1);
}

// A characterful replacement must be declared.
if (!/Geist|Outfit|Satoshi|Cabinet|Plus\s+Jakarta|Manrope|Söhne|Sohne/.test(css)) {
  console.error("no replacement display font declared");
  process.exit(1);
}

console.log("font verification passed");
