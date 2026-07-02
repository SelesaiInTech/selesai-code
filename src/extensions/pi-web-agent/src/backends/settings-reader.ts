// ponytail: selesai stores the Brave API key in settings.json (webAgent.braveApiKey),
// set by the bundled web-agent-onboarding extension. Upstream pi-web-agent reads the
// key only from PI_WEB_AGENT_BRAVE_API_KEY env var. This helper bridges that gap with a
// minimal settings.json read. Ceiling: if selesai moves web search config elsewhere, this
// helper needs updating; upgrade path = upstream pi-web-agent adopting a settings hook.
import { existsSync, readFileSync } from 'node:fs';
import { getSettingsPath } from '@selesai/code';

/**
 * Read the Brave API key from selesai settings.json (webAgent.braveApiKey).
 * Returns undefined if settings.json or the key is absent. Never throws.
 */
export function readBraveKeyFromSettings(settingsPath: string = getSettingsPath()): string | undefined {
	try {
		if (!existsSync(settingsPath)) return undefined;
		const raw = readFileSync(settingsPath, 'utf-8');
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		const webAgent = parsed.webAgent;
		if (!webAgent || typeof webAgent !== 'object' || Array.isArray(webAgent)) return undefined;
		const apiKey = (webAgent as Record<string, unknown>).braveApiKey;
		return typeof apiKey === 'string' && apiKey.trim() !== '' ? apiKey : undefined;
	} catch {
		return undefined;
	}
}
