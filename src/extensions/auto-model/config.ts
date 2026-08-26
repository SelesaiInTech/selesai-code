import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { CONFIG_DIR_NAME, getAgentDir } from "@selesai/code";

export const TIERS = ["simple", "medium", "complex", "reasoning"] as const;
export type Tier = (typeof TIERS)[number];
export type ClassifierType = "llm" | "heuristic";
export interface AutoModelConfig {
 enabled: boolean;
 classifier: { type: ClassifierType; model?: string; timeoutMs: number; contextTurns: number; contextCharsPerTurn: number };
 tiers: Record<Tier, string | undefined>;
 fallback: "current";
 manualSelection: "suspend-until-enabled";
}
export interface AutoModelOverride {
 enabled?: boolean;
 classifier?: Partial<AutoModelConfig["classifier"]>;
 tiers?: Partial<AutoModelConfig["tiers"]>;
 fallback?: "current";
 manualSelection?: "suspend-until-enabled";
}
export const DEFAULT_CONFIG: AutoModelConfig = { enabled: false, classifier: { type: "llm", timeoutMs: 3000, contextTurns: 3, contextCharsPerTurn: 300 }, tiers: { simple: undefined, medium: undefined, complex: undefined, reasoning: undefined }, fallback: "current", manualSelection: "suspend-until-enabled" };

export function configPaths(cwd = process.cwd()) { return { global: join(getAgentDir(), "extensions", "auto-model", "config.json"), project: join(cwd, CONFIG_DIR_NAME, "extensions", "auto-model", "config.json") }; }
function isObject(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
export function validateOverride(value: unknown): AutoModelOverride | undefined {
 if (!isObject(value)) return undefined;
 const out: AutoModelOverride = {};
 if (typeof value.enabled === "boolean") out.enabled = value.enabled;
 if (value.fallback === "current") out.fallback = "current";
 if (value.manualSelection === "suspend-until-enabled") out.manualSelection = value.manualSelection;
 if (isObject(value.classifier)) { const c: AutoModelOverride["classifier"] = {}; if (value.classifier.type === "llm" || value.classifier.type === "heuristic") c.type = value.classifier.type; if (typeof value.classifier.model === "string") c.model = value.classifier.model; for (const k of ["timeoutMs", "contextTurns", "contextCharsPerTurn"] as const) if (typeof value.classifier[k] === "number" && value.classifier[k] > 0) c[k] = Math.floor(value.classifier[k]); out.classifier = c; }
 if (isObject(value.tiers)) { const tiers: Partial<AutoModelConfig["tiers"]> = {}; for (const tier of TIERS) if (typeof value.tiers[tier] === "string") tiers[tier] = value.tiers[tier]; out.tiers = tiers; }
 return out;
}
export function mergeConfig(...layers: Array<AutoModelOverride | undefined>): AutoModelConfig { const result: AutoModelConfig = { ...DEFAULT_CONFIG, classifier: { ...DEFAULT_CONFIG.classifier }, tiers: { ...DEFAULT_CONFIG.tiers } }; for (const layer of layers) if (layer) { Object.assign(result, layer); Object.assign(result.classifier, layer.classifier); Object.assign(result.tiers, layer.tiers); } return result; }
async function load(path: string): Promise<AutoModelOverride | undefined> {
 try { return validateOverride(JSON.parse(await readFile(path, "utf8"))); }
 catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}
export async function loadConfig(cwd: string, trusted: boolean): Promise<AutoModelConfig> { const paths = configPaths(cwd); return mergeConfig(await load(paths.global), trusted ? await load(paths.project) : undefined); }
async function writeConfig(path: string, value: unknown): Promise<void> { await mkdir(dirname(path), { recursive: true }); const temporary = `${path}.${process.pid}.${Date.now()}.tmp`; await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8"); await rename(temporary, path); }
export async function saveConfig(path: string, config: AutoModelConfig): Promise<void> { await writeConfig(path, config); }
/** Update only the fields owned by this scope, preserving the existing layer. */
export async function updateConfig(path: string, override: AutoModelOverride): Promise<void> {
 const existing = (await load(path)) ?? {};
 const merged: AutoModelOverride = { ...existing, ...override };
 if (existing.classifier || override.classifier) merged.classifier = { ...existing.classifier, ...override.classifier };
 if (existing.tiers || override.tiers) merged.tiers = { ...existing.tiers, ...override.tiers };
 await writeConfig(path, merged);
}
