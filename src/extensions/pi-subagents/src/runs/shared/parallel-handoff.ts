import * as fs from "node:fs";
import * as path from "node:path";
import { writeAtomicJson } from "../../shared/atomic-json.ts";
import type {
	ParallelHandoffGroup,
	ParallelHandoffManifest,
	ParallelHandoffReference,
	SubagentResultStatus,
} from "../../shared/types.ts";
import type {
	WorktreeCleanupReport,
	WorktreeDiff,
	WorktreeSetup,
} from "./worktree.ts";

export interface ParallelHandoffResult {
	agent: string;
	status: SubagentResultStatus;
	summary: string;
	outputPath?: string;
	structuredOutput?: unknown;
	structuredOutputPath?: string;
	sessionPath?: string;
}

function readManifest(manifestPath: string): ParallelHandoffManifest | undefined {
	if (!fs.existsSync(manifestPath)) return undefined;
	const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as ParallelHandoffManifest;
	if (parsed.version !== 1 || !Array.isArray(parsed.groups)) {
		throw new Error(`Invalid parallel handoff manifest: ${manifestPath}`);
	}
	return parsed;
}

function referenceFor(manifestPath: string, manifest: ParallelHandoffManifest): ParallelHandoffReference {
	const children = manifest.groups.flatMap((group) => group.children);
	return {
		version: 1,
		path: manifestPath,
		groupCount: manifest.groups.length,
		childCount: children.length,
		changedPatches: children.filter((child) => child.patch.changed).length,
		cleanupState: manifest.groups.every((group) => group.cleanup.state === "complete") ? "complete" : "partial",
	};
}

function safeHandoffAgentName(agent: string): string {
	return agent.replace(/[^\w.-]/g, "_");
}

function missingDiff(input: { manifestPath: string; stepIndex: number; taskIndex: number; agent: string; branch?: string }): WorktreeDiff {
	const patchPath = path.join(path.dirname(input.manifestPath), `missing-diff-step-${input.stepIndex}-task-${input.taskIndex}-${safeHandoffAgentName(input.agent)}.patch`);
	try {
		fs.mkdirSync(path.dirname(patchPath), { recursive: true });
		fs.writeFileSync(patchPath, "", "utf-8");
	} catch {
		// Handoff records the artifact failure below; patch creation remains best-effort.
	}
	return {
		index: input.taskIndex,
		agent: input.agent,
		branch: input.branch ?? "",
		diffStat: "",
		filesChanged: 0,
		insertions: 0,
		deletions: 0,
		patchPath,
		error: "diff artifact unavailable; no patch was captured",
	};
}

export function writeParallelHandoffGroup(input: {
	manifestPath: string;
	runId: string;
	mode: "parallel" | "chain";
	source: "foreground" | "async";
	cwd: string;
	stepIndex: number;
	flatStartIndex: number;
	setup: WorktreeSetup;
	diffs: WorktreeDiff[];
	cleanup: WorktreeCleanupReport;
	results: ParallelHandoffResult[];
	now?: number;
}): ParallelHandoffReference {
	const now = input.now ?? Date.now();
	const existing = readManifest(input.manifestPath);
	if (existing && (existing.runId !== input.runId || existing.mode !== input.mode || existing.source !== input.source)) {
		throw new Error(`Parallel handoff manifest belongs to a different run: ${input.manifestPath}`);
	}
	const group: ParallelHandoffGroup = {
		stepIndex: input.stepIndex,
		baseCommit: input.setup.baseCommit,
		repoRoot: input.setup.cwd,
		children: input.results.map((result, taskIndex) => {
			const diff = input.diffs[taskIndex] ?? missingDiff({
				manifestPath: input.manifestPath,
				stepIndex: input.stepIndex,
				taskIndex,
				agent: result.agent,
				branch: input.setup.worktrees[taskIndex]?.branch,
			});
			return {
				index: input.flatStartIndex + taskIndex,
				taskIndex,
				agent: result.agent,
				status: result.status,
				summary: result.summary,
				...(result.outputPath ? { outputPath: result.outputPath } : {}),
				...(result.structuredOutput !== undefined ? { structuredOutput: result.structuredOutput } : {}),
				...(result.structuredOutputPath ? { structuredOutputPath: result.structuredOutputPath } : {}),
				...(result.sessionPath ? { sessionPath: result.sessionPath } : {}),
				patch: {
					path: diff.patchPath,
					branch: diff.branch,
					changed: diff.filesChanged > 0 || diff.insertions > 0 || diff.deletions > 0 || diff.diffStat.trim().length > 0,
					diffStat: diff.diffStat,
					filesChanged: diff.filesChanged,
					insertions: diff.insertions,
					deletions: diff.deletions,
					...(diff.error ? { error: diff.error } : {}),
				},
			};
		}),
		cleanup: input.cleanup,
	};
	const groups = existing?.groups.filter((candidate) => candidate.stepIndex !== input.stepIndex) ?? [];
	groups.push(group);
	groups.sort((left, right) => left.stepIndex - right.stepIndex);
	const manifest: ParallelHandoffManifest = {
		version: 1,
		runId: input.runId,
		mode: input.mode,
		source: input.source,
		cwd: input.cwd,
		createdAt: existing?.createdAt ?? now,
		updatedAt: now,
		groups,
	};
	writeAtomicJson(input.manifestPath, manifest);
	return referenceFor(input.manifestPath, manifest);
}

export function parallelHandoffPath(baseDir: string, runId?: string): string {
	return runId ? path.join(baseDir, "handoffs", `${runId}.json`) : path.join(baseDir, "handoff.json");
}

export function formatParallelHandoffReference(reference: ParallelHandoffReference): string {
	return `Parallel handoff: ${reference.path} (${reference.childCount} children, ${reference.changedPatches} changed patches, cleanup ${reference.cleanupState})`;
}

export function formatParallelHandoffError(error: unknown): string {
	return `Parallel handoff unavailable: ${error instanceof Error ? error.message : String(error)}`;
}
