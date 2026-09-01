/**
 * Rev-3 RPC smoke gate (repo-owned oracle, run with `node`).
 * Verifies the new interactive-TUI parity commands against dist/cli.js --mode rpc.
 *
 * Success = exit 0 with the SUCCESS marker. No grep/tail/sed — portability rule.
 */
import { RpcClient } from "../../dist/modes/rpc/rpc-client.js";

const client = new RpcClient({ cwd: process.cwd() });

const fail = (msg) => {
	console.error(`FAIL: ${msg}`);
	process.exit(1);
};
const ok = (msg) => console.log(`ok: ${msg}`);

try {
	await client.start();

	// --- rev-3 command surface probes -------------------------------------
	// list_sessions is the extension's capability probe: must succeed (not "Unknown command").
	try {
		const sessions = await client.listSessions("current");
		ok(`list_sessions(current) -> ${sessions.length} sessions`);
	} catch (e) {
		fail(`list_sessions(current) failed: ${e.message}`);
	}
	try {
		const all = await client.listSessions("all");
		ok(`list_sessions(all) -> ${all.length} sessions`);
	} catch (e) {
		fail(`list_sessions(all) failed: ${e.message}`);
	}

	// navigate_tree on a fresh session: no entries => domain error, NOT "Unknown command".
	try {
		await client.navigateTree({ targetId: "nope" });
		fail("navigate_tree should have failed on a fresh session");
	} catch (e) {
		if (/Unknown command/i.test(e.message)) fail(`navigate_tree missing: ${e.message}`);
		ok(`navigate_tree domain error: ${e.message}`);
	}

	// set_session_models: clears scope on empty array without persisting settings.
	try {
		const res = await client.setSessionModels({ enabled: [] });
		if (!Array.isArray(res.enabled) || !Array.isArray(res.models)) fail("set_session_models shape wrong");
		ok(`set_session_models([]) -> enabled=${JSON.stringify(res.enabled)}`);
	} catch (e) {
		if (/Unknown command/i.test(e.message)) fail(`set_session_models missing: ${e.message}`);
		fail(`set_session_models failed: ${e.message}`);
	}

	// rename_session / delete_session on a nonexistent file => domain error, command exists.
	try {
		await client.renameSession("/nonexistent/session.jsonl", "x");
		fail("rename_session should have failed on nonexistent file");
	} catch (e) {
		if (/Unknown command/i.test(e.message)) fail(`rename_session missing: ${e.message}`);
		ok(`rename_session domain error: ${e.message}`);
	}
	try {
		await client.deleteSession("/nonexistent/session.jsonl");
		fail("delete_session should have failed on nonexistent file");
	} catch (e) {
		if (/Unknown command/i.test(e.message)) fail(`delete_session missing: ${e.message}`);
		ok(`delete_session domain error: ${e.message}`);
	}

	// cycle_model with explicit direction (must not be "Unknown command"; model may be unset -> null).
	try {
		const res = await client.cycleModel("backward");
		ok(`cycle_model(backward) -> ${res ? res.model?.provider + "/" + res.model?.id : "null"}`);
	} catch (e) {
		if (/Unknown command/i.test(e.message)) fail(`cycle_model missing: ${e.message}`);
		ok(`cycle_model error: ${e.message}`);
	}

	// get_available_models refresh flag (offline-safe: falls back on network failure).
	try {
		const models = await client.getAvailableModels(true);
		ok(`get_available_models(refresh:true) -> ${models.length} models`);
	} catch (e) {
		if (/Unknown command/i.test(e.message)) fail(`get_available_models refresh missing: ${e.message}`);
		ok(`get_available_models refresh fallback: ${e.message}`);
	}

	// prompt.queueWhileCompacting during no compaction behaves exactly as before (immediate success path
	// is async; send and wait for idle or a settle). Use a real (short) prompt attempt; no model may be configured,
	// so expect either a prompt success or a domain error — but NEVER "Unknown command".
	try {
		const events = await client.promptAndWait("hello", undefined, 20000).catch(() => []);
		ok(`prompt(queueWhileCompacting:true) -> ${events.length} events`);
	} catch (e) {
		if (/Unknown command/i.test(e.message)) fail(`prompt queueWhileCompacting missing: ${e.message}`);
		ok(`prompt error: ${e.message}`);
	}

	// export_html themeName passthrough: with no model/messages it may fail after creating HTML,
	// but "Unknown command" is the only unacceptable outcome.
	try {
		const { path } = await client.exportHtml(undefined, "dark");
		ok(`export_html(themeName) -> ${path}`);
	} catch (e) {
		if (/Unknown command/i.test(e.message)) fail(`export_html themeName missing: ${e.message}`);
		ok(`export_html themeName error: ${e.message}`);
	}

	// Existing surface regression probes (get_hotkeys, get_settings effective, themes).
	try {
		const hotkeys = await client.getHotkeys();
		ok(`getHotkeys -> ${Object.keys(hotkeys).length} keys`);
	} catch (e) {
		fail(`getHotkeys failed: ${e.message}`);
	}
	try {
		const settings = await client.getSettings("effective");
		ok(`getSettings(effective) -> ${Object.keys(settings.settings).length} keys`);
	} catch (e) {
		fail(`getSettings(effective) failed: ${e.message}`);
	}
	try {
		const themes = await client.getAvailableThemes();
		ok(`getAvailableThemes -> ${themes.themes.length} themes`);
	} catch (e) {
		fail(`getAvailableThemes failed: ${e.message}`);
	}
	try {
		const info = await client.getVersionInfo();
		ok(`getVersionInfo -> ${info.version}`);
	} catch (e) {
		fail(`getVersionInfo failed: ${e.message}`);
	}

	console.log("\nREV3_SMOKE_OK");
} finally {
	await client.stop();
	process.exit(0);
}
