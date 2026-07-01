import { describe, it } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createSpawnTimingMarkers, emitSpawnTiming } from "../../src/runs/shared/spawn-timing.ts";

describe("spawn-timing", () => {
	it("creates markers with a start time", () => {
		const markers = createSpawnTimingMarkers();
		assert.ok(markers.spawnStart > 0);
	});

	it("emits a timing line when an eventsPath is provided", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagents-timing-"));
		const eventsPath = path.join(dir, "events.jsonl");
		const markers = createSpawnTimingMarkers();
		emitSpawnTiming({
			eventsPath,
			marker: "spawn_start",
			markers,
			runId: "run-1",
			stepIndex: 2,
			agent: "scout",
		});
		const lines = fs.readFileSync(eventsPath, "utf-8").trim().split("\n");
		assert.equal(lines.length, 1);
		const event = JSON.parse(lines[0]!);
		assert.equal(event.type, "subagent.spawn.timing");
		assert.equal(event.runId, "run-1");
		assert.equal(event.stepIndex, 2);
		assert.equal(event.agent, "scout");
		assert.equal(event.marker, "spawn_start");
		assert.ok(typeof event.elapsedMs === "number");
		assert.ok(event.ts > 0);
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("skips emission when eventsPath is missing", () => {
		const markers = createSpawnTimingMarkers();
		assert.doesNotThrow(() => {
			emitSpawnTiming({ eventsPath: undefined, marker: "spawn_start", markers });
		});
	});
});
