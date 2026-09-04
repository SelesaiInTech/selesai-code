/**
 * Progressive capability gateway (experimental, opt-in).
 *
 * Issue #1: keep the full tool/skill ecosystem reachable without paying to
 * expose every extension-tool schema and skill description on every request.
 *
 * Behavior:
 * - On by default; disable via SELESAI_CAPABILITY_GATEWAY=0.
 * - At session start, extension tools (except the gateway's own tools) become
 *   dormant: they stay registered but are removed from the active tool set.
 *   Built-in tools are never touched.
 * - A compact catalog tool lists eligible tools/skills with one-line summaries.
 * - capability_discover validates one catalogued tool and activates its native
 *   definition for the current agent run; capability_skill_show loads exactly
 *   the selected skill instructions.
 * - A deterministic router inspects each user prompt and, for a unique
 *   high-confidence tool match, activates it before the run; for a unique
 *   high-confidence skill match it adds a concise recommendation; ambiguous
 *   matches add a catalog hint; unrelated prompts are untouched.
 * - Temporary activations reset at agent_settled, restoring the baseline
 *   active-tool set.
 * - The system-prompt skill index is replaced by a compact capability
 *   instruction; full skill instructions load only on explicit show/invoke.
 * - Telemetry events are emitted on the shared event bus.
 */

import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { stripFrontmatter, type ExtensionAPI, type ToolInfo } from "@selesai/code";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import {
	buildSkillCatalog,
	buildToolCatalog,
	BUILTIN_TOOL_NAMES,
	route,
	type CatalogEntry,
} from "./catalog.ts";

export const GATEWAY_ENV = "SELESAI_CAPABILITY_GATEWAY";
export const GATEWAY_TOOLS = new Set(["capability_catalog", "capability_discover", "capability_skill_show"]);

export const CAPABILITY_INSTRUCTION = `Optional capabilities (extension tools and skills) are not listed here by default. To use one:
- Search the compact catalog with capability_catalog (kind: "tool" or "skill", natural-language query) when no active tool fits or a specialized integration/workflow is requested.
- Activate a catalogued tool with capability_discover, then call it normally on the next turn.
- Load a skill's full instructions with capability_skill_show before applying it.
Never invent optional tool names, actions, or fields; discover them first.`;

const CATALOG_LIMIT = 20;

function isEnabled(): boolean {
	return process.env[GATEWAY_ENV] !== "0";
}

function eligibleTools(pi: ExtensionAPI): ToolInfo[] {
	return pi
		.getAllTools()
		.filter((tool) => !GATEWAY_TOOLS.has(tool.name) && !BUILTIN_TOOL_NAMES.has(tool.name));
}

function catalogEntries(pi: ExtensionAPI): CatalogEntry[] {
	const tools = buildToolCatalog(eligibleTools(pi), GATEWAY_TOOLS);
	const skills = buildSkillCatalog(pi.getResolvedSkills());
	return [...tools, ...skills];
}

function formatCatalog(entries: CatalogEntry[], limit = CATALOG_LIMIT): string {
	const shown = entries.slice(0, limit);
	const lines = shown.map(
		(entry) =>
			`- ${entry.kind} ${entry.name}${entry.category ? ` [${entry.category}]` : ""}: ${entry.summary}`,
	);
	if (entries.length > limit) lines.push(`… and ${entries.length - limit} more (refine your query)`);
	return lines.length > 0 ? lines.join("\n") : "(no matching capabilities)";
}

function findEntry(entries: CatalogEntry[], name: string): CatalogEntry | undefined {
	const normalized = name.trim().toLowerCase();
	return entries.find(
		(entry) => entry.name.toLowerCase() === normalized || entry.aliases.some((alias) => alias.toLowerCase() === normalized),
	);
}

function skillByFile(pi: ExtensionAPI, filePath: string): { name: string; body: string } | undefined {
	const skill = pi.getResolvedSkills().find((s) => s.filePath === filePath);
	if (!skill) return undefined;
	try {
		const body = stripFrontmatter(readFileSync(skill.filePath, "utf-8")).trim();
		return { name: skill.name, body };
	} catch {
		return undefined;
	}
}

