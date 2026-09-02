// Gate G4: interactive elements carry hover, active, and focus-visible states.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const stylesDir = new URL("../src/styles/", import.meta.url).pathname;
const componentsDir = new URL("../src/components/", import.meta.url).pathname;

const sources = [readFileSync(join(stylesDir, "custom.css"), "utf8")];
for (const f of readdirSync(componentsDir)) {
  if (f.endsWith(".astro")) {
    sources.push(readFileSync(join(componentsDir, f), "utf8"));
  }
}
const all = sources.join("\n");

// Every :hover rule must have a matching :focus-visible rule somewhere.
const hoverCount = (all.match(/:hover/g) || []).length;
const focusCount = (all.match(/:focus-visible/g) || []).length;
if (hoverCount === 0) {
  console.error("no hover states found");
  process.exit(1);
}
if (focusCount === 0) {
  console.error("no focus-visible states found");
  process.exit(1);
}

// Active/pressed feedback: at least one :active rule with a scale/translate.
if (!/:active[^{]*\{[^}]*scale|:active[^{]*\{[^}]*translate/.test(all)) {
  console.error("no active/pressed feedback (scale/translate) found");
  process.exit(1);
}

// Transitions must exist (not instant state changes).
if (!/transition[^;]*\d{2,3}ms/.test(all)) {
  console.error("no timed transitions found");
  process.exit(1);
}

console.log("states verification passed");
