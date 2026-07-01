import * as fs from "node:fs";
import * as path from "node:path";
import { performance } from "node:perf_hooks";
import { appendJsonl } from "../../shared/artifacts.ts";

export type SpawnTimingMarker =
	| "spawn_start"
	| "spawn_command_resolved"
	| "child_first_event"
	| "child_first_jsonl_event";

export interface SpawnTimingMarkers {
	spawnStart: number;
}

export function createSpawnTimingMarkers(): SpawnTimingMarkers {
	return { spawnStart: performance.now() };
}

export function emitSpawnTiming(options: {
	eventsPath: string | undefined;
	marker: SpawnTimingMarker;
	markers: SpawnTimingMarkers;
	runId?: string;
	stepIndex?: number;
	agent?: string;
}): void {
	if (!options.eventsPath) return;
	try {
		fs.mkdirSync(path.dirname(options.eventsPath), { recursive: true });
		appendJsonl(
			options.eventsPath,
			JSON.stringify({
				type: "subagent.spawn.timing",
				ts: Date.now(),
				runId: options.runId ?? "",
				stepIndex: options.stepIndex ?? 0,
				agent: options.agent ?? "runner",
				marker: options.marker,
				elapsedMs: Math.round(performance.now() - options.markers.spawnStart),
			}),
		);
	} catch {
		// Timing diagnostics must never fail the run.
	}
}
