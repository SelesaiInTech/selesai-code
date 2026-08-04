import * as fs from "node:fs";
import * as path from "node:path";
import type { Message } from "@earendil-works/pi-ai";
import type { MaxOutputConfig, OutputMode, SavedOutputReference } from "../../shared/types.ts";
import { truncateOutput } from "../../shared/types.ts";
import { hasMutationToolCapability } from "./completion-guard.ts";

/**
 * Fixed internal context-fallback cap used when persisted output is unavailable
 * (persistence/read failure, `output: false`, or legacy results without a saved
 * path). Deliberately not exposed as a public parameter; reuse `truncateOutput()`
 * so the excerpt is bounded by both lines and bytes and never falls back to
 * unbounded output.
 */
export const CONTEXT_FALLBACK_LIMIT: Required<MaxOutputConfig> = { bytes: 4096, lines: 80 };

export interface SingleOutputSnapshot {
	exists: boolean;
	mtimeMs?: number;
	size?: number;
}

/**
 * Content the child itself sent to the configured output path, taken from its
 * last `write` tool call whose tool result reports success. Unlike reading the
 * path from disk, this cannot be polluted by a sibling run writing the same
 * path (#420); requiring the successful tool result keeps failed, cancelled,
 * or unanswered write calls from counting as authored output. Returns
 * undefined when no such write exists (e.g. bash or edit-based construction),
 * in which case callers must not assume file authorship.
 */
export function extractChildWrittenOutput(
	messages: Message[] | undefined,
	outputPath: string | undefined,
	cwd?: string,
): string | undefined {
	if (!messages?.length || !outputPath) return undefined;
	const resolvedTarget = path.resolve(cwd ?? ".", outputPath);
	const comparableTarget = process.platform === "win32" ? resolvedTarget.toLowerCase() : resolvedTarget;
	const successfulCallIds = new Set<string>();
	for (const message of messages) {
		if (message.role === "toolResult" && message.isError === false && typeof message.toolCallId === "string") {
			successfulCallIds.add(message.toolCallId);
		}
	}
	let content: string | undefined;
	for (const message of messages) {
		if (message.role !== "assistant") continue;
		for (const part of message.content) {
			if (part.type !== "toolCall" || part.name !== "write" || !successfulCallIds.has(part.id)) continue;
			const args = typeof part.arguments === "object" && part.arguments !== null && !Array.isArray(part.arguments)
				? part.arguments as Record<string, unknown>
				: {};
			if (typeof args.path !== "string" || typeof args.content !== "string") continue;
			const resolvedWritePath = path.resolve(cwd ?? ".", args.path);
			const comparableWritePath = process.platform === "win32" ? resolvedWritePath.toLowerCase() : resolvedWritePath;
			if (comparableWritePath !== comparableTarget) continue;
			content = args.content;
		}
	}
	return content;
}

export function normalizeSingleOutputOverride(
	output: string | boolean | undefined,
	defaultOutput: string | undefined,
): string | false | undefined {
	if (output === false || output === "false") return false;
	if (output === true || output === "true") return defaultOutput;
	if (typeof output === "string" && output.length > 0) return output;
	return undefined;
}

export function resolveSingleOutputPath(
	output: string | boolean | undefined,
	runtimeCwd: string,
	requestedCwd?: string,
	relativeBaseDir?: string,
): string | undefined {
	if (typeof output !== "string" || !output || output === "false" || output === "true") return undefined;
	if (path.isAbsolute(output)) return output;
	if (relativeBaseDir) return path.resolve(relativeBaseDir, output);
	const baseCwd = requestedCwd
		? (path.isAbsolute(requestedCwd) ? requestedCwd : path.resolve(runtimeCwd, requestedCwd))
		: runtimeCwd;
	return path.resolve(baseCwd, output);
}

interface OutputInstructionCapabilities {
	tools?: string[];
	mcpDirectTools?: string[];
}

