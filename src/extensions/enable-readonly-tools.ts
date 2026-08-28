import {
	createFindToolDefinition,
	createGrepToolDefinition,
	createLsToolDefinition,
	type ExtensionAPI,
} from "@selesai/code";

const bootstrapTools = new Set(["read", "bash", "edit", "write"]);

export default function (pi: ExtensionAPI) {
	let enabled = false;

	pi.on("tool_execution_end", (event, ctx) => {
		if (enabled || event.isError || !bootstrapTools.has(event.toolName)) return;
		enabled = true;

		// pi-tool-display may already own these renderer definitions. Re-registering
		// Pi's plain built-ins here silently discarded its boxed grep/find/ls views.
		const active = new Set(pi.getAllTools().map((tool) => tool.name));
		if (!active.has("grep")) pi.registerTool(createGrepToolDefinition(ctx.cwd));
		if (!active.has("find")) pi.registerTool(createFindToolDefinition(ctx.cwd));
		if (!active.has("ls")) pi.registerTool(createLsToolDefinition(ctx.cwd));
	});
}
