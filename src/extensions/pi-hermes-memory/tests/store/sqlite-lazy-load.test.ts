import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src");

const POISON_REQUIRE = [
  'import Module from "node:module";',
  'import path from "node:path";',
  "const original = Module.prototype.require;",
  "Module.prototype.require = function (id: string) {",
  '  if (id === "better-sqlite3") {',
  "    throw Object.assign(new Error(\"Cannot find package 'better-sqlite3'\"), { code: \"MODULE_NOT_FOUND\" });",
  "  }",
  "  return original.apply(this, arguments as never);",
  "};",
].join("\n");

/**
 * Run `body` in a child process where `require("better-sqlite3")` always fails,
 * standing in for compiled Pi, whose Bun resolver cannot find the package from
 * an on-disk extension file.
 */
function runWithoutBetterSqlite3(body: string): { status: number | null; output: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-lazy-sqlite-"));
  try {
    const child = path.join(dir, "probe.mts");
    fs.writeFileSync(child, `${POISON_REQUIRE}\n${body}\n`);
    const result = spawnSync(process.execPath, ["--import", "tsx", child], { encoding: "utf-8" });
    return { status: result.status, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Regression guard for issue #117: a module-scope native load turned an
 * unresolvable better-sqlite3 into "Failed to load extension", bricking the
 * extension for every compiled-Pi user instead of failing at the point of use.
 */
describe("SQLite native loading is deferred past extension load", () => {
  it("imports the extension-load module graph without resolving better-sqlite3", () => {
    // Dynamic import: the specifiers are absolute paths built at runtime so the
    // poisoned require hook is installed before the graph is evaluated.
    const body = [
      `for (const specifier of ${JSON.stringify([
        path.join(srcRoot, "extension-root-migration.ts"),
        path.join(srcRoot, "store/db.ts"),
        path.join(srcRoot, "store/atomic-lock-coordinator.ts"),
      ])}) {`,
      "  await import(specifier);",
      "}",
      'console.log("IMPORTED_OK");',
    ].join("\n");

    const { status, output } = runWithoutBetterSqlite3(body);
    assert.match(output, /IMPORTED_OK/);
    assert.equal(status, 0);
  });

  it("still fails loudly when SQLite is actually used", () => {
    const body = [
      `const { AtomicLockCoordinator } = await import(${JSON.stringify(path.join(srcRoot, "store/atomic-lock-coordinator.ts"))});`,
      'const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-lazy-sqlite-use-"));',
      'new AtomicLockCoordinator(path.join(dir, "locks.sqlite")).tryAcquire("k", { staleMs: 1000 });',
    ].join("\n");

    const { status, output } = runWithoutBetterSqlite3(
      `import fs from "node:fs";\nimport os from "node:os";\n${body}`,
    );
    assert.notEqual(status, 0);
    assert.match(output, /better-sqlite3/);
  });
});
