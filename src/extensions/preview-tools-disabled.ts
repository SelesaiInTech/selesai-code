import type { ExtensionAPI } from "@selesai/code";

const DISABLED_TOOL_NAMES = new Set(["preview_export"]);

export default function (pi: ExtensionAPI) {
	pi.on("session_start", () => {
		const active = pi.getActiveTools();
		const next = active.filter((name) => !DISABLED_TOOL_NAMES.has(name));
		if (next.length !== active.length) pi.setActiveTools(next);
	});
}
