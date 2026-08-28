import { homedir } from "node:os";
import { join } from "node:path";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";

const PI_AGENT_DIR_ENV_VAR = "PI_CODING_AGENT_DIR";
// ponytail: keep the upstream default too; SELESAI_CODING_AGENT_DIR is the host fork's override.
const SELESAI_AGENT_DIR_ENV_VAR = "SELESAI_CODING_AGENT_DIR";

interface AgentDirEnvironment {
	[name: string]: string | undefined;
}

function expandHomeDirectory(configuredDir: string, homeDirectory: string): string {
	if (configuredDir === "~") {
		return homeDirectory;
	}

	if (configuredDir.startsWith("~/") || configuredDir.startsWith("~\\")) {
		return join(homeDirectory, configuredDir.slice(2));
	}

	return configuredDir;
}

export function resolvePiAgentDir(
	env: AgentDirEnvironment = process.env,
	homeDirectory = homedir(),
): string {
	const configuredDir = env[PI_AGENT_DIR_ENV_VAR] ?? env[SELESAI_AGENT_DIR_ENV_VAR];
	if (!configuredDir) {
		return join(homeDirectory, CONFIG_DIR_NAME, "agent");
	}

	return expandHomeDirectory(configuredDir, homeDirectory);
}
