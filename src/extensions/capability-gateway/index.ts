/**
 * Progressive capability gateway (experimental, opt-in).
 *
 * Issue #1: keep the full tool/skill ecosystem reachable without paying to
 * expose every extension-tool schema and skill description on every request.
 *
 * Behavior:
 * - On by default; disable via SELESAI_CAPABILITY_GATEWAY=0.
 * - At session start, extension tools become dormant except the gateway's own
 *   tools and Graft's code-context tools: they stay registered but are removed
 *   from the active tool set. Built-in tools are never touched.
 * - A compact catalog tool lists eligible tools/skills with one-line summaries.
 * - capability_discover validates one catalogued tool and activates its native
 *   definition for the current agent run; capability_skill_show loads exactly
 *   the selected skill instructions.
 * - A deterministic router activates a uniquely matched tool before the run.
 *   Skills and ambiguous matches remain discoverable through the catalog
 *   without injecting fuzzy hints into the model context.
 * - Default-on Jev-assisted routing (capabilityGateway.routing.jev in settings.json)
 *   is only a bounded tie-breaker: when the deterministic router returns an
 *   ambiguous lexical hint among optional tools, the gateway offers just those
 *   hinted tools (two or three) and the current prompt to the Jev decisions
 *   model as one constrained choice question. Jev may answer `none` or one
 *   hinted canonical tool name; the gateway revalidates the choice against the
 *   live catalog and activates it for the current run only. No hint, a unique
 *   activation, a skill match, or an already-activated tool never reaches Jev.
 *   Every Jev failure is an ordinary abstention that leaves deterministic
 *   behavior in place. Without Token-In credentials, no Jev request is sent and
 *   the user is prompted to add an account with `/tokenin add`.
 * - Temporary activations reset at agent_settled, restoring the baseline
 *   active-tool set; a tool_execution_start for one of them records whether the
 *   activation was actually used (content-free tool name + source only).
 * - The system-prompt skill index is replaced by a compact capability
 *   instruction; full skill instructions load only on explicit show/invoke.
 * - Telemetry events are emitted on the shared event bus.
 */

import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { stripFrontmatter, type ExtensionAPI, type ToolInfo } from "@selesai/code";
import { StringEnum } from "@earendil-works/pi-ai";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import {
	buildSkillCatalog,
	buildToolCatalog,
	BUILTIN_TOOL_NAMES,
	route,
	type CatalogEntry,
} from "./catalog.ts";
import {
	hintedToolCandidates,
	MIN_GATEWAY_JEV_CANDIDATES,
	readGatewayJevConfig,
	routeToJevTool,
	JEV_UNAVAILABLE_REASONS,
} from "./routing.ts";
import { confidenceBucket } from "../jev/decisions.ts";

export const GATEWAY_ENV = "SELESAI_CAPABILITY_GATEWAY";
export const GATEWAY_TOOLS = new Set(["capability_catalog", "capability_discover", "capability_skill_show"]);

// Graft supplies pre-turn hybrid context and must remain callable for precise
// follow-ups; making it dormant defeats both paths.
const ALWAYS_ACTIVE_EXTENSION_TOOLS = new Set([
	"graft_check_freshness",
	"graft_file_api",
	"graft_find_all",
	"graft_find_code",
	"graft_repo_map",
	"graft_trace_calls",
]);

export const CAPABILITY_INSTRUCTION = `Optional capabilities (extension tools and skills) are not listed here by default. To use one:
- Search the compact catalog with capability_catalog (kind: "tool" or "skill", natural-language query) when no active tool fits or a specialized integration/workflow is requested.
- Activate a catalogued tool with capability_discover, then call it normally on the next turn.
- Load a skill's full instructions with capability_skill_show before applying it.
Never invent optional tool names, actions, or fields; discover them first.`;

function isEnabled(): boolean {
	return process.env[GATEWAY_ENV] !== "0";
}

function eligibleTools(pi: ExtensionAPI): ToolInfo[] {
	return pi
		.getAllTools()
		.filter((tool) => !GATEWAY_TOOLS.has(tool.name) && !ALWAYS_ACTIVE_EXTENSION_TOOLS.has(tool.name) && !BUILTIN_TOOL_NAMES.has(tool.name));
}

function catalogEntries(pi: ExtensionAPI): CatalogEntry[] {
	const tools = buildToolCatalog(eligibleTools(pi), GATEWAY_TOOLS);
	const skills = buildSkillCatalog(pi.getResolvedSkills());
	return [...tools, ...skills];
}

const EMBEDDED_SKILL_BLOCK = /<skill\s+name="([^"]+)"[^>]*>[\s\S]*?<\/skill>/gi;
const GITHUB_OR_OPEN_SOURCE_QUERY = /\b(?:github|open[\s-]*source)\b/i;

function routePrompt(prompt: string, entries: CatalogEntry[]): ReturnType<typeof route> {
	const loadedSkills = new Set([...prompt.matchAll(EMBEDDED_SKILL_BLOCK)].map((match) => match[1]!.toLowerCase()));
	const query = prompt.replace(EMBEDDED_SKILL_BLOCK, " ");
	const candidates = entries.filter((entry) => entry.kind !== "skill" || !loadedSkills.has(entry.name.toLowerCase()));
	if (GITHUB_OR_OPEN_SOURCE_QUERY.test(query)) {
		const grepAppSearch = candidates.find(
			(entry) => entry.kind === "tool" && entry.eligible && entry.name === "grep_app_search",
		);
		if (grepAppSearch) return { action: "activate", entry: grepAppSearch };
	}
	return route(query, candidates);
}

