#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const repoRoot = path.resolve(root, "..");

const REQUIRED_HEADINGS_EN = [
  "Setup and prerequisites",
  "What it sets up",
  "What you can configure",
  "What you can do",
  "Commands, tools, and shortcuts",
  "Limits and safety",
];

const REQUIRED_HEADINGS_ID = [
  "Penyiapan dan prasyarat",
  "Yang disiapkan",
  "Yang dapat dikonfigurasi",
  "Yang dapat dilakukan",
  "Perintah, tool, dan shortcut",
  "Batasan dan keamanan",
];

// Explicit mapping from src/extensions/package.json pi.extensions entries to the
// relative MDX path under doc-web/src/content/docs/capabilities/ (and id/capabilities/).
const BUNDLED_EXTENSION_GUIDES = {
  "./caveman/index.js": "skills/caveman",
  "./copy-turn.ts": "continuity/copy-turn",
  "./context-compaction-reminder.ts": "continuity/context-reminder",
  "./pi-intercom/index.ts": "continuity/intercom",
  "./ponytail/index.js": "skills/ponytail",
  "./question": "research/question",
  "./grep-app": "research/grep-app",
  "./handoff-new.ts": "continuity/handoff-new",
  "./inline-skills.ts": "skills/inline-skills",
  "./rtk.ts": "skills/rtk",
  "./tokenin-onboarding.ts": "workspace/tokenin-onboarding",
  "./undo.ts": "continuity/undo",
  "./workflow": "delegation/workflow",
  "./pi-subagents": "delegation/pi-subagents",
  "./pi-web-agent": "research/web-agent",
  "./web-agent-onboarding.ts": "workspace/web-agent-onboarding",
  "./pi-powerline-footer": "workspace/powerline-footer",
};

function loadCapabilities() {
  const enDir = path.join(root, "src/content/docs/capabilities");
  const idDir = path.join(root, "src/content/docs/id/capabilities");
  const enGuides = new Set();
  const idGuides = new Set();

  function collect(dir, rootDir, set) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const filePath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        collect(filePath, rootDir, set);
      } else if (entry.name.endsWith(".mdx")) {
        set.add(path.relative(rootDir, filePath).replace(/\.mdx$/, "").replace(/\\/g, "/"));
      }
    }
  }

  collect(enDir, enDir, enGuides);
  collect(idDir, idDir, idGuides);

  return { enGuides, idGuides };
}

function readGuide(filePath) {
  if (!fs.existsSync(filePath)) return "";
  return fs.readFileSync(filePath, "utf8");
}

function hasEvidenceLinks(content) {
  const literalUrl = /https:\/\/github\.com\/SelesaiInTech\/selesai-code\/blob\/main/.test(content);
  const sourceEvidenceCall = /<SourceEvidence\b/.test(content);
  const explicitEvidenceProp = /<SourceEvidence\b[^>]*\blinks\s*=\s*\{[^}]*github\.com\/SelesaiInTech\/selesai-code\/blob\/main/s.test(content);
  return literalUrl || explicitEvidenceProp || sourceEvidenceCall;
}

function checkHeadings(content, locale) {
  const required = locale === "en" ? REQUIRED_HEADINGS_EN : REQUIRED_HEADINGS_ID;
  const missing = required.filter((h) => !content.toLowerCase().includes(`# ${h.toLowerCase()}`));
  return missing;
}

