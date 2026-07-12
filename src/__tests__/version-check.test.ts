import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkForNewPiVersion, getLatestPackageRelease } from "../utils/version-check.ts";

describe("package version checks", () => {
	beforeEach(() => {
		process.env.PI_OFFLINE = "";
		process.env.PI_SKIP_VERSION_CHECK = "";
	});

	afterEach(() => {
		vi.unstubAllGlobals();
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

	describe("checkForNewPiVersion", () => {
		it("returns newer release when registry version is newer", async () => {
			const fetchMock = vi.fn(async () =>
				new Response(JSON.stringify({ "dist-tags": { latest: "1.2.4" } }), { status: 200 }),
			);
			vi.stubGlobal("fetch", fetchMock);

			await expect(checkForNewPiVersion("1.2.3", "@selesai/code")).resolves.toEqual({
				packageName: "@selesai/code",
				version: "1.2.4",
			});
			expect(fetchMock).toHaveBeenCalledWith(
				"https://registry.npmjs.org/%40selesai%2Fcode",
				expect.anything(),
			);
		});

		it("returns undefined when registry version is current", async () => {
			vi.stubGlobal(
				"fetch",
				vi.fn(async () => new Response(JSON.stringify({ "dist-tags": { latest: "1.2.3" } }), { status: 200 })),
			);

			await expect(checkForNewPiVersion("1.2.3", "@selesai/code")).resolves.toBeUndefined();
		});

		it("returns undefined offline", async () => {
			const fetchMock = vi.fn(async () => new Response("", { status: 200 }));
			vi.stubGlobal("fetch", fetchMock);
			process.env.PI_OFFLINE = "1";

			await expect(checkForNewPiVersion("1.2.3", "@selesai/code")).resolves.toBeUndefined();
			expect(fetchMock).not.toHaveBeenCalled();
		});

		it("returns undefined when skipped", async () => {
			const fetchMock = vi.fn(async () => new Response("", { status: 200 }));
			vi.stubGlobal("fetch", fetchMock);
			process.env.PI_SKIP_VERSION_CHECK = "1";

			await expect(checkForNewPiVersion("1.2.3", "@selesai/code")).resolves.toBeUndefined();
			expect(fetchMock).not.toHaveBeenCalled();
		});

		it("returns undefined on registry failure", async () => {
			vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 500 })));

			await expect(checkForNewPiVersion("1.2.3", "@selesai/code")).resolves.toBeUndefined();
		});
	});
});
