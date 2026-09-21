import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

const root = process.cwd();
const src = join(root, "src");
const pattern = /"\.pi"|\/\.pi\/|join\([^)]*"\.pi"|homedir\(\),\s*"\.pi"|\.pi\/agent/;
if (!pattern.test('join(homedir(), ".pi", "agent")')) throw new Error("positive control did not detect a known leak");
async function walk(dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else if (entry.isFile() && entry.name.endsWith(".ts")) files.push(path);
  }
  return files;
}
function intentional(path, line) {
  if (path === "src/core/package-manager.ts") return true; // upstream-host extension probing
  if (path === "src/config.ts" && line.includes('pkg.piConfig?.configDir || ".pi"')) return true; // package-config fallback
  if (path === "src/migrations.ts") return true; // historical Pi session source documented by the migration
  if (path === "src/extensions/pi-subagents/src/agents/agents.ts" && line.includes('".pi"')) return true; // prune both host dirs
  return false;
}
const unexpected = [];
const allowed = [];
for (const file of await walk(src)) {
  const rel = relative(root, file);
  const lines = (await readFile(file, "utf8")).split("\n");
  lines.forEach((line, index) => {
    if (!pattern.test(line)) return;
    const hit = `${rel}:${index + 1}: ${line.trim()}`;
    (intentional(rel, line) ? allowed : unexpected).push(hit);
  });
}
if (unexpected.length) {
  console.error("Unexpected .pi candidates:\n" + unexpected.join("\n"));
  process.exit(1);
}
console.log(`CONFIG DIR AUDIT OK (${allowed.length} intentional candidates)`);