function loadManifestExtensions() {
  const manifestPath = path.join(repoRoot, "src/extensions/package.json");
  if (!fs.existsSync(manifestPath)) {
    return { error: `Manifest not found: ${manifestPath}`, entries: [] };
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const entries = Array.isArray(manifest?.pi?.extensions) ? manifest.pi.extensions : [];
  return { error: null, entries };
}

function parseCapabilitiesTs() {
  const capabilitiesPath = path.join(root, "src/data/capabilities.ts");
  if (!fs.existsSync(capabilitiesPath)) {
    return { error: `capabilities.ts not found: ${capabilitiesPath}`, records: [] };
  }
  const content = fs.readFileSync(capabilitiesPath, "utf8");
  const records = [];

  // Extract each object literal inside the `capabilities` array.
  const arrayMatch = content.match(/export\s+const\s+capabilities\s*:\s*Capability\[\]\s*=\s*\[([\s\S]*?)\];/);
  if (!arrayMatch) {
    return { error: "Could not locate capabilities array in capabilities.ts", records: [] };
  }

  const rawItems = arrayMatch[1].split(/^\s*\},\s*\{\s*$/m);
  for (const raw of rawItems) {
    const slug = raw.match(/slug\s*:\s*["']([^"']+)["']/)?.[1];
    const category = raw.match(/category\s*:\s*["']([^"']+)["']/)?.[1];
    const distribution = raw.match(/distribution\s*:\s*["']([^"']+)["']/)?.[1];
    const manifestEntry = raw.match(/manifestEntry\s*:\s*["']([^"']+)["']/)?.[1];
    const guideRoute = raw.match(/guideRoute\s*:\s*["']([^"']+)["']/)?.[1];
    if (slug) {
      records.push({ slug, category, distribution, manifestEntry, guideRoute });
    }
  }

  return { error: null, records };
}

const errors = [];
const { enGuides, idGuides } = loadCapabilities();

// Expect exactly the same guide set in both locales
for (const g of enGuides) {
  if (!idGuides.has(g)) errors.push(`ID guide missing for ${g}`);
}
for (const g of idGuides) {
  if (!enGuides.has(g)) errors.push(`EN guide missing for ${g}`);
}

// Validate each EN/ID guide pair
for (const g of enGuides) {
  const enPath = path.join(root, "src/content/docs/capabilities", `${g}.mdx`);
  const idPath = path.join(root, "src/content/docs/id/capabilities", `${g}.mdx`);
  const enContent = readGuide(enPath);
  const idContent = readGuide(idPath);

  const enMissing = checkHeadings(enContent, "en");
  const idMissing = checkHeadings(idContent, "id");

  if (enMissing.length) errors.push(`${g} EN missing headings: ${enMissing.join(", ")}`);
  if (idMissing.length) errors.push(`${g} ID missing headings: ${idMissing.join(", ")}`);

  if (!hasEvidenceLinks(enContent)) errors.push(`${g} EN lacks evidence links`);
  if (!hasEvidenceLinks(idContent)) errors.push(`${g} ID lacks evidence links`);

  // Reject stale non-existent commands, while allowing prose that explicitly says the command does not exist.
  for (const { locale, content } of [
    { locale: "EN", content: enContent },
    { locale: "ID", content: idContent },
  ]) {
    if (content.includes("/rewind") && !/no\s+[`']?\/?rewind[`']?|tidak ada\s+[`']?\/?rewind[`']?|does not exist|tidak ada|bukan perintah|is not a command/i.test(content)) {
      errors.push(`${g} ${locale} references stale /rewind command`);
    }
    if (content.includes("/tokenin-onboard") && !/does\s+[*_]*not[*_]*\s+exist|tidak\s+[*_]*ada[*_]*|bukan perintah|is not a command|tidak\s+tersedia|jangan gunakan/i.test(content)) {
      errors.push(`${g} ${locale} references stale /tokenin-onboard command`);
    }
  }
}

// Validate that core top-level pages exist in both locales
const corePages = [
  "index.mdx",
  "get-started.mdx",
  "why-selesai.mdx",
  "capabilities.mdx",
  "evidence.mdx",
  "changelog.mdx",
  "accessibility.mdx",
];
for (const page of corePages) {
  for (const locale of ["en", "id"]) {
    const p =
      locale === "en"
        ? path.join(root, "src/content/docs", page)
        : path.join(root, "src/content/docs/id", page);
    if (!fs.existsSync(p)) errors.push(`Missing core page: ${locale}/${page}`);
  }
}

// Manifest-to-doc inventory validation
const { error: manifestError, entries: manifestEntries } = loadManifestExtensions();
const manifestSet = new Set(manifestEntries);
if (manifestError) {
  errors.push(manifestError);
} else {
  for (const entry of manifestEntries) {
    const slug = BUNDLED_EXTENSION_GUIDES[entry];
    if (!slug) {
      errors.push(`Manifest entry ${entry} has no documented guide mapping`);
      continue;
    }
    if (!enGuides.has(slug) || !idGuides.has(slug)) {
      errors.push(`Bundled extension ${entry} (slug ${slug}) is missing its EN or ID guide`);
    }
  }
}

// Conservative capabilities.ts metadata validation
const { error: capabilitiesError, records: capabilityRecords } = parseCapabilitiesTs();
if (capabilitiesError) {
  errors.push(capabilitiesError);
} else {
  for (const record of capabilityRecords) {
    if (record.distribution === "bundled") {
      if (!record.manifestEntry) {
        errors.push(`Bundled capability ${record.slug} is missing manifestEntry metadata`);
      } else if (!manifestSet.has(record.manifestEntry)) {
        errors.push(
          `Bundled capability ${record.slug} declares manifestEntry ${record.manifestEntry} which is not in src/extensions/package.json pi.extensions`
        );
      }
    }

    if (record.distribution === "optional" && record.manifestEntry) {
      errors.push(
        `Optional capability ${record.slug} must not declare manifestEntry ${record.manifestEntry}`
      );
    }

    if (record.distribution === "bundled" && record.guideRoute) {
      const relativeGuide = record.guideRoute.replace(/^capabilities\//, "");
      const expectedEntry = Object.entries(BUNDLED_EXTENSION_GUIDES).find(([, slug]) => slug === relativeGuide)?.[0];
      if (!expectedEntry || !manifestSet.has(expectedEntry)) {
        errors.push(
          `Bundled capability ${record.slug} guideRoute ${record.guideRoute} is not backed by a manifest entry in src/extensions/package.json`
        );
      }
    }
  }

  // Catch a bundled data/sidebar route that is not represented in the manifest at all.
  const bundledRoutes = new Set(
    capabilityRecords
      .filter((r) => r.distribution === "bundled")
      .map((r) => r.guideRoute?.replace(/^capabilities\//, ""))
      .filter(Boolean)
  );
  const manifestBackedRoutes = new Set(
    manifestEntries.map((entry) => BUNDLED_EXTENSION_GUIDES[entry]).filter(Boolean)
  );
  for (const route of bundledRoutes) {
    if (!manifestBackedRoutes.has(route)) {
      errors.push(
        `Bundled capability route capabilities/${route} is not covered by any manifest entry in src/extensions/package.json`
      );
    }
  }
}

if (errors.length) {
  for (const e of errors) console.error("ERROR:", e);
  process.exit(1);
}

console.log("validate-content: OK");
