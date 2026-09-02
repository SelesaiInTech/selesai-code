// Gate G2: Intercom palette tokens present, old yellow accent gone.
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../src/styles/custom.css", import.meta.url), "utf8");

const required = {
  "cream canvas": "#f5f1ec",
  "charcoal ink": "#111111",
  "fin orange": "#ff5600",
  "hairline": "#d3cec6",
  "surface white": "#ffffff",
};

for (const [name, hex] of Object.entries(required)) {
  if (!css.includes(hex)) {
    console.error(`missing ${name} token ${hex}`);
    process.exit(1);
  }
}

// The old ClickHouse yellow accent must be gone from the theme.
if (css.includes("#faff69")) {
  console.error("legacy yellow accent #faff69 still present");
  process.exit(1);
}

console.log("palette verification passed");
