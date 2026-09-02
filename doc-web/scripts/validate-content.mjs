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
  "./copy-turn.ts": "continuity/copy-turn",
  "./auto-session-name.ts": "continuity/auto-session-name",
  "./cost-reconcile.ts": "workspace/cost-reconcile",
  "./pi-tool-display": "workspace/tool-display",
  "./context-compaction-reminder.ts": "continuity/context-reminder",
  "./pi-intercom/index.ts": "continuity/intercom",
  "./ponytail/index.js": "skills/ponytail",
  "./question": "research/question",
  "./grep-app": "research/grep-app",
  "./handoff-new.ts": "continuity/handoff-new",
  "./inline-skills.ts": "skills/inline-skills",
  "./rtk.ts": "skills/rtk",
  "./agent-browser.ts": "skills/agent-browser",
  "./tokenin-onboarding.ts": "workspace/tokenin-onboarding",
  "./undo.ts": "continuity/undo",
  "./pi-subagents": "delegation/pi-subagents",
  "./pi-web-agent": "research/web-agent",
  "./pi-hermes-memory": "continuity/pi-hermes-memory",
  "./herdr-agent-state.ts": "continuity/herdr-agent-state",
  "./web-agent-onboarding.ts": "workspace/web-agent-onboarding",
  "./tps.ts": "workspace/tps",
  "./pi-zentui/extensions/zentui/index.ts": "workspace/zentui",
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

function loadCustomizationCatalog() {
  const catalogPath = path.join(root, "src/data/extension-customization.json");
  if (!fs.existsSync(catalogPath)) {
    return { error: `Customization catalog not found: ${catalogPath}`, catalog: [] };
  }
  try {
    const data = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
    const catalog = Array.isArray(data?.catalog) ? data.catalog : [];
    return { error: null, catalog };
  } catch (e) {
    return { error: `Invalid JSON in ${catalogPath}: ${e.message}`, catalog: [] };
  }
}

