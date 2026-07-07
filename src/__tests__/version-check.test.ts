import { afterEach, describe, expect, it, vi } from "vitest";
import { getLatestPackageRelease } from "../utils/version-check.ts";

describe("package version checks", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		delete process.env.PI_SKIP_VERSION_CHECK;
		delete process.env.PI_OFFLINE;
	});

	it("uses npm registry latest for fork packages", async () => {
		const fetchMock = vi.fn(async () =>
			new Response(JSON.stringify({ "dist-tags": { latest: "1.2.3" } }), { status: 200 }),
		);
		vi.stubGlobal("fetch", fetchMock);

		await expect(getLatestPackageRelease("@selesai/code", "0.3.3")).resolves.toEqual({
			packageName: "@selesai/code",
			version: "1.2.3",
		});
		expect(fetchMock).toHaveBeenCalledWith(
			"https://registry.npmjs.org/%40selesai%2Fcode",
			expect.objectContaining({ headers: expect.objectContaining({ accept: "application/json" }) }),
		);
	});
});
