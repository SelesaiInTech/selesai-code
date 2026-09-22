/**
 * The workflow, skill, and verification route.
 *
 * Only discovered, eligible, canonically named items may be recommended; the
 * advisory must stay a recommendation (no skill body read, no workflow started,
 * no command emitted, mandatory gates untouched); and an oversized catalog or an
 * unavailable classifier publishes nothing at all.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ settingsPath: "" }));

vi.mock("@selesai/code", () => ({ getSettingsPath: () => state.settingsPath }));
// The client speaks through pi's completion transport (the Token-In provider
// layer owns the non-streaming decisions request), so a suite stubs that.
import jevAdvisoryRoutingExtension, {
	MAX_CANDIDATE_DESCRIPTION_CHARS,
	recommendationCandidates,
} from "./jev-advisory-routing.ts";
const completeMock = vi.fn();

import {
	enabledAdvisoryRoutes,
	jevAnswers,
	jevResponse,
	makeHarness,
	makeRepo,
	sentPayload,
	writeJevSettings,
	type CommandStub,
	type SkillStub,
} from "./jev/test-support.ts";

const SKILL_BODY_SENTINEL = "SKILL_BODY_MUST_NOT_APPEAR";

let root: string;
let repo: string;
let skills: SkillStub[];

beforeAll(() => {
	const created = makeRepo("jev-recommend-");
	root = created.root;
	repo = created.repo;
	state.settingsPath = join(root, "agent", "settings.json");
	mkdirSync(join(root, "agent"), { recursive: true });

	const skillDir = join(root, "agent", "skills", "implanger");
	mkdirSync(skillDir, { recursive: true });
	writeFileSync(join(skillDir, "SKILL.md"), `# implanger\n\n${SKILL_BODY_SENTINEL}\n`, "utf-8");
	skills = [
		{ name: "implanger", description: "Turn a described UI change into an implementation plan.", filePath: join(skillDir, "SKILL.md") },
		{ name: "hidden-tool", description: "Not offered to the model.", filePath: join(skillDir, "SKILL.md"), disableModelInvocation: true },
	];
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

const WORKFLOWS: CommandStub[] = [
	{ name: "deploy", description: "Deploy the project.", source: "prompt" },
	{ name: "memory-insights", description: "An extension command, not a workflow.", source: "extension" },
	{ name: "skill:implanger", description: "Duplicate listing of the same skill.", source: "skill" },
];

function harness(
	options: {
		advisory?: unknown;
		skills?: SkillStub[];
		commands?: CommandStub[];
		credential?: boolean;
		template?: boolean;
		answer?: { recommendation: string; confidence?: number; verification?: string };
	} = {},
) {
	writeJevSettings(
		state.settingsPath,
		options.advisory ?? { routes: enabledAdvisoryRoutes(["recommendations"]) },
	);
	const session = makeHarness({
		settingsPath: state.settingsPath,
		extension: jevAdvisoryRoutingExtension,
		cwd: repo,
		skills: options.skills ?? skills,
		commands: options.commands ?? WORKFLOWS,
		credential: options.credential,
		template: options.template,
		complete: completeMock,
	});
	const answer = options.answer ?? { recommendation: "skill:implanger" };
	completeMock.mockResolvedValue(
		jevResponse(
			jevAnswers({
				recommendation: { choice: answer.recommendation, confidence: answer.confidence ?? 0.9 },
				verification: { choice: answer.verification ?? "targeted", confidence: answer.confidence ?? 0.9 },
			}),
		),
	);
	return session;
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("candidate discovery", () => {
	it("offers only model-invocable skills and registered prompt workflows, by canonical name", () => {
		const candidates = recommendationCandidates({
			getResolvedSkills: () => skills,
			getCommands: () => WORKFLOWS,
		} as never);
		expect(candidates.map((candidate) => candidate.key)).toEqual(["skill:implanger", "workflow:deploy"]);
		expect(candidates[0]).toMatchObject({ kind: "skill", name: "implanger" });
		expect(candidates[1]).toMatchObject({ kind: "workflow", name: "deploy" });
	});

	it("compacts long descriptions and replaces a missing one with a neutral label", () => {
		const candidates = recommendationCandidates({
			getResolvedSkills: () => [
				{ name: "verbose", description: `  ${"word ".repeat(60)}  `, filePath: "/tmp/SKILL.md" },
				{ name: "silent", description: "", filePath: "/tmp/SKILL.md" },
			],
			getCommands: () => [],
		} as never);
		const verbose = candidates[0].description;
		expect(verbose.length).toBe(MAX_CANDIDATE_DESCRIPTION_CHARS + 1);
		expect(verbose.endsWith("…")).toBe(true);
		expect(verbose.startsWith("word word")).toBe(true);
		expect(candidates[1].description).toBe("Installed skill (no description recorded).");
	});
});

describe("accepted recommendations", () => {
	it("publishes the canonical skill or workflow and its confidence as advisory context", async () => {
		const session = harness({ answer: { recommendation: "skill:implanger", confidence: 0.83, verification: "none" } });
		await session.fire("session_start");
		const message = await session.advise("turn this mockup into a plan");

		expect(message?.customType).toBe("jev-advisory");
		expect(message?.content).toContain('<jev-advisory source="jev" route="recommendation" confidence="0.83">');
		expect(message?.content).toContain("Suggested skill: `implanger`");
		expect(message?.content).toContain("nothing was loaded, started, permitted, or executed");
		expect(message?.content).not.toContain(SKILL_BODY_SENTINEL);
		expect(session.telemetry.at(-1)).toMatchObject({ route: "recommendations", outcome: "jev", item: "skill:implanger" });
	});

	it("publishes a workflow without pretending it ran", async () => {
		const session = harness({ answer: { recommendation: "workflow:deploy", confidence: 0.7, verification: "none" } });
		await session.fire("session_start");
		const message = await session.advise("ship this to production");
		expect(message?.content).toContain("Suggested workflow prompt: `deploy`");
		expect(message?.content).toContain("nothing was loaded, started, permitted, or executed");
	});

	it("publishes a verification level without inventing a command or weakening a gate", async () => {
		const session = harness({ answer: { recommendation: "none", verification: "project-required" } });
		await session.fire("session_start");
		const message = await session.advise("refactor the session runtime");
		expect(message?.content).toContain("Verification suggestion: project-required");
		expect(message?.content).toContain("mandatory project, workflow, and acceptance verification is unchanged");
		expect(message?.content).not.toContain("npm");
		expect(message?.content).not.toContain("$ ");
	});

	it("reports adoption when the parent reads the recommended skill file", async () => {
		const session = harness({ answer: { recommendation: "skill:implanger", verification: "none" } });
		await session.fire("session_start");
		await session.advise("turn this mockup into a plan");
		await session.fire("tool_execution_start", {
			type: "tool_execution_start",
			toolName: "read",
			toolCallId: "t1",
			args: { path: skills[0].filePath },
		});
		await session.fire("agent_settled");
		expect(session.telemetry.at(-1)).toEqual({
			event: "adoption",
			route: "recommendations",
			item: "skill:implanger",
			adopted: true,
		});
	});
});

describe("abstentions", () => {
	it("publishes nothing when no candidate fits and no level is warranted", async () => {
		const session = harness({ answer: { recommendation: "none", verification: "none" } });
		await session.fire("session_start");
		expect(await session.advise("what is the weather?")).toBeUndefined();
	});

	it("never publishes a candidate the discovery surface did not offer", async () => {
		const session = harness({ answer: { recommendation: "skill:hidden-tool", verification: "none" } });
		await session.fire("session_start");
		expect(await session.advise("do something hidden")).toBeUndefined();
	});

	it("never publishes a raw command as a verification level", async () => {
		const session = harness({ answer: { recommendation: "none", verification: "rm -rf /" } });
		await session.fire("session_start");
		expect(await session.advise("clean up")).toBeUndefined();
	});

	it("skips Jev entirely when the candidate catalog cannot fit its payload budget", async () => {
		const huge = Array.from({ length: 200 }, (_, index) => ({
			name: `skill-${index}`,
			description: "x".repeat(MAX_CANDIDATE_DESCRIPTION_CHARS),
			filePath: `/tmp/skill-${index}/SKILL.md`,
		}));
		const session = harness({
			advisory: { routes: { recommendations: { enabled: true, payloadBytes: 1_024 } } },
			skills: huge,
		});
		await session.fire("session_start");
		expect(await session.advise("use one of the many skills")).toBeUndefined();
		expect(completeMock).not.toHaveBeenCalled();
		expect(session.telemetry.at(-1)).toMatchObject({ route: "recommendations", outcome: "fallback", reason: "overflow" });
	});

	it("asks only the verification question when nothing is discoverable", async () => {
		const session = harness({ skills: [], commands: [], answer: { recommendation: "none", verification: "targeted" } });
		await session.fire("session_start");
		const message = await session.advise("fix the flaky test");
		expect(message?.content).toContain("Verification suggestion: targeted");
		const questions = sentPayload(completeMock)?.questions as Record<string, unknown>;
		expect(Object.keys(questions)).toEqual(["verification"]);
	});

	it("stays silent without a credential or a provider template", async () => {
		const noCredential = harness({ credential: false });
		await noCredential.fire("session_start");
		expect(await noCredential.advise("turn this mockup into a plan")).toBeUndefined();
		expect(completeMock).not.toHaveBeenCalled();

		const noTemplate = harness({ template: false });
		await noTemplate.fire("session_start");
		expect(await noTemplate.advise("turn this mockup into a plan")).toBeUndefined();
	});
});
