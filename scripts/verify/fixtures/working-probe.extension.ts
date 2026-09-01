/**
 * Working-loader probe extension for the rev-4 RPC smoke gate.
 *
 * Registers `/working-probe`, which exercises the three `ctx.ui` working-loader
 * methods. In RPC mode these are relayed as fire-and-forget
 * `extension_ui_request {method:"working", ...}` events on stdout; the smoke
 * gate asserts those events arrive with the expected fields.
 */
export default function workingProbe(pi: unknown): void {
	(pi as {
		registerCommand(name: string, options: { description: string; handler: (args: string, ctx: any) => void }): void;
	}).registerCommand("working-probe", {
		description: "Emit working loader extension_ui_request controls",
		handler: (_args: string, ctx: any) => {
			if (!ctx?.hasUI) return;
			ctx.ui.setWorkingMessage("probe-message");
			ctx.ui.setWorkingVisible(true);
			ctx.ui.setWorkingIndicator({ frames: ["⠋", "⠙", "⠹"], intervalMs: 60 });
			ctx.ui.setWorkingVisible(false);
		},
	});
}
