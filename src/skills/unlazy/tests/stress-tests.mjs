#!/usr/bin/env node
// Concurrency and mutation stress tests. Zero dependencies. Node 16+.

import {
  existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync,
  symlinkSync, writeFileSync,
} from "node:fs";
import { execFile, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { claimLeases, releaseLeases, writeAtomic } from "../scripts/lib/gates.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const GATE_CHECK = join(HERE, "..", "scripts", "gate-check.mjs");
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), "unlazy-stress-"));
  return {
    dir,
    path(rel) { return join(dir, rel); },
    write(rel, value) {
      const path = join(dir, rel);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, value);
      return path;
    },
    read(rel) { return readFileSync(join(dir, rel), "utf8"); },
    cleanup() { rmSync(dir, { recursive: true, force: true }); },
  };
}

function run(script, args, options = {}) {
  return new Promise((done) => {
    const child = execFile(process.execPath, [script, ...args], {
      cwd: options.cwd,
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, ...(options.env || {}) },
      timeout: options.timeoutMs,
    }, (error, stdout, stderr) => {
      done({ code: error ? (typeof error.code === "number" ? error.code : 1) : 0, out: (stdout || "") + (stderr || "") });
    });
    if (options.stdin !== undefined) child.stdin.end(options.stdin);
  });
}

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const has = (text, value) => assert(text.includes(value), "missing " + JSON.stringify(value) + "\n" + text);

test("leases: 200 simultaneous conflicting claim pairs never both succeed", async () => {
  const s = sandbox();
  try {
    for (let iteration = 0; iteration < 200; iteration++) {
      const [left, right] = await Promise.all([
        claimLeases(s.dir, { scope: "left", leaf: "leaf-left", globs: ["src/shared/**"] }),
        claimLeases(s.dir, { scope: "right", leaf: "leaf-right", globs: ["src/shared/file.js"] }),
      ]);
      const successes = Number(left.ok) + Number(right.ok);
      assert(successes === 1, "iteration " + iteration + " had " + successes + " successful claims");
      await Promise.all([
        releaseLeases(s.dir, { scope: "left" }),
        releaseLeases(s.dir, { scope: "right" }),
      ]);
    }
  } finally { s.cleanup(); }
});

test("leases: the same scope and leaf cannot be claimed by two workers", async () => {
  const s = sandbox();
  try {
    const [left, right] = await Promise.all([
      claimLeases(s.dir, { scope: "same", leaf: "leaf", globs: ["src/shared/**"] }),
      claimLeases(s.dir, { scope: "same", leaf: "leaf", globs: ["src/shared/**"] }),
    ]);
    assert(Number(left.ok) + Number(right.ok) === 1,
      "duplicate logical owners both claimed one lease: " + JSON.stringify({ left, right }));
    const loser = left.ok ? right : left;
    assert(loser.conflicts.length === 1, "losing duplicate claim did not report its conflict");
    assert(loser.conflicts[0].with === "same/leaf", "duplicate conflict named the wrong owner");
    const released = await releaseLeases(s.dir, { scope: "same", leaf: "leaf" });
    assert(released === 1, "expected one exclusive lease to release, got " + released);
  } finally { s.cleanup(); }
});

test("leases: an explicit release cleans orphaned leases after a scope directory is gone", async () => {
  const s = sandbox();
  try {
    const claimed = await claimLeases(s.dir, { scope: "gone", leaf: "leaf-gone", globs: ["src/gone/**"] });
    assert(claimed.ok, "fixture lease was not created");
    const result = await run(GATE_CHECK, ["--scope", "gone", "--leaf", "leaf-gone", "--release"], { cwd: s.dir });
    assert(result.code === 0, result.out);
    has(result.out, "released 1 lease(s) for gone/leaf-gone");
    const lockNames = readdirSync(s.path(".unlazy/locks"));
    assert(!lockNames.some((name) => name.endsWith(".lease")), "orphan lease remained: " + lockNames.join(", "));

    s.write(".unlazy/live/gates/leaf-live.md", "# malformed zero-gate ledger\n");
    const liveClaim = await claimLeases(s.dir, { scope: "live", leaf: "leaf-live", globs: ["src/live/**"] });
    assert(liveClaim.ok, "live fixture lease was not created");
    const liveRelease = await run(GATE_CHECK, ["--scope", "live", "--leaf", "leaf-live", "--release"], { cwd: s.dir });
    assert(liveRelease.code === 0, "malformed live ledger blocked release\n" + liveRelease.out);
    has(liveRelease.out, "released 1 lease(s) for live/leaf-live");
  } finally { s.cleanup(); }
});

test("atomic writer: predictable pre-created temp links are never followed", async () => {
  if (process.platform === "win32") return;
  const s = sandbox();
  try {
    s.write("victim.txt", "safe\n");
    const target = s.path("state.json");
    symlinkSync(s.path("victim.txt"), target + "." + process.pid + ".tmp");
    writeAtomic(target, "new\n");
    assert(s.read("victim.txt") === "safe\n", "predictable temp symlink was followed");
    assert(s.read("state.json") === "new\n", "target was not written");
  } finally { s.cleanup(); }
});

test("status log: an existing symlink is refused without touching its target", async () => {
  if (process.platform === "win32") return;
  const s = sandbox();
  try {
    s.write(".unlazy/api/GATES.md", "# Gates\n\n- [ ] G1: pending\n  EVIDENCE: pending\n");
    s.write("victim.txt", "safe\n");
    symlinkSync(s.path("victim.txt"), s.path(".unlazy/api/status.log"));
    const result = await run(GATE_CHECK, ["--scope", "api", "--log", "attacker-controlled append"], { cwd: s.dir });
    assert(result.code === 2, "symlinked status log should fail closed\n" + result.out);
    has(result.out, "cannot append status");
    assert(s.read("victim.txt") === "safe\n", "status append followed the symlink");
  } finally { s.cleanup(); }
});

test("status log: an existing hard link is refused without touching its sibling", async () => {
  const s = sandbox();
  try {
    s.write(".unlazy/api/GATES.md", "# Gates\n\n- [ ] G1: pending\n  EVIDENCE: pending\n");
    s.write("victim.txt", "safe\n");
    linkSync(s.path("victim.txt"), s.path(".unlazy/api/status.log"));
    const result = await run(GATE_CHECK, ["--scope", "api", "--log", "attacker-controlled append"], { cwd: s.dir });
    assert(result.code === 2, "hard-linked status log should fail closed\n" + result.out);
    has(result.out, "cannot append status");
    assert(s.read("victim.txt") === "safe\n", "status append followed the hard link");
  } finally { s.cleanup(); }
});

test("status log: a FIFO is rejected without blocking the logger", async () => {
  if (process.platform === "win32") return;
  const s = sandbox();
  try {
    s.write(".unlazy/api/GATES.md", "# Gates\n\n- [ ] G1: pending\n  EVIDENCE: pending\n");
    const fifo = s.path(".unlazy/api/status.log");
    const made = spawnSync("mkfifo", [fifo], { encoding: "utf8" });
    assert(made.status === 0, "could not create FIFO fixture: " + made.stderr);
    const started = Date.now();
    const result = await run(GATE_CHECK, ["--scope", "api", "--log", "must not block"], {
      cwd: s.dir,
      timeoutMs: 2000,
    });
    assert(result.code === 2, "FIFO logger did not fail closed\n" + result.out);
    assert(Date.now() - started < 1800, "FIFO validation waited for the outer timeout");
    has(result.out, "cannot append status");
  } finally { s.cleanup(); }
});
