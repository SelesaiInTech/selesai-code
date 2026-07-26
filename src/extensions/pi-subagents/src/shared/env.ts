/** Preserve pi-subagents v0.33 and earlier environment configuration. */
const LEGACY_PREFIX = /^PI_SUBAGENTS?_/;

export function normalizeLegacySubagentEnv(env: NodeJS.ProcessEnv = process.env): void {
	for (const [name, value] of Object.entries(env)) {
		if (value === undefined || !LEGACY_PREFIX.test(name)) continue;
		const selesaiName = name.replace(LEGACY_PREFIX, (prefix) => prefix === "PI_SUBAGENTS_" ? "SELESAI_SUBAGENTS_" : "SELESAI_SUBAGENT_");
		if (env[selesaiName] === undefined) env[selesaiName] = value;
	}
}

normalizeLegacySubagentEnv();

export function readSubagentEnv(env: NodeJS.ProcessEnv, selesaiName: string): string | undefined {
	return env[selesaiName] ?? env[selesaiName.replace(/^SELESAI_/, "PI_")];
}
