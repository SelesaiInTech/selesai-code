import { describe, test, before, after } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { expandHomePath, resolveChainPath } from "../../src/shared/settings.ts";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-reads-resolution-"));
const homeDir = path.join(tmpDir, "home");
const chainDir = path.join(tmpDir, "chain");
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;

before(() => {
	process.env.HOME = homeDir;
	process.env.USERPROFILE = homeDir;
	assert.equal(os.homedir(), homeDir);
});

after(() => {
	if (originalHome === undefined) delete process.env.HOME;
	else process.env.HOME = originalHome;
	if (originalUserProfile === undefined) delete process.env.USERPROFILE;
	else process.env.USERPROFILE = originalUserProfile;
});

describe("reads path resolution", () => {
	describe("expandHomePath", () => {
		test("expands bare ~ to the home directory", () => {
			assert.equal(expandHomePath("~"), homeDir);
		});

		test("expands ~/ to the home directory", () => {
			assert.equal(expandHomePath("~/"), homeDir);
		});

		test("expands ~/file to <home>/file", () => {
			assert.equal(expandHomePath("~/.zprofile"), path.join(homeDir, ".zprofile"));
		});

		test("leaves absolute paths unchanged", () => {
			assert.equal(expandHomePath("/etc/hosts"), "/etc/hosts");
		});

		test("leaves repository-relative paths unchanged", () => {
			assert.equal(expandHomePath("docs/x.md"), "docs/x.md");
		});
	});

	describe("resolveChainPath", () => {
		test("expands ~ before resolving", () => {
			assert.equal(
				resolveChainPath("~/.zprofile", chainDir),
				path.join(homeDir, ".zprofile"),
			);
		});

		test("passes absolute paths through", () => {
			assert.equal(resolveChainPath("/etc/hosts", chainDir), "/etc/hosts");
		});

		test("prepends chainDir to repository-relative paths", () => {
			assert.equal(resolveChainPath("docs/x.md", chainDir), path.join(chainDir, "docs/x.md"));
		});
	});
});
