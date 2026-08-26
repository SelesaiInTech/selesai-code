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
		pi.registerTool(createGrepToolDefinition(ctx.cwd));
		pi.registerTool(createFindToolDefinition(ctx.cwd));
		pi.registerTool(createLsToolDefinition(ctx.cwd));
	});
}