function formatCatalog(entries: CatalogEntry[]): string {
	const lines = entries.map(
		(entry) =>
			`- ${entry.kind} ${entry.name}${entry.category ? ` [${entry.category}]` : ""}: ${entry.summary}`,
	);
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

/** Where a run-local tool activation came from; recorded so use telemetry can attribute it. */
type ActivationSource = "deterministic" | "jev" | "discover";

export default function capabilityGatewayExtension(pi: ExtensionAPI): void {
	if (!isEnabled()) return;

	// Tools this gateway activated for the current run, and whether they were invoked.
	// Cleared at agent_settled with the activations themselves.
	const activations = new Map<string, { source: ActivationSource; used: boolean }>();
	let tokenInSetupPrompted = false;

	/** Activate one tool for the current run, keeping the rest of the loadout untouched. */
	function activateTool(name: string, source: ActivationSource): void {
		const active = pi.getActiveTools();
		if (!active.includes(name)) {
			pi.setActiveTools([...active, name]);
		}
		activations.set(name, { source, used: false });
	}

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
					: params.query && matched.entry
						? [matched.entry]
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
			// Content-free: catalog query and filter arguments never travel.
			emitTelemetry(pi, "catalog", { results: shown.length });
			return {
				content: [{ type: "text", text }],
				details: { count: shown.length, total: filtered.length },
			};
		},
		renderCall(args, theme) {
			const query = typeof args.query === "string" && args.query.length > 0 ? args.query : "(all)";
			let text = theme.fg("toolTitle", theme.bold("capability_catalog "));
			text += theme.fg("accent", `"${query}"`);
			if (args.kind) text += " " + theme.fg("muted", args.kind);
			return new Text(text, 0, 0);
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
			activateTool(entry.name, "discover");
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
	// Routing: the deterministic catalog router first; default-on Jev routing is
	// only a bounded tie-breaker for its ambiguous/hint result.
	// ------------------------------------------------------------------
	pi.on("before_agent_start", async (event, ctx) => {
		const entries = catalogEntries(pi);
		const result = routePrompt(event.prompt, entries);
		if (result.action === "activate" && result.entry) {
			activateTool(result.entry.name, "deterministic");
			emitTelemetry(pi, "route", {
				source: "deterministic",
				outcome: "activated",
				tool: result.entry.name,
				candidates: 0,
				durationMs: 0,
			});
			return undefined;
		}
		// Do not inject fuzzy recommendations or catalog hints into the model
		// context. It can discover capabilities when it actually needs one.
		// Jev is a tie-breaker, never a classifier: only the ambiguous/hint
		// result counts. No lexical signal or unique skill recommendation
		// reaches it, and skills are never offered as candidates.
		if (result.action !== "hint") return undefined;
		const config = readGatewayJevConfig();
		if (!config.enabled) return undefined;
		const candidates = hintedToolCandidates(result.candidates);
		if (candidates.length < MIN_GATEWAY_JEV_CANDIDATES) return undefined;

		emitTelemetry(pi, "route", { source: "jev", outcome: "attempt", candidates: candidates.length });
		const jevRoute = await routeToJevTool(candidates, event.prompt, ctx, config);
		if (!jevRoute.selected) {
			if (
				!tokenInSetupPrompted &&
				config.provider === "tokenin" &&
				(jevRoute.reason === "no-credential" || jevRoute.reason === "no-template")
			) {
				tokenInSetupPrompted = true;
				ctx.ui.notify(
					"Jev tool tie-breaking needs a Token-In account. Add one with /tokenin add; deterministic routing will keep working meanwhile.",
					"warning",
				);
			}
			emitTelemetry(pi, "route", {
				source: "jev",
				outcome: JEV_UNAVAILABLE_REASONS.has(jevRoute.reason) ? "unavailable" : "abstained",
				reason: jevRoute.reason,
				candidates: jevRoute.candidates,
				durationMs: jevRoute.elapsedMs,
			});
			return undefined;
		}

		// Revalidate the accepted choice against the live catalog immediately
		// before activation: a stale or no-longer-eligible name activates nothing.
		const live = eligibleTools(pi).find((tool) => tool.name === jevRoute.tool);
		if (live) activateTool(live.name, "jev");
		emitTelemetry(pi, "route", {
			source: "jev",
			outcome: live ? "activated" : "abstained",
			...(live ? { tool: live.name } : { tool: jevRoute.tool }),
			confidence: confidenceBucket(jevRoute.confidence),
			candidates: jevRoute.candidates,
			durationMs: jevRoute.elapsedMs,
		});
		return undefined;
	});

	// ------------------------------------------------------------------
	// Selected -> used: a run-local activation is "used" when its tool is
	// actually executed before the run settles. Content-free: name + source.
	// ------------------------------------------------------------------
	pi.on("tool_execution_start", (event) => {
		const activation = activations.get(event.toolName);
		if (!activation || activation.used) return;
		activation.used = true;
		emitTelemetry(pi, "use", { tool: event.toolName, source: activation.source });
	});

	// ------------------------------------------------------------------
	// Reset: restore the baseline active-tool set after the run settles and
	// report how many run-local activations were actually used.
	// ------------------------------------------------------------------
	pi.on("agent_settled", () => {
		const baseline = pi.getActiveTools().filter((name) => !eligibleTools(pi).some((tool) => tool.name === name));
		pi.setActiveTools(baseline);
		let used = 0;
		for (const activation of activations.values()) if (activation.used) used += 1;
		emitTelemetry(pi, "reset", { activeCount: baseline.length, activated: activations.size, used });
		activations.clear();
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