function formatOutputPathInstruction(outputPath: string, capabilities?: OutputInstructionCapabilities): string {
	const delivery = !capabilities || hasMutationToolCapability(capabilities.tools, capabilities.mcpDirectTools)
		? `Write your findings to exactly this path: ${outputPath}`
		: [
			"Return the complete artifact in your final response.",
			`The runtime will persist it to exactly this path: ${outputPath}`,
			"Do not call contact_supervisor merely because no write-capable tool is available.",
		].join("\n");
	return [
		delivery,
		"This path is authoritative for this run.",
		"Ignore any other output filename or output path mentioned elsewhere, including output destinations in the base agent prompt, system prompt, or task instructions.",
	].join("\n");
}

export function injectSingleOutputInstruction(task: string, outputPath: string | undefined, capabilities?: OutputInstructionCapabilities): string {
	if (!outputPath) return task;
	return `${task}\n\n---\n**Output:**\n${formatOutputPathInstruction(outputPath, capabilities)}`;
}

export function injectOutputPathSystemPrompt(systemPrompt: string, outputPath: string | undefined, capabilities?: OutputInstructionCapabilities): string {
	if (!outputPath) return systemPrompt;
	const instruction = `Runtime output path override:\n${formatOutputPathInstruction(outputPath, capabilities)}`;
	return systemPrompt ? `${systemPrompt}\n\n${instruction}` : instruction;
}

function countLines(text: string): number {
	if (!text) return 0;
	const newlineMatches = text.match(/\r\n|\r|\n/g);
	return (newlineMatches?.length ?? 0) + (/[\r\n]$/.test(text) ? 0 : 1);
}

function formatByteSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	const units = ["KB", "MB", "GB", "TB"];
	let value = bytes / 1024;
	let unitIndex = 0;
	while (value >= 1024 && unitIndex < units.length - 1) {
		value /= 1024;
		unitIndex++;
	}
	return `${value.toFixed(1)} ${units[unitIndex]}`;
}

/**
 * Bounded fallback for deliveries where the durable full output cannot be
 * referenced: persistence/write errors, unreadable saved paths, or no saved
 * path at all (legacy/`output: false`). Contains process status, the intended
 * output path, the concrete error, and a bounded 80-line/4-KiB excerpt of the
 * available output. Never claims a full artifact exists.
 */
export function formatBoundedPersistenceFallback(input: {
	error: string;
	outputPath?: string;
	fullOutput: string;
	exitCode: number;
	processError?: string;
}): string {
	const status = input.processError?.trim()
		? `Process status: ${input.processError}`
		: `Process status: ${input.exitCode === 0 ? "completed" : `failed (exit ${input.exitCode})`}`;
	const bounded = truncateOutput(input.fullOutput, CONTEXT_FALLBACK_LIMIT);
	const lines = [
		`[Full output unavailable] ${input.error}`,
		status,
		...(input.outputPath ? [`Intended output path: ${input.outputPath}`] : []),
		"Full output is unavailable; showing a bounded excerpt (first 80 lines / 4 KiB).",
		bounded.text,
	];
	return lines.join("\n");
}

export function formatSavedOutputReference(savedPath: string, fullOutput: string): SavedOutputReference {
	const absolutePath = path.resolve(savedPath);
	const bytes = Buffer.byteLength(fullOutput, "utf-8");
	const lines = countLines(fullOutput);
	return {
		path: absolutePath,
		bytes,
		lines,
		message: `Output saved to: ${absolutePath} (${formatByteSize(bytes)}, ${lines} ${lines === 1 ? "line" : "lines"}). Read this file if needed.`,
	};
}

export function validateFileOnlyOutputMode(outputMode: OutputMode | undefined, outputPath: string | undefined, context: string): string | undefined {
	if (outputMode === "file-only" && !outputPath) {
		return `${context} sets outputMode: "file-only" but does not configure an output file. Set output to a path or use outputMode: "inline".`;
	}
	return undefined;
}

