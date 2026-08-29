/**
 * Headless smoke: prove the vendored pi-hermes-memory extension loads through
 * the Selesai extension loader (jiti + host aliases) without throwing.
 *
 * Run: npx tsx scripts/verify-hermes-load.ts
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createEventBus } from "../src/core/event-bus.ts";
import {
	createExtensionRuntime,
	loadExtensions,
} from "../src/core/extensions/loader.ts";

// Keep the smoke away from the real agent dir.
const agentRoot = mkdtempSync(join(tmpdir(), "hermes-load-"));
process.env.SELESAI_CODING_AGENT_DIR = agentRoot;
process.env.PI_CODING_AGENT_DIR = agentRoot;

const here = fileURLToPath(new URL(".", import.meta.url));
const entry = resolve(here, "../src/extensions/pi-hermes-memory/src/index.ts");

try {
	const result = await loadExtensions(
		[entry],
		process.cwd(),
		createEventBus(),
		createExtensionRuntime(),
	);

	if (result.errors.length > 0) {
		console.error("LOAD ERRORS:", result.errors);
		process.exit(1);
	}
	if (result.extensions.length === 0) {
		console.error("NO EXTENSION LOADED");
		process.exit(1);
	}

	// The factory registers handlers/tools/commands during load; one is enough.
	const ext = result.extensions[0];
	const toolCount = ext.tools.size;
	const commandCount = ext.commands.size;
	console.log(`HERMES_LOAD_OK extensions=${result.extensions.length} tools=${toolCount} commands=${commandCount}`);
} finally {
	rmSync(agentRoot, { recursive: true, force: true });
}
