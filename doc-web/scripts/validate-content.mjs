#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const REQUIRED_HEADINGS_EN = [
  "What it is",
  "Availability",
  "Quick start",
  "Configuration",
  "Limits",
];

const REQUIRED_HEADINGS_ID = [
  "Apa ini",
  "Ketersediaan",
  "Mulai cepat",
  "Konfigurasi",
  "Batasan",
];

function loadCapabilities() {
  // We can't import TS easily, so use a JSON mirror if generated; otherwise just validate from directory scan.
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
  return /https:\/\/github\.com\/SelesaiInTech\/selesai-code\/blob\/main/.test(content);
}

function checkHeadings(content, locale) {
  const required = locale === "en" ? REQUIRED_HEADINGS_EN : REQUIRED_HEADINGS_ID;
  const missing = required.filter((h) => !content.toLowerCase().includes(`# ${h.toLowerCase()}`));
  return missing;
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
}

// Validate that core top-level pages exist in both locales
const corePages = ["index.mdx", "get-started.mdx", "why-selesai.mdx", "capabilities.mdx", "evidence.mdx", "changelog.mdx", "accessibility.mdx"];
for (const page of corePages) {
  for (const locale of ["en", "id"]) {
    const p = locale === "en"
      ? path.join(root, "src/content/docs", page)
      : path.join(root, "src/content/docs/id", page);
    if (!fs.existsSync(p)) errors.push(`Missing core page: ${locale}/${page}`);
  }
}

if (errors.length) {
  for (const e of errors) console.error("ERROR:", e);
  process.exit(1);
}

console.log("validate-content: OK");
