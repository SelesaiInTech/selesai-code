import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, TextContent } from "@earendil-works/pi-ai";

type Phase = "grilling" | "research" | "plan" | "reuse" | "handoff" | "loop" | "audit" | "complete";

const PHASE_STEPS: Record<Phase, number> = {
	grilling: 1,
	research: 2,
	plan: 3,
	reuse: 4,
	handoff: 6,
	loop: 7,
	audit: 8,
	complete: 8,
};

const STATUS_KEY = "prototype";
const ENTRY_TYPE = "prototype-phase";
const COMPLETE_MARKER = "[PROTOTYPE_PHASE_DONE]";

// ponytail: module-level state, not a class — one workflow at a time (same pattern as plan-mode).
let active = false;
let phase: Phase = "grilling";
let userPrompt = "";
let auditMarkersSeen = 0;

function isAssistantMessage(m: AgentMessage): m is AssistantMessage {
	return m.role === "assistant" && Array.isArray(m.content);
}

function getTextContent(message: AssistantMessage): string {
	return message.content
		.filter((block): block is TextContent => block.type === "text")
		.map((block) => block.text)
		.join("");
}

function setPhase(pi: ExtensionAPI, p: Phase): void {
	phase = p;
	const step = PHASE_STEPS[p];
	const done = p === "complete";
	// ponytail: persist userPrompt in every entry so session_start resume restores it correctly.
	pi.appendEntry(ENTRY_TYPE, { mode: "prototype", phase: p, step, done, userPrompt });
}

// ponytail: sendUserMessage called synchronously inside an agent_end handler throws
// "Agent is already processing" because isStreaming/activeRun are still set until
// finishRun() runs AFTER the listener returns. Defer to the next tick so the run
// fully settles first. Triggers a fresh agent run each phase. Reach per-account locks
// if throughput matters.
function sendNext(pi: ExtensionAPI, prompt: string): void {
	setTimeout(() => pi.sendUserMessage(prompt), 0);
}

function updateFooter(_pi: ExtensionAPI, ctx: ExtensionContext): void {
	if (!active || phase === "complete") {
		ctx.ui.setStatus(STATUS_KEY, undefined);
		return;
	}
	const step = PHASE_STEPS[phase];
	ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("warning", `● prototype · ${step}/8 ${phase}`));
}

const PHASE_ORDER: Phase[] = ["grilling", "research", "plan", "reuse", "handoff", "loop", "audit", "complete"];

function nextPhase(p: Phase): Phase | null {
	const i = PHASE_ORDER.indexOf(p);
	if (i < 0 || i >= PHASE_ORDER.length - 1) return null;
	return PHASE_ORDER[i + 1];
}

function phasePrompt(p: Phase): string {
	switch (p) {
		case "grilling":
			return `/skill:grill-me ${userPrompt}\n\nWhen you have finished grilling the user and all requirements are clear, include ${COMPLETE_MARKER} at the end of your response.`;
		case "research":
			return `Research the requirements gathered during grilling. Explore the codebase and any relevant resources. When research is complete, include ${COMPLETE_MARKER} at the end of your response.`;
		case "plan":
			return `/skill:planger Create a plan.md file for the prototype based on the research. Path: ./plan.md\n\nWhen plan.md is written, include ${COMPLETE_MARKER} at the end of your response.`;
		case "reuse":
			return `Ask the user: "Are there existing files or repositories relevant to this request? List paths or say none." Wait for their response, then explore the codebase for reusable components and knowledge. When done, include ${COMPLETE_MARKER} at the end of your response.`;
		case "handoff":
			return `/skill:handoff Generate a handoff.md file for a subagent to pick up. Path: ./handoff.md\n\nWhen handoff.md is written, include ${COMPLETE_MARKER} at the end of your response.`;
		case "loop":
			return `You are the orchestrator. Read ./plan.md and ./handoff.md. For each task in plan.md, run a subagent chain: execute → review → audit. Use the subagent tool in chain mode with agents: plan-executor, reviewer, auditor. Honor the order in plan.md. When the loop is complete, include ${COMPLETE_MARKER} at the end of your response.`;
		case "audit":
			return `/skill:ponytail-review Review all changes from this workflow.\n\nWhen the review is complete, include ${COMPLETE_MARKER} at the end of your response. After that, run /skill:ponytail-audit for a whole-repo over-engineering audit. When the audit is also complete, include ${COMPLETE_MARKER} again.`;
		default:
			return "";
	}
}

export default function prototypeExtension(pi: ExtensionAPI): void {
	// agent_end: advance the state machine
	pi.on("agent_end", async (event, ctx) => {
		if (!active || phase === "complete") return;

		const lastAssistant = [...event.messages].reverse().find(isAssistantMessage);
		if (!lastAssistant) return;

		const text = getTextContent(lastAssistant);
		if (!text.includes(COMPLETE_MARKER)) return; // Phase not done yet

		// Empty-project check after plan phase: skip reuse if no git commits.
		if (phase === "plan") {
			try {
				const result = await pi.exec("git", ["log", "--oneline", "-1"]);
				const isEmpty = result.code !== 0 || !result.stdout.trim();
				if (isEmpty) {
					setPhase(pi, "handoff");
					updateFooter(pi, ctx);
					sendNext(pi, phasePrompt("handoff"));
					return;
				}
			} catch {
				// git unavailable — don't skip reuse
			}
		}

		// Audit phase: needs two markers — review done (1st), then audit done (2nd).
		// Count all markers in this message in case both appear in one response.
		if (phase === "audit") {
			const markerCount = text.split(COMPLETE_MARKER).length - 1;
			auditMarkersSeen += markerCount;
			if (auditMarkersSeen < 2) {
				// Review complete -> prompt the audit step so the 2nd marker will come.
				sendNext(pi, `/skill:ponytail-audit Whole-repo over-engineering audit. When the audit is complete, include ${COMPLETE_MARKER} at the end of your response.`);
				return;
			}
			auditMarkersSeen = 0;
		}

		const next = nextPhase(phase);
		if (!next || next === "complete") {
			setPhase(pi, "complete");
			active = false;
			updateFooter(pi, ctx);
			ctx.ui.notify("Prototype workflow complete.", "info");
			return;
		}

		setPhase(pi, next);
		updateFooter(pi, ctx);
		sendNext(pi, phasePrompt(next));
	});

	// session_start: restore state from persisted entries
	pi.on("session_start", async (_event, ctx) => {
		const entries = ctx.sessionManager.getEntries();
		for (let i = entries.length - 1; i >= 0; i--) {
			const e = entries[i] as { type: string; customType?: string; data?: any };
			if (e.type === "custom" && e.customType === ENTRY_TYPE && e.data) {
				if (e.data.done) {
					active = false;
					phase = "complete";
				} else {
					active = true;
					phase = e.data.phase as Phase;
					userPrompt = e.data.userPrompt ?? "";
				}
				updateFooter(pi, ctx);
				break;
			}
		}
	});

	pi.registerCommand("prototype", {
		description: "Run the prototype workflow (grill → research → plan → reuse → handoff → loop → audit)",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			if (!args.trim()) {
				ctx.ui.notify("Usage: /prototype <what to build>", "warning");
				return;
			}
			if (!ctx.isIdle()) {
				ctx.ui.notify("Agent is busy. Wait for it to finish before starting /prototype.", "warning");
				return;
			}

			userPrompt = args.trim();
			active = true;
			auditMarkersSeen = 0;
			setPhase(pi, "grilling");
			updateFooter(pi, ctx);
			pi.sendUserMessage(phasePrompt("grilling"));
		},
	});
}