function normalizeSettingKey(key) {
  return String(key ?? "").trim();
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
    if (content.includes("/tokenin-onboard") && !/does\s+[*_]*not[*_]*\s+exist|tidak\s*[*_]*\s*ada|bukan\s+perintah|is not a command|tidak\s+tersedia|jangan\s+gunakan/i.test(content)) {
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
  "settings.mdx",
  "evidence.mdx",
  "changelog.mdx",
  "accessibility.mdx",
  "customization.mdx",
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

    if (record.distribution === "core" && record.manifestEntry) {
      errors.push(
        `Core capability ${record.slug} must not declare manifestEntry ${record.manifestEntry}`
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

// Customization catalog validation
const { error: catalogError, catalog } = loadCustomizationCatalog();
if (catalogError) {
  errors.push(catalogError);
}

if (!catalogError && capabilityRecords.length > 0 && catalog.length > 0) {
  const catalogBySlug = new Map(catalog.map((r) => [r.slug, r]));
  const validDistributions = new Set(["bundled", "optional", "core"]);

  // Exactly one catalog record for every capability slug
  for (const cap of capabilityRecords) {
    const record = catalogBySlug.get(cap.slug);
    if (!record) {
      errors.push(`Missing customization catalog record for capability ${cap.slug}`);
      continue;
    }

    // Distribution must match capabilities.ts
    if (record.distribution !== cap.distribution) {
      errors.push(
        `Customization record for ${cap.slug} declares distribution ${record.distribution} but capabilities.ts has ${cap.distribution}`
      );
    }

    // Distribution validity
    if (!validDistributions.has(record.distribution)) {
      errors.push(`Customization record for ${cap.slug} has invalid distribution ${record.distribution}`);
    }

    // Manifest relationship: bundled records must reference a manifest entry, optional/core must not
    if (record.distribution === "bundled") {
      if (!cap.manifestEntry || !manifestSet.has(cap.manifestEntry)) {
        errors.push(
          `Bundled customization record ${cap.slug} is not backed by a manifest entry in src/extensions/package.json`
        );
      }
    }
    if ((record.distribution === "optional" || record.distribution === "core") && cap.manifestEntry) {
      errors.push(
        `${record.distribution} capability ${cap.slug} must not have a manifestEntry in capabilities.ts`
      );
    }

    // Localized content for overview
    if (!record.overview || typeof record.overview.en !== "string" || !record.overview.en.trim()) {
      errors.push(`Customization record ${cap.slug} missing EN overview`);
    }
    if (!record.overview || typeof record.overview.id !== "string" || !record.overview.id.trim()) {
      errors.push(`Customization record ${cap.slug} missing ID overview`);
    }

    // Source paths existence
    const sourcePaths = Array.isArray(record.sourcePaths) ? record.sourcePaths : [];
    if (sourcePaths.length === 0) {
      errors.push(`Customization record ${cap.slug} has no sourcePaths`);
    }
    for (const sp of sourcePaths) {
      const resolved = path.join(repoRoot, sp);
      if (!fs.existsSync(resolved)) {
        errors.push(`Customization record ${cap.slug} references missing source path: ${sp}`);
      }
    }

    // noConfig consistency: no persistent user-owned settings/env/scopes. Invocation/session-only
    // entries are allowed because they document behavior rather than user configuration.
    if (record.noConfig === true) {
      for (const setting of record.settings || []) {
        const persistence = String(setting.persistence ?? "").toLowerCase();
        if (!/invocation|session|command argument|tool call|source-defined|external binary|skill files/.test(persistence)) {
          errors.push(
            `Customization record ${cap.slug} sets noConfig but has setting ${normalizeSettingKey(setting.key)} with persistence ${setting.persistence}`
          );
        }
      }
      for (const envVar of record.envVars || []) {
        errors.push(
          `Customization record ${cap.slug} sets noConfig but declares env var ${envVar.key}; move it to controls/settings with invocation/session persistence or remove noConfig`
        );
      }
      for (const scope of record.scopes || []) {
        const scopePath = String(scope.path ?? "").toLowerCase();
        if (!/invocation|session|command|tool|source|mode-owned/.test(scopePath)) {
          errors.push(
            `Customization record ${cap.slug} sets noConfig but declares persistent scope ${scope.path}`
          );
        }
      }
    }
  }

  // No extra catalog records that do not map to a capability
  const capabilitySlugs = new Set(capabilityRecords.map((c) => c.slug));
  for (const record of catalog) {
    if (!capabilitySlugs.has(record.slug)) {
      errors.push(`Customization catalog contains unknown slug: ${record.slug}`);
    }
  }

  // Guide wiring: every EN/ID guide for a capability must import and invoke ExtensionCustomization with matching slug and locale
  for (const g of enGuides) {
    const cap = capabilityRecords.find((c) => c.guideRoute === `capabilities/${g}`);
    if (!cap) continue;

    for (const { locale, content, fullPath } of [
      { locale: "en", content: readGuide(path.join(root, "src/content/docs/capabilities", `${g}.mdx`)), fullPath: `capabilities/${g}` },
      { locale: "id", content: readGuide(path.join(root, "src/content/docs/id/capabilities", `${g}.mdx`)), fullPath: `id/capabilities/${g}` },
    ]) {
      if (!content.includes("import ExtensionCustomization")) {
        errors.push(`${fullPath} does not import ExtensionCustomization`);
        continue;
      }
      const invocationRegex = /<ExtensionCustomization\s+slug\s*=\s*["']([^"']+)["']\s+locale\s*=\s*["']([^"']+)["']\s*\/>/;
      const match = content.match(invocationRegex);
      if (!match) {
        errors.push(`${fullPath} does not invoke ExtensionCustomization with slug and locale props`);
      } else {
        const [, invokedSlug, invokedLocale] = match;
        if (invokedSlug !== cap.slug) {
          errors.push(`${fullPath} invokes ExtensionCustomization with slug ${invokedSlug}, expected ${cap.slug}`);
        }
        if (invokedLocale !== locale) {
          errors.push(`${fullPath} invokes ExtensionCustomization with locale ${invokedLocale}, expected ${locale}`);
        }
      }
    }
  }
}

if (errors.length) {
  for (const e of errors) console.error("ERROR:", e);
  process.exit(1);
}

console.log("validate-content: OK");