export function captureSingleOutputSnapshot(outputPath: string | undefined): SingleOutputSnapshot | undefined {
	if (!outputPath) return undefined;
	try {
		const stat = fs.statSync(outputPath);
		return { exists: true, mtimeMs: stat.mtimeMs, size: stat.size };
	} catch {
		// The snapshot is advisory; resolveSingleOutput reports concrete read/write failures.
		return { exists: false };
	}
}

function persistSingleOutput(
	outputPath: string | undefined,
	fullOutput: string,
): { savedPath?: string; error?: string } {
	if (!outputPath) return {};
	try {
		fs.mkdirSync(path.dirname(outputPath), { recursive: true });
		fs.writeFileSync(outputPath, fullOutput, "utf-8");
		return { savedPath: outputPath };
	} catch (err) {
		return { error: err instanceof Error ? err.message : String(err) };
	}
}

export function resolveSingleOutput(
	outputPath: string | undefined,
	fallbackOutput: string,
	beforeRun: SingleOutputSnapshot | undefined,
): { fullOutput: string; savedPath?: string; saveError?: string } {
	if (!outputPath) return { fullOutput: fallbackOutput };

	let changedSinceStart = false;
	try {
		const stat = fs.statSync(outputPath);
		changedSinceStart = !beforeRun?.exists
			|| stat.mtimeMs !== beforeRun.mtimeMs
			|| stat.size !== beforeRun.size;
	} catch (error) {
		const code = error && typeof error === "object" && "code" in error ? (error as { code?: unknown }).code : undefined;
		if (code !== "ENOENT" && code !== "ENOTDIR") {
			return {
				fullOutput: fallbackOutput,
				saveError: `Failed to inspect output file: ${error instanceof Error ? error.message : String(error)}`,
			};
		}
	}

	if (changedSinceStart) {
		try {
			return { fullOutput: fs.readFileSync(outputPath, "utf-8"), savedPath: outputPath };
		} catch (error) {
			return {
				fullOutput: fallbackOutput,
				saveError: `Failed to read changed output file: ${error instanceof Error ? error.message : String(error)}`,
			};
		}
	}

	const save = persistSingleOutput(outputPath, fallbackOutput);
	if (save.savedPath) return { fullOutput: fallbackOutput, savedPath: save.savedPath };
	return { fullOutput: fallbackOutput, saveError: save.error };
}

export function finalizeSingleOutput(params: {
	fullOutput: string;
	truncatedOutput?: string;
	outputPath?: string;
	outputMode?: OutputMode;
	exitCode: number;
	savedPath?: string;
	outputReference?: SavedOutputReference;
	saveError?: string;
	error?: string;
}): { displayOutput: string; savedPath?: string; outputReference?: SavedOutputReference; saveError?: string } {
	if (params.savedPath) {
		const outputReference = params.outputReference ?? formatSavedOutputReference(params.savedPath, params.fullOutput);
		if (params.exitCode === 0 && params.outputMode === "file-only") {
			return { displayOutput: outputReference.message, savedPath: params.savedPath, outputReference };
		}
		if (params.exitCode !== 0) {
			// Failed runs with a successfully persisted result surface the error/status
			// plus the saved-output reference, never raw child output.
			const status = params.error?.trim() || `Subagent failed with exit code ${params.exitCode}`;
			return { displayOutput: `${status}\n\n${outputReference.message}`, savedPath: params.savedPath, outputReference };
		}
		const displayOutput = `${params.truncatedOutput || params.fullOutput}\n\n${outputReference.message}`;
		return { displayOutput, savedPath: params.savedPath, outputReference };
	}
	if (params.saveError && params.outputPath) {
		// Persistence/read failure: only the bounded fallback is delivered. It must
		// not claim a full artifact exists.
		return {
			displayOutput: formatBoundedPersistenceFallback({
				error: params.saveError,
				outputPath: params.outputPath,
				fullOutput: params.fullOutput,
				exitCode: params.exitCode,
				processError: params.error,
			}),
			saveError: params.saveError,
		};
	}
	return { displayOutput: params.truncatedOutput || params.fullOutput };
}
