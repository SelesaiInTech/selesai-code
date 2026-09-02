// Gate G5: no generic drop shadows on cards. Intercom depth = surface lift, not shadow.
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

// Banned: box-shadow declarations that are not inset highlights or explicit resets.
const shadowDecls = [...all.matchAll(/box-shadow\s*:\s*([^;]+);/g)].map((m) => m[1].trim());
const generic = shadowDecls.filter((s) => !s.startsWith("inset") && s !== "none");
if (generic.length > 0) {
  console.error(`generic drop shadows found: ${generic.join(" | ")}`);
  process.exit(1);
}

console.log("shadows verification passed");
