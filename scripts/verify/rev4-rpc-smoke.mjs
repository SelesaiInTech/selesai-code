/**
 * Rev-4 RPC smoke gate (repo-owned oracle, run with `node`).
 * Verifies the Wave-H parity additions against dist/cli.js --mode rpc:
 *   - get_skills: resolved skill catalog + raw toggle patterns
 *   - working: extension_ui_request {method:"working"} loader parity via a
 *     fixture extension (`scripts/verify/fixtures/working-probe.extension.ts`)
 *
 * Success = exit 0 with the SUCCESS marker. No grep/tail/sed — portability rule.
 */
import { fileURLToPath } from "node:url";
import { RpcClient } from "../../dist/modes/rpc/rpc-client.js";

const fixturePath = fileURLToPath(new URL("./fixtures/working-probe.extension.ts", import.meta.url));

const client = new RpcClient({
	cwd: process.cwd(),
	args: ["--extension", fixturePath],
});

const fail = (msg) => {
	console.error(`FAIL: ${msg}`);
	process.exit(1);
};
const ok = (msg) => console.log(`ok: ${msg}`);

try {
	await client.start();

	// --- get_skills capability probe ---------------------------------------
	try {
		const { skills, patterns } = await client.getSkills();
		if (!Array.isArray(skills)) fail(`getSkills.skills is not an array: ${JSON.stringify(skills)}`);
		if (!Array.isArray(patterns)) fail(`getSkills.patterns is not an array: ${JSON.stringify(patterns)}`);
		for (const skill of skills) {
			if (typeof skill.name !== "string" || !skill.name) {
				fail(`getSkills entry missing name: ${JSON.stringify(skill)}`);
			}
			if (skill.scope !== "global" && skill.scope !== "project") {
				fail(`getSkills entry invalid scope: ${JSON.stringify(skill)}`);
			}
			if (typeof skill.enabled !== "boolean") {
				fail(`getSkills entry missing enabled: ${JSON.stringify(skill)}`);
			}
		}
		ok(`getSkills -> ${skills.length} skills, ${patterns.length} patterns`);
	} catch (e) {
		if (/Unknown command/i.test(e.message)) fail(`get_skills missing: ${e.message}`);
		fail(`getSkills failed: ${e.message}`);
	}

	// --- working extension_ui_request probe ---------------------------------
	// Collect extension_ui_request events; then run the fixture's /working-probe
	// command, which drives setWorkingMessage/Visible/Indicator.
	const workingEvents = [];
	const unsubscribe = client.onEvent((event) => {
		if (event?.type === "extension_ui_request" && event.method === "working") {
			workingEvents.push(event);
		}
	});

	await client.prompt("/working-probe");
	// Allow the fire-and-forget events to flush to stdout.
	await new Promise((resolve) => setTimeout(resolve, 500));
	unsubscribe();

	if (workingEvents.length === 0) {
		fail("no extension_ui_request {method:'working'} received from /working-probe");
	}

	const message = workingEvents.find((e) => "message" in e && e.message === "probe-message");
	if (!message) fail(`working message event missing: ${JSON.stringify(workingEvents)}`);
	const visible = workingEvents.find((e) => "visible" in e && e.visible === true);
	if (!visible) fail(`working visible:true event missing: ${JSON.stringify(workingEvents)}`);
	const hidden = workingEvents.find((e) => "visible" in e && e.visible === false);
	if (!hidden) fail(`working visible:false event missing: ${JSON.stringify(workingEvents)}`);
	const frames = workingEvents.find(
		(e) => Array.isArray(e.frames) && e.frames.length === 3 && e.intervalMs === 60,
	);
	if (!frames) fail(`working indicator frames/intervalMs event missing: ${JSON.stringify(workingEvents)}`);

	ok(`working -> ${workingEvents.length} extension_ui_request events (message/visible/frames OK)`);

	console.log("\nREV4_SMOKE_OK");
} finally {
	await client.stop();
	process.exit(0);
}
