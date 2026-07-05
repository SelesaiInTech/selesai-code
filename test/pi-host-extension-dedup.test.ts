import { describe, expect, it } from "vitest";
import { extensionEntryName } from "../src/core/package-manager.ts";
import { join } from "node:path";

describe("pi-host extension dedup", () => {
	it("extensionEntryName maps a package extension path to its entry dir", () => {
		const root = join("/home", "user", ".selesai", "agent", "extensions");
		// pi-subagents resolves to ./src/extension/index.ts per its package.json
		const entry = join(root, "pi-subagents", "src", "extension", "index.ts");
		expect(extensionEntryName(entry, root)).toBe("pi-subagents");
	});

	it("extensionEntryName maps a loose .ts file to its basename", () => {
		const root = join("/home", "user", ".pi", "agent", "extensions");
		expect(extensionEntryName(join(root, "copy-turn.ts"), root)).toBe("copy-turn.ts");
	});

	it("returns undefined for a path outside the root", () => {
		const root = join("/home", "user", ".selesai", "agent", "extensions");
		const elsewhere = join("/opt", "somewhere", "ext.ts");
		expect(extensionEntryName(elsewhere, root)).toBeUndefined();
	});

	it("same entry name in selesai and pi roots collides (name equality drives dedup)", () => {
		const selesaiRoot = join("/home", "user", ".selesai", "agent", "extensions");
		const piRoot = join("/home", "user", ".pi", "agent", "extensions");
		const a = extensionEntryName(join(selesaiRoot, "pi-subagents", "src", "extension", "index.ts"), selesaiRoot);
		const b = extensionEntryName(join(piRoot, "pi-subagents", "src", "extension", "index.ts"), piRoot);
		expect(a).toBe("pi-subagents");
		expect(b).toBe("pi-subagents");
		expect(a).toBe(b); // the dedup predicate
	});
});