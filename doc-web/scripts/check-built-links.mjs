#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, "../dist");

const seen = new Set();
const broken = [];
const inferredBase =
  process.env.BASE_PATH ||
  (process.env.GITHUB_REPOSITORY
    ? `/${process.env.GITHUB_REPOSITORY.split("/")[1] || ""}`
    : "");
const base = inferredBase.replace(/\/$/, "");

function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
    } else if (entry.name.endsWith(".html")) {
      checkFile(full);
    }
  }
}

function resolveTarget(href, fileDir) {
  if (!href || href.startsWith("http") || href.startsWith("mailto:") || href.startsWith("#")) return null;
  let target = href;
  if (target.startsWith("/")) {
    target = target.slice(base.length || 0);
    if (target.startsWith("/")) target = target.slice(1);
  } else {
    target = path.relative(distDir, path.resolve(fileDir, target));
  }
  target = target.split("#")[0];
  if (!target) target = "index.html";
  const candidate = path.join(distDir, target);
  if (fs.existsSync(candidate)) return candidate;
  const withIndex = path.join(distDir, target, "index.html");
  if (fs.existsSync(withIndex)) return withIndex;
  return null;
}

function checkFile(file) {
  const content = fs.readFileSync(file, "utf8");
  const hrefs = content.matchAll(/href\s*=\s*["']([^"']+)["']/g);
  for (const [, href] of hrefs) {
    if (seen.has(`${file}::${href}`)) continue;
    seen.add(`${file}::${href}`);
    // Skip external, mail, and same-page fragment links; they are not validated here.
    if (/^(https?:|mailto:)/i.test(href) || href.startsWith("#")) continue;
    const target = resolveTarget(href, path.dirname(file));
    if (target === null) {
      // internal link that could not be resolved
      broken.push({ file, href });
    }
  }
}

walk(distDir);

if (broken.length) {
  console.error("Broken internal links:");
  for (const b of broken) console.error(`  ${b.file}: ${b.href}`);
  process.exit(1);
}

console.log("check-built-links: OK");
