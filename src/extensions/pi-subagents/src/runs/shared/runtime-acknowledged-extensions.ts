import * as fs from "node:fs";
import * as path from "node:path";
import type { RuntimeAcknowledgedChildExtensionsV1 } from "../../shared/types.ts";

export const RUNTIME_EXTENSION_ACK_EVENT = "subagent:acknowledge-extension";
export const RUNTIME_EXTENSION_ACK_PATH_ENV = "SELESAI_SUBAGENT_RUNTIME_ACKNOWLEDGED_EXTENSIONS";
export const MAX_RUNTIME_ACKNOWLEDGED_EXTENSION_IDS = 32;
export const MAX_RUNTIME_ACKNOWLEDGED_EXTENSION_ID_LENGTH = 128;
// Generous bound for a valid capture (32 ids x 128 chars plus envelope); larger files are child misbehavior.
export const MAX_RUNTIME_ACKNOWLEDGED_EXTENSION_FILE_BYTES = 64 * 1024;

export function isRuntimeAcknowledgedExtensionId(value: unknown): value is string {
	return typeof value === "string"
		&& value.length > 0
		&& value.length <= MAX_RUNTIME_ACKNOWLEDGED_EXTENSION_ID_LENGTH
		&& /^[A-Za-z0-9._:@+-]+$/.test(value)
		&& !value.includes("..")
		&& !value.includes("/")
		&& !value.includes("\\");
}

export function projectRuntimeAcknowledgedExtensions(ids: Iterable<unknown>): RuntimeAcknowledgedChildExtensionsV1 | undefined {
	const unique: string[] = [];
	const seen = new Set<string>();
	for (const id of ids) {
		if (!isRuntimeAcknowledgedExtensionId(id) || seen.has(id)) continue;
		seen.add(id);
		unique.push(id);
	}
	if (unique.length === 0) return undefined;
	return {
		version: 1,
		source: "child-runtime",
		ids: unique.slice(0, MAX_RUNTIME_ACKNOWLEDGED_EXTENSION_IDS),
		omitted: Math.max(0, unique.length - MAX_RUNTIME_ACKNOWLEDGED_EXTENSION_IDS),
	};
}

export function sanitizeRuntimeAcknowledgedExtensions(value: unknown): RuntimeAcknowledgedChildExtensionsV1 | undefined {
	if (!value || typeof value !== "object") return undefined;
	const raw = value as Record<string, unknown>;
	if (raw.version !== 1 || raw.source !== "child-runtime" || !Array.isArray(raw.ids)) return undefined;
	const projected = projectRuntimeAcknowledgedExtensions(raw.ids);
	if (!projected) return undefined;
	const omitted = typeof raw.omitted === "number" && Number.isFinite(raw.omitted)
		? Math.max(0, Math.floor(raw.omitted))
		: 0;
	return { ...projected, omitted: projected.omitted + omitted };
}

export function readRuntimeAcknowledgedExtensions(filePath: string | undefined): RuntimeAcknowledgedChildExtensionsV1 | undefined {
	if (!filePath) return undefined;
	try {
		if (fs.statSync(filePath).size > MAX_RUNTIME_ACKNOWLEDGED_EXTENSION_FILE_BYTES) return undefined;
		const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as unknown;
		return sanitizeRuntimeAcknowledgedExtensions(parsed);
	} catch {
		return undefined;
	}
}

export function writeRuntimeAcknowledgedExtensions(filePath: string, ids: Iterable<unknown>): void {
	const projection = projectRuntimeAcknowledgedExtensions(ids);
	try {
		fs.mkdirSync(path.dirname(filePath), { recursive: true });
		if (projection) fs.writeFileSync(filePath, JSON.stringify(projection), { mode: 0o600 });
		else fs.rmSync(filePath, { force: true });
	} catch {
		// Runtime acknowledgement is best-effort observability only.
	}
}