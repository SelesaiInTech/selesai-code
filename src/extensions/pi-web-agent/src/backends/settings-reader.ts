// ponytail: selesai stores the Brave API key in settings.json (webAgent.braveApiKey),
// set by the bundled web-agent-onboarding extension. Upstream pi-web-agent reads the
// key only from PI_WEB_AGENT_BRAVE_API_KEY env var. This helper bridges that gap with a
// minimal settings.json read. Ceiling: if selesai moves web search config elsewhere, this
// helper needs updating; upgrade path = upstream pi-web-agent adopting a settings hook.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getAgentDir, getSettingsPath } from '@selesai/code';

/**
 * True when tokenin-auth.json (written by the tokenin-onboarding extension)
 * has an active account. Used to decide whether the tokenin search provider is
 * usable. Never throws.
 */
export function hasActiveTokenInAccount(authPath: string = join(getAgentDir(), 'tokenin-auth.json')): boolean {
	try {
		if (!existsSync(authPath)) return false;
		const parsed = JSON.parse(readFileSync(authPath, 'utf-8')) as unknown;
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
		const auth = parsed as { accounts?: unknown; activeId?: unknown };
		if (!Array.isArray(auth.accounts) || typeof auth.activeId !== 'string') return false;
		return auth.accounts.some(
			(a) => a && typeof a === 'object' && !Array.isArray(a) && (a as { id?: unknown }).id === auth.activeId
		);
	} catch {
		return false;
	}
}

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