function emitTelemetry(pi: ExtensionAPI, event: string, data: Record<string, unknown>): void {
	try {
		pi.events.emit("capability-gateway", { event, ...data });
	} catch {
		// Telemetry must never break the session.
	}
}

export default function capabilityGatewayExtension(pi: ExtensionAPI): void {
	if (!isEnabled()) return;

	// ------------------------------------------------------------------
	// Session start: snapshot baseline, make extension tools dormant, and
	// install the compact skill index (action methods are stubs until bind).
	// ------------------------------------------------------------------
	pi.on("session_start", (_event, ctx) => {
		const baseline = pi.getActiveTools();
		const keep = baseline.filter(
			(name) => !eligibleTools(pi).some((tool) => tool.name === name),
		);
		pi.setActiveTools(keep);
		// Replace the eager skill index with a single compact capability
		// instruction entry. Full skill instructions load only on show/invoke.
		pi.setSkillsIndexFilter(() => [
			{
				name: "capability-gateway",
				description: CAPABILITY_INSTRUCTION,
				filePath: "<capability-gateway>",
				baseDir: "<capability-gateway>",
				sourceInfo: { path: "<capability-gateway>", source: "builtin", scope: "user", origin: "top-level" },
				disableModelInvocation: false,
			},
		]);
		emitTelemetry(pi, "session_start", { baselineCount: baseline.length, dormantCount: baseline.length - keep.length });
		void ctx;
	});

	// ------------------------------------------------------------------
	// Tools
	// ------------------------------------------------------------------
	pi.registerTool({
		name: "capability_catalog",
		label: "Capability Catalog",
		description:
			"Search the compact capability catalog for optional extension tools and skills. Returns name, kind (tool or skill), category, and a one-line purpose for each match. Use when no active tool fits or a specialized integration/workflow is requested.",
		promptSnippet: "Search the compact catalog of optional tools and skills",
		parameters: Type.Object({
			query: Type.Optional(Type.String({ minLength: 1, description: "Natural-language query; omit to list all." })),
			kind: Type.Optional(StringEnum(["tool", "skill"] as const, { description: "Filter by capability kind." })),
		}),
		async execute(_id, params) {
			const entries = catalogEntries(pi);
			const filtered = entries.filter(
				(entry) => !params.kind || entry.kind === params.kind,
			);
			const matched = params.query ? route(params.query, filtered) : { action: "none" as const };
			const shown =
				params.query && matched.candidates
					? matched.candidates
					: params.query
						? filtered.filter((entry) => {
								const q = params.query!.toLowerCase();
								return (
									entry.name.toLowerCase().includes(q) ||
									entry.summary.toLowerCase().includes(q) ||
									entry.aliases.some((alias) => alias.toLowerCase().includes(q))
								);
							})
						: filtered;
			const text = formatCatalog(shown);
			emitTelemetry(pi, "catalog", { query: params.query ?? "", kind: params.kind ?? "", results: shown.length });
			return {
				content: [{ type: "text", text }],
				details: { count: shown.length, total: filtered.length },
			};
		},
	});

	pi.registerTool({
		name: "capability_discover",
		label: "Capability Discover",
		description:
			"Activate one catalogued extension tool for the current agent run. The tool's real schema and validation contract become available on the next model turn; it is removed again when the run ends. Use the exact name from capability_catalog.",
		promptSnippet: "Activate a catalogued extension tool for the current run",
		parameters: Type.Object({
			name: Type.String({ minLength: 1, description: "Exact catalogued tool name." }),
		}),
		async execute(_id, params) {
			const entries = catalogEntries(pi);
			const entry = findEntry(entries, params.name);
			if (!entry || entry.kind !== "tool") {
				return {
					content: [
						{
							type: "text",
							text: `Unknown tool "${params.name}". Search capability_catalog for the exact name, or refine your query.`,
						},
					],
					details: { activated: false },
				};
			}
			const active = pi.getActiveTools();
			if (!active.includes(entry.name)) {
				pi.setActiveTools([...active, entry.name]);
			}
			emitTelemetry(pi, "discover", { tool: entry.name });
			return {
				content: [
					{
						type: "text",
						text: `Activated "${entry.name}" for this run. Call it normally on the next turn; it is removed when the run ends.`,
					},
				],
				details: { activated: true, tool: entry.name },
			};
		},
	});

	pi.registerTool({
		name: "capability_skill_show",
		label: "Capability Skill Show",
		description:
			"Load the complete instructions for one skill from the resolved skill catalog. Use the exact skill name from capability_catalog. This is the explicit boundary that loads full SKILL.md content.",
		promptSnippet: "Load a skill's full instructions by name",
		parameters: Type.Object({
			name: Type.String({ minLength: 1, description: "Exact skill name." }),
		}),
		async execute(_id, params) {
			const skill = pi.getResolvedSkills().find((s) => s.name === params.name);
			if (!skill) {
				return {
					content: [
						{
							type: "text",
							text: `Unknown skill "${params.name}". Search capability_catalog (kind: "skill") for the exact name.`,
						},
					],
					details: { loaded: false },
				};
			}
			const loaded = skillByFile(pi, skill.filePath);
			if (!loaded) {
				return {
					content: [{ type: "text", text: `Skill "${params.name}" exists but its file could not be read.` }],
					details: { loaded: false },
				};
			}
			emitTelemetry(pi, "skill_show", { skill: loaded.name });
			return {
				content: [
					{
						type: "text",
						text: `<skill name="${loaded.name}" location="${skill.filePath}">\nThe full instructions for this skill are embedded inline below; do not read its file again.\nReferences are relative to ${dirname(skill.filePath)}.\n\n${loaded.body}\n</skill>`,
					},
				],
				details: { loaded: true, skill: loaded.name },
			};
		},
	});

	// ------------------------------------------------------------------
	// Deterministic routing: high-confidence activation/recommendation,
	// ambiguity hints, or nothing for unrelated prompts.
	// ------------------------------------------------------------------
	pi.on("before_agent_start", (event) => {
		const result = route(event.prompt, catalogEntries(pi));
		if (result.action === "none") return undefined;
		if (result.action === "activate" && result.entry) {
			const active = pi.getActiveTools();
			if (!active.includes(result.entry.name)) {
				pi.setActiveTools([...active, result.entry.name]);
			}
			emitTelemetry(pi, "route_activate", { tool: result.entry.name });
			return undefined;
		}
		if (result.action === "recommend" && result.entry) {
			emitTelemetry(pi, "route_recommend", { skill: result.entry.name });
			return {
				message: {
					customType: "capability-gateway-hint",
					content: `The request matches the optional skill "${result.entry.name}". Load it with capability_skill_show before applying it.`,
					display: false,
				},
			};
		}
		if (result.action === "hint" && result.candidates) {
			const names = result.candidates.map((c) => c.name).join(", ");
			emitTelemetry(pi, "route_hint", { candidates: result.candidates.map((c) => c.name) });
			return {
				message: {
					customType: "capability-gateway-hint",
					content: `The request may match optional capabilities: ${names}. Search capability_catalog to confirm before selecting.`,
					display: false,
				},
			};
		}
		return undefined;
	});

	// ------------------------------------------------------------------
	// Reset: restore the baseline active-tool set after the run settles.
	// ------------------------------------------------------------------
	pi.on("agent_settled", () => {
		const baseline = pi.getActiveTools().filter((name) => !eligibleTools(pi).some((tool) => tool.name === name));
		pi.setActiveTools(baseline);
		emitTelemetry(pi, "reset", { activeCount: baseline.length });
	});

	// ------------------------------------------------------------------
	// Command: /capability-gateway status
	// ------------------------------------------------------------------
	pi.registerCommand("capability-gateway", {
		description: "Show capability gateway status and catalog counts.",
		async handler(_args, ctx) {
			const tools = buildToolCatalog(eligibleTools(pi), GATEWAY_TOOLS);
			const skills = buildSkillCatalog(pi.getResolvedSkills());
			const active = pi.getActiveTools();
			const dormant = tools.filter((t) => !active.includes(t.name)).length;
			const text = [
				`Capability gateway: enabled`,
				`catalogued tools: ${tools.length} (${dormant} dormant)`,
				`catalogued skills: ${skills.length}`,
				`active tools: ${active.join(", ") || "(none)"}`,
			].join("\n");
			ctx.ui.notify(text);
		},
	});
}
