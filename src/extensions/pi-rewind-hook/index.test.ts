import { expect, test } from "vitest";

/** Loads the vendored rewind extension against the built host to prove module-level compatibility. */
test("pi-rewind-hook extension module loads against the host", async () => {
	const mod = await import("./index.ts");
	expect(mod.default).toBeTypeOf("function");
});
