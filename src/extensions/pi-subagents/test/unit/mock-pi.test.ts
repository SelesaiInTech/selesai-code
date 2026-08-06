import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import { after, describe, it } from "node:test";
import { createMockPi } from "../support/mock-pi.ts";

describe("mock Pi queue isolation", () => {
	const mockPi = createMockPi();
	after(() => mockPi.uninstall());

	it("keeps the prior queue for children that inherited it before reset", () => {
		mockPi.install();
		mockPi.reset();
		const priorQueue = mockPi.dir;
		mockPi.onCall({ output: "prior response" });

		mockPi.reset();

		assert.notEqual(mockPi.dir, priorQueue);
		assert.ok(fs.readdirSync(priorQueue).some((name) => name.startsWith("pending-")));
		assert.equal(fs.readdirSync(mockPi.dir).length, 0);
	});
});
