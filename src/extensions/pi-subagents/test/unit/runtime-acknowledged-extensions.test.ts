import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";
import { MAX_RUNTIME_ACKNOWLEDGED_EXTENSION_FILE_BYTES, isRuntimeAcknowledgedExtensionId, projectRuntimeAcknowledgedExtensions, readRuntimeAcknowledgedExtensions, sanitizeRuntimeAcknowledgedExtensions } from "../../src/runs/shared/runtime-acknowledged-extensions.ts";

describe("runtime acknowledged extension projection", () => {
	it("validates opaque ids without path-like content", () => {
		assert.equal(isRuntimeAcknowledgedExtensionId("com.example-extension:v1"), true);
		assert.equal(isRuntimeAcknowledgedExtensionId(""), false);
		assert.equal(isRuntimeAcknowledgedExtensionId("has space"), false);
		assert.equal(isRuntimeAcknowledgedExtensionId("../secret"), false);
		assert.equal(isRuntimeAcknowledgedExtensionId("path/to/ext"), false);
		assert.equal(isRuntimeAcknowledgedExtensionId("path\\to\\ext"), false);
		assert.equal(isRuntimeAcknowledgedExtensionId("x".repeat(129)), false);
	});

	it("deduplicates, caps ids, and counts omitted valid ids", () => {
		const ids = ["dup", "dup", ...Array.from({ length: 35 }, (_, index) => `ext-${index}`), "bad id"];
		const projected = projectRuntimeAcknowledgedExtensions(ids);

		assert.equal(projected?.source, "child-runtime");
		assert.equal(projected?.ids.length, 32);
		assert.equal(projected?.ids[0], "dup");
		assert.equal(projected?.omitted, 4);
		assert.equal(projected?.ids.includes("bad id"), false);
	});

	it("sanitizes persisted projections and rejects invalid shapes", () => {
		assert.deepEqual(sanitizeRuntimeAcknowledgedExtensions({ version: 1, source: "child-runtime", ids: ["ok", "ok", "bad/path"], omitted: 2 }), {
			version: 1,
			source: "child-runtime",
			ids: ["ok"],
			omitted: 2,
		});
		assert.equal(sanitizeRuntimeAcknowledgedExtensions({ version: 1, source: "launch-resolved", ids: ["ok"] }), undefined);
		assert.equal(sanitizeRuntimeAcknowledgedExtensions({ version: 1, source: "child-runtime", ids: ["bad/path"] }), undefined);
	});

	it("rejects oversized capture files without reading them", (t) => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-ack-"));
		t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
		const filePath = path.join(dir, "ack.json");

		fs.writeFileSync(filePath, "x".repeat(MAX_RUNTIME_ACKNOWLEDGED_EXTENSION_FILE_BYTES + 1));
		assert.equal(readRuntimeAcknowledgedExtensions(filePath), undefined);

		fs.writeFileSync(filePath, JSON.stringify({ version: 1, source: "child-runtime", ids: ["ok"], omitted: 0 }));
		assert.deepEqual(readRuntimeAcknowledgedExtensions(filePath), { version: 1, source: "child-runtime", ids: ["ok"], omitted: 0 });
	});
});
