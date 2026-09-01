import type { ExtensionAPI } from "@selesai/code";
import type {} from "./src/types/pi-runtime-compat.d.ts";

const registerParentExtension = process.env.SELESAI_SUBAGENT_CHILD === "1"
	? undefined
	: (await import("./src/extension/index.ts")).default;

export default function registerSubagentExtension(pi: ExtensionAPI): void {
	registerParentExtension?.(pi);
}