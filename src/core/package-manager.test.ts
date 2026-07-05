import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { extensionEntryName } from "./package-manager.js";

describe("extensionEntryName", () => {
	let root: string;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "selesai-ext-root-"));
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	it("normalizes loose script extension ids to match directory extension ids", () => {
		expect(extensionEntryName(join(root, "question.ts"), root)).toBe("question");
		expect(extensionEntryName(join(root, "question.js"), root)).toBe("question");
		expect(extensionEntryName(join(root, "question", "index.ts"), root)).toBe("question");
	});
});
