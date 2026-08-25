import type { ThinkingLevel } from "@earendil-works/pi-agent-core";

export const THINKING_LEVEL_OPTIONS: readonly ThinkingLevel[] = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
];

export const DEFAULT_THINKING_LEVEL: ThinkingLevel = "medium";